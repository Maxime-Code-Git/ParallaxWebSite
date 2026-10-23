import { useState, useRef, useEffect } from "react";
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
  type PortfolioContent,
} from "../../lib/portfolio-content.shared";
import { parseVideoUrl } from "../../lib/video";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import { RevisionConflictError, ValidationError } from "../../lib/site-content.server";
import { readStrictFormUrlEncoded, ActionSecurityError } from "../../lib/security.server";
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

import { slugify } from "../../lib/portfolio-content.shared";

const ALLOWED_SECTION_FIELDS = [
  "csrfToken",
  "revision",
  "coverImageId",
  "showreelCoverImageId",
  "entryImageId",
  "bannerImageId",
  "title_fr",
  "title_en",
  "slugFr",
  "slugEn",
  "intro_fr",
  "intro_en",
  "entrySummary_fr",
  "entrySummary_en",
  "entrySide",
  "showreelTitle_fr",
  "showreelTitle_en",
  "showreelUrl",
  "morePhotosButton_fr",
  "morePhotosButton_en",
  "lessPhotosButton_fr",
  "lessPhotosButton_en",
  "moreVideosButton_fr",
  "moreVideosButton_en",
  "lessVideosButton_fr",
  "lessVideosButton_en",
  "backButton_fr",
  "backButton_en",
  "seo_title_fr",
  "seo_title_en",
  "seo_desc_fr",
  "seo_desc_en",
  "coverAlt_fr",
  "coverAlt_en",
  "entryAlt_fr",
  "entryAlt_en",
  "bannerAlt_fr",
  "bannerAlt_en",
] as const;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const responseHeaders = createAdminHeaders();

  let csrfToken = session.get("csrfToken");
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    session.set("csrfToken", csrfToken);
    responseHeaders.set("Set-Cookie", await commitSession(session));
  }

  const categoryId = params.category;
  const { content } = getRawPortfolioContent();
  const section = content.categories?.find((c) => c.id === categoryId) || content.sections?.[categoryId!];

  if (!section) {
    throw new Response("Rubrique introuvable", { status: 404, headers: responseHeaders });
  }

  const publishedProjects = content.projects.filter(
    (p) => p.category === categoryId && p.status === "published" && !p.archived
  );
  const publishedVideosCount = publishedProjects.filter((p) => Boolean(p.video?.url)).length;

  return Response.json(
    {
      section,
      category: categoryId,
      overview: content.overview,
      contentRevision: content.revision,
      media: content.media,
      csrfToken,
      publishedVideosCount,
    },
    { headers: responseHeaders }
  );
}

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

  const categoryId = params.category;
  const { content } = getRawPortfolioContent();
  const nextContent: PortfolioContent = JSON.parse(JSON.stringify(content));
  const section = nextContent.categories?.find((c) => c.id === categoryId);

  if (!section) {
    return Response.json({ error: "Rubrique introuvable." }, { status: 404, headers: createAdminHeaders() });
  }

  let formData: URLSearchParams;
  try {
    formData = await readStrictFormUrlEncoded(request, 100 * 1024, ALLOWED_SECTION_FIELDS);
  } catch (err) {
    if (err instanceof ActionSecurityError) {
      const respHeaders = createAdminHeaders();
      if (err.status === 405) respHeaders.set("Allow", "POST");
      return Response.json({ error: err.message }, { status: err.status, headers: respHeaders });
    }
    return Response.json({ error: "Bad Request" }, { status: 400, headers: createAdminHeaders() });
  }

  const csrfToken = formData.get("csrfToken");
  const sessionCsrf = session.get("csrfToken");

  if (!csrfToken || !sessionCsrf || !constantTimeEqual(String(csrfToken), sessionCsrf)) {
    return Response.json({ error: "Jeton CSRF invalide ou expiré." }, { status: 403, headers: createAdminHeaders() });
  }

  const expectedRevision = String(formData.get("revision") || "");

  // 1. Textes et intro
  section.title = {
    fr: String(formData.get("title_fr") || "").trim(),
    en: String(formData.get("title_en") || "").trim(),
  };

  // 2. Slugs et alias
  const rawSlugFr = String(formData.get("slugFr") || "").trim() || section.title.fr;
  const rawSlugEn = String(formData.get("slugEn") || "").trim() || section.title.en;
  const newSlugFr = slugify(rawSlugFr);
  const newSlugEn = slugify(rawSlugEn);

  if (!newSlugFr || !newSlugEn) {
    return Response.json(
      { error: "Les slugs publics FR et EN sont requis et doivent être valides." },
      { status: 422, headers: createAdminHeaders() }
    );
  }

  // Check collision with other categories
  for (const other of nextContent.categories) {
    if (other.id !== categoryId) {
      if (other.slugFr === newSlugFr || other.slugAliases?.fr?.includes(newSlugFr)) {
        return Response.json(
          { error: `Le slug FR "${newSlugFr}" est déjà utilisé par la rubrique "${other.title.fr}".` },
          { status: 422, headers: createAdminHeaders() }
        );
      }
      if (other.slugEn === newSlugEn || other.slugAliases?.en?.includes(newSlugEn)) {
        return Response.json(
          { error: `Le slug EN "${newSlugEn}" est déjà utilisé par la rubrique "${other.title.en}".` },
          { status: 422, headers: createAdminHeaders() }
        );
      }
    }
  }

  if (!section.slugAliases) {
    section.slugAliases = { fr: [], en: [] };
  }
  if (!Array.isArray(section.slugAliases.fr)) section.slugAliases.fr = [];
  if (!Array.isArray(section.slugAliases.en)) section.slugAliases.en = [];

  if (section.slugFr && section.slugFr !== newSlugFr) {
    if (!section.slugAliases.fr.includes(section.slugFr)) {
      section.slugAliases.fr.push(section.slugFr);
    }
  }
  if (section.slugEn && section.slugEn !== newSlugEn) {
    if (!section.slugAliases.en.includes(section.slugEn)) {
      section.slugAliases.en.push(section.slugEn);
    }
  }

  // Normaliser les alias : retirer le nouveau slug actif de ses propres alias, filtrer les vides et dédupliquer
  section.slugAliases.fr = Array.from(
    new Set(section.slugAliases.fr.filter((a: string) => typeof a === "string" && a !== newSlugFr && a.trim() !== ""))
  );
  section.slugAliases.en = Array.from(
    new Set(section.slugAliases.en.filter((a: string) => typeof a === "string" && a !== newSlugEn && a.trim() !== ""))
  );

  section.slugFr = newSlugFr;
  section.slugEn = newSlugEn;

  section.intro = {
    fr: String(formData.get("intro_fr") || "").trim(),
    en: String(formData.get("intro_en") || "").trim(),
  };

  const entrySummaryFr = String(formData.get("entrySummary_fr") || "").trim();
  const entrySummaryEn = String(formData.get("entrySummary_en") || "").trim();
  section.entrySummary = {
    fr: entrySummaryFr || section.intro.fr,
    en: entrySummaryEn || section.intro.en,
  };
  const entrySideRaw = String(formData.get("entrySide") || "").trim();
  section.entrySide = entrySideRaw === "left" || entrySideRaw === "right" ? entrySideRaw : "auto";

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

  // 3. Visuel de catégorie sur le Portfolio
  const entryImageId = String(formData.get("entryImageId") || "").trim();
  section.entryImageId = entryImageId ? entryImageId : null;
  section.entryAlt = {
    fr: String(formData.get("entryAlt_fr") || "").trim(),
    en: String(formData.get("entryAlt_en") || "").trim(),
  };

  // 4. Bannière d'en-tête de la catégorie
  const bannerImageId = String(formData.get("bannerImageId") || "").trim();
  section.bannerImageId = bannerImageId ? bannerImageId : null;
  section.bannerAlt = {
    fr: String(formData.get("bannerAlt_fr") || "").trim(),
    en: String(formData.get("bannerAlt_en") || "").trim(),
  };

  // 5. Couverture (compatibilité historique - préservée indépendamment)
  const coverImageId = String(formData.get("coverImageId") || "").trim();
  section.coverImageId = coverImageId ? coverImageId : (section.coverImageId || null);
  section.coverAlt = {
    fr: String(formData.get("coverAlt_fr") || "").trim() || section.coverAlt?.fr || section.bannerAlt.fr,
    en: String(formData.get("coverAlt_en") || "").trim() || section.coverAlt?.en || section.bannerAlt.en,
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
  const moreVideosFr = String(formData.get("moreVideosButton_fr") || "").trim();
  const moreVideosEn = String(formData.get("moreVideosButton_en") || "").trim();
  section.moreVideosButton = {
    fr: moreVideosFr || section.moreVideosButton?.fr || "Voir plus de vidéos",
    en: moreVideosEn || section.moreVideosButton?.en || "See more videos",
  };
  const lessVideosFr = String(formData.get("lessVideosButton_fr") || "").trim();
  const lessVideosEn = String(formData.get("lessVideosButton_en") || "").trim();
  section.lessVideosButton = {
    fr: lessVideosFr || section.lessVideosButton?.fr || "Voir moins de vidéos",
    en: lessVideosEn || section.lessVideosButton?.en || "See less videos",
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
    return Response.json(
      { error: "Une erreur inattendue est survenue lors de l'enregistrement." },
      { status: 500, headers: createAdminHeaders() }
    );
  }
}

