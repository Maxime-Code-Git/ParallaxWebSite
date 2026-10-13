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
  type PortfolioProject,
  type PortfolioMediaItem,
  PORTFOLIO_CATEGORIES,
  slugify,
} from "../../lib/portfolio-content.shared";
import { parseVideoUrl } from "../../lib/video";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import { RevisionConflictError, ValidationError } from "../../lib/site-content.server";
import styles from "./portfolio-edit.module.css";

export const meta: MetaFunction = () => {
  return [
    { title: "Édition du projet | Administration Parallax" },
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

  const { content } = getRawPortfolioContent();
  const project = content.projects.find((p) => p.id === params.id);

  if (!project) {
    throw new Response("Projet introuvable", { status: 404, headers: responseHeaders });
  }

  return Response.json(
    {
      project,
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

  const formData = await request.formData();
  const csrfToken = formData.get("csrfToken");
  const sessionCsrf = session.get("csrfToken");

  if (!csrfToken || !sessionCsrf || !constantTimeEqual(String(csrfToken), sessionCsrf)) {
    return Response.json({ error: "Jeton CSRF invalide ou expiré." }, { status: 403, headers: createAdminHeaders() });
  }

  const expectedRevision = String(formData.get("revision") || "");
  const { content } = getRawPortfolioContent();

  const projectIndex = content.projects.findIndex((p) => p.id === params.id);
  if (projectIndex === -1) {
    return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
  }

  const nextContent = JSON.parse(JSON.stringify(content));
  const proj = nextContent.projects[projectIndex];

  // Extract form fields
  const titleFr = String(formData.get("titleFr") || "").trim();
  const titleEn = String(formData.get("titleEn") || "").trim();
  const slugFr = slugify(String(formData.get("slugFr") || ""));
  const slugEn = slugify(String(formData.get("slugEn") || ""));
  const category = String(formData.get("category") || "documentary") as PortfolioCategory;
  const summaryFr = String(formData.get("summaryFr") || "").trim();
  const summaryEn = String(formData.get("summaryEn") || "").trim();
  const descParagraphsFr = String(formData.get("descriptionFr") || "").trim();
  const descParagraphsEn = String(formData.get("descriptionEn") || "").trim();
  const seoTitleFr = String(formData.get("seoTitleFr") || "").trim();
  const seoTitleEn = String(formData.get("seoTitleEn") || "").trim();
  const seoDescFr = String(formData.get("seoDescFr") || "").trim();
  const seoDescEn = String(formData.get("seoDescEn") || "").trim();
  const coverAltFr = String(formData.get("coverAltFr") || "").trim();
  const coverAltEn = String(formData.get("coverAltEn") || "").trim();
  const showcase = formData.get("showcase") === "true";
  const side = String(formData.get("side") || "auto") as "auto" | "left" | "right";
  const status = String(formData.get("status") || "draft") as "draft" | "published";
  const coverImageId = formData.get("coverImageId") ? String(formData.get("coverImageId")) : null;
  const videoCoverImageId = formData.get("videoCoverImageId") ? String(formData.get("videoCoverImageId")) : null;
  const rawVideoUrl = String(formData.get("videoUrl") || "").trim();

  let galleryImageIds: string[] = [];
  try {
    const rawGids = formData.get("galleryImageIds");
    if (rawGids) {
      galleryImageIds = JSON.parse(String(rawGids));
    }
  } catch {
    // fallback empty
  }

  // Parse video if present
  let videoObj: PortfolioProject["video"] = null;
  if (rawVideoUrl) {
    const parsed = parseVideoUrl(rawVideoUrl);
    if (!parsed) {
      return Response.json(
        { error: "L'URL vidéo doit être un lien HTTPS valide YouTube ou Vimeo." },
        { status: 422, headers: createAdminHeaders() }
      );
    }
    videoObj = {
      provider: parsed.provider,
      videoId: parsed.videoId,
      url: rawVideoUrl,
      coverImageId: videoCoverImageId,
    };
  }

  // Build description blocks
  const frParagraphs = descParagraphsFr.split("\n\n").map((p) => p.trim()).filter(Boolean);
  const enParagraphs = descParagraphsEn.split("\n\n").map((p) => p.trim()).filter(Boolean);
  const maxBlocks = Math.max(frParagraphs.length, enParagraphs.length, 1);

  const descriptionBlocks: PortfolioProject["description"] = [];
  for (let i = 0; i < maxBlocks; i++) {
    descriptionBlocks.push({
      type: "paragraph",
      text: {
        fr: frParagraphs[i] || "",
        en: enParagraphs[i] || "",
      },
    });
  }

  // Update project in memory
  proj.title = { fr: titleFr || "Sans titre", en: titleEn || "Untitled" };
  proj.slugFr = slugFr || `projet-${Date.now().toString(36)}`;
  proj.slugEn = slugEn || `project-${Date.now().toString(36)}`;
  proj.category = PORTFOLIO_CATEGORIES.includes(category) ? category : "documentary";
  proj.summary = { fr: summaryFr, en: summaryEn };
  proj.description = descriptionBlocks;
  proj.seo = {
    title: { fr: seoTitleFr || proj.title.fr, en: seoTitleEn || proj.title.en },
    description: { fr: seoDescFr || proj.summary.fr, en: seoDescEn || proj.summary.en },
  };
  proj.coverImageId = coverImageId;
  proj.coverAlt = { fr: coverAltFr || proj.title.fr, en: coverAltEn || proj.title.en };
  proj.galleryImageIds = galleryImageIds;
  proj.video = videoObj;
  proj.showcase = showcase;
  proj.side = side;
  proj.status = status;
  proj.updatedAt = Date.now();

  try {
    const saveResult = await savePortfolioContent(nextContent, expectedRevision);
    void cleanupUnreferencedPortfolioMedia().catch(() => undefined);

    return Response.json(
      {
        success: "Projet enregistré avec succès !",
        newRevision: saveResult.newRevision,
      },
      { headers: createAdminHeaders() }
    );
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      return Response.json(
        {
          error: "Conflit de révision : ce projet a été modifié par ailleurs. Veuillez copier vos modifications et recharger la page.",
          currentRevision: content.revision,
        },
        { status: 409, headers: createAdminHeaders() }
      );
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 422, headers: createAdminHeaders() });
    }
    return Response.json(
      { error: "Une erreur inattendue est survenue lors de l'enregistrement." },
      { status: 500, headers: createAdminHeaders() }
    );
  }
}

