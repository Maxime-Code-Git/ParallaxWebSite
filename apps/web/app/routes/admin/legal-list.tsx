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
            <h2 style={{ fontSize: "24px", margin: "0 0 8px", color: "var(--px-text)" }}>
              Documents légaux FR / EN
            </h2>
            <p style={{ color: "var(--px-text-2)", margin: 0, fontSize: "14px" }}>
              Édition bilingue, sauvegarde en brouillon et publication serveur explicite.
            </p>
          </div>
          <span className={formStyles.revisionTag}>Révision : {revision}</span>
        </div>

        <div style={{ display: "grid", gap: "24px", marginTop: "32px" }}>
          {LEGAL_PAGE_KEYS.map((key) => {
            const pageRecord = legalPages[key];
            const meta = PAGE_METADATA[key];
            const isPublished = Boolean(pageRecord.published);
            const publicUrls = LEGAL_PAGE_URLS[key];

            return (
              <div
                key={key}
                className={formStyles.card}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "20px",
                }}
              >
                <div style={{ maxWidth: "600px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <h3 style={{ margin: 0, fontSize: "18px", color: "var(--px-text)" }}>
                      {meta.frTitle} / {meta.enTitle}
                    </h3>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: "999px",
                        fontSize: "12px",
                        fontWeight: 500,
                        background: isPublished ? "rgba(52, 211, 153, 0.15)" : "rgba(245, 158, 11, 0.15)",
                        color: isPublished ? "#34d399" : "#f59e0b",
                        border: isPublished
                          ? "1px solid rgba(52, 211, 153, 0.3)"
                          : "1px solid rgba(245, 158, 11, 0.3)",
                      }}
                    >
                      {isPublished
                        ? `Publié (v${pageRecord.published?.version} — ${pageRecord.published?.effectiveDate})`
                        : "Brouillon non publié"}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "14px", color: "var(--px-text-2)", lineHeight: 1.5 }}>
                    {meta.desc}
                  </p>
                  {isPublished && (
                    <div style={{ marginTop: "10px", fontSize: "13px" }}>
                      <span style={{ color: "var(--px-text-3)" }}>Accès public : </span>
                      <a
                        href={publicUrls.fr}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--px-accent)", textDecoration: "none", marginRight: "12px" }}
                      >
                        FR ↗
                      </a>
                      <a
                        href={publicUrls.en}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--px-accent)", textDecoration: "none" }}
                      >
                        EN ↗
                      </a>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <Link
                    to={`/admin/legal/${key}/preview`}
                    className={formStyles.langTab}
                    style={{
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid var(--px-border)",
                      color: "var(--px-text)",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    Aperçu privé
                  </Link>
                  <Link
                    to={`/admin/legal/${key}`}
                    className={formStyles.submitButton}
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
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
