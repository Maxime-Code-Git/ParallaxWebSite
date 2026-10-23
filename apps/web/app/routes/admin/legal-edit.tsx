import { useState, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
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
  type LegalSection,
  type LocalizedString,
  type CompanyContent,
  DEFAULT_COMPANY_CONTENT,
  resolveCompanyTokens,
  isRpmApplicable,
  isRpmOnlyParagraph,
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

  const { content, isCorrupted, corruptionError } = getRawSiteContent();
  const csrfToken = session.get("csrfToken") || "";
  const pageRecord = content.legalPages[pageKey];

  return Response.json(
    {
      csrfToken,
      pageKey,
      pageRecord,
      company: content.company,
      revision: content.revision,
      isCorrupted,
      corruptionError: isCorrupted ? (corruptionError || "Erreur de format ou de validation") : undefined,
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
      "clientEditCount",
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
  const clientEditCount = formData.get("clientEditCount");

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
          clientEditCount,
        },
        { headers }
      );
    }

    if (intent === "publish") {
      let candidateDraft: LegalDocument | undefined;
      const rawDraft = String(formData.get("draftData") || "");
      if (rawDraft) {
        try {
          candidateDraft = JSON.parse(rawDraft);
        } catch {
          return Response.json({ error: "Données de brouillon invalides." }, { status: 400, headers });
        }
      }
      const effectiveDate = String(formData.get("effectiveDate") || "").trim() || undefined;
      // Atomic publish: validates candidate draft and conditions before any disk write.
      // If validation fails, zero mutations occur on disk and the revision remains unchanged.
      const newRevision = publishLegalPage(pageKey, revision, effectiveDate, candidateDraft);
      const updated = getRawSiteContent().content;
      return Response.json(
        {
          success: true,
          action: "publish",
          newRevision,
          pageRecord: updated.legalPages[pageKey],
          clientEditCount,
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
          clientEditCount,
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
      return Response.json(
        {
          error: err.message,
          serverRevision: revision,
        },
        { status: 400, headers }
      );
    }
    return Response.json(
      { error: "Une erreur est survenue lors du traitement." },
      { status: 500, headers }
    );
  }
}

interface ActionResponseData {
  success?: boolean;
  action?: "save_draft" | "publish" | "unpublish";
  newRevision?: string;
  pageRecord?: LegalPageRecord;
  error?: string;
  conflict?: boolean;
  serverRevision?: string;
  clientEditCount?: string | null;
}

