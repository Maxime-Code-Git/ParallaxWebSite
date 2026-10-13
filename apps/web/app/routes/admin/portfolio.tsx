import { useState } from "react";
import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  type HeadersArgs,
  type MetaFunction,
  Form,
  Link,
  useLoaderData,
  useActionData,
  useNavigation,
} from "react-router";
import * as crypto from "node:crypto";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import { validateOrigin } from "../../lib/security.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { commitSession } from "../../lib/session.server";
import {
  getRawPortfolioContent,
  savePortfolioContent,
  cleanupUnreferencedPortfolioMedia,
} from "../../lib/portfolio-content.server";
import {
  type PortfolioCategory,
  type PortfolioProject,
  type PortfolioContent,
  PORTFOLIO_CATEGORIES,
} from "../../lib/portfolio-content.shared";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import { RevisionConflictError, ValidationError } from "../../lib/site-content.server";
import styles from "./portfolio.module.css";

export const meta: MetaFunction = () => {
  return [
    { title: "Gestion du Portfolio | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
};

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const responseHeaders = createAdminHeaders();

  let csrfToken = session.get("csrfToken");
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    session.set("csrfToken", csrfToken);
    responseHeaders.set("Set-Cookie", await commitSession(session));
  }

  const { content } = getRawPortfolioContent();

  return Response.json(
    {
      content,
      csrfToken,
    },
    { headers: responseHeaders }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await requireValidAdminSession(request);

  if (!validateOrigin(request)) {
    return Response.json({ error: "Origine non autorisée." }, { status: 403, headers: createAdminHeaders() });
  }

  const formData = await request.formData();
  const csrfToken = formData.get("csrfToken");
  const sessionCsrf = session.get("csrfToken");

  if (!csrfToken || !sessionCsrf || !constantTimeEqual(String(csrfToken), sessionCsrf)) {
    return Response.json({ error: "Jeton CSRF invalide ou expiré." }, { status: 403, headers: createAdminHeaders() });
  }

  const intent = formData.get("intent");
  const expectedRevision = String(formData.get("revision") || "");

  const { content } = getRawPortfolioContent();
  const nextContent = JSON.parse(JSON.stringify(content));

  try {
    if (intent === "create") {
      const category = String(formData.get("category") || "documentary") as PortfolioCategory;
      if (!PORTFOLIO_CATEGORIES.includes(category)) {
        return Response.json({ error: "Catégorie invalide." }, { status: 400, headers: createAdminHeaders() });
      }

      const newId = crypto.randomUUID();
      const uniqueSuffix = Date.now().toString(36);
      const newOrder = nextContent.projects.filter((p: PortfolioProject) => p.category === category).length;

      const newProject: PortfolioProject = {
        id: newId,
        category,
        slugFr: `nouveau-projet-${uniqueSuffix}`,
        slugEn: `new-project-${uniqueSuffix}`,
        title: {
          fr: "Nouveau projet",
          en: "New project",
        },
        summary: {
          fr: "Résumé du projet en quelques lignes.",
          en: "Project summary in a few lines.",
        },
        description: [
          {
            type: "paragraph",
            text: {
              fr: "Description détaillée du projet.",
              en: "Detailed description of the project.",
            },
          },
        ],
        seo: {
          title: {
            fr: "Nouveau projet — Parallax",
            en: "New project — Parallax",
          },
          description: {
            fr: "Découvrez cette réalisation du studio Parallax.",
            en: "Discover this project by Parallax studio.",
          },
        },
        coverImageId: null,
        coverAlt: {
          fr: "Visuel du projet",
          en: "Project visual",
        },
        galleryImageIds: [],
        video: null,
        showcase: false,
        side: "auto",
        order: newOrder,
        status: "draft",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      nextContent.projects.push(newProject);
      const saveResult = await savePortfolioContent(nextContent, expectedRevision);

      return Response.json(
        { success: "Nouveau projet créé en brouillon avec succès.", createdId: newId, newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "toggle_status") {
      const projectId = String(formData.get("projectId") || "");
      const project = nextContent.projects.find((p: PortfolioProject) => p.id === projectId);
      if (!project) {
        return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      project.status = project.status === "published" ? "draft" : "published";
      project.updatedAt = Date.now();

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        {
          success: `Statut du projet mis à jour (${project.status === "published" ? "Publié" : "Brouillon"}).`,
          newRevision: saveResult.newRevision,
        },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "toggle_archive") {
      const projectId = String(formData.get("projectId") || "");
      const project = nextContent.projects.find((p: PortfolioProject) => p.id === projectId);
      if (!project) {
        return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      project.archived = !project.archived;
      project.updatedAt = Date.now();

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        { success: `Projet ${project.archived ? "archivé" : "restauré"}.`, newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "delete") {
      const projectId = String(formData.get("projectId") || "");
      const index = nextContent.projects.findIndex((p: PortfolioProject) => p.id === projectId);
      if (index === -1) {
        return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      nextContent.projects.splice(index, 1);
      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      void cleanupUnreferencedPortfolioMedia().catch(() => undefined);

      return Response.json(
        { success: "Projet supprimé définitivement.", newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "reorder") {
      const projectId = String(formData.get("projectId") || "");
      const direction = String(formData.get("direction") || "");
      const project = nextContent.projects.find((p: PortfolioProject) => p.id === projectId);
      if (!project) {
        return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      const sameCatProjects = nextContent.projects
        .filter((p: PortfolioProject) => p.category === project.category)
        .sort((a: PortfolioProject, b: PortfolioProject) => a.order - b.order);

      const currentIndex = sameCatProjects.findIndex((p: PortfolioProject) => p.id === projectId);
      if (direction === "up" && currentIndex > 0) {
        const prev = sameCatProjects[currentIndex - 1];
        const tempOrder = project.order;
        project.order = prev.order;
        prev.order = tempOrder;
      } else if (direction === "down" && currentIndex < sameCatProjects.length - 1) {
        const next = sameCatProjects[currentIndex + 1];
        const tempOrder = project.order;
        project.order = next.order;
        next.order = tempOrder;
      }

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        { success: "Ordre mis à jour.", newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    return Response.json({ error: "Action non reconnue." }, { status: 400, headers: createAdminHeaders() });
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      return Response.json({ error: err.message }, { status: 409, headers: createAdminHeaders() });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 422, headers: createAdminHeaders() });
    }
    return Response.json(
      { error: "Une erreur inattendue est survenue." },
      { status: 500, headers: createAdminHeaders() }
    );
  }
}

interface LoaderData {
  content: PortfolioContent;
  csrfToken: string;
}

export default function AdminPortfolioPage() {
  const { content, csrfToken } = useLoaderData<LoaderData>();
  const actionData = useActionData<{ error?: string; success?: string; createdId?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectToDelete, setProjectToDelete] = useState<PortfolioProject | null>(null);

  const filteredProjects = content.projects
    .filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (statusFilter === "published" && (p.status !== "published" || p.archived)) return false;
      if (statusFilter === "draft" && (p.status !== "draft" || p.archived)) return false;
      if (statusFilter === "archived" && !p.archived) return false;
      return true;
    })
    .sort((a, b) => a.order - b.order);

  return (
    <div className={styles.container}>
      <Link to="/admin/dashboard" className={styles.backLink}>
        ← Retour au tableau de bord
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Gestion du Portfolio</h1>
          <p style={{ margin: "8px 0 0", color: "#8A92A6", fontSize: "15px" }}>
            Administrez vos réalisations, rubriques, médias et mise en page du portfolio.
          </p>
        </div>

        <div className={styles.headerActions}>
          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="revision" value={content.revision} />
            <input type="hidden" name="intent" value="create" />
            <input
              type="hidden"
              name="category"
              value={categoryFilter === "advertising" ? "advertising" : "documentary"}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className={styles.primaryBtn}
            >
              + Nouveau projet
            </button>
          </Form>
        </div>
      </div>

      {actionData?.success && (
        <div className={styles.alertSuccess} role="status">
          {actionData.success}
          {actionData.createdId && (
            <Link
              to={`/admin/portfolio/${actionData.createdId}`}
              style={{ marginLeft: 12, color: "#2ed573", textDecoration: "underline" }}
            >
              Ouvrir le projet →
            </Link>
          )}
        </div>
      )}

      {actionData?.error && (
        <div className={styles.alertError} role="alert">
          {actionData.error}
        </div>
      )}

      {/* Sections Overview Cards */}
      <div className={styles.sectionsGrid}>
        <div className={styles.sectionCard}>
          <div>
            <h2 className={styles.sectionCardTitle}>Rubrique Documentaire</h2>
            <p className={styles.sectionCardDesc}>
              Textes d'introduction, bannières, showreel et boutons de la rubrique.
            </p>
          </div>
          <Link
            to="/admin/portfolio/section/documentary"
            className={styles.secondaryBtn}
          >
            Éditer la rubrique →
          </Link>
        </div>

        <div className={styles.sectionCard}>
          <div>
            <h2 className={styles.sectionCardTitle}>Rubrique Publicité</h2>
            <p className={styles.sectionCardDesc}>
              Textes d'introduction, bannières, showreel et boutons de la rubrique.
            </p>
          </div>
          <Link
            to="/admin/portfolio/section/advertising"
            className={styles.secondaryBtn}
          >
            Éditer la rubrique →
          </Link>
        </div>
      </div>

      {/* Filter controls */}
      <div className={styles.filtersBar}>
        <div className={styles.filterGroup}>
          <span style={{ fontSize: 13, color: "#8A92A6", marginRight: 8 }}>Rubrique :</span>
          <button
            type="button"
            className={`${styles.filterBtn} ${categoryFilter === "all" ? styles.filterBtnActive : ""}`}
            onClick={() => setCategoryFilter("all")}
          >
            Toutes
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${categoryFilter === "documentary" ? styles.filterBtnActive : ""}`}
            onClick={() => setCategoryFilter("documentary")}
          >
            Documentaire ({content.projects.filter((p) => p.category === "documentary").length})
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${categoryFilter === "advertising" ? styles.filterBtnActive : ""}`}
            onClick={() => setCategoryFilter("advertising")}
          >
            Publicité ({content.projects.filter((p) => p.category === "advertising").length})
          </button>
        </div>

        <div className={styles.filterGroup}>
          <span style={{ fontSize: 13, color: "#8A92A6", marginRight: 8 }}>Statut :</span>
          <button
            type="button"
            className={`${styles.filterBtn} ${statusFilter === "all" ? styles.filterBtnActive : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            Tous
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${statusFilter === "published" ? styles.filterBtnActive : ""}`}
            onClick={() => setStatusFilter("published")}
          >
            Publiés
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${statusFilter === "draft" ? styles.filterBtnActive : ""}`}
            onClick={() => setStatusFilter("draft")}
          >
            Brouillons
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${statusFilter === "archived" ? styles.filterBtnActive : ""}`}
            onClick={() => setStatusFilter("archived")}
          >
            Archivés
          </button>
        </div>
      </div>

      {/* Projects Table */}
      {filteredProjects.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: "#8A92A6" }}>
          Aucun projet ne correspond aux filtres sélectionnés.
        </div>
      ) : (
        <table className={styles.projectsTable}>
          <thead>
            <tr style={{ color: "#8A92A6", fontSize: 12, textAlign: "left" }}>
              <th style={{ padding: "0 20px 12px" }}>Aperçu</th>
              <th style={{ padding: "0 20px 12px" }}>Titre & Slugs</th>
              <th style={{ padding: "0 20px 12px" }}>Rubrique</th>
              <th style={{ padding: "0 20px 12px" }}>Statut</th>
              <th style={{ padding: "0 20px 12px" }}>Présentation</th>
              <th style={{ padding: "0 20px 12px", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map((p, idx) => (
              <tr key={p.id} className={styles.tableRow}>
                <td className={styles.tableCell} style={{ width: 80 }}>
                  {p.coverImageId ? (
                    <ResponsivePortfolioImage
                      imageId={p.coverImageId}
                      ownerType="project"
                      ownerId={p.id}
                      mediaSlot="cover"
                      mediaMetadata={content.media[p.coverImageId]}
                      alt={p.title.fr}
                      className={styles.projectThumb}
                      isAdminPreview
                    />
                  ) : (
                    <div className={styles.projectThumb} />
                  )}
                </td>

                <td className={styles.tableCell}>
                  <div className={styles.projectTitleCell}>{p.title.fr}</div>
                  <div style={{ fontSize: 13, color: "#8A92A6" }}>{p.title.en}</div>
                  <div style={{ fontSize: 11, color: "#546076", marginTop: 4 }}>
                    FR: /{p.category === "documentary" ? "documentaire" : "publicite"}/{p.slugFr} | EN: /{p.category}/{p.slugEn}
                  </div>
                </td>

                <td className={styles.tableCell}>
                  <span className={styles.projectCategoryCell}>
                    {p.category === "documentary" ? "Documentaire" : "Publicité"}
                  </span>
                </td>

                <td className={styles.tableCell}>
                  {p.archived ? (
                    <span className={styles.badgeArchived}>Archivé</span>
                  ) : p.status === "published" ? (
                    <span className={styles.badgePublished}>Publié</span>
                  ) : (
                    <span className={styles.badgeDraft}>Brouillon</span>
                  )}
                </td>

                <td className={styles.tableCell}>
                  {p.showcase ? (
                    <span style={{ fontSize: 13, color: "#1E9EFF" }}>
                      Oui ({p.side === "auto" ? "Alternance auto" : p.side === "left" ? "Gauche" : "Droite"})
                    </span>
                  ) : (
                    <span style={{ fontSize: 13, color: "#8A92A6" }}>Non</span>
                  )}
                </td>

                <td className={styles.tableCell}>
                  <div className={styles.rowActions}>
                    {/* Reorder buttons */}
                    <div className={styles.orderControls}>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="revision" value={content.revision} />
                        <input type="hidden" name="intent" value="reorder" />
                        <input type="hidden" name="projectId" value={p.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button
                          type="submit"
                          disabled={idx === 0 || isSubmitting}
                          className={styles.orderBtn}
                          aria-label={`Monter le projet ${p.title.fr}`}
                        >
                          ↑
                        </button>
                      </Form>

                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="revision" value={content.revision} />
                        <input type="hidden" name="intent" value="reorder" />
                        <input type="hidden" name="projectId" value={p.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          type="submit"
                          disabled={idx === filteredProjects.length - 1 || isSubmitting}
                          className={styles.orderBtn}
                          aria-label={`Descendre le projet ${p.title.fr}`}
                        >
                          ↓
                        </button>
                      </Form>
                    </div>

                    <Link to={`/admin/portfolio/${p.id}`} className={styles.actionBtn}>
                      Éditer
                    </Link>

                    {/* Publish/unpublish */}
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="csrfToken" value={csrfToken} />
                      <input type="hidden" name="revision" value={content.revision} />
                      <input type="hidden" name="intent" value="toggle_status" />
                      <input type="hidden" name="projectId" value={p.id} />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className={styles.actionBtn}
                      >
                        {p.status === "published" ? "Dépublier" : "Publier"}
                      </button>
                    </Form>

                    {/* Archive toggle */}
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="csrfToken" value={csrfToken} />
                      <input type="hidden" name="revision" value={content.revision} />
                      <input type="hidden" name="intent" value="toggle_archive" />
                      <input type="hidden" name="projectId" value={p.id} />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className={styles.actionBtn}
                      >
                        {p.archived ? "Désarchiver" : "Archiver"}
                      </button>
                    </Form>

                    {/* Delete button (triggers confirmation modal) */}
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => setProjectToDelete(p)}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modalCard}>
            <h2 className={styles.modalTitle}>Supprimer ce projet ?</h2>
            <p className={styles.modalText}>
              Êtes-vous sûr de vouloir supprimer définitivement le projet «{" "}
              <strong>{projectToDelete.title.fr}</strong> » ? Cette action est irréversible.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setProjectToDelete(null)}
              >
                Annuler
              </button>
              <Form method="post" onSubmit={() => setProjectToDelete(null)}>
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="revision" value={content.revision} />
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="projectId" value={projectToDelete.id} />
                <button
                  type="submit"
                  className={`${styles.primaryBtn} ${styles.actionBtnDanger}`}
                  style={{ background: "#ff4757", color: "#fff" }}
                >
                  Confirmer la suppression
                </button>
              </Form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
