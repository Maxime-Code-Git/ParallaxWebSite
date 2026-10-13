import { useState, useEffect } from "react";
import styles from "./videoModal.module.css";

interface VideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
  lang: "fr" | "en";
}

export function parseVideoEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;

    const host = u.hostname.toLowerCase();

    const isYouTube =
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be";

    if (isYouTube) {
      let videoId = "";
      if (host === "youtu.be") {
        videoId = u.pathname.slice(1);
      } else if (u.pathname === "/watch") {
        videoId = u.searchParams.get("v") || "";
      } else if (u.pathname.startsWith("/shorts/")) {
        videoId = u.pathname.slice(8);
      } else if (u.pathname.startsWith("/embed/")) {
        videoId = u.pathname.slice(7);
      }
      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`;
      }
      return null;
    }

    const isVimeo =
      host === "vimeo.com" ||
      host === "www.vimeo.com" ||
      host === "player.vimeo.com";

    if (isVimeo) {
      const match = u.pathname.match(/^\/(?:video\/)?(\d+)$/);
      if (match) {
        const videoId = match[1];
        if (/^\d{5,15}$/.test(videoId)) {
          return `https://player.vimeo.com/video/${videoId}?autoplay=1&dnt=1`;
        }
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export function VideoModal({ isOpen, onClose, videoUrl, lang }: VideoModalProps) {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setConsented(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const embedUrl = parseVideoEmbedUrl(videoUrl);

  const texts = {
    title: lang === "fr" ? "Affichage de contenu externe" : "External Content Display",
    notice:
      lang === "fr"
        ? "Cette vidéo est hébergée par un service externe (YouTube ou Vimeo). Pour respecter votre vie privée, aucun élément tiers n'est chargé automatiquement. En cliquant sur Accepter, vous chargez le lecteur tiers."
        : "This video is hosted by an external service (YouTube or Vimeo). To protect your privacy, no third-party element is loaded automatically. By clicking Accept, you load the third-party player.",
    accept: lang === "fr" ? "Accepter et lire" : "Accept and play",
    cancel: lang === "fr" ? "Annuler" : "Cancel",
    noVideo:
      lang === "fr"
        ? "Aucun lien vidéo externe n'a été configuré pour ce showreel."
        : "No external video URL has been configured for this showreel.",
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className={styles.closeButton}
          aria-label="Fermer la vidéo"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 L6 18" />
            <path d="M6 6 L18 18" />
          </svg>
        </button>

        {!embedUrl ? (
          <div className={styles.consentContainer}>
            <h3 className={styles.consentTitle}>Showreel 2026</h3>
            <p className={styles.consentText}>{texts.noVideo}</p>
            <button type="button" onClick={onClose} className={styles.consentConfirm}>
              {lang === "fr" ? "Fermer" : "Close"}
            </button>
          </div>
        ) : !consented ? (
          <div className={styles.consentContainer}>
            <h3 className={styles.consentTitle}>{texts.title}</h3>
            <p className={styles.consentText}>{texts.notice}</p>
            <div className={styles.consentButtons}>
              <button
                type="button"
                onClick={() => setConsented(true)}
                className={styles.consentConfirm}
              >
                {texts.accept}
              </button>
              <button type="button" onClick={onClose} className={styles.consentCancel}>
                {texts.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.videoWrapper}>
            <iframe
              src={embedUrl}
              title="Showreel Parallax"
              className={styles.iframe}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
      </div>
    </div>
  );
}