export default function AdminLegalEditPage() {
  const loaderData = useLoaderData<{
    csrfToken: string;
    pageKey: LegalPageKey;
    pageRecord: LegalPageRecord;
    company?: CompanyContent;
    revision: string;
    isCorrupted: boolean;
    corruptionError?: string;
  }>();
  const { csrfToken, pageKey, pageRecord: initialRecord, revision: initialRevision, isCorrupted, corruptionError } = loaderData;
  const company = loaderData.company || DEFAULT_COMPANY_CONTENT;

  const fetcher = useFetcher<ActionResponseData>();
  const isSubmitting = fetcher.state === "submitting" || fetcher.state === "loading";

  const [activeLang, setActiveLang] = useState<"fr" | "en">("fr");
  const [showResolvedPreview, setShowResolvedPreview] = useState(false);
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

  // Raw section texts keeping raw keystrokes (trailing spaces, newlines, blank lines)
  const [sectionRawTexts, setSectionRawTexts] = useState<Record<string, { fr: string; en: string }>>(() => {
    const initial: Record<string, { fr: string; en: string }> = {};
    for (const sec of initialRecord.draft.sections) {
      initial[sec.id] = {
        fr: sec.paragraphs.map((p) => p.fr).join("\n\n"),
        en: sec.paragraphs.map((p) => p.en).join("\n\n"),
      };
    }
    return initial;
  });

  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);

  const editCountRef = useRef(0);
  const lastSavedCountRef = useRef(0);

  const isPublished = Boolean(pageRecord.published);

  useEffect(() => {
    if (!fetcher.data) return;

    if (fetcher.data.success) {
      if (fetcher.data.newRevision) {
        setCurrentRevision(fetcher.data.newRevision);
      }

      const returnedCount =
        fetcher.data.clientEditCount !== undefined && fetcher.data.clientEditCount !== null
          ? Number(fetcher.data.clientEditCount)
          : null;

      // Only advance lastSavedCountRef if the action actually saved or published the draft
      if (
        (fetcher.data.action === "save_draft" || fetcher.data.action === "publish") &&
        returnedCount !== null &&
        Number.isFinite(returnedCount)
      ) {
        lastSavedCountRef.current = Math.max(lastSavedCountRef.current, returnedCount);
      }

      // Check whether user made newer edits since the submitted snapshot was captured
      const stillHasUnsaved = editCountRef.current > lastSavedCountRef.current;
      setHasUnsavedEdits(stillHasUnsaved);

      if (fetcher.data.pageRecord) {
        setPageRecord(fetcher.data.pageRecord);

        // Never clobber local draft on unpublish, nor if user has unsaved edits
        if (fetcher.data.action !== "unpublish" && !stillHasUnsaved) {
          setDraft(fetcher.data.pageRecord.draft);
          const updatedRaw: Record<string, { fr: string; en: string }> = {};
          for (const sec of fetcher.data.pageRecord.draft.sections) {
            updatedRaw[sec.id] = {
              fr: sec.paragraphs.map((p) => p.fr).join("\n\n"),
              en: sec.paragraphs.map((p) => p.en).join("\n\n"),
            };
          }
          setSectionRawTexts(updatedRaw);
        }
      }

      if (fetcher.data.action === "save_draft") {
        setFeedback({
          type: "success",
          text: "Brouillon enregistré avec succès. La version publiée reste inchangée.",
        });
      } else if (fetcher.data.action === "publish") {
        setFeedback({
          type: "success",
          text: `Document publié avec succès (version ${fetcher.data.pageRecord?.published?.version} du ${fetcher.data.pageRecord?.published?.effectiveDate}).`,
        });
      } else if (fetcher.data.action === "unpublish") {
        setFeedback({
          type: "success",
          text: "Document dépublié. Le document public affichera désormais un état neutre en attente.",
        });
      }
    } else if (fetcher.data.conflict) {
      // 409 conflict: keep user's active inputs, active tab, and focus intact
      setConflictRevision(fetcher.data.serverRevision || null);
      setFeedback({
        type: "error",
        text:
          fetcher.data.error ||
          "Conflit de révision : le contenu a été modifié sur le serveur. Vos modifications locales ont été conservées.",
      });
    } else if (fetcher.data.error) {
      setFeedback({
        type: "error",
        text: fetcher.data.error,
      });
    }
  }, [fetcher.data]);

  const handleLocalizedFieldChange = (
    field: "publicTitle" | "seoTitle" | "seoDescription" | "intro",
    value: string
  ) => {
    editCountRef.current += 1;
    setDraft((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        [activeLang]: value,
      },
    }));
    setHasUnsavedEdits(true);
  };

  const handleSectionTitleChange = (sectionIdx: number, value: string) => {
    editCountRef.current += 1;
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
    setHasUnsavedEdits(true);
  };

  const handleSectionParagraphsChange = (sectionId: string, text: string) => {
    editCountRef.current += 1;
    // Preserve raw input: spaces, empty lines, trailing spaces are NOT modified
    setSectionRawTexts((prev) => ({
      ...prev,
      [sectionId]: {
        ...prev[sectionId],
        [activeLang]: text,
      },
    }));
    setHasUnsavedEdits(true);
  };

  const handleInventoryFieldChange = (
    index: number,
    field: "name" | "provider" | "purpose" | "duration",
    val: string
  ) => {
    editCountRef.current += 1;
    setDraft((prev) => {
      const currentInv = prev.inventory ? [...prev.inventory] : [];
      if (!currentInv[index]) return prev;
      currentInv[index] = {
        ...currentInv[index],
        [field]: {
          ...currentInv[index][field],
          [activeLang]: val,
        },
      };
      return { ...prev, inventory: currentInv };
    });
    setHasUnsavedEdits(true);
  };

  const handleInventoryCategoryChange = (
    index: number,
    cat: "technical" | "preferences"
  ) => {
    editCountRef.current += 1;
    setDraft((prev) => {
      const currentInv = prev.inventory ? [...prev.inventory] : [];
      if (!currentInv[index]) return prev;
      currentInv[index] = {
        ...currentInv[index],
        category: cat,
      };
      return { ...prev, inventory: currentInv };
    });
    setHasUnsavedEdits(true);
  };

  const handleAddInventoryRow = () => {
    editCountRef.current += 1;
    setDraft((prev) => {
      const currentInv = prev.inventory ? [...prev.inventory] : [];
      const newId = `cookie_${Date.now()}`;
      currentInv.push({
        id: newId,
        name: { fr: "", en: "" },
        provider: { fr: "Parallax", en: "Parallax" },
        category: "technical",
        purpose: { fr: "", en: "" },
        duration: { fr: "", en: "" },
      });
      return { ...prev, inventory: currentInv };
    });
    setHasUnsavedEdits(true);
  };

  const handleDeleteInventoryRow = (index: number) => {
    editCountRef.current += 1;
    setDraft((prev) => {
      const currentInv = prev.inventory ? [...prev.inventory] : [];
      currentInv.splice(index, 1);
      return { ...prev, inventory: currentInv };
    });
    setHasUnsavedEdits(true);
  };

  const buildCurrentDraft = (): LegalDocument => {
    const updatedSections: LegalSection[] = draft.sections.map((sec) => {
      const raw = sectionRawTexts[sec.id] || { fr: "", en: "" };
      const frParas = raw.fr
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      const enParas = raw.en
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      const maxLen = Math.max(frParas.length, enParas.length);
      const paragraphs: LocalizedString[] = [];
      for (let i = 0; i < maxLen; i++) {
        paragraphs.push({
          fr: frParas[i] || "",
          en: enParas[i] || "",
        });
      }

      return {
        ...sec,
        paragraphs,
      };
    });

    return {
      ...draft,
      effectiveDate,
      sections: updatedSections,
    };
  };

  const executeAction = (intent: "save_draft" | "publish" | "unpublish") => {
    setFeedback(null);
    setConflictRevision(null);

    const body = new URLSearchParams();
    body.set("csrfToken", csrfToken);
    body.set("revision", currentRevision);
    body.set("intent", intent);

    const snapshotCount = editCountRef.current;
    body.set("clientEditCount", String(snapshotCount));

    if (intent === "save_draft" || intent === "publish") {
      const fullDraft = buildCurrentDraft();
      body.set("draftData", JSON.stringify(fullDraft));
    }
    if (intent === "publish") {
      body.set("effectiveDate", effectiveDate);
    }

    fetcher.submit(body, { method: "POST" });
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
        <div className={formStyles.headerActions}>
          <Link
            to={`/admin/legal/${pageKey}/preview?lang=fr`}
            target="_blank"
            className={formStyles.previewButton}
          >
            Aperçu FR ↗
          </Link>
          <Link
            to={`/admin/legal/${pageKey}/preview?lang=en`}
            target="_blank"
            className={formStyles.previewButton}
          >
            Aperçu EN ↗
          </Link>
        </div>
      </header>

      <main className={formStyles.mainContent}>
        <div className={formStyles.topBar}>
          <div className={formStyles.topBarLeft}>
            <span className={`${formStyles.revisionTag} ${isCorrupted ? formStyles.revisionTagCorrupted : ""}`}>
              {isCorrupted ? "Révision : Indisponible (fichier non valide)" : `Révision : ${currentRevision}`}
            </span>
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
            {hasUnsavedEdits && (
              <span className={formStyles.statusBadgeUnsaved} data-testid="unsaved-badge">
                Modifications non enregistrées
              </span>
            )}
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

        {isCorrupted && (
          <div className={formStyles.alertError} role="alert">
            <p>
              <strong>Attention : contenu de secours actif en mémoire :</strong> Le fichier de configuration présente une anomalie de validation et les modifications sont bloquées pour protéger vos données.
            </p>
            {corruptionError && (
              <p className={formStyles.alertSubText}>
                Détail de la validation : <code className={formStyles.alertCode}>{corruptionError}</code>
              </p>
            )}
            <p className={formStyles.alertSubText}>
              Aucune restauration automatique n&apos;a été effectuée sur le disque afin de préserver votre fichier existant.
            </p>
          </div>
        )}

        {feedback && (
          <div
            role={feedback.type === "error" ? "alert" : "status"}
            className={
              feedback.type === "error" ? formStyles.statusError : formStyles.statusSuccess
            }
          >
            {feedback.text}
            {conflictRevision && (
              <div className={formStyles.conflictActions}>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentRevision(conflictRevision);
                    setConflictRevision(null);
                    setFeedback({
                      type: "error",
                      text: "Révision serveur adoptée. Vous pouvez maintenant soumettre à nouveau vos modifications.",
                    });
                  }}
                  className={formStyles.adoptRevisionButton}
                >
                  Adopter la révision du serveur ({conflictRevision})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Connected Company Facts Info Box */}
        <div className={formStyles.companyTokensBox}>
          <div className={formStyles.cardTitleRow}>
            <h2 className={formStyles.cardTitleHeading}>
              Champs d'entreprise reliés (Paramètres de l'entreprise)
            </h2>
            <Link to="/admin/company" className={formStyles.readinessLink}>
              Modifier dans Paramètres de l'entreprise →
            </Link>
          </div>
          <p className={formStyles.helper}>
            Ce document intègre automatiquement les coordonnées et choix de politique de votre entreprise. Vous n'avez pas besoin de manipuler de syntaxe technique dans le texte : les valeurs sont résolues en direct.
          </p>
          <div className={formStyles.companyTokensGrid}>
            <div className={formStyles.companyTokenItem}>
              <span className={formStyles.companyTokenKey}>Nom commercial</span>
              <span className={company.tradeName ? formStyles.companyTokenValue : formStyles.companyTokenMissing}>
                {company.tradeName || "Non renseigné"}
              </span>
            </div>
            <div className={formStyles.companyTokenItem}>
              <span className={formStyles.companyTokenKey}>Dénomination légale & Forme</span>
              <span className={company.legalName ? formStyles.companyTokenValue : formStyles.companyTokenMissing}>
                {company.legalName ? `${company.legalName}${company.legalForm ? ` (${company.legalForm})` : ""}` : "Non renseigné"}
              </span>
            </div>
            <div className={formStyles.companyTokenItem}>
              <span className={formStyles.companyTokenKey}>Adresse du siège</span>
              <span className={company.address ? formStyles.companyTokenValue : formStyles.companyTokenMissing}>
                {company.address || "Non renseigné"}
              </span>
            </div>
            <div className={formStyles.companyTokenItem}>
              <span className={formStyles.companyTokenKey}>N° d'entreprise (BCE)</span>
              <span className={company.enterpriseNumber ? formStyles.companyTokenValue : formStyles.companyTokenMissing}>
                {company.enterpriseNumber || "Non renseigné"}
              </span>
            </div>
            <div className={formStyles.companyTokenItem}>
              <span className={formStyles.companyTokenKey}>Régime TVA</span>
              <span className={company.vatRegime ? formStyles.companyTokenValue : formStyles.companyTokenMissing}>
                {company.vatRegime || "Non renseigné"}
              </span>
            </div>
            <div className={formStyles.companyTokenItem}>
              <span className={formStyles.companyTokenKey}>RPM / Tribunal compétent</span>
              {isRpmApplicable(company) === false ? (
                <span className={formStyles.companyTokenValue}>Non applicable (personne physique / association de fait)</span>
              ) : isRpmApplicable(company) === true ? (
                <span className={company.rpmJurisdiction ? formStyles.companyTokenValue : formStyles.companyTokenMissing}>
                  {company.rpmJurisdiction || "Non renseigné (requis pour personne morale)"}
                </span>
              ) : (
                <span className={formStyles.companyTokenMissing}>Statut à confirmer dans Entreprise</span>
              )}
            </div>
            <div className={formStyles.companyTokenItem}>
              <span className={formStyles.companyTokenKey}>Hébergeur web</span>
              <span className={company.hostingProvider ? formStyles.companyTokenValue : formStyles.companyTokenMissing}>
                {company.hostingProvider ? `${company.hostingProvider}${company.hostingCountry ? ` (${company.hostingCountry})` : ""}` : "Non renseigné"}
              </span>
            </div>
            <div className={formStyles.companyTokenItem}>
              <span className={formStyles.companyTokenKey}>Contact vie privée</span>
              <span className={(company.privacyEmail || company.email) ? formStyles.companyTokenValue : formStyles.companyTokenMissing}>
                {company.privacyEmail || company.email || "Non renseigné"}
              </span>
            </div>
          </div>
          <div className={formStyles.previewToggleRow}>
            <label className={formStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={showResolvedPreview}
                onChange={(e) => setShowResolvedPreview(e.target.checked)}
                className={formStyles.checkboxInput}
              />
              <span className={formStyles.checkboxText}>
                Afficher le texte avec les valeurs d'entreprise résolues (aperçu dynamique)
              </span>
            </label>
          </div>
        </div>

        {/* Global Page Information */}
        <div className={formStyles.card}>
          <h2 className={formStyles.cardTitle}>En-tête & Métadonnées SEO ({activeLang.toUpperCase()})</h2>

          <div className={formStyles.field}>
            <label htmlFor="field-publicTitle" className={formStyles.label}>
              Titre public affiché ({activeLang.toUpperCase()})
            </label>
            <input
              id="field-publicTitle"
              type="text"
              className={formStyles.input}
              value={draft.publicTitle[activeLang]}
              onChange={(e) => handleLocalizedFieldChange("publicTitle", e.target.value)}
            />
          </div>

          <div className={formStyles.row2}>
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
        <div className={formStyles.card}>
          <h2 className={formStyles.cardTitle}>Sections du document ({activeLang.toUpperCase()})</h2>
          <p className={formStyles.helper}>
            Chaque section correspond à un chapitre structuré. Séparez les paragraphes par un double saut de ligne.
          </p>

          {draft.sections.map((section, sIdx) => {
            const rawText = sectionRawTexts[section.id]?.[activeLang] ?? "";

            return (
              <div
                key={section.id}
                className={sIdx > 0 ? formStyles.sectionDivider : undefined}
              >
                <div className={formStyles.sectionHeader}>
                  <span className={formStyles.sectionIdTag}>
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
                  <label className={formStyles.label}>
                    <span>Paragraphes ({activeLang.toUpperCase()})</span>
                    {rawText.includes("company.rpmJurisdiction") && (
                      <span className={formStyles.conditionalBadge}>
                        Conditionnel : RPM (omis automatiquement si personne physique)
                      </span>
                    )}
                  </label>
                  <textarea
                    className={formStyles.textarea}
                    rows={5}
                    value={rawText}
                    onChange={(e) => handleSectionParagraphsChange(section.id, e.target.value)}
                    placeholder="Saisissez le texte des paragraphes, séparés par une ligne vide..."
                  />
                  {showResolvedPreview && (
                    <div className={formStyles.resolvedPreviewBox}>
                      <span className={formStyles.labelHint}>Aperçu résolu :</span>
                      <div>
                        {(() => {
                          const resolved = resolveCompanyTokens(rawText, company, "preview", activeLang);
                          if (!resolved.trim() && isRpmApplicable(company) === false && isRpmOnlyParagraph(rawText)) {
                            return (
                              <em>(Ce paragraphe RPM est automatiquement omis car le Registre des Personnes Morales ne s&apos;applique pas aux personnes physiques / associations sans personnalité juridique)</em>
                            );
                          }
                          return resolved;
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Structured Cookie Inventory (only for cookies page) */}
        {pageKey === "cookies" && (
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>
              Inventaire des cookies & traceurs ({activeLang.toUpperCase()})
            </h2>
            <p className={formStyles.helper}>
              Tableau structuré des cookies techniques et de préférences déployés sur Parallax.
            </p>

            <div className={formStyles.tableScroll}>
              <table className={formStyles.inventoryTable}>
                <thead>
                  <tr>
                    <th className={formStyles.inventoryTh}>Nom</th>
                    <th className={formStyles.inventoryTh}>Fournisseur</th>
                    <th className={formStyles.inventoryTh}>Catégorie</th>
                    <th className={formStyles.inventoryTh}>Durée</th>
                    <th className={formStyles.inventoryTh}>Finalité</th>
                    <th className={formStyles.inventoryTh}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(draft.inventory || []).map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className={formStyles.inventoryTd}>
                        <input
                          type="text"
                          className={formStyles.inventoryInput}
                          value={item.name[activeLang] || ""}
                          onChange={(e) =>
                            handleInventoryFieldChange(idx, "name", e.target.value)
                          }
                          placeholder="Nom du cookie"
                        />
                      </td>
                      <td className={formStyles.inventoryTd}>
                        <input
                          type="text"
                          className={formStyles.inventoryInput}
                          value={item.provider[activeLang] || ""}
                          onChange={(e) =>
                            handleInventoryFieldChange(idx, "provider", e.target.value)
                          }
                          placeholder="Fournisseur"
                        />
                      </td>
                      <td className={formStyles.inventoryTd}>
                        <select
                          className={formStyles.inventorySelect}
                          value={item.category}
                          onChange={(e) =>
                            handleInventoryCategoryChange(
                              idx,
                              e.target.value as "technical" | "preferences"
                            )
                          }
                        >
                          <option value="technical">Technique</option>
                          <option value="preferences">Préférences</option>
                        </select>
                      </td>
                      <td className={formStyles.inventoryTd}>
                        <input
                          type="text"
                          className={formStyles.inventoryInput}
                          value={item.duration[activeLang] || ""}
                          onChange={(e) =>
                            handleInventoryFieldChange(idx, "duration", e.target.value)
                          }
                          placeholder="Ex. Session, 1 an"
                        />
                      </td>
                      <td className={formStyles.inventoryTd}>
                        <input
                          type="text"
                          className={formStyles.inventoryInput}
                          value={item.purpose[activeLang] || ""}
                          onChange={(e) =>
                            handleInventoryFieldChange(idx, "purpose", e.target.value)
                          }
                          placeholder="Description de la finalité"
                        />
                      </td>
                      <td className={formStyles.inventoryTd}>
                        <button
                          type="button"
                          className={formStyles.deleteRowButton}
                          onClick={() => handleDeleteInventoryRow(idx)}
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              className={formStyles.addRowButton}
              onClick={handleAddInventoryRow}
            >
              + Ajouter un cookie / traceur
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className={formStyles.actionsContainer}>
          <div>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => executeAction("save_draft")}
              className={formStyles.secondaryButton}
            >
              {isSubmitting ? "Enregistrement..." : "Enregistrer le brouillon"}
            </button>
          </div>

          <div className={formStyles.actionsRight}>
            <div className={formStyles.effectiveDateGroup}>
              <label htmlFor="pub-effectiveDate" className={formStyles.effectiveDateLabel}>
                Date d'effet :
              </label>
              <input
                id="pub-effectiveDate"
                type="text"
                value={effectiveDate}
                onChange={(e) => {
                  setEffectiveDate(e.target.value);
                  editCountRef.current += 1;
                  setHasUnsavedEdits(true);
                }}
                className={formStyles.effectiveDateInput}
              />
            </div>

            <button
              type="button"
              disabled={isCorrupted || isSubmitting}
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
                className={formStyles.unpublishButton}
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
