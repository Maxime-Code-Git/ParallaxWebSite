import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./videoModal.module.css";
import {
  detectVideoProvider,
  type VideoProvider,
} from "../../lib/privacy-preferences.shared";
import {
  hasProviderConsent,
  setClientOneTimeConsent,
  persistProviderPreferencesDetailed,
  fetchValidatedPreferences,
  isTabExplicitRefusal,
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
  const [activeConsent, setActiveConsent] = useState<{
    mediaUrl: string;
    provider: VideoProvider;
  } | null>(null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const currentMediaUrlRef = useRef<string>(videoUrl);
  const evaluationSeqRef = useRef<number>(0);

  const provider: VideoProvider | null = detectVideoProvider(videoUrl);

  const isPlayerAuthorized = Boolean(
    provider &&
    activeConsent &&
    activeConsent.mediaUrl === videoUrl &&
    activeConsent.provider === provider &&
    hasProviderConsent(provider, videoUrl)
  );

  const evaluateConsent = useCallback(
    async (targetUrl: string) => {
      const evaluationSeq = ++evaluationSeqRef.current;
      const targetProvider = detectVideoProvider(targetUrl);
      if (!targetProvider) {
        setActiveConsent(null);
        return;
      }
      // Check existing validated or one-time consent for this media URL
      if (hasProviderConsent(targetProvider, targetUrl)) {
        if (evaluationSeq === evaluationSeqRef.current && currentMediaUrlRef.current === targetUrl) {
          setActiveConsent({ mediaUrl: targetUrl, provider: targetProvider });
        }
        return;
      }
      // If explicit refusal is active in this tab, do not re-read or accept server cookie
      if (isTabExplicitRefusal()) {
        setActiveConsent(null);
        return;
      }
      // Attempt to load validated server preferences if not yet done
      const verified = await fetchValidatedPreferences();
      if (evaluationSeq !== evaluationSeqRef.current || currentMediaUrlRef.current !== targetUrl) {
        return;
      }
      if (verified && verified[targetProvider] && hasProviderConsent(targetProvider, targetUrl)) {
        setActiveConsent({ mediaUrl: targetUrl, provider: targetProvider });
      } else {
        setActiveConsent(null);
      }
    },
    []
  );

  // Manage media URL transitions
  useEffect(() => {
    if (videoUrl !== currentMediaUrlRef.current) {
      evaluationSeqRef.current++;
      // Different video: revoke one-time consent from previous video
      if (currentMediaUrlRef.current) {
        setClientOneTimeConsent(currentMediaUrlRef.current, false);
      }
      currentMediaUrlRef.current = videoUrl;
      setActiveConsent(null);
      setRememberChoice(false);
      setPersistenceError(null);
    }
  }, [videoUrl]);

  // Open / Close lifecycle, focus trap, and Escape handling
  useEffect(() => {
    if (!isOpen) {
      evaluationSeqRef.current++;
      // Modal closed: revoke one-time consent for this video context
      if (currentMediaUrlRef.current) {
        setClientOneTimeConsent(currentMediaUrlRef.current, false);
      }
      setActiveConsent(null);
      setRememberChoice(false);
      setPersistenceError(null);

      // Restore focus to opener element
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === "function") {
        previousActiveElementRef.current.focus();
        previousActiveElementRef.current = null;
      }
      return;
    }

    // Modal opened: store previously focused element
    if (typeof document !== "undefined") {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    }

    void evaluateConsent(videoUrl);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      // WAI-ARIA Focus trapping
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const focusable = Array.from(focusableElements).filter(
          (el) => !el.hasAttribute("disabled") && el.offsetParent !== null
        );

        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    }

    function handlePrivacyUpdate(e: Event) {
      const customEvent = e as CustomEvent<{
        youtube?: boolean;
        vimeo?: boolean;
        provider?: VideoProvider;
        granted?: boolean;
      }>;
      if (provider) {
        if (customEvent.detail) {
          if (
            (customEvent.detail.provider === provider && customEvent.detail.granted === false) ||
            customEvent.detail[provider] === false
          ) {
            evaluationSeqRef.current++;
            setActiveConsent(null);
            setClientOneTimeConsent(videoUrl, false);
            return;
          }
        }
        if (!hasProviderConsent(provider, videoUrl)) {
          evaluationSeqRef.current++;
          setActiveConsent(null);
        } else {
          setActiveConsent({ mediaUrl: videoUrl, provider });
        }
      } else {
        evaluationSeqRef.current++;
        setActiveConsent(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("parallax:privacy-updated", handlePrivacyUpdate);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("parallax:privacy-updated", handlePrivacyUpdate);
    };
  }, [isOpen, onClose, evaluateConsent, videoUrl, provider]);

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
    persistenceErrorMsg:
      lang === "fr"
        ? "Impossible d'enregistrer vos préférences de façon permanente (erreur réseau). La lecture se fera uniquement pour cette session."
        : "Unable to save your choice permanently (network error). Playback will only occur for this session.",
  };

  const handleAccept = async () => {
    if (!provider) return;
    setPersistenceError(null);

    const acceptSeq = ++evaluationSeqRef.current;
    const targetVideoUrl = videoUrl;
    const targetProvider = provider;

    if (rememberChoice) {
      const result = await persistProviderPreferencesDetailed({ [provider]: true });

      // After await boundary:
      // 1. Did the modal close or did the video change while waiting?
      if (evaluationSeqRef.current !== acceptSeq || currentMediaUrlRef.current !== targetVideoUrl) {
        return;
      }

      // 2. Was this operation cancelled/stale, or is explicit refusal active?
      if (result.status === "stale" || isTabExplicitRefusal()) {
        return;
      }

      // 3. Genuine network error: only grant one-time consent if modal is still open,
      // context matches, and user did not revoke.
      if (result.status === "error") {
        setPersistenceError(texts.persistenceErrorMsg);
        setClientOneTimeConsent(targetVideoUrl, true);
        setActiveConsent({ mediaUrl: targetVideoUrl, provider: targetProvider });
        return;
      }

      // 4. Success:
      setClientOneTimeConsent(targetVideoUrl, true);
      setActiveConsent({ mediaUrl: targetVideoUrl, provider: targetProvider });
      return;
    }

    // Explicit one-time accept clicked by user (rememberChoice is false)
    if (evaluationSeqRef.current !== acceptSeq || currentMediaUrlRef.current !== targetVideoUrl) {
      return;
    }
    setClientOneTimeConsent(targetVideoUrl, true);
    setActiveConsent({ mediaUrl: targetVideoUrl, provider: targetProvider });
  };

  const handleClose = () => {
    evaluationSeqRef.current++;
    if (videoUrl) {
      setClientOneTimeConsent(videoUrl, false);
    }
    setActiveConsent(null);
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={handleClose} role="dialog" aria-modal="true">
      <div ref={modalRef} className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={handleClose}
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
            <button type="button" onClick={handleClose} className={styles.consentCancel}>
              {lang === "fr" ? "Fermer" : "Close"}
            </button>
          </div>
        ) : !isPlayerAuthorized ? (
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

            {persistenceError && (
              <div role="alert" className={styles.consentError}>
                {persistenceError}
              </div>
            )}

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
                onClick={handleClose}
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
