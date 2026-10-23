import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type HeadersArgs,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import * as crypto from "node:crypto";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { commitSession } from "../../lib/session.server";
import { validateOrigin, readStrictFormUrlEncoded } from "../../lib/security.server";
import {
  getGalleriesRetentionList,
  getDeletionJobsSummary,
  deleteGalleryWithIntent,
  deleteGalleriesWithIntentBulk,
  retryFailedDeletionJob,
  setGalleryRetentionExempt,
  type GalleryRetentionItem,
  type RetentionSettings,
  type DeletionJobsSummary,
} from "../../lib/gallery-retention.server";
import { GalleryConflictError, GalleryValidationError, getGalleryById } from "../../lib/gallery.server";
import styles from "./data-retention.module.css";

export function meta() {
  return [
    { title: "Conservation et suppression des données | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

interface LoaderData {
  items: GalleryRetentionItem[];
  total: number;
  page: number;
  totalPages: number;
  settings: RetentionSettings;
  deletionJobs: DeletionJobsSummary;
  csrfToken: string;
  search: string;
  filter: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const headers = createAdminHeaders();

  let csrfToken = session.get("csrfToken");
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    session.set("csrfToken", csrfToken);
    headers.set("Set-Cookie", await commitSession(session));
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("q") || "";
  const filter = url.searchParams.get("filter") || "all";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;

  const validFilters = ["all", "active", "expired", "soon", "eligible", "exempt", "importing", "error"] as const;
  type ValidFilter = (typeof validFilters)[number];
  const isValidFilter = (f: string): f is ValidFilter => (validFilters as readonly string[]).includes(f);
  const safeFilter: ValidFilter = isValidFilter(filter) ? filter : "all";

  const { items, total, settings } = getGalleriesRetentionList({
    search,
    filter: safeFilter,
    limit,
    offset,
  });

  const deletionJobs = getDeletionJobsSummary();
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return Response.json(
    {
      items,
      total,
      page,
      totalPages,
      settings,
      deletionJobs,
      csrfToken,
      search,
      filter: safeFilter,
    },
    { headers }
  );
}

interface ActionData {
  success?: boolean;
  message?: string;
  error?: string;
  conflict?: boolean;
  intent?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    const headers = createAdminHeaders();
    headers.set("Allow", "POST");
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  const session = await requireValidAdminSession(request);
  const expectedCsrfToken = session.get("csrfToken") || "";

  if (!validateOrigin(request)) {
    return Response.json(
      { error: "Origine invalide." },
      { status: 403, headers: createAdminHeaders() }
    );
  }

  let body: URLSearchParams;
  try {
    body = await readStrictFormUrlEncoded(request, 16384);
  } catch {
    return Response.json(
      { error: "Corps de requête invalide ou taille excessive." },
      { status: 400, headers: createAdminHeaders() }
    );
  }

  const formCsrf = body.get("csrfToken") || "";
  if (!formCsrf || !constantTimeEqual(formCsrf, expectedCsrfToken)) {
    return Response.json(
      { error: "Jeton CSRF invalide." },
      { status: 403, headers: createAdminHeaders() }
    );
  }

  const intent = body.get("intent");

  try {
    if (intent === "delete_single") {
      const galleryId = (body.get("galleryId") || "").trim();
      const expectedRevision = Number.parseInt(body.get("expectedRevision") || "1", 10);
      const confirmTitle = (body.get("confirmTitle") || "").trim();

      if (!galleryId || !/^[0-9a-fA-F-]{36}$/.test(galleryId)) {
        return Response.json({ error: "Identifiant de galerie invalide.", intent }, { status: 400, headers: createAdminHeaders() });
      }

      const gallery = getGalleryById(galleryId);
      if (!gallery) {
        return Response.json({ error: "Galerie introuvable.", intent }, { status: 404, headers: createAdminHeaders() });
      }

      if (confirmTitle !== gallery.title) {
        return Response.json(
          { error: `Pour confirmer la suppression, saisissez exactement le titre : « ${gallery.title} ».`, intent },
          { status: 400, headers: createAdminHeaders() }
        );
      }

      deleteGalleryWithIntent(galleryId, {
        decisionSource: "manual",
        expectedRevision,
      });

      return Response.json(
        {
          success: true,
          message: `La galerie « ${gallery.title} » a été supprimée avec succès. Ses médias ont été isolés en quarantaine.`,
          intent,
        },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "delete_bulk") {
      const rawIds = body.getAll("galleryIds");
      const confirmBulkText = (body.get("confirmBulkText") || "").trim();

      if (confirmBulkText !== "SUPPRIMER") {
        return Response.json(
          { error: "Pour confirmer la suppression groupée, vous devez saisir le mot « SUPPRIMER ».", intent },
          { status: 400, headers: createAdminHeaders() }
        );
      }

      if (!rawIds || rawIds.length === 0) {
        return Response.json({ error: "Aucune galerie sélectionnée.", intent }, { status: 400, headers: createAdminHeaders() });
      }

      if (rawIds.length > 50) {
        return Response.json(
          { error: "La sélection groupée est limitée à 50 galeries maximum.", intent },
          { status: 400, headers: createAdminHeaders() }
        );
      }

      const items: { id: string; expectedRevision?: number }[] = [];
      for (const id of rawIds) {
        const cleanId = id.trim();
        const revRaw = body.get(`rev_${cleanId}`);
        const expectedRevision = revRaw ? Number.parseInt(revRaw, 10) : undefined;
        items.push({ id: cleanId, expectedRevision });
      }

      const results = deleteGalleriesWithIntentBulk(items, { decisionSource: "manual" });

      return Response.json(
        {
          success: true,
          message: `${results.length} galerie(s) supprimée(s) avec succès. Leurs fichiers ont été déplacés en quarantaine pour nettoyage.`,
          intent,
        },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "retry_job") {
      const jobId = (body.get("jobId") || "").trim();
      retryFailedDeletionJob(jobId);
      return Response.json(
        { success: true, message: "La tâche de suppression a été relancée avec succès.", intent },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "toggle_exempt") {
      const galleryId = (body.get("galleryId") || "").trim();
      const exempt = body.get("exempt") === "1";
      const reason = body.get("reason") || null;
      const expectedRevision = Number.parseInt(body.get("expectedRevision") || "1", 10);

      setGalleryRetentionExempt(galleryId, exempt, reason, expectedRevision);

      return Response.json(
        {
          success: true,
          message: exempt
            ? "La galerie est désormais suspendue / exemptée de la purge automatique."
            : "L'exemption de purge a été levée pour cette galerie.",
          intent,
        },
        { headers: createAdminHeaders() }
      );
    }

    return Response.json({ error: "Action inconnue.", intent }, { status: 400, headers: createAdminHeaders() });
  } catch (err) {
    if (err instanceof GalleryConflictError) {
      return Response.json(
        {
          error: "Conflit de révision (409) : une ou plusieurs galeries ont été modifiées par une autre opération en arrière-plan. Vos sélections sont conservées.",
          conflict: true,
          intent,
        },
        { status: 409, headers: createAdminHeaders() }
      );
    }
    if (err instanceof GalleryValidationError) {
      return Response.json({ error: err.message, intent }, { status: 400, headers: createAdminHeaders() });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Une erreur inattendue est survenue.", intent },
      { status: 500, headers: createAdminHeaders() }
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "Non renseigné";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

export default function AdminDataRetentionPage() {
  const data = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeModal, setActiveModal] = useState<
    | { type: "single"; gallery: GalleryRetentionItem }
    | { type: "bulk"; galleries: GalleryRetentionItem[] }
    | { type: "exempt"; gallery: GalleryRetentionItem }
    | null
  >(null);

  const [confirmInput, setConfirmInput] = useState("");
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const modalInputRef = useRef<HTMLInputElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  // Clear modal on success
  useEffect(() => {
    if (actionData?.success) {
      setActiveModal(null);
      setConfirmInput("");
      setSelectedIds(new Set());
    }
  }, [actionData]);

  // Open modal helper
  const openModal = useCallback((modal: typeof activeModal) => {
    previousActiveElement.current = document.activeElement as HTMLElement;
    setConfirmInput("");
    setActiveModal(modal);
  }, []);

  // Close modal helper
  const closeModal = useCallback(() => {
    setActiveModal(null);
    setConfirmInput("");
    if (previousActiveElement.current) {
      previousActiveElement.current.focus();
    }
  }, []);

  // Keyboard navigation & trap focus in modal
  useEffect(() => {
    if (!activeModal) return;

    // Focus input
    setTimeout(() => {
      modalInputRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
        return;
      }

      if (e.key === "Tab" && modalContainerRef.current) {
        const focusable = modalContainerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeModal, closeModal]);

  // Bulk selection handling
  const toggleSelectGallery = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= 50) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set());
    } else {
      const next = new Set<string>();
      for (const item of data.items) {
        if (next.size >= 50) break;
        next.add(item.id);
      }
      setSelectedIds(next);
    }
  };

  const selectedGalleries = data.items.filter((g) => selectedIds.has(g.id));
  const selectedTotalSize = selectedGalleries.reduce((acc, g) => acc + g.totalSize, 0);

  const filterTabs = [
    { id: "all", label: "Toutes" },
    { id: "active", label: "Actives" },
    { id: "expired", label: "Expirées" },
    { id: "soon", label: "Expire bientôt" },
    { id: "eligible", label: "Purge due" },
    { id: "exempt", label: "Exemptées" },
    { id: "importing", label: "Import en cours" },
    { id: "error", label: "Erreurs" },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin/dashboard" className={styles.backLink}>
            ← Retour
          </Link>
          <h1 className={styles.pageTitle}>Conservation et suppression des galeries</h1>
        </div>
        <div className={styles.headerActions}>
          <Link to="/admin/data-retention/settings" className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}>
            Paramètres de conservation
          </Link>
          <Link to="/admin/galleries" className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}>
            Gérer les galeries
          </Link>
        </div>
      </header>

      {/* Main Content (inert when modal is open) */}
      <main className={styles.content} inert={activeModal ? true : undefined}>
        {actionData?.success && actionData.message && (
          <div className={styles.alertSuccess} role="status">
            {actionData.message}
          </div>
        )}

        {actionData?.error && (
          <div className={styles.alertError} role="alert">
            {actionData.error}
          </div>
        )}

        {/* Overview cards */}
        <section className={styles.overviewGrid}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>Politique de conservation actuelle</span>
              <Link to="/admin/data-retention/settings" className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}>
                Modifier
              </Link>
            </div>
            <div className={styles.policyGrid}>
              <div className={styles.policyItem}>
                <span className={styles.policyLabel}>Purge automatique</span>
                <span className={styles.policyValue}>
                  {data.settings.enabled ? "Activée" : "Désactivée"}
                </span>
              </div>
              <div className={styles.policyItem}>
                <span className={styles.policyLabel}>Délai après expiration</span>
                <span className={styles.policyValue}>
                  {data.settings.retentionDays !== null
                    ? `${data.settings.retentionDays} jours`
                    : "Non configuré"}
                </span>
              </div>
              <div className={styles.policyItem}>
                <span className={styles.policyLabel}>Conservation du journal</span>
                <span className={styles.policyValue}>
                  {data.settings.logRetentionDays !== null
                    ? `${data.settings.logRetentionDays} jours`
                    : "Non configurée"}
                </span>
              </div>
              <div className={styles.policyItem}>
                <span className={styles.policyLabel}>Version de la politique</span>
                <span className={styles.policyValue}>Rév. {data.settings.revision}</span>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>
              <span>Nettoyage et tâches</span>
            </div>
            <div className={styles.jobsGrid}>
              <div className={styles.jobsStat}>
                <div className={styles.jobsStatNumber}>{data.deletionJobs.pending}</div>
                <div className={styles.jobsStatLabel}>En attente</div>
              </div>
              <div className={styles.jobsStat}>
                <div className={styles.jobsStatNumber}>{data.deletionJobs.processing}</div>
                <div className={styles.jobsStatLabel}>En cours</div>
              </div>
              <div className={styles.jobsStat}>
                <div className={styles.jobsStatNumber} style={{ color: data.deletionJobs.failed > 0 ? "#EF4444" : undefined }}>
                  {data.deletionJobs.failed}
                </div>
                <div className={styles.jobsStatLabel}>Échecs</div>
              </div>
            </div>

            {data.deletionJobs.failedJobs.length > 0 && (
              <div className={styles.failedJobsSection}>
                <span className={styles.policyLabel}>Tâches en échec à relancer :</span>
                {data.deletionJobs.failedJobs.map((job) => (
                  <div key={job.id} className={styles.failedJobRow}>
                    <div className={styles.failedJobInfo}>
                      <span className={styles.failedJobTitle}>{job.gallery_title || "Galerie"}</span>
                      <span className={styles.failedJobCode}>{job.error_code || "ERREUR_INCONNUE"}</span>
                    </div>
                    <Form method="post">
                      <input type="hidden" name="csrfToken" value={data.csrfToken} />
                      <input type="hidden" name="intent" value="retry_job" />
                      <input type="hidden" name="jobId" value={job.id} />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`${styles.btnAction} ${styles.btnActionExport}`}
                      >
                        Relancer
                      </button>
                    </Form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Toolbar: Search and Filter Tabs */}
        <div className={styles.toolbar}>
          <Form method="get" className={styles.searchForm}>
            <input type="hidden" name="filter" value={data.filter} />
            <input
              type="text"
              name="q"
              defaultValue={data.search}
              placeholder="Rechercher par titre, client, identifiant..."
              className={styles.searchInput}
            />
            <button type="submit" className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}>
              Filtrer
            </button>
            {data.search && (
              <Link
                to={`/admin/data-retention?filter=${data.filter}`}
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
              >
                Effacer
              </Link>
            )}
          </Form>

          <div className={styles.filterTabs}>
            {filterTabs.map((tab) => (
              <Link
                key={tab.id}
                to={`/admin/data-retention?filter=${tab.id}${data.search ? `&q=${encodeURIComponent(data.search)}` : ""}`}
                className={`${styles.filterTab} ${data.filter === tab.id ? styles.filterTabActive : ""}`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Bulk Action Bar (when galleries selected) */}
        {selectedIds.size > 0 && (
          <div className={styles.bulkBar}>
            <span className={styles.bulkInfo}>
              {selectedIds.size} galerie(s) sélectionnée(s) ({formatBytes(selectedTotalSize)})
            </span>
            <div className={styles.actionGroup}>
              <button
                type="button"
                onClick={() => openModal({ type: "bulk", galleries: selectedGalleries })}
                className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
              >
                Supprimer la sélection ({selectedIds.size})
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
              >
                Désélectionner
              </button>
            </div>
          </div>
        )}

        {/* Galleries Retention Table */}
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th} style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={data.items.length > 0 && selectedIds.size === data.items.length}
                    onChange={toggleSelectAll}
                    aria-label="Sélectionner toutes les galeries visibles"
                  />
                </th>
                <th className={styles.th}>Galerie / Client</th>
                <th className={styles.th}>Statut éditorial</th>
                <th className={styles.th}>Médias & Volume</th>
                <th className={styles.th}>Expiration client</th>
                <th className={styles.th}>Purge prévisionnelle</th>
                <th className={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.td} style={{ textAlign: "center", padding: "40px" }}>
                    Aucune galerie ne correspond aux critères de recherche.
                  </td>
                </tr>
              ) : (
                data.items.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <tr key={item.id} className={`${styles.tr} ${isSelected ? styles.rowSelected : ""}`}>
                      <td className={styles.td}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectGallery(item.id)}
                          aria-label={`Sélectionner ${item.title}`}
                        />
                      </td>
                      <td className={styles.td}>
                        <Link to={`/admin/galleries/${item.id}`} className={styles.galleryTitleLink}>
                          {item.title}
                        </Link>
                        <div className={styles.gallerySubtitle}>
                          {item.clientName} · Projet du {item.projectDate}
                        </div>
                        {item.knownImportFolders.length > 0 && (
                          <div className={styles.gallerySubtitle} style={{ fontSize: 11, color: "#5FB8FF" }}>
                            Source : gallery-import/{item.knownImportFolders.join(", ")}
                          </div>
                        )}
                      </td>
                      <td className={styles.td}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {item.status === "published" && <span className={`${styles.badge} ${styles.badgePublished}`}>Publiée</span>}
                          {item.status === "draft" && <span className={`${styles.badge} ${styles.badgeDraft}`}>Brouillon</span>}
                          {item.status === "archived" && <span className={`${styles.badge} ${styles.badgeArchived}`}>Archivée</span>}

                          {item.retentionExempt && (
                            <span className={`${styles.badge} ${styles.badgeExempt}`} title={item.retentionExemptReason || "Exemptée de purge"}>
                              Exemptée
                            </span>
                          )}
                          {item.activeImportCount > 0 && (
                            <span className={`${styles.badge} ${styles.badgeImporting}`}>
                              Import en cours
                            </span>
                          )}
                          {item.deletionErrorCode && (
                            <span className={`${styles.badge} ${styles.badgeError}`}>
                              Erreur nettoyage
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={styles.td}>
                        <div>{item.photoCount} photos, {item.videoCount} vidéos</div>
                        <div className={styles.gallerySubtitle}>{formatBytes(item.totalSize)}</div>
                      </td>
                      <td className={styles.td}>
                        <div>{formatDate(item.expiresAt)}</div>
                        {item.isExpired && (
                          <span className={`${styles.badge} ${styles.badgeExpired}`}>Expirée</span>
                        )}
                        {item.isExpiringSoon && (
                          <span className={`${styles.badge} ${styles.badgeSoon}`}>Expire bientôt</span>
                        )}
                      </td>
                      <td className={styles.td}>
                        {data.settings.retentionDays === null ? (
                          <span style={{ color: "#8A92A6" }}>Non configurée</span>
                        ) : item.retentionExempt ? (
                          <span style={{ color: "#D8B4FE" }}>Suspendue</span>
                        ) : item.scheduledPurgeAt ? (
                          <div>
                            <div>{formatDate(item.scheduledPurgeAt)}</div>
                            {item.isEligiblePurge && (
                              <span className={`${styles.badge} ${styles.badgePurgeDue}`}>
                                Purge due
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#8A92A6" }}>Non planifiée</span>
                        )}
                      </td>
                      <td className={styles.td}>
                        <div className={styles.actionGroup}>
                          {/* Export buttons */}
                          <Form method="post" action="/api/admin/data-retention/gallery-export">
                            <input type="hidden" name="csrfToken" value={data.csrfToken} />
                            <input type="hidden" name="galleryId" value={item.id} />
                            <input type="hidden" name="exportType" value="json" />
                            <button
                              type="submit"
                              className={`${styles.btnAction} ${styles.btnActionExport}`}
                              title="Télécharger l'inventaire structuré JSON"
                            >
                              JSON
                            </button>
                          </Form>

                          <Form method="post" action="/api/admin/data-retention/gallery-export">
                            <input type="hidden" name="csrfToken" value={data.csrfToken} />
                            <input type="hidden" name="galleryId" value={item.id} />
                            <input type="hidden" name="exportType" value="zip" />
                            <button
                              type="submit"
                              className={`${styles.btnAction} ${styles.btnActionExport}`}
                              title="Télécharger l'archive ZIP des originaux"
                            >
                              ZIP
                            </button>
                          </Form>

                          {/* Exemption toggle button */}
                          <button
                            type="button"
                            onClick={() => openModal({ type: "exempt", gallery: item })}
                            className={`${styles.btnAction} ${styles.btnActionExempt}`}
                            title={item.retentionExempt ? "Modifier ou lever l'exemption" : "Exempter de la purge"}
                          >
                            {item.retentionExempt ? "Exemptée" : "Exempter"}
                          </button>

                          {/* Delete button */}
                          <button
                            type="button"
                            onClick={() => openModal({ type: "single", gallery: item })}
                            className={`${styles.btnAction} ${styles.btnActionDelete}`}
                            title="Supprimer définitivement la galerie"
                          >
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data.totalPages > 1 && (
          <div className={styles.pagination}>
            <span className={styles.paginationText}>
              Page {data.page} sur {data.totalPages} ({data.total} galeries au total)
            </span>
            <div className={styles.paginationControls}>
              <Link
                to={`/admin/data-retention?page=${data.page - 1}&filter=${data.filter}${data.search ? `&q=${encodeURIComponent(data.search)}` : ""}`}
                className={styles.pageBtn}
                aria-disabled={data.page <= 1}
                tabIndex={data.page <= 1 ? -1 : undefined}
                style={{ pointerEvents: data.page <= 1 ? "none" : undefined, opacity: data.page <= 1 ? 0.4 : 1 }}
              >
                Précédent
              </Link>
              <Link
                to={`/admin/data-retention?page=${data.page + 1}&filter=${data.filter}${data.search ? `&q=${encodeURIComponent(data.search)}` : ""}`}
                className={styles.pageBtn}
                aria-disabled={data.page >= data.totalPages}
                tabIndex={data.page >= data.totalPages ? -1 : undefined}
                style={{ pointerEvents: data.page >= data.totalPages ? "none" : undefined, opacity: data.page >= data.totalPages ? 0.4 : 1 }}
              >
                Suivant
              </Link>
            </div>
          </div>
        )}

        {/* Manual cleanup notice for drop sources */}
        <div className={styles.sourceNotice}>
          <strong>Dossiers sources et copies externes :</strong>
          <p style={{ margin: "6px 0 0" }}>
            La suppression d'une galerie efface les médias gérés et révoque immédiatement tous les accès clients.
            Les fichiers déposés dans votre dossier visible d'importation (<code>gallery-import/&lt;projet&gt;/</code>)
            restent intacts sur votre Mac et ne sont jamais effacés par le service. Vous pouvez les supprimer manuellement
            selon vos besoins de stockage.
          </p>
        </div>
      </main>

      {/* Single Gallery Deletion Modal */}
      {activeModal && activeModal.type === "single" && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="modalSingleTitle">
          <div className={styles.modalDialog} ref={modalContainerRef}>
            <div className={styles.modalHeader}>
              <h2 id="modalSingleTitle" className={styles.modalTitle}>
                Supprimer la galerie
              </h2>
              <p className={styles.modalDescription}>
                Cette action est irréversible. Les accès clients seront révoqués immédiatement et tous les médias hébergés
                seront déplacés en quarantaine pour être définitivement effacés.
              </p>
            </div>

            <div className={styles.modalWarningBox}>
              <strong>Attention :</strong> La galerie « {activeModal.gallery.title} » contient {activeModal.gallery.photoCount} photos
              et {activeModal.gallery.videoCount} vidéos ({formatBytes(activeModal.gallery.totalSize)}).
            </div>

            <Form method="post">
              <input type="hidden" name="csrfToken" value={data.csrfToken} />
              <input type="hidden" name="intent" value="delete_single" />
              <input type="hidden" name="galleryId" value={activeModal.gallery.id} />
              <input type="hidden" name="expectedRevision" value={activeModal.gallery.revision} />

              <div className={styles.modalInputGroup}>
                <label htmlFor="confirmSingleInput" className={styles.modalInputLabel}>
                  Pour confirmer, saisissez exactement le nom de la galerie : <strong>« {activeModal.gallery.title} »</strong>
                </label>
                <input
                  id="confirmSingleInput"
                  ref={modalInputRef}
                  type="text"
                  name="confirmTitle"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  className={styles.modalInput}
                  autoComplete="off"
                  required
                />
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || confirmInput.trim() !== activeModal.gallery.title}
                  className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                >
                  {isSubmitting ? "Suppression en cours..." : "Confirmer la suppression"}
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}

      {/* Bulk Gallery Deletion Modal */}
      {activeModal && activeModal.type === "bulk" && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="modalBulkTitle">
          <div className={styles.modalDialog} ref={modalContainerRef}>
            <div className={styles.modalHeader}>
              <h2 id="modalBulkTitle" className={styles.modalTitle}>
                Suppression groupée ({activeModal.galleries.length} galeries)
              </h2>
              <p className={styles.modalDescription}>
                Vous êtes sur le point de supprimer simultanément {activeModal.galleries.length} galeries
                représentant un volume total estimé à {formatBytes(activeModal.galleries.reduce((acc, g) => acc + g.totalSize, 0))}.
              </p>
            </div>

            <div className={styles.modalSelectedList}>
              {activeModal.galleries.map((g) => (
                <div key={g.id} className={styles.modalSelectedListItem}>
                  <span>{g.title}</span>
                  <span style={{ color: "#8A92A6" }}>{formatBytes(g.totalSize)}</span>
                </div>
              ))}
            </div>

            <Form method="post">
              <input type="hidden" name="csrfToken" value={data.csrfToken} />
              <input type="hidden" name="intent" value="delete_bulk" />
              {activeModal.galleries.map((g) => (
                <span key={g.id}>
                  <input type="hidden" name="galleryIds" value={g.id} />
                  <input type="hidden" name={`rev_${g.id}`} value={g.revision} />
                </span>
              ))}

              <div className={styles.modalInputGroup}>
                <label htmlFor="confirmBulkInput" className={styles.modalInputLabel}>
                  Pour valider définitivement, tapez le mot <strong>SUPPRIMER</strong> en majuscules :
                </label>
                <input
                  id="confirmBulkInput"
                  ref={modalInputRef}
                  type="text"
                  name="confirmBulkText"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  className={styles.modalInput}
                  autoComplete="off"
                  placeholder="SUPPRIMER"
                  required
                />
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || confirmInput.trim() !== "SUPPRIMER"}
                  className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                >
                  {isSubmitting ? "Suppression en cours..." : `Supprimer les ${activeModal.galleries.length} galeries`}
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}

      {/* Exemption Modal */}
      {activeModal && activeModal.type === "exempt" && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="modalExemptTitle">
          <div className={styles.modalDialog} ref={modalContainerRef}>
            <div className={styles.modalHeader}>
              <h2 id="modalExemptTitle" className={styles.modalTitle} style={{ color: "#D8B4FE" }}>
                {activeModal.gallery.retentionExempt ? "Modifier l'exemption" : "Exempter de la purge automatique"}
              </h2>
              <p className={styles.modalDescription}>
                Une galerie exemptée n'est jamais supprimée par la politique automatique, même si son délai de conservation est dépassé.
              </p>
            </div>

            <Form method="post">
              <input type="hidden" name="csrfToken" value={data.csrfToken} />
              <input type="hidden" name="intent" value="toggle_exempt" />
              <input type="hidden" name="galleryId" value={activeModal.gallery.id} />
              <input type="hidden" name="expectedRevision" value={activeModal.gallery.revision} />

              <div className={styles.modalInputGroup}>
                <label className={styles.modalInputLabel}>Statut de l'exemption :</label>
                <select
                  name="exempt"
                  defaultValue={activeModal.gallery.retentionExempt ? "0" : "1"}
                  className={styles.modalInput}
                >
                  <option value="1">Exempter cette galerie (protéger contre la purge)</option>
                  <option value="0">Lever l'exemption (éligible à la purge normale)</option>
                </select>
              </div>

              <div className={styles.modalInputGroup}>
                <label htmlFor="exemptReasonInput" className={styles.modalInputLabel}>
                  Motif de l'exemption (facultatif, max 200 caractères) :
                </label>
                <input
                  id="exemptReasonInput"
                  ref={modalInputRef}
                  type="text"
                  name="reason"
                  defaultValue={activeModal.gallery.retentionExemptReason || ""}
                  maxLength={200}
                  placeholder="Ex : Prolongation contractuelle ou demande client"
                  className={styles.modalInput}
                />
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSubmitting}
                  className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
                >
                  {isSubmitting ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}
