import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import { validateOrigin } from "../../lib/security.server";
import {
  getRawSiteContent,
  saveStudioContent,
  RevisionConflictError,
  ValidationError,
} from "../../lib/site-content.server";
import {
  ALLOWED_IMAGE_MAP,
  type StudioContent,
  type AllowedImageId,
} from "../../lib/site-content.shared";
import styles from "./adminForms.module.css";

export function meta() {
  return [
    { title: "Administration - Studio | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const { content, isCorrupted } = getRawSiteContent();

  const csrfToken = session.get("csrfToken") || "";

  return Response.json(
    {
      csrfToken,
      studio: content.studio,
      revision: content.revision,
      isCorrupted,
    },
    { headers: createAdminHeaders() }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const headers = createAdminHeaders();
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
  }

  const session = await requireValidAdminSession(request);
  if (!validateOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers });
  }

  const contentType = request.headers.get("Content-Type") || "";
  const mimeType = contentType.split(";")[0]?.trim().toLowerCase();
  if (mimeType !== "application/x-www-form-urlencoded") {
    return Response.json({ error: "Unsupported Media Type" }, { status: 415, headers });
  }

  if (!request.body) {
    return Response.json({ error: "Empty body" }, { status: 400, headers });
  }

  const MAX_BODY_SIZE = 500 * 1024;
  let totalBytes = 0;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_BODY_SIZE) {
          await reader.cancel("Payload too large");
          return Response.json({ error: "Payload too large" }, { status: 413, headers });
        }
        chunks.push(value);
      }
    }
  } catch {
    return Response.json({ error: "Invalid body stream" }, { status: 400, headers });
  }

  const rawBody = Buffer.concat(chunks).toString("utf-8");
  const formData = new URLSearchParams(rawBody);

  const csrfToken = String(formData.get("csrfToken") || "");
  if (!csrfToken || csrfToken !== session.get("csrfToken")) {
    return Response.json({ error: "Jeton CSRF invalide." }, { status: 403, headers });
  }

  const revision = String(formData.get("revision") || "");
  if (!/^[0-9a-f]{32}$/i.test(revision)) {
    return Response.json({ error: "Format de révision invalide." }, { status: 400, headers });
  }

  const studioDataStr = String(formData.get("studioData") || "");
  let parsedStudio: StudioContent;
  try {
    parsedStudio = JSON.parse(studioDataStr);
  } catch {
    return Response.json({ error: "Données JSON invalides." }, { status: 422, headers });
  }

  try {
    const newRevision = saveStudioContent(parsedStudio, revision);
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

export default function AdminStudioPage() {
  const { csrfToken, studio: initialStudio, revision: initialRevision, isCorrupted } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [activeTab, setActiveTab] = useState<"fr" | "en">("fr");
  const [formData, setFormData] = useState<StudioContent>(initialStudio);
  const [currentRevision, setCurrentRevision] = useState<string>(initialRevision);

  useEffect(() => {
    if (actionData?.newRevision) {
      setCurrentRevision(actionData.newRevision);
    } else if (actionData?.latestRevision) {
      setCurrentRevision(actionData.latestRevision);
    }
  }, [actionData]);

  const updateLocalized = (
    path: (string | number)[],
    val: string,
    lang: "fr" | "en" = activeTab
  ) => {
    setFormData((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      let cur = clone;
      for (let i = 0; i < path.length - 1; i++) {
        cur = cur[path[i]];
      }
      const last = path[path.length - 1];
      if (typeof cur[last] === "object" && cur[last] !== null && "fr" in cur[last]) {
        cur[last][lang] = val;
      } else {
        cur[last] = val;
      }
      return clone;
    });
  };

  const allowedImageOptions = Object.keys(ALLOWED_IMAGE_MAP) as AllowedImageId[];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin/dashboard" className={styles.backLink}>
            ← Retour au tableau de bord
          </Link>
          <h1 className={styles.pageHeading}>Édition du Studio</h1>
        </div>
      </header>

      <main className={styles.mainContent}>
        <div className={styles.topBar}>
          <div className={styles.revisionTag}>Révision serveur : {currentRevision}</div>
          <div className={styles.langTabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "fr"}
              className={`${styles.langTab} ${activeTab === "fr" ? styles.langTabActive : ""}`}
              onClick={() => setActiveTab("fr")}
            >
              Français (FR)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "en"}
              className={`${styles.langTab} ${activeTab === "en" ? styles.langTabActive : ""}`}
              onClick={() => setActiveTab("en")}
            >
              English (EN)
            </button>
          </div>
        </div>

        {isCorrupted && (
          <div className={styles.alertError} role="alert">
            Attention : le fichier de contenu éditorial était illisible ou corrompu. Les valeurs par défaut ont été rechargées.
          </div>
        )}

        {actionData?.error && (
          <div className={styles.alertError} role="alert">
            {actionData.error}
          </div>
        )}

        {actionData?.success && (
          <div className={styles.alertSuccess} role="status">
            Modifications de la page Studio enregistrées avec succès !
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="revision" value={currentRevision} />
          <input type="hidden" name="studioData" value={JSON.stringify(formData)} />

          {/* Section SEO */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Référencement & Métadonnées (SEO)</h2>
            <p className={styles.sectionSubtitle}>
              Titre et description de la page Studio ({activeTab.toUpperCase()}).
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="seo-title">
                Titre de page (SEO)
              </label>
              <input
                id="seo-title"
                type="text"
                className={styles.input}
                value={formData.seo.title[activeTab]}
                onChange={(e) => updateLocalized(["seo", "title"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="seo-desc">
                Description (SEO)
              </label>
              <textarea
                id="seo-desc"
                className={styles.textarea}
                value={formData.seo.description[activeTab]}
                onChange={(e) => updateLocalized(["seo", "description"], e.target.value)}
              />
            </div>
          </section>

          {/* Section Hero */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Introduction (Le Studio)</h2>
            <p className={styles.sectionSubtitle}>
              Texte de présentation générale du studio ({activeTab.toUpperCase()}).
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="hero-title">
                Titre principal
              </label>
              <input
                id="hero-title"
                type="text"
                className={styles.input}
                value={formData.hero.title[activeTab]}
                onChange={(e) => updateLocalized(["hero", "title"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="hero-text">
                Paragraphe de présentation
              </label>
              <textarea
                id="hero-text"
                className={styles.textarea}
                value={formData.hero.text[activeTab]}
                onChange={(e) => updateLocalized(["hero", "text"], e.target.value)}
              />
            </div>
          </section>

          {/* Section Équipe */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Équipe (Qui sommes-nous)</h2>
            <p className={styles.sectionSubtitle}>
              Portraits et rôles des cofondateurs ({activeTab.toUpperCase()}).
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="team-title">
                Titre de la section
              </label>
              <input
                id="team-title"
                type="text"
                className={styles.input}
                value={formData.team.title[activeTab]}
                onChange={(e) => updateLocalized(["team", "title"], e.target.value)}
              />
            </div>

            {formData.team.members.map((member, idx) => (
              <div
                key={member.id}
                style={{
                  marginTop: 24,
                  paddingTop: 24,
                  borderTop: "0.5px solid var(--px-border)",
                }}
              >
                <h3 style={{ margin: "0 0 16px", fontSize: 16, color: "var(--px-text)" }}>
                  Membre : {member.name}
                </h3>
                <div className={styles.row2}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor={`member-name-${idx}`}>
                      Nom complet
                    </label>
                    <input
                      id={`member-name-${idx}`}
                      type="text"
                      className={styles.input}
                      value={member.name}
                      onChange={(e) => {
                        const newMembers = [...formData.team.members];
                        newMembers[idx] = { ...newMembers[idx], name: e.target.value };
                        setFormData({
                          ...formData,
                          team: { ...formData.team, members: newMembers },
                        });
                      }}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label} htmlFor={`member-role-${idx}`}>
                      Rôle ({activeTab.toUpperCase()})
                    </label>
                    <input
                      id={`member-role-${idx}`}
                      type="text"
                      className={styles.input}
                      value={member.role[activeTab]}
                      onChange={(e) => {
                        const newMembers = [...formData.team.members];
                        newMembers[idx] = {
                          ...newMembers[idx],
                          role: { ...newMembers[idx].role, [activeTab]: e.target.value },
                        };
                        setFormData({
                          ...formData,
                          team: { ...formData.team, members: newMembers },
                        });
                      }}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup} style={{ marginTop: 12 }}>
                  <label className={styles.label} htmlFor={`member-img-${idx}`}>
                    Photo du membre (référence autorisée)
                  </label>
                  <div className={styles.imagePickerGroup}>
                    <img
                      src={ALLOWED_IMAGE_MAP[member.imageId]}
                      alt={`Aperçu ${member.name}`}
                      className={styles.imagePreview}
                    />
                    <select
                      id={`member-img-${idx}`}
                      className={styles.select}
                      value={member.imageId}
                      onChange={(e) => {
                        const newMembers = [...formData.team.members];
                        newMembers[idx] = {
                          ...newMembers[idx],
                          imageId: e.target.value as AllowedImageId,
                        };
                        setFormData({
                          ...formData,
                          team: { ...formData.team, members: newMembers },
                        });
                      }}
                    >
                      {allowedImageOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt} ({ALLOWED_IMAGE_MAP[opt]})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor={`member-alt-${idx}`}>
                    Texte alternatif de l'image (alt {activeTab.toUpperCase()})
                  </label>
                  <input
                    id={`member-alt-${idx}`}
                    type="text"
                    className={styles.input}
                    value={member.imageAlt[activeTab]}
                    onChange={(e) => {
                      const newMembers = [...formData.team.members];
                      newMembers[idx] = {
                        ...newMembers[idx],
                        imageAlt: { ...newMembers[idx].imageAlt, [activeTab]: e.target.value },
                      };
                      setFormData({
                        ...formData,
                        team: { ...formData.team, members: newMembers },
                      });
                    }}
                  />
                </div>
              </div>
            ))}
          </section>

          {/* Section Notre approche */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Notre approche</h2>
            <p className={styles.sectionSubtitle}>
              Vision et engagements artistiques ({activeTab.toUpperCase()}).
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="approach-title">
                Titre de section
              </label>
              <input
                id="approach-title"
                type="text"
                className={styles.input}
                value={formData.approach.title[activeTab]}
                onChange={(e) => updateLocalized(["approach", "title"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="approach-headline">
                Accroche / Slogan
              </label>
              <input
                id="approach-headline"
                type="text"
                className={styles.input}
                value={formData.approach.headline[activeTab]}
                onChange={(e) => updateLocalized(["approach", "headline"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="approach-text">
                Paragraphe détaillé
              </label>
              <textarea
                id="approach-text"
                className={styles.textarea}
                value={formData.approach.text[activeTab]}
                onChange={(e) => updateLocalized(["approach", "text"], e.target.value)}
              />
            </div>
          </section>

          {/* Fixed bottom action bar */}
          <div className={styles.actionBar}>
            <span className={styles.labelHint}>
              Modifications prêtes à être sauvegardées sur le serveur
            </span>
            <button type="submit" disabled={isSaving} className={styles.saveButton}>
              {isSaving ? "Enregistrement en cours..." : "Enregistrer la page Studio"}
            </button>
          </div>
        </Form>
      </main>
    </div>
  );
}
