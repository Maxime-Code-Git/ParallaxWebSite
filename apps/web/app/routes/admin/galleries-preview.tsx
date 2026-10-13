import { useState } from "react";
import {
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import {
  getGalleryById,
  getGalleryPhotosPaginated,
  getGalleryMediaList,
  formatPublicGalleryDto,
} from "../../lib/gallery.server";
import { getSiteContent } from "../../lib/site-content.server";
import { Header } from "../../components/public/Header";
import { Footer } from "../../components/public/Footer";
import styles from "../public/gallery.module.css";

interface LoaderData {
  gallery: ReturnType<typeof formatPublicGalleryDto>;
  galleryId: string;
  photos: { id: string; originalFilename: string; width: number | null; height: number | null }[];
  videos: { id: string; originalFilename: string; mimeType: string; posterRevision: number }[];
  common: ReturnType<typeof getSiteContent>["common"];
}

export function meta({ data }: { data?: LoaderData }) {
  const title = data?.gallery ? `[Aperçu Admin] ${data.gallery.title} | Parallax` : "Aperçu Admin | Parallax";
  return [
    { title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireValidAdminSession(request);
  const gallery = getGalleryById(params.id || "");

  if (!gallery) {
    throw new Response("Galerie introuvable", { status: 404, headers: createAdminHeaders() });
  }

  const dto = formatPublicGalleryDto(gallery, "fr");
  const photoPagination = getGalleryPhotosPaginated(gallery.id, 0, 48);
  const videoRows = getGalleryMediaList(gallery.id, "video");

  const photos = photoPagination.items.map((m) => ({
    id: m.id,
    originalFilename: m.original_filename,
    width: m.width,
    height: m.height,
  }));

  const videos = videoRows.map((m) => ({
    id: m.id,
    originalFilename: m.original_filename,
    mimeType: m.mime_type,
    posterRevision: m.poster_revision,
  }));

  const { common } = getSiteContent();

  return Response.json(
    {
      gallery: dto,
      galleryId: gallery.id,
      photos,
      videos,
      common,
    },
    { headers: createAdminHeaders() }
  );
}

export default function AdminGalleryPreviewPage() {
  const { gallery, galleryId, photos, videos, common } = useLoaderData<LoaderData>();
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null);

  const activePhoto = activePhotoIndex !== null ? photos[activePhotoIndex] : null;

  return (
    <div className={styles.container}>
      {/* Admin Preview Top Banner */}
      <div className={styles.previewBanner}>
        <span>
          Aperçu administrateur Parallax (Session Admin active · Statut : {gallery.publicId ? "Brouillon/Actif" : ""})
        </span>
        <Link
          to={`/admin/galleries/${galleryId}`}
          className={styles.previewBannerLink}
        >
          ← Retour à l'édition de la galerie
        </Link>
      </div>

      <Header common={common} lang="fr" currentRoute="gallery" />

      {/* Hero */}
      <section className={styles.heroSection}>
        {gallery.coverMediaId && (
          <img
            src={`/api/admin/galleries/${galleryId}/media/${gallery.coverMediaId}?width=1920&format=webp`}
            alt=""
            aria-hidden="true"
            className={styles.heroCoverBg}
          />
        )}
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>{gallery.location || "Galerie privée"}</div>
          <h1 className={styles.heroTitle}>{gallery.title}</h1>
          <div className={styles.heroDate}>{gallery.projectDate}</div>
        </div>
      </section>

      {/* Intro */}
      {(gallery.intro || gallery.signature) && (
        <section className={styles.introSection}>
          {gallery.intro && <p className={styles.introText}>{gallery.intro}</p>}
          {gallery.signature && <p className={styles.signatureText}>{gallery.signature}</p>}
        </section>
      )}

      {/* Gallery Section */}
      <section className={styles.gallerySection}>
        <h2 className={styles.sectionHeader}>La galerie</h2>

        {photos.length === 0 ? (
          <p className={styles.emptyNotice}>
            Aucune photo importée pour le moment.
          </p>
        ) : (
          <div className={styles.photosGrid}>
            {photos.map((p, idx) => (
              <div key={p.id} className={styles.photoCard}>
                <button
                  type="button"
                  className={styles.photoButton}
                  onClick={() => setActivePhotoIndex(idx)}
                >
                  <img
                    src={`/api/admin/galleries/${galleryId}/media/${p.id}?width=960&format=webp`}
                    alt={p.originalFilename}
                    loading="lazy"
                    className={styles.photoImg}
                    width={p.width || undefined}
                    height={p.height || undefined}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Videos Section */}
      {videos.length > 0 && (
        <section className={styles.filmSection}>
          <h2 className={styles.sectionHeader}>Le film</h2>
          <div className={styles.videoList}>
            {videos.map((vid) => (
              <div key={vid.id} className={styles.videoCard}>
                <div className={styles.videoWrapper}>
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    className={styles.videoPlayer}
                    poster={
                      vid.posterRevision > 0
                        ? `/api/admin/galleries/${galleryId}/media/${vid.id}/poster?v=${vid.posterRevision}`
                        : undefined
                    }
                  >
                    <source
                      src={`/api/admin/galleries/${galleryId}/media/${vid.id}`}
                      type={vid.mimeType}
                    />
                  </video>
                </div>
                <div className={styles.videoDownloadFooter}>
                  <span className={styles.videoTitle}>{vid.originalFilename}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Lightbox for admin preview */}
      {activePhoto && (
        <div
          className={styles.lightboxOverlay}
          role="dialog"
          aria-modal="true"
          onClick={() => setActivePhotoIndex(null)}
        >
          <button
            type="button"
            className={styles.lightboxClose}
            onClick={() => setActivePhotoIndex(null)}
          >
            ✕
          </button>
          <div className={styles.lightboxContent} onClick={(e) => e.stopPropagation()}>
            <img
              src={`/api/admin/galleries/${galleryId}/media/${activePhoto.id}?width=1920&format=webp`}
              alt={activePhoto.originalFilename}
              className={styles.lightboxImage}
            />
          </div>
        </div>
      )}

      <Footer common={common} lang="fr" />
    </div>
  );
}
