import { useEffect, useState } from "react";
import styles from "./scrollToTop.module.css";

interface ScrollToTopProps {
  checkSempra?: boolean;
  targetRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  ariaLabel?: string;
  hidden?: boolean;
}

export function ScrollToTop({
  checkSempra = false,
  targetRef,
  className = "",
  ariaLabel = "Remonter en haut de la page",
  hidden = false,
}: ScrollToTopProps) {
  const [scrolled, setScrolled] = useState(false);
  const [overSempra, setOverSempra] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

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

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = targetRef?.current
        ? targetRef.current.scrollTop
        : typeof window !== "undefined"
        ? window.scrollY
        : 0;
      setScrolled(scrollY > 60);

      if (checkSempra && !targetRef?.current && typeof document !== "undefined") {
        const sempraEl = document.getElementById("sempra");
        if (sempraEl && typeof window !== "undefined") {
          const rect = sempraEl.getBoundingClientRect();
          setOverSempra(rect.top <= window.innerHeight - 90);
        }
      }
    };

    if (targetRef?.current) {
      const el = targetRef.current;
      el.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();
      return () => el.removeEventListener("scroll", handleScroll);
    } else if (typeof window !== "undefined") {
      window.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, [checkSempra, targetRef, targetRef?.current]);

  const scrollToTop = () => {
    const behavior = reducedMotion ? "auto" : "smooth";
    if (targetRef?.current) {
      if (typeof targetRef.current.scrollTo === "function") {
        targetRef.current.scrollTo({ top: 0, behavior });
      } else {
        targetRef.current.scrollTop = 0;
      }
    } else if (typeof window !== "undefined") {
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, behavior });
      }
    }
  };

  const isVisible = scrolled && !hidden;
  const arrowColor = overSempra ? "#FBF6F0" : "#F5F6F7";

  return (
    <button
      type="button"
      onClick={scrollToTop}
      tabIndex={isVisible ? 0 : -1}
      aria-hidden={!isVisible}
      className={`${styles.btn} ${isVisible ? styles.visible : styles.hidden} ${overSempra ? styles.btnSempra : ""} ${className}`}
      aria-label={ariaLabel}
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