interface LoaderData {
  section: PortfolioSection;
  category: PortfolioCategory;
  overview: PortfolioOverview;
  contentRevision: string;
  media: Record<string, PortfolioMediaItem>;
  csrfToken: string;
  publishedVideosCount?: number;
}

export default function AdminPortfolioSectionPage() {
  const {
    section,
    category,
    contentRevision,
    media: initialMedia,
    csrfToken,
    publishedVideosCount = 0,
  } = useLoaderData<LoaderData>();
  const actionData = useActionData<{ success?: string; error?: string; newRevision?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

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

  // Form states initialized to preserve unsaved user input across uploads
  const [titleFr, setTitleFr] = useState(section.title.fr);
  const [titleEn, setTitleEn] = useState(section.title.en);
  const [slugFr, setSlugFr] = useState(
    section.slugFr || (category === "documentary" ? "documentaire" : category === "advertising" ? "publicite" : slugify(section.title.fr))
  );
  const [slugEn, setSlugEn] = useState(
    section.slugEn || (category === "documentary" ? "documentary" : category === "advertising" ? "advertising" : slugify(section.title.en))
  );
  const [introFr, setIntroFr] = useState(section.intro.fr);
  const [introEn, setIntroEn] = useState(section.intro.en);
  const [showreelTitleFr, setShowreelTitleFr] = useState(section.showreelTitle.fr);
  const [showreelTitleEn, setShowreelTitleEn] = useState(section.showreelTitle.en);
  const [showreelUrl, setShowreelUrl] = useState(section.showreelVideo?.url || "");
  const [morePhotosButtonFr, setMorePhotosButtonFr] = useState(section.morePhotosButton.fr);
  const [morePhotosButtonEn, setMorePhotosButtonEn] = useState(section.morePhotosButton.en);
  const [lessPhotosButtonFr, setLessPhotosButtonFr] = useState(section.lessPhotosButton.fr);
  const [lessPhotosButtonEn, setLessPhotosButtonEn] = useState(section.lessPhotosButton.en);
  const [moreVideosButtonFr, setMoreVideosButtonFr] = useState(
    section.moreVideosButton?.fr || "Voir plus de vidéos"
  );
  const [moreVideosButtonEn, setMoreVideosButtonEn] = useState(
    section.moreVideosButton?.en || "See more videos"
  );
  const [lessVideosButtonFr, setLessVideosButtonFr] = useState(
    section.lessVideosButton?.fr || "Voir moins de vidéos"
  );
  const [lessVideosButtonEn, setLessVideosButtonEn] = useState(
    section.lessVideosButton?.en || "See less videos"
  );
  const [backButtonFr, setBackButtonFr] = useState(section.backButton.fr);
  const [backButtonEn, setBackButtonEn] = useState(section.backButton.en);
  const [seoTitleFr, setSeoTitleFr] = useState(section.seo.title.fr);
  const [seoTitleEn, setSeoTitleEn] = useState(section.seo.title.en);
  const [seoDescFr, setSeoDescFr] = useState(section.seo.description.fr);
  const [seoDescEn, setSeoDescEn] = useState(section.seo.description.en);

  const [mediaMap, setMediaMap] = useState<Record<string, PortfolioMediaItem>>(initialMedia);
  const coverImageId = section.coverImageId;
  const [entryImageId, setEntryImageId] = useState<string | null>(section.entryImageId || null);
  const [entryAltFr, setEntryAltFr] = useState(section.entryAlt?.fr || "");
  const [entryAltEn, setEntryAltEn] = useState(section.entryAlt?.en || "");
  const [entrySummaryFr, setEntrySummaryFr] = useState(section.entrySummary?.fr || section.intro.fr);
  const [entrySummaryEn, setEntrySummaryEn] = useState(section.entrySummary?.en || section.intro.en);
  const [entrySide, setEntrySide] = useState<"auto" | "left" | "right">(section.entrySide || "auto");

  const [bannerImageId, setBannerImageId] = useState<string | null>(
    section.bannerImageId !== undefined ? section.bannerImageId : (section.coverImageId || null)
  );
  const [bannerAltFr, setBannerAltFr] = useState(section.bannerAlt?.fr || section.coverAlt?.fr || "");
  const [bannerAltEn, setBannerAltEn] = useState(section.bannerAlt?.en || section.coverAlt?.en || "");

  const [showreelCoverImageId, setShowreelCoverImageId] = useState<string | null>(
    section.showreelCoverImageId
  );

  const [uploadingEntry, setUploadingEntry] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingShowreel, setUploadingShowreel] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const entryInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const showreelCoverInputRef = useRef<HTMLInputElement>(null);

  const categoryName = section.title?.fr || (category === "documentary" ? "Documentaire" : "Publicité");

  const handleUploadImage = async (
    file: File,
    slot: "cover" | "showreel_cover" | "category_entry" | "category_banner",
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
          "x-portfolio-revision": revisionRef.current,
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

      updateRevision(data.newRevision);
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
          <p className={styles.metaSub}>
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
        <input type="hidden" name="revision" value={currentRevision} />
        <input type="hidden" name="entryImageId" value={entryImageId || ""} />
        <input type="hidden" name="bannerImageId" value={bannerImageId || ""} />
        <input type="hidden" name="coverImageId" value={coverImageId || ""} />
        <input type="hidden" name="showreelCoverImageId" value={showreelCoverImageId || ""} />

        <div className={styles.formGrid}>
          {/* Main Column */}
          <div>
            {/* Presentation Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Textes de présentation</h2>

              <div className={activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="title_fr" className={styles.label}>
                    Titre de la rubrique (FR) *
                  </label>
                  <input
                    id="title_fr"
                    name="title_fr"
                    type="text"
                    required
                    value={titleFr}
                    onChange={(e) => setTitleFr(e.target.value)}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="slugFr" className={styles.label}>
                    Slug public d'URL (FR) *
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
                    URL publique : <code>/fr/projets/{slugify(slugFr || titleFr)}</code>
                    {section.slugAliases?.fr && section.slugAliases.fr.length > 0 && (
                      <span style={{ display: "block", marginTop: 4 }}>
                        Alias redirigés (301) : {section.slugAliases.fr.join(", ")}
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="intro_fr" className={styles.label}>
                    Introduction / Accroche (FR)
                  </label>
                  <textarea
                    id="intro_fr"
                    name="intro_fr"
                    rows={4}
                    value={introFr}
                    onChange={(e) => setIntroFr(e.target.value)}
                    className={styles.textarea}
                  />
                  <div className={styles.helperText}>
                    Texte affiché en en-tête du panneau déroulant de la rubrique.
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="entrySummary_fr" className={styles.label}>
                    Résumé sur la page d'accueil Portfolio (FR)
                  </label>
                  <input
                    id="entrySummary_fr"
                    name="entrySummary_fr"
                    type="text"
                    value={entrySummaryFr}
                    onChange={(e) => setEntrySummaryFr(e.target.value)}
                    className={styles.input}
                  />
                  <div className={styles.helperText}>
                    Phrase d'accroche accompagnant le visuel biseauté sur la page principale du portfolio.
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="entrySide" className={styles.label}>
                    Côté du visuel sur la page Portfolio (Desktop)
                  </label>
                  <select
                    id="entrySide"
                    name="entrySide"
                    value={entrySide}
                    onChange={(e) => setEntrySide(e.target.value as "auto" | "left" | "right")}
                    className={styles.input}
                  >
                    <option value="auto">Automatique (alternance selon l'ordre)</option>
                    <option value="left">Image à gauche (texte à droite)</option>
                    <option value="right">Image à droite (texte à gauche)</option>
                  </select>
                </div>
              </div>

              <div className={activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="title_en" className={styles.label}>
                    Titre de la rubrique (EN) *
                  </label>
                  <input
                    id="title_en"
                    name="title_en"
                    type="text"
                    required
                    value={titleEn}
                    onChange={(e) => setTitleEn(e.target.value)}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="slugEn" className={styles.label}>
                    Public URL Slug (EN) *
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
                    Public URL: <code>/en/projects/{slugify(slugEn || titleEn)}</code>
                    {section.slugAliases?.en && section.slugAliases.en.length > 0 && (
                      <span style={{ display: "block", marginTop: 4 }}>
                        Redirected aliases (301): {section.slugAliases.en.join(", ")}
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="intro_en" className={styles.label}>
                    Introduction / Accroche (EN)
                  </label>
                  <textarea
                    id="intro_en"
                    name="intro_en"
                    rows={4}
                    value={introEn}
                    onChange={(e) => setIntroEn(e.target.value)}
                    className={styles.textarea}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="entrySummary_en" className={styles.label}>
                    Portfolio Overview Summary (EN)
                  </label>
                  <input
                    id="entrySummary_en"
                    name="entrySummary_en"
                    type="text"
                    value={entrySummaryEn}
                    onChange={(e) => setEntrySummaryEn(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>
            </div>

            {/* Showreel Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Showreel Vidéo de la Rubrique</h2>

              <div className={activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="showreelTitle_fr" className={styles.label}>
                    Titre du showreel (FR)
                  </label>
                  <input
                    id="showreelTitle_fr"
                    name="showreelTitle_fr"
                    type="text"
                    value={showreelTitleFr}
                    onChange={(e) => setShowreelTitleFr(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="showreelTitle_en" className={styles.label}>
                    Titre du showreel (EN)
                  </label>
                  <input
                    id="showreelTitle_en"
                    name="showreelTitle_en"
                    type="text"
                    value={showreelTitleEn}
                    onChange={(e) => setShowreelTitleEn(e.target.value)}
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
                  value={showreelUrl}
                  onChange={(e) => setShowreelUrl(e.target.value)}
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
                      <p className={styles.emptyNotice}>
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
                    className={styles.hiddenFileInput}
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

              <div style={{ marginBottom: "20px", padding: "14px 16px", background: "rgba(30, 158, 255, 0.08)", borderRadius: "8px", border: "0.5px solid rgba(30, 158, 255, 0.25)", fontSize: "14px", lineHeight: "1.5", color: "#C7CED9" }}>
                <strong style={{ color: "#1E9EFF" }}>Volet vidéo complémentaire :</strong> {publishedVideosCount} vidéo(s) configurée(s) sur les projets publiés de cette rubrique. Le volet en bas de page s'alimente automatiquement à partir des vidéos principales et secondaires des projets publiés.
              </div>

              <div className={activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="morePhotosButton_fr" className={styles.label}>
                    Bouton « Voir plus de photos » (FR)
                  </label>
                  <input
                    id="morePhotosButton_fr"
                    name="morePhotosButton_fr"
                    type="text"
                    value={morePhotosButtonFr}
                    onChange={(e) => setMorePhotosButtonFr(e.target.value)}
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
                    value={lessPhotosButtonFr}
                    onChange={(e) => setLessPhotosButtonFr(e.target.value)}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="moreVideosButton_fr" className={styles.label}>
                    Bouton « Voir plus de vidéos » (FR)
                  </label>
                  <input
                    id="moreVideosButton_fr"
                    name="moreVideosButton_fr"
                    type="text"
                    value={moreVideosButtonFr}
                    onChange={(e) => setMoreVideosButtonFr(e.target.value)}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="lessVideosButton_fr" className={styles.label}>
                    Bouton « Voir moins de vidéos » (FR)
                  </label>
                  <input
                    id="lessVideosButton_fr"
                    name="lessVideosButton_fr"
                    type="text"
                    value={lessVideosButtonFr}
                    onChange={(e) => setLessVideosButtonFr(e.target.value)}
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
                    value={backButtonFr}
                    onChange={(e) => setBackButtonFr(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="morePhotosButton_en" className={styles.label}>
                    Bouton « Voir plus de photos » (EN)
                  </label>
                  <input
                    id="morePhotosButton_en"
                    name="morePhotosButton_en"
                    type="text"
                    value={morePhotosButtonEn}
                    onChange={(e) => setMorePhotosButtonEn(e.target.value)}
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
                    value={lessPhotosButtonEn}
                    onChange={(e) => setLessPhotosButtonEn(e.target.value)}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="moreVideosButton_en" className={styles.label}>
                    Bouton « Voir plus de vidéos » (EN)
                  </label>
                  <input
                    id="moreVideosButton_en"
                    name="moreVideosButton_en"
                    type="text"
                    value={moreVideosButtonEn}
                    onChange={(e) => setMoreVideosButtonEn(e.target.value)}
                    className={styles.input}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="lessVideosButton_en" className={styles.label}>
                    Bouton « Voir moins de vidéos » (EN)
                  </label>
                  <input
                    id="lessVideosButton_en"
                    name="lessVideosButton_en"
                    type="text"
                    value={lessVideosButtonEn}
                    onChange={(e) => setLessVideosButtonEn(e.target.value)}
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
                    value={backButtonEn}
                    onChange={(e) => setBackButtonEn(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>
            </div>

            {/* SEO Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Référencement naturel (SEO)</h2>

              <div className={activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="seo_title_fr" className={styles.label}>
                    Balise Title (FR)
                  </label>
                  <input
                    id="seo_title_fr"
                    name="seo_title_fr"
                    type="text"
                    value={seoTitleFr}
                    onChange={(e) => setSeoTitleFr(e.target.value)}
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
                    value={seoDescFr}
                    onChange={(e) => setSeoDescFr(e.target.value)}
                    className={styles.textarea}
                  />
                </div>
              </div>

              <div className={activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="seo_title_en" className={styles.label}>
                    Balise Title (EN)
                  </label>
                  <input
                    id="seo_title_en"
                    name="seo_title_en"
                    type="text"
                    value={seoTitleEn}
                    onChange={(e) => setSeoTitleEn(e.target.value)}
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
                    value={seoDescEn}
                    onChange={(e) => setSeoDescEn(e.target.value)}
                    className={styles.textarea}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Column */}
          <div>
            {/* Category Entry Visual Card (Portfolio Overview) */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Visuel de catégorie (Page Portfolio)</h2>
              <p className={styles.helperText} style={{ marginBottom: 16 }}>
                Visuel affiché sur la page d'accueil du Portfolio avec découpe biseautée sur grand écran.
              </p>

              <div className={styles.uploaderBox}>
                {entryImageId && mediaMap[entryImageId] ? (
                  <div>
                    <div className={styles.previewImageWrap}>
                      <ResponsivePortfolioImage
                        imageId={entryImageId}
                        ownerType="section"
                        ownerId={category}
                        mediaSlot="category_entry"
                        mediaMetadata={mediaMap[entryImageId]}
                        alt={entryAltFr || "Visuel de catégorie"}
                        isAdminPreview
                      />
                    </div>
                    <div className={styles.uploadActions}>
                      <button
                        type="button"
                        className={styles.uploadBtn}
                        disabled={uploadingEntry}
                        onClick={() => entryInputRef.current?.click()}
                      >
                        {uploadingEntry ? "Import en cours..." : "Remplacer l'image"}
                      </button>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={() => setEntryImageId(null)}
                      >
                        Retirer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className={styles.emptyNotice}>
                      Aucun visuel d'entrée configuré.
                    </p>
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      disabled={uploadingEntry}
                      onClick={() => entryInputRef.current?.click()}
                    >
                      {uploadingEntry ? "Import en cours..." : "Importer le visuel d'entrée"}
                    </button>
                  </div>
                )}

                <input
                  ref={entryInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={styles.hiddenFileInput}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void handleUploadImage(file, "category_entry", setUploadingEntry, (id) => setEntryImageId(id));
                    }
                    e.target.value = "";
                  }}
                />
              </div>

              {/* Entry Alt texts */}
              <div className={activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="entryAlt_fr" className={styles.label}>
                    Texte alternatif du visuel (FR)
                  </label>
                  <input
                    id="entryAlt_fr"
                    name="entryAlt_fr"
                    type="text"
                    value={entryAltFr}
                    onChange={(e) => setEntryAltFr(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="entryAlt_en" className={styles.label}>
                    Texte alternatif du visuel (EN)
                  </label>
                  <input
                    id="entryAlt_en"
                    name="entryAlt_en"
                    type="text"
                    value={entryAltEn}
                    onChange={(e) => setEntryAltEn(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>
            </div>

            {/* Category Banner Header Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Bannière d'en-tête de la catégorie</h2>
              <p className={styles.helperText} style={{ marginBottom: 16 }}>
                Image d'en-tête (480px) affichée au sommet du panneau coulissant lorsque la catégorie est ouverte.
              </p>

              <div className={styles.uploaderBox}>
                {bannerImageId && mediaMap[bannerImageId] ? (
                  <div>
                    <div className={styles.previewImageWrap}>
                      <ResponsivePortfolioImage
                        imageId={bannerImageId}
                        ownerType="section"
                        ownerId={category}
                        mediaSlot="category_banner"
                        mediaMetadata={mediaMap[bannerImageId]}
                        alt={bannerAltFr || "Bannière d'en-tête"}
                        isAdminPreview
                      />
                    </div>
                    <div className={styles.uploadActions}>
                      <button
                        type="button"
                        className={styles.uploadBtn}
                        disabled={uploadingBanner}
                        onClick={() => bannerInputRef.current?.click()}
                      >
                        {uploadingBanner ? "Import en cours..." : "Remplacer la bannière"}
                      </button>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={() => setBannerImageId(null)}
                      >
                        Retirer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className={styles.emptyNotice}>
                      Aucune bannière d'en-tête configurée.
                    </p>
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      disabled={uploadingBanner}
                      onClick={() => bannerInputRef.current?.click()}
                    >
                      {uploadingBanner ? "Import en cours..." : "Importer une bannière"}
                    </button>
                  </div>
                )}

                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={styles.hiddenFileInput}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void handleUploadImage(file, "category_banner", setUploadingBanner, (id) => setBannerImageId(id));
                    }
                    e.target.value = "";
                  }}
                />
              </div>

              {/* Banner Alt texts */}
              <div className={activeLang === "fr" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="bannerAlt_fr" className={styles.label}>
                    Texte alternatif de la bannière (FR)
                  </label>
                  <input
                    id="bannerAlt_fr"
                    name="bannerAlt_fr"
                    type="text"
                    value={bannerAltFr}
                    onChange={(e) => setBannerAltFr(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={activeLang === "en" ? styles.tabContentVisible : styles.tabContentHidden}>
                <div className={styles.formGroup}>
                  <label htmlFor="bannerAlt_en" className={styles.label}>
                    Texte alternatif de la bannière (EN)
                  </label>
                  <input
                    id="bannerAlt_en"
                    name="bannerAlt_en"
                    type="text"
                    value={bannerAltEn}
                    onChange={(e) => setBannerAltEn(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>
            </div>

            {/* Sticky Save Bar */}
            <div className={styles.saveBar}>
              <div className={styles.saveRevisionHint}>
                {isSubmitting ? "Enregistrement en cours..." : "Modifications non enregistrées"}
              </div>
              <button
                type="submit"
                disabled={isSubmitting || uploadingEntry || uploadingBanner || uploadingShowreel}
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
