import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
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
  saveStudioContent,
  getSiteContentFilePath,
  RevisionConflictError,
  ValidationError,
} from "../../lib/site-content.server";
import { ENV } from "../../lib/env.server";
import { cleanupUnreferencedMedia } from "../../lib/media-image.server";
import {
  type StudioContent,
  type UploadedMediaMetadata,
} from "../../lib/site-content.shared";
import { ImageUploader } from "../../components/admin/ImageUploader";
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
      media: content.media || {},
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
      "studioData",
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

  const studioDataStr = String(formData.get("studioData") || "");
  let parsedStudio: StudioContent;
  try {
    parsedStudio = JSON.parse(studioDataStr);
  } catch {
    return Response.json({ error: "Données JSON invalides." }, { status: 422, headers });
  }

  try {
    const newRevision = saveStudioContent(parsedStudio, revision);
    const { content: latest } = getRawSiteContent();
    cleanupUnreferencedMedia(latest, ENV.SITE_MEDIA_PATH, getSiteContentFilePath());
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
  const { csrfToken, studio: initialStudio, revision: initialRevision, isCorrupted, media: initialMedia } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [activeTab, setActiveTab] = useState<"fr" | "en">("fr");
  const [formData, setFormData] = useState<StudioContent>(initialStudio);
  const [currentRevision, setCurrentRevision] = useState<string>(initialRevision);
  const [media, setMedia] = useState<Record<string, UploadedMediaMetadata>>(initialMedia || {});
  const [isGlobalUploading, setIsGlobalUploading] = useState(false);

  useEffect(() => {
    if (actionData?.newRevision) {
      setCurrentRevision(actionData.newRevision);
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

        {actionData?.conflict && actionData.latestRevision && currentRevision !== actionData.latestRevision && (
          <div className={styles.conflictBox} role="alert">
            <p className={styles.conflictText}>{actionData.error}</p>
            <p className={styles.conflictNotice}>
              Une nouvelle tentative immédiate sera refusée pour protéger les données distantes. Pour confirmer vos modifications par-dessus la dernière révision ({actionData.latestRevision.slice(0, 8)}...), cliquez sur le bouton ci-dessous :
            </p>
            <button
              type="button"
              onClick={() => setCurrentRevision(actionData.latestRevision!)}
              className={styles.conflictResolveButton}
            >
              Adopter la nouvelle révision ({actionData.latestRevision.slice(0, 8)}...) et autoriser l'enregistrement
            </button>
          </div>
        )}

        {actionData?.error && !actionData.conflict && (
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
                className={styles.memberDividerBlock}
              >
                <h3 className={styles.memberBlockTitle}>
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

                <div className={`${styles.fieldGroup} ${styles.memberFieldSpaced}`}>
                  <label className={styles.label}>
                    Photo du membre
                  </label>
                  <ImageUploader
                    csrfToken={csrfToken}
                    revision={currentRevision}
                    location={member.id === "ludovic" ? "portrait_ludovic" : "portrait_maxime"}
                    currentImageId={member.imageId}
                    mediaMetadata={media[member.imageId]}
                    alt={member.imageAlt[activeTab]}
                    disabled={isCorrupted || isSaving}
                    isGlobalUploading={isGlobalUploading}
                    setIsGlobalUploading={setIsGlobalUploading}
                    onSuccess={(newRevision, newId, metadata) => {
                      setCurrentRevision(newRevision);
                      const newMembers = [...formData.team.members];
                      newMembers[idx] = { ...newMembers[idx], imageId: newId };
                      setFormData((prev) => ({
                        ...prev,
                        team: { ...prev.team, members: newMembers },
                      }));
                      setMedia((prev) => ({ ...prev, [newId]: metadata }));
                    }}
                    onRevertSuccess={(newRevision, defaultId) => {
                      setCurrentRevision(newRevision);
                      const newMembers = [...formData.team.members];
                      newMembers[idx] = { ...newMembers[idx], imageId: defaultId };
                      setFormData((prev) => ({
                        ...prev,
                        team: { ...prev.team, members: newMembers },
                      }));
                    }}
                    label={`Portrait de ${member.name}`}
                    aspect="portrait"
                  />
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
            <button
              type="submit"
              disabled={isSaving || isCorrupted || isGlobalUploading}
              className={styles.saveButton}
            >
              {isSaving
                ? "Enregistrement en cours..."
                : isGlobalUploading
                  ? "Import d'image en cours..."
                  : "Enregistrer la page Studio"}
            </button>
          </div>
        </Form>
      </main>
    </div>
  );
}
