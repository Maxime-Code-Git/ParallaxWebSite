import type { MetaFunction, HeadersFunction } from "react-router";
import styles from "./studios.module.css";

export const SEMPRA_URL = "https://sempra.be/fr/";
export const PARALLAX_URL = "https://parallax-creative-studio.com/fr";

export const meta: MetaFunction = () => {
  return [
    { title: "StudioLM — SEMPRA & Parallax" },
    {
      name: "description",
      content:
        "Portail StudioLM : découvrez SEMPRA (mariage) et Parallax (studio photo et création vidéo).",
    },
    { name: "robots", content: "noindex, nofollow" },
    { name: "googlebot", content: "noindex, nofollow" },
  ];
};

export const headers: HeadersFunction = () => {
  return {
    "X-Robots-Tag": "noindex, nofollow",
  };
};

export default function StudiosGateway() {
  return (
    <main className={styles.gatewayPage}>
      {/* Shared StudioLM Identity — dominant & not clickable */}
      <header className={styles.studioLmHeader}>
        <div className={styles.studioLmBrand}>
          <img
            src="/img/logo-studiolm.png"
            alt=""
            aria-hidden="true"
            className={styles.studioLmLogo}
            width="64"
            height="68"
          />
          <h1 className={styles.studioLmTitle}>StudioLM</h1>
        </div>
      </header>

      {/* Two destination panels */}
      <div className={styles.panelsContainer}>
        {/* SEMPRA Panel */}
        <a
          href={SEMPRA_URL}
          className={styles.panelSempra}
          aria-label="SEMPRA — Photographie et vidéo de mariage"
        >
          <img
            src="/img/projets-141c16b0a2.jpg"
            alt=""
            aria-hidden="true"
            className={styles.bgImage}
          />
          <div className={styles.sempraOverlay} aria-hidden="true" />

          <div className={styles.panelContent}>
            <div className={styles.sempraLogoWrap}>
              <img
                src="/img/img-73c121e112.png"
                alt="SEMPRA"
                className={styles.sempraLogo}
                width="280"
                height="89"
              />
            </div>
            <p className={styles.sempraText}>Photographie et vidéo de mariage</p>
            <span className={styles.sempraButton}>
              <span className={styles.buttonLabel}>Découvrir SEMPRA</span>
              <span className={styles.sempraButtonIcon} aria-hidden="true">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </span>
          </div>
        </a>

        {/* Visual junction divider between the two universes */}
        <div className={styles.junctionDivider} aria-hidden="true" />

        {/* Parallax Panel */}
        <a
          href={PARALLAX_URL}
          className={styles.panelParallax}
          aria-label="Parallax — Photographie et création vidéo"
        >
          <img
            src="/img/index-36b7cd6c87.jpg"
            alt=""
            aria-hidden="true"
            className={styles.bgImage}
          />
          <div className={styles.parallaxOverlay} aria-hidden="true" />

          <div className={styles.panelContent}>
            <div className={styles.parallaxLogoWrap}>
              <img
                src="/img/logo-parallax.png"
                alt=""
                aria-hidden="true"
                className={styles.parallaxLogo}
                width="64"
                height="67"
              />
              <span className={styles.parallaxBrandName}>Parallax</span>
            </div>
            <p className={styles.parallaxText}>Photographie et création vidéo</p>
            <span className={styles.parallaxButton}>
              <span className={styles.buttonLabel}>Découvrir Parallax</span>
              <span className={styles.parallaxButtonIcon} aria-hidden="true">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </span>
          </div>
        </a>
      </div>
    </main>
  );
}
