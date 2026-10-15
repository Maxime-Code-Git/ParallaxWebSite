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
  type LegalPageKey,
  type LegalPagesContent,
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
    desc: "Identification de l'éditeur du site, coordonnées, siège social, BCE, TVA et hébergeur.",
  },
  privacy: {
    frTitle: "Politique de confidentialité",
    enTitle: "Privacy Policy",
    desc: "Traitements de données, base légale, durées de conservation, finalités et droits des personnes (RGPD).",
  },
  terms: {
    frTitle: "Conditions générales de vente (CGV)",
    enTitle: "Terms of Service",
    desc: "Prestations photo/vidéo, devis, livrables, droits d'auteur, paiements et litiges.",
  },
  cookies: {
    frTitle: "Politique cookies et traceurs",
    enTitle: "Cookie Policy",
    desc: "Inventaire technique réel des traceurs et gestion du consentement pour les lecteurs externes.",
  },
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireValidAdminSession(request);
  const { content } = getRawSiteContent();

  return Response.json(
    {
      legalPages: content.legalPages,
      revision: content.revision,
    },
    { headers: createAdminHeaders() }
  );
}

export default function AdminLegalListPage() {
  const { legalPages, revision } = useLoaderData<{
    legalPages: LegalPagesContent;
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
              Édition bilingue, sauvegarde en brouillon et publication serveur explicite.
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
                        ? `Publié (v${pageRecord.published?.version} — ${pageRecord.published?.effectiveDate})`
                        : "Brouillon non publié"}
                    </span>
                  </div>
                  <p className={formStyles.cardDesc}>
                    {meta.desc}
                  </p>
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
                    to={`/admin/legal/${key}/preview`}
                    className={formStyles.previewButton}
                  >
                    Aperçu privé
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
