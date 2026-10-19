import type { LoaderFunctionArgs, HeadersArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import { getRawSiteContent } from "../../lib/site-content.server";
import {
  LEGAL_PAGE_KEYS,
  LEGAL_PAGE_URLS,
  COMPANY_TOKEN_LABELS,
  COMPANY_TOKEN_DETAILS,
  findDocumentUnresolvedCompanyTokens,
  type LegalPageKey,
  type LegalPagesContent,
  type CompanyContent,
} from "../../lib/site-content.shared";
import formStyles from "./adminForms.module.css";

export function meta() {
  return [
    { title: "Administration - Pages légales | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

const PAGE_METADATA: Record<LegalPageKey, { frTitle: string; enTitle: string; desc: string }> = {
  mentions: {
    frTitle: "Mentions légales",
    enTitle: "Legal Notice",
    desc: "Identification de l'exploitant, dénomination légale, forme, BCE, TVA, hébergeur et propriété intellectuelle.",
  },
  privacy: {
    frTitle: "Politique de confidentialité",
    enTitle: "Privacy Policy",
    desc: "Traitements de données, base légale, durées de conservation par finalité, destinataires réels et droits RGPD.",
  },
  terms: {
    frTitle: "Conditions générales des prestations",
    enTitle: "Terms of Service",
    desc: "Prestations photo/vidéo sur devis, livrables, délais, droits d'auteur, protections consommateurs B2C et litiges.",
  },
  cookies: {
    frTitle: "Cookies, traceurs et préférences",
    enTitle: "Cookie Policy",
    desc: "Inventaire technique réel des traceurs du code, lecteurs vidéo tiers (YouTube/Vimeo) et gestion des préférences.",
  },
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireValidAdminSession(request);
  const { content } = getRawSiteContent();

  return Response.json(
    {
      legalPages: content.legalPages,
      company: content.company,
      revision: content.revision,
    },
    { headers: createAdminHeaders() }
  );
}

export default function AdminLegalListPage() {
  const { legalPages, company, revision } = useLoaderData<{
    legalPages: LegalPagesContent;
    company: CompanyContent;
    revision: string;
  }>();

  return (
    <div className={formStyles.container}>
      <header className={formStyles.header}>
        <div className={formStyles.headerLeft}>
          <Link to="/admin/dashboard" className={formStyles.backLink}>
            ← Retour au tableau de bord
          </Link>
          <h1 className={formStyles.pageHeading}>Pages légales & Cookies</h1>
        </div>
      </header>

      <main className={formStyles.mainContent}>
        <div className={formStyles.topBar}>
          <div>
            <h2 className={formStyles.listHeaderTitle}>
              Documents légaux FR / EN
            </h2>
            <p className={formStyles.listHeaderSubtitle}>
              Rédaction bilingue complète reliée aux Paramètres de l'entreprise. Tous les documents sont enregistrés en brouillon pour relecture manuelle avant publication.
            </p>
          </div>
          <span className={formStyles.revisionTag}>Révision : {revision}</span>
        </div>

        <div className={formStyles.listGrid}>
          {LEGAL_PAGE_KEYS.map((key) => {
            const pageRecord = legalPages[key];
            const meta = PAGE_METADATA[key];
            const isPublished = Boolean(pageRecord.published);
            const publicUrls = LEGAL_PAGE_URLS[key];

            const unresolvedTokens = findDocumentUnresolvedCompanyTokens(pageRecord.draft, company);
            const missingLabels = unresolvedTokens.map(
              (t) => COMPANY_TOKEN_DETAILS[t]?.labelFr || COMPANY_TOKEN_LABELS[t]?.fr || t
            );
            const companyUnpublished = !company.isPublished;

            return (
              <div key={key} className={`${formStyles.card} ${formStyles.cardFlex}`}>
                <div className={formStyles.cardInfo}>
                  <div className={formStyles.cardTitleRow}>
                    <h3 className={formStyles.cardTitleHeading}>
                      {meta.frTitle} / {meta.enTitle}
                    </h3>
                    <span
                      className={
                        isPublished
                          ? formStyles.statusBadgePublished
                          : formStyles.statusBadgeDraft
                      }
                    >
                      {isPublished
                        ? `Publié (v${pageRecord.published?.version} | ${pageRecord.published?.effectiveDate})`
                        : "Brouillon non publié"}
                    </span>
                  </div>
                  <p className={formStyles.cardDesc}>
                    {meta.desc}
                  </p>

                  {/* Readiness & dependencies status */}
                  {key === "mentions" && companyUnpublished ? (
                    <div className={formStyles.readinessPending}>
                      <span>⚠️ Coordonnées juridiques non confirmées pour publication.</span>
                      <Link to="/admin/company" className={formStyles.readinessLink}>
                        Renseigner et confirmer dans Paramètres de l'entreprise →
                      </Link>
                    </div>
                  ) : unresolvedTokens.length > 0 ? (
                    <div className={formStyles.readinessPending}>
                      <span>
                        ⚠️ Informations à compléter dans Entreprise : {missingLabels.slice(0, 3).join(", ")}
                        {missingLabels.length > 3 ? ` (+${missingLabels.length - 3})` : ""}.
                      </span>
                      <Link to="/admin/company" className={formStyles.readinessLink}>
                        Modifier dans Paramètres de l'entreprise →
                      </Link>
                    </div>
                  ) : (
                    <div className={formStyles.readinessReady}>
                      <span>✓ Brouillon complet : prêt pour relecture et publication manuelle</span>
                    </div>
                  )}

                  {isPublished && (
                    <div className={formStyles.cardPublicLinks}>
                      <span className={formStyles.cardPublicLabel}>Accès public : </span>
                      <a
                        href={publicUrls.fr}
                        target="_blank"
                        rel="noreferrer"
                        className={formStyles.cardPublicLink}
                      >
                        FR ↗
                      </a>
                      <a
                        href={publicUrls.en}
                        target="_blank"
                        rel="noreferrer"
                        className={formStyles.cardPublicLinkLast}
                      >
                        EN ↗
                      </a>
                    </div>
                  )}
                </div>

                <div className={formStyles.cardButtonGroup}>
                  <Link
                    to={`/admin/legal/${key}/preview?lang=fr`}
                    className={formStyles.previewButton}
                  >
                    Aperçu FR
                  </Link>
                  <Link
                    to={`/admin/legal/${key}/preview?lang=en`}
                    className={formStyles.previewButton}
                  >
                    Aperçu EN
                  </Link>
                  <Link
                    to={`/admin/legal/${key}`}
                    className={`${formStyles.submitButton} ${formStyles.cardActionLink}`}
                  >
                    Modifier
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
