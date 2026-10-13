import { useState, useRef } from "react";
import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
  type HeadersArgs,
  type MetaFunction,
  Form,
  Link,
  useLoaderData,
  useActionData,
  useNavigation,
} from "react-router";
import * as crypto from "node:crypto";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import { validateOrigin } from "../../lib/security.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { commitSession } from "../../lib/session.server";
import {
  getRawPortfolioContent,
  savePortfolioContent,
  cleanupUnreferencedPortfolioMedia,
} from "../../lib/portfolio-content.server";
import {
  type PortfolioCategory,
  type PortfolioSection,
  type PortfolioOverview,
  type PortfolioMediaItem,
  PORTFOLIO_CATEGORIES,
} from "../../lib/portfolio-content.shared";
import { parseVideoUrl } from "../../lib/video";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import { RevisionConflictError, ValidationError } from "../../lib/site-content.server";
import styles from "./portfolio-edit.module.css";

export const meta: MetaFunction = () => {
  return [
    { title: "Édition de rubrique | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
};

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const responseHeaders = createAdminHeaders();

  let csrfToken = session.get("csrfToken");
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    session.set("csrfToken", csrfToken);
    responseHeaders.set("Set-Cookie", await commitSession(session));
  }

  const category = params.category as PortfolioCategory;
  if (!PORTFOLIO_CATEGORIES.includes(category)) {
    throw new Response("Rubrique introuvable", { status: 404, headers: responseHeaders });
  }

  const { content } = getRawPortfolioContent();
  const section = content.sections[category];

  return Response.json(
    {
      section,
      category,
      overview: content.overview,
      contentRevision: content.revision,
      media: content.media,
      csrfToken,
    },
    { headers: responseHeaders }
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const session = await requireValidAdminSession(request);

  if (!validateOrigin(request)) {
    return Response.json({ error: "Origine non autorisée." }, { status: 403, headers: createAdminHeaders() });
  }

  const category = params.category as PortfolioCategory;
  if (!PORTFOLIO_CATEGORIES.includes(category)) {
    return Response.json({ error: "Rubrique introuvable." }, { status: 404, headers: createAdminHeaders() });
  }

  const formData = await request.formData();
  const csrfToken = formData.get("csrfToken");
  const sessionCsrf = session.get("csrfToken");

  if (!csrfToken || !sessionCsrf || !constantTimeEqual(String(csrfToken), sessionCsrf)) {
    return Response.json({ error: "Jeton CSRF invalide ou expiré." }, { status: 403, headers: createAdminHeaders() });
  }

  const expectedRevision = String(formData.get("revision") || "");
  const { content } = getRawPortfolioContent();

  const nextContent = JSON.parse(JSON.stringify(content));
  const section = nextContent.sections[category] as PortfolioSection;

  // 1. Textes et intro
  section.title = {
    fr: String(formData.get("title_fr") || "").trim(),
    en: String(formData.get("title_en") || "").trim(),
  };
  section.intro = {
    fr: String(formData.get("intro_fr") || "").trim(),
    en: String(formData.get("intro_en") || "").trim(),
  };

  // 2. SEO
  section.seo = {
    title: {
      fr: String(formData.get("seo_title_fr") || "").trim(),
      en: String(formData.get("seo_title_en") || "").trim(),
    },
    description: {
      fr: String(formData.get("seo_desc_fr") || "").trim(),
      en: String(formData.get("seo_desc_en") || "").trim(),
    },
  };

  // 3. Couverture
  const coverImageId = String(formData.get("coverImageId") || "").trim();
  section.coverImageId = coverImageId ? coverImageId : null;
  section.coverAlt = {
    fr: String(formData.get("coverAlt_fr") || "").trim(),
    en: String(formData.get("coverAlt_en") || "").trim(),
  };

  // 4. Showreel
  section.showreelTitle = {
    fr: String(formData.get("showreelTitle_fr") || "").trim(),
    en: String(formData.get("showreelTitle_en") || "").trim(),
  };
  const showreelUrlRaw = String(formData.get("showreelUrl") || "").trim();
  const showreelCoverImageId = String(formData.get("showreelCoverImageId") || "").trim();
  section.showreelCoverImageId = showreelCoverImageId ? showreelCoverImageId : null;

  if (showreelUrlRaw) {
    const parsedVideo = parseVideoUrl(showreelUrlRaw);
    if (!parsedVideo) {
      return Response.json(
        { error: "Format d'URL de showreel non reconnu. Seuls YouTube et Vimeo en HTTPS sont acceptés." },
        { status: 400, headers: createAdminHeaders() }
      );
    }
    section.showreelVideo = {
      provider: parsedVideo.provider,
      videoId: parsedVideo.videoId,
      url: showreelUrlRaw,
      coverImageId: section.showreelCoverImageId,
    };
  } else {
    section.showreelVideo = null;
  }

  // 5. Boutons de navigation
  section.morePhotosButton = {
    fr: String(formData.get("morePhotosButton_fr") || "").trim(),
    en: String(formData.get("morePhotosButton_en") || "").trim(),
  };
  section.lessPhotosButton = {
    fr: String(formData.get("lessPhotosButton_fr") || "").trim(),
    en: String(formData.get("lessPhotosButton_en") || "").trim(),
  };
  section.backButton = {
    fr: String(formData.get("backButton_fr") || "").trim(),
    en: String(formData.get("backButton_en") || "").trim(),
  };

  try {
    const saveResult = await savePortfolioContent(nextContent, expectedRevision);
    void cleanupUnreferencedPortfolioMedia().catch(() => undefined);

    return Response.json(
      {
        success: "Rubrique enregistrée avec succès.",
        newRevision: saveResult.newRevision,
      },
      { headers: createAdminHeaders() }
    );
  } catch (err: unknown) {
    if (err instanceof RevisionConflictError) {
      return Response.json({ error: err.message }, { status: 409, headers: createAdminHeaders() });
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 422, headers: createAdminHeaders() });
    }
    throw err;
  }
}

