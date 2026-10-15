import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import type {
  CommonContent,
  CompanyContent,
  LegalDocument,
  LegalPageKey,
} from "../../lib/site-content.shared";
import {
  parseClientPrivacyCookie,
  persistProviderPreferences,
  revokeAllProviderConsent,
} from "../../lib/privacy-client";
import styles from "./legal.module.css";

interface LegalPageViewProps {
  mode?: "public" | "preview";
  lang: "fr" | "en";
  pageKey: LegalPageKey;
  common: CommonContent;
  company: Partial<CompanyContent> | null;
  document: LegalDocument | null;
  alternateUrls: { fr: string; en: string };
  initialPreferences?: { youtube: boolean; vimeo: boolean };
}

export function LegalPageView({
  mode = "public",
  lang,
  pageKey,
  common,
  company,
  document,
  alternateUrls,
  initialPreferences = { youtube: false, vimeo: false },
}: LegalPageViewProps) {
  const isPreview = mode === "preview";

  // Client-side privacy preferences state
  const [prefs, setPrefs] = useState<{ youtube: boolean; vimeo: boolean }>(initialPreferences);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    if (pageKey === "cookies") {
      const clientPrefs = parseClientPrivacyCookie();
      setPrefs(clientPrefs);

      function handlePrivacyUpdated(e: Event) {
        const customEvent = e as CustomEvent<{ youtube?: boolean; vimeo?: boolean }>;
        if (customEvent.detail) {
          setPrefs((prev) => ({
            youtube: customEvent.detail.youtube !== undefined ? customEvent.detail.youtube : prev.youtube,
            vimeo: customEvent.detail.vimeo !== undefined ? customEvent.detail.vimeo : prev.vimeo,
          }));
        }
      }

      window.addEventListener("parallax:privacy-updated", handlePrivacyUpdated);
      return () => window.removeEventListener("parallax:privacy-updated", handlePrivacyUpdated);
    }
  }, [pageKey]);

  const handleClientSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaveStatus(null);
    const success = await persistProviderPreferences(prefs);
    if (success) {
      setSaveStatus(
        lang === "fr"
          ? "Vos préférences ont été enregistrées avec succès."
          : "Your preferences have been saved successfully."
      );
    }
  };

  const handleClientRevoke = async () => {
    setSaveStatus(null);
    const success = await revokeAllProviderConsent();
    if (success) {
      setPrefs({ youtube: false, vimeo: false });
      setSaveStatus(
        lang === "fr"
          ? "Tous les consentements ont été révoqués."
          : "All consents have been revoked."
      );
    }
  };

  const currentCanonicalUrl = alternateUrls[lang];

  return (
    <div className={styles.pageRoot}>
      {isPreview && (
        <aside className={styles.previewBanner} aria-label="Bandeau de prévisualisation">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className={styles.previewBadge}>Aperçu privé</span>
            <span>
              {lang === "fr"
                ? "Mode prévisualisation administrateur — ce document n'est pas public."
                : "Admin preview mode — this document is not public."}
            </span>
          </div>
          <span style={{ fontSize: "12px", opacity: 0.85 }}>noindex, no-store</span>
        </aside>
      )}

      <Header
        common={common}
        lang={lang}
        currentRoute="legal"
        alternateUrls={alternateUrls}
      />

      <main className={styles.mainContent}>
        {!document ? (
          <div className={styles.contentSection}>
            <div className={styles.contentWrapper}>
              <div className={styles.unpublishedBox}>
                <h1 className={styles.unpublishedTitle}>
                  {lang === "fr"
                    ? "Document en cours de préparation"
                    : "Document under preparation"}
                </h1>
                <p className={styles.unpublishedText}>
                  {lang === "fr"
                    ? "Ce document n'est pas encore publié. Veuillez revenir ultérieurement."
                    : "This document has not been published yet. Please check back later."}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <section className={styles.titleSection}>
              <h1 className={styles.pageTitle}>{document.publicTitle[lang]}</h1>
              {document.effectiveDate ? (
                <p className={styles.metaNotice}>
                  {lang === "fr"
                    ? `Dernière mise à jour : ${document.effectiveDate} (v${document.version})`
                    : `Last updated: ${document.effectiveDate} (v${document.version})`}
                </p>
              ) : isPreview ? (
                <p className={styles.metaNotice}>
                  <em>{lang === "fr" ? "Brouillon non publié" : "Unpublished draft"}</em>
                </p>
              ) : null}
            </section>

            <section className={styles.contentSection}>
              <div className={styles.contentWrapper}>
                {document.intro[lang] && (
                  <p className={styles.introText}>{document.intro[lang]}</p>
                )}

                {/* Mentions légales: Identity Grid */}
                {pageKey === "mentions" && company && (
                  <div className={styles.identityGrid}>
                    <div className={styles.identityLabel}>
                      {lang === "fr" ? "Éditeur du site" : "Site publisher"}
                    </div>
                    <div className={styles.identityValue}>
                      {company.tradeName || company.legalName || common.brandName}
                      {company.legalForm && ` (${company.legalForm})`}
                    </div>

                    {company.address && (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Siège social" : "Registered office"}
                        </div>
                        <div className={styles.identityValue}>{company.address}</div>
                      </>
                    )}

                    {company.enterpriseNumber && (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "N° d'entreprise (BCE)" : "Company number (BCE)"}
                        </div>
                        <div className={styles.identityValue}>{company.enterpriseNumber}</div>
                      </>
                    )}

                    {company.vatNumber && (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "N° de TVA" : "VAT number"}
                        </div>
                        <div className={styles.identityValue}>{company.vatNumber}</div>
                      </>
                    )}

                    {company.publicationDirector && (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Directeur de la publication" : "Publication director"}
                        </div>
                        <div className={styles.identityValue}>{company.publicationDirector}</div>
                      </>
                    )}

                    <div className={styles.identityLabel}>Contact</div>
                    <div className={styles.identityValue}>
                      {company.email && (
                        <div>
                          <a href={`mailto:${company.email}`}>{company.email}</a>
                        </div>
                      )}
                      {company.phone && (
                        <div>
                          <a href={`tel:${company.phone}`}>{company.phone}</a>
                        </div>
                      )}
                    </div>

                    {company.hostingProvider && (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Hébergeur" : "Web host"}
                        </div>
                        <div className={styles.identityValue}>
                          {company.hostingProvider}
                          {company.hostingAddress && ` — ${company.hostingAddress}`}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Sections */}
                {document.sections.map((section) => (
                  <article key={section.id} className={styles.sectionBlock}>
                    <h2 className={styles.sectionTitle}>{section.title[lang]}</h2>
                    {section.paragraphs.map((p, pIdx) => (
                      <p key={pIdx} className={styles.paragraph}>
                        {p[lang]}
                      </p>
                    ))}
                    {section.listItems && section.listItems.length > 0 && (
                      <ul className={styles.list}>
                        {section.listItems.map((li, lIdx) => (
                          <li key={lIdx} className={styles.listItem}>
                            {li[lang]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}

                {/* Cookies Page: Inventory Table & Preferences Panel */}
                {pageKey === "cookies" && (
                  <>
                    {document.inventory && document.inventory.length > 0 && (
                      <div className={styles.sectionBlock}>
                        <h2 className={styles.sectionTitle}>
                          {lang === "fr" ? "Inventaire des cookies et stockages" : "Cookie and storage inventory"}
                        </h2>
                        <div className={styles.tableWrapper}>
                          <table className={styles.cookieTable}>
                            <thead>
                              <tr>
                                <th>{lang === "fr" ? "Nom" : "Name"}</th>
                                <th>{lang === "fr" ? "Fournisseur" : "Provider"}</th>
                                <th>{lang === "fr" ? "Catégorie" : "Category"}</th>
                                <th>{lang === "fr" ? "Finalité" : "Purpose"}</th>
                                <th>{lang === "fr" ? "Durée" : "Duration"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {document.inventory.map((item) => (
                                <tr key={item.id}>
                                  <td className={styles.cookieName}>{item.name[lang]}</td>
                                  <td>{item.provider[lang]}</td>
                                  <td>
                                    <span className={styles.categoryBadge}>{item.category}</span>
                                  </td>
                                  <td>{item.purpose[lang]}</td>
                                  <td>{item.duration[lang]}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Preferences Management Card */}
                    <div id="preferences" className={styles.preferencesCard}>
                      <h2 className={styles.preferencesCardTitle}>
                        {lang === "fr" ? "Gestion de vos préférences" : "Manage your preferences"}
                      </h2>
                      <p className={styles.preferencesCardDesc}>
                        {lang === "fr"
                          ? "Par défaut, aucun lecteur externe (YouTube ou Vimeo) n'est chargé sans votre autorisation préalable. Vous pouvez mémoriser vos préférences ici pour une durée maximale de 6 mois, ou révoquer vos choix à tout moment."
                          : "By default, no third-party player (YouTube or Vimeo) is loaded without your prior authorization. You can save your preferences here for up to 6 months, or revoke them at any time."}
                      </p>

                      <form
                        method="POST"
                        action="/api/privacy/preferences"
                        onSubmit={handleClientSave}
                      >
                        <input type="hidden" name="returnTo" value={currentCanonicalUrl} />

                        <div className={styles.preferenceItem}>
                          <input
                            type="checkbox"
                            id="pref-youtube"
                            name="youtube"
                            value="true"
                            checked={prefs.youtube}
                            onChange={(e) => setPrefs({ ...prefs, youtube: e.target.checked })}
                            className={styles.preferenceCheckbox}
                          />
                          <div className={styles.preferenceLabelGroup}>
                            <label htmlFor="pref-youtube" className={styles.preferenceLabel}>
                              YouTube
                            </label>
                            <span className={styles.preferenceSubtext}>
                              {lang === "fr"
                                ? "Autoriser le chargement des vidéos YouTube dans le lecteur du site."
                                : "Allow YouTube videos to load in the site player."}
                            </span>
                          </div>
                        </div>

                        <div className={styles.preferenceItem}>
                          <input
                            type="checkbox"
                            id="pref-vimeo"
                            name="vimeo"
                            value="true"
                            checked={prefs.vimeo}
                            onChange={(e) => setPrefs({ ...prefs, vimeo: e.target.checked })}
                            className={styles.preferenceCheckbox}
                          />
                          <div className={styles.preferenceLabelGroup}>
                            <label htmlFor="pref-vimeo" className={styles.preferenceLabel}>
                              Vimeo
                            </label>
                            <span className={styles.preferenceSubtext}>
                              {lang === "fr"
                                ? "Autoriser le chargement des vidéos Vimeo dans le lecteur du site."
                                : "Allow Vimeo videos to load in the site player."}
                            </span>
                          </div>
                        </div>

                        <div className={styles.preferencesActions}>
                          <button
                            type="submit"
                            name="action"
                            value="save"
                            className={styles.savePrefsButton}
                          >
                            {lang === "fr" ? "Enregistrer mes choix" : "Save my choices"}
                          </button>
                          <button
                            type="button"
                            onClick={handleClientRevoke}
                            className={styles.revokePrefsButton}
                          >
                            {lang === "fr" ? "Révoquer tous les consentements" : "Revoke all consents"}
                          </button>
                        </div>

                        {saveStatus && (
                          <div role="status" className={styles.prefsStatusMsg}>
                            {saveStatus}
                          </div>
                        )}
                      </form>
                    </div>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <Footer common={common} lang={lang} />
    </div>
  );
}
