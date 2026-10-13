export const PORTFOLIO_CATEGORIES = ["documentary", "advertising"] as const;
export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number];

export const PORTFOLIO_MEDIA_SLOTS = [
  "cover",
  "showreel_cover",
  "video_cover",
  "gallery",
] as const;
export type PortfolioMediaSlot = (typeof PORTFOLIO_MEDIA_SLOTS)[number];

export const PORTFOLIO_MEDIA_OWNER_TYPES = ["section", "project"] as const;
export type PortfolioMediaOwnerType = (typeof PORTFOLIO_MEDIA_OWNER_TYPES)[number];

export const PORTFOLIO_VARIANT_NAMES = ["640p", "960p", "1440p", "1920p"] as const;
export type PortfolioVariantName = (typeof PORTFOLIO_VARIANT_NAMES)[number];

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LocalizedString {
  fr: string;
  en: string;
}

export interface DetailedBlock {
  type: "paragraph" | "heading";
  text: LocalizedString;
}

export interface PortfolioVideo {
  provider: "youtube" | "vimeo";
  videoId: string;
  url: string;
  coverImageId?: string | null;
}

export interface PortfolioMediaVariant {
  name: PortfolioVariantName;
  width: number;
  height: number;
  sizeBytesWebp: number;
  sizeBytesAvif: number;
}

export interface PortfolioMediaItem {
  imageId: string;
  ownerType: PortfolioMediaOwnerType;
  ownerId: string;
  mediaSlot: PortfolioMediaSlot;
  originalFormat: "jpeg" | "png" | "webp";
  originalWidth: number;
  originalHeight: number;
  variants: PortfolioMediaVariant[];
  createdAt: number;
}

