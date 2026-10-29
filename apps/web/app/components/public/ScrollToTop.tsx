import { useEffect, useState, useCallback, useRef } from "react";
import styles from "./scrollToTop.module.css";

export interface ScrollToTopProps {
  checkSempra?: boolean;
  targetRef?: React.RefObject<HTMLElement | null> | React.MutableRefObject<HTMLElement | null>;
  className?: string;
  ariaLabel?: string;
  lang?: "fr" | "en";
  hidden?: boolean;
  viewKey?: string;
}

export function ScrollToTop({
  checkSempra = false,
  targetRef,
  className = "",
  ariaLabel,
  lang,
  hidden = false,
  viewKey,
}: ScrollToTopProps) {
  const [scrolled, setScrolled] = useState(false);
  const [overSempra, setOverSempra] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const targetRefStable = useRef(targetRef);
  targetRefStable.current = targetRef;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReducedMotion(Boolean(mq?.matches));
      const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mq.addEventListener?.("change", listener);
      return () => mq.removeEventListener?.("change", listener);
    } catch {
      // safe fallback
    }
  }, []);

  const updateVisibility = useCallback(() => {
    const currentRef = targetRefStable.current;
    let scrollY = 0;
    if (currentRef) {
      if (currentRef.current) {
        scrollY = currentRef.current.scrollTop;
      }
    } else if (typeof window !== "undefined") {
      scrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    setScrolled(scrollY > 60);

    if (checkSempra && !currentRef && typeof document !== "undefined" && typeof window !== "undefined") {
      const sempraEl = document.getElementById("sempra");
      if (sempraEl) {
        const rect = sempraEl.getBoundingClientRect();
        setOverSempra(rect.top <= window.innerHeight - 90);
      }
    }
  }, [checkSempra]);

  useEffect(() => {
    let cleanupListener: (() => void) | null = null;
    let rafId: number | null = null;

    const attach = (el: HTMLElement | Window) => {
      el.addEventListener("scroll", updateVisibility, { passive: true });
      cleanupListener = () => {
        el.removeEventListener("scroll", updateVisibility);
      };
      updateVisibility();
    };

    if (targetRef) {
      if (targetRef.current) {
        attach(targetRef.current);
      } else {
        let attempts = 0;
        const checkRef = () => {
          if (targetRef.current) {
            attach(targetRef.current);
          } else if (attempts < 25) {
            attempts++;
            rafId = window.requestAnimationFrame(checkRef);
          }
        };
        rafId = window.requestAnimationFrame(checkRef);
      }
    } else if (typeof window !== "undefined") {
      attach(window);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (cleanupListener) cleanupListener();
    };
  }, [targetRef, targetRef?.current, updateVisibility]);

  // Recalculate visibility on view change (e.g. route/project change) without waiting for scroll
  useEffect(() => {
    updateVisibility();
  }, [viewKey, updateVisibility]);

  // Recalculate visibility immediately when unhidden (e.g. lightbox or video modal closes)
  useEffect(() => {
    if (!hidden) {
      updateVisibility();
    }
  }, [hidden, updateVisibility]);

  // Handle window resizing
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", updateVisibility, { passive: true });
    return () => window.removeEventListener("resize", updateVisibility);
  }, [updateVisibility]);

  const scrollToTop = () => {
    const behavior = reducedMotion ? "auto" : "smooth";
    if (targetRef) {
      const target = targetRef.current;
      if (target) {
        if (typeof target.scrollTo === "function") {
          target.scrollTo({ top: 0, behavior });
        } else {
          target.scrollTop = 0;
        }
      }
    } else if (typeof window !== "undefined") {
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, behavior });
      } else {
        window.scroll(0, 0);
      }
    }
  };

  const isVisible = scrolled && !hidden;
  const arrowColor = overSempra ? "#FBF6F0" : "#F5F6F7";
  const defaultLabel =
    lang === "en" || (typeof document !== "undefined" && document.documentElement.lang === "en")
      ? "Back to top"
      : "Remonter en haut de la page";
  const label = ariaLabel || defaultLabel;

  return (
    <button
      type="button"
      onClick={scrollToTop}
      disabled={!isVisible}
      tabIndex={isVisible ? 0 : -1}
      aria-hidden={!isVisible}
      className={`${styles.btn} ${isVisible ? styles.visible : styles.hidden} ${overSempra ? styles.btnSempra : ""} ${className}`.trim()}
      aria-label={label}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={arrowColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 19 V5" />
        <path d="M5 12 L12 5 L19 12" />
      </svg>
    </button>
  );
}
