import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import {
  validateOrigin,
  readStrictFormUrlEncoded,
  ActionSecurityError,
} from "../../lib/security.server";
import { constantTimeEqual } from "../../lib/auth.server";
import {
  getRawSiteContent,
  saveLegalPageDraft,
  publishLegalPage,
  unpublishLegalPage,
  RevisionConflictError,
  ValidationError,
} from "../../lib/site-content.server";
import {
  LEGAL_PAGE_KEYS,
  type LegalPageKey,
  type LegalDocument,
  type LegalPageRecord,
} from "../../lib/site-content.shared";
import formStyles from "./adminForms.module.css";

export function meta() {
  return [
    { title: "Administration - Édition page légale | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const pageKey = params.pageKey as LegalPageKey;

  if (!LEGAL_PAGE_KEYS.includes(pageKey)) {
    throw new Response("Not Found", { status: 404 });
  }

  const { content, isCorrupted } = getRawSiteContent();
  const csrfToken = session.get("csrfToken") || "";
  const pageRecord = content.legalPages[pageKey];

  return Response.json(
    {
      csrfToken,
      pageKey,
      pageRecord,
      revision: content.revision,
      isCorrupted,
    },
    { headers: createAdminHeaders() }
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const headers = createAdminHeaders();
  if (request.method !== "POST") {
    headers.set("Allow", "POST");
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  const session = await requireValidAdminSession(request);
  if (!validateOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers });
  }

  const pageKey = params.pageKey as LegalPageKey;
  if (!LEGAL_PAGE_KEYS.includes(pageKey)) {
    return new Response("Not Found", { status: 404, headers });
  }

  let formData: URLSearchParams;
  try {
    formData = await readStrictFormUrlEncoded(request, 250 * 1024, [
      "csrfToken",
      "revision",
      "intent",
      "draftData",
      "effectiveDate",
    ]);
  } catch (err) {
    if (err instanceof ActionSecurityError) {
      if (err.status === 405) headers.set("Allow", "POST");
      return new Response(err.message, { status: err.status, headers });
    }
    return new Response("Bad Request", { status: 400, headers });
  }

  const csrfToken = String(formData.get("csrfToken") || "");
  const sessionCsrf = session.get("csrfToken") || "";
  if (!csrfToken || !constantTimeEqual(csrfToken, sessionCsrf)) {
    return Response.json({ error: "Jeton CSRF invalide." }, { status: 403, headers });
  }

  const revision = String(formData.get("revision") || "");
  const intent = String(formData.get("intent") || "save_draft");

  try {
    if (intent === "save_draft") {
      const rawDraft = String(formData.get("draftData") || "");
      let draftData: LegalDocument;
      try {
        draftData = JSON.parse(rawDraft);
      } catch {
        return Response.json({ error: "Données de brouillon invalides." }, { status: 400, headers });
      }

      const newRevision = saveLegalPageDraft(pageKey, draftData, revision);
      const updated = getRawSiteContent().content;
      return Response.json(
        {
          success: true,
          action: "save_draft",
          newRevision,
          pageRecord: updated.legalPages[pageKey],
        },
        { headers }
      );
    }

    if (intent === "publish") {
      const effectiveDate = String(formData.get("effectiveDate") || "").trim() || undefined;
      const newRevision = publishLegalPage(pageKey, revision, effectiveDate);
      const updated = getRawSiteContent().content;
      return Response.json(
        {
          success: true,
          action: "publish",
          newRevision,
          pageRecord: updated.legalPages[pageKey],
        },
        { headers }
      );
    }

    if (intent === "unpublish") {
      const newRevision = unpublishLegalPage(pageKey, revision);
      const updated = getRawSiteContent().content;
      return Response.json(
        {
          success: true,
          action: "unpublish",
          newRevision,
          pageRecord: updated.legalPages[pageKey],
        },
        { headers }
      );
    }

    return Response.json({ error: "Action inconnue." }, { status: 400, headers });
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      return Response.json(
        {
          error:
            "Conflit de révision : le contenu a été modifié sur le serveur. Vos modifications locales ont été conservées.",
          conflict: true,
          serverRevision: err.serverRevision,
        },
        { status: 409, headers }
      );
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400, headers });
    }
    return Response.json(
      { error: "Une erreur est survenue lors du traitement." },
      { status: 500, headers }
    );
  }
}

