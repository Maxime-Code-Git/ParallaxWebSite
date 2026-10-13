import { useEffect, useState } from "react";
import styles from "./scrollToTop.module.css";

interface ScrollToTopProps {
  checkSempra?: boolean;
}

export function ScrollToTop({ checkSempra = false }: ScrollToTopProps) {
  const [scrolled, setScrolled] = useState(false);
  const [overSempra, setOverSempra] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      setScrolled(scrollY > 60);

      if (checkSempra) {
        const sempraEl = document.getElementById("sempra");
        if (sempraEl) {
          const rect = sempraEl.getBoundingClientRect();
          setOverSempra(rect.top <= window.innerHeight - 90);
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [checkSempra]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const arrowColor = overSempra ? "#FBF6F0" : "#F5F6F7";

  return (
    <button
      type="button"
      onClick={scrollToTop}
      className={`${styles.btn} ${scrolled ? styles.visible : styles.hidden} ${overSempra ? styles.btnSempra : ""}`}
      aria-label="Remonter en haut de la page"
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
