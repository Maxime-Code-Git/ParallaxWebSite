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
  saveHomeContent,
  getSiteContentFilePath,
  RevisionConflictError,
  ValidationError,
} from "../../lib/site-content.server";
import { ENV } from "../../lib/env.server";
import { cleanupUnreferencedMedia } from "../../lib/media-image.server";
import {
  type HomeContent,
  type UploadedMediaMetadata,
} from "../../lib/site-content.shared";
import { ImageUploader } from "../../components/admin/ImageUploader";
import styles from "./adminForms.module.css";

export function meta() {
  return [
    { title: "Administration - Accueil | Parallax" },
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
      home: content.home,
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
      "homeData",
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

  const homeDataStr = String(formData.get("homeData") || "");
  let parsedHome: HomeContent;
  try {
    parsedHome = JSON.parse(homeDataStr);
  } catch {
    return Response.json({ error: "Données JSON invalides." }, { status: 422, headers });
  }

  try {
    const newRevision = saveHomeContent(parsedHome, revision);
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

export default function AdminHomePage() {
  const { csrfToken, home: initialHome, revision: initialRevision, isCorrupted, media: initialMedia } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [activeTab, setActiveTab] = useState<"fr" | "en">("fr");
  const [formData, setFormData] = useState<HomeContent>(initialHome);
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

  const handleAddPhotoItem = () => {
    setFormData((prev) => ({
      ...prev,
      savoirFaire: {
        ...prev.savoirFaire,
        photoItems: [...(prev.savoirFaire.photoItems || []), { fr: "", en: "" }],
      },
    }));
  };

  const handleRemovePhotoItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      savoirFaire: {
        ...prev.savoirFaire,
        photoItems: prev.savoirFaire.photoItems.filter((_, idx) => idx !== index),
      },
    }));
  };

  const handleMovePhotoItem = (index: number, direction: -1 | 1) => {
    setFormData((prev) => {
      const items = [...prev.savoirFaire.photoItems];
      const targetIdx = index + direction;
      if (targetIdx < 0 || targetIdx >= items.length) return prev;
      const temp = items[index];
      items[index] = items[targetIdx];
      items[targetIdx] = temp;
      return {
        ...prev,
        savoirFaire: {
          ...prev.savoirFaire,
          photoItems: items,
        },
      };
    });
  };

  const handleAddVideoItem = () => {
    setFormData((prev) => ({
      ...prev,
      savoirFaire: {
        ...prev.savoirFaire,
        videoItems: [...(prev.savoirFaire.videoItems || []), { fr: "", en: "" }],
      },
    }));
  };

  const handleRemoveVideoItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      savoirFaire: {
        ...prev.savoirFaire,
        videoItems: prev.savoirFaire.videoItems.filter((_, idx) => idx !== index),
      },
    }));
  };

  const handleMoveVideoItem = (index: number, direction: -1 | 1) => {
    setFormData((prev) => {
      const items = [...prev.savoirFaire.videoItems];
      const targetIdx = index + direction;
      if (targetIdx < 0 || targetIdx >= items.length) return prev;
      const temp = items[index];
      items[index] = items[targetIdx];
      items[targetIdx] = temp;
      return {
        ...prev,
        savoirFaire: {
          ...prev.savoirFaire,
          videoItems: items,
        },
      };
    });
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin/dashboard" className={styles.backLink}>
            ← Retour au tableau de bord
          </Link>
          <h1 className={styles.pageHeading}>Édition de l'Accueil</h1>
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
            Modifications de la page d'accueil enregistrées avec succès !
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="revision" value={currentRevision} />
          <input type="hidden" name="homeData" value={JSON.stringify(formData)} />

          {/* Section SEO */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Référencement & Métadonnées (SEO)</h2>
            <p className={styles.sectionSubtitle}>
              Titre et description affichés dans les résultats de recherche ({activeTab.toUpperCase()}).
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
            <h2 className={styles.sectionTitle}>Bandeau principal (Hero)</h2>
            <p className={styles.sectionSubtitle}>
              Accroches principales visibles dès l'ouverture ({activeTab.toUpperCase()}).
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="hero-badge">
                Sur-titre (badge)
              </label>
              <input
                id="hero-badge"
                type="text"
                className={styles.input}
                value={formData.hero.badge[activeTab]}
                onChange={(e) => updateLocalized(["hero", "badge"], e.target.value)}
              />
            </div>
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
              <label className={styles.label} htmlFor="hero-sub">
                Sous-titre (domaines de création)
              </label>
              <input
                id="hero-sub"
                type="text"
                className={styles.input}
                value={formData.hero.subtitle[activeTab]}
                onChange={(e) => updateLocalized(["hero", "subtitle"], e.target.value)}
              />
            </div>
          </section>

          {/* Section Showreel */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Showreel</h2>
            <p className={styles.sectionSubtitle}>
              Visuel de couverture et configuration de la vidéo de présentation.
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="showreel-title">
                Libellé du showreel ({activeTab.toUpperCase()})
              </label>
              <input
                id="showreel-title"
                type="text"
                className={styles.input}
                value={formData.showreel.title[activeTab]}
                onChange={(e) => updateLocalized(["showreel", "title"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Image de couverture du showreel
              </label>
              <ImageUploader
                csrfToken={csrfToken}
                revision={currentRevision}
                location="showreel_cover"
                currentImageId={formData.showreel.coverImageId}
                mediaMetadata={media[formData.showreel.coverImageId]}
                alt={formData.showreel.coverImageAlt[activeTab]}
                disabled={isCorrupted || isSaving}
                isGlobalUploading={isGlobalUploading}
                setIsGlobalUploading={setIsGlobalUploading}
                onSuccess={(newRevision, newId, metadata) => {
                  setCurrentRevision(newRevision);
                  setFormData((prev) => ({
                    ...prev,
                    showreel: { ...prev.showreel, coverImageId: newId },
                  }));
                  setMedia((prev) => ({ ...prev, [newId]: metadata }));
                }}
                onRevertSuccess={(newRevision, defaultId) => {
                  setCurrentRevision(newRevision);
                  setFormData((prev) => ({
                    ...prev,
                    showreel: { ...prev.showreel, coverImageId: defaultId },
                  }));
                }}
                label="Couverture du showreel"
                aspect="hero"
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="showreel-alt">
                Texte alternatif de l'image (alt {activeTab.toUpperCase()})
              </label>
              <input
                id="showreel-alt"
                type="text"
                className={styles.input}
                value={formData.showreel.coverImageAlt[activeTab]}
                onChange={(e) => updateLocalized(["showreel", "coverImageAlt"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="showreel-url">
                Lien vidéo externe (YouTube ou Vimeo - consentement requis au visionnage)
              </label>
              <input
                id="showreel-url"
                type="url"
                placeholder="https://www.youtube.com/watch?v=... ou laisser vide"
                className={styles.input}
                value={formData.showreel.videoUrl}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    showreel: { ...formData.showreel, videoUrl: e.target.value },
                  })
                }
              />
            </div>
          </section>

          {/* Section Duo */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Duo Maxime & Ludovic</h2>
            <p className={styles.sectionSubtitle}>
              Présentation du binôme sur la page d'accueil ({activeTab.toUpperCase()}).
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="duo-title">
                Titre
              </label>
              <input
                id="duo-title"
                type="text"
                className={styles.input}
                value={formData.duo.title[activeTab]}
                onChange={(e) => updateLocalized(["duo", "title"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="duo-text">
                Texte de présentation
              </label>
              <textarea
                id="duo-text"
                className={styles.textarea}
                value={formData.duo.text[activeTab]}
                onChange={(e) => updateLocalized(["duo", "text"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                Photo du duo Maxime & Ludovic
              </label>
              <ImageUploader
                csrfToken={csrfToken}
                revision={currentRevision}
                location="duo"
                currentImageId={formData.duo.imageId}
                mediaMetadata={media[formData.duo.imageId]}
                alt={formData.duo.imageAlt[activeTab]}
                disabled={isCorrupted || isSaving}
                isGlobalUploading={isGlobalUploading}
                setIsGlobalUploading={setIsGlobalUploading}
                onSuccess={(newRevision, newId, metadata) => {
                  setCurrentRevision(newRevision);
                  setFormData((prev) => ({
                    ...prev,
                    duo: { ...prev.duo, imageId: newId },
                  }));
                  setMedia((prev) => ({ ...prev, [newId]: metadata }));
                }}
                onRevertSuccess={(newRevision, defaultId) => {
                  setCurrentRevision(newRevision);
                  setFormData((prev) => ({
                    ...prev,
                    duo: { ...prev.duo, imageId: defaultId },
                  }));
                }}
                label="Photo du duo Maxime & Ludovic"
                aspect="standard"
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="duo-alt">
                Texte alternatif de l'image (alt {activeTab.toUpperCase()})
              </label>
              <input
                id="duo-alt"
                type="text"
                className={styles.input}
                value={formData.duo.imageAlt[activeTab]}
                onChange={(e) => updateLocalized(["duo", "imageAlt"], e.target.value)}
              />
            </div>
          </section>

          {/* Section Savoir-faire */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Savoir-faire</h2>
            <p className={styles.sectionSubtitle}>
              Listes des prestations photo et vidéo ({activeTab.toUpperCase()}).
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="sf-title">
                Titre de section
              </label>
              <input
                id="sf-title"
                type="text"
                className={styles.input}
                value={formData.savoirFaire.title[activeTab]}
                onChange={(e) => updateLocalized(["savoirFaire", "title"], e.target.value)}
              />
            </div>
            <div className={styles.row2}>
              <div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="sf-photo-title">
                    Titre catégorie Photo
                  </label>
                  <input
                    id="sf-photo-title"
                    type="text"
                    className={styles.input}
                    value={formData.savoirFaire.photoTitle[activeTab]}
                    onChange={(e) => updateLocalized(["savoirFaire", "photoTitle"], e.target.value)}
                  />
                </div>
                {formData.savoirFaire.photoItems.length === 0 ? (
                  <div className={styles.emptyListNotice}>
                    Aucun élément photo pour le moment.
                  </div>
                ) : (
                  formData.savoirFaire.photoItems.map((item, idx) => (
                    <div key={idx} className={styles.fieldGroup}>
                      <label className={styles.label} htmlFor={`sf-photo-${idx}`}>
                        Élément photo {idx + 1}
                      </label>
                      <div className={styles.listItemRow}>
                        <input
                          id={`sf-photo-${idx}`}
                          type="text"
                          className={styles.input}
                          value={item[activeTab]}
                          placeholder={`Texte (${activeTab.toUpperCase()})`}
                          onChange={(e) => {
                            const newItems = [...formData.savoirFaire.photoItems];
                            newItems[idx] = { ...newItems[idx], [activeTab]: e.target.value };
                            setFormData({
                              ...formData,
                              savoirFaire: { ...formData.savoirFaire, photoItems: newItems },
                            });
                          }}
                        />
                        <button
                          type="button"
                          className={styles.itemMoveButton}
                          disabled={idx === 0}
                          onClick={() => handleMovePhotoItem(idx, -1)}
                          aria-label={`Monter élément photo ${idx + 1}`}
                          title="Monter"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className={styles.itemMoveButton}
                          disabled={idx === formData.savoirFaire.photoItems.length - 1}
                          onClick={() => handleMovePhotoItem(idx, 1)}
                          aria-label={`Descendre élément photo ${idx + 1}`}
                          title="Descendre"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          className={styles.deleteRowButton}
                          onClick={() => handleRemovePhotoItem(idx)}
                          aria-label={`Supprimer élément photo ${idx + 1}`}
                          title="Supprimer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  className={styles.addRowButton}
                  onClick={handleAddPhotoItem}
                >
                  + Ajouter un élément photo
                </button>
              </div>
              <div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="sf-video-title">
                    Titre catégorie Vidéo
                  </label>
                  <input
                    id="sf-video-title"
                    type="text"
                    className={styles.input}
                    value={formData.savoirFaire.videoTitle[activeTab]}
                    onChange={(e) => updateLocalized(["savoirFaire", "videoTitle"], e.target.value)}
                  />
                </div>
                {formData.savoirFaire.videoItems.length === 0 ? (
                  <div className={styles.emptyListNotice}>
                    Aucun élément vidéo pour le moment.
                  </div>
                ) : (
                  formData.savoirFaire.videoItems.map((item, idx) => (
                    <div key={idx} className={styles.fieldGroup}>
                      <label className={styles.label} htmlFor={`sf-video-${idx}`}>
                        Élément vidéo {idx + 1}
                      </label>
                      <div className={styles.listItemRow}>
                        <input
                          id={`sf-video-${idx}`}
                          type="text"
                          className={styles.input}
                          value={item[activeTab]}
                          placeholder={`Texte (${activeTab.toUpperCase()})`}
                          onChange={(e) => {
                            const newItems = [...formData.savoirFaire.videoItems];
                            newItems[idx] = { ...newItems[idx], [activeTab]: e.target.value };
                            setFormData({
                              ...formData,
                              savoirFaire: { ...formData.savoirFaire, videoItems: newItems },
                            });
                          }}
                        />
                        <button
                          type="button"
                          className={styles.itemMoveButton}
                          disabled={idx === 0}
                          onClick={() => handleMoveVideoItem(idx, -1)}
                          aria-label={`Monter élément vidéo ${idx + 1}`}
                          title="Monter"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className={styles.itemMoveButton}
                          disabled={idx === formData.savoirFaire.videoItems.length - 1}
                          onClick={() => handleMoveVideoItem(idx, 1)}
                          aria-label={`Descendre élément vidéo ${idx + 1}`}
                          title="Descendre"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          className={styles.deleteRowButton}
                          onClick={() => handleRemoveVideoItem(idx)}
                          aria-label={`Supprimer élément vidéo ${idx + 1}`}
                          title="Supprimer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  className={styles.addRowButton}
                  onClick={handleAddVideoItem}
                >
                  + Ajouter un élément vidéo
                </button>
              </div>
            </div>
          </section>

          {/* Section Contact */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Coordonnées et Réseaux</h2>
            <p className={styles.sectionSubtitle}>
              Email de contact et liens vers les profils officiels.
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="contact-title">
                Titre de contact ({activeTab.toUpperCase()})
              </label>
              <input
                id="contact-title"
                type="text"
                className={styles.input}
                value={formData.contact.title[activeTab]}
                onChange={(e) => updateLocalized(["contact", "title"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="contact-email">
                Adresse email (laisser vide si non validée)
              </label>
              <input
                id="contact-email"
                type="email"
                placeholder="Exemple : contact@parallax.studio"
                className={styles.input}
                value={formData.contact.email}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    contact: { ...formData.contact, email: e.target.value },
                  })
                }
              />
            </div>
            <div className={styles.row2}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="contact-insta">
                  URL Instagram
                </label>
                <input
                  id="contact-insta"
                  type="url"
                  className={styles.input}
                  value={formData.contact.instagramUrl}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      contact: { ...formData.contact, instagramUrl: e.target.value },
                    })
                  }
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="contact-yt">
                  URL YouTube
                </label>
                <input
                  id="contact-yt"
                  type="url"
                  className={styles.input}
                  value={formData.contact.youtubeUrl}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      contact: { ...formData.contact, youtubeUrl: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          </section>

          {/* Section SEMPRA */}
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>Bloc SEMPRA (mariage)</h2>
            <p className={styles.sectionSubtitle}>
              Section de renvoi vers le studio mariage ({activeTab.toUpperCase()}).
            </p>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="sp-badge">
                Sur-titre SEMPRA
              </label>
              <input
                id="sp-badge"
                type="text"
                className={styles.input}
                value={formData.sempra.badge[activeTab]}
                onChange={(e) => updateLocalized(["sempra", "badge"], e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="sp-title">
                Accroche SEMPRA
              </label>
              <input
                id="sp-title"
                type="text"
                className={styles.input}
                value={formData.sempra.title[activeTab]}
                onChange={(e) => updateLocalized(["sempra", "title"], e.target.value)}
              />
            </div>
            <div className={styles.row2}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="sp-btn-text">
                  Texte du bouton CTA
                </label>
                <input
                  id="sp-btn-text"
                  type="text"
                  className={styles.input}
                  value={formData.sempra.buttonText[activeTab]}
                  onChange={(e) => updateLocalized(["sempra", "buttonText"], e.target.value)}
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="sp-btn-url">
                  Lien de redirection CTA (SEMPRA)
                </label>
                <input
                  id="sp-btn-url"
                  type="url"
                  placeholder="https://sempra.be/"
                  className={styles.input}
                  value={formData.sempra.buttonUrl}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      sempra: { ...formData.sempra, buttonUrl: e.target.value },
                    })
                  }
                />
                <span className={styles.labelHint}>
                  URL externe vers le site SEMPRA (ex: https://sempra.be/). Protocole http ou https requis.
                </span>
              </div>
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
                  : "Enregistrer la page d'accueil"}
            </button>
          </div>
        </Form>
      </main>
    </div>
  );
}
