import { useState, useEffect, useCallback } from "react";
import styles from "./videoModal.module.css";
import {
  detectVideoProvider,
  type VideoProvider,
} from "../../lib/privacy-preferences.shared";
import {
  hasProviderConsent,
  setClientOneTimeConsent,
  persistProviderPreferences,
} from "../../lib/privacy-client";

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
  const [rememberChoice, setRememberChoice] = useState(false);

  const provider: VideoProvider | null = detectVideoProvider(videoUrl);

  const checkConsentStatus = useCallback(() => {
    if (!provider) {
      setConsented(false);
      return;
    }
    const hasConsent = hasProviderConsent(provider);
    setConsented(hasConsent);
  }, [provider]);

  useEffect(() => {
    if (!isOpen) {
      setConsented(false);
      setRememberChoice(false);
      return;
    }

    checkConsentStatus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }

    function handlePrivacyUpdate(e: Event) {
      const customEvent = e as CustomEvent<{ youtube?: boolean; vimeo?: boolean; provider?: VideoProvider; granted?: boolean }>;
      if (provider) {
        // If event specifies revocation for our provider, immediately revoke
        if (customEvent.detail) {
          if (customEvent.detail.provider === provider && customEvent.detail.granted === false) {
            setConsented(false);
            return;
          }
          if (customEvent.detail[provider] === false) {
            setConsented(false);
            return;
          }
        }
        // Re-check consent
        if (!hasProviderConsent(provider)) {
          setConsented(false);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("parallax:privacy-updated", handlePrivacyUpdate);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("parallax:privacy-updated", handlePrivacyUpdate);
    };
  }, [isOpen, onClose, checkConsentStatus, provider]);

  if (!isOpen) return null;

  const embedUrl = parseVideoEmbedUrl(videoUrl);

  const providerLabel = provider === "youtube" ? "YouTube" : provider === "vimeo" ? "Vimeo" : "externe";

  const texts = {
    title: lang === "fr" ? `Lecture externe (${providerLabel})` : `External player (${providerLabel})`,
    notice:
      lang === "fr"
        ? `Cette vidéo est hébergée par ${providerLabel}. Pour respecter votre vie privée, aucun lecteur tiers n'est chargé automatiquement. En acceptant, vous autorisez le chargement du lecteur.`
        : `This video is hosted by ${providerLabel}. To protect your privacy, no third-party player is loaded automatically. By accepting, you allow the player to load.`,
    remember:
      lang === "fr"
        ? `Mémoriser mon accord pour ${providerLabel} (6 mois)`
        : `Remember my choice for ${providerLabel} (6 months)`,
    accept: lang === "fr" ? "Accepter et lire" : "Accept and play",
    cancel: lang === "fr" ? "Refuser" : "Refuse",
    noVideo:
      lang === "fr"
        ? "Aucun lien vidéo valide n'a été configuré."
        : "No valid video URL has been configured.",
  };

  const handleAccept = () => {
    if (!provider) return;
    if (rememberChoice) {
      void persistProviderPreferences({ [provider]: true });
    }
    setClientOneTimeConsent(provider, true);
    setConsented(true);
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className={styles.closeButton}
          aria-label={lang === "fr" ? "Fermer la vidéo" : "Close video"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 L6 18" />
            <path d="M6 6 L18 18" />
          </svg>
        </button>

        {!embedUrl ? (
          <div className={styles.consentContainer}>
            <h3 className={styles.consentTitle}>Showreel</h3>
            <p className={styles.consentText}>{texts.noVideo}</p>
            <button type="button" onClick={onClose} className={styles.consentCancel}>
              {lang === "fr" ? "Fermer" : "Close"}
            </button>
          </div>
        ) : !consented ? (
          <div className={styles.consentContainer}>
            <h3 className={styles.consentTitle}>{texts.title}</h3>
            <p className={styles.consentText}>{texts.notice}</p>

            <label className={styles.checkboxContainer}>
              <input
                type="checkbox"
                checked={rememberChoice}
                onChange={(e) => setRememberChoice(e.target.checked)}
                className={styles.checkboxInput}
              />
              <span>{texts.remember}</span>
            </label>

            <div className={styles.consentButtons}>
              <button
                type="button"
                onClick={handleAccept}
                className={styles.consentConfirm}
              >
                {texts.accept}
              </button>
              <button
                type="button"
                onClick={onClose}
                className={styles.consentCancel}
              >
                {texts.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.videoWrapper}>
            <iframe
              src={embedUrl}
              title={`Vidéo ${providerLabel} Parallax`}
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
