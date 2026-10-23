import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { ScrollToTop } from "./ScrollToTop";
import {
  type CommonContent,
  type CompanyContent,
  type LegalDocument,
  type LegalPageKey,
  resolveCompanyTokens,
  isRpmApplicable,
} from "../../lib/site-content.shared";
import {
  setClientValidatedPreferences,
  fetchValidatedPreferences,
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
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (initialPreferences) {
      setClientValidatedPreferences(initialPreferences);
    }
    if (pageKey === "cookies") {
      let isSubscribed = true;
      void fetchValidatedPreferences().then((verified) => {
        if (isSubscribed) {
          setPrefs(verified);
        }
      });

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
      return () => {
        isSubscribed = false;
        window.removeEventListener("parallax:privacy-updated", handlePrivacyUpdated);
      };
    }
  }, [pageKey, initialPreferences]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFeedback(null);
    const submitEvent = e.nativeEvent as SubmitEvent;
    const submitter = submitEvent.submitter as HTMLButtonElement | null;
    const actionType = submitter?.value || "save";

    if (actionType === "revoke_all" || actionType === "refuse_all") {
      setPrefs({ youtube: false, vimeo: false });
      const success = await revokeAllProviderConsent();
      if (success) {
        setPrefs({ youtube: false, vimeo: false });
        setFeedback({
          type: "success",
          text: lang === "fr" ? "Tous les consentements ont été révoqués." : "All consents have been revoked.",
        });
      } else {
        setFeedback({
          type: "error",
          text: lang === "fr" ? "Erreur réseau lors de la révocation des consentements." : "Network error while revoking consents.",
        });
      }
    } else {
      const success = await persistProviderPreferences(prefs);
      if (success) {
        setFeedback({
          type: "success",
          text: lang === "fr" ? "Vos préférences ont été enregistrées avec succès." : "Your preferences have been saved successfully.",
        });
      } else {
        setFeedback({
          type: "error",
          text: lang === "fr" ? "Erreur réseau lors de l'enregistrement de vos préférences." : "Network error while saving your preferences.",
        });
      }
    }
  };

  const currentCanonicalUrl = alternateUrls[lang];

  const renderPreferencesCard = () => (
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
        onSubmit={handleSubmit}
      >
        <input type="hidden" name="returnTo" value={`${currentCanonicalUrl}#preferences`} />

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
            type="submit"
            name="action"
            value="revoke_all"
            className={styles.revokePrefsButton}
          >
            {lang === "fr" ? "Révoquer tous les consentements" : "Revoke all consents"}
          </button>
        </div>

        {feedback?.type === "success" && (
          <div role="status" className={styles.prefsStatusMsg}>
            {feedback.text}
          </div>
        )}
        {feedback?.type === "error" && (
          <div role="alert" className={styles.prefsErrorMsg}>
            {feedback.text}
          </div>
        )}
      </form>
    </div>
  );

  return (
    <div className={styles.pageRoot}>
      {isPreview && (
        <aside className={styles.previewBanner} aria-label="Bandeau de prévisualisation">
          <div className={styles.previewBannerInner}>
            <span className={styles.previewBadge}>Aperçu privé</span>
            <span>
              {lang === "fr"
                ? "Mode prévisualisation administrateur — ce document n'est pas public."
                : "Admin preview mode — this document is not public."}
            </span>
          </div>
          <span className={styles.previewSubtext}>noindex, no-store</span>
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

              {/* Preferences are available even before editorial publication */}
              {pageKey === "cookies" && renderPreferencesCard()}
            </div>
          </div>
        ) : (
          <>
            <section className={styles.titleSection}>
              <h1 className={styles.pageTitle}>
                {resolveCompanyTokens(document.publicTitle[lang], company, mode, lang)}
              </h1>
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
                  <p className={styles.introText}>
                    {resolveCompanyTokens(document.intro[lang], company, mode, lang)}
                  </p>
                )}

                {/* Mentions légales: Identity Grid */}
                {pageKey === "mentions" && company && (
                  <div className={styles.identityGrid}>
                    {/* Distinct Trade Name vs Legal Operator Name */}
                    {company.legalName && company.tradeName && company.legalName.trim() !== company.tradeName.trim() ? (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Nom commercial" : "Commercial brand"}
                        </div>
                        <div className={styles.identityValue}>{company.tradeName.trim()}</div>

                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Exploitant / Raison sociale" : "Legal entity / Operator"}
                        </div>
                        <div className={styles.identityValue}>
                          {company.legalName.trim()}
                          {company.legalForm && ` (${company.legalForm.trim()})`}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Éditeur du site" : "Site publisher"}
                        </div>
                        <div className={styles.identityValue}>
                          {company.legalName || company.tradeName || common.brandName}
                          {company.legalForm && ` (${company.legalForm.trim()})`}
                        </div>
                      </>
                    )}

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
                        <div className={styles.identityValue}>
                          {company.enterpriseNumber}
                          {isRpmApplicable(company) !== false && company.rpmJurisdiction && (
                            <span className={styles.metaSubtext}>
                              {" — "}
                              {lang === "fr"
                                ? `RPM : ${company.rpmJurisdiction}`
                                : `RPR: ${company.rpmJurisdiction}`}
                            </span>
                          )}
                        </div>
                      </>
                    )}

                    {company.vatNumber ? (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "N° de TVA" : "VAT number"}
                        </div>
                        <div className={styles.identityValue}>
                          {company.vatNumber}
                          {company.vatRegime && (
                            <span className={styles.metaSubtext}> ({company.vatRegime})</span>
                          )}
                        </div>
                      </>
                    ) : company.vatRegime ? (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Régime TVA" : "VAT regime"}
                        </div>
                        <div className={styles.identityValue}>
                          {company.vatRegime}
                        </div>
                      </>
                    ) : null}

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

                    {(company.privacyContact || company.privacyEmail || company.dpoContact) && (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Contact vie privée / RGPD" : "Privacy / GDPR contact"}
                        </div>
                        <div className={styles.identityValue}>
                          {company.privacyContact && <div>{company.privacyContact}</div>}
                          {company.privacyEmail && (
                            <div>
                              <a href={`mailto:${company.privacyEmail}`}>{company.privacyEmail}</a>
                            </div>
                          )}
                          {company.dpoDesignated && company.dpoContact && (
                            <div className={styles.metaSubtext}>
                              {lang === "fr" ? `DPO : ${company.dpoContact}` : `DPO: ${company.dpoContact}`}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {company.hostingProvider && (
                      <>
                        <div className={styles.identityLabel}>
                          {lang === "fr" ? "Hébergeur" : "Web host"}
                        </div>
                        <div className={styles.identityValue}>
                          {company.hostingProvider}
                          {company.hostingAddress && ` — ${company.hostingAddress}`}
                          {company.hostingCountry && ` (${company.hostingCountry})`}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Sections */}
                {document.sections.map((section) => (
                  <article key={section.id} className={styles.sectionBlock}>
                    <h2 className={styles.sectionTitle}>
                      {resolveCompanyTokens(section.title[lang], company, mode, lang)}
                    </h2>
                    {section.paragraphs.map((p, pIdx) => {
                      const text = resolveCompanyTokens(p[lang], company, mode, lang);
                      if (!text.trim()) return null;
                      return (
                        <p key={pIdx} className={styles.paragraph}>
                          {text}
                        </p>
                      );
                    })}
                    {section.listItems && section.listItems.length > 0 && (
                      <ul className={styles.list}>
                        {section.listItems.map((li, lIdx) => {
                          const text = resolveCompanyTokens(li[lang], company, mode, lang);
                          if (!text.trim()) return null;
                          return (
                            <li key={lIdx} className={styles.listItem}>
                              {text}
                            </li>
                          );
                        })}
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
                                  <td className={styles.cookieName}>
                                    {resolveCompanyTokens(item.name[lang], company, mode, lang)}
                                  </td>
                                  <td>{resolveCompanyTokens(item.provider[lang], company, mode, lang)}</td>
                                  <td>
                                    <span className={styles.categoryBadge}>{item.category}</span>
                                  </td>
                                  <td>{resolveCompanyTokens(item.purpose[lang], company, mode, lang)}</td>
                                  <td>{resolveCompanyTokens(item.duration[lang], company, mode, lang)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {renderPreferencesCard()}
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <Footer common={common} lang={lang} />
      <ScrollToTop />
    </div>
  );
}