interface LoaderData {
  section: PortfolioSection;
  category: PortfolioCategory;
  overview: PortfolioOverview;
  contentRevision: string;
  media: Record<string, PortfolioMediaItem>;
  csrfToken: string;
}

export default function AdminPortfolioSectionPage() {
  const {
    section,
    category,
    contentRevision,
    media: initialMedia,
    csrfToken,
  } = useLoaderData<LoaderData>();
  const actionData = useActionData<{ success?: string; error?: string; newRevision?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [activeLang, setActiveLang] = useState<"fr" | "en">("fr");
  const [currentRevision, setCurrentRevision] = useState(contentRevision);
  const [mediaMap, setMediaMap] = useState<Record<string, PortfolioMediaItem>>(initialMedia);

  const [coverImageId, setCoverImageId] = useState<string | null>(section.coverImageId);
  const [showreelCoverImageId, setShowreelCoverImageId] = useState<string | null>(
    section.showreelCoverImageId
  );

  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingShowreel, setUploadingShowreel] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const showreelCoverInputRef = useRef<HTMLInputElement>(null);

  const effectiveRevision = actionData?.newRevision || currentRevision;

  const categoryName = category === "documentary" ? "Documentaire" : "Publicité";

  const handleUploadImage = async (
    file: File,
    slot: "cover" | "showreel_cover",
    setUploading: (val: boolean) => void,
    onSuccessId: (id: string) => void
  ) => {
    setUploading(true);
    setUploadError(null);
    setUploadNotice(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/admin/portfolio-upload", {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "x-portfolio-owner-type": "section",
          "x-portfolio-owner-id": category,
          "x-portfolio-media-slot": slot,
          "x-portfolio-revision": effectiveRevision,
        },
        body: formData,
      });

      if (!res.ok) {
        if (res.status === 409) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setUploadError(data.error || "Conflit de révision lors de l'envoi de l'image. Veuillez actualiser.");
          return;
        }
        if (res.status === 503) {
          setUploadError("Le serveur traite actuellement d'autres images. Veuillez réessayer dans quelques instants.");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setUploadError(data.error || `Erreur lors de l'upload (${res.status}).`);
        return;
      }

      const data = (await res.json()) as {
        success: boolean;
        imageId: string;
        metadata: PortfolioMediaItem;
        newRevision: string;
      };

      setCurrentRevision(data.newRevision);
      setMediaMap((prev) => ({ ...prev, [data.imageId]: data.metadata }));
      onSuccessId(data.imageId);
      setUploadNotice("Image importée et enregistrée immédiatement.");
    } catch {
      setUploadError("Impossible de contacter le serveur d'upload.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={styles.container}>
      <Link to="/admin/portfolio" className={styles.backLink}>
        ← Retour à la gestion du portfolio
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Rubrique {categoryName}</h1>
          <p style={{ color: "#8A92A6", margin: "6px 0 0", fontSize: 14 }}>
            Textes d'introduction, visuel de bannière, showreel vidéo et boutons de la rubrique.
          </p>
        </div>
      </div>

      {actionData?.success && (
        <div className={styles.alertSuccess} role="status">
          {actionData.success}
        </div>
      )}

      {actionData?.error && (
        <div className={styles.alertError} role="alert">
          {actionData.error}
        </div>
      )}

      {uploadNotice && (
        <div className={styles.alertSuccess} role="status">
          {uploadNotice}
        </div>
      )}

      {uploadError && (
        <div className={styles.alertError} role="alert">
          {uploadError}
        </div>
      )}

      <div className={styles.langTabs}>
        <button
          type="button"
          className={`${styles.langTab} ${activeLang === "fr" ? styles.langTabActive : ""}`}
          onClick={() => setActiveLang("fr")}
        >
          Français (FR)
        </button>
        <button
          type="button"
          className={`${styles.langTab} ${activeLang === "en" ? styles.langTabActive : ""}`}
          onClick={() => setActiveLang("en")}
        >
          English (EN)
        </button>
      </div>

      <Form method="post">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="revision" value={effectiveRevision} />
        <input type="hidden" name="coverImageId" value={coverImageId || ""} />
        <input type="hidden" name="showreelCoverImageId" value={showreelCoverImageId || ""} />

        <div className={styles.formGrid}>
          {/* Main Column */}
          <div>
            {/* Presentation Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Textes de présentation</h2>

              <div style={{ display: activeLang === "fr" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="title_fr" className={styles.label}>
                    Titre de la rubrique (FR) *
                  </label>
                  <input
                    id="title_fr"
                    name="title_fr"
                    type="text"
                    required
                    defaultValue={section.title.fr}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="intro_fr" className={styles.label}>
                    Introduction / Accroche (FR)
                  </label>
                  <textarea
                    id="intro_fr"
                    name="intro_fr"
                    rows={4}
                    defaultValue={section.intro.fr}
                    className={styles.textarea}
                  />
                  <div className={styles.helperText}>
                    Texte affiché en en-tête du panneau déroulant de la rubrique.
                  </div>
                </div>
              </div>

              <div style={{ display: activeLang === "en" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="title_en" className={styles.label}>
                    Titre de la rubrique (EN) *
                  </label>
                  <input
                    id="title_en"
                    name="title_en"
                    type="text"
                    required
                    defaultValue={section.title.en}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="intro_en" className={styles.label}>
                    Introduction / Accroche (EN)
                  </label>
                  <textarea
                    id="intro_en"
                    name="intro_en"
                    rows={4}
                    defaultValue={section.intro.en}
                    className={styles.textarea}
                  />
                </div>
              </div>
            </div>

            {/* Showreel Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Showreel Vidéo de la Rubrique</h2>

              <div style={{ display: activeLang === "fr" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="showreelTitle_fr" className={styles.label}>
                    Titre du showreel (FR)
                  </label>
                  <input
                    id="showreelTitle_fr"
                    name="showreelTitle_fr"
                    type="text"
                    defaultValue={section.showreelTitle.fr}
                    className={styles.input}
                  />
                </div>
              </div>

              <div style={{ display: activeLang === "en" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="showreelTitle_en" className={styles.label}>
                    Titre du showreel (EN)
                  </label>
                  <input
                    id="showreelTitle_en"
                    name="showreelTitle_en"
                    type="text"
                    defaultValue={section.showreelTitle.en}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="showreelUrl" className={styles.label}>
                  URL de la vidéo (YouTube ou Vimeo en HTTPS)
                </label>
                <input
                  id="showreelUrl"
                  name="showreelUrl"
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=... ou https://vimeo.com/..."
                  defaultValue={section.showreelVideo?.url || ""}
                  className={styles.input}
                />
                <div className={styles.helperText}>
                  Aucun lecteur externe n'est chargé sans consentement explicite de l'utilisateur.
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Affiche / Couverture du Showreel</label>
                <div className={styles.uploaderBox}>
                  {showreelCoverImageId && mediaMap[showreelCoverImageId] ? (
                    <div>
                      <div className={styles.previewImageWrap}>
                        <ResponsivePortfolioImage
                          imageId={showreelCoverImageId}
                          ownerType="section"
                          ownerId={category}
                          mediaSlot="showreel_cover"
                          mediaMetadata={mediaMap[showreelCoverImageId]}
                          alt="Couverture du showreel"
                          isAdminPreview
                        />
                      </div>
                      <div className={styles.uploadActions}>
                        <button
                          type="button"
                          className={styles.uploadBtn}
                          disabled={uploadingShowreel}
                          onClick={() => showreelCoverInputRef.current?.click()}
                        >
                          {uploadingShowreel ? "Import en cours..." : "Remplacer l'affiche"}
                        </button>
                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={() => setShowreelCoverImageId(null)}
                        >
                          Supprimer l'affiche
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p style={{ color: "#8A92A6", fontSize: 14, margin: "0 0 12px" }}>
                        Aucune affiche personnalisée définie pour ce showreel.
                      </p>
                      <button
                        type="button"
                        className={styles.uploadBtn}
                        disabled={uploadingShowreel}
                        onClick={() => showreelCoverInputRef.current?.click()}
                      >
                        {uploadingShowreel ? "Import en cours..." : "Importer une affiche (Max 25 Mo)"}
                      </button>
                    </div>
                  )}

                  <input
                    ref={showreelCoverInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handleUploadImage(file, "showreel_cover", setUploadingShowreel, (id) =>
                          setShowreelCoverImageId(id)
                        );
                      }
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Buttons Labels Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Libellés des boutons de navigation</h2>

              <div style={{ display: activeLang === "fr" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="morePhotosButton_fr" className={styles.label}>
                    Bouton « Voir plus de photos » (FR)
                  </label>
                  <input
                    id="morePhotosButton_fr"
                    name="morePhotosButton_fr"
                    type="text"
                    defaultValue={section.morePhotosButton.fr}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="lessPhotosButton_fr" className={styles.label}>
                    Bouton « Voir moins » (FR)
                  </label>
                  <input
                    id="lessPhotosButton_fr"
                    name="lessPhotosButton_fr"
                    type="text"
                    defaultValue={section.lessPhotosButton.fr}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="backButton_fr" className={styles.label}>
                    Bouton « Retour » (FR)
                  </label>
                  <input
                    id="backButton_fr"
                    name="backButton_fr"
                    type="text"
                    defaultValue={section.backButton.fr}
                    className={styles.input}
                  />
                </div>
              </div>

              <div style={{ display: activeLang === "en" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="morePhotosButton_en" className={styles.label}>
                    Bouton « Voir plus de photos » (EN)
                  </label>
                  <input
                    id="morePhotosButton_en"
                    name="morePhotosButton_en"
                    type="text"
                    defaultValue={section.morePhotosButton.en}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="lessPhotosButton_en" className={styles.label}>
                    Bouton « Voir moins » (EN)
                  </label>
                  <input
                    id="lessPhotosButton_en"
                    name="lessPhotosButton_en"
                    type="text"
                    defaultValue={section.lessPhotosButton.en}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="backButton_en" className={styles.label}>
                    Bouton « Retour » (EN)
                  </label>
                  <input
                    id="backButton_en"
                    name="backButton_en"
                    type="text"
                    defaultValue={section.backButton.en}
                    className={styles.input}
                  />
                </div>
              </div>
            </div>

            {/* SEO Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Référencement naturel (SEO)</h2>

              <div style={{ display: activeLang === "fr" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="seo_title_fr" className={styles.label}>
                    Balise Title (FR)
                  </label>
                  <input
                    id="seo_title_fr"
                    name="seo_title_fr"
                    type="text"
                    defaultValue={section.seo.title.fr}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="seo_desc_fr" className={styles.label}>
                    Méta-description (FR)
                  </label>
                  <textarea
                    id="seo_desc_fr"
                    name="seo_desc_fr"
                    rows={3}
                    defaultValue={section.seo.description.fr}
                    className={styles.textarea}
                  />
                </div>
              </div>

              <div style={{ display: activeLang === "en" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="seo_title_en" className={styles.label}>
                    Balise Title (EN)
                  </label>
                  <input
                    id="seo_title_en"
                    name="seo_title_en"
                    type="text"
                    defaultValue={section.seo.title.en}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="seo_desc_en" className={styles.label}>
                    Méta-description (EN)
                  </label>
                  <textarea
                    id="seo_desc_en"
                    name="seo_desc_en"
                    rows={3}
                    defaultValue={section.seo.description.en}
                    className={styles.textarea}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Column */}
          <div>
            {/* Banner Cover Image */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Bannière / Couverture</h2>

              <div className={styles.uploaderBox}>
                {coverImageId && mediaMap[coverImageId] ? (
                  <div>
                    <div className={styles.previewImageWrap}>
                      <ResponsivePortfolioImage
                        imageId={coverImageId}
                        ownerType="section"
                        ownerId={category}
                        mediaSlot="cover"
                        mediaMetadata={mediaMap[coverImageId]}
                        alt={section.coverAlt.fr}
                        isAdminPreview
                      />
                    </div>
                    <div className={styles.uploadActions}>
                      <button
                        type="button"
                        className={styles.uploadBtn}
                        disabled={uploadingCover}
                        onClick={() => coverInputRef.current?.click()}
                      >
                        {uploadingCover ? "Import en cours..." : "Remplacer l'image"}
                      </button>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={() => setCoverImageId(null)}
                      >
                        Retirer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p style={{ color: "#8A92A6", fontSize: 14, margin: "0 0 12px" }}>
                      Aucune bannière configurée.
                    </p>
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      disabled={uploadingCover}
                      onClick={() => coverInputRef.current?.click()}
                    >
                      {uploadingCover ? "Import en cours..." : "Importer une bannière"}
                    </button>
                  </div>
                )}

                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void handleUploadImage(file, "cover", setUploadingCover, (id) => setCoverImageId(id));
                    }
                    e.target.value = "";
                  }}
                />
              </div>

              {/* Alt texts */}
              <div style={{ display: activeLang === "fr" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="coverAlt_fr" className={styles.label}>
                    Texte alternatif (Alt FR)
                  </label>
                  <input
                    id="coverAlt_fr"
                    name="coverAlt_fr"
                    type="text"
                    defaultValue={section.coverAlt.fr}
                    className={styles.input}
                  />
                </div>
              </div>

              <div style={{ display: activeLang === "en" ? "block" : "none" }}>
                <div className={styles.formGroup}>
                  <label htmlFor="coverAlt_en" className={styles.label}>
                    Texte alternatif (Alt EN)
                  </label>
                  <input
                    id="coverAlt_en"
                    name="coverAlt_en"
                    type="text"
                    defaultValue={section.coverAlt.en}
                    className={styles.input}
                  />
                </div>
              </div>
            </div>

            {/* Sticky Save Bar */}
            <div className={styles.saveBar}>
              <div style={{ fontSize: 13, color: "#8A92A6" }}>
                {isSubmitting ? "Enregistrement en cours..." : "Modifications non enregistrées"}
              </div>
              <button
                type="submit"
                disabled={isSubmitting || uploadingCover || uploadingShowreel}
                className={styles.primarySaveBtn}
              >
                {isSubmitting ? "Enregistrement..." : "Enregistrer la rubrique"}
              </button>
            </div>
          </div>
        </div>
      </Form>
    </div>
  );
}
