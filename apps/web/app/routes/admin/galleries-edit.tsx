import { useState, useEffect, useRef, useCallback } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin, readStrictFormUrlEncoded } from "../../lib/security.server";
import {
  getGalleryById,
  getGalleryDecryptedCode,
  updateGallery,
  rotateGalleryCode,
  publishGallery,
  unpublishGallery,
  archiveGallery,
  setCoverPhoto,
  getGalleryMediaList,
  GalleryConflictError,
  GalleryValidationError,
  type Gallery,
  type GalleryMediaRow,
} from "../../lib/gallery.server";
import {
  deleteGalleryAndQuarantine,
  processGalleryDeletions,
  getGalleryDb,
} from "../../lib/gallery-db.server";
import {
  getAvailableImportFolders,
  type RejectedFileItem,
} from "../../lib/gallery-import.server";
import { ENV } from "../../lib/env.server";
import styles from "./galleries.module.css";

interface LoaderData {
  gallery: Gallery;
  accessCode: string;
  codeVersion: number;
  folders: string[];
  importRootPath: string;
  csrfToken: string;
  media: GalleryMediaRow[];
  activeImportJob: {
    id: string;
    status: string;
    progress_total: number;
    progress_current: number;
    error_message: string | null;
  } | null;
}

interface ActionData {
  error?: string;
  success?: string;
  intent?: string;
}

