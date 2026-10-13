import {
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import { getGalleries } from "../../lib/gallery.server";
import styles from "./galleries.module.css";

export function meta() {
  return [
    { title: "Galeries clients | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

interface LoaderData {
  galleries: ReturnType<typeof getGalleries>;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireValidAdminSession(request);
  const galleries = getGalleries();
  return Response.json({ galleries }, { headers: createAdminHeaders() });
}

export default function AdminGalleriesListPage() {
  const { galleries } = useLoaderData<LoaderData>();
  const now = Date.now();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin/dashboard" className={styles.backLink}>
            ← Tableau de bord
          </Link>
          <h1 className={styles.pageTitle}>Galeries clients</h1>
        </div>
        <div className={styles.headerActions}>
          <Link to="/admin/galleries/new" className={`${styles.btn} ${styles.btnPrimary}`}>
            + Nouvelle galerie
          </Link>
        </div>
      </header>

      <main className={styles.content}>
        {galleries.length === 0 ? (
          <div className={styles.sectionCard}>
            <p>Aucune galerie client enregistrée pour le moment.</p>
            <Link to="/admin/galleries/new" className={`${styles.btn} ${styles.btnPrimary}`}>
              Créer la première galerie
            </Link>
          </div>
        ) : (
          <div className={styles.grid}>
            {galleries.map((g) => {
              const isExpired = g.expires_at !== null && g.expires_at < now;
              let statusLabel = "Brouillon";
              let statusClass = styles.statusDraft;

              if (g.status === "published") {
                statusLabel = isExpired ? "Expirée" : "Publiée";
                statusClass = isExpired ? styles.statusDraft : styles.statusPublished;
              } else if (g.status === "archived") {
                statusLabel = "Archivée";
                statusClass = styles.statusArchived;
              }

              return (
                <div key={g.id} className={styles.galleryCard}>
                  <div>
                    <div className={styles.cardTop}>
                      <div>
                        <h2 className={styles.cardTitle}>{g.title}</h2>
                        <p className={styles.cardSubtitle}>
                          Client : {g.client_name} · {g.project_date}
                        </p>
                      </div>
                      <span className={`${styles.statusPill} ${statusClass}`}>
                        {statusLabel}
                      </span>
                    </div>

                    <div className={styles.cardStats}>
                      <span>📷 {g.photoCount} photo{g.photoCount > 1 ? "s" : ""}</span>
                      <span>🎬 {g.videoCount} vidéo{g.videoCount > 1 ? "s" : ""}</span>
                      <span>🔑 Code v{g.codeVersion}</span>
                    </div>

                    {g.expires_at && (
                      <p className={`${styles.codeMeta} ${styles.codeMetaSpaced}`}>
                        Expiration : {new Date(g.expires_at).toLocaleDateString("fr-FR")}
                      </p>
                    )}
                  </div>

                  <div className={styles.cardActions}>
                    <Link
                      to={`/admin/galleries/${g.id}`}
                      className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                    >
                      Gérer la galerie
                    </Link>
                    {g.status === "published" && (
                      <Link
                        to={`/fr/galerie/${g.public_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`${styles.btn} ${styles.btnSmall} ${styles.btnSecondaryAccent}`}
                      >
                        Voir client ↗
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
