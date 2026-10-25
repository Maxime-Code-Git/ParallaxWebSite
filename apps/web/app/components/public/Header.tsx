import { useState } from "react";
import { Link } from "react-router";
import type { CommonContent } from "../../lib/site-content.shared";
import styles from "./header.module.css";

interface HeaderProps {
  common: CommonContent;
  lang: "fr" | "en";
  currentRoute: "home" | "studio" | "portfolio" | "contact" | "client-area" | "gallery" | "legal";
  alternateUrls?: { fr: string; en: string };
}

export function Header({ common, lang, currentRoute, alternateUrls }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const homeHref = `/${lang}`;
  const studioHref = `/${lang}/studio`;
  const contactHref = `/${lang}/contact`;
  const sempraHref = "https://sempra.be/";
  const portfolioHref = lang === "fr" ? "/fr/projets" : "/en/projects";
  const clientAreaHref = lang === "fr" ? "/fr/espace-client" : "/en/client-area";

  // Preserve page when switching language (supports custom alternateUrls for project/section slugs, galleries, or legal pages)
  const frSwitchHref =
    alternateUrls?.fr ||
    (currentRoute === "studio"
      ? "/fr/studio"
      : currentRoute === "contact"
      ? "/fr/contact"
      : currentRoute === "portfolio"
      ? "/fr/projets"
      : currentRoute === "client-area"
      ? "/fr/espace-client"
      : "/fr");
  const enSwitchHref =
    alternateUrls?.en ||
    (currentRoute === "studio"
      ? "/en/studio"
      : currentRoute === "contact"
      ? "/en/contact"
      : currentRoute === "portfolio"
      ? "/en/projects"
      : currentRoute === "client-area"
      ? "/en/client-area"
      : "/en");

  return (
    <>
      <header className={styles.header}>
        <Link to={homeHref} className={styles.brand}>
          <img
            src="/img/logo-parallax.png"
            alt={common.brandName}
            className={styles.logo}
          />
          <span className={styles.brandName}>{common.brandName}</span>
        </Link>

        <nav className={styles.nav}>
          <div className={`${styles.nav} ${styles.navLinksDesktop}`}>
            <Link
              to={portfolioHref}
              className={`${styles.navLink} ${currentRoute === "portfolio" ? styles.navLinkActive : ""}`}
            >
              {common.navigation.portfolio[lang]}
            </Link>
            <Link
              to={studioHref}
              className={`${styles.navLink} ${currentRoute === "studio" ? styles.navLinkActive : ""}`}
            >
              {common.navigation.studio[lang]}
            </Link>
            <Link
              to={contactHref}
              className={`${styles.navLink} ${currentRoute === "contact" ? styles.navLinkActive : ""}`}
              aria-current={currentRoute === "contact" ? "page" : undefined}
            >
              {common.navigation.contact[lang]}
            </Link>
            <a href={sempraHref} className={styles.navLink}>
              {common.navigation.sempra[lang]}
            </a>
          </div>

          <div className={styles.langSwitch}>
            <Link
              to={frSwitchHref}
              className={`${styles.langButton} ${lang === "fr" ? styles.langButtonActive : styles.langButtonInactive}`}
              aria-label="Version française"
              aria-current={lang === "fr" ? "true" : undefined}
            >
              FR
            </Link>
            <span className={styles.langDivider}>/</span>
            <Link
              to={enSwitchHref}
              className={`${styles.langButton} ${lang === "en" ? styles.langButtonActive : styles.langButtonInactive}`}
              aria-label="English version"
              aria-current={lang === "en" ? "true" : undefined}
            >
              EN
            </Link>
          </div>

          <Link to={clientAreaHref} className={styles.clientAreaButton}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#AEB6C6"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11 V8 a4 4 0 0 1 8 0 v3" />
            </svg>
            <span>{common.navigation.clientArea[lang]}</span>
          </Link>

          <button
            type="button"
            className={styles.burgerButton}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={mobileMenuOpen}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              {mobileMenuOpen ? (
                <>
                  <path d="M6 6 L18 18" />
                  <path d="M6 18 L18 6" />
                </>
              ) : (
                <>
                  <path d="M4 7 H20" />
                  <path d="M4 12 H20" />
                  <path d="M4 17 H20" />
                </>
              )}
            </svg>
          </button>
        </nav>
      </header>

      {mobileMenuOpen && (
        <div className={styles.mobileMenuOpen}>
          <Link
            to={portfolioHref}
            className={styles.mobileNavLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            {common.navigation.portfolio[lang]}
          </Link>
          <Link
            to={studioHref}
            className={styles.mobileNavLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            {common.navigation.studio[lang]}
          </Link>
          <Link
            to={contactHref}
            className={`${styles.mobileNavLink} ${currentRoute === "contact" ? styles.navLinkActive : ""}`}
            onClick={() => setMobileMenuOpen(false)}
            aria-current={currentRoute === "contact" ? "page" : undefined}
          >
            {common.navigation.contact[lang]}
          </Link>
          <a
            href={sempraHref}
            className={styles.mobileNavLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            {common.navigation.sempra[lang]}
          </a>
          <Link
            to={clientAreaHref}
            className={styles.mobileNavLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            {common.navigation.clientArea[lang]}
          </Link>
        </div>
      )}
    </>
  );
}