export function meta({ data }: { data?: LoaderData }) {
  const title = data?.gallery ? `Gérer ${data.gallery.title} | Parallax` : "Gérer la galerie | Parallax";
  return [
    { title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const gallery = getGalleryById(params.id || "");

  if (!gallery) {
    throw new Response("Galerie introuvable", { status: 404, headers: createAdminHeaders() });
  }

  const { code: accessCode, version: codeVersion } = getGalleryDecryptedCode(gallery.id);
  const folders = getAvailableImportFolders();
  const importRootPath = ENV.GALLERY_IMPORT_PATH;
  const csrfToken = session.get("csrfToken") || "";
  const media = getGalleryMediaList(gallery.id);

  const db = getGalleryDb();
  const activeJob = db.prepare(`
    SELECT id, status, progress_total, progress_current, error_message
    FROM gallery_import_jobs
    WHERE gallery_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(gallery.id) as LoaderData["activeImportJob"];

  return Response.json(
    {
      gallery,
      accessCode,
      codeVersion,
      folders,
      importRootPath,
      csrfToken,
      media,
      activeImportJob: activeJob || null,
    },
    { headers: createAdminHeaders() }
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const expectedCsrfToken = session.get("csrfToken") || "";

  if (request.method !== "POST") {
    const headers = createAdminHeaders();
    headers.set("Allow", "POST");
    return new Response("Method Not Allowed", {
      status: 405,
      headers,
    });
  }

  if (!validateOrigin(request)) {
    return Response.json({ error: "Origine invalide." }, { status: 403, headers: createAdminHeaders() });
  }

  let body: URLSearchParams;
  try {
    body = await readStrictFormUrlEncoded(request, 8192);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Payload Too Large") {
      return Response.json({ error: "Requête trop volumineuse." }, { status: 413, headers: createAdminHeaders() });
    }
    return Response.json({ error: "Format invalide." }, { status: 415, headers: createAdminHeaders() });
  }

  const formCsrf = body.get("csrfToken") || "";
  if (!formCsrf || !constantTimeEqual(formCsrf, expectedCsrfToken)) {
    return Response.json({ error: "Jeton CSRF invalide." }, { status: 403, headers: createAdminHeaders() });
  }

  const gallery = getGalleryById(params.id || "");
  if (!gallery) {
    return Response.json({ error: "Galerie introuvable." }, { status: 404, headers: createAdminHeaders() });
  }

  const intent = body.get("intent");

  try {
    if (intent === "update_info") {
      const revision = parseInt(body.get("revision") || "0", 10);
      const title = (body.get("title") || "").trim();
      const clientName = (body.get("clientName") || "").trim();
      const projectDate = (body.get("projectDate") || "").trim();
      const location = (body.get("location") || "").trim() || undefined;
      const introFr = (body.get("introFr") || "").trim() || undefined;
      const introEn = (body.get("introEn") || "").trim() || undefined;
      const signatureFr = (body.get("signatureFr") || "").trim() || undefined;
      const signatureEn = (body.get("signatureEn") || "").trim() || undefined;

      const expiresStr = (body.get("expiresAt") || "").trim();
      let expiresAt: number | null = null;
      if (expiresStr) {
        const d = new Date(expiresStr);
        if (!isNaN(d.getTime())) {
          expiresAt = d.getTime();
        }
      }

      updateGallery(gallery.id, revision, {
        title,
        clientName,
        projectDate,
        location,
        introFr,
        introEn,
        signatureFr,
        signatureEn,
        expiresAt,
      });

      return Response.json({ success: "Informations mises à jour avec succès.", intent }, { headers: createAdminHeaders() });
    }

    if (intent === "rotate_code") {
      const { code } = rotateGalleryCode(gallery.id);
      return Response.json({ success: `Nouveau code généré : ${code}. Les anciennes sessions ont été révoquées.`, intent }, { headers: createAdminHeaders() });
    }

    if (intent === "publish") {
      const revision = parseInt(body.get("revision") || "0", 10);
      const expiresStr = (body.get("expiresAt") || "").trim();
      let expiresAt = gallery.expires_at;

      if (expiresStr) {
        const d = new Date(expiresStr);
        if (!isNaN(d.getTime())) {
          expiresAt = d.getTime();
        }
      }

      if (!expiresAt || expiresAt <= Date.now()) {
        return Response.json(
          { error: "Pour publier la galerie, une date d'expiration future est obligatoire.", intent },
          { status: 400, headers: createAdminHeaders() }
        );
      }

      publishGallery(gallery.id, revision, expiresAt, gallery.cover_media_id);
      return Response.json({ success: "La galerie est maintenant publiée et accessible aux clients avec le code.", intent }, { headers: createAdminHeaders() });
    }

    if (intent === "unpublish") {
      const revision = parseInt(body.get("revision") || "0", 10);
      unpublishGallery(gallery.id, revision);
      return Response.json({ success: "La galerie a été dépubliée (statut brouillon). L'accès client est bloqué.", intent }, { headers: createAdminHeaders() });
    }

    if (intent === "archive") {
      const revision = parseInt(body.get("revision") || "0", 10);
      archiveGallery(gallery.id, revision);
      return Response.json({ success: "La galerie a été archivée. L'accès client est bloqué.", intent }, { headers: createAdminHeaders() });
    }

    if (intent === "set_cover") {
      const mediaId = (body.get("mediaId") || "").trim();
      const revision = parseInt(body.get("revision") || "0", 10);
      setCoverPhoto(gallery.id, mediaId, revision);
      return Response.json({ success: "Photo de couverture mise à jour.", intent }, { headers: createAdminHeaders() });
    }

    if (intent === "delete_gallery") {
      const confirmTitle = (body.get("confirmTitle") || "").trim();
      if (confirmTitle !== gallery.title) {
        return Response.json(
          { error: `Pour confirmer la suppression, vous devez saisir exactement le nom de la galerie : « ${gallery.title} ».`, intent },
          { status: 400, headers: createAdminHeaders() }
        );
      }

      deleteGalleryAndQuarantine(gallery.id);
      processGalleryDeletions();

      return redirect("/admin/galleries", {
        status: 303,
        headers: createAdminHeaders(),
      });
    }

    return Response.json({ error: "Action inconnue.", intent }, { status: 400, headers: createAdminHeaders() });
  } catch (err) {
    if (err instanceof GalleryConflictError) {
      return Response.json(
        { error: "Conflit de révision (409) : la galerie a été modifiée par une autre opération en arrière-plan. Vos modifications n'ont pas été écrasées.", intent },
        { status: 409, headers: createAdminHeaders() }
      );
    }
    if (err instanceof GalleryValidationError) {
      return Response.json({ error: err.message, intent }, { status: 400, headers: createAdminHeaders() });
    }
    return Response.json(
      { error: `Erreur inattendue: ${err instanceof Error ? err.message : String(err)}`, intent },
      { status: 500, headers: createAdminHeaders() }
    );
  }
}

export default function AdminGalleryEditPage() {
  const {
    gallery,
    accessCode,
    codeVersion,
    folders,
    importRootPath,
    csrfToken,
    media,
    activeImportJob,
  } = useLoaderData<LoaderData>();

  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSubmitting = navigation.state === "submitting";

  // Code reveal/copy state
  const [showCode, setShowCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Import root path copy state
  const [copiedImportPath, setCopiedImportPath] = useState(false);
  const [copyImportPathStatus, setCopyImportPathStatus] = useState<string | null>(null);

  const handleCopyImportPath = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(importRootPath);
        setCopiedImportPath(true);
        setCopyImportPathStatus("Chemin copié dans le presse-papiers.");
        setTimeout(() => {
          setCopiedImportPath(false);
          setCopyImportPathStatus(null);
        }, 3000);
      } else {
        setCopyImportPathStatus("Copie automatique non supportée par le navigateur. Copiez le chemin manuellement.");
      }
    } catch {
      setCopyImportPathStatus("Échec de la copie automatique. Copiez le chemin manuellement.");
    }
  };

  // Controlled editorial inputs state (preserves unsubmitted typing across imports/revalidations)
  const initialExpiresDateStr = gallery.expires_at
    ? new Date(gallery.expires_at).toISOString().split("T")[0]
    : "";

  const [title, setTitle] = useState(gallery.title);
  const [clientName, setClientName] = useState(gallery.client_name);
  const [projectDate, setProjectDate] = useState(gallery.project_date);
  const [location, setLocation] = useState(gallery.location || "");
  const [expiresAt, setExpiresAt] = useState(initialExpiresDateStr);
  const [introFr, setIntroFr] = useState(gallery.intro_fr || "");
  const [introEn, setIntroEn] = useState(gallery.intro_en || "");
  const [signatureFr, setSignatureFr] = useState(gallery.signature_fr || "");
  const [signatureEn, setSignatureEn] = useState(gallery.signature_en || "");

  // Accessible UI status and error notifications (replaces window.alert())
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; message: string } | null>(null);

  // Import state
  const [selectedFolder, setSelectedFolder] = useState(folders[0] || "");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{
    validPhotosCount: number;
    validVideosCount: number;
    totalSize: number;
    rejectedFiles: RejectedFileItem[];
  } | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(activeImportJob?.status || null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number }>({
    current: activeImportJob?.progress_current || 0,
    total: activeImportJob?.progress_total || 0,
  });

  // Video poster upload state
  const [posterUploadingId, setPosterUploadingId] = useState<string | null>(null);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");

  const copyCodeToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(accessCode);
      setCopiedCode(true);
      setFeedback({ type: "success", message: "Code d'accès copié dans le presse-papier." });
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      setFeedback({ type: "error", message: "Échec de la copie du code dans le presse-papier." });
    }
  };

  // Analyze import folder
  const handleAnalyzeFolder = async () => {
    if (!selectedFolder) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/galleries/${gallery.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          intent: "analyze",
          folderName: selectedFolder,
          csrfToken,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAnalysisResult(data.analysis);
      } else {
        const err = await res.json();
        setFeedback({ type: "error", message: err.error || "Erreur lors de l'analyse du dossier." });
      }
    } catch {
      setFeedback({ type: "error", message: "Erreur de connexion lors de l'analyse du dossier." });
    } finally {
      setAnalyzing(false);
    }
  };

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);

  // Poll import status without page reload, keeping user form inputs untouched
  const pollImportStatus = useCallback(
    (jobId: string) => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }

      pollTimerRef.current = setInterval(async () => {
        if (isPollingRef.current) return;
        isPollingRef.current = true;
        try {
          const res = await fetch(`/api/admin/galleries/${gallery.id}/imports/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            setImportStatus(data.status);
            setImportProgress({ current: data.progress_current, total: data.progress_total });

            if (data.status === "completed" || data.status === "failed") {
              if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
              }
              if (data.status === "completed") {
                setFeedback({ type: "success", message: "Importation terminée avec succès." });
              } else {
                setFeedback({ type: "error", message: data.error_message || "L'importation a échoué." });
              }
              revalidator.revalidate();
            }
          }
        } catch {
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        } finally {
          isPollingRef.current = false;
        }
      }, 1500);
    },
    [gallery.id, revalidator]
  );

  // Resume tracking an already active import job on mount and clean up on unmount
  useEffect(() => {
    if (activeImportJob && (activeImportJob.status === "importing" || activeImportJob.status === "pending")) {
      pollImportStatus(activeImportJob.id);
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [activeImportJob?.id, activeImportJob?.status, pollImportStatus]);

  // Start import
  const handleStartImport = async () => {
    if (!selectedFolder) return;
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/galleries/${gallery.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          intent: "start",
          folderName: selectedFolder,
          csrfToken,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setImportStatus("importing");
        pollImportStatus(data.jobId);
      } else {
        const err = await res.json();
        setFeedback({ type: "error", message: err.error || "Impossible de démarrer l'importation." });
      }
    } catch {
      setFeedback({ type: "error", message: "Erreur de connexion lors du démarrage de l'import." });
    }
  };

  // Video poster upload without page reload
  const handlePosterUpload = async (mediaId: string, file: File) => {
    setPosterUploadingId(mediaId);
    setFeedback(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("csrfToken", csrfToken);

    try {
      const res = await fetch(`/api/admin/galleries/${gallery.id}/media/${mediaId}/poster`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setFeedback({ type: "success", message: "Poster vidéo mis à jour avec succès." });
        revalidator.revalidate();
      } else {
        const err = await res.json();
        setFeedback({ type: "error", message: err.error || "Échec du téléversement du poster." });
      }
    } catch {
      setFeedback({ type: "error", message: "Erreur réseau lors du téléversement du poster." });
    } finally {
      setPosterUploadingId(null);
    }
  };

  const photos = media.filter((m) => m.media_type === "photo");
  const videos = media.filter((m) => m.media_type === "video");

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin/galleries" className={styles.backLink}>
            ← Galeries
          </Link>
          <h1 className={styles.pageTitle}>{gallery.title}</h1>
          <span
            className={`${styles.statusPill} ${
              gallery.status === "published"
                ? styles.statusPublished
                : gallery.status === "archived"
                ? styles.statusArchived
                : styles.statusDraft
            }`}
          >
            {gallery.status === "published"
              ? "Publiée"
              : gallery.status === "archived"
              ? "Archivée"
              : "Brouillon"}
          </span>
        </div>

        <div className={styles.headerActions}>
          <Link
            to={`/admin/galleries/${gallery.id}/preview`}
            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
          >
            👁️ Prévisualiser
          </Link>
          {gallery.status === "published" && (
            <Link
              to={`/fr/galerie/${gallery.public_id}`}
              target="_blank"
              rel="noreferrer"
              className={`${styles.btn} ${styles.btnSmall} ${styles.btnSecondaryAccent}`}
            >
              Lien client ↗
            </Link>
          )}
        </div>
      </header>

      <main className={styles.content}>
        {feedback && (
          <div
            className={feedback.type === "success" ? styles.alertSuccess : styles.alertError}
            role={feedback.type === "success" ? "status" : "alert"}
          >
            {feedback.message}
          </div>
        )}

        {actionData?.success && (
          <div className={styles.alertSuccess} role="status">
            {actionData.success}
          </div>
        )}

        {actionData?.error && (
          <div className={styles.alertError} role="alert">
            {actionData.error}
          </div>
        )}

        {/* Access Code Box */}
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>
            <span>Code d'accès unique client</span>
            <span className={styles.codeMeta}>Version : v{codeVersion}</span>
          </h2>

          {gallery.status !== "published" && (
            <div className={styles.alertWarning} role="alert">
              <strong>Code inactif :</strong> cette galerie est actuellement en statut « {gallery.status === "draft" ? "Brouillon" : "Archivée"} ». Le code d'accès restera inactif sur l'espace client tant que la galerie n'est pas publiée (nécessite au moins 1 média prêt et une date d'expiration valide).
            </div>
          )}

          <div className={styles.codeBox}>
            <div>
              <div className={styles.codeDisplay}>
                {showCode ? accessCode : "•••••••••••••••••••••"}
              </div>
              <p className={`${styles.codeMeta} ${styles.codeMetaTop6}`}>
                Ce code unique donne accès à la galerie. Le renouveler révoque immédiatement tous les anciens accès.
              </p>
            </div>

            <div className={styles.rowGap10}>
              <button
                type="button"
                onClick={() => setShowCode(!showCode)}
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
              >
                {showCode ? "Masquer" : "Révéler"}
              </button>

              <button
                type="button"
                onClick={copyCodeToClipboard}
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
              >
                {copiedCode ? "Copié !" : "Copier"}
              </button>

              <Form method="post">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="intent" value="rotate_code" />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                  onClick={(e) => {
                    if (!confirm("Attention : renouveler le code va invalider immédiatement les sessions clients actives. Continuer ?")) {
                      e.preventDefault();
                    }
                  }}
                >
                  Régénérer le code
                </button>
              </Form>
            </div>
          </div>
        </section>

        {/* Publication Status & Actions */}
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>Publication et accès</h2>
          <p className={`${styles.codeMeta} ${styles.codeMetaBottom16}`}>
            {gallery.status === "published"
              ? "La galerie est actuellement en ligne. Les clients peuvent y accéder avec leur code."
              : gallery.status === "archived"
              ? "La galerie est archivée. L'accès client est désactivé."
              : "La galerie est en brouillon. Pour la publier, elle doit contenir au moins un média prêt et une date d'expiration future."}
          </p>

          <div className={styles.rowGap12Wrap}>
            {gallery.status !== "published" && (
              <Form method="post">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="intent" value="publish" />
                <input type="hidden" name="revision" value={gallery.revision} />
                <input type="hidden" name="expiresAt" value={expiresAt} />
                <button
                  type="submit"
                  disabled={isSubmitting || media.length === 0}
                  className={`${styles.btn} ${styles.btnPrimary}`}
                >
                  Publier la galerie
                </button>
              </Form>
            )}

            {gallery.status === "published" && (
              <Form method="post">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="intent" value="unpublish" />
                <input type="hidden" name="revision" value={gallery.revision} />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`${styles.btn} ${styles.btnSecondary}`}
                >
                  Dépublier (remettre en brouillon)
                </button>
              </Form>
            )}

            {gallery.status !== "archived" && (
              <Form method="post">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="intent" value="archive" />
                <input type="hidden" name="revision" value={gallery.revision} />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`${styles.btn} ${styles.btnSecondary}`}
                >
                  Archiver
                </button>
              </Form>
            )}
          </div>
        </section>

        {/* Editorial Metadata Form */}
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>
            <span>Informations éditoriales</span>
            <span className={styles.codeMeta}>Révision : r{gallery.revision}</span>
          </h2>

          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="intent" value="update_info" />
            <input type="hidden" name="revision" value={gallery.revision} />

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label htmlFor="title" className={styles.label}>
                  Titre du projet *
                </label>
                <input
                  id="title"
                  name="title"
                  type="text"
                  required
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="clientName" className={styles.label}>
                  Nom du client ou artiste *
                </label>
                <input
                  id="clientName"
                  name="clientName"
                  type="text"
                  required
                  maxLength={100}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="projectDate" className={styles.label}>
                  Date du projet *
                </label>
                <input
                  id="projectDate"
                  name="projectDate"
                  type="date"
                  required
                  value={projectDate}
                  onChange={(e) => setProjectDate(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="location" className={styles.label}>
                  Lieu (facultatif)
                </label>
                <input
                  id="location"
                  name="location"
                  type="text"
                  maxLength={100}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="expiresAt" className={styles.label}>
                  Date d'expiration d'accès
                </label>
                <input
                  id="expiresAt"
                  name="expiresAt"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={`${styles.formGroup} ${styles.formFullWidth}`}>
                <label htmlFor="introFr" className={styles.label}>
                  Texte d'introduction (FR)
                </label>
                <textarea
                  id="introFr"
                  name="introFr"
                  rows={3}
                  value={introFr}
                  onChange={(e) => setIntroFr(e.target.value)}
                  className={styles.textarea}
                />
              </div>

              <div className={`${styles.formGroup} ${styles.formFullWidth}`}>
                <label htmlFor="introEn" className={styles.label}>
                  Texte d'introduction (EN)
                </label>
                <textarea
                  id="introEn"
                  name="introEn"
                  rows={3}
                  value={introEn}
                  onChange={(e) => setIntroEn(e.target.value)}
                  className={styles.textarea}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="signatureFr" className={styles.label}>
                  Signature (FR)
                </label>
                <input
                  id="signatureFr"
                  name="signatureFr"
                  type="text"
                  value={signatureFr}
                  onChange={(e) => setSignatureFr(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="signatureEn" className={styles.label}>
                  Signature (EN)
                </label>
                <input
                  id="signatureEn"
                  name="signatureEn"
                  type="text"
                  value={signatureEn}
                  onChange={(e) => setSignatureEn(e.target.value)}
                  className={styles.input}
                />
              </div>
            </div>

            <div className={styles.boxTop20}>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`${styles.btn} ${styles.btnPrimary}`}
              >
                {isSubmitting ? "Enregistrement..." : "Enregistrer les modifications"}
              </button>
            </div>
          </Form>
        </section>

        {/* Media Import Section */}
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>
            <span>Importation depuis un dossier contrôlé</span>
          </h2>

          <div className={styles.importPathCard}>
            <div className={styles.pathRow}>
              <code className={styles.pathCode}>{importRootPath}</code>
              <button
                type="button"
                onClick={handleCopyImportPath}
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                aria-label="Copier le chemin absolu du dossier d'import"
              >
                {copiedImportPath ? "✓ Chemin copié" : "Copier le chemin"}
              </button>
            </div>
            {copyImportPathStatus && (
              <p role="status" className={styles.copyStatusNotice}>
                {copyImportPathStatus}
              </p>
            )}
            <p className={styles.pathInstruction}>
              <strong>Organisation :</strong> créez un sous-dossier par galerie (ex. <code>mariage-alice-bob/</code>) contenant un dossier <code>photos/</code> pour les images et un dossier <code>videos/</code> pour les films.
            </p>
            <p className={styles.pathInstruction}>
              <strong>Astuce Finder (Mac) :</strong> ouvrez le Finder, appuyez sur <kbd>⌘ Cmd</kbd> + <kbd>Maj ⇧</kbd> + <kbd>G</kbd> (Aller au dossier...), collez le chemin ci-dessus et validez.
            </p>
          </div>

          <div className={styles.rowGap12Align} style={{ marginTop: "16px" }}>
            <select
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              className={`${styles.select} ${styles.selectMaxWidth}`}
            >
              {folders.length === 0 && <option value="">Aucun sous-dossier disponible</option>}
              {folders.map((f) => (
                <option key={f} value={f}>
                  📁 {f}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={analyzing || !selectedFolder}
              onClick={handleAnalyzeFolder}
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
            >
              {analyzing ? "Analyse..." : "Analyser le dossier"}
            </button>

            <button
              type="button"
              disabled={!selectedFolder || importStatus === "importing"}
              onClick={handleStartImport}
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
            >
              {importStatus === "importing" ? "Importation en cours..." : "Démarrer l'import"}
            </button>
          </div>

          {/* Import Progress Bar */}
          {importStatus === "importing" && (
            <div className={styles.boxTop16}>
              <div className={styles.progressInfo}>
                <span>Progression de l'import :</span>
                <span>
                  {importProgress.current} / {importProgress.total} fichiers
                </span>
              </div>
              <progress
                value={importProgress.current}
                max={importProgress.total}
                className={styles.progressBar}
              />
            </div>
          )}

          {/* Analysis Result Box */}
          {analysisResult && (
            <div className={styles.analysisResults}>
              <h3 className={styles.analysisTitle}>
                Résultat de l'analyse préalable :
              </h3>
              <p className={styles.analysisStat}>
                📷 Photos valides : <strong>{analysisResult.validPhotosCount}</strong>
              </p>
              <p className={styles.analysisStat}>
                🎬 Vidéos valides : <strong>{analysisResult.validVideosCount}</strong>
              </p>
              <p className={styles.analysisStat}>
                📦 Poids total : <strong>{(analysisResult.totalSize / 1024 / 1024).toFixed(1)} Mo</strong>
              </p>

              {analysisResult.rejectedFiles.length > 0 && (
                <div className={styles.rejectedBox}>
                  <p className={styles.rejectedTitle}>
                    ⚠️ {analysisResult.rejectedFiles.length} fichier(s) rejeté(s) :
                  </p>
                  <ul className={styles.rejectedList}>
                    {analysisResult.rejectedFiles.map((r, i) => (
                      <li key={i}>
                        <code>{r.file}</code> : {r.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Media Management (Cover Photo & Video Posters) */}
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>
            <span>Médias de la galerie ({media.length})</span>
            <span className={styles.codeMeta}>
              {photos.length} photo{photos.length > 1 ? "s" : ""} · {videos.length} vidéo{videos.length > 1 ? "s" : ""}
            </span>
          </h2>

          {/* Videos with Poster Upload */}
          {videos.length > 0 && (
            <div className={styles.sectionGap32}>
              <h3 className={styles.sectionSubHeading}>
                Films et posters vidéo
              </h3>
              <div className={styles.videoList}>
                {videos.map((vid) => (
                  <div key={vid.id} className={styles.videoCard}>
                    <div>
                      <strong className={styles.videoTitle}>
                        🎬 {vid.original_filename}
                      </strong>
                      <span className={styles.codeMeta}>
                        Poster : {vid.poster_revision > 0 ? `Défini (rev ${vid.poster_revision})` : "Aucun poster"} · MIME : {vid.mime_type}
                      </span>
                    </div>

                    <div className={styles.rowGap10}>
                      <label className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall} ${styles.cursorPointer}`}>
                        {posterUploadingId === vid.id ? "Téléversement..." : "Changer le poster"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif"
                          className={styles.fileInputHidden}
                          disabled={posterUploadingId === vid.id}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePosterUpload(vid.id, file);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Photos and Cover Selection */}
          {photos.length > 0 && (
            <div>
              <h3 className={styles.sectionSubHeading}>
                Photos (cliquez pour définir comme photo de couverture)
              </h3>
              <div className={styles.mediaGrid}>
                {photos.map((p) => {
                  const isCover = gallery.cover_media_id === p.id;
                  return (
                    <div key={p.id} className={styles.mediaThumbCard}>
                      {isCover && <span className={styles.coverBadge}>Couverture</span>}
                      <img
                        src={`/api/gallery/${gallery.public_id}/media/${p.id}?width=480&format=webp`}
                        alt={p.original_filename}
                        loading="lazy"
                        className={styles.mediaThumbImg}
                      />
                      <div className={styles.mediaThumbMeta}>{p.original_filename}</div>
                      {!isCover && (
                        <Form method="post" className={styles.formPadding}>
                          <input type="hidden" name="csrfToken" value={csrfToken} />
                          <input type="hidden" name="intent" value="set_cover" />
                          <input type="hidden" name="mediaId" value={p.id} />
                          <input type="hidden" name="revision" value={gallery.revision} />
                          <button
                            type="submit"
                            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall} ${styles.fullWidthSmall}`}
                          >
                            Choisir comme couverture
                          </button>
                        </Form>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Danger Zone: Delete Gallery */}
        <section className={`${styles.sectionCard} ${styles.dangerZone}`}>
          <h2 className={`${styles.sectionTitle} ${styles.dangerTitle}`}>
            Zone de danger : Supprimer la galerie
          </h2>
          <p className={`${styles.codeMeta} ${styles.codeMetaBottom16}`}>
            La suppression déplace immédiatement tous les fichiers médias en quarantaine transactionnelle et supprime la galerie de la base de données. Cette action est irréversible.
          </p>

          {!showDeleteModal ? (
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className={`${styles.btn} ${styles.btnDanger}`}
            >
              Supprimer cette galerie...
            </button>
          ) : (
            <div className={styles.dangerWarningBox}>
              <p className={styles.dangerWarningText}>
                Veuillez saisir le nom exact de la galerie pour confirmer la suppression :
                <br />
                <strong>{gallery.title}</strong>
              </p>

              <Form method="post">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="intent" value="delete_gallery" />

                <input
                  type="text"
                  name="confirmTitle"
                  value={deleteConfirmationText}
                  onChange={(e) => setDeleteConfirmationText(e.target.value)}
                  placeholder="Tapez le nom de la galerie"
                  className={`${styles.input} ${styles.codeMetaBottom16}`}
                  autoComplete="off"
                />

                <div className={styles.rowGap10}>
                  <button
                    type="submit"
                    disabled={deleteConfirmationText !== gallery.title || isSubmitting}
                    className={`${styles.btn} ${styles.btnDanger}`}
                  >
                    Confirmer la suppression définitive
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteModal(false);
                      setDeleteConfirmationText("");
                    }}
                    className={`${styles.btn} ${styles.btnSecondary}`}
                  >
                    Annuler
                  </button>
                </div>
              </Form>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
