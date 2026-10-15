import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersArgs } from "react-router";
import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
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
  saveContactPageContent,
  RevisionConflictError,
  ValidationError,
  type SaveContactCoordinates,
} from "../../lib/site-content.server";
import {
  type ContactPageContent,
  type LocalizedString,
} from "../../lib/site-content.shared";
import { getSmtpDiagnostic, type SmtpDiagnostic } from "../../lib/mailer.server";
import formStyles from "./adminForms.module.css";
import contactStyles from "./adminContact.module.css";

export function meta() {
  return [
    { title: "Administration - Contact | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export interface AdminContactLoaderData {
  csrfToken: string;
  contactPage: ContactPageContent;
  coordinates: {
    email: string;
    instagramUrl: string;
    youtubeUrl: string;
  };
  revision: string;
  isCorrupted: boolean;
  smtpDiagnostic: SmtpDiagnostic;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const { content, isCorrupted } = getRawSiteContent();
  const csrfToken = session.get("csrfToken") || "";
  const smtpDiagnostic = getSmtpDiagnostic();

  return data<AdminContactLoaderData>(
    {
      csrfToken,
      contactPage: content.contactPage,
      coordinates: {
        email: content.home.contact.email,
        instagramUrl: content.home.contact.instagramUrl,
        youtubeUrl: content.home.contact.youtubeUrl,
      },
      revision: content.revision,
      isCorrupted,
      smtpDiagnostic,
    },
    { headers: createAdminHeaders() }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const headers = createAdminHeaders();
  if (request.method !== "POST") {
    headers.set("Allow", "POST");
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  const session = await requireValidAdminSession(request);
  if (!validateOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers });
  }

  let formData: URLSearchParams;
  try {
    formData = await readStrictFormUrlEncoded(request, 500 * 1024, [
      "csrfToken",
      "revision",
      "contactPageData",
      "canonicalCoordinates",
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
  if (!/^[0-9a-f]{32}$/i.test(revision)) {
    return Response.json({ error: "Format de révision invalide." }, { status: 400, headers });
  }

  const contactDataStr = String(formData.get("contactPageData") || "");
  let parsedContact: ContactPageContent;
  try {
    parsedContact = JSON.parse(contactDataStr);
  } catch {
    return Response.json({ error: "Données Contact JSON invalides." }, { status: 422, headers });
  }

  const coordsDataStr = String(formData.get("canonicalCoordinates") || "{}");
  let parsedCoords: SaveContactCoordinates;
  try {
    parsedCoords = JSON.parse(coordsDataStr);
  } catch {
    return Response.json({ error: "Données de coordonnées JSON invalides." }, { status: 422, headers });
  }

  try {
    const newRevision = saveContactPageContent(parsedContact, revision, parsedCoords);
    return Response.json({ success: true, newRevision }, { headers });
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      const { content: currentSiteContent } = getRawSiteContent();
      return Response.json(
        {
          error: "Conflit de révision : le contenu a été mis à jour par un autre enregistrement. Vos saisies ont été conservées.",
          conflict: true,
          latestRevision: currentSiteContent.revision,
        },
        { status: 409, headers }
      );
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 422, headers });
    }
    return Response.json({ error: "Erreur lors de l'enregistrement." }, { status: 500, headers });
  }
}

type ActionData = {
  success?: boolean;
  error?: string;
  conflict?: boolean;
  newRevision?: string;
  latestRevision?: string;
};

export default function AdminContactPage() {
  const {
    csrfToken,
    contactPage: initialContact,
    coordinates: initialCoords,
    revision: initialRevision,
    isCorrupted,
    smtpDiagnostic,
  } = useLoaderData<AdminContactLoaderData>();

  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [activeTab, setActiveTab] = useState<"fr" | "en">("fr");
  const [formData, setFormData] = useState<ContactPageContent>(initialContact);
  const [coords, setCoords] = useState<{
    email: string;
    instagramUrl: string;
    youtubeUrl: string;
  }>(initialCoords);
  const [currentRevision, setCurrentRevision] = useState<string>(initialRevision);

  // Update revision on successful save
  useEffect(() => {
    if (actionData?.success && actionData.newRevision) {
      setCurrentRevision(actionData.newRevision);
    }
  }, [actionData]);

  // Helpers to update localized strings in formData
  const updateField = (path: (string | number)[], value: unknown) => {
    setFormData((prev) => {
      const clone = structuredClone(prev) as unknown as Record<string, unknown>;
      let target: Record<string, unknown> = clone;
      for (let i = 0; i < path.length - 1; i++) {
        target = target[path[i] as string] as Record<string, unknown>;
      }
      target[path[path.length - 1] as string] = value;
      return clone as unknown as ContactPageContent;
    });
  };

  const updateLocalized = (
    path: (string | number)[],
    currentLoc: LocalizedString,
    val: string
  ) => {
    updateField(path, {
      ...currentLoc,
      [activeTab]: val,
    });
  };

  const adoptRevision = () => {
    if (actionData?.latestRevision) {
      setCurrentRevision(actionData.latestRevision);
    }
  };

  return (
    <div className={formStyles.container}>
      <header className={formStyles.header}>
        <div className={formStyles.headerLeft}>
          <Link to="/admin/dashboard" className={formStyles.backLink}>
            ← Tableau de bord
          </Link>
          <h1 className={formStyles.pageHeading}>Administration - Contact</h1>
        </div>
        <div className={formStyles.langTabs}>
          <button
            type="button"
            className={`${formStyles.langTab} ${activeTab === "fr" ? formStyles.langTabActive : ""}`}
            onClick={() => setActiveTab("fr")}
          >
            FR
          </button>
          <button
            type="button"
            className={`${formStyles.langTab} ${activeTab === "en" ? formStyles.langTabActive : ""}`}
            onClick={() => setActiveTab("en")}
          >
            EN
          </button>
        </div>
      </header>

      <main className={formStyles.mainContent}>
        <div className={formStyles.topBar}>
          <div>
            <span className={formStyles.revisionTag}>
              Révision: {currentRevision.slice(0, 8)}…
            </span>
          </div>
        </div>

        {/* Diagnostic SMTP Card */}
        <div className={formStyles.sectionCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <h2 className={formStyles.sectionTitle}>État du serveur SMTP</h2>
            <div
              className={`${contactStyles.smtpBadge} ${
                smtpDiagnostic.status === "configured"
                  ? contactStyles.smtpConfigured
                  : smtpDiagnostic.status === "incomplete"
                  ? contactStyles.smtpIncomplete
                  : contactStyles.smtpInvalid
              }`}
            >
              ● {smtpDiagnostic.status === "configured"
                ? "Configuré"
                : smtpDiagnostic.status === "incomplete"
                ? "Incomplet"
                : "Invalide"}
            </div>
          </div>

          {smtpDiagnostic.status === "incomplete" && (
            <p className={contactStyles.smtpInfoText}>
              Variables manquantes dans l'environnement du serveur :{" "}
              {smtpDiagnostic.missing.map((key) => (
                <span key={key} className={contactStyles.smtpMissingKey}>
                  {key}
                </span>
              ))}
            </p>
          )}

          {smtpDiagnostic.status === "invalid" && (
            <p className={contactStyles.smtpInfoText}>
              Erreur de configuration : {smtpDiagnostic.reason}
            </p>
          )}

          {smtpDiagnostic.status === "configured" && (
            <p className={contactStyles.smtpInfoText}>
              Toutes les variables requises sont renseignées. L'envoi sécurisé est actif.
            </p>
          )}

          <p className={contactStyles.smtpInfoText} style={{ marginTop: 8 }}>
            Pour tester la connectivité SMTP sans expédier d'e-mail, exécutez{" "}
            <span className={contactStyles.smtpMissingKey}>npm run smtp:verify</span>.
          </p>
        </div>

        {/* Alerts */}
        {isCorrupted && (
          <div className={formStyles.alertError}>
            Attention : Le fichier de contenu présentait des anomalies et a été restauré avec les valeurs par défaut.
          </div>
        )}

        {actionData?.error && !actionData.conflict && (
          <div className={formStyles.alertError}>{actionData.error}</div>
        )}

        {actionData?.conflict && (
          <div className={contactStyles.conflictAlert}>
            <div className={contactStyles.conflictTitle}>Conflit de révision détecté</div>
            <p className={contactStyles.conflictMessage}>{actionData.error}</p>
            <button
              type="button"
              onClick={adoptRevision}
              className={contactStyles.adoptRevisionButton}
            >
              Adopter la dernière révision ({actionData.latestRevision?.slice(0, 8)}…) et réenregistrer ma saisie
            </button>
          </div>
        )}

        {actionData?.success && (
          <div className={formStyles.alertSuccess}>
            Modifications enregistrées avec succès (nouvelle révision:{" "}
            {actionData.newRevision?.slice(0, 8)}…).
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="revision" value={currentRevision} />
          <input type="hidden" name="contactPageData" value={JSON.stringify(formData)} />
          <input type="hidden" name="canonicalCoordinates" value={JSON.stringify(coords)} />

          {/* Section 1: Référencement (SEO) */}
          <div className={formStyles.sectionCard}>
            <h2 className={formStyles.sectionTitle}>1. Référencement (SEO) [{activeTab.toUpperCase()}]</h2>
            <p className={formStyles.sectionSubtitle}>
              Métadonnées pour les moteurs de recherche et l'onglet du navigateur.
            </p>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="seo-title" className={formStyles.label}>
                Titre de l'onglet (Balise Title)
              </label>
              <input
                id="seo-title"
                type="text"
                className={formStyles.input}
                value={formData.seo.title[activeTab]}
                onChange={(e) => updateLocalized(["seo", "title"], formData.seo.title, e.target.value)}
              />
            </div>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="seo-desc" className={formStyles.label}>
                Description (Meta Description)
              </label>
              <textarea
                id="seo-desc"
                className={formStyles.textarea}
                value={formData.seo.description[activeTab]}
                onChange={(e) =>
                  updateLocalized(["seo", "description"], formData.seo.description, e.target.value)
                }
              />
            </div>
          </div>

          {/* Section 2: En-tête (Hero) */}
          <div className={formStyles.sectionCard}>
            <h2 className={formStyles.sectionTitle}>2. En-tête de la page [{activeTab.toUpperCase()}]</h2>
            <p className={formStyles.sectionSubtitle}>
              Titre principal affiché au-dessus du formulaire.
            </p>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="hero-title" className={formStyles.label}>
                Titre d'accroche (H1)
              </label>
              <input
                id="hero-title"
                type="text"
                className={formStyles.input}
                value={formData.hero.title[activeTab]}
                onChange={(e) => updateLocalized(["hero", "title"], formData.hero.title, e.target.value)}
              />
            </div>
          </div>

          {/* Section 3: Libellés du formulaire */}
          <div className={formStyles.sectionCard}>
            <h2 className={formStyles.sectionTitle}>3. Libellés et textes du formulaire [{activeTab.toUpperCase()}]</h2>
            <p className={formStyles.sectionSubtitle}>
              Labels, textes d'aide et boutons affichés aux visiteurs.
            </p>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-nom-label" className={formStyles.label}>
                  Label : Nom / société
                </label>
                <input
                  id="form-nom-label"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.nameLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["form", "nameLabel"], formData.form.nameLabel, e.target.value)
                  }
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-nom-ph" className={formStyles.label}>
                  Placeholder : Nom / société
                </label>
                <input
                  id="form-nom-ph"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.namePlaceholder[activeTab]}
                  onChange={(e) =>
                    updateLocalized(
                      ["form", "namePlaceholder"],
                      formData.form.namePlaceholder,
                      e.target.value
                    )
                  }
                />
              </div>
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-mail-label" className={formStyles.label}>
                  Label : Email
                </label>
                <input
                  id="form-mail-label"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.emailLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["form", "emailLabel"], formData.form.emailLabel, e.target.value)
                  }
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-mail-ph" className={formStyles.label}>
                  Placeholder : Email
                </label>
                <input
                  id="form-mail-ph"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.emailPlaceholder[activeTab]}
                  onChange={(e) =>
                    updateLocalized(
                      ["form", "emailPlaceholder"],
                      formData.form.emailPlaceholder,
                      e.target.value
                    )
                  }
                />
              </div>
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-tel-label" className={formStyles.label}>
                  Label : Téléphone
                </label>
                <input
                  id="form-tel-label"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.phoneLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["form", "phoneLabel"], formData.form.phoneLabel, e.target.value)
                  }
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-tel-ph" className={formStyles.label}>
                  Placeholder : Téléphone
                </label>
                <input
                  id="form-tel-ph"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.phonePlaceholder[activeTab]}
                  onChange={(e) =>
                    updateLocalized(
                      ["form", "phonePlaceholder"],
                      formData.form.phonePlaceholder,
                      e.target.value
                    )
                  }
                />
              </div>
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-date-label" className={formStyles.label}>
                  Label : Échéance souhaitée
                </label>
                <input
                  id="form-date-label"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.timelineLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["form", "timelineLabel"], formData.form.timelineLabel, e.target.value)
                  }
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-date-ph" className={formStyles.label}>
                  Placeholder : Échéance souhaitée
                </label>
                <input
                  id="form-date-ph"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.timelinePlaceholder[activeTab]}
                  onChange={(e) =>
                    updateLocalized(
                      ["form", "timelinePlaceholder"],
                      formData.form.timelinePlaceholder,
                      e.target.value
                    )
                  }
                />
              </div>
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-type-label" className={formStyles.label}>
                  Label : Type de projet
                </label>
                <input
                  id="form-type-label"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.typeLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["form", "typeLabel"], formData.form.typeLabel, e.target.value)
                  }
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-type-ph" className={formStyles.label}>
                  Placeholder : Type de projet (option vide)
                </label>
                <input
                  id="form-type-ph"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.typePlaceholder[activeTab]}
                  onChange={(e) =>
                    updateLocalized(
                      ["form", "typePlaceholder"],
                      formData.form.typePlaceholder,
                      e.target.value
                    )
                  }
                />
              </div>
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-msg-label" className={formStyles.label}>
                  Label : Message
                </label>
                <input
                  id="form-msg-label"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.messageLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["form", "messageLabel"], formData.form.messageLabel, e.target.value)
                  }
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-msg-ph" className={formStyles.label}>
                  Placeholder : Message
                </label>
                <input
                  id="form-msg-ph"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.messagePlaceholder[activeTab]}
                  onChange={(e) =>
                    updateLocalized(
                      ["form", "messagePlaceholder"],
                      formData.form.messagePlaceholder,
                      e.target.value
                    )
                  }
                />
              </div>
            </div>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="form-submit" className={formStyles.label}>
                Bouton d'envoi
              </label>
              <input
                id="form-submit"
                type="text"
                className={formStyles.input}
                value={formData.form.submitButton[activeTab]}
                onChange={(e) =>
                  updateLocalized(["form", "submitButton"], formData.form.submitButton, e.target.value)
                }
              />
            </div>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="form-notice" className={formStyles.label}>
                Notice de confidentialité au point de collecte
              </label>
              <textarea
                id="form-notice"
                className={formStyles.textarea}
                value={formData.form.noticeText[activeTab]}
                onChange={(e) =>
                  updateLocalized(["form", "noticeText"], formData.form.noticeText, e.target.value)
                }
              />
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-privacy-text" className={formStyles.label}>
                  Texte du lien de politique
                </label>
                <input
                  id="form-privacy-text"
                  type="text"
                  className={formStyles.input}
                  value={formData.form.privacyPolicyText[activeTab]}
                  onChange={(e) =>
                    updateLocalized(
                      ["form", "privacyPolicyText"],
                      formData.form.privacyPolicyText,
                      e.target.value
                    )
                  }
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="form-privacy-url" className={formStyles.label}>
                  URL / Chemin de la politique (laisser vide si non publiée)
                </label>
                <input
                  id="form-privacy-url"
                  type="text"
                  placeholder="/fr/confidentialite"
                  className={formStyles.input}
                  value={formData.form.privacyPolicyUrl}
                  onChange={(e) => updateField(["form", "privacyPolicyUrl"], e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Section 4: Types de projet */}
          <div className={formStyles.sectionCard}>
            <h2 className={formStyles.sectionTitle}>4. Types de projet administrables [{activeTab.toUpperCase()}]</h2>
            <p className={formStyles.sectionSubtitle}>
              Activez ou désactivez les types de projet et modifiez leurs libellés. Les identifiants techniques restent stables.
            </p>

            {formData.form.projectTypes.map((pt, idx) => (
              <div
                key={pt.id}
                className={`${contactStyles.projectTypeItem} ${
                  !pt.enabled ? contactStyles.projectTypeItemDisabled : ""
                }`}
              >
                <label className={contactStyles.toggleLabel}>
                  <input
                    type="checkbox"
                    className={contactStyles.checkbox}
                    checked={pt.enabled}
                    onChange={(e) => {
                      const updated = [...formData.form.projectTypes];
                      updated[idx] = { ...pt, enabled: e.target.checked };
                      updateField(["form", "projectTypes"], updated);
                    }}
                  />
                  <span>{pt.enabled ? "Actif" : "Désactivé"}</span>
                </label>
                <div className={contactStyles.typeIdBadge}>{pt.id}</div>
                <input
                  type="text"
                  className={formStyles.input}
                  value={pt.label[activeTab]}
                  onChange={(e) => {
                    const updated = [...formData.form.projectTypes];
                    updated[idx] = {
                      ...pt,
                      label: { ...pt.label, [activeTab]: e.target.value },
                    };
                    updateField(["form", "projectTypes"], updated);
                  }}
                />
              </div>
            ))}
          </div>

          {/* Section 5: Coordonnées (Synchronisées avec l'Accueil) */}
          <div className={formStyles.sectionCard}>
            <h2 className={formStyles.sectionTitle}>5. Coordonnées et réseaux</h2>
            <p className={formStyles.sectionSubtitle}>
              Ces informations alimentent la carte Coordonnées et sont synchronisées de manière canonique avec la section Contact de l'Accueil.
            </p>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="coord-email" className={formStyles.label}>
                  E-mail public affiché (Canonique)
                </label>
                <input
                  id="coord-email"
                  type="email"
                  placeholder="contact@parallax.com"
                  className={formStyles.input}
                  value={coords.email}
                  onChange={(e) => setCoords((prev) => ({ ...prev, email: e.target.value }))}
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="coord-phone" className={formStyles.label}>
                  Téléphone public (laisser vide pour masquer)
                </label>
                <input
                  id="coord-phone"
                  type="text"
                  placeholder="+32 XXX XX XX XX"
                  className={formStyles.input}
                  value={formData.card.phone}
                  onChange={(e) => updateField(["card", "phone"], e.target.value)}
                />
              </div>
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="coord-ig" className={formStyles.label}>
                  URL Instagram (Canonique)
                </label>
                <input
                  id="coord-ig"
                  type="url"
                  placeholder="https://instagram.com/..."
                  className={formStyles.input}
                  value={coords.instagramUrl}
                  onChange={(e) => setCoords((prev) => ({ ...prev, instagramUrl: e.target.value }))}
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="coord-yt" className={formStyles.label}>
                  URL YouTube (Canonique)
                </label>
                <input
                  id="coord-yt"
                  type="url"
                  placeholder="https://youtube.com/..."
                  className={formStyles.input}
                  value={coords.youtubeUrl}
                  onChange={(e) => setCoords((prev) => ({ ...prev, youtubeUrl: e.target.value }))}
                />
              </div>
            </div>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="coord-response" className={formStyles.label}>
                Délai de réponse annoncé [{activeTab.toUpperCase()}] (laisser vide pour masquer le bloc)
              </label>
              <input
                id="coord-response"
                type="text"
                placeholder="Nous répondons sous 48h."
                className={formStyles.input}
                value={formData.card.responseTimeNotice[activeTab]}
                onChange={(e) =>
                  updateLocalized(
                    ["card", "responseTimeNotice"],
                    formData.card.responseTimeNotice,
                    e.target.value
                  )
                }
              />
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="card-title" className={formStyles.label}>
                  Titre de la carte [{activeTab.toUpperCase()}]
                </label>
                <input
                  id="card-title"
                  type="text"
                  className={formStyles.input}
                  value={formData.card.title[activeTab]}
                  onChange={(e) => updateLocalized(["card", "title"], formData.card.title, e.target.value)}
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="card-label-mail" className={formStyles.label}>
                  Label E-mail [{activeTab.toUpperCase()}]
                </label>
                <input
                  id="card-label-mail"
                  type="text"
                  className={formStyles.input}
                  value={formData.card.emailLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["card", "emailLabel"], formData.card.emailLabel, e.target.value)
                  }
                />
              </div>
            </div>

            <div className={formStyles.row2}>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="card-label-tel" className={formStyles.label}>
                  Label Téléphone [{activeTab.toUpperCase()}]
                </label>
                <input
                  id="card-label-tel"
                  type="text"
                  className={formStyles.input}
                  value={formData.card.phoneLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["card", "phoneLabel"], formData.card.phoneLabel, e.target.value)
                  }
                />
              </div>
              <div className={formStyles.fieldGroup}>
                <label htmlFor="card-label-soc" className={formStyles.label}>
                  Label Réseaux [{activeTab.toUpperCase()}]
                </label>
                <input
                  id="card-label-soc"
                  type="text"
                  className={formStyles.input}
                  value={formData.card.socialLabel[activeTab]}
                  onChange={(e) =>
                    updateLocalized(["card", "socialLabel"], formData.card.socialLabel, e.target.value)
                  }
                />
              </div>
            </div>
          </div>

          {/* Section 6: Messages système */}
          <div className={formStyles.sectionCard}>
            <h2 className={formStyles.sectionTitle}>6. Messages de statut et notifications [{activeTab.toUpperCase()}]</h2>
            <p className={formStyles.sectionSubtitle}>
              Textes affichés après soumission ou lors d'une indisponibilité technique.
            </p>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="msg-success-title" className={formStyles.label}>
                Titre de confirmation de succès
              </label>
              <input
                id="msg-success-title"
                type="text"
                className={formStyles.input}
                value={formData.messages.successTitle[activeTab]}
                onChange={(e) =>
                  updateLocalized(
                    ["messages", "successTitle"],
                    formData.messages.successTitle,
                    e.target.value
                  )
                }
              />
            </div>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="msg-success-body" className={formStyles.label}>
                Corps du message de confirmation de succès
              </label>
              <textarea
                id="msg-success-body"
                className={formStyles.textarea}
                value={formData.messages.successMessage[activeTab]}
                onChange={(e) =>
                  updateLocalized(
                    ["messages", "successMessage"],
                    formData.messages.successMessage,
                    e.target.value
                  )
                }
              />
            </div>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="msg-unavail" className={formStyles.label}>
                Message d'indisponibilité (lorsque le SMTP est en panne ou non configuré)
              </label>
              <textarea
                id="msg-unavail"
                className={formStyles.textarea}
                value={formData.messages.unavailableMessage[activeTab]}
                onChange={(e) =>
                  updateLocalized(
                    ["messages", "unavailableMessage"],
                    formData.messages.unavailableMessage,
                    e.target.value
                  )
                }
              />
            </div>

            <div className={formStyles.fieldGroup}>
              <label htmlFor="msg-generic-error" className={formStyles.label}>
                Message d'erreur générique lors d'un échec de transport
              </label>
              <textarea
                id="msg-generic-error"
                className={formStyles.textarea}
                value={formData.messages.genericError[activeTab]}
                onChange={(e) =>
                  updateLocalized(
                    ["messages", "genericError"],
                    formData.messages.genericError,
                    e.target.value
                  )
                }
              />
            </div>
          </div>

          {/* Sticky Action Bar */}
          <div className={formStyles.actionBar}>
            <div className={formStyles.revisionTag}>
              Révision prête à sauvegarder : {currentRevision.slice(0, 8)}…
            </div>
            <button type="submit" disabled={isSaving} className={formStyles.saveButton}>
              {isSaving ? "Enregistrement en cours…" : "Enregistrer les modifications"}
            </button>
          </div>
        </Form>
      </main>
    </div>
  );
}
