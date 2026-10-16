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

  const legalNoticeHref = lang === "fr" ? "/fr/mentions-legales" : "/en/legal-notice";
  const privacyHref = lang === "fr" ? "/fr/confidentialite" : "/en/privacy-policy";
  const termsHref = lang === "fr" ? "/fr/cgv" : "/en/terms";
  const cookiesHref = `/${lang}/cookies`;
  const prefsHref = `/${lang}/cookies#preferences`;
  const prefsLabel = lang === "fr" ? "Gérer mes préférences" : "Manage preferences";

  return (
    <footer className={containerClass}>
      <span className={styles.copyright}>{common.footer.copyright[lang]}</span>
      <nav className={styles.nav}>
        <Link to={legalNoticeHref} className={linkClass}>
          {common.footer.legalNotice[lang]}
        </Link>
        <Link to={privacyHref} className={linkClass}>
          {common.footer.privacy[lang]}
        </Link>
        <Link to={termsHref} className={linkClass}>
          {common.footer.terms[lang]}
        </Link>
        <Link to={cookiesHref} className={linkClass}>
          {common.footer.cookies[lang]}
        </Link>
        <Link to={prefsHref} className={linkClass}>
          {prefsLabel}
        </Link>
      </nav>
    </footer>
  );
}
