import { parseVideoUrl } from "./video";

export const PORTFOLIO_CATEGORIES = ["documentary", "advertising"] as const;
export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number];

export const PORTFOLIO_MEDIA_SLOTS = [
  "cover",
  "showreel_cover",
  "video_cover",
  "gallery",
  "category_entry",
  "category_banner",
] as const;
export type PortfolioMediaSlot = (typeof PORTFOLIO_MEDIA_SLOTS)[number];

export const PORTFOLIO_MEDIA_OWNER_TYPES = ["section", "project"] as const;
export type PortfolioMediaOwnerType = (typeof PORTFOLIO_MEDIA_OWNER_TYPES)[number];

export const PORTFOLIO_VARIANT_NAMES = ["640p", "960p", "1440p", "1920p"] as const;
export type PortfolioVariantName = (typeof PORTFOLIO_VARIANT_NAMES)[number];

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  avifSize?: number;
  webpSize?: number;
  sizeBytesAvif?: number;
  sizeBytesWebp?: number;
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
  galleryAlt?: Record<string, LocalizedString>;
  video: PortfolioVideo | null;
  draftVideoCoverImageId?: string | null;
  presentationMode?: "photo" | "video";
  aspectRatio?: "3:2" | "4:5" | "16:9" | "1:1";
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
  entryImageId?: string | null;
  entryAlt?: LocalizedString;
  entrySummary?: LocalizedString;
  entrySide?: "left" | "right";
  bannerImageId?: string | null;
  bannerAlt?: LocalizedString;
  showreelTitle: LocalizedString;
  showreelVideo: PortfolioVideo | null;
  showreelCoverImageId: string | null;
  morePhotosButton: LocalizedString;
  lessPhotosButton: LocalizedString;
  backButton: LocalizedString;
}

export interface PortfolioOverview {
  title: LocalizedString;
  intro: LocalizedString;
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
  if (typeof val.fr !== "string" || val.fr.length > 2000) {
    errors.push({ path: [...path, "fr"], message: "Texte FR manquant ou dépassant 2000 caractères" });
    valid = false;
  }
  if (typeof val.en !== "string" || val.en.length > 2000) {
    errors.push({ path: [...path, "en"], message: "Texte EN manquant ou dépassant 2000 caractères" });
    valid = false;
  }
  return valid;
}

