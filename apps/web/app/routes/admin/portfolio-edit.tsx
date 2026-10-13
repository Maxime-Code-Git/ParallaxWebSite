import { useState, useRef, useEffect } from "react";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireValidAdminSession, createAdminHeaders } from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin, readStrictFormUrlEncoded, ActionSecurityError } from "../../lib/security.server";
import {
  type PortfolioProject,
  type PortfolioCategory,
  type PortfolioMediaItem,
  PORTFOLIO_CATEGORIES,
  slugify,
} from "../../lib/portfolio-content.shared";
import {
  getRawPortfolioContent,
  savePortfolioContent,
  cleanupUnreferencedPortfolioMedia,
} from "../../lib/portfolio-content.server";
import { RevisionConflictError, ValidationError } from "../../lib/site-content.server";
import { parseVideoUrl } from "../../lib/video";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import styles from "./portfolio-edit.module.css";

export function meta() {
  return [
    { title: "Édition Projet | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const csrfToken = session.get("csrfToken");
  const responseHeaders = createAdminHeaders();

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

const ALLOWED_PROJECT_FIELDS = [
  "csrfToken",
  "revision",
  "titleFr",
  "titleEn",
  "slugFr",
  "slugEn",
  "category",
  "summaryFr",
  "summaryEn",
  "descriptionFr",
  "descriptionEn",
  "seoTitleFr",
  "seoTitleEn",
  "seoDescFr",
  "seoDescEn",
  "coverAltFr",
  "coverAltEn",
  "showcase",
  "side",
  "status",
  "coverImageId",
  "videoCoverImageId",
  "videoUrl",
  "galleryImageIds",
] as const;

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST", ...createAdminHeaders() },
    });
  }

  const session = await requireValidAdminSession(request);

  if (!validateOrigin(request)) {
    return Response.json({ error: "Origine non autorisée." }, { status: 403, headers: createAdminHeaders() });
  }

  let formData: URLSearchParams;
  try {
    formData = await readStrictFormUrlEncoded(request, 100 * 1024, ALLOWED_PROJECT_FIELDS);
  } catch (err) {
    if (err instanceof ActionSecurityError) {
      const headers = createAdminHeaders();
      if (err.status === 405) headers.set("Allow", "POST");
      return Response.json({ error: err.message }, { status: err.status, headers });
    }
    return Response.json({ error: "Bad Request" }, { status: 400, headers: createAdminHeaders() });
  }

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
  proj.draftVideoCoverImageId = videoCoverImageId;
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
          error: "Conflit de révision : ce projet a été modifié par ailleurs. Veuillez recharger la page.",
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
  const revisionRef = useRef(contentRevision);

  const updateRevision = (rev: string) => {
    revisionRef.current = rev;
    setCurrentRevision(rev);
  };

  // Synchronize revision only when new actionData arrives (never during render)
  const lastActionRef = useRef<unknown>(null);
  useEffect(() => {
    if (actionData && actionData !== lastActionRef.current) {
      lastActionRef.current = actionData;
      if (actionData.newRevision) {
        updateRevision(actionData.newRevision);
      }
    }
  }, [actionData]);

  // Form states initialized from project to preserve unsaved user input across uploads
  const [titleFr, setTitleFr] = useState(project.title.fr);
  const [titleEn, setTitleEn] = useState(project.title.en);
  const [slugFr, setSlugFr] = useState(project.slugFr);
  const [slugEn, setSlugEn] = useState(project.slugEn);
  const [summaryFr, setSummaryFr] = useState(project.summary.fr);
  const [summaryEn, setSummaryEn] = useState(project.summary.en);
  const [descriptionFr, setDescriptionFr] = useState(
    project.description.map((b) => b.text.fr).filter(Boolean).join("\n\n")
  );
  const [descriptionEn, setDescriptionEn] = useState(
    project.description.map((b) => b.text.en).filter(Boolean).join("\n\n")
  );
  const [seoTitleFr, setSeoTitleFr] = useState(project.seo.title.fr);
  const [seoTitleEn, setSeoTitleEn] = useState(project.seo.title.en);
  const [seoDescFr, setSeoDescFr] = useState(project.seo.description.fr);
  const [seoDescEn, setSeoDescEn] = useState(project.seo.description.en);
  const [coverAltFr, setCoverAltFr] = useState(project.coverAlt.fr);
  const [coverAltEn, setCoverAltEn] = useState(project.coverAlt.en);
  const [category, setCategory] = useState(project.category);
  const [showcase, setShowcase] = useState(project.showcase);
  const [side, setSide] = useState(project.side);
  const [status, setStatus] = useState(project.status);
  const [videoUrl, setVideoUrl] = useState(project.video?.url || "");

  // Media states
  const [coverImageId, setCoverImageId] = useState<string | null>(project.coverImageId);
  const [videoCoverImageId, setVideoCoverImageId] = useState<string | null>(
    project.video?.coverImageId || project.draftVideoCoverImageId || null
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

  // Upload single image helper with dynamic revision tracking
  async function uploadImageFile(
    file: File,
    mediaSlot: "cover" | "video_cover" | "gallery",
    targetRevision?: string
  ): Promise<{ imageId: string; newRevision: string }> {
    const formData = new FormData();
    formData.append("file", file);

    const revToUse = targetRevision ?? revisionRef.current;

    const res = await fetch("/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": project.id,
        "x-portfolio-media-slot": mediaSlot,
        "x-portfolio-revision": revToUse,
      },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Échec du téléversement");
    }

    updateRevision(data.newRevision);
    setMediaRegistry((prev) => ({ ...prev, [data.imageId]: data.metadata }));
    return { imageId: data.imageId as string, newRevision: data.newRevision as string };
  }

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingCover(true);
    setUploadError(null);
    try {
      const result = await uploadImageFile(file, "cover");
      setCoverImageId(result.imageId);
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
      const result = await uploadImageFile(file, "video_cover");
      setVideoCoverImageId(result.imageId);
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

    const MAX_GALLERY_FILES = 20;
    if (files.length > MAX_GALLERY_FILES) {
      setUploadError(`Veuillez sélectionner au maximum ${MAX_GALLERY_FILES} fichiers à la fois.`);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      return;
    }

    setIsUploadingGallery(true);
    setUploadError(null);

    let runningRevision = revisionRef.current;
    let succeededCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setGalleryUploadProgress(`Téléversement de l'image ${i + 1}/${files.length}...`);
      try {
        const result = await uploadImageFile(file, "gallery", runningRevision);
        runningRevision = result.newRevision;
        succeededCount++;
        // Apply immediately to local gallery as each image succeeds
        setGalleryImageIds((prev) => [...prev, result.imageId]);
      } catch (err) {
        setUploadError(
          `Erreur lors du téléversement du fichier ${file.name} (${i + 1}/${files.length}) : ${
            err instanceof Error ? err.message : String(err)
          }. Les ${succeededCount} image(s) précédente(s) ont été conservées.`
        );
        break;
      }
    }

    setIsUploadingGallery(false);
    setGalleryUploadProgress(null);
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  }

  function removeGalleryImage(imageId: string) {
    setGalleryImageIds((prev) => prev.filter((id) => id !== imageId));
  }

  function moveGalleryImage(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= galleryImageIds.length) return;
    const next = [...galleryImageIds];
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    setGalleryImageIds(next);
  }

  return (
    <div className={styles.container}>
      <Link to="/admin/portfolio" className={styles.backLink}>
        ← Retour aux projets
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Édition : {titleFr || "Sans titre"}</h1>
          <span className={styles.projectIdTag}>ID : {project.id}</span>
        </div>

        <div>
          <span className={status === "published" ? styles.statusBadgePublished : styles.statusBadgeDraft}>
            {status === "published" ? "Publié" : "Brouillon"}
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

              <div className={`${styles.formGroup} ${activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}`}>
                <label className={styles.label} htmlFor="titleFr">
                  Titre du projet (FR) *
                </label>
                <input
                  id="titleFr"
                  name="titleFr"
                  type="text"
                  required
                  value={titleFr}
                  onChange={(e) => setTitleFr(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={`${styles.formGroup} ${activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}`}>
                <label className={styles.label} htmlFor="titleEn">
                  Project Title (EN) *
                </label>
                <input
                  id="titleEn"
                  name="titleEn"
                  type="text"
                  required
                  value={titleEn}
                  onChange={(e) => setTitleEn(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.twoCol}>
                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="slugFr">
                    Slug d'URL (FR)
                  </label>
                  <input
                    id="slugFr"
                    name="slugFr"
                    type="text"
                    required
                    value={slugFr}
                    onChange={(e) => setSlugFr(slugify(e.target.value))}
                    className={styles.input}
                  />
                  <div className={styles.helperText}>
                    Accessible sous : /fr/projets/{category === "documentary" ? "documentaire" : "publicite"}/{slugFr}
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label} htmlFor="slugEn">
                    URL Slug (EN)
                  </label>
                  <input
                    id="slugEn"
                    name="slugEn"
                    type="text"
                    required
                    value={slugEn}
                    onChange={(e) => setSlugEn(slugify(e.target.value))}
                    className={styles.input}
                  />
                  <div className={styles.helperText}>
                    Accessible under: /en/projects/{category}/{slugEn}
                  </div>
                </div>
              </div>

              <div className={`${styles.formGroup} ${activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}`}>
                <label className={styles.label} htmlFor="summaryFr">
                  Résumé court (FR) *
                </label>
                <textarea
                  id="summaryFr"
                  name="summaryFr"
                  required
                  value={summaryFr}
                  onChange={(e) => setSummaryFr(e.target.value)}
                  className={styles.textarea}
                  rows={3}
                />
              </div>

              <div className={`${styles.formGroup} ${activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}`}>
                <label className={styles.label} htmlFor="summaryEn">
                  Short Summary (EN) *
                </label>
                <textarea
                  id="summaryEn"
                  name="summaryEn"
                  required
                  value={summaryEn}
                  onChange={(e) => setSummaryEn(e.target.value)}
                  className={styles.textarea}
                  rows={3}
                />
              </div>

              <div className={`${styles.formGroup} ${activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}`}>
                <label className={styles.label} htmlFor="descriptionFr">
                  Contenu détaillé (FR) — Séparez les paragraphes par un saut de ligne
                </label>
                <textarea
                  id="descriptionFr"
                  name="descriptionFr"
                  value={descriptionFr}
                  onChange={(e) => setDescriptionFr(e.target.value)}
                  className={styles.textarea}
                  rows={6}
                />
              </div>

              <div className={`${styles.formGroup} ${activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}`}>
                <label className={styles.label} htmlFor="descriptionEn">
                  Detailed Content (EN) — Separate paragraphs with blank lines
                </label>
                <textarea
                  id="descriptionEn"
                  name="descriptionEn"
                  value={descriptionEn}
                  onChange={(e) => setDescriptionEn(e.target.value)}
                  className={styles.textarea}
                  rows={6}
                />
              </div>
            </div>

            {/* Media & Photos Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Médias & Photographies</h2>

              {/* Cover image uploader */}
              <div className={styles.formGroup}>
                <label className={styles.label}>Image principale / Couverture *</label>
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
                          alt="Aperçu couverture"
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
                      <p className={styles.metaSub}>
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
                    className={styles.hiddenFileInput}
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
                    value={coverAltFr}
                    onChange={(e) => setCoverAltFr(e.target.value)}
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
                    value={coverAltEn}
                    onChange={(e) => setCoverAltEn(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              {/* Project photo gallery */}
              <div className={`${styles.formGroup} ${styles.formGroupMargin}`}>
                <label className={styles.label}>
                  Galerie photos ({galleryImageIds.length} image{galleryImageIds.length > 1 ? "s" : ""})
                </label>
                <div className={styles.uploaderBox}>
                  <p className={styles.metaSubSm}>
                    Ajoutez jusqu'à 20 photos à la galerie. Elles seront importées séquentiellement.
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
                    className={styles.hiddenFileInput}
                    onChange={handleGalleryFiles}
                  />

                  {galleryImageIds.length > 0 && (
                    <div className={styles.galleryGrid}>
                      {galleryImageIds.map((gid, gIdx) => (
                        <div key={gid} className={styles.galleryItem}>
                          <ResponsivePortfolioImage
                            imageId={gid}
                            ownerType="project"
                            ownerId={project.id}
                            mediaSlot="gallery"
                            mediaMetadata={mediaRegistry[gid]}
                            alt={`Galerie ${gIdx + 1}`}
                            isAdminPreview
                          />
                          <div className={styles.galleryActionsBar}>
                            <div className={styles.reorderBtnGroup}>
                              <button
                                type="button"
                                disabled={gIdx === 0}
                                className={styles.reorderBtn}
                                onClick={() => moveGalleryImage(gIdx, "up")}
                                aria-label="Déplacer vers la gauche"
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                disabled={gIdx === galleryImageIds.length - 1}
                                className={styles.reorderBtn}
                                onClick={() => moveGalleryImage(gIdx, "down")}
                                aria-label="Déplacer vers la droite"
                              >
                                →
                              </button>
                            </div>
                            <button
                              type="button"
                              className={styles.removeBtnText}
                              onClick={() => removeGalleryImage(gid)}
                              aria-label="Retirer cette photo"
                            >
                              Retirer
                            </button>
                          </div>
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
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
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
                    className={styles.hiddenFileInput}
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
                    value={seoTitleFr}
                    onChange={(e) => setSeoTitleFr(e.target.value)}
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
                    value={seoTitleEn}
                    onChange={(e) => setSeoTitleEn(e.target.value)}
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
                    value={seoDescFr}
                    onChange={(e) => setSeoDescFr(e.target.value)}
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
                    value={seoDescEn}
                    onChange={(e) => setSeoDescEn(e.target.value)}
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
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "draft" | "published")}
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
                  value={category}
                  onChange={(e) => setCategory(e.target.value as PortfolioCategory)}
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
                  value={showcase ? "true" : "false"}
                  onChange={(e) => setShowcase(e.target.value === "true")}
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
                  value={side}
                  onChange={(e) => setSide(e.target.value as "auto" | "left" | "right")}
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
            <Link to="/admin/portfolio" className={styles.cancelLink}>
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
