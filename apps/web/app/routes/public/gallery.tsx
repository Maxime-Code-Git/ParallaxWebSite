import { useState, useEffect, useRef, useCallback } from "react";
import {
  Form,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import { Header } from "../../components/public/Header";
import { Footer } from "../../components/public/Footer";
import { ScrollToTop } from "../../components/public/ScrollToTop";
import { getSiteContent } from "../../lib/site-content.server";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import {
  getGalleryPhotosPaginated,
  getGalleryMediaList,
  formatPublicGalleryDto,
  parsePreviewVariants,
  type GalleryMediaRow,
} from "../../lib/gallery.server";
import { buildPhotoSrcSet } from "../../lib/gallery-media.shared";
import styles from "./gallery.module.css";

export interface ClientPhotoItem {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  variants?: Record<number, { width: number; height: number }> | null;
}

interface ClientVideoItem {
  id: string;
  originalFilename: string;
  mimeType: string;
  posterRevision: number;
}

interface LoaderData {
  lang: "fr" | "en";
  gallery: ReturnType<typeof formatPublicGalleryDto>;
  initialPhotos: ClientPhotoItem[];
  videos: ClientVideoItem[];
  totalPhotos: number;
  hasMorePhotos: boolean;
  alternateUrls: { fr: string; en: string };
  common: ReturnType<typeof getSiteContent>["common"];
}

export function headers() {
  return GALLERY_PRIVATE_HEADERS;
}

export function meta({ data }: { data?: LoaderData }) {
  if (!data) return [{ title: "Galerie privée | Parallax" }];
  const { gallery, lang } = data;
  const isEn = lang === "en";

  return [
    { title: `${gallery.title} | Parallax` },
    {
      name: "description",
      content: isEn
        ? `Private photo and video gallery for ${gallery.clientName}.`
        : `Galerie photos et vidéos privée pour ${gallery.clientName}.`,
    },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const publicId = params.publicId;
  if (!publicId) {
    throw new Response("Bad Request", { status: 400, headers: GALLERY_PRIVATE_HEADERS });
  }

  const url = new URL(request.url);
  const lang: "fr" | "en" = url.pathname.startsWith("/en") ? "en" : "fr";

  // Enforces valid, unexpired, non-rotated session
  const { gallery } = await requireGalleryAccess(request, publicId, undefined, false);

  const photoPagination = getGalleryPhotosPaginated(gallery.id, 0, 24);
  const videoRows = getGalleryMediaList(gallery.id, "video");

  const initialPhotos: ClientPhotoItem[] = photoPagination.items.map((m: GalleryMediaRow) => ({
    id: m.id,
    originalFilename: m.original_filename,
    width: m.width,
    height: m.height,
    variants: parsePreviewVariants(m.preview_data),
  }));

  const videos: ClientVideoItem[] = videoRows.map((m: GalleryMediaRow) => ({
    id: m.id,
    originalFilename: m.original_filename,
    mimeType: m.mime_type,
    posterRevision: m.poster_revision,
  }));

  const dto = formatPublicGalleryDto(gallery, lang);
  const { common } = getSiteContent();

  const alternateUrls = {
    fr: `/fr/galerie/${publicId}`,
    en: `/en/gallery/${publicId}`,
  };

  return Response.json(
    {
      lang,
      gallery: dto,
      initialPhotos,
      videos,
      totalPhotos: photoPagination.total,
      hasMorePhotos: photoPagination.hasMore,
      alternateUrls,
      common,
    },
    {
      headers: GALLERY_PRIVATE_HEADERS,
    }
  );
}

export default function GalleryPage() {
  const {
    lang,
    gallery,
    initialPhotos,
    videos,
    totalPhotos,
    hasMorePhotos,
    alternateUrls,
    common,
  } = useLoaderData<LoaderData>();

  const isEn = lang === "en";

  const [photos, setPhotos] = useState<ClientPhotoItem[]>(initialPhotos);
  const [hasMore, setHasMore] = useState(hasMorePhotos);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxLoading, setLightboxLoading] = useState(true);
  const [lightboxError, setLightboxError] = useState(false);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const pageContentRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Pagination handler
  const loadMorePhotos = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);

    try {
      const res = await fetch(`/api/gallery/${gallery.publicId}/photos?skip=${photos.length}`);
      if (res.ok) {
        const data = await res.json();
        const incoming: ClientPhotoItem[] = (data.photos || []).map(
          (m: {
            id: string;
            original_filename?: string;
            originalFilename?: string;
            width: number | null;
            height: number | null;
            variants?: Record<number, { width: number; height: number }> | null;
          }) => ({
            id: m.id,
            originalFilename: m.original_filename || m.originalFilename || "photo",
            width: m.width,
            height: m.height,
            variants: m.variants,
          })
        );

        setPhotos((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          const fresh = incoming.filter((p) => !ids.has(p.id));
          return [...prev, ...fresh];
        });
        setHasMore(Boolean(data.hasMore));
      }
    } catch {
      // Non-blocking error
    } finally {
      setIsLoadingMore(false);
    }
  }, [gallery.publicId, hasMore, isLoadingMore, photos.length]);

  // Open Lightbox
  const openLightbox = (index: number) => {
    lastActiveElementRef.current = document.activeElement as HTMLElement | null;
    setLightboxIndex(index);
    setLightboxLoading(true);
    setLightboxError(false);
    document.body.classList.add("lightbox-open");
    setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);
  };

  // Close Lightbox
  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
    document.body.classList.remove("lightbox-open");
    if (lastActiveElementRef.current) {
      lastActiveElementRef.current.focus();
    }
  }, []);

  // Keyboard controls for lightbox: focus trap, Escape and arrow keys
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeLightbox();
        return;
      }
      if (e.key === "ArrowLeft" && lightboxIndex > 0) {
        setLightboxIndex(lightboxIndex - 1);
        setLightboxLoading(true);
        setLightboxError(false);
        return;
      }
      if (e.key === "ArrowRight" && lightboxIndex < photos.length - 1) {
        setLightboxIndex(lightboxIndex + 1);
        setLightboxLoading(true);
        setLightboxError(false);
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeLightbox, lightboxIndex, photos.length]);

  // Clean up body class on unmount
  useEffect(() => {
    return () => {
      document.body.classList.remove("lightbox-open");
    };
  }, []);

  const activePhoto = lightboxIndex !== null ? photos[lightboxIndex] : null;

  return (
    <div className={styles.container}>
      <div ref={pageContentRef} inert={lightboxIndex !== null ? true : undefined}>
        <Header
        common={common}
        lang={lang}
        currentRoute="gallery"
        alternateUrls={alternateUrls}
      />

      {/* Hero Section */}
      <section className={styles.heroSection}>
        {gallery.coverMediaId && (
          <img
            src={`/api/gallery/${gallery.publicId}/media/${gallery.coverMediaId}?width=1920&format=webp`}
            alt=""
            aria-hidden="true"
            className={styles.heroCoverBg}
          />
        )}
        <div className={styles.heroOverlay} />

        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            {gallery.location || (isEn ? "Private Gallery" : "Galerie privée")}
          </div>
          <h1 className={styles.heroTitle}>{gallery.title}</h1>
          <div className={styles.heroDate}>{gallery.projectDate}</div>
        </div>
      </section>

      {/* Intro & Signature Section */}
      {(gallery.intro || gallery.signature) && (
        <section className={styles.introSection}>
          {gallery.intro && <p className={styles.introText}>{gallery.intro}</p>}
          {gallery.signature && <p className={styles.signatureText}>{gallery.signature}</p>}
        </section>
      )}

      {/* Main Gallery Section */}
      <section className={styles.gallerySection}>
        <h2 className={styles.sectionHeader}>
          {isEn ? "The Gallery" : "La galerie"}
        </h2>

        {/* Global Downloads */}
        <div className={styles.actionButtons}>
          <a
            href={`/api/gallery/${gallery.publicId}/download?type=all`}
            className={`${styles.btnDownload} ${styles.btnDownloadPrimary}`}
            download
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 4 V15" />
              <path d="M7 11 L12 16 L17 11" />
              <path d="M5 20 H19" />
            </svg>
            <span>{isEn ? "Download all (ZIP)" : "Tout télécharger (ZIP)"}</span>
          </a>

          {photos.length > 0 && videos.length > 0 && (
            <>
              <a
                href={`/api/gallery/${gallery.publicId}/download?type=photos`}
                className={styles.btnDownload}
                download
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <circle cx="8.5" cy="9.5" r="1.5" />
                  <path d="M21 15 L16 10 L5 20" />
                </svg>
                <span>{isEn ? "Photos only (ZIP)" : "Photos uniquement (ZIP)"}</span>
              </a>

              <a
                href={`/api/gallery/${gallery.publicId}/download?type=videos`}
                className={styles.btnDownload}
                download
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="6" width="14" height="12" rx="2" />
                  <path d="M16 10 L22 7 V17 L16 14 Z" />
                </svg>
                <span>{isEn ? "Video only (ZIP)" : "Vidéo uniquement (ZIP)"}</span>
              </a>
            </>
          )}
        </div>

        <p className={styles.downloadNotice}>
          {isEn
            ? "Downloads may take several minutes depending on archive size."
            : "Les téléchargements peuvent prendre plusieurs minutes selon la taille de l'archive."}
        </p>

        {/* Photos Masonry Grid */}
        {photos.length > 0 && (
          <>
            <div id="photos" className={styles.photosGrid}>
              {photos.map((photo, idx) => {
                const { srcSet, src } = buildPhotoSrcSet(
                  `/api/gallery/${gallery.publicId}/media`,
                  photo.id,
                  photo.variants,
                  photo.width
                );
                return (
                  <div key={photo.id} className={styles.photoCard}>
                    <button
                      type="button"
                      className={styles.photoButton}
                      onClick={() => openLightbox(idx)}
                      aria-label={
                        isEn
                          ? `Enlarge photo ${idx + 1} of ${totalPhotos}`
                          : `Agrandir la photo ${idx + 1} sur ${totalPhotos}`
                      }
                    >
                      <picture>
                        <source
                          srcSet={srcSet}
                          sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw"
                          type="image/webp"
                        />
                        <img
                          src={src}
                          alt={photo.originalFilename}
                          loading="lazy"
                          decoding="async"
                          className={styles.photoImg}
                          width={photo.width || undefined}
                          height={photo.height || undefined}
                        />
                      </picture>
                    </button>

                  <a
                    href={`/api/gallery/${gallery.publicId}/download/original/${photo.id}`}
                    download
                    className={styles.downloadPill}
                    title={isEn ? "Download original photo" : "Télécharger la photo originale"}
                    aria-label={
                      isEn
                        ? `Download original photo ${idx + 1}`
                        : `Télécharger l'original de la photo ${idx + 1}`
                    }
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 4 V15" />
                      <path d="M7 11 L12 16 L17 11" />
                      <path d="M5 20 H19" />
                    </svg>
                  </a>
                </div>
              );
            })}
            </div>

            {hasMore && (
              <div className={styles.loadMoreContainer}>
                <button
                  type="button"
                  onClick={loadMorePhotos}
                  disabled={isLoadingMore}
                  className={styles.btnLoadMore}
                >
                  {isLoadingMore
                    ? isEn ? "Loading..." : "Chargement..."
                    : isEn ? "Load more photos" : "Charger plus de photos"}
                </button>
              </div>
            )}

            <div className={styles.photosCount}>
              {isEn
                ? `${photos.length} of ${totalPhotos} photos displayed`
                : `${photos.length} sur ${totalPhotos} photos affichées`}
            </div>
          </>
        )}
      </section>

      {/* Videos Section */}
      {videos.length > 0 && (
        <section id="film" className={styles.filmSection}>
          <h2 className={styles.sectionHeader}>
            {videos.length === 1
              ? isEn ? "The Film" : "Le film"
              : isEn ? "The Films" : "Les films"}
          </h2>

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
                        ? `/api/gallery/${gallery.publicId}/media/${vid.id}/poster?v=${vid.posterRevision}`
                        : undefined
                    }
                  >
                    <source
                      src={`/api/gallery/${gallery.publicId}/media/${vid.id}`}
                      type={vid.mimeType}
                    />
                    {isEn
                      ? "Your browser does not support video playback."
                      : "Votre navigateur ne prend pas en charge la lecture vidéo."}
                  </video>
                </div>

                <div className={styles.videoDownloadFooter}>
                  <span className={styles.videoTitle}>{vid.originalFilename}</span>
                  <a
                    href={`/api/gallery/${gallery.publicId}/download/original/${vid.id}`}
                    download
                    className={styles.videoDownloadLink}
                  >
                    {isEn ? "Download original film" : "Télécharger l'original"}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Logout Action */}
      <section className={styles.logoutArea}>
        <Form method="post" action="/api/gallery/logout">
          <button type="submit" className={styles.btnLogout}>
            {isEn ? "Log out of gallery" : "Se déconnecter de la galerie"}
          </button>
        </Form>
      </section>

      <ScrollToTop />
      <Footer common={common} lang={lang} />
    </div>

    {/* Lightbox Dialog */}
    {activePhoto && (
      <div
        ref={dialogRef}
        className={styles.lightboxOverlay}
        role="dialog"
        aria-modal="true"
        aria-label={
          isEn
            ? `Photo ${lightboxIndex! + 1} of ${photos.length}`
            : `Photo ${lightboxIndex! + 1} sur ${photos.length}`
        }
        onClick={closeLightbox}
      >
        <button
          ref={closeBtnRef}
          type="button"
          className={styles.lightboxClose}
          onClick={closeLightbox}
          aria-label={isEn ? "Close preview" : "Fermer l'aperçu"}
        >
          ✕
        </button>

        {lightboxIndex! > 0 && (
          <button
            type="button"
            className={`${styles.lightboxNavBtn} ${styles.lightboxPrev}`}
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex(lightboxIndex! - 1);
              setLightboxLoading(true);
              setLightboxError(false);
            }}
            aria-label={isEn ? "Previous photo" : "Photo précédente"}
          >
            ‹
          </button>
        )}

        {lightboxIndex! < photos.length - 1 && (
          <button
            type="button"
            className={`${styles.lightboxNavBtn} ${styles.lightboxNext}`}
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex(lightboxIndex! + 1);
              setLightboxLoading(true);
              setLightboxError(false);
            }}
            aria-label={isEn ? "Next photo" : "Photo suivante"}
          >
            ›
          </button>
        )}

        <div className={styles.lightboxContent} onClick={(e) => e.stopPropagation()}>
          {lightboxLoading && !lightboxError && (
            <div className={styles.lightboxStatus} role="status" aria-live="polite">
              {isEn ? "Loading high-resolution preview..." : "Chargement de la prévisualisation..."}
            </div>
          )}

          {lightboxError && (
            <div className={styles.lightboxError} role="alert">
              {isEn
                ? "Unable to load preview image."
                : "Impossible de charger la prévisualisation."}
            </div>
          )}

          {!lightboxError && (
            <img
              src={`/api/gallery/${gallery.publicId}/media/${activePhoto.id}?width=1920&format=webp`}
              alt={activePhoto.originalFilename}
              className={styles.lightboxImage}
              onLoad={() => setLightboxLoading(false)}
              onError={() => {
                setLightboxLoading(false);
                setLightboxError(true);
              }}
            />
          )}

          <div className={styles.lightboxFooter}>
            <a
              href={`/api/gallery/${gallery.publicId}/download/original/${activePhoto.id}`}
              download
              className={styles.lightboxDownloadBtn}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4 V15" />
                <path d="M7 11 L12 16 L17 11" />
                <path d="M5 20 H19" />
              </svg>
              <span>{isEn ? "Download original" : "Télécharger l'original"}</span>
            </a>
          </div>
        </div>
      </div>
    )}
  </div>
);
}