function validatePortfolioVideo(
  val: unknown,
  path: (string | number)[],
  errors: ValidationErrorDetail[],
  mediaRegistry?: Record<string, PortfolioMediaItem>,
  ownerType?: PortfolioMediaOwnerType,
  ownerId?: string
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
  } else {
    const parsed = parseVideoUrl(val.url);
    if (!parsed || parsed.provider !== val.provider || parsed.videoId !== val.videoId) {
      errors.push({ path: [...path, "url"], message: "L'URL vidéo ne correspond pas au provider et à l'ID configurés" });
      valid = false;
    }
  }

  if (val.coverImageId !== null && val.coverImageId !== undefined) {
    if (typeof val.coverImageId !== "string" || !UUID_REGEX.test(val.coverImageId)) {
      errors.push({ path: [...path, "coverImageId"], message: "Format UUID de couverture vidéo invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.coverImageId];
      if (!item) {
        errors.push({ path: [...path, "coverImageId"], message: `Média ${val.coverImageId} introuvable dans le registre` });
        valid = false;
      } else if (ownerType && ownerId && (item.ownerType !== ownerType || item.ownerId !== ownerId)) {
        errors.push({ path: [...path, "coverImageId"], message: `Le média ${val.coverImageId} n'appartient pas à ce propriétaire` });
        valid = false;
      }
    }
  }
  return valid;
}

function validateDetailedBlocks(
  val: unknown,
  path: (string | number)[],
  errors: ValidationErrorDetail[]
): boolean {
  if (!Array.isArray(val)) {
    errors.push({ path, message: "La description doit être un tableau de blocs" });
    return false;
  }
  if (val.length > 50) {
    errors.push({ path, message: "La description ne peut contenir plus de 50 blocs" });
    return false;
  }
  let valid = true;
  for (let i = 0; i < val.length; i++) {
    const block = val[i];
    if (!isObject(block)) {
      errors.push({ path: [...path, i], message: "Chaque bloc doit être un objet" });
      valid = false;
      continue;
    }
    if (block.type !== "paragraph" && block.type !== "heading") {
      errors.push({ path: [...path, i, "type"], message: "Type de bloc invalide ('paragraph' ou 'heading')" });
      valid = false;
    }
    if (!validateLocalizedString(block.text, [...path, i, "text"], errors)) {
      valid = false;
    }
  }
  return valid;
}

function validateMediaItem(
  id: string,
  val: unknown,
  errors: ValidationErrorDetail[]
): boolean {
  const mPath = ["media", id];
  if (!isObject(val)) {
    errors.push({ path: mPath, message: "L'entrée média doit être un objet" });
    return false;
  }
  let valid = true;

  if (val.imageId !== id || typeof val.imageId !== "string" || !UUID_REGEX.test(val.imageId)) {
    errors.push({ path: [...mPath, "imageId"], message: "L'imageId doit être un UUID correspondant à la clé" });
    valid = false;
  }

  if (
    typeof val.ownerType !== "string" ||
    !PORTFOLIO_MEDIA_OWNER_TYPES.includes(val.ownerType as PortfolioMediaOwnerType)
  ) {
    errors.push({ path: [...mPath, "ownerType"], message: "ownerType doit être 'section' ou 'project'" });
    valid = false;
  }

  if (typeof val.ownerId !== "string" || val.ownerId.length === 0) {
    errors.push({ path: [...mPath, "ownerId"], message: "ownerId requis" });
    valid = false;
  } else if (val.ownerType === "section") {
    if (val.ownerId !== "documentary" && val.ownerId !== "advertising") {
      errors.push({ path: [...mPath, "ownerId"], message: "ownerId de section invalide" });
      valid = false;
    }
  } else if (val.ownerType === "project") {
    if (!UUID_REGEX.test(val.ownerId)) {
      errors.push({ path: [...mPath, "ownerId"], message: "ownerId de projet doit être un UUID" });
      valid = false;
    }
  }

  if (
    typeof val.mediaSlot !== "string" ||
    !PORTFOLIO_MEDIA_SLOTS.includes(val.mediaSlot as PortfolioMediaSlot)
  ) {
    errors.push({ path: [...mPath, "mediaSlot"], message: "mediaSlot invalide" });
    valid = false;
  }

  if (val.originalFormat !== "jpeg" && val.originalFormat !== "png" && val.originalFormat !== "webp") {
    errors.push({ path: [...mPath, "originalFormat"], message: "Format original non pris en charge" });
    valid = false;
  }

  if (
    typeof val.originalWidth !== "number" ||
    val.originalWidth < 1 ||
    val.originalWidth > 12000
  ) {
    errors.push({ path: [...mPath, "originalWidth"], message: "Largeur originale hors limites (1-12000)" });
    valid = false;
  }

  if (
    typeof val.originalHeight !== "number" ||
    val.originalHeight < 1 ||
    val.originalHeight > 12000
  ) {
    errors.push({ path: [...mPath, "originalHeight"], message: "Hauteur originale hors limites (1-12000)" });
    valid = false;
  }

  if (!Array.isArray(val.variants) || val.variants.length === 0 || val.variants.length > 4) {
    errors.push({ path: [...mPath, "variants"], message: "Le tableau de variantes doit contenir entre 1 et 4 éléments" });
    valid = false;
  } else {
    for (let vIdx = 0; vIdx < val.variants.length; vIdx++) {
      const v = val.variants[vIdx];
      const vPath = [...mPath, "variants", vIdx];
      if (!isObject(v)) {
        errors.push({ path: vPath, message: "La variante doit être un objet" });
        valid = false;
        continue;
      }
      if (!PORTFOLIO_VARIANT_NAMES.includes(v.name as PortfolioVariantName)) {
        errors.push({ path: [...vPath, "name"], message: "Nom de variante invalide" });
        valid = false;
      }
      if (typeof v.width !== "number" || v.width < 1 || v.width > 12000) {
        errors.push({ path: [...vPath, "width"], message: "Largeur de variante invalide" });
        valid = false;
      }
      if (typeof v.height !== "number" || v.height < 1 || v.height > 12000) {
        errors.push({ path: [...vPath, "height"], message: "Hauteur de variante invalide" });
        valid = false;
      }
      const avifSize = typeof v.avifSize === "number" ? v.avifSize : v.sizeBytesAvif;
      if (typeof avifSize !== "number" || avifSize < 1 || avifSize > 25 * 1024 * 1024) {
        errors.push({ path: [...vPath, "avifSize"], message: "Taille AVIF invalide" });
        valid = false;
      }
      const webpSize = typeof v.webpSize === "number" ? v.webpSize : v.sizeBytesWebp;
      if (typeof webpSize !== "number" || webpSize < 1 || webpSize > 25 * 1024 * 1024) {
        errors.push({ path: [...vPath, "webpSize"], message: "Taille WebP invalide" });
        valid = false;
      }
    }
  }

  if (typeof val.createdAt !== "number" || val.createdAt < 0) {
    errors.push({ path: [...mPath, "createdAt"], message: "Date de création invalide" });
    valid = false;
  }

  return valid;
}

function validatePortfolioProject(
  val: unknown,
  index: number,
  errors: ValidationErrorDetail[],
  seenSlugsFr: Map<string, string>,
  seenSlugsEn: Map<string, string>,
  mediaRegistry?: Record<string, PortfolioMediaItem>
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

  const projectId = String(val.id || "");

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
    seenSlugsFr.set(val.slugFr, projectId || String(index));
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
    seenSlugsEn.set(val.slugEn, projectId || String(index));
  }

  if (!validateLocalizedString(val.title, [...pPath, "title"], errors)) valid = false;
  if (!validateLocalizedString(val.summary, [...pPath, "summary"], errors)) valid = false;

  if (!validateDetailedBlocks(val.description, [...pPath, "description"], errors)) {
    valid = false;
  }

  if (isObject(val.seo)) {
    validateLocalizedString(val.seo.title, [...pPath, "seo", "title"], errors);
    validateLocalizedString(val.seo.description, [...pPath, "seo", "description"], errors);
  } else {
    errors.push({ path: [...pPath, "seo"], message: "Objet SEO requis" });
    valid = false;
  }

  // Cover image validation
  if (val.coverImageId !== null && val.coverImageId !== undefined) {
    if (typeof val.coverImageId !== "string" || !UUID_REGEX.test(val.coverImageId)) {
      errors.push({ path: [...pPath, "coverImageId"], message: "Format UUID de couverture invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.coverImageId];
      if (!item) {
        errors.push({ path: [...pPath, "coverImageId"], message: `Média de couverture ${val.coverImageId} introuvable dans le registre` });
        valid = false;
      } else if (item.ownerType !== "project" || item.ownerId !== projectId) {
        errors.push({ path: [...pPath, "coverImageId"], message: `Le média de couverture ${val.coverImageId} n'appartient pas à ce projet` });
        valid = false;
      }
    }
  }

  if (!validateLocalizedString(val.coverAlt, [...pPath, "coverAlt"], errors)) valid = false;

  // Gallery image IDs validation
  if (!Array.isArray(val.galleryImageIds)) {
    errors.push({ path: [...pPath, "galleryImageIds"], message: "La galerie doit être un tableau" });
    valid = false;
  } else {
    const seenGids = new Set<string>();
    for (let gIdx = 0; gIdx < val.galleryImageIds.length; gIdx++) {
      const gid = val.galleryImageIds[gIdx];
      const gPath = [...pPath, "galleryImageIds", gIdx];
      if (typeof gid !== "string" || !UUID_REGEX.test(gid)) {
        errors.push({ path: gPath, message: `Identifiant d'image de galerie invalide (${String(gid)})` });
        valid = false;
      } else if (seenGids.has(gid)) {
        errors.push({ path: gPath, message: `Image de galerie dupliquée (${gid})` });
        valid = false;
      } else {
        seenGids.add(gid);
        if (mediaRegistry) {
          const item = mediaRegistry[gid];
          if (!item) {
            errors.push({ path: gPath, message: `Image de galerie ${gid} introuvable dans le registre` });
            valid = false;
          } else if (item.ownerType !== "project" || item.ownerId !== projectId) {
            errors.push({ path: gPath, message: `L'image de galerie ${gid} n'appartient pas à ce projet` });
            valid = false;
          }
        }
      }
    }
  }

  // Draft video cover image ID validation
  if (val.draftVideoCoverImageId !== null && val.draftVideoCoverImageId !== undefined) {
    if (typeof val.draftVideoCoverImageId !== "string" || !UUID_REGEX.test(val.draftVideoCoverImageId)) {
      errors.push({ path: [...pPath, "draftVideoCoverImageId"], message: "Format UUID de couverture vidéo brouillon invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.draftVideoCoverImageId];
      if (!item) {
        errors.push({ path: [...pPath, "draftVideoCoverImageId"], message: `Média ${val.draftVideoCoverImageId} introuvable dans le registre` });
        valid = false;
      } else if (item.ownerType !== "project" || item.ownerId !== projectId) {
        errors.push({ path: [...pPath, "draftVideoCoverImageId"], message: `Le média ${val.draftVideoCoverImageId} n'appartient pas à ce projet` });
        valid = false;
      }
    }
  }

  if (!validatePortfolioVideo(val.video, [...pPath, "video"], errors, mediaRegistry, "project", projectId)) {
    valid = false;
  }

  if (val.presentationMode !== undefined) {
    if (val.presentationMode !== "photo" && val.presentationMode !== "video") {
      errors.push({ path: [...pPath, "presentationMode"], message: "presentationMode doit être 'photo' ou 'video'" });
      valid = false;
    }
  }

  if (val.aspectRatio !== undefined) {
    if (!["3:2", "4:5", "16:9", "1:1"].includes(val.aspectRatio as string)) {
      errors.push({ path: [...pPath, "aspectRatio"], message: "aspectRatio doit être '3:2', '4:5', '16:9' ou '1:1'" });
      valid = false;
    }
  }

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

  // Strict completeness constraints for published status
  if (val.status === "published") {
    const title = val.title as LocalizedString | undefined;
    if (!title || !title.fr.trim() || title.fr.trim() === "[Nom du projet]") {
      errors.push({ path: [...pPath, "title", "fr"], message: "Un projet publié doit avoir un titre français renseigné" });
      valid = false;
    }
    if (!title || !title.en.trim() || title.en.trim() === "[Project name]") {
      errors.push({ path: [...pPath, "title", "en"], message: "Un projet publié doit avoir un titre anglais renseigné" });
      valid = false;
    }

    const summary = val.summary as LocalizedString | undefined;
    if (!summary || !summary.fr.trim()) {
      errors.push({ path: [...pPath, "summary", "fr"], message: "Un projet publié doit avoir un résumé français renseigné" });
      valid = false;
    }
    if (!summary || !summary.en.trim()) {
      errors.push({ path: [...pPath, "summary", "en"], message: "Un projet publié doit avoir un résumé anglais renseigné" });
      valid = false;
    }

    const mode = resolveProjectPresentationMode(val as { presentationMode?: "photo" | "video"; video?: { url?: string } | null });
    if (mode === "video") {
      const vid = val.video as PortfolioVideo | null | undefined;
      if (!vid || !vid.url || typeof vid.url !== "string" || !vid.url.trim()) {
        errors.push({
          path: [...pPath, "video"],
          message: "Un projet publié en mode Vidéo doit comporter une URL vidéo valide (YouTube ou Vimeo)",
        });
        valid = false;
      } else {
        const parsed = parseVideoUrl(vid.url);
        if (!parsed || parsed.provider !== vid.provider || parsed.videoId !== vid.videoId) {
          errors.push({
            path: [...pPath, "video", "url"],
            message: "L'URL vidéo doit être un lien YouTube ou Vimeo valide",
          });
          valid = false;
        }
      }
      const posterId = vid?.coverImageId || val.coverImageId;
      if (!posterId) {
        errors.push({
          path: [...pPath, "video", "coverImageId"],
          message: "Un projet publié en mode Vidéo doit posséder une affiche vidéo ou une image de couverture",
        });
        valid = false;
      }
    } else {
      if (!val.coverImageId) {
        errors.push({
          path: [...pPath, "coverImageId"],
          message: "Un projet publié en mode Photo doit posséder une image de couverture",
        });
        valid = false;
      }
    }

    const seo = val.seo as { title?: LocalizedString; description?: LocalizedString } | undefined;
    if (!seo?.title?.fr?.trim()) {
      errors.push({ path: [...pPath, "seo", "title", "fr"], message: "Titre SEO FR requis pour publication" });
      valid = false;
    }
    if (!seo?.title?.en?.trim()) {
      errors.push({ path: [...pPath, "seo", "title", "en"], message: "Titre SEO EN requis pour publication" });
      valid = false;
    }
    if (!seo?.description?.fr?.trim()) {
      errors.push({ path: [...pPath, "seo", "description", "fr"], message: "Description SEO FR requise pour publication" });
      valid = false;
    }
    if (!seo?.description?.en?.trim()) {
      errors.push({ path: [...pPath, "seo", "description", "en"], message: "Description SEO EN requise pour publication" });
      valid = false;
    }

    const desc = val.description as DetailedBlock[] | undefined;
    if (!Array.isArray(desc) || desc.length === 0 || !desc.some((b) => b.text?.fr?.trim() && b.text?.en?.trim())) {
      errors.push({ path: [...pPath, "description"], message: "Un projet publié doit posséder au moins un paragraphe de contenu" });
      valid = false;
    }
  }

  return valid;
}

function validatePortfolioSection(
  val: unknown,
  category: PortfolioCategory,
  errors: ValidationErrorDetail[],
  mediaRegistry?: Record<string, PortfolioMediaItem>
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

  if (val.coverImageId !== null && val.coverImageId !== undefined) {
    if (typeof val.coverImageId !== "string" || !UUID_REGEX.test(val.coverImageId)) {
      errors.push({ path: [...sPath, "coverImageId"], message: "UUID de couverture invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.coverImageId];
      if (!item) {
        errors.push({ path: [...sPath, "coverImageId"], message: `Média de couverture ${val.coverImageId} introuvable dans le registre` });
        valid = false;
      } else if (item.ownerType !== "section" || item.ownerId !== category) {
        errors.push({ path: [...sPath, "coverImageId"], message: `Le média ${val.coverImageId} n'appartient pas à cette rubrique` });
        valid = false;
      }
    }
  }

  if (!validateLocalizedString(val.coverAlt, [...sPath, "coverAlt"], errors)) valid = false;

  if (val.entryImageId !== null && val.entryImageId !== undefined) {
    if (typeof val.entryImageId !== "string" || !UUID_REGEX.test(val.entryImageId)) {
      errors.push({ path: [...sPath, "entryImageId"], message: "UUID d'image d'entrée invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.entryImageId];
      if (!item) {
        errors.push({ path: [...sPath, "entryImageId"], message: `Média d'entrée ${val.entryImageId} introuvable dans le registre` });
        valid = false;
      } else if (item.ownerType !== "section" || item.ownerId !== category) {
        errors.push({ path: [...sPath, "entryImageId"], message: `Le média ${val.entryImageId} n'appartient pas à cette rubrique` });
        valid = false;
      }
    }
  }

  if (val.entryAlt !== undefined && !validateLocalizedString(val.entryAlt, [...sPath, "entryAlt"], errors)) {
    valid = false;
  }

  if (val.entrySummary !== undefined && !validateLocalizedString(val.entrySummary, [...sPath, "entrySummary"], errors)) {
    valid = false;
  }

  if (val.entrySide !== undefined && val.entrySide !== "left" && val.entrySide !== "right") {
    errors.push({ path: [...sPath, "entrySide"], message: "entrySide doit être 'left' ou 'right'" });
    valid = false;
  }

  if (val.bannerImageId !== null && val.bannerImageId !== undefined) {
    if (typeof val.bannerImageId !== "string" || !UUID_REGEX.test(val.bannerImageId)) {
      errors.push({ path: [...sPath, "bannerImageId"], message: "UUID de bannière invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.bannerImageId];
      if (!item) {
        errors.push({ path: [...sPath, "bannerImageId"], message: `Média de bannière ${val.bannerImageId} introuvable dans le registre` });
        valid = false;
      } else if (item.ownerType !== "section" || item.ownerId !== category) {
        errors.push({ path: [...sPath, "bannerImageId"], message: `Le média ${val.bannerImageId} n'appartient pas à cette rubrique` });
        valid = false;
      }
    }
  }

  if (val.bannerAlt !== undefined && !validateLocalizedString(val.bannerAlt, [...sPath, "bannerAlt"], errors)) {
    valid = false;
  }

  if (!validateLocalizedString(val.showreelTitle, [...sPath, "showreelTitle"], errors)) valid = false;
  if (!validatePortfolioVideo(val.showreelVideo, [...sPath, "showreelVideo"], errors, mediaRegistry, "section", category)) {
    valid = false;
  }

  if (val.showreelCoverImageId !== null && val.showreelCoverImageId !== undefined) {
    if (typeof val.showreelCoverImageId !== "string" || !UUID_REGEX.test(val.showreelCoverImageId)) {
      errors.push({ path: [...sPath, "showreelCoverImageId"], message: "UUID d'affiche de showreel invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.showreelCoverImageId];
      if (!item) {
        errors.push({ path: [...sPath, "showreelCoverImageId"], message: `Média d'affiche de showreel ${val.showreelCoverImageId} introuvable` });
        valid = false;
      } else if (item.ownerType !== "section" || item.ownerId !== category) {
        errors.push({ path: [...sPath, "showreelCoverImageId"], message: `Le média ${val.showreelCoverImageId} n'appartient pas à cette rubrique` });
        valid = false;
      }
    }
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

const ALLOWED_ROOT_KEYS = new Set([
  "schemaVersion",
  "revision",
  "updatedAt",
  "overview",
  "sections",
  "projects",
  "media",
]);

export const portfolioContentSchema = {
  safeParse(val: unknown): SchemaParseResult<PortfolioContent> {
    const errors: ValidationErrorDetail[] = [];

    if (!isObject(val)) {
      return {
        success: false,
        error: { errors: [{ path: [], message: "Le contenu portfolio doit être un objet racine" }] },
      };
    }

    for (const key of Object.keys(val)) {
      if (!ALLOWED_ROOT_KEYS.has(key)) {
        errors.push({ path: [key], message: `Clé inattendue "${key}" à la racine du contenu` });
      }
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
      validateLocalizedString(val.overview.intro, ["overview", "intro"], errors);
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

    // First validate media registry
    let mediaRegistry: Record<string, PortfolioMediaItem> | undefined;
    if (isObject(val.media)) {
      mediaRegistry = val.media as Record<string, PortfolioMediaItem>;
      for (const [id, item] of Object.entries(val.media)) {
        validateMediaItem(id, item, errors);
      }
    } else {
      errors.push({ path: ["media"], message: "media doit être un objet" });
    }

    if (isObject(val.sections)) {
      validatePortfolioSection(val.sections.documentary, "documentary", errors, mediaRegistry);
      validatePortfolioSection(val.sections.advertising, "advertising", errors, mediaRegistry);
    } else {
      errors.push({ path: ["sections"], message: "Sections requises" });
    }

    if (Array.isArray(val.projects)) {
      const seenFr = new Map<string, string>();
      const seenEn = new Map<string, string>();
      for (let i = 0; i < val.projects.length; i++) {
        validatePortfolioProject(val.projects[i], i, errors, seenFr, seenEn, mediaRegistry);
      }
    } else {
      errors.push({ path: ["projects"], message: "projects doit être un tableau" });
    }

    if (errors.length > 0) {
      return { success: false, error: { errors } };
    }

    return { success: true, data: val as unknown as PortfolioContent };
  },
};

/**
 * Resolves the presentation mode ("photo" | "video") for a project,
 * ensuring backwards compatibility with legacy projects lacking presentationMode.
 */
export function resolveProjectPresentationMode(
  project: { presentationMode?: "photo" | "video"; video?: { url?: string } | null }
): "photo" | "video" {
  if (project.presentationMode === "video") return "video";
  if (project.presentationMode === "photo") return "photo";
  if (project.video?.url && typeof project.video.url === "string" && project.video.url.trim().length > 0) {
    return "video";
  }
  return "photo";
}

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