export default function AdminLegalEditPage() {
  const { csrfToken, pageKey, pageRecord: initialRecord, revision: initialRevision } =
    useLoaderData<{
      csrfToken: string;
      pageKey: LegalPageKey;
      pageRecord: LegalPageRecord;
      revision: string;
      isCorrupted: boolean;
    }>();

  const [activeLang, setActiveLang] = useState<"fr" | "en">("fr");
  const [pageRecord, setPageRecord] = useState<LegalPageRecord>(initialRecord);
  const [draft, setDraft] = useState<LegalDocument>(initialRecord.draft);
  const [currentRevision, setCurrentRevision] = useState<string>(initialRevision);
  const [effectiveDate, setEffectiveDate] = useState<string>(
    initialRecord.draft.effectiveDate || new Date().toISOString().split("T")[0]
  );
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const [conflictRevision, setConflictRevision] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPublished = Boolean(pageRecord.published);

  const handleLocalizedFieldChange = (
    field: "publicTitle" | "seoTitle" | "seoDescription" | "intro",
    value: string
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        [activeLang]: value,
      },
    }));
  };

  const handleSectionTitleChange = (sectionIdx: number, value: string) => {
    setDraft((prev) => {
      const nextSections = [...prev.sections];
      nextSections[sectionIdx] = {
        ...nextSections[sectionIdx],
        title: {
          ...nextSections[sectionIdx].title,
          [activeLang]: value,
        },
      };
      return { ...prev, sections: nextSections };
    });
  };

  const handleSectionParagraphsChange = (sectionIdx: number, text: string) => {
    // Split by newlines into paragraphs
    const paragraphs = text
      .split("\n\n")
      .map((p) => p.trim())
      .filter(Boolean);

    setDraft((prev) => {
      const nextSections = [...prev.sections];
      const currentSec = nextSections[sectionIdx];
      const otherLang = activeLang === "fr" ? "en" : "fr";

      const updatedParagraphs = paragraphs.map((p, pIdx) => ({
        [activeLang]: p,
        [otherLang]: currentSec.paragraphs[pIdx]?.[otherLang] || "",
      })) as { fr: string; en: string }[];

      nextSections[sectionIdx] = {
        ...currentSec,
        paragraphs: updatedParagraphs,
      };
      return { ...prev, sections: nextSections };
    });
  };

  const executeAction = async (intent: "save_draft" | "publish" | "unpublish") => {
    setIsSubmitting(true);
    setFeedback(null);
    setConflictRevision(null);

    const body = new URLSearchParams();
    body.set("csrfToken", csrfToken);
    body.set("revision", currentRevision);
    body.set("intent", intent);

    if (intent === "save_draft") {
      body.set("draftData", JSON.stringify(draft));
    } else if (intent === "publish") {
      body.set("effectiveDate", effectiveDate);
    }

    try {
      const res = await fetch(`/admin/legal/${pageKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentRevision(data.newRevision);
        setPageRecord(data.pageRecord);
        setDraft(data.pageRecord.draft);

        if (intent === "save_draft") {
          setFeedback({
            type: "success",
            text: "Brouillon enregistré avec succès. La version publiée reste inchangée.",
          });
        } else if (intent === "publish") {
          setFeedback({
            type: "success",
            text: `Document publié avec succès (version ${data.pageRecord.published?.version} du ${data.pageRecord.published?.effectiveDate}).`,
          });
        } else if (intent === "unpublish") {
          setFeedback({
            type: "success",
            text: "Document dépublié. Le document public affichera désormais un état neutre en attente.",
          });
        }
      } else {
        if (data.conflict) {
          setConflictRevision(data.serverRevision);
        }
        setFeedback({
          type: "error",
          text: data.error || "Une erreur est survenue.",
        });
      }
    } catch {
      setFeedback({
        type: "error",
        text: "Erreur réseau lors de la communication avec le serveur.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={formStyles.container}>
      <header className={formStyles.header}>
        <div className={formStyles.headerLeft}>
          <Link to="/admin/legal" className={formStyles.backLink}>
            ← Retour à la liste
          </Link>
          <h1 className={formStyles.pageHeading}>Édition : {draft.publicTitle.fr}</h1>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <Link
            to={`/admin/legal/${pageKey}/preview`}
            target="_blank"
            className={formStyles.langTab}
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--px-border)",
              color: "var(--px-text)",
              textDecoration: "none",
            }}
          >
            Aperçu privé ↗
          </Link>
        </div>
      </header>

      <main className={formStyles.mainContent}>
        <div className={formStyles.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <span className={formStyles.revisionTag}>Révision : {currentRevision}</span>
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

          <div className={formStyles.langTabs}>
            <button
              type="button"
              className={`${formStyles.langTab} ${activeLang === "fr" ? formStyles.langTabActive : ""}`}
              onClick={() => setActiveLang("fr")}
            >
              Français (FR)
            </button>
            <button
              type="button"
              className={`${formStyles.langTab} ${activeLang === "en" ? formStyles.langTabActive : ""}`}
              onClick={() => setActiveLang("en")}
            >
              English (EN)
            </button>
          </div>
        </div>

        {feedback && (
          <div
            role={feedback.type === "error" ? "alert" : "status"}
            className={
              feedback.type === "error" ? formStyles.statusError : formStyles.statusSuccess
            }
            style={{ marginBottom: "24px" }}
          >
            {feedback.text}
            {conflictRevision && (
              <div style={{ marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentRevision(conflictRevision);
                    setConflictRevision(null);
                    setFeedback({
                      type: "error",
                      text: "Révision serveur adoptée. Vous pouvez maintenant soumettre à nouveau.",
                    });
                  }}
                  className={formStyles.langTab}
                  style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
                >
                  Adopter la révision du serveur ({conflictRevision})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Global Page Information */}
        <div className={formStyles.card} style={{ marginBottom: "28px" }}>
          <h2 className={formStyles.cardTitle}>En-tête & Métadonnées SEO ({activeLang.toUpperCase()})</h2>

          <div className={formStyles.field}>
            <label className={formStyles.label}>Titre public affiché ({activeLang.toUpperCase()})</label>
            <input
              type="text"
              className={formStyles.input}
              value={draft.publicTitle[activeLang]}
              onChange={(e) => handleLocalizedFieldChange("publicTitle", e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div className={formStyles.field}>
              <label className={formStyles.label}>Titre SEO ({activeLang.toUpperCase()})</label>
              <input
                type="text"
                className={formStyles.input}
                value={draft.seoTitle[activeLang]}
                onChange={(e) => handleLocalizedFieldChange("seoTitle", e.target.value)}
              />
            </div>

            <div className={formStyles.field}>
              <label className={formStyles.label}>Description SEO ({activeLang.toUpperCase()})</label>
              <input
                type="text"
                className={formStyles.input}
                value={draft.seoDescription[activeLang]}
                onChange={(e) => handleLocalizedFieldChange("seoDescription", e.target.value)}
              />
            </div>
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label}>Introduction ({activeLang.toUpperCase()})</label>
            <textarea
              className={formStyles.textarea}
              rows={3}
              value={draft.intro[activeLang]}
              onChange={(e) => handleLocalizedFieldChange("intro", e.target.value)}
            />
          </div>
        </div>

        {/* Sections */}
        <div className={formStyles.card} style={{ marginBottom: "28px" }}>
          <h2 className={formStyles.cardTitle}>Sections du document ({activeLang.toUpperCase()})</h2>
          <p className={formStyles.helper}>
            Chaque section correspond à un paragraphe ou un chapitre structuré. Séparez les paragraphes par une ligne vide.
          </p>

          {draft.sections.map((section, sIdx) => {
            const paragraphsText = section.paragraphs
              .map((p) => p[activeLang])
              .join("\n\n");

            return (
              <div
                key={section.id}
                style={{
                  borderTop: sIdx > 0 ? "1px solid var(--px-line)" : "none",
                  paddingTop: sIdx > 0 ? "24px" : 0,
                  marginTop: sIdx > 0 ? "24px" : 0,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--px-text-3)" }}>
                    Section ID: #{section.id}
                  </span>
                </div>

                <div className={formStyles.field}>
                  <label className={formStyles.label}>Titre de section ({activeLang.toUpperCase()})</label>
                  <input
                    type="text"
                    className={formStyles.input}
                    value={section.title[activeLang]}
                    onChange={(e) => handleSectionTitleChange(sIdx, e.target.value)}
                  />
                </div>

                <div className={formStyles.field}>
                  <label className={formStyles.label}>Paragraphes ({activeLang.toUpperCase()})</label>
                  <textarea
                    className={formStyles.textarea}
                    rows={4}
                    value={paragraphsText}
                    onChange={(e) => handleSectionParagraphsChange(sIdx, e.target.value)}
                    placeholder="Saisissez le texte des paragraphes, séparés par un saut de ligne..."
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Cookie Inventory (only for cookies page) */}
        {pageKey === "cookies" && draft.inventory && (
          <div className={formStyles.card} style={{ marginBottom: "28px" }}>
            <h2 className={formStyles.cardTitle}>Inventaire des cookies & traceurs</h2>
            <p className={formStyles.helper}>
              Tableau des cookies techniques et préférences déployés sur Parallax.
            </p>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--px-line)", textAlign: "left" }}>
                    <th style={{ padding: "8px" }}>Nom</th>
                    <th style={{ padding: "8px" }}>Fournisseur</th>
                    <th style={{ padding: "8px" }}>Catégorie</th>
                    <th style={{ padding: "8px" }}>Durée</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.inventory.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{item.name.fr}</td>
                      <td style={{ padding: "8px" }}>{item.provider.fr}</td>
                      <td style={{ padding: "8px" }}>{item.category}</td>
                      <td style={{ padding: "8px" }}>{item.duration.fr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
            marginTop: "32px",
            padding: "24px",
            background: "var(--px-surface)",
            borderRadius: "var(--r-card)",
            border: "1px solid var(--px-border)",
          }}
        >
          <div>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => executeAction("save_draft")}
              className={formStyles.langTab}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid var(--px-border)",
                color: "var(--px-text)",
                padding: "10px 24px",
              }}
            >
              {isSubmitting ? "Enregistrement..." : "Enregistrer le brouillon"}
            </button>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <label htmlFor="pub-effectiveDate" style={{ fontSize: "13px", color: "var(--px-text-2)" }}>
                Date d'effet :
              </label>
              <input
                id="pub-effectiveDate"
                type="text"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                style={{
                  background: "var(--px-ink)",
                  border: "1px solid var(--px-border)",
                  borderRadius: "var(--r-input)",
                  color: "var(--px-text)",
                  padding: "6px 12px",
                  fontSize: "13px",
                  width: "140px",
                }}
              />
            </div>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => executeAction("publish")}
              className={formStyles.submitButton}
            >
              {isSubmitting ? "Publication..." : "Publier cette version"}
            </button>

            {isPublished && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  if (confirm("Êtes-vous sûr de vouloir dépublier ce document ? La page publique affichera un état neutre en attente.")) {
                    executeAction("unpublish");
                  }
                }}
                className={formStyles.langTab}
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  padding: "10px 18px",
                }}
              >
                Dépublier
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