interface LoaderData {
  project: PortfolioProject;
  contentRevision: string;
  media: Record<string, PortfolioMediaItem>;
  csrfToken: string;
}

export default function AdminPortfolioEditPage() {
  const { project, contentRevision, media, csrfToken } = useLoaderData<LoaderData>();
  const actionData = useActionData<{ error?: string; success?: string; newRevision?: string }>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [activeLang, setActiveLang] = useState<"fr" | "en">("fr");
  const [currentRevision, setCurrentRevision] = useState(contentRevision);

  // Editable states
  const [coverImageId, setCoverImageId] = useState<string | null>(project.coverImageId);
  const [videoCoverImageId, setVideoCoverImageId] = useState<string | null>(
    project.video?.coverImageId || null
  );
  const [galleryImageIds, setGalleryImageIds] = useState<string[]>(project.galleryImageIds || []);
  const [mediaRegistry, setMediaRegistry] = useState(media);

  // Upload status states
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isUploadingVideoCover, setIsUploadingVideoCover] = useState(false);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);
  const [galleryUploadProgress, setGalleryUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const videoCoverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Update revision if returned from action
  if (actionData?.newRevision && actionData.newRevision !== currentRevision) {
    setCurrentRevision(actionData.newRevision);
  }

  // Upload single image helper
  async function uploadImageFile(file: File, mediaSlot: "cover" | "video_cover" | "gallery") {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": project.id,
        "x-portfolio-media-slot": mediaSlot,
        "x-portfolio-revision": currentRevision,
      },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Échec du téléversement");
    }

    // Update revision and media registry in client state
    setCurrentRevision(data.newRevision);
    setMediaRegistry((prev) => ({ ...prev, [data.imageId]: data.metadata }));
    return data.imageId as string;
  }

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingCover(true);
    setUploadError(null);
    try {
      const newImageId = await uploadImageFile(file, "cover");
      setCoverImageId(newImageId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleVideoCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingVideoCover(true);
    setUploadError(null);
    try {
      const newImageId = await uploadImageFile(file, "video_cover");
      setVideoCoverImageId(newImageId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploadingVideoCover(false);
      if (videoCoverInputRef.current) videoCoverInputRef.current.value = "";
    }
  }

  async function handleGalleryFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsUploadingGallery(true);
    setUploadError(null);
    const newIds: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setGalleryUploadProgress(`Téléversement de l'image ${i + 1}/${files.length}...`);
        const id = await uploadImageFile(file, "gallery");
        newIds.push(id);
      }
      setGalleryImageIds((prev) => [...prev, ...newIds]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploadingGallery(false);
      setGalleryUploadProgress(null);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  function removeGalleryImage(imageId: string) {
    setGalleryImageIds((prev) => prev.filter((id) => id !== imageId));
  }

  const initialDescFr = project.description
    .map((b) => b.text.fr)
    .filter(Boolean)
    .join("\n\n");
  const initialDescEn = project.description
    .map((b) => b.text.en)
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className={styles.container}>
      <Link to="/admin/portfolio" className={styles.backLink}>
        ← Retour aux projets
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Édition : {project.title.fr}</h1>
          <span style={{ fontSize: 13, color: "#8A92A6" }}>ID : {project.id}</span>
        </div>

        <div>
          <span
            style={{
              padding: "4px 12px",
              borderRadius: 999,
              fontSize: 13,
              background: project.status === "published" ? "rgba(46,213,115,0.15)" : "rgba(255,171,0,0.15)",
              color: project.status === "published" ? "#2ed573" : "#ffab00",
            }}
          >
            {project.status === "published" ? "Publié" : "Brouillon"}
          </span>
        </div>
      </div>

      {actionData?.success && (
        <div className={styles.alertSuccess} role="status">
          {actionData.success}
        </div>
      )}

      {(actionData?.error || uploadError) && (
        <div className={styles.alertError} role="alert">
          {actionData?.error || uploadError}
        </div>
      )}

      <Form method="post">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="revision" value={currentRevision} />
        <input type="hidden" name="coverImageId" value={coverImageId || ""} />
        <input type="hidden" name="videoCoverImageId" value={videoCoverImageId || ""} />
        <input type="hidden" name="galleryImageIds" value={JSON.stringify(galleryImageIds)} />

        <div className={styles.formGrid}>
          {/* Main Left Column */}
          <div>
            {/* Language toggle for editorial fields */}
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

            {/* General Information Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Informations générales</h2>

              <div className={styles.formGroup} style={{ display: activeLang === "fr" ? "block" : "none" }}>
                <label className={styles.label} htmlFor="titleFr">
                  Titre du projet (FR) *
                </label>
                <input
                  id="titleFr"
                  name="titleFr"
                  type="text"
                  required
                  defaultValue={project.title.fr}
                  className={styles.input}
                />
              </div>

              <div className={styles.formGroup} style={{ display: activeLang === "en" ? "block" : "none" }}>
                <label className={styles.label} htmlFor="titleEn">
                  Project Title (EN) *
                </label>
                <input
                  id="titleEn"
                  name="titleEn"
                  type="text"
                  required
                  defaultValue={project.title.en}
                  className={styles.input}
                />
              </div>

              <div className={styles.twoCol}>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="slugFr">
                    Slug d'accès FR *
                  </label>
                  <input
                    id="slugFr"
                    name="slugFr"
                    type="text"
                    required
                    defaultValue={project.slugFr}
                    className={styles.input}
                  />
                  <div className={styles.helperText}>
                    Ex : mon-court-metrage (URL : /fr/projets/rubrique/slug)
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="slugEn">
                    Slug d'accès EN *
                  </label>
                  <input
                    id="slugEn"
                    name="slugEn"
                    type="text"
                    required
                    defaultValue={project.slugEn}
                    className={styles.input}
                  />
                  <div className={styles.helperText}>
                    Ex : my-short-film (URL : /en/projects/category/slug)
                  </div>
                </div>
              </div>

              <div className={styles.formGroup} style={{ display: activeLang === "fr" ? "block" : "none" }}>
                <label className={styles.label} htmlFor="summaryFr">
                  Résumé accrocheur (FR) *
                </label>
                <textarea
                  id="summaryFr"
                  name="summaryFr"
                  required
                  defaultValue={project.summary.fr}
                  className={styles.textarea}
                  rows={3}
                />
              </div>

              <div className={styles.formGroup} style={{ display: activeLang === "en" ? "block" : "none" }}>
                <label className={styles.label} htmlFor="summaryEn">
                  Catchy Summary (EN) *
                </label>
                <textarea
                  id="summaryEn"
                  name="summaryEn"
                  required
                  defaultValue={project.summary.en}
                  className={styles.textarea}
                  rows={3}
                />
              </div>

              <div className={styles.formGroup} style={{ display: activeLang === "fr" ? "block" : "none" }}>
                <label className={styles.label} htmlFor="descriptionFr">
                  Contenu détaillé (FR)
                </label>
                <textarea
                  id="descriptionFr"
                  name="descriptionFr"
                  defaultValue={initialDescFr}
                  className={styles.textarea}
                  rows={6}
                />
                <div className={styles.helperText}>
                  Séparez chaque paragraphe par une ligne vide.
                </div>
              </div>

              <div className={styles.formGroup} style={{ display: activeLang === "en" ? "block" : "none" }}>
                <label className={styles.label} htmlFor="descriptionEn">
                  Detailed Content (EN)
                </label>
                <textarea
                  id="descriptionEn"
                  name="descriptionEn"
                  defaultValue={initialDescEn}
                  className={styles.textarea}
                  rows={6}
                />
                <div className={styles.helperText}>
                  Separate paragraphs with a blank line.
                </div>
              </div>
            </div>

            {/* Media & Gallery Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Photos et galerie</h2>

              {/* Cover image uploader */}
              <div className={styles.formGroup}>
                <label className={styles.label}>Image de couverture</label>
                <div className={styles.uploaderBox}>
                  {coverImageId ? (
                    <div>
                      <div className={styles.previewImageWrap}>
                        <ResponsivePortfolioImage
                          imageId={coverImageId}
                          ownerType="project"
                          ownerId={project.id}
                          mediaSlot="cover"
                          mediaMetadata={mediaRegistry[coverImageId]}
                          alt="Couverture"
                          isAdminPreview
                        />
                      </div>
                      <div className={styles.uploadActions}>
                        <button
                          type="button"
                          className={styles.uploadBtn}
                          onClick={() => coverInputRef.current?.click()}
                          disabled={isUploadingCover}
                        >
                          {isUploadingCover ? "Téléversement..." : "Remplacer l'image"}
                        </button>
                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={() => setCoverImageId(null)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p style={{ margin: "0 0 16px", color: "#8A92A6", fontSize: 14 }}>
                        Aucune image de couverture sélectionnée.
                      </p>
                      <button
                        type="button"
                        className={styles.uploadBtn}
                        onClick={() => coverInputRef.current?.click()}
                        disabled={isUploadingCover}
                      >
                        {isUploadingCover ? "Téléversement en cours..." : "Choisir une image"}
                      </button>
                    </div>
                  )}
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    onChange={handleCoverChange}
                  />
                </div>
              </div>

              {/* Cover Alt text */}
              <div className={styles.twoCol}>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="coverAltFr">
                    Texte alternatif (Alt FR)
                  </label>
                  <input
                    id="coverAltFr"
                    name="coverAltFr"
                    type="text"
                    defaultValue={project.coverAlt.fr}
                    className={styles.input}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="coverAltEn">
                    Alternative text (Alt EN)
                  </label>
                  <input
                    id="coverAltEn"
                    name="coverAltEn"
                    type="text"
                    defaultValue={project.coverAlt.en}
                    className={styles.input}
                  />
                </div>
              </div>

              {/* Project photo gallery */}
              <div className={styles.formGroup} style={{ marginTop: 28 }}>
                <label className={styles.label}>
                  Galerie photos ({galleryImageIds.length} image{galleryImageIds.length > 1 ? "s" : ""})
                </label>
                <div className={styles.uploaderBox}>
                  <p style={{ margin: "0 0 16px", color: "#8A92A6", fontSize: 13 }}>
                    Ajoutez plusieurs photos à la galerie. Elles seront importées séquentiellement.
                  </p>
                  <button
                    type="button"
                    className={styles.uploadBtn}
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={isUploadingGallery}
                  >
                    {isUploadingGallery ? galleryUploadProgress || "Téléversement..." : "+ Ajouter des photos"}
                  </button>
                  <input
                    ref={galleryInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    onChange={handleGalleryFiles}
                  />

                  {galleryImageIds.length > 0 && (
                    <div className={styles.galleryGrid}>
                      {galleryImageIds.map((gid) => (
                        <div key={gid} className={styles.galleryItem}>
                          <ResponsivePortfolioImage
                            imageId={gid}
                            ownerType="project"
                            ownerId={project.id}
                            mediaSlot="gallery"
                            mediaMetadata={mediaRegistry[gid]}
                            alt="Galerie"
                            isAdminPreview
                          />
                          <button
                            type="button"
                            className={styles.galleryItemRemove}
                            onClick={() => removeGalleryImage(gid)}
                            aria-label="Retirer cette photo"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Video Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Vidéo associée (optionnel)</h2>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="videoUrl">
                  Lien YouTube ou Vimeo
                </label>
                <input
                  id="videoUrl"
                  name="videoUrl"
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=... ou https://vimeo.com/..."
                  defaultValue={project.video?.url || ""}
                  className={styles.input}
                />
                <div className={styles.helperText}>
                  La vidéo ne sera chargée qu'après consentement explicite du visiteur.
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Image de couverture de la vidéo</label>
                <div className={styles.uploaderBox}>
                  {videoCoverImageId ? (
                    <div>
                      <div className={styles.previewImageWrap}>
                        <ResponsivePortfolioImage
                          imageId={videoCoverImageId}
                          ownerType="project"
                          ownerId={project.id}
                          mediaSlot="video_cover"
                          mediaMetadata={mediaRegistry[videoCoverImageId]}
                          alt="Couverture vidéo"
                          isAdminPreview
                        />
                      </div>
                      <div className={styles.uploadActions}>
                        <button
                          type="button"
                          className={styles.uploadBtn}
                          onClick={() => videoCoverInputRef.current?.click()}
                          disabled={isUploadingVideoCover}
                        >
                          {isUploadingVideoCover ? "Téléversement..." : "Remplacer l'image"}
                        </button>
                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={() => setVideoCoverImageId(null)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        className={styles.uploadBtn}
                        onClick={() => videoCoverInputRef.current?.click()}
                        disabled={isUploadingVideoCover}
                      >
                        {isUploadingVideoCover ? "Téléversement..." : "Choisir une couverture vidéo"}
                      </button>
                    </div>
                  )}
                  <input
                    ref={videoCoverInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    onChange={handleVideoCoverChange}
                  />
                </div>
              </div>
            </div>

            {/* SEO Metadata Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Référencement (SEO)</h2>

              <div className={styles.twoCol}>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="seoTitleFr">
                    Titre SEO (FR)
                  </label>
                  <input
                    id="seoTitleFr"
                    name="seoTitleFr"
                    type="text"
                    defaultValue={project.seo.title.fr}
                    className={styles.input}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="seoTitleEn">
                    SEO Title (EN)
                  </label>
                  <input
                    id="seoTitleEn"
                    name="seoTitleEn"
                    type="text"
                    defaultValue={project.seo.title.en}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={styles.twoCol}>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="seoDescFr">
                    Description SEO (FR)
                  </label>
                  <textarea
                    id="seoDescFr"
                    name="seoDescFr"
                    defaultValue={project.seo.description.fr}
                    className={styles.textarea}
                    rows={2}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="seoDescEn">
                    SEO Description (EN)
                  </label>
                  <textarea
                    id="seoDescEn"
                    name="seoDescEn"
                    defaultValue={project.seo.description.en}
                    className={styles.textarea}
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (Settings & Publication) */}
          <div>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Publication & Affichage</h2>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="status">
                  Statut du projet
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={project.status}
                  className={styles.select}
                >
                  <option value="draft">Brouillon (invisible du public)</option>
                  <option value="published">Publié (visible dans le portfolio)</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="category">
                  Rubrique
                </label>
                <select
                  id="category"
                  name="category"
                  defaultValue={project.category}
                  className={styles.select}
                >
                  <option value="documentary">Documentaire</option>
                  <option value="advertising">Publicité</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="showcase">
                  Présentation dans les rangées d'accueil
                </label>
                <select
                  id="showcase"
                  name="showcase"
                  defaultValue={project.showcase ? "true" : "false"}
                  className={styles.select}
                >
                  <option value="false">Non (visible uniquement dans la rubrique)</option>
                  <option value="true">Oui (mis en avant sur la page portfolio)</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="side">
                  Côté dans la rangée
                </label>
                <select
                  id="side"
                  name="side"
                  defaultValue={project.side}
                  className={styles.select}
                >
                  <option value="auto">Automatique (alternance)</option>
                  <option value="left">Image à gauche</option>
                  <option value="right">Image à droite</option>
                </select>
                <div className={styles.helperText}>
                  Détermine également le sens d'ouverture du panneau.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Save Bar */}
        <div className={styles.saveBar}>
          <div>
            <Link to="/admin/portfolio" style={{ color: "#8A92A6", textDecoration: "none" }}>
              Annuler
            </Link>
          </div>
          <button
            type="submit"
            disabled={isSaving || isUploadingCover || isUploadingGallery}
            className={styles.primarySaveBtn}
          >
            {isSaving ? "Enregistrement en cours..." : "Enregistrer les modifications"}
          </button>
        </div>
      </Form>
    </div>
  );
}
