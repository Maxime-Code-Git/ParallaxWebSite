import { Link } from "react-router";
import type { CommonContent } from "../../lib/site-content.shared";
import styles from "./footer.module.css";

interface FooterProps {
  common: CommonContent;
  lang: "fr" | "en";
  theme?: "dark" | "sempra";
}

export function Footer({ common, lang, theme = "dark" }: FooterProps) {
  const isSempra = theme === "sempra";
  const containerClass = isSempra ? styles.footerSempra : styles.footerDark;
  const linkClass = isSempra ? styles.linkSempra : styles.linkDark;

  return (
    <footer className={containerClass}>
      <span className={styles.copyright}>{common.footer.copyright[lang]}</span>
      <nav className={styles.nav}>
        <Link to={`/${lang}/mentions-legales`} className={linkClass}>
          {common.footer.legalNotice[lang]}
        </Link>
        <Link to={`/${lang}/confidentialite`} className={linkClass}>
          {common.footer.privacy[lang]}
        </Link>
        <Link to={`/${lang}/cgv`} className={linkClass}>
          {common.footer.terms[lang]}
        </Link>
        <Link to={`/${lang}/cookies`} className={linkClass}>
          {common.footer.cookies[lang]}
        </Link>
      </nav>
    </footer>
  );
}