export interface PortfolioProject {
  id: string;
  category: PortfolioCategory;
  slugFr: string;
  slugEn: string;
  title: LocalizedString;
  summary: LocalizedString;
  description: DetailedBlock[];
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  coverImageId: string | null;
  coverAlt: LocalizedString;
  galleryImageIds: string[];
  video: PortfolioVideo | null;
  showcase: boolean;
  side: "auto" | "left" | "right";
  order: number;
  status: "draft" | "published";
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PortfolioSection {
  category: PortfolioCategory;
  title: LocalizedString;
  intro: LocalizedString;
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  coverImageId: string | null;
  coverAlt: LocalizedString;
  showreelTitle: LocalizedString;
  showreelVideo: PortfolioVideo | null;
  showreelCoverImageId: string | null;
  morePhotosButton: LocalizedString;
  lessPhotosButton: LocalizedString;
  backButton: LocalizedString;
}

export interface PortfolioOverview {
  title: LocalizedString;
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  seeMoreButton: LocalizedString;
}

export interface PortfolioContent {
  schemaVersion: 1;
  revision: string;
  updatedAt: string;
  overview: PortfolioOverview;
  sections: {
    documentary: PortfolioSection;
    advertising: PortfolioSection;
  };
  projects: PortfolioProject[];
  media: Record<string, PortfolioMediaItem>;
}

// -------------------------------------------------------------
// Pure TypeScript Strict Validation Schema
// -------------------------------------------------------------

export interface ValidationErrorDetail {
  path: (string | number)[];
  message: string;
}

export interface SchemaParseSuccess<T> {
  success: true;
  data: T;
}

export interface SchemaParseError {
  success: false;
  error: {
    errors: ValidationErrorDetail[];
  };
}

export type SchemaParseResult<T> = SchemaParseSuccess<T> | SchemaParseError;

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function validateLocalizedString(
  val: unknown,
  path: (string | number)[],
  errors: ValidationErrorDetail[]
): boolean {
  if (!isObject(val)) {
    errors.push({ path, message: "Doit être un objet localisé { fr, en }" });
    return false;
  }
  let valid = true;
  if (typeof val.fr !== "string" || val.fr.length > 1000) {
    errors.push({ path: [...path, "fr"], message: "Texte FR manquant ou dépassant 1000 caractères" });
    valid = false;
  }
  if (typeof val.en !== "string" || val.en.length > 1000) {
    errors.push({ path: [...path, "en"], message: "Texte EN manquant ou dépassant 1000 caractères" });
    valid = false;
  }
  return valid;
}

function validatePortfolioVideo(
  val: unknown,
  path: (string | number)[],
  errors: ValidationErrorDetail[]
): boolean {
  if (val === null || val === undefined) return true;
  if (!isObject(val)) {
    errors.push({ path, message: "Doit être un objet vidéo ou null" });
    return false;
  }
  let valid = true;
  if (val.provider !== "youtube" && val.provider !== "vimeo") {
    errors.push({ path: [...path, "provider"], message: "Provider vidéo invalide ('youtube' ou 'vimeo')" });
    valid = false;
  }
  if (typeof val.videoId !== "string" || !val.videoId || val.videoId.length > 64) {
    errors.push({ path: [...path, "videoId"], message: "Identifiant vidéo invalide" });
    valid = false;
  }
  if (typeof val.url !== "string" || !val.url.startsWith("https://")) {
    errors.push({ path: [...path, "url"], message: "URL vidéo HTTPS requise" });
    valid = false;
  }
  if (val.coverImageId && (typeof val.coverImageId !== "string" || !UUID_REGEX.test(val.coverImageId))) {
    errors.push({ path: [...path, "coverImageId"], message: "Format UUID de couverture vidéo invalide" });
    valid = false;
  }
  return valid;
}

function validatePortfolioProject(
  val: unknown,
  index: number,
  errors: ValidationErrorDetail[],
  seenSlugsFr: Map<string, string>,
  seenSlugsEn: Map<string, string>
): boolean {
  if (!isObject(val)) {
    errors.push({ path: ["projects", index], message: "Le projet doit être un objet" });
    return false;
  }
  const pPath = ["projects", index];
  let valid = true;

  if (typeof val.id !== "string" || !UUID_REGEX.test(val.id)) {
    errors.push({ path: [...pPath, "id"], message: "Format UUID de projet invalide" });
    valid = false;
  }

  if (typeof val.category !== "string" || !PORTFOLIO_CATEGORIES.includes(val.category as PortfolioCategory)) {
    errors.push({ path: [...pPath, "category"], message: "Catégorie invalide" });
    valid = false;
  }

  if (
    typeof val.slugFr !== "string" ||
    val.slugFr.length < 2 ||
    val.slugFr.length > 100 ||
    !SLUG_REGEX.test(val.slugFr)
  ) {
    errors.push({ path: [...pPath, "slugFr"], message: "Format slug FR invalide" });
    valid = false;
  } else {
    if (seenSlugsFr.has(val.slugFr)) {
      errors.push({
        path: [...pPath, "slugFr"],
        message: `Le slug FR "${val.slugFr}" est dupliqué`,
      });
      valid = false;
    }
    seenSlugsFr.set(val.slugFr, String(val.id || index));
  }

  if (
    typeof val.slugEn !== "string" ||
    val.slugEn.length < 2 ||
    val.slugEn.length > 100 ||
    !SLUG_REGEX.test(val.slugEn)
  ) {
    errors.push({ path: [...pPath, "slugEn"], message: "Format slug EN invalide" });
    valid = false;
  } else {
    if (seenSlugsEn.has(val.slugEn)) {
      errors.push({
        path: [...pPath, "slugEn"],
        message: `Le slug EN "${val.slugEn}" est dupliqué`,
      });
      valid = false;
    }
    seenSlugsEn.set(val.slugEn, String(val.id || index));
  }

  if (!validateLocalizedString(val.title, [...pPath, "title"], errors)) valid = false;
  if (!validateLocalizedString(val.summary, [...pPath, "summary"], errors)) valid = false;

  if (isObject(val.seo)) {
    validateLocalizedString(val.seo.title, [...pPath, "seo", "title"], errors);
    validateLocalizedString(val.seo.description, [...pPath, "seo", "description"], errors);
  } else {
    errors.push({ path: [...pPath, "seo"], message: "Objet SEO requis" });
    valid = false;
  }

  if (val.coverImageId !== null && (typeof val.coverImageId !== "string" || !UUID_REGEX.test(val.coverImageId))) {
    errors.push({ path: [...pPath, "coverImageId"], message: "Format UUID de couverture invalide" });
    valid = false;
  }

  if (!validateLocalizedString(val.coverAlt, [...pPath, "coverAlt"], errors)) valid = false;

  if (!Array.isArray(val.galleryImageIds)) {
    errors.push({ path: [...pPath, "galleryImageIds"], message: "La galerie doit être un tableau" });
    valid = false;
  }

  if (!validatePortfolioVideo(val.video, [...pPath, "video"], errors)) valid = false;

  if (typeof val.showcase !== "boolean") {
    errors.push({ path: [...pPath, "showcase"], message: "showcase doit être un booléen" });
    valid = false;
  }

  if (val.side !== "auto" && val.side !== "left" && val.side !== "right") {
    errors.push({ path: [...pPath, "side"], message: "side doit être 'auto', 'left' ou 'right'" });
    valid = false;
  }

  if (typeof val.order !== "number" || val.order < 0) {
    errors.push({ path: [...pPath, "order"], message: "order doit être un entier positif" });
    valid = false;
  }

  if (val.status !== "draft" && val.status !== "published") {
    errors.push({ path: [...pPath, "status"], message: "status doit être 'draft' ou 'published'" });
    valid = false;
  }

  if (typeof val.archived !== "boolean") {
    errors.push({ path: [...pPath, "archived"], message: "archived doit être un booléen" });
    valid = false;
  }

  return valid;
}

function validatePortfolioSection(
  val: unknown,
  category: PortfolioCategory,
  errors: ValidationErrorDetail[]
): boolean {
  if (!isObject(val)) {
    errors.push({ path: ["sections", category], message: "La section doit être un objet" });
    return false;
  }
  const sPath = ["sections", category];
  let valid = true;

  if (val.category !== category) {
    errors.push({ path: [...sPath, "category"], message: `La catégorie doit être "${category}"` });
    valid = false;
  }

  if (!validateLocalizedString(val.title, [...sPath, "title"], errors)) valid = false;
  if (!validateLocalizedString(val.intro, [...sPath, "intro"], errors)) valid = false;

  if (isObject(val.seo)) {
    validateLocalizedString(val.seo.title, [...sPath, "seo", "title"], errors);
    validateLocalizedString(val.seo.description, [...sPath, "seo", "description"], errors);
  } else {
    errors.push({ path: [...sPath, "seo"], message: "SEO requis" });
    valid = false;
  }

  if (val.coverImageId !== null && (typeof val.coverImageId !== "string" || !UUID_REGEX.test(val.coverImageId))) {
    errors.push({ path: [...sPath, "coverImageId"], message: "UUID de couverture invalide" });
    valid = false;
  }

  if (!validateLocalizedString(val.coverAlt, [...sPath, "coverAlt"], errors)) valid = false;
  if (!validateLocalizedString(val.showreelTitle, [...sPath, "showreelTitle"], errors)) valid = false;
  if (!validatePortfolioVideo(val.showreelVideo, [...sPath, "showreelVideo"], errors)) valid = false;

  if (
    val.showreelCoverImageId !== null &&
    (typeof val.showreelCoverImageId !== "string" || !UUID_REGEX.test(val.showreelCoverImageId))
  ) {
    errors.push({ path: [...sPath, "showreelCoverImageId"], message: "UUID d'affiche de showreel invalide" });
    valid = false;
  }

  if (!validateLocalizedString(val.morePhotosButton, [...sPath, "morePhotosButton"], errors)) valid = false;
  if (!validateLocalizedString(val.lessPhotosButton, [...sPath, "lessPhotosButton"], errors)) valid = false;
  if (!validateLocalizedString(val.backButton, [...sPath, "backButton"], errors)) valid = false;

  return valid;
}

export const portfolioSectionSchema = {
  safeParse(val: unknown): SchemaParseResult<PortfolioSection> {
    const errors: ValidationErrorDetail[] = [];
    if (!isObject(val)) {
      return { success: false, error: { errors: [{ path: [], message: "Doit être un objet section" }] } };
    }
    const cat = (val.category as PortfolioCategory) || "documentary";
    validatePortfolioSection(val, cat, errors);
    if (errors.length > 0) {
      return { success: false, error: { errors } };
    }
    return { success: true, data: val as unknown as PortfolioSection };
  },
};

export const portfolioContentSchema = {
  safeParse(val: unknown): SchemaParseResult<PortfolioContent> {
    const errors: ValidationErrorDetail[] = [];

    if (!isObject(val)) {
      return {
        success: false,
        error: { errors: [{ path: [], message: "Le contenu portfolio doit être un objet racine" }] },
      };
    }

    if (val.schemaVersion !== 1) {
      errors.push({ path: ["schemaVersion"], message: "schemaVersion doit être 1" });
    }

    if (typeof val.revision !== "string" || val.revision.length < 8 || val.revision.length > 64) {
      errors.push({ path: ["revision"], message: "Révision invalide" });
    }

    if (typeof val.updatedAt !== "string") {
      errors.push({ path: ["updatedAt"], message: "updatedAt doit être une chaîne" });
    }

    if (isObject(val.overview)) {
      validateLocalizedString(val.overview.title, ["overview", "title"], errors);
      if (isObject(val.overview.seo)) {
        validateLocalizedString(val.overview.seo.title, ["overview", "seo", "title"], errors);
        validateLocalizedString(val.overview.seo.description, ["overview", "seo", "description"], errors);
      } else {
        errors.push({ path: ["overview", "seo"], message: "SEO de l'overview requis" });
      }
      validateLocalizedString(val.overview.seeMoreButton, ["overview", "seeMoreButton"], errors);
    } else {
      errors.push({ path: ["overview"], message: "Overview requis" });
    }

    if (isObject(val.sections)) {
      validatePortfolioSection(val.sections.documentary, "documentary", errors);
      validatePortfolioSection(val.sections.advertising, "advertising", errors);
    } else {
      errors.push({ path: ["sections"], message: "Sections requises" });
    }

    if (Array.isArray(val.projects)) {
      const seenFr = new Map<string, string>();
      const seenEn = new Map<string, string>();
      for (let i = 0; i < val.projects.length; i++) {
        validatePortfolioProject(val.projects[i], i, errors, seenFr, seenEn);
      }
    } else {
      errors.push({ path: ["projects"], message: "projects doit être un tableau" });
    }

    if (!isObject(val.media)) {
      errors.push({ path: ["media"], message: "media doit être un objet" });
    }

    if (errors.length > 0) {
      return { success: false, error: { errors } };
    }

    return { success: true, data: val as unknown as PortfolioContent };
  },
};

/**
 * Normalizes a string into a clean URL-friendly slug
 */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .slice(0, 100);
}

/**
 * Calculates effective side ("left" | "right") for showcase presentation
 */
export function calculateEffectiveSide(
  projectSide: "auto" | "left" | "right",
  showcaseIndex: number
): "left" | "right" {
  if (projectSide === "left" || projectSide === "right") {
    return projectSide;
  }
  // Even index -> left, Odd index -> right
  return showcaseIndex % 2 === 0 ? "left" : "right";
}
