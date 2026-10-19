export const APP_NAME = "Parallax";

export interface LocalizedString {
  fr: string;
  en: string;
}

/**
 * Normalizes typography by removing em-dashes (U+2014, &mdash;, &#8212;, etc.) and replacing them
 * with appropriate punctuation according to context (parentheses for incises, colons/pipes
 * for titles and coordinates, commas for lists and status badges, "Non renseigné" for empty cells).
 */
export function cleanTypography(str: string | null | undefined, lang: "fr" | "en" = "fr"): string {
  if (!str || typeof str !== "string") return "";

  // Normalize entities and literal escaped sequences to Unicode em-dash U+2014
  let s = str.replace(/&mdash;|&#8212;|&#x2014;|\\u2014/gi, "\u2014");

  if (!s.includes("\u2014")) return s;

  // Single standalone em-dash representing an empty value
  if (s.trim() === "\u2014") {
    return lang === "en" ? "Not specified" : "Non renseigné";
  }

  // 1. Legal incise: " — incluant de manière non limitative ... — " -> " (incluant de manière non limitative ...) "
  s = s.replace(
    /\s*\u2014\s*(incluant de manière non limitative [^\u2014]+?)\s*\u2014\s*/gi,
    " ($1) "
  );
  s = s.replace(
    /\s*\u2014\s*(including without limitation [^\u2014]+?)\s*\u2014\s*/gi,
    " ($1) "
  );

  // 2. Juxtaposed postal addresses and contact details (APD, Consumer Mediation)
  s = s.replace(
    /(\d{4}\s+(?:Bruxelles|Brussels))\s*\u2014\s*(Téléphone|Phone)\s*:\s*([^\u2014]+?)\s*\u2014\s*(E-mail|Email)\s*:\s*([^\u2014]+?)\s*\u2014\s*(Site officiel|Official website|Site)\s*:\s*(\S+)/gi,
    "$1 | $2 : $3 | $4 : $5 | $6 : $7"
  );

  // 3. BCE and VAT mentions
  s = s.replace(
    /\s*\u2014\s*(numéro de TVA intracommunautaire)/gi,
    ", numéro de TVA intracommunautaire"
  );
  s = s.replace(
    /\s*\u2014\s*(intra-community VAT number)/gi,
    ", intra-community VAT number"
  );
  s = s.replace(/\s*\u2014\s*(régime TVA)/gi, ", régime TVA");
  s = s.replace(/\s*\u2014\s*(VAT regime)/gi, ", VAT regime");

  // 4. B2B / B2C mentions in parentheses
  s = s.replace(/\s*\u2014\s*(B2[BC]\))/g, ", $1");

  // 5. Version and date in status badges: "(v1 — 2026-10-15)" -> "(v1 | 2026-10-15)"
  s = s.replace(/\((v\d+)\s*\u2014\s*(\d{4}-\d{2}-\d{2})\)/g, "($1 | $2)");

  // 6. Explicit editorial descriptions requested by Maxime
  s = s.replace(
    /Des films qui racontent le réel\s*\u2014\s*portraits de métiers/g,
    "Des films qui racontent le réel : portraits de métiers"
  );
  s = s.replace(
    /Films that tell real stories\s*\u2014\s*portraits of trades/g,
    "Films that tell real stories: portraits of trades"
  );
  s = s.replace(
    /Des films de marque et de produit\s*\u2014\s*studio/g,
    "Des films de marque et de produit : studio"
  );
  s = s.replace(
    /Brand and product films\s*\u2014\s*studio/g,
    "Brand and product films: studio"
  );
  s = s.replace(
    /Ce que ce projet raconte\s*\u2014\s*son émotion/g,
    "Ce que ce projet raconte : son émotion"
  );
  s = s.replace(
    /What this project carries\s*\u2014\s*its emotion/g,
    "What this project carries: its emotion"
  );

  // 7. Title brand suffix: " — Parallax" -> " | Parallax"
  s = s.replace(/\s*\u2014\s*(Parallax\b)/g, " | $1");

  // 8. General fallback for any remaining single em-dashes
  s = s.replace(/\s*\u2014\s*/g, " | ");
  s = s.replace(/\u2014/g, " - ");

  // Spacing and punctuation cleanups
  s = s
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .replace(/[ ]{2,}/g, " ")
    .trim();

  return s;
}

export function cleanLocalizedString(loc: LocalizedString | null | undefined): LocalizedString {
  if (!loc || typeof loc !== "object") {
    return { fr: "", en: "" };
  }
  return {
    fr: cleanTypography(loc.fr, "fr"),
    en: cleanTypography(loc.en, "en"),
  };
}

export function cleanCommonContent<T extends object>(common: T): T {
  if (!common || typeof common !== "object") return common;
  const clone = structuredClone(common) as Record<string, unknown>;

  if (typeof clone.brandName === "string") {
    clone.brandName = cleanTypography(clone.brandName);
  }

  const nav = clone.navigation as Record<string, unknown> | undefined;
  if (nav) {
    for (const key of ["portfolio", "studio", "contact", "sempra", "clientArea"]) {
      if (nav[key]) nav[key] = cleanLocalizedString(nav[key] as LocalizedString);
    }
  }

  const footer = clone.footer as Record<string, unknown> | undefined;
  if (footer) {
    for (const key of ["copyright", "legalNotice", "privacy", "terms", "cookies"]) {
      if (footer[key]) footer[key] = cleanLocalizedString(footer[key] as LocalizedString);
    }
  }

  return clone as unknown as T;
}

export function cleanHomeContent<T extends object>(home: T): T {
  if (!home || typeof home !== "object") return home;
  const clone = structuredClone(home) as Record<string, unknown>;

  const seo = clone.seo as Record<string, unknown> | undefined;
  if (seo) {
    if (seo.title) seo.title = cleanLocalizedString(seo.title as LocalizedString);
    if (seo.description) seo.description = cleanLocalizedString(seo.description as LocalizedString);
  }
  const hero = clone.hero as Record<string, unknown> | undefined;
  if (hero) {
    if (hero.badge) hero.badge = cleanLocalizedString(hero.badge as LocalizedString);
    if (hero.title) hero.title = cleanLocalizedString(hero.title as LocalizedString);
    if (hero.subtitle) hero.subtitle = cleanLocalizedString(hero.subtitle as LocalizedString);
  }
  const showreel = clone.showreel as Record<string, unknown> | undefined;
  if (showreel) {
    if (showreel.title) showreel.title = cleanLocalizedString(showreel.title as LocalizedString);
    if (showreel.coverImageAlt) showreel.coverImageAlt = cleanLocalizedString(showreel.coverImageAlt as LocalizedString);
  }
  const duo = clone.duo as Record<string, unknown> | undefined;
  if (duo) {
    if (duo.title) duo.title = cleanLocalizedString(duo.title as LocalizedString);
    if (duo.text) duo.text = cleanLocalizedString(duo.text as LocalizedString);
    if (duo.imageAlt) duo.imageAlt = cleanLocalizedString(duo.imageAlt as LocalizedString);
  }
  const savoirFaire = clone.savoirFaire as Record<string, unknown> | undefined;
  if (savoirFaire) {
    if (savoirFaire.title) savoirFaire.title = cleanLocalizedString(savoirFaire.title as LocalizedString);
    if (savoirFaire.photoTitle) savoirFaire.photoTitle = cleanLocalizedString(savoirFaire.photoTitle as LocalizedString);
    if (Array.isArray(savoirFaire.photoItems)) {
      savoirFaire.photoItems = savoirFaire.photoItems.map((item) => cleanLocalizedString(item as LocalizedString));
    }
    if (savoirFaire.videoTitle) savoirFaire.videoTitle = cleanLocalizedString(savoirFaire.videoTitle as LocalizedString);
    if (Array.isArray(savoirFaire.videoItems)) {
      savoirFaire.videoItems = savoirFaire.videoItems.map((item) => cleanLocalizedString(item as LocalizedString));
    }
  }
  const contact = clone.contact as Record<string, unknown> | undefined;
  if (contact) {
    if (contact.title) contact.title = cleanLocalizedString(contact.title as LocalizedString);
    if (contact.emailLabel) contact.emailLabel = cleanLocalizedString(contact.emailLabel as LocalizedString);
    if (contact.socialLabel) contact.socialLabel = cleanLocalizedString(contact.socialLabel as LocalizedString);
  }
  const sempra = clone.sempra as Record<string, unknown> | undefined;
  if (sempra) {
    if (sempra.badge) sempra.badge = cleanLocalizedString(sempra.badge as LocalizedString);
    if (sempra.title) sempra.title = cleanLocalizedString(sempra.title as LocalizedString);
    if (sempra.buttonText) sempra.buttonText = cleanLocalizedString(sempra.buttonText as LocalizedString);
  }

  return clone as unknown as T;
}

export function cleanStudioContent<T extends object>(studio: T): T {
  if (!studio || typeof studio !== "object") return studio;
  const clone = structuredClone(studio) as Record<string, unknown>;

  const seo = clone.seo as Record<string, unknown> | undefined;
  if (seo) {
    if (seo.title) seo.title = cleanLocalizedString(seo.title as LocalizedString);
    if (seo.description) seo.description = cleanLocalizedString(seo.description as LocalizedString);
  }
  const hero = clone.hero as Record<string, unknown> | undefined;
  if (hero) {
    if (hero.title) hero.title = cleanLocalizedString(hero.title as LocalizedString);
    if (hero.text) hero.text = cleanLocalizedString(hero.text as LocalizedString);
  }
  const team = clone.team as Record<string, unknown> | undefined;
  if (team) {
    if (team.title) team.title = cleanLocalizedString(team.title as LocalizedString);
    if (Array.isArray(team.members)) {
      team.members.forEach((m) => {
        if (!m || typeof m !== "object") return;
        const member = m as Record<string, unknown>;
        if (typeof member.name === "string") member.name = cleanTypography(member.name);
        if (member.role) member.role = cleanLocalizedString(member.role as LocalizedString);
        if (member.imageAlt) member.imageAlt = cleanLocalizedString(member.imageAlt as LocalizedString);
      });
    }
  }
  const approach = clone.approach as Record<string, unknown> | undefined;
  if (approach) {
    if (approach.title) approach.title = cleanLocalizedString(approach.title as LocalizedString);
    if (approach.headline) approach.headline = cleanLocalizedString(approach.headline as LocalizedString);
    if (approach.text) approach.text = cleanLocalizedString(approach.text as LocalizedString);
  }

  return clone as unknown as T;
}

export function cleanContactContent<T extends object>(contact: T): T {
  if (!contact || typeof contact !== "object") return contact;
  const clone = structuredClone(contact) as Record<string, unknown>;

  const seo = clone.seo as Record<string, unknown> | undefined;
  if (seo) {
    if (seo.title) seo.title = cleanLocalizedString(seo.title as LocalizedString);
    if (seo.description) seo.description = cleanLocalizedString(seo.description as LocalizedString);
  }
  const hero = clone.hero as Record<string, unknown> | undefined;
  if (hero) {
    if (hero.title) hero.title = cleanLocalizedString(hero.title as LocalizedString);
    if (hero.subtitle) hero.subtitle = cleanLocalizedString(hero.subtitle as LocalizedString);
  }
  const form = clone.form as Record<string, unknown> | undefined;
  if (form) {
    for (const key of [
      "nameLabel", "namePlaceholder", "emailLabel", "emailPlaceholder",
      "phoneLabel", "phonePlaceholder", "timelineLabel", "timelinePlaceholder",
      "typeLabel", "typePlaceholder", "messageLabel", "messagePlaceholder",
      "submitButton", "noticeText", "privacyPolicyText"
    ]) {
      if (form[key]) form[key] = cleanLocalizedString(form[key] as LocalizedString);
    }
    if (Array.isArray(form.projectTypes)) {
      form.projectTypes.forEach((pt) => {
        if (pt && typeof pt === "object") {
          const ptObj = pt as Record<string, unknown>;
          if (ptObj.label) ptObj.label = cleanLocalizedString(ptObj.label as LocalizedString);
        }
      });
    }
  }
  const card = clone.card as Record<string, unknown> | undefined;
  if (card) {
    if (card.title) card.title = cleanLocalizedString(card.title as LocalizedString);
    if (card.emailLabel) card.emailLabel = cleanLocalizedString(card.emailLabel as LocalizedString);
    if (card.phoneLabel) card.phoneLabel = cleanLocalizedString(card.phoneLabel as LocalizedString);
    if (card.socialLabel) card.socialLabel = cleanLocalizedString(card.socialLabel as LocalizedString);
    if (card.responseTimeNotice) card.responseTimeNotice = cleanLocalizedString(card.responseTimeNotice as LocalizedString);
  }
  const messages = clone.messages as Record<string, unknown> | undefined;
  if (messages) {
    for (const [k, v] of Object.entries(messages)) {
      if (v && typeof v === "object") {
        messages[k] = cleanLocalizedString(v as LocalizedString);
      }
    }
  }

  return clone as unknown as T;
}

export interface DetailedBlockLike {
  type?: string;
  text?: LocalizedString;
}

export interface PortfolioCategoryLike {
  id?: string;
  slugFr?: string;
  slugEn?: string;
  title?: LocalizedString;
  intro?: LocalizedString;
  description?: LocalizedString;
  entrySummary?: LocalizedString;
  entrySide?: string;
  order?: number;
  status?: string;
  seo?: {
    title?: LocalizedString;
    description?: LocalizedString;
  };
  coverImageId?: string | null;
  coverAlt?: LocalizedString;
  entryImageId?: string | null;
  entryAlt?: LocalizedString;
  bannerImageId?: string | null;
  bannerAlt?: LocalizedString;
  showreelTitle?: LocalizedString;
  showreelVideo?: unknown;
  showreelCoverImageId?: string | null;
  morePhotosButton?: LocalizedString;
  lessPhotosButton?: LocalizedString;
  moreVideosButton?: LocalizedString;
  lessVideosButton?: LocalizedString;
  backButton?: LocalizedString;
}

export interface PortfolioProjectLike {
  id?: string;
  category?: string;
  slugFr?: string;
  slugEn?: string;
  title?: LocalizedString;
  summary?: LocalizedString;
  shortDescription?: LocalizedString;
  description?: DetailedBlockLike[] | LocalizedString;
  order?: number;
  status?: string;
  archived?: boolean;
  client?: string;
  role?: LocalizedString;
  location?: LocalizedString;
  challenge?: LocalizedString;
  solution?: LocalizedString;
  impact?: LocalizedString;
  testimonial?: {
    quote?: LocalizedString;
    author?: string;
    role?: LocalizedString;
  };
  seo?: {
    title?: LocalizedString;
    description?: LocalizedString;
  };
  coverImageId?: string | null;
  coverAlt?: LocalizedString;
  galleryImageIds?: string[];
  galleryAlt?: Record<string, LocalizedString>;
  video?: {
    coverImageId?: string | null;
  };
}

export interface PortfolioOverviewLike {
  title?: LocalizedString;
  intro?: LocalizedString;
  seo?: {
    title?: LocalizedString;
    description?: LocalizedString;
  };
  seeMoreButton?: LocalizedString;
}

export interface PortfolioContentLike {
  schemaVersion?: number;
  revision?: string;
  updatedAt?: string;
  overview?: PortfolioOverviewLike;
  categories?: PortfolioCategoryLike[];
  sections?: Record<string, PortfolioCategoryLike>;
  projects?: PortfolioProjectLike[];
  media?: unknown;
}

export interface CookieInventoryItemLike {
  id?: string;
  name?: LocalizedString;
  provider?: LocalizedString;
  category?: string;
  purpose?: LocalizedString;
  duration?: LocalizedString;
  exemptionJustification?: LocalizedString;
}

export interface LegalSectionLike {
  title?: LocalizedString;
  paragraphs?: LocalizedString[];
  listItems?: LocalizedString[];
}

export interface LegalDocumentLike {
  seoTitle?: LocalizedString;
  seoDescription?: LocalizedString;
  publicTitle?: LocalizedString;
  intro?: LocalizedString;
  effectiveDate?: string;
  version?: number;
  sections?: LegalSectionLike[];
  inventory?: CookieInventoryItemLike[];
}

export function cleanLegalDocument<T extends object>(doc: T): T {
  if (!doc || typeof doc !== "object") return doc;
  const clone = structuredClone(doc) as unknown as LegalDocumentLike;

  if (clone.seoTitle) clone.seoTitle = cleanLocalizedString(clone.seoTitle);
  if (clone.seoDescription) clone.seoDescription = cleanLocalizedString(clone.seoDescription);
  if (clone.publicTitle) clone.publicTitle = cleanLocalizedString(clone.publicTitle);
  if (clone.intro) clone.intro = cleanLocalizedString(clone.intro);

  if (Array.isArray(clone.sections)) {
    clone.sections.forEach((sec) => {
      if (!sec || typeof sec !== "object") return;
      if (sec.title) sec.title = cleanLocalizedString(sec.title);
      if (Array.isArray(sec.paragraphs)) {
        sec.paragraphs = sec.paragraphs.map(cleanLocalizedString);
      }
      if (Array.isArray(sec.listItems)) {
        sec.listItems = sec.listItems.map(cleanLocalizedString);
      }
    });
  }

  if (Array.isArray(clone.inventory)) {
    clone.inventory.forEach((item) => {
      if (!item || typeof item !== "object") return;
      if (item.name) item.name = cleanLocalizedString(item.name);
      if (item.provider) item.provider = cleanLocalizedString(item.provider);
      if (item.purpose) item.purpose = cleanLocalizedString(item.purpose);
      if (item.duration) item.duration = cleanLocalizedString(item.duration);
      if (item.exemptionJustification) {
        item.exemptionJustification = cleanLocalizedString(item.exemptionJustification);
      }
    });
  }

  return clone as unknown as T;
}

export function cleanPortfolioContent<T extends object>(portfolio: T): T {
  if (!portfolio || typeof portfolio !== "object") return portfolio;
  const clone = structuredClone(portfolio) as unknown as PortfolioContentLike;

  if (clone.overview) {
    if (clone.overview.title) clone.overview.title = cleanLocalizedString(clone.overview.title);
    if (clone.overview.intro) clone.overview.intro = cleanLocalizedString(clone.overview.intro);
    if (clone.overview.seo) {
      if (clone.overview.seo.title) clone.overview.seo.title = cleanLocalizedString(clone.overview.seo.title);
      if (clone.overview.seo.description) clone.overview.seo.description = cleanLocalizedString(clone.overview.seo.description);
    }
    if (clone.overview.seeMoreButton) {
      clone.overview.seeMoreButton = cleanLocalizedString(clone.overview.seeMoreButton);
    }
  }

  function cleanCategoryItem(cat: PortfolioCategoryLike) {
    if (!cat || typeof cat !== "object") return;
    if (cat.title) cat.title = cleanLocalizedString(cat.title);
    if (cat.intro) cat.intro = cleanLocalizedString(cat.intro);
    if (cat.entrySummary) cat.entrySummary = cleanLocalizedString(cat.entrySummary);
    if (cat.coverAlt) cat.coverAlt = cleanLocalizedString(cat.coverAlt);
    if (cat.entryAlt) cat.entryAlt = cleanLocalizedString(cat.entryAlt);
    if (cat.bannerAlt) cat.bannerAlt = cleanLocalizedString(cat.bannerAlt);
    if (cat.showreelTitle) cat.showreelTitle = cleanLocalizedString(cat.showreelTitle);
    if (cat.morePhotosButton) cat.morePhotosButton = cleanLocalizedString(cat.morePhotosButton);
    if (cat.lessPhotosButton) cat.lessPhotosButton = cleanLocalizedString(cat.lessPhotosButton);
    if (cat.moreVideosButton) cat.moreVideosButton = cleanLocalizedString(cat.moreVideosButton);
    if (cat.lessVideosButton) cat.lessVideosButton = cleanLocalizedString(cat.lessVideosButton);
    if (cat.backButton) cat.backButton = cleanLocalizedString(cat.backButton);
    if (cat.seo) {
      if (cat.seo.title) cat.seo.title = cleanLocalizedString(cat.seo.title);
      if (cat.seo.description) cat.seo.description = cleanLocalizedString(cat.seo.description);
    }
  }

  if (Array.isArray(clone.categories)) {
    clone.categories.forEach(cleanCategoryItem);
  }
  if (clone.sections && typeof clone.sections === "object") {
    Object.values(clone.sections).forEach(cleanCategoryItem);
  }

  if (Array.isArray(clone.projects)) {
    clone.projects.forEach((proj: PortfolioProjectLike) => {
      if (!proj || typeof proj !== "object") return;
      if (proj.title) proj.title = cleanLocalizedString(proj.title);
      if (proj.summary) proj.summary = cleanLocalizedString(proj.summary);
      if (proj.coverAlt) proj.coverAlt = cleanLocalizedString(proj.coverAlt);
      if (proj.seo) {
        if (proj.seo.title) proj.seo.title = cleanLocalizedString(proj.seo.title);
        if (proj.seo.description) proj.seo.description = cleanLocalizedString(proj.seo.description);
      }
      if (Array.isArray(proj.description)) {
        proj.description.forEach((block) => {
          if (block && typeof block === "object" && block.text) {
            block.text = cleanLocalizedString(block.text);
          }
        });
      }
      if (proj.galleryAlt && typeof proj.galleryAlt === "object") {
        for (const imageId of Object.keys(proj.galleryAlt)) {
          if (proj.galleryAlt[imageId]) {
            proj.galleryAlt[imageId] = cleanLocalizedString(proj.galleryAlt[imageId]);
          }
        }
      }
    });
  }

  return clone as unknown as T;
}

// ============================================================================
// PURE VIDEO PARSER
// ============================================================================

export type VideoProvider = "youtube" | "vimeo";

export interface ParsedVideo {
  provider: VideoProvider;
  videoId: string;
}

export function parseVideoUrl(url: string | null | undefined): ParsedVideo | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;

    const host = u.hostname.toLowerCase();

    const isYouTube =
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be";

    if (isYouTube) {
      let videoId = "";
      if (host === "youtu.be") {
        videoId = u.pathname.slice(1);
      } else if (u.pathname === "/watch") {
        videoId = u.searchParams.get("v") || "";
      } else if (u.pathname.startsWith("/shorts/")) {
        videoId = u.pathname.slice(8);
      } else if (u.pathname.startsWith("/embed/")) {
        videoId = u.pathname.slice(7);
      }
      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return { provider: "youtube", videoId };
      }
      return null;
    }

    const isVimeo =
      host === "vimeo.com" ||
      host === "www.vimeo.com" ||
      host === "player.vimeo.com";

    if (isVimeo) {
      const match = u.pathname.match(/^\/(?:video\/)?(\d+)$/);
      if (match) {
        const videoId = match[1];
        if (/^\d{5,15}$/.test(videoId)) {
          return { provider: "vimeo", videoId };
        }
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export function getCanonicalVideoUrl(video: ParsedVideo | null | undefined): string {
  if (!video) return "";
  if (video.provider === "youtube") {
    return `https://www.youtube.com/watch?v=${video.videoId}`;
  }
  if (video.provider === "vimeo") {
    return `https://vimeo.com/${video.videoId}`;
  }
  return "";
}

export function getEmbedVideoUrl(video: ParsedVideo | null | undefined): string {
  if (!video) return "";
  if (video.provider === "youtube") {
    return `https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1`;
  }
  if (video.provider === "vimeo") {
    return `https://player.vimeo.com/video/${video.videoId}?autoplay=1`;
  }
  return "";
}

// ============================================================================
// CANONICAL PORTFOLIO DOMAIN MODEL & VALIDATOR
// ============================================================================

export const PORTFOLIO_CATEGORIES = ["documentary", "advertising"] as const;
export type PortfolioCategory = string;

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
export const CATEGORY_ID_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;

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
  originalWidth: number;
  originalHeight: number;
  originalFormat: "jpeg" | "png" | "webp";
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

export interface PortfolioCategoryItem {
  id: string;
  slugFr: string;
  slugEn: string;
  slugAliases?: {
    fr?: string[];
    en?: string[];
  };
  order: number;
  status: "draft" | "published";
  title: LocalizedString;
  intro: LocalizedString;
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  coverImageId?: string | null;
  coverAlt?: LocalizedString;
  entryImageId?: string | null;
  entryAlt?: LocalizedString;
  entrySummary?: LocalizedString;
  entrySide?: "auto" | "left" | "right";
  bannerImageId?: string | null;
  bannerAlt?: LocalizedString;
  showreelTitle: LocalizedString;
  showreelVideo: PortfolioVideo | null;
  showreelCoverImageId: string | null;
  morePhotosButton: LocalizedString;
  lessPhotosButton: LocalizedString;
  moreVideosButton?: LocalizedString;
  lessVideosButton?: LocalizedString;
  backButton: LocalizedString;
  category?: string;
}

export type PortfolioSection = PortfolioCategoryItem;

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
  schemaVersion: 2;
  revision: string;
  updatedAt: string;
  overview: PortfolioOverview;
  categories: PortfolioCategoryItem[];
  sections: Record<string, PortfolioCategoryItem>;
  projects: PortfolioProject[];
  media: Record<string, PortfolioMediaItem>;
}

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

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function calculateEffectiveSide(
  projectSide: "auto" | "left" | "right",
  showcaseIndex: number
): "left" | "right" {
  if (projectSide === "left" || projectSide === "right") {
    return projectSide;
  }
  return showcaseIndex % 2 === 0 ? "left" : "right";
}

export function validatePortfolioLocalizedString(
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

export function validatePortfolioVideo(
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

export function validateDetailedBlocks(
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
    if (!validatePortfolioLocalizedString(block.text, [...path, i, "text"], errors)) {
      valid = false;
    }
  }
  return valid;
}

export function validateMediaItem(
  id: string,
  val: unknown,
  errors: ValidationErrorDetail[],
  categoryIds?: Set<string>,
  _projectIds?: Set<string>
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
    if (categoryIds && !categoryIds.has(val.ownerId)) {
      errors.push({ path: [...mPath, "ownerId"], message: `ownerId de rubrique "${val.ownerId}" introuvable` });
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

export function validatePortfolioCategoryItem(
  val: unknown,
  index: number,
  errors: ValidationErrorDetail[],
  seenIds: Set<string>,
  seenSlugsFr: Set<string>,
  seenSlugsEn: Set<string>,
  mediaRegistry?: Record<string, PortfolioMediaItem>
): boolean {
  if (!isObject(val)) {
    errors.push({ path: ["categories", index], message: "La rubrique doit être un objet" });
    return false;
  }
  const cPath = ["categories", index];
  let valid = true;

  if (typeof val.id !== "string" || !val.id.trim() || val.id.length > 64 || !CATEGORY_ID_REGEX.test(val.id)) {
    errors.push({ path: [...cPath, "id"], message: "Identifiant de rubrique invalide" });
    valid = false;
  } else if (seenIds.has(val.id)) {
    errors.push({ path: [...cPath, "id"], message: `Identifiant de rubrique "${val.id}" dupliqué` });
    valid = false;
  } else {
    seenIds.add(val.id);
  }

  const categoryId = String(val.id || "");

  if (
    typeof val.slugFr !== "string" ||
    val.slugFr.length < 2 ||
    val.slugFr.length > 100 ||
    !SLUG_REGEX.test(val.slugFr)
  ) {
    errors.push({ path: [...cPath, "slugFr"], message: "Format slug FR invalide" });
    valid = false;
  } else if (seenSlugsFr.has(val.slugFr)) {
    errors.push({ path: [...cPath, "slugFr"], message: `Le slug FR "${val.slugFr}" est dupliqué` });
    valid = false;
  } else {
    seenSlugsFr.add(val.slugFr);
  }

  if (
    typeof val.slugEn !== "string" ||
    val.slugEn.length < 2 ||
    val.slugEn.length > 100 ||
    !SLUG_REGEX.test(val.slugEn)
  ) {
    errors.push({ path: [...cPath, "slugEn"], message: "Format slug EN invalide" });
    valid = false;
  } else if (seenSlugsEn.has(val.slugEn)) {
    errors.push({ path: [...cPath, "slugEn"], message: `Le slug EN "${val.slugEn}" est dupliqué` });
    valid = false;
  } else {
    seenSlugsEn.add(val.slugEn);
  }

  // Validate aliases if present
  if (val.slugAliases !== undefined && val.slugAliases !== null) {
    if (!isObject(val.slugAliases)) {
      errors.push({ path: [...cPath, "slugAliases"], message: "slugAliases doit être un objet { fr, en }" });
      valid = false;
    } else {
      if (Array.isArray(val.slugAliases.fr)) {
        for (const alias of val.slugAliases.fr) {
          if (typeof alias !== "string" || !SLUG_REGEX.test(alias)) {
            errors.push({ path: [...cPath, "slugAliases", "fr"], message: `Alias FR invalide: "${alias}"` });
            valid = false;
          } else if (alias === val.slugFr) {
            errors.push({ path: [...cPath, "slugAliases", "fr"], message: `L'alias FR "${alias}" ne peut être identique au slug actif` });
            valid = false;
          }
        }
      }
      if (Array.isArray(val.slugAliases.en)) {
        for (const alias of val.slugAliases.en) {
          if (typeof alias !== "string" || !SLUG_REGEX.test(alias)) {
            errors.push({ path: [...cPath, "slugAliases", "en"], message: `Alias EN invalide: "${alias}"` });
            valid = false;
          } else if (alias === val.slugEn) {
            errors.push({ path: [...cPath, "slugAliases", "en"], message: `L'alias EN "${alias}" ne peut être identique au slug actif` });
            valid = false;
          }
        }
      }
    }
  }

  if (typeof val.order !== "number" || val.order < 0) {
    errors.push({ path: [...cPath, "order"], message: "order doit être un entier positif" });
    valid = false;
  }

  if (val.status !== "draft" && val.status !== "published") {
    errors.push({ path: [...cPath, "status"], message: "status doit être 'draft' ou 'published'" });
    valid = false;
  }

  if (!validatePortfolioLocalizedString(val.title, [...cPath, "title"], errors)) valid = false;
  if (!validatePortfolioLocalizedString(val.intro, [...cPath, "intro"], errors)) valid = false;

  if (isObject(val.seo)) {
    validatePortfolioLocalizedString(val.seo.title, [...cPath, "seo", "title"], errors);
    validatePortfolioLocalizedString(val.seo.description, [...cPath, "seo", "description"], errors);
  } else {
    errors.push({ path: [...cPath, "seo"], message: "SEO requis" });
    valid = false;
  }

  if (val.coverImageId !== null && val.coverImageId !== undefined) {
    if (typeof val.coverImageId !== "string" || !UUID_REGEX.test(val.coverImageId)) {
      errors.push({ path: [...cPath, "coverImageId"], message: "UUID de couverture invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.coverImageId];
      if (!item) {
        errors.push({ path: [...cPath, "coverImageId"], message: `Média de couverture ${val.coverImageId} introuvable` });
        valid = false;
      } else if (item.ownerType !== "section" || item.ownerId !== categoryId) {
        errors.push({ path: [...cPath, "coverImageId"], message: `Le média ${val.coverImageId} n'appartient pas à cette rubrique` });
        valid = false;
      }
    }
  }

  if (val.coverAlt !== undefined && val.coverAlt !== null && !validatePortfolioLocalizedString(val.coverAlt, [...cPath, "coverAlt"], errors)) {
    valid = false;
  }

  if (val.entryImageId !== null && val.entryImageId !== undefined) {
    if (typeof val.entryImageId !== "string" || !UUID_REGEX.test(val.entryImageId)) {
      errors.push({ path: [...cPath, "entryImageId"], message: "UUID d'image d'entrée invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.entryImageId];
      if (!item) {
        errors.push({ path: [...cPath, "entryImageId"], message: `Média d'entrée ${val.entryImageId} introuvable` });
        valid = false;
      } else if (item.ownerType !== "section" || item.ownerId !== categoryId) {
        errors.push({ path: [...cPath, "entryImageId"], message: `Le média ${val.entryImageId} n'appartient pas à cette rubrique` });
        valid = false;
      }
    }
  }

  if (val.entryAlt !== undefined && val.entryAlt !== null && !validatePortfolioLocalizedString(val.entryAlt, [...cPath, "entryAlt"], errors)) {
    valid = false;
  }

  if (val.entrySummary !== undefined && val.entrySummary !== null && !validatePortfolioLocalizedString(val.entrySummary, [...cPath, "entrySummary"], errors)) {
    valid = false;
  }

  if (val.entrySide !== undefined && val.entrySide !== null && val.entrySide !== "left" && val.entrySide !== "right" && val.entrySide !== "auto") {
    errors.push({ path: [...cPath, "entrySide"], message: "entrySide doit être 'auto', 'left' ou 'right'" });
    valid = false;
  }

  if (val.bannerImageId !== null && val.bannerImageId !== undefined) {
    if (typeof val.bannerImageId !== "string" || !UUID_REGEX.test(val.bannerImageId)) {
      errors.push({ path: [...cPath, "bannerImageId"], message: "UUID de bannière invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.bannerImageId];
      if (!item) {
        errors.push({ path: [...cPath, "bannerImageId"], message: `Média de bannière ${val.bannerImageId} introuvable` });
        valid = false;
      } else if (item.ownerType !== "section" || item.ownerId !== categoryId) {
        errors.push({ path: [...cPath, "bannerImageId"], message: `Le média ${val.bannerImageId} n'appartient pas à cette rubrique` });
        valid = false;
      }
    }
  }

  if (val.bannerAlt !== undefined && val.bannerAlt !== null && !validatePortfolioLocalizedString(val.bannerAlt, [...cPath, "bannerAlt"], errors)) {
    valid = false;
  }

  if (val.showreelTitle && !validatePortfolioLocalizedString(val.showreelTitle, [...cPath, "showreelTitle"], errors)) valid = false;
  if (!validatePortfolioVideo(val.showreelVideo, [...cPath, "showreelVideo"], errors, mediaRegistry, "section", categoryId)) {
    valid = false;
  }

  if (val.showreelCoverImageId !== null && val.showreelCoverImageId !== undefined) {
    if (typeof val.showreelCoverImageId !== "string" || !UUID_REGEX.test(val.showreelCoverImageId)) {
      errors.push({ path: [...cPath, "showreelCoverImageId"], message: "UUID d'affiche de showreel invalide" });
      valid = false;
    } else if (mediaRegistry) {
      const item = mediaRegistry[val.showreelCoverImageId];
      if (!item) {
        errors.push({ path: [...cPath, "showreelCoverImageId"], message: `Média d'affiche de showreel ${val.showreelCoverImageId} introuvable` });
        valid = false;
      } else if (item.ownerType !== "section" || item.ownerId !== categoryId) {
        errors.push({ path: [...cPath, "showreelCoverImageId"], message: `Le média ${val.showreelCoverImageId} n'appartient pas à cette rubrique` });
        valid = false;
      }
    }
  }

  if (val.morePhotosButton && !validatePortfolioLocalizedString(val.morePhotosButton, [...cPath, "morePhotosButton"], errors)) valid = false;
  if (val.lessPhotosButton && !validatePortfolioLocalizedString(val.lessPhotosButton, [...cPath, "lessPhotosButton"], errors)) valid = false;
  if (val.moreVideosButton && !validatePortfolioLocalizedString(val.moreVideosButton, [...cPath, "moreVideosButton"], errors)) valid = false;
  if (val.lessVideosButton && !validatePortfolioLocalizedString(val.lessVideosButton, [...cPath, "lessVideosButton"], errors)) valid = false;
  if (val.backButton && !validatePortfolioLocalizedString(val.backButton, [...cPath, "backButton"], errors)) valid = false;

  return valid;
}

export function validatePortfolioProject(
  val: unknown,
  index: number,
  errors: ValidationErrorDetail[],
  seenSlugsFr: Map<string, string>,
  seenSlugsEn: Map<string, string>,
  mediaRegistry?: Record<string, PortfolioMediaItem>,
  allowedCategoryIds?: Set<string>
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

  if (typeof val.category !== "string" || !val.category.trim()) {
    errors.push({ path: [...pPath, "category"], message: "Catégorie requise" });
    valid = false;
  } else if (allowedCategoryIds && !allowedCategoryIds.has(val.category)) {
    errors.push({ path: [...pPath, "category"], message: `Catégorie "${val.category}" introuvable` });
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

  if (!validatePortfolioLocalizedString(val.title, [...pPath, "title"], errors)) valid = false;
  if (!validatePortfolioLocalizedString(val.summary, [...pPath, "summary"], errors)) valid = false;

  if (!validateDetailedBlocks(val.description, [...pPath, "description"], errors)) {
    valid = false;
  }

  if (isObject(val.seo)) {
    validatePortfolioLocalizedString(val.seo.title, [...pPath, "seo", "title"], errors);
    validatePortfolioLocalizedString(val.seo.description, [...pPath, "seo", "description"], errors);
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

  if (!validatePortfolioLocalizedString(val.coverAlt, [...pPath, "coverAlt"], errors)) valid = false;

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

export const portfolioCategorySchema = {
  safeParse(val: unknown): SchemaParseResult<PortfolioCategoryItem> {
    const errors: ValidationErrorDetail[] = [];
    if (!isObject(val)) {
      return { success: false, error: { errors: [{ path: [], message: "Doit être un objet rubrique" }] } };
    }
    const seenIds = new Set<string>();
    const seenSlugsFr = new Set<string>();
    const seenSlugsEn = new Set<string>();
    validatePortfolioCategoryItem(val, 0, errors, seenIds, seenSlugsFr, seenSlugsEn);
    if (errors.length > 0) {
      return { success: false, error: { errors } };
    }
    return { success: true, data: val as unknown as PortfolioCategoryItem };
  },
};

export const portfolioSectionSchema = portfolioCategorySchema;

const ALLOWED_ROOT_KEYS = new Set([
  "schemaVersion",
  "revision",
  "updatedAt",
  "overview",
  "categories",
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

    if (val.schemaVersion !== 2) {
      errors.push({ path: ["schemaVersion"], message: "schemaVersion doit être 2" });
    }

    if (typeof val.revision !== "string" || val.revision.length < 8 || val.revision.length > 64) {
      errors.push({ path: ["revision"], message: "Révision invalide" });
    }

    if (typeof val.updatedAt !== "string") {
      errors.push({ path: ["updatedAt"], message: "updatedAt doit être une chaîne" });
    }

    if (isObject(val.overview)) {
      validatePortfolioLocalizedString(val.overview.title, ["overview", "title"], errors);
      validatePortfolioLocalizedString(val.overview.intro, ["overview", "intro"], errors);
      if (isObject(val.overview.seo)) {
        validatePortfolioLocalizedString(val.overview.seo.title, ["overview", "seo", "title"], errors);
        validatePortfolioLocalizedString(val.overview.seo.description, ["overview", "seo", "description"], errors);
      } else {
        errors.push({ path: ["overview", "seo"], message: "SEO de l'overview requis" });
      }
      validatePortfolioLocalizedString(val.overview.seeMoreButton, ["overview", "seeMoreButton"], errors);
    } else {
      errors.push({ path: ["overview"], message: "Overview requis" });
    }

    // Media registry
    let mediaRegistry: Record<string, PortfolioMediaItem> | undefined;
    if (isObject(val.media)) {
      mediaRegistry = val.media as Record<string, PortfolioMediaItem>;
    } else {
      errors.push({ path: ["media"], message: "media doit être un objet" });
    }

    // Categories
    const categoryIds = new Set<string>();
    const seenSlugsFr = new Set<string>();
    const seenSlugsEn = new Set<string>();

    if (Array.isArray(val.categories)) {
      for (let i = 0; i < val.categories.length; i++) {
        validatePortfolioCategoryItem(
          val.categories[i],
          i,
          errors,
          categoryIds,
          seenSlugsFr,
          seenSlugsEn,
          mediaRegistry
        );
      }
    } else {
      errors.push({ path: ["categories"], message: "categories doit être un tableau" });
    }

    // Projects
    const projectIds = new Set<string>();
    if (Array.isArray(val.projects)) {
      const seenFr = new Map<string, string>();
      const seenEn = new Map<string, string>();
      for (let i = 0; i < val.projects.length; i++) {
        const p = val.projects[i];
        if (p && typeof p === "object" && "id" in p && typeof (p as { id: unknown }).id === "string") {
          projectIds.add((p as { id: string }).id);
        }
        validatePortfolioProject(p, i, errors, seenFr, seenEn, mediaRegistry, categoryIds);
      }
    } else {
      errors.push({ path: ["projects"], message: "projects doit être un tableau" });
    }

    // Validate media items against collected categoryIds and projectIds
    if (mediaRegistry) {
      for (const [id, item] of Object.entries(mediaRegistry)) {
        validateMediaItem(id, item, errors, categoryIds, projectIds);
      }
    }

    if (errors.length > 0) {
      return { success: false, error: { errors } };
    }

    // Ensure sections map is synchronized
    const categories = val.categories as PortfolioCategoryItem[];
    const sections: Record<string, PortfolioCategoryItem> = {};
    for (const c of categories) {
      sections[c.id] = c;
    }

    const data: PortfolioContent = {
      ...(val as unknown as PortfolioContent),
      schemaVersion: 2,
      categories,
      sections,
    };

    return { success: true, data };
  },
};

/**
 * Idempotent migration from Schema V1 to Schema V2.
 * Preserves documentary and advertising with their original stable IDs,
 * projects, media, slugs, and editorial configurations.
 */
export function migratePortfolioContentV1ToV2(raw: unknown): PortfolioContent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Contenu portfolio invalide pour la migration : racine non-objet");
  }
  const obj = raw as Record<string, unknown>;

  // Reject unsupported schema versions
  if (obj.schemaVersion !== undefined && obj.schemaVersion !== 1 && obj.schemaVersion !== 2) {
    throw new Error(`Version de schéma non prise en charge : ${String(obj.schemaVersion)}`);
  }

  // If already V2, return with synchronized sections map
  if (obj.schemaVersion === 2 && Array.isArray(obj.categories)) {
    const cats = obj.categories as PortfolioCategoryItem[];
    const sections: Record<string, PortfolioCategoryItem> = {};
    for (const c of cats) {
      sections[c.id] = c;
    }
    return {
      ...(obj as unknown as PortfolioContent),
      schemaVersion: 2,
      categories: cats,
      sections,
    };
  }

  // Strict structural validation of V1 source before migration
  if (typeof obj.revision !== "string" || obj.revision.trim().length === 0) {
    throw new Error("revision doit être une chaîne non-vide");
  }
  if (typeof obj.updatedAt !== "string" || obj.updatedAt.trim().length === 0) {
    throw new Error("updatedAt doit être une chaîne non-vide");
  }

  if (!isObject(obj.overview)) {
    throw new Error("overview doit être un objet valide");
  }
  const ov = obj.overview as Record<string, unknown>;
  if (!isObject(ov.title) || typeof (ov.title as Record<string, unknown>).fr !== "string" || typeof (ov.title as Record<string, unknown>).en !== "string") {
    throw new Error("overview.title doit être un objet { fr, en }");
  }
  if (!isObject(ov.intro) || typeof (ov.intro as Record<string, unknown>).fr !== "string" || typeof (ov.intro as Record<string, unknown>).en !== "string") {
    throw new Error("overview.intro doit être un objet { fr, en }");
  }
  if (!isObject(ov.seo) || !isObject((ov.seo as Record<string, unknown>).title) || !isObject((ov.seo as Record<string, unknown>).description)) {
    throw new Error("overview.seo doit être un objet avec title et description { fr, en }");
  }
  if (!isObject(ov.seeMoreButton) || typeof (ov.seeMoreButton as Record<string, unknown>).fr !== "string" || typeof (ov.seeMoreButton as Record<string, unknown>).en !== "string") {
    throw new Error("overview.seeMoreButton doit être un objet { fr, en }");
  }

  if (!isObject(obj.sections)) {
    throw new Error("sections doit être un objet valide");
  }

  if (!Array.isArray(obj.projects)) {
    throw new Error("projects doit être un tableau");
  }

  if (obj.media !== undefined && (!isObject(obj.media) || Array.isArray(obj.media))) {
    throw new Error("media doit être un objet valide");
  }

  function validateV1LocalizedString(val: unknown, path: string): void {
    if (!isObject(val)) {
      throw new Error(`${path} doit être un objet localisé { fr, en }`);
    }
    const o = val as Record<string, unknown>;
    if (typeof o.fr !== "string" || o.fr.length > 2000) {
      throw new Error(`${path}.fr doit être une chaîne valide`);
    }
    if (typeof o.en !== "string" || o.en.length > 2000) {
      throw new Error(`${path}.en doit être une chaîne valide`);
    }
  }

  function validateV1Section(secKey: string, secRaw: unknown): void {
    if (!isObject(secRaw)) {
      throw new Error(`sections.${secKey} doit être un objet`);
    }
    const sec = secRaw as Record<string, unknown>;

    // Mandatory V1 fields: title, intro, seo
    if (sec.title === undefined) {
      throw new Error(`sections.${secKey}.title est requis`);
    }
    validateV1LocalizedString(sec.title, `sections.${secKey}.title`);

    if (sec.intro === undefined) {
      throw new Error(`sections.${secKey}.intro est requis`);
    }
    validateV1LocalizedString(sec.intro, `sections.${secKey}.intro`);

    if (sec.seo === undefined || !isObject(sec.seo)) {
      throw new Error(`sections.${secKey}.seo doit être un objet { title, description }`);
    }
    const seo = sec.seo as Record<string, unknown>;
    if (seo.title === undefined) {
      throw new Error(`sections.${secKey}.seo.title est requis`);
    }
    validateV1LocalizedString(seo.title, `sections.${secKey}.seo.title`);
    if (seo.description === undefined) {
      throw new Error(`sections.${secKey}.seo.description est requis`);
    }
    validateV1LocalizedString(seo.description, `sections.${secKey}.seo.description`);

    // Optional fields in V1: if present, validate strictly (never silently substitute)
    if (sec.coverImageId !== undefined && sec.coverImageId !== null) {
      if (typeof sec.coverImageId !== "string" || !UUID_REGEX.test(sec.coverImageId)) {
        throw new Error(`sections.${secKey}.coverImageId doit être un UUID valide ou null`);
      }
    }

    if (sec.coverAlt !== undefined && sec.coverAlt !== null) {
      validateV1LocalizedString(sec.coverAlt, `sections.${secKey}.coverAlt`);
    }

    if (sec.entryImageId !== undefined && sec.entryImageId !== null) {
      if (typeof sec.entryImageId !== "string" || !UUID_REGEX.test(sec.entryImageId)) {
        throw new Error(`sections.${secKey}.entryImageId doit être un UUID valide ou null`);
      }
    }

    if (sec.entryAlt !== undefined && sec.entryAlt !== null) {
      validateV1LocalizedString(sec.entryAlt, `sections.${secKey}.entryAlt`);
    }

    if (sec.entrySummary !== undefined && sec.entrySummary !== null) {
      validateV1LocalizedString(sec.entrySummary, `sections.${secKey}.entrySummary`);
    }

    if (sec.entrySide !== undefined && sec.entrySide !== null) {
      if (sec.entrySide !== "left" && sec.entrySide !== "right" && sec.entrySide !== "auto") {
        throw new Error(`sections.${secKey}.entrySide doit valoir 'left', 'right' ou 'auto'`);
      }
    }

    if (sec.bannerImageId !== undefined && sec.bannerImageId !== null) {
      if (typeof sec.bannerImageId !== "string" || !UUID_REGEX.test(sec.bannerImageId)) {
        throw new Error(`sections.${secKey}.bannerImageId doit être un UUID valide ou null`);
      }
    }

    if (sec.bannerAlt !== undefined && sec.bannerAlt !== null) {
      validateV1LocalizedString(sec.bannerAlt, `sections.${secKey}.bannerAlt`);
    }

    if (sec.showreelTitle !== undefined && sec.showreelTitle !== null) {
      validateV1LocalizedString(sec.showreelTitle, `sections.${secKey}.showreelTitle`);
    }

    if (sec.showreelVideo !== undefined && sec.showreelVideo !== null) {
      if (!isObject(sec.showreelVideo)) {
        throw new Error(`sections.${secKey}.showreelVideo doit être un objet vidéo ou null`);
      }
    }

    if (sec.showreelCoverImageId !== undefined && sec.showreelCoverImageId !== null) {
      if (typeof sec.showreelCoverImageId !== "string" || !UUID_REGEX.test(sec.showreelCoverImageId)) {
        throw new Error(`sections.${secKey}.showreelCoverImageId doit être un UUID valide ou null`);
      }
    }

    if (sec.morePhotosButton !== undefined && sec.morePhotosButton !== null) {
      validateV1LocalizedString(sec.morePhotosButton, `sections.${secKey}.morePhotosButton`);
    }

    if (sec.lessPhotosButton !== undefined && sec.lessPhotosButton !== null) {
      validateV1LocalizedString(sec.lessPhotosButton, `sections.${secKey}.lessPhotosButton`);
    }

    if (sec.moreVideosButton !== undefined && sec.moreVideosButton !== null) {
      validateV1LocalizedString(sec.moreVideosButton, `sections.${secKey}.moreVideosButton`);
    }

    if (sec.lessVideosButton !== undefined && sec.lessVideosButton !== null) {
      validateV1LocalizedString(sec.lessVideosButton, `sections.${secKey}.lessVideosButton`);
    }

    // backButton in V1 must be a valid LocalizedString if present; cannot be null or non-object
    if (sec.backButton !== undefined) {
      validateV1LocalizedString(sec.backButton, `sections.${secKey}.backButton`);
    }

    if (sec.status !== undefined && sec.status !== null) {
      if (sec.status !== "draft" && sec.status !== "published") {
        throw new Error(`sections.${secKey}.status doit valoir 'draft' ou 'published'`);
      }
    }

    if (sec.order !== undefined && sec.order !== null) {
      if (typeof sec.order !== "number" || sec.order < 0) {
        throw new Error(`sections.${secKey}.order doit être un entier positif`);
      }
    }

    if (sec.slugFr !== undefined && sec.slugFr !== null) {
      if (typeof sec.slugFr !== "string" || !SLUG_REGEX.test(sec.slugFr)) {
        throw new Error(`sections.${secKey}.slugFr a un format invalide`);
      }
    }

    if (sec.slugEn !== undefined && sec.slugEn !== null) {
      if (typeof sec.slugEn !== "string" || !SLUG_REGEX.test(sec.slugEn)) {
        throw new Error(`sections.${secKey}.slugEn a un format invalide`);
      }
    }

    if (sec.slugAliases !== undefined && sec.slugAliases !== null) {
      if (!isObject(sec.slugAliases)) {
        throw new Error(`sections.${secKey}.slugAliases doit être un objet { fr, en }`);
      }
      const aliases = sec.slugAliases as Record<string, unknown>;
      if (!Array.isArray(aliases.fr) || !Array.isArray(aliases.en)) {
        throw new Error(`sections.${secKey}.slugAliases doit contenir des tableaux fr et en`);
      }
    }
  }

  const oldSectionsRaw = obj.sections as Record<string, unknown>;
  for (const [secKey, secVal] of Object.entries(oldSectionsRaw)) {
    validateV1Section(secKey, secVal);
  }

  // Schema V1 migration
  const categories: PortfolioCategoryItem[] = [];
  const oldSections = obj.sections as Record<string, Partial<PortfolioCategoryItem>>;

  // 1. Documentary
  if (oldSections.documentary) {
    const doc = oldSections.documentary;
    categories.push({
      id: "documentary",
      slugFr: doc.slugFr || "documentaire",
      slugEn: doc.slugEn || "documentary",
      slugAliases: doc.slugAliases || { fr: [], en: [] },
      order: typeof doc.order === "number" ? doc.order : 0,
      status: doc.status || "published",
      title: doc.title as LocalizedString,
      intro: doc.intro as LocalizedString,
      entrySummary: doc.entrySummary || doc.intro,
      entrySide: doc.entrySide || "left",
      seo: doc.seo as PortfolioCategoryItem["seo"],
      coverImageId: doc.coverImageId ?? null,
      coverAlt: doc.coverAlt || { fr: "Bannière documentaire", en: "Documentary banner" },
      entryImageId: doc.entryImageId ?? null,
      entryAlt: doc.entryAlt || doc.coverAlt || { fr: "Visuel documentaire", en: "Documentary visual" },
      bannerImageId: doc.bannerImageId ?? null,
      bannerAlt: doc.bannerAlt || doc.coverAlt || { fr: "Bannière documentaire", en: "Documentary banner" },
      showreelTitle: doc.showreelTitle || { fr: "Showreel documentaire", en: "Documentary showreel" },
      showreelVideo: doc.showreelVideo ?? null,
      showreelCoverImageId: doc.showreelCoverImageId ?? null,
      morePhotosButton: doc.morePhotosButton || { fr: "Voir plus de photos", en: "See more photos" },
      lessPhotosButton: doc.lessPhotosButton || { fr: "Voir moins", en: "See less" },
      moreVideosButton: doc.moreVideosButton || { fr: "Voir plus de vidéos", en: "See more videos" },
      lessVideosButton: doc.lessVideosButton || { fr: "Voir moins de vidéos", en: "See less videos" },
      backButton: doc.backButton || { fr: "Retour aux projets", en: "Back to projects" },
    });
  }

  // 2. Advertising
  if (oldSections.advertising) {
    const ad = oldSections.advertising;
    categories.push({
      id: "advertising",
      slugFr: ad.slugFr || "publicite",
      slugEn: ad.slugEn || "advertising",
      slugAliases: ad.slugAliases || { fr: [], en: [] },
      order: typeof ad.order === "number" ? ad.order : categories.length,
      status: ad.status || "published",
      title: ad.title as LocalizedString,
      intro: ad.intro as LocalizedString,
      entrySummary: ad.entrySummary || ad.intro,
      entrySide: ad.entrySide || "right",
      seo: ad.seo as PortfolioCategoryItem["seo"],
      coverImageId: ad.coverImageId ?? null,
      coverAlt: ad.coverAlt || { fr: "Bannière publicité", en: "Advertising banner" },
      entryImageId: ad.entryImageId ?? null,
      entryAlt: ad.entryAlt || ad.coverAlt || { fr: "Visuel publicité", en: "Advertising visual" },
      bannerImageId: ad.bannerImageId ?? null,
      bannerAlt: ad.bannerAlt || ad.coverAlt || { fr: "Bannière publicité", en: "Advertising banner" },
      showreelTitle: ad.showreelTitle || { fr: "Showreel publicité", en: "Advertising showreel" },
      showreelVideo: ad.showreelVideo ?? null,
      showreelCoverImageId: ad.showreelCoverImageId ?? null,
      morePhotosButton: ad.morePhotosButton || { fr: "Voir plus de photos", en: "See more photos" },
      lessPhotosButton: ad.lessPhotosButton || { fr: "Voir moins", en: "See less" },
      moreVideosButton: ad.moreVideosButton || { fr: "Voir plus de vidéos", en: "See more videos" },
      lessVideosButton: ad.lessVideosButton || { fr: "Voir moins de vidéos", en: "See less videos" },
      backButton: ad.backButton || { fr: "Retour aux projets", en: "Back to projects" },
    });
  }

  // 3. Any additional custom sections
  for (const [key, sec] of Object.entries(oldSections)) {
    if (key === "documentary" || key === "advertising") continue;
    if (sec && typeof sec === "object") {
      categories.push({
        id: sec.id || key,
        slugFr: sec.slugFr || slugify(sec.title?.fr || key),
        slugEn: sec.slugEn || slugify(sec.title?.en || key),
        slugAliases: sec.slugAliases || { fr: [], en: [] },
        order: typeof sec.order === "number" ? sec.order : categories.length,
        status: sec.status || "published",
        title: sec.title as LocalizedString,
        intro: sec.intro as LocalizedString,
        entrySummary: sec.entrySummary,
        entrySide: sec.entrySide || "auto",
        seo: sec.seo as PortfolioCategoryItem["seo"],
        coverImageId: sec.coverImageId ?? null,
        coverAlt: sec.coverAlt,
        entryImageId: sec.entryImageId ?? null,
        entryAlt: sec.entryAlt,
        bannerImageId: sec.bannerImageId ?? null,
        bannerAlt: sec.bannerAlt,
        showreelTitle: sec.showreelTitle || { fr: `Showreel ${key}`, en: `${key} showreel` },
        showreelVideo: sec.showreelVideo ?? null,
        showreelCoverImageId: sec.showreelCoverImageId ?? null,
        morePhotosButton: sec.morePhotosButton || { fr: "Voir plus de photos", en: "See more photos" },
        lessPhotosButton: sec.lessPhotosButton || { fr: "Voir moins", en: "See less" },
        moreVideosButton: sec.moreVideosButton || { fr: "Voir plus de vidéos", en: "See more videos" },
        lessVideosButton: sec.lessVideosButton || { fr: "Voir moins de vidéos", en: "See less videos" },
        backButton: sec.backButton || { fr: "Retour aux projets", en: "Back to projects" },
      });
    }
  }

  const sections: Record<string, PortfolioCategoryItem> = {};
  for (const c of categories) {
    sections[c.id] = c;
  }

  const projects = obj.projects as PortfolioProject[];
  const media = (obj.media !== undefined ? obj.media : {}) as Record<string, PortfolioMediaItem>;
  const overview = obj.overview as unknown as PortfolioOverview;

  return {
    schemaVersion: 2,
    revision: typeof obj.revision === "string" ? obj.revision : "rev-" + Date.now().toString(36),
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
    overview,
    categories,
    sections,
    projects,
    media,
  };
}

/**
 * Pure domain validation wrapper delegating directly to the canonical portfolio schema.
 */
export function validatePortfolioContentDocument(val: unknown): {
  success: true;
  data: PortfolioContent;
} | {
  success: false;
  reason: string;
  error?: string;
} {
  const result = portfolioContentSchema.safeParse(val);
  if (!result.success) {
    const isVersion = result.error.errors.some((e) => e.path[0] === "schemaVersion");
    return {
      success: false,
      reason: isVersion ? "unsupported_version" : "invalid_schema",
      error: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    };
  }
  return { success: true, data: result.data };
}

// ============================================================================
// CANONICAL SITE CONTENT DOMAIN MODEL & VALIDATOR
// ============================================================================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function assertObject(val: unknown, context: string): Record<string, unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    throw new ValidationError(`${context} doit être un objet.`);
  }
  return val as Record<string, unknown>;
}

export function assertExactKeys(obj: Record<string, unknown>, allowedKeys: string[], context: string): void {
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (!allowedKeys.includes(k)) {
      throw new ValidationError(`Propriété inconnue '${k}' dans ${context}.`);
    }
  }
}

export type AllowedStaticImageId =
  | "index-showreel"
  | "index-duo"
  | "studio-ludovic"
  | "studio-maxime"
  | "logo-parallax"
  | "logo-sempra";

export type AllowedImageId = AllowedStaticImageId | string;

export const ALLOWED_IMAGE_MAP: Record<AllowedStaticImageId, string> = {
  "index-showreel": "/img/index-36b7cd6c87.jpg",
  "index-duo": "/img/index-0ff090a6e4.jpg",
  "studio-ludovic": "/img/studio-d0f3184629.jpg",
  "studio-maxime": "/img/studio-b4c530c5ae.jpg",
  "logo-parallax": "/img/logo-parallax.png",
  "logo-sempra": "/img/img-73c121e112.png",
};

export type AdminUploadLocation =
  | "showreel_cover"
  | "duo"
  | "portrait_ludovic"
  | "portrait_maxime";

export const ADMIN_UPLOAD_LOCATIONS: readonly AdminUploadLocation[] = [
  "showreel_cover",
  "duo",
  "portrait_ludovic",
  "portrait_maxime",
] as const;

export const DEFAULT_LOCATION_IMAGES: Record<AdminUploadLocation, AllowedStaticImageId> = {
  showreel_cover: "index-showreel",
  duo: "index-duo",
  portrait_ludovic: "studio-ludovic",
  portrait_maxime: "studio-maxime",
};

export interface MediaVariantInfo {
  name: "640p" | "960p" | "1440p" | "1920p";
  width: number;
  height: number;
  sizeBytesWebp: number;
  sizeBytesAvif: number;
  fileId: string;
}

export interface UploadedMediaMetadata {
  imageId: string;
  location: AdminUploadLocation;
  originalWidth: number;
  originalHeight: number;
  variants: MediaVariantInfo[];
  createdAt: string;
}

export interface CommonContent {
  brandName: string;
  navigation: {
    portfolio: LocalizedString;
    studio: LocalizedString;
    contact: LocalizedString;
    sempra: LocalizedString;
    clientArea: LocalizedString;
  };
  footer: {
    copyright: LocalizedString;
    legalNotice: LocalizedString;
    privacy: LocalizedString;
    terms: LocalizedString;
    cookies: LocalizedString;
  };
}

export interface HomeContent {
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  hero: {
    badge: LocalizedString;
    title: LocalizedString;
    subtitle: LocalizedString;
  };
  showreel: {
    title: LocalizedString;
    coverImageId: AllowedImageId;
    coverImageAlt: LocalizedString;
    videoUrl: string;
  };
  duo: {
    title: LocalizedString;
    text: LocalizedString;
    imageId: AllowedImageId;
    imageAlt: LocalizedString;
  };
  savoirFaire: {
    title: LocalizedString;
    photoTitle: LocalizedString;
    photoItems: LocalizedString[];
    videoTitle: LocalizedString;
    videoItems: LocalizedString[];
  };
  contact: {
    title: LocalizedString;
    emailLabel: LocalizedString;
    email: string;
    socialLabel: LocalizedString;
    instagramUrl: string;
    youtubeUrl: string;
  };
  sempra: {
    badge: LocalizedString;
    title: LocalizedString;
    buttonText: LocalizedString;
    buttonUrl: string;
  };
}

export interface ValidateHomeOptions {
  isLegacy?: boolean;
}

export interface StudioMember {
  id: string;
  name: string;
  role: LocalizedString;
  imageId: AllowedImageId;
  imageAlt: LocalizedString;
}

export interface StudioContent {
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  hero: {
    title: LocalizedString;
    text: LocalizedString;
  };
  team: {
    title: LocalizedString;
    members: StudioMember[];
  };
  approach: {
    title: LocalizedString;
    headline: LocalizedString;
    text: LocalizedString;
  };
}

export interface ProjectTypeOption {
  id: string;
  enabled: boolean;
  label: LocalizedString;
}

export interface ContactPageContent {
  seo: {
    title: LocalizedString;
    description: LocalizedString;
  };
  hero: {
    title: LocalizedString;
    subtitle?: LocalizedString;
  };
  form: {
    nameLabel: LocalizedString;
    namePlaceholder: LocalizedString;
    emailLabel: LocalizedString;
    emailPlaceholder: LocalizedString;
    phoneLabel: LocalizedString;
    phonePlaceholder: LocalizedString;
    timelineLabel: LocalizedString;
    timelinePlaceholder: LocalizedString;
    typeLabel: LocalizedString;
    typePlaceholder: LocalizedString;
    projectTypes: ProjectTypeOption[];
    messageLabel: LocalizedString;
    messagePlaceholder: LocalizedString;
    submitButton: LocalizedString;
    noticeText: LocalizedString;
    privacyPolicyText: LocalizedString;
    privacyPolicyUrl: string;
  };
  card: {
    title: LocalizedString;
    emailLabel: LocalizedString;
    phoneLabel: LocalizedString;
    phone: string;
    socialLabel: LocalizedString;
    responseTimeNotice: LocalizedString;
  };
  messages: {
    successTitle: LocalizedString;
    successMessage: LocalizedString;
    unavailableMessage: LocalizedString;
    genericError: LocalizedString;
    errorSummary?: LocalizedString;
    nameRequired?: LocalizedString;
    nameTooLong?: LocalizedString;
    emailRequired?: LocalizedString;
    emailInvalid?: LocalizedString;
    phoneInvalid?: LocalizedString;
    timelineInvalid?: LocalizedString;
    typeRequired?: LocalizedString;
    messageRequired?: LocalizedString;
    messageTooLong?: LocalizedString;
    sessionExpired?: LocalizedString;
    rateLimit?: LocalizedString;
    inProgress?: LocalizedString;
    uncertain?: LocalizedString;
    conflict?: LocalizedString;
    [key: string]: LocalizedString | undefined;
  };
}

export const DEFAULT_PROJECT_TYPES: readonly ProjectTypeOption[] = [
  {
    id: "music-video",
    enabled: true,
    label: { fr: "Clip musical", en: "Music video" },
  },
  {
    id: "advertising",
    enabled: true,
    label: { fr: "Publicité", en: "Advertising" },
  },
  {
    id: "portrait",
    enabled: true,
    label: { fr: "Portrait", en: "Portrait" },
  },
  {
    id: "documentary",
    enabled: true,
    label: { fr: "Documentaire", en: "Documentary" },
  },
  {
    id: "other",
    enabled: true,
    label: { fr: "Autre", en: "Other" },
  },
] as const;

export const DEFAULT_CONTACT_PAGE_MESSAGES = {
  successTitle: {
    fr: "Message envoyé avec succès",
    en: "Message sent successfully",
  },
  successMessage: {
    fr: "Merci pour votre message. Nous reviendrons vers vous dans les meilleurs délais.",
    en: "Thank you for your message. We will get back to you as soon as possible.",
  },
  unavailableMessage: {
    fr: "Le formulaire de contact est temporairement indisponible. Veuillez nous écrire directement par e-mail.",
    en: "The contact form is temporarily unavailable. Please write to us directly by email.",
  },
  genericError: {
    fr: "Une erreur est survenue lors de l'envoi de votre message. Veuillez vérifier vos informations et réessayer.",
    en: "An error occurred while sending your message. Please check your information and try again.",
  },
  errorSummary: {
    fr: "Veuillez corriger les erreurs ci-dessous.",
    en: "Please correct the errors below.",
  },
  nameRequired: {
    fr: "Le nom ou la raison sociale est obligatoire.",
    en: "Name or company is required.",
  },
  nameTooLong: {
    fr: "Le nom ne doit pas dépasser 100 caractères.",
    en: "Name cannot exceed 100 characters.",
  },
  emailRequired: {
    fr: "L'adresse email est obligatoire.",
    en: "Email address is required.",
  },
  emailInvalid: {
    fr: "L'adresse email est invalide.",
    en: "Email address is invalid.",
  },
  phoneInvalid: {
    fr: "Le format du numéro de téléphone est invalide.",
    en: "Phone number format is invalid.",
  },
  timelineInvalid: {
    fr: "Veuillez sélectionner une date de calendrier valide (AAAA-MM-JJ).",
    en: "Please select a valid calendar date (YYYY-MM-DD).",
  },
  typeRequired: {
    fr: "Veuillez sélectionner un type de projet valide.",
    en: "Please select a valid project type.",
  },
  messageRequired: {
    fr: "Le message est obligatoire.",
    en: "Message is required.",
  },
  messageTooLong: {
    fr: "Le message ne doit pas dépasser 5 000 caractères.",
    en: "Message cannot exceed 5,000 characters.",
  },
  sessionExpired: {
    fr: "Votre session de formulaire a expiré ou n'est plus valide. Veuillez recharger la page.",
    en: "Your form session has expired or is invalid. Please reload the page.",
  },
  rateLimit: {
    fr: "Trop de tentatives. Veuillez réessayer dans {seconds} secondes.",
    en: "Too many attempts. Please try again in {seconds} seconds.",
  },
  inProgress: {
    fr: "Un envoi identique est déjà en cours de traitement. Veuillez patienter.",
    en: "A matching submission is already being processed. Please wait.",
  },
  uncertain: {
    fr: "Le statut de transmission de votre message n'a pas pu être confirmé en raison d'un délai de communication. Pour éviter tout doublon, veuillez patienter quelques instants avant de renouveler votre demande.",
    en: "The transmission status of your message could not be confirmed due to a connection timeout. To prevent duplicates, please wait a moment before trying again.",
  },
  conflict: {
    fr: "Ce jeton de formulaire a déjà été utilisé avec un contenu différent. Veuillez rafraîchir la page pour une nouvelle soumission.",
    en: "This form session was already submitted with different content. Please refresh the page to submit a new message.",
  },
} as const;

export const DEFAULT_CONTACT_PAGE_CONTENT: ContactPageContent = {
  seo: {
    title: {
      fr: "Contact | Parallax - Studio photo & vidéo",
      en: "Contact | Parallax - Photo & video studio",
    },
    description: {
      fr: "Contactez le studio Parallax pour vos projets photo et vidéo. Clips musicaux, publicités, portraits et documentaires.",
      en: "Contact Parallax studio for your photo and video projects. Music videos, commercials, portraits and documentaries.",
    },
  },
  hero: {
    title: {
      fr: "Vous préférez écrire ? Remplissez le formulaire ci-dessous.",
      en: "Prefer to write? Fill in the form below.",
    },
  },
  form: {
    nameLabel: { fr: "Nom / société", en: "Name / company" },
    namePlaceholder: { fr: "Studio, marque, artiste…", en: "Studio, brand, artist…" },
    emailLabel: { fr: "Email", en: "Email" },
    emailPlaceholder: { fr: "vous@exemple.com", en: "you@example.com" },
    phoneLabel: { fr: "Téléphone (optionnel)", en: "Phone (optional)" },
    phonePlaceholder: { fr: "04XX XX XX XX", en: "04XX XX XX XX" },
    timelineLabel: { fr: "Échéance souhaitée", en: "Preferred timeline" },
    timelinePlaceholder: { fr: "AAAA-MM-JJ", en: "YYYY-MM-DD" },
    typeLabel: { fr: "Type de projet", en: "Project type" },
    typePlaceholder: { fr: "Sélectionner…", en: "Select…" },
    projectTypes: [...DEFAULT_PROJECT_TYPES],
    messageLabel: { fr: "Votre message", en: "Your message" },
    messagePlaceholder: { fr: "Racontez-nous votre projet…", en: "Tell us about your project…" },
    submitButton: { fr: "Envoyer", en: "Send" },
    noticeText: {
      fr: "Les informations transmises servent uniquement à répondre à votre demande et préparer une éventuelle prestation.",
      en: "The information you provide is used only to answer your request and prepare a possible project.",
    },
    privacyPolicyText: {
      fr: "Politique de confidentialité",
      en: "Privacy policy",
    },
    privacyPolicyUrl: "",
  },
  card: {
    title: { fr: "Coordonnées", en: "Details" },
    emailLabel: { fr: "Email", en: "Email" },
    phoneLabel: { fr: "Téléphone", en: "Phone" },
    phone: "",
    socialLabel: { fr: "Réseaux", en: "Social" },
    responseTimeNotice: {
      fr: "Nous répondons sous 48h.",
      en: "We reply within 48h.",
    },
  },
  messages: {
    ...DEFAULT_CONTACT_PAGE_MESSAGES,
  },
};

export type LegalPersonalityType = "natural_person" | "legal_entity" | "unincorporated_association" | "";
export type VatRegimeType = "standard" | "small_business_exemption" | "non_subject" | "other" | "";

export interface CompanyContent {
  tradeName: string;
  legalName: string;
  legalForm: string;
  legalPersonality?: LegalPersonalityType;
  address: string;
  enterpriseNumber: string;
  vatNumber: string;
  vatRegime?: string;
  vatRegimeType?: VatRegimeType;
  rpmJurisdiction?: string;
  publicationDirector: string;
  privacyContact: string;
  privacyEmail?: string;
  dpoDesignated?: boolean;
  dpoContact?: string;
  hostingProvider: string;
  hostingAddress: string;
  hostingCountry?: string;
  emailService?: string;
  galleryStorageService?: string;
  retentionContactRequests?: string;
  retentionClientRecords?: string;
  retentionMediaGalleries?: string;
  clientTypes?: "b2b" | "b2c" | "both" | "";
  phone: string;
  email: string;
  instagramUrl: string;
  youtubeUrl: string;
  isPublished: boolean;
}

export const DEFAULT_COMPANY_CONTENT: CompanyContent = {
  tradeName: "Parallax",
  legalName: "Parallax Studio SRL",
  legalForm: "Société à Responsabilité Limitée (SRL)",
  legalPersonality: "legal_entity",
  address: "Rue du Cinéma 42, 1000 Bruxelles, Belgique",
  enterpriseNumber: "BE 0123.456.789",
  vatNumber: "BE0123456789",
  vatRegime: "Franchise de taxe pour petites entreprises",
  vatRegimeType: "small_business_exemption",
  rpmJurisdiction: "RPM Bruxelles",
  publicationDirector: "Ludovic & Maxime",
  privacyContact: "Ludovic & Maxime",
  privacyEmail: "privacy@parallax.be",
  dpoDesignated: false,
  dpoContact: "",
  hostingProvider: "Vercel Inc.",
  hostingAddress: "440 N Barranca Ave #4133, Covina, CA 91723, États-Unis",
  hostingCountry: "États-Unis",
  emailService: "Resend",
  galleryStorageService: "Cloudflare R2",
  retentionContactRequests: "3 ans à compter du dernier contact",
  retentionClientRecords: "10 ans (obligations légales comptables)",
  retentionMediaGalleries: "1 an après la livraison finale",
  clientTypes: "both",
  phone: "+32 470 12 34 56",
  email: "contact@parallax.be",
  instagramUrl: "https://instagram.com/parallax",
  youtubeUrl: "https://youtube.com/@parallax",
  isPublished: false,
};

export type LegalPageKey = "mentions" | "privacy" | "terms" | "cookies";
export const LEGAL_PAGE_KEYS: readonly LegalPageKey[] = ["mentions", "privacy", "terms", "cookies"] as const;

export interface LegalSection {
  id: string;
  title: LocalizedString;
  paragraphs: LocalizedString[];
  listItems?: LocalizedString[];
}

export interface CookieInventoryItem {
  id: string;
  name: LocalizedString;
  provider: LocalizedString;
  category: "technical" | "preferences";
  purpose: LocalizedString;
  duration: LocalizedString;
  exemptionJustification?: LocalizedString;
}

export interface LegalDocument {
  seoTitle: LocalizedString;
  seoDescription: LocalizedString;
  publicTitle: LocalizedString;
  intro: LocalizedString;
  effectiveDate: string;
  version: number;
  sections: LegalSection[];
  inventory?: CookieInventoryItem[];
}

export interface LegalPageRecord {
  draft: LegalDocument;
  published: LegalDocument | null;
  lastUpdated: string;
}

export type LegalPagesContent = Record<LegalPageKey, LegalPageRecord>;

export const DEFAULT_LEGAL_PAGES_CONTENT: LegalPagesContent = {
  mentions: {
    draft: {
      seoTitle: { fr: "Mentions Légales | Parallax", en: "Legal Notice | Parallax" },
      seoDescription: { fr: "Mentions légales et informations de l'éditeur de Parallax.", en: "Legal notice and editor information for Parallax." },
      publicTitle: { fr: "Mentions Légales", en: "Legal Notice" },
      intro: { fr: "Informations légales relatives au site internet Parallax.", en: "Legal information regarding the Parallax website." },
      effectiveDate: "2026-10-18",
      version: 1,
      sections: [
        {
          id: "editor",
          title: { fr: "1. Éditeur du site", en: "1. Website Publisher" },
          paragraphs: [
            {
              fr: "Le site est édité par {{company.legalOperatorText}}, établi à {{company.address}}, inscrit sous le numéro BCE {{company.enterpriseNumber}}, numéro de TVA intracommunautaire : {{company.vatNumber}}.",
              en: "The website is published by {{company.legalOperatorText}}, located at {{company.address}}, registered under company number {{company.enterpriseNumber}}, intra-community VAT number: {{company.vatNumber}}.",
            },
            {
              fr: "RPM compétent : {{company.rpmJurisdiction}}.",
              en: "Competent registry: {{company.rpmJurisdiction}}.",
            },
          ],
        },
      ],
    },
    published: null,
    lastUpdated: "2026-10-18T12:00:00.000Z",
  },
  privacy: {
    draft: {
      seoTitle: { fr: "Politique de Confidentialité | Parallax", en: "Privacy Policy | Parallax" },
      seoDescription: { fr: "Politique de protection des données personnelles de Parallax.", en: "Personal data protection policy of Parallax." },
      publicTitle: { fr: "Politique de Confidentialité", en: "Privacy Policy" },
      intro: { fr: "Protection et traitement de vos données personnelles.", en: "Protection and processing of your personal data." },
      effectiveDate: "2026-10-18",
      version: 1,
      sections: [],
    },
    published: null,
    lastUpdated: "2026-10-18T12:00:00.000Z",
  },
  terms: {
    draft: {
      seoTitle: { fr: "Conditions Générales | Parallax", en: "Terms and Conditions | Parallax" },
      seoDescription: { fr: "Conditions générales d'utilisation et de prestation de Parallax.", en: "Terms and conditions of Parallax services." },
      publicTitle: { fr: "Conditions Générales", en: "Terms and Conditions" },
      intro: { fr: "Conditions régissant les prestations de services audiovisuels de Parallax.", en: "Terms governing audiovisual services provided by Parallax." },
      effectiveDate: "2026-10-18",
      version: 1,
      sections: [],
    },
    published: null,
    lastUpdated: "2026-10-18T12:00:00.000Z",
  },
  cookies: {
    draft: {
      seoTitle: { fr: "Politique des Cookies | Parallax", en: "Cookie Policy | Parallax" },
      seoDescription: { fr: "Informations sur l'utilisation des cookies sur le site Parallax.", en: "Information about cookie usage on Parallax website." },
      publicTitle: { fr: "Politique des Cookies", en: "Cookie Policy" },
      intro: { fr: "Gestion et inventaire des traceurs et cookies utilisés.", en: "Management and inventory of trackers and cookies used." },
      effectiveDate: "2026-10-18",
      version: 1,
      sections: [],
      inventory: [
        {
          id: "session_id",
          name: { fr: "Cookie de session", en: "Session Cookie" },
          provider: { fr: "Parallax", en: "Parallax" },
          category: "technical",
          purpose: { fr: "Maintien de la session d'administration", en: "Maintenance of admin session" },
          duration: { fr: "Session (fermeture du navigateur)", en: "Session (browser close)" },
          exemptionJustification: { fr: "Strictement nécessaire au fonctionnement du service", en: "Strictly necessary for service operation" },
        },
      ],
    },
    published: null,
    lastUpdated: "2026-10-18T12:00:00.000Z",
  },
};

export interface SiteContentV1 {
  schemaVersion?: 1;
  revision: string;
  updatedAt: string;
  common: CommonContent;
  home: HomeContent;
  studio: StudioContent;
  media?: Record<string, UploadedMediaMetadata>;
}

export interface SiteContentV2 {
  schemaVersion: 2;
  revision: string;
  updatedAt: string;
  common: CommonContent;
  home: HomeContent;
  studio: StudioContent;
  contactPage: ContactPageContent;
  media?: Record<string, UploadedMediaMetadata>;
}

export interface SiteContent {
  schemaVersion: 3;
  revision: string;
  updatedAt: string;
  common: CommonContent;
  home: HomeContent;
  studio: StudioContent;
  contactPage: ContactPageContent;
  company: CompanyContent;
  legalPages: LegalPagesContent;
  media?: Record<string, UploadedMediaMetadata>;
}

export function validateLocalizedString(val: unknown, context: string): LocalizedString {
  const obj = assertObject(val, context);
  assertExactKeys(obj, ["fr", "en"], context);
  if (typeof obj.fr !== "string") {
    throw new ValidationError(`${context}.fr doit être une chaîne de caractères.`);
  }
  if (typeof obj.en !== "string") {
    throw new ValidationError(`${context}.en doit être une chaîne de caractères.`);
  }
  return {
    fr: obj.fr,
    en: obj.en,
  };
}

export function validateAllowedImageId(val: unknown, context: string): AllowedImageId {
  if (typeof val !== "string") {
    throw new ValidationError(`${context} doit être une chaîne de caractères.`);
  }
  if (val in ALLOWED_IMAGE_MAP) {
    return val;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
    return val.toLowerCase();
  }
  throw new ValidationError(
    `${context} doit être un identifiant d'image valide (${Object.keys(ALLOWED_IMAGE_MAP).join(", ")}) ou un identifiant média UUID valide. Reçu: ${String(val)}`
  );
}

export function validateMediaVariantInfo(val: unknown, context: string): MediaVariantInfo {
  const obj = assertObject(val, context);
  assertExactKeys(obj, ["name", "width", "height", "sizeBytesWebp", "sizeBytesAvif", "fileId"], context);
  if (!["640p", "960p", "1440p", "1920p"].includes(obj.name as string)) {
    throw new ValidationError(`${context}.name doit être une variante valide (640p, 960p, 1440p, 1920p).`);
  }
  if (typeof obj.width !== "number" || obj.width <= 0) {
    throw new ValidationError(`${context}.width doit être un nombre positif.`);
  }
  if (typeof obj.height !== "number" || obj.height <= 0) {
    throw new ValidationError(`${context}.height doit être un nombre positif.`);
  }
  if (typeof obj.sizeBytesWebp !== "number" || obj.sizeBytesWebp <= 0) {
    throw new ValidationError(`${context}.sizeBytesWebp doit être un nombre positif.`);
  }
  if (typeof obj.sizeBytesAvif !== "number" || obj.sizeBytesAvif <= 0) {
    throw new ValidationError(`${context}.sizeBytesAvif doit être un nombre positif.`);
  }
  if (typeof obj.fileId !== "string" || !obj.fileId.trim()) {
    throw new ValidationError(`${context}.fileId doit être une chaîne non vide.`);
  }
  return {
    name: obj.name as "640p" | "960p" | "1440p" | "1920p",
    width: obj.width,
    height: obj.height,
    sizeBytesWebp: obj.sizeBytesWebp,
    sizeBytesAvif: obj.sizeBytesAvif,
    fileId: obj.fileId,
  };
}

export function validateUploadedMediaMetadata(val: unknown, context: string): UploadedMediaMetadata {
  const obj = assertObject(val, context);
  assertExactKeys(obj, ["imageId", "location", "originalWidth", "originalHeight", "variants", "createdAt"], context);
  if (
    typeof obj.imageId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj.imageId)
  ) {
    throw new ValidationError(`${context}.imageId doit être un UUID valide.`);
  }
  if (!ADMIN_UPLOAD_LOCATIONS.includes(obj.location as AdminUploadLocation)) {
    throw new ValidationError(
      `${context}.location doit être un emplacement valide (${ADMIN_UPLOAD_LOCATIONS.join(", ")}).`
    );
  }
  if (typeof obj.originalWidth !== "number" || obj.originalWidth <= 0) {
    throw new ValidationError(`${context}.originalWidth doit être un nombre positif.`);
  }
  if (typeof obj.originalHeight !== "number" || obj.originalHeight <= 0) {
    throw new ValidationError(`${context}.originalHeight doit être un nombre positif.`);
  }
  if (!Array.isArray(obj.variants) || obj.variants.length === 0) {
    throw new ValidationError(`${context}.variants doit être une liste non vide.`);
  }
  const variants = obj.variants.map((v, i) => validateMediaVariantInfo(v, `${context}.variants[${i}]`));
  if (typeof obj.createdAt !== "string") {
    throw new ValidationError(`${context}.createdAt doit être une chaîne ISO.`);
  }
  return {
    imageId: obj.imageId.toLowerCase(),
    location: obj.location as AdminUploadLocation,
    originalWidth: obj.originalWidth,
    originalHeight: obj.originalHeight,
    variants,
    createdAt: obj.createdAt,
  };
}

export function validateCommonContent(val: unknown): CommonContent {
  const obj = assertObject(val, "common");
  assertExactKeys(obj, ["brandName", "navigation", "footer"], "common");

  if (typeof obj.brandName !== "string" || !obj.brandName.trim()) {
    throw new ValidationError("common.brandName doit être une chaîne non vide.");
  }

  const nav = assertObject(obj.navigation, "common.navigation");
  assertExactKeys(nav, ["portfolio", "studio", "contact", "sempra", "clientArea"], "common.navigation");

  const footer = assertObject(obj.footer, "common.footer");
  assertExactKeys(footer, ["copyright", "legalNotice", "privacy", "terms", "cookies"], "common.footer");

  return {
    brandName: obj.brandName,
    navigation: {
      portfolio: validateLocalizedString(nav.portfolio, "common.navigation.portfolio"),
      studio: validateLocalizedString(nav.studio, "common.navigation.studio"),
      contact: validateLocalizedString(nav.contact, "common.navigation.contact"),
      sempra: validateLocalizedString(nav.sempra, "common.navigation.sempra"),
      clientArea: validateLocalizedString(nav.clientArea, "common.navigation.clientArea"),
    },
    footer: {
      copyright: validateLocalizedString(footer.copyright, "common.footer.copyright"),
      legalNotice: validateLocalizedString(footer.legalNotice, "common.footer.legalNotice"),
      privacy: validateLocalizedString(footer.privacy, "common.footer.privacy"),
      terms: validateLocalizedString(footer.terms, "common.footer.terms"),
      cookies: validateLocalizedString(footer.cookies, "common.footer.cookies"),
    },
  };
}

export function validateHomeContent(val: unknown, options?: ValidateHomeOptions): HomeContent {
  const obj = assertObject(val, "home");
  assertExactKeys(obj, ["seo", "hero", "showreel", "duo", "savoirFaire", "contact", "sempra"], "home");

  const seo = assertObject(obj.seo, "home.seo");
  assertExactKeys(seo, ["title", "description"], "home.seo");

  const hero = assertObject(obj.hero, "home.hero");
  assertExactKeys(hero, ["badge", "title", "subtitle"], "home.hero");

  const showreel = assertObject(obj.showreel, "home.showreel");
  assertExactKeys(showreel, ["title", "coverImageId", "coverImageAlt", "videoUrl"], "home.showreel");
  if (typeof showreel.videoUrl !== "string") {
    throw new ValidationError("home.showreel.videoUrl doit être une chaîne.");
  }

  const duo = assertObject(obj.duo, "home.duo");
  assertExactKeys(duo, ["title", "text", "imageId", "imageAlt"], "home.duo");

  const sf = assertObject(obj.savoirFaire, "home.savoirFaire");
  assertExactKeys(sf, ["title", "photoTitle", "photoItems", "videoTitle", "videoItems"], "home.savoirFaire");

  if (!Array.isArray(sf.photoItems)) {
    throw new ValidationError("home.savoirFaire.photoItems doit être une liste.");
  }
  if (sf.photoItems.length > 50) {
    throw new ValidationError("home.savoirFaire.photoItems ne peut pas contenir plus de 50 éléments.");
  }
  const photoItems = sf.photoItems.map((item, idx) => {
    const validated = validateLocalizedString(item, `home.savoirFaire.photoItems[${idx}]`);
    if (validated.fr.length > 300 || validated.en.length > 300) {
      throw new ValidationError(`L'élément photo ${idx + 1} ne doit pas dépasser 300 caractères.`);
    }
    return validated;
  });

  if (!Array.isArray(sf.videoItems)) {
    throw new ValidationError("home.savoirFaire.videoItems doit être une liste.");
  }
  if (sf.videoItems.length > 50) {
    throw new ValidationError("home.savoirFaire.videoItems ne peut pas contenir plus de 50 éléments.");
  }
  const videoItems = sf.videoItems.map((item, idx) => {
    const validated = validateLocalizedString(item, `home.savoirFaire.videoItems[${idx}]`);
    if (validated.fr.length > 300 || validated.en.length > 300) {
      throw new ValidationError(`L'élément vidéo ${idx + 1} ne doit pas dépasser 300 caractères.`);
    }
    return validated;
  });

  const contact = assertObject(obj.contact, "home.contact");
  assertExactKeys(contact, ["title", "emailLabel", "email", "socialLabel", "instagramUrl", "youtubeUrl"], "home.contact");
  if (typeof contact.email !== "string") {
    throw new ValidationError("home.contact.email doit être une chaîne.");
  }
  const emailTrim = contact.email.trim();
  if (options?.isLegacy) {
    if (emailTrim && emailTrim !== "#" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      throw new ValidationError("home.contact.email doit être une adresse e-mail valide ou un placeholder historique ('#').");
    }
  } else {
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      throw new ValidationError("home.contact.email doit être une adresse e-mail valide.");
    }
  }

  if (typeof contact.instagramUrl !== "string") {
    throw new ValidationError("home.contact.instagramUrl doit être une chaîne.");
  }
  const igTrim = contact.instagramUrl.trim();
  if (options?.isLegacy) {
    if (igTrim && igTrim !== "#" && !/^https?:\/\//i.test(igTrim)) {
      throw new ValidationError("home.contact.instagramUrl doit être une URL HTTP(S) valide ou un placeholder historique ('#').");
    }
  } else {
    if (igTrim && !/^https?:\/\//i.test(igTrim)) {
      throw new ValidationError("home.contact.instagramUrl doit être une URL HTTP(S) valide.");
    }
  }

  if (typeof contact.youtubeUrl !== "string") {
    throw new ValidationError("home.contact.youtubeUrl doit être une chaîne.");
  }
  const ytTrim = contact.youtubeUrl.trim();
  if (options?.isLegacy) {
    if (ytTrim && ytTrim !== "#" && !/^https?:\/\//i.test(ytTrim)) {
      throw new ValidationError("home.contact.youtubeUrl doit être une URL HTTP(S) valide ou un placeholder historique ('#').");
    }
  } else {
    if (ytTrim && !/^https?:\/\//i.test(ytTrim)) {
      throw new ValidationError("home.contact.youtubeUrl doit être une URL HTTP(S) valide.");
    }
  }

  const sempra = assertObject(obj.sempra, "home.sempra");
  assertExactKeys(sempra, ["badge", "title", "buttonText", "buttonUrl"], "home.sempra");
  if (typeof sempra.buttonUrl !== "string") {
    throw new ValidationError("home.sempra.buttonUrl doit être une chaîne.");
  }
  const trimmedSempraUrl = sempra.buttonUrl.trim();
  if (trimmedSempraUrl && trimmedSempraUrl !== "#") {
    try {
      const parsed = new URL(trimmedSempraUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ValidationError("home.sempra.buttonUrl doit être une URL sécurisée (http: ou https:).");
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError("home.sempra.buttonUrl doit être une URL valide (ex: https://sempra.be/).");
    }
  }

  return {
    seo: {
      title: validateLocalizedString(seo.title, "home.seo.title"),
      description: validateLocalizedString(seo.description, "home.seo.description"),
    },
    hero: {
      badge: validateLocalizedString(hero.badge, "home.hero.badge"),
      title: validateLocalizedString(hero.title, "home.hero.title"),
      subtitle: validateLocalizedString(hero.subtitle, "home.hero.subtitle"),
    },
    showreel: {
      title: validateLocalizedString(showreel.title, "home.showreel.title"),
      coverImageId: validateAllowedImageId(showreel.coverImageId, "home.showreel.coverImageId"),
      coverImageAlt: validateLocalizedString(showreel.coverImageAlt, "home.showreel.coverImageAlt"),
      videoUrl: showreel.videoUrl,
    },
    duo: {
      title: validateLocalizedString(duo.title, "home.duo.title"),
      text: validateLocalizedString(duo.text, "home.duo.text"),
      imageId: validateAllowedImageId(duo.imageId, "home.duo.imageId"),
      imageAlt: validateLocalizedString(duo.imageAlt, "home.duo.imageAlt"),
    },
    savoirFaire: {
      title: validateLocalizedString(sf.title, "home.savoirFaire.title"),
      photoTitle: validateLocalizedString(sf.photoTitle, "home.savoirFaire.photoTitle"),
      photoItems,
      videoTitle: validateLocalizedString(sf.videoTitle, "home.savoirFaire.videoTitle"),
      videoItems,
    },
    contact: {
      title: validateLocalizedString(contact.title, "home.contact.title"),
      emailLabel: validateLocalizedString(contact.emailLabel, "home.contact.emailLabel"),
      email: contact.email,
      socialLabel: validateLocalizedString(contact.socialLabel, "home.contact.socialLabel"),
      instagramUrl: contact.instagramUrl,
      youtubeUrl: contact.youtubeUrl,
    },
    sempra: {
      badge: validateLocalizedString(sempra.badge, "home.sempra.badge"),
      title: validateLocalizedString(sempra.title, "home.sempra.title"),
      buttonText: validateLocalizedString(sempra.buttonText, "home.sempra.buttonText"),
      buttonUrl: sempra.buttonUrl,
    },
  };
}

export function validateStudioMember(val: unknown, context: string): StudioMember {
  const obj = assertObject(val, context);
  assertExactKeys(obj, ["id", "name", "role", "imageId", "imageAlt"], context);
  if (typeof obj.id !== "string" || !obj.id.trim()) {
    throw new ValidationError(`${context}.id doit être une chaîne non vide.`);
  }
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    throw new ValidationError(`${context}.name doit être une chaîne non vide.`);
  }
  return {
    id: obj.id,
    name: obj.name,
    role: validateLocalizedString(obj.role, `${context}.role`),
    imageId: validateAllowedImageId(obj.imageId, `${context}.imageId`),
    imageAlt: validateLocalizedString(obj.imageAlt, `${context}.imageAlt`),
  };
}

export function validateStudioContent(val: unknown): StudioContent {
  const obj = assertObject(val, "studio");
  assertExactKeys(obj, ["seo", "hero", "team", "approach"], "studio");

  const seo = assertObject(obj.seo, "studio.seo");
  assertExactKeys(seo, ["title", "description"], "studio.seo");

  const hero = assertObject(obj.hero, "studio.hero");
  assertExactKeys(hero, ["title", "text"], "studio.hero");

  const team = assertObject(obj.team, "studio.team");
  assertExactKeys(team, ["title", "members"], "studio.team");
  if (!Array.isArray(team.members)) {
    throw new ValidationError("studio.team.members doit être une liste.");
  }
  const members = team.members.map((m, idx) =>
    validateStudioMember(m, `studio.team.members[${idx}]`)
  );

  const approach = assertObject(obj.approach, "studio.approach");
  assertExactKeys(approach, ["title", "headline", "text"], "studio.approach");

  return {
    seo: {
      title: validateLocalizedString(seo.title, "studio.seo.title"),
      description: validateLocalizedString(seo.description, "studio.seo.description"),
    },
    hero: {
      title: validateLocalizedString(hero.title, "studio.hero.title"),
      text: validateLocalizedString(hero.text, "studio.hero.text"),
    },
    team: {
      title: validateLocalizedString(team.title, "studio.team.title"),
      members,
    },
    approach: {
      title: validateLocalizedString(approach.title, "studio.approach.title"),
      headline: validateLocalizedString(approach.headline, "studio.approach.headline"),
      text: validateLocalizedString(approach.text, "studio.approach.text"),
    },
  };
}

export function validateProjectTypeOption(val: unknown, context: string): ProjectTypeOption {
  const obj = assertObject(val, context);
  assertExactKeys(obj, ["id", "enabled", "label"], context);
  if (typeof obj.id !== "string" || !/^[a-z0-9_-]+$/i.test(obj.id)) {
    throw new ValidationError(`${context}.id doit être un identifiant valide (alphanumérique, tirets).`);
  }
  if (typeof obj.enabled !== "boolean") {
    throw new ValidationError(`${context}.enabled doit être un booléen.`);
  }
  return {
    id: obj.id,
    enabled: obj.enabled,
    label: validateLocalizedString(obj.label, `${context}.label`),
  };
}

export interface ValidateContactPageOptions {
  isLegacy?: boolean;
}

export function validateContactPageContent(
  val: unknown,
  options?: ValidateContactPageOptions
): ContactPageContent {
  const obj = assertObject(val, "contactPage");
  assertExactKeys(obj, ["seo", "hero", "form", "card", "messages"], "contactPage");

  const seo = assertObject(obj.seo, "contactPage.seo");
  assertExactKeys(seo, ["title", "description"], "contactPage.seo");

  const hero = assertObject(obj.hero, "contactPage.hero");
  if ("subtitle" in hero && hero.subtitle !== undefined) {
    assertExactKeys(hero, ["title", "subtitle"], "contactPage.hero");
  } else {
    assertExactKeys(hero, ["title"], "contactPage.hero");
  }

  const form = assertObject(obj.form, "contactPage.form");
  assertExactKeys(
    form,
    [
      "nameLabel",
      "namePlaceholder",
      "emailLabel",
      "emailPlaceholder",
      "phoneLabel",
      "phonePlaceholder",
      "timelineLabel",
      "timelinePlaceholder",
      "typeLabel",
      "typePlaceholder",
      "projectTypes",
      "messageLabel",
      "messagePlaceholder",
      "submitButton",
      "noticeText",
      "privacyPolicyText",
      "privacyPolicyUrl",
    ],
    "contactPage.form"
  );

  if (!Array.isArray(form.projectTypes) || form.projectTypes.length === 0) {
    throw new ValidationError("contactPage.form.projectTypes doit être une liste non vide.");
  }
  const projectTypes = form.projectTypes.map((pt, idx) =>
    validateProjectTypeOption(pt, `contactPage.form.projectTypes[${idx}]`)
  );

  if (typeof form.privacyPolicyUrl !== "string") {
    throw new ValidationError("contactPage.form.privacyPolicyUrl doit être une chaîne.");
  }
  const cleanPrivacyUrl = form.privacyPolicyUrl.trim();
  if (cleanPrivacyUrl && !/^(https?:\/\/|\/)/i.test(cleanPrivacyUrl)) {
    throw new ValidationError(
      "contactPage.form.privacyPolicyUrl doit être une URL absolue ou un chemin relatif valide."
    );
  }

  const card = assertObject(obj.card, "contactPage.card");
  assertExactKeys(
    card,
    ["title", "emailLabel", "phoneLabel", "phone", "socialLabel", "responseTimeNotice"],
    "contactPage.card"
  );
  if (typeof card.phone !== "string") {
    throw new ValidationError("contactPage.card.phone doit être une chaîne.");
  }
  const phoneTrim = card.phone.trim();
  if (phoneTrim) {
    if (options?.isLegacy) {
      if (phoneTrim.length > 50 || !/^[+]?[\d\s()./-]{1,50}$/.test(phoneTrim)) {
        throw new ValidationError(
          "contactPage.card.phone doit être un numéro de téléphone ou une valeur historique reconnue."
        );
      }
    } else {
      const digits = phoneTrim.replace(/\D/g, "");
      if (phoneTrim.length > 50 || !/^[+]?[\d\s()./-]{6,50}$/.test(phoneTrim) || digits.length < 6) {
        throw new ValidationError("contactPage.card.phone doit être un numéro de téléphone valide.");
      }
    }
  }

  const messages = assertObject(obj.messages, "contactPage.messages");
  const knownMessageKeys = [
    "successTitle",
    "successMessage",
    "unavailableMessage",
    "genericError",
    "errorSummary",
    "nameRequired",
    "nameTooLong",
    "emailRequired",
    "emailInvalid",
    "phoneInvalid",
    "timelineInvalid",
    "typeRequired",
    "messageRequired",
    "messageTooLong",
    "sessionExpired",
    "rateLimit",
    "inProgress",
    "uncertain",
    "conflict",
  ];
  for (const k of Object.keys(messages)) {
    if (!knownMessageKeys.includes(k)) {
      throw new ValidationError(`contactPage.messages contient une clé inattendue : "${k}".`);
    }
  }

  // Required base messages
  const baseMessages = {
    successTitle: validateLocalizedString(messages.successTitle, "contactPage.messages.successTitle"),
    successMessage: validateLocalizedString(messages.successMessage, "contactPage.messages.successMessage"),
    unavailableMessage: validateLocalizedString(messages.unavailableMessage, "contactPage.messages.unavailableMessage"),
    genericError: validateLocalizedString(messages.genericError, "contactPage.messages.genericError"),
  };

  // Optional customized messages
  const optionalMessages: Record<string, LocalizedString> = {};
  for (const k of knownMessageKeys) {
    if (k in messages && !Object.prototype.hasOwnProperty.call(baseMessages, k)) {
      optionalMessages[k] = validateLocalizedString(messages[k], `contactPage.messages.${k}`);
    }
  }

  const mergedMessages = {
    ...DEFAULT_CONTACT_PAGE_MESSAGES,
    ...baseMessages,
    ...optionalMessages,
  };

  return {
    seo: {
      title: validateLocalizedString(seo.title, "contactPage.seo.title"),
      description: validateLocalizedString(seo.description, "contactPage.seo.description"),
    },
    hero: {
      title: validateLocalizedString(hero.title, "contactPage.hero.title"),
      ...(hero.subtitle !== undefined
        ? { subtitle: validateLocalizedString(hero.subtitle, "contactPage.hero.subtitle") }
        : {}),
    },
    form: {
      nameLabel: validateLocalizedString(form.nameLabel, "contactPage.form.nameLabel"),
      namePlaceholder: validateLocalizedString(form.namePlaceholder, "contactPage.form.namePlaceholder"),
      emailLabel: validateLocalizedString(form.emailLabel, "contactPage.form.emailLabel"),
      emailPlaceholder: validateLocalizedString(form.emailPlaceholder, "contactPage.form.emailPlaceholder"),
      phoneLabel: validateLocalizedString(form.phoneLabel, "contactPage.form.phoneLabel"),
      phonePlaceholder: validateLocalizedString(form.phonePlaceholder, "contactPage.form.phonePlaceholder"),
      timelineLabel: validateLocalizedString(form.timelineLabel, "contactPage.form.timelineLabel"),
      timelinePlaceholder: validateLocalizedString(form.timelinePlaceholder, "contactPage.form.timelinePlaceholder"),
      typeLabel: validateLocalizedString(form.typeLabel, "contactPage.form.typeLabel"),
      typePlaceholder: validateLocalizedString(form.typePlaceholder, "contactPage.form.typePlaceholder"),
      projectTypes,
      messageLabel: validateLocalizedString(form.messageLabel, "contactPage.form.messageLabel"),
      messagePlaceholder: validateLocalizedString(form.messagePlaceholder, "contactPage.form.messagePlaceholder"),
      submitButton: validateLocalizedString(form.submitButton, "contactPage.form.submitButton"),
      noticeText: validateLocalizedString(form.noticeText, "contactPage.form.noticeText"),
      privacyPolicyText: validateLocalizedString(form.privacyPolicyText, "contactPage.form.privacyPolicyText"),
      privacyPolicyUrl: cleanPrivacyUrl,
    },
    card: {
      title: validateLocalizedString(card.title, "contactPage.card.title"),
      emailLabel: validateLocalizedString(card.emailLabel, "contactPage.card.emailLabel"),
      phoneLabel: validateLocalizedString(card.phoneLabel, "contactPage.card.phoneLabel"),
      phone: card.phone.trim(),
      socialLabel: validateLocalizedString(card.socialLabel, "contactPage.card.socialLabel"),
      responseTimeNotice: validateLocalizedString(card.responseTimeNotice, "contactPage.card.responseTimeNotice"),
    },
    messages: mergedMessages,
  };
}

export function containsUnresolvedPlaceholders(text: string): boolean {
  if (!text) return false;
  const placeholderRegex = /\[\s*(à compléter|to complete|to be completed|date|nom|adresse|nom et adresse de l'hébergeur|ton prénom|your name|placeholder|todo|tbd|xxx|à préciser|remplir)\s*\]/i;
  return placeholderRegex.test(text);
}

export function validateCompanyContent(val: unknown): CompanyContent {
  const obj = assertObject(val, "company");
  assertExactKeys(
    obj,
    [
      "tradeName",
      "legalName",
      "legalForm",
      "legalPersonality",
      "address",
      "enterpriseNumber",
      "vatNumber",
      "vatRegime",
      "vatRegimeType",
      "rpmJurisdiction",
      "publicationDirector",
      "privacyContact",
      "privacyEmail",
      "dpoDesignated",
      "dpoContact",
      "hostingProvider",
      "hostingAddress",
      "hostingCountry",
      "emailService",
      "galleryStorageService",
      "retentionContactRequests",
      "retentionClientRecords",
      "retentionMediaGalleries",
      "clientTypes",
      "phone",
      "email",
      "instagramUrl",
      "youtubeUrl",
      "isPublished",
    ],
    "company"
  );

  const stringFields = [
    "tradeName",
    "legalName",
    "legalForm",
    "address",
    "enterpriseNumber",
    "vatNumber",
    "publicationDirector",
    "privacyContact",
    "hostingProvider",
    "hostingAddress",
    "phone",
    "email",
    "instagramUrl",
    "youtubeUrl",
  ] as const;

  for (const field of stringFields) {
    if (typeof obj[field] !== "string") {
      throw new ValidationError(`company.${field} doit être une chaîne de caractères.`);
    }
  }

  // Optional string fields
  const optionalStringFields = [
    "vatRegime",
    "rpmJurisdiction",
    "privacyEmail",
    "dpoContact",
    "hostingCountry",
    "emailService",
    "galleryStorageService",
    "retentionContactRequests",
    "retentionClientRecords",
    "retentionMediaGalleries",
  ] as const;

  for (const field of optionalStringFields) {
    if (obj[field] !== undefined && typeof obj[field] !== "string") {
      throw new ValidationError(`company.${field} doit être une chaîne de caractères.`);
    }
  }

  let legalPersonality: LegalPersonalityType = "";
  if (obj.legalPersonality !== undefined) {
    if (typeof obj.legalPersonality !== "string") {
      throw new ValidationError("company.legalPersonality doit être une chaîne de caractères.");
    }
    const rawLp = (obj.legalPersonality as string).trim();
    const allowedLp: LegalPersonalityType[] = ["", "natural_person", "legal_entity", "unincorporated_association"];
    if (!allowedLp.includes(rawLp as LegalPersonalityType)) {
      throw new ValidationError(
        "company.legalPersonality doit être 'natural_person', 'legal_entity', 'unincorporated_association' ou vide."
      );
    }
    legalPersonality = rawLp as LegalPersonalityType;
  }

  let vatRegimeType: VatRegimeType = "";
  if (obj.vatRegimeType !== undefined) {
    if (typeof obj.vatRegimeType !== "string") {
      throw new ValidationError("company.vatRegimeType doit être une chaîne de caractères.");
    }
    const rawVrt = (obj.vatRegimeType as string).trim();
    const allowedVrt: VatRegimeType[] = ["", "standard", "small_business_exemption", "non_subject", "other"];
    if (!allowedVrt.includes(rawVrt as VatRegimeType)) {
      throw new ValidationError(
        "company.vatRegimeType doit être 'standard', 'small_business_exemption', 'non_subject', 'other' ou vide."
      );
    }
    vatRegimeType = rawVrt as VatRegimeType;
  }

  let clientTypes: "b2b" | "b2c" | "both" | "" = "";
  if (obj.clientTypes !== undefined) {
    if (typeof obj.clientTypes !== "string") {
      throw new ValidationError("company.clientTypes doit être une chaîne de caractères.");
    }
    const rawCt = (obj.clientTypes as string).trim();
    if (rawCt && rawCt !== "b2b" && rawCt !== "b2c" && rawCt !== "both") {
      throw new ValidationError("company.clientTypes doit être 'b2b', 'b2c', 'both' ou vide.");
    }
    clientTypes = rawCt as "b2b" | "b2c" | "both" | "";
  }

  if (obj.dpoDesignated !== undefined && typeof obj.dpoDesignated !== "boolean") {
    throw new ValidationError("company.dpoDesignated doit être un booléen.");
  }

  if (obj.isPublished !== undefined && typeof obj.isPublished !== "boolean") {
    throw new ValidationError("company.isPublished doit être un booléen.");
  }

  const emailTrim = (obj.email as string).trim();
  if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
    throw new ValidationError("company.email doit être une adresse e-mail valide.");
  }

  const privacyEmailTrim = obj.privacyEmail !== undefined ? (obj.privacyEmail as string).trim() : "";
  if (privacyEmailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyEmailTrim)) {
    throw new ValidationError("company.privacyEmail doit être une adresse e-mail valide.");
  }

  const phoneTrim = (obj.phone as string).trim();
  if (phoneTrim) {
    const digits = phoneTrim.replace(/\D/g, "");
    if (phoneTrim.length > 50 || !/^[+]?[\d\s()./-]{6,50}$/.test(phoneTrim) || digits.length < 6) {
      throw new ValidationError("company.phone doit être un numéro de téléphone valide.");
    }
  }

  const igTrim = (obj.instagramUrl as string).trim();
  if (igTrim && !/^https?:\/\//i.test(igTrim)) {
    throw new ValidationError("company.instagramUrl doit être une URL HTTP(S) valide.");
  }

  const ytTrim = (obj.youtubeUrl as string).trim();
  if (ytTrim && !/^https?:\/\//i.test(ytTrim)) {
    throw new ValidationError("company.youtubeUrl doit être une URL HTTP(S) valide.");
  }

  const isPublished = Boolean(obj.isPublished);

  const normalizedCompany: CompanyContent = {
    tradeName: (obj.tradeName as string).trim(),
    legalName: (obj.legalName as string).trim(),
    legalForm: (obj.legalForm as string).trim(),
    legalPersonality,
    address: (obj.address as string).trim(),
    enterpriseNumber: (obj.enterpriseNumber as string).trim(),
    vatNumber: (obj.vatNumber as string).trim(),
    vatRegime: obj.vatRegime !== undefined ? (obj.vatRegime as string).trim() : "",
    vatRegimeType,
    rpmJurisdiction: obj.rpmJurisdiction !== undefined ? (obj.rpmJurisdiction as string).trim() : "",
    publicationDirector: (obj.publicationDirector as string).trim(),
    privacyContact: (obj.privacyContact as string).trim(),
    privacyEmail: privacyEmailTrim,
    dpoDesignated: Boolean(obj.dpoDesignated),
    dpoContact: obj.dpoContact !== undefined ? (obj.dpoContact as string).trim() : "",
    hostingProvider: (obj.hostingProvider as string).trim(),
    hostingAddress: (obj.hostingAddress as string).trim(),
    hostingCountry: obj.hostingCountry !== undefined ? (obj.hostingCountry as string).trim() : "Belgique",
    emailService: obj.emailService !== undefined ? (obj.emailService as string).trim() : "",
    galleryStorageService: obj.galleryStorageService !== undefined ? (obj.galleryStorageService as string).trim() : "",
    retentionContactRequests: obj.retentionContactRequests !== undefined ? (obj.retentionContactRequests as string).trim() : "",
    retentionClientRecords: obj.retentionClientRecords !== undefined ? (obj.retentionClientRecords as string).trim() : "",
    retentionMediaGalleries: obj.retentionMediaGalleries !== undefined ? (obj.retentionMediaGalleries as string).trim() : "",
    clientTypes,
    phone: phoneTrim,
    email: emailTrim,
    instagramUrl: igTrim,
    youtubeUrl: ytTrim,
    isPublished,
  };

  if (isPublished) {
    const requiredPublishedFields: (keyof CompanyContent)[] = [
      "tradeName",
      "legalName",
      "legalForm",
      "address",
      "enterpriseNumber",
      "publicationDirector",
      "hostingProvider",
      "hostingAddress",
    ];
    for (const key of requiredPublishedFields) {
      const val = normalizedCompany[key];
      if (typeof val === "string" && !val) {
        throw new ValidationError(
          `La confirmation d'identité d'entreprise requiert de renseigner '${key}'.`
        );
      }
    }

    if (normalizedCompany.dpoDesignated && !normalizedCompany.dpoContact) {
      throw new ValidationError(
        "Si un DPO est désigné, ses coordonnées de contact (dpoContact) doivent être renseignées."
      );
    }

    // Check that none of the filled company fields contain unresolved placeholders
    for (const [key, val] of Object.entries(normalizedCompany)) {
      if (typeof val === "string" && val && containsUnresolvedPlaceholders(val)) {
        throw new ValidationError(
          `Le champ company.${key} contient des mentions non complétées (placeholders).`
        );
      }
    }
  }

  return normalizedCompany;
}

export function validateLegalSection(val: unknown, context: string): LegalSection {
  const obj = assertObject(val, context);
  assertExactKeys(obj, ["id", "title", "paragraphs", "listItems"], context);

  if (typeof obj.id !== "string" || !obj.id.trim()) {
    throw new ValidationError(`${context}.id doit être une chaîne non vide.`);
  }

  const title = validateLocalizedString(obj.title, `${context}.title`);

  if (!Array.isArray(obj.paragraphs)) {
    throw new ValidationError(`${context}.paragraphs doit être une liste.`);
  }
  const paragraphs = obj.paragraphs.map((p, i) =>
    validateLocalizedString(p, `${context}.paragraphs[${i}]`)
  );

  let listItems: LocalizedString[] | undefined;
  if (obj.listItems !== undefined) {
    if (!Array.isArray(obj.listItems)) {
      throw new ValidationError(`${context}.listItems doit être une liste.`);
    }
    listItems = obj.listItems.map((li, i) =>
      validateLocalizedString(li, `${context}.listItems[${i}]`)
    );
  }

  return {
    id: (obj.id as string).trim(),
    title,
    paragraphs,
    ...(listItems !== undefined ? { listItems } : {}),
  };
}

export function validateCookieInventoryItem(val: unknown, context: string): CookieInventoryItem {
  const obj = assertObject(val, context);
  assertExactKeys(
    obj,
    ["id", "name", "provider", "category", "purpose", "duration", "exemptionJustification"],
    context
  );

  if (typeof obj.id !== "string" || !obj.id.trim()) {
    throw new ValidationError(`${context}.id doit être une chaîne non vide.`);
  }

  const name = validateLocalizedString(obj.name, `${context}.name`);
  const provider = validateLocalizedString(obj.provider, `${context}.provider`);

  if (obj.category !== "technical" && obj.category !== "preferences") {
    throw new ValidationError(
      `${context}.category doit être soit 'technical' soit 'preferences'.`
    );
  }

  const purpose = validateLocalizedString(obj.purpose, `${context}.purpose`);
  const duration = validateLocalizedString(obj.duration, `${context}.duration`);

  let exemptionJustification: LocalizedString | undefined;
  if (obj.exemptionJustification !== undefined) {
    exemptionJustification = validateLocalizedString(
      obj.exemptionJustification,
      `${context}.exemptionJustification`
    );
  }

  return {
    id: (obj.id as string).trim(),
    name,
    provider,
    category: obj.category,
    purpose,
    duration,
    ...(exemptionJustification !== undefined ? { exemptionJustification } : {}),
  };
}

export function validateLegalDocument(val: unknown, context: string): LegalDocument {
  const obj = assertObject(val, context);
  assertExactKeys(
    obj,
    ["seoTitle", "seoDescription", "publicTitle", "intro", "effectiveDate", "version", "sections", "inventory"],
    context
  );

  const seoTitle = validateLocalizedString(obj.seoTitle, `${context}.seoTitle`);
  const seoDescription = validateLocalizedString(obj.seoDescription, `${context}.seoDescription`);
  const publicTitle = validateLocalizedString(obj.publicTitle, `${context}.publicTitle`);
  const intro = validateLocalizedString(obj.intro, `${context}.intro`);

  if (typeof obj.effectiveDate !== "string") {
    throw new ValidationError(`${context}.effectiveDate doit être une chaîne.`);
  }
  if (typeof obj.version !== "number" || !Number.isInteger(obj.version) || obj.version < 0) {
    throw new ValidationError(`${context}.version doit être un entier positif.`);
  }
  if (context.endsWith(".published") && obj.version < 1) {
    throw new ValidationError(`${context}.version doit être un entier strictement positif.`);
  }

  if (!Array.isArray(obj.sections)) {
    throw new ValidationError(`${context}.sections doit être une liste.`);
  }

  const sections = obj.sections.map((s, i) =>
    validateLegalSection(s, `${context}.sections[${i}]`)
  );

  let inventory: CookieInventoryItem[] | undefined;
  if (obj.inventory !== undefined) {
    if (!Array.isArray(obj.inventory)) {
      throw new ValidationError(`${context}.inventory doit être une liste.`);
    }
    inventory = obj.inventory.map((inv, i) =>
      validateCookieInventoryItem(inv, `${context}.inventory[${i}]`)
    );
  }

  return {
    seoTitle,
    seoDescription,
    publicTitle,
    intro,
    effectiveDate: (obj.effectiveDate as string).trim(),
    version: obj.version,
    sections,
    ...(inventory !== undefined ? { inventory } : {}),
  };
}

export function validateLegalPageRecord(val: unknown, context: string): LegalPageRecord {
  const obj = assertObject(val, context);
  assertExactKeys(obj, ["draft", "published", "lastUpdated"], context);

  const draft = validateLegalDocument(obj.draft, `${context}.draft`);
  let published: LegalDocument | null = null;
  if (obj.published !== null && obj.published !== undefined) {
    published = validateLegalDocument(obj.published, `${context}.published`);
  }

  if (typeof obj.lastUpdated !== "string") {
    throw new ValidationError(`${context}.lastUpdated doit être une chaîne ISO-8601.`);
  }

  return {
    draft,
    published,
    lastUpdated: obj.lastUpdated,
  };
}

export function validateLegalPagesContent(val: unknown): LegalPagesContent {
  const obj = assertObject(val, "legalPages");
  assertExactKeys(obj, ["mentions", "privacy", "terms", "cookies"], "legalPages");

  return {
    mentions: validateLegalPageRecord(obj.mentions, "legalPages.mentions"),
    privacy: validateLegalPageRecord(obj.privacy, "legalPages.privacy"),
    terms: validateLegalPageRecord(obj.terms, "legalPages.terms"),
    cookies: validateLegalPageRecord(obj.cookies, "legalPages.cookies"),
  };
}

export function migrateSiteContentV1ToV2(v1: SiteContentV1): SiteContentV2 {
  return {
    schemaVersion: 2,
    revision: v1.revision,
    updatedAt: v1.updatedAt,
    common: structuredClone(v1.common),
    home: structuredClone(v1.home),
    studio: structuredClone(v1.studio),
    contactPage: structuredClone(DEFAULT_CONTACT_PAGE_CONTENT),
    media: v1.media ? structuredClone(v1.media) : {},
  };
}

export function migrateSiteContentV2ToV3(v2: SiteContentV2): SiteContent {
  const company = structuredClone(DEFAULT_COMPANY_CONTENT);
  const emailTrim = (v2.home?.contact?.email ?? "").trim();
  company.email = emailTrim && emailTrim !== "#" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim) ? emailTrim : "";

  const phoneTrim = (v2.contactPage?.card?.phone ?? "").trim();
  const digits = phoneTrim.replace(/\D/g, "");
  company.phone =
    phoneTrim && phoneTrim.length <= 50 && /^[+]?[\d\s()./-]{6,50}$/.test(phoneTrim) && digits.length >= 6
      ? phoneTrim
      : "";

  const igTrim = (v2.home?.contact?.instagramUrl ?? "").trim();
  company.instagramUrl = igTrim && igTrim !== "#" && /^https?:\/\//i.test(igTrim) ? igTrim : "";

  const ytTrim = (v2.home?.contact?.youtubeUrl ?? "").trim();
  company.youtubeUrl = ytTrim && ytTrim !== "#" && /^https?:\/\//i.test(ytTrim) ? ytTrim : "";

  company.tradeName = v2.common?.brandName || "Parallax";
  company.isPublished = false;

  const migratedHome = structuredClone(v2.home);
  if (migratedHome?.contact) {
    const hEmail = (migratedHome.contact.email || "").trim();
    if (hEmail === "#" || (hEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hEmail))) {
      migratedHome.contact.email = "";
    }
    const hIg = (migratedHome.contact.instagramUrl || "").trim();
    if (hIg === "#" || (hIg && !/^https?:\/\//i.test(hIg))) {
      migratedHome.contact.instagramUrl = "";
    }
    const hYt = (migratedHome.contact.youtubeUrl || "").trim();
    if (hYt === "#" || (hYt && !/^https?:\/\//i.test(hYt))) {
      migratedHome.contact.youtubeUrl = "";
    }
  }

  const migratedContact = structuredClone(v2.contactPage);
  if (migratedContact?.card) {
    const cPhone = (migratedContact.card.phone || "").trim();
    const cDigits = cPhone.replace(/\D/g, "");
    if (cPhone && (cPhone.length > 50 || !/^[+]?[\d\s()./-]{6,50}$/.test(cPhone) || cDigits.length < 6)) {
      migratedContact.card.phone = "";
    }
  }

  return {
    schemaVersion: 3,
    revision: v2.revision,
    updatedAt: v2.updatedAt,
    common: structuredClone(v2.common),
    home: migratedHome,
    studio: structuredClone(v2.studio),
    contactPage: migratedContact,
    company,
    legalPages: structuredClone(DEFAULT_LEGAL_PAGES_CONTENT),
    media: v2.media ? structuredClone(v2.media) : {},
  };
}

export function validateSiteContent(val: unknown): SiteContent {
  const obj = assertObject(val, "siteContent");

  if (typeof obj.revision !== "string" || !/^[0-9a-f]{32}$/i.test(obj.revision)) {
    throw new ValidationError("revision doit être une chaîne hexadécimale de 32 caractères.");
  }
  if (typeof obj.updatedAt !== "string") {
    throw new ValidationError("updatedAt doit être une chaîne ISO-8601.");
  }

  const media: Record<string, UploadedMediaMetadata> = {};
  if (obj.media !== undefined) {
    const mediaObj = assertObject(obj.media, "siteContent.media");
    for (const [k, v] of Object.entries(mediaObj)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) {
        throw new ValidationError(`Clé de média invalide: '${k}'. Doit être un UUID.`);
      }
      media[k.toLowerCase()] = validateUploadedMediaMetadata(v, `siteContent.media['${k}']`);
    }
  }

  const rawVersion = obj.schemaVersion === undefined ? 1 : obj.schemaVersion;

  if (rawVersion === 1) {
    const allowedKeys =
      obj.schemaVersion !== undefined
        ? ["schemaVersion", "revision", "updatedAt", "common", "home", "studio", "media"]
        : ["revision", "updatedAt", "common", "home", "studio", "media"];
    assertExactKeys(obj, allowedKeys, "siteContent");
    const v1Content: SiteContentV1 = {
      schemaVersion: 1,
      revision: obj.revision.toLowerCase(),
      updatedAt: obj.updatedAt,
      common: validateCommonContent(obj.common),
      home: validateHomeContent(obj.home, { isLegacy: true }),
      studio: validateStudioContent(obj.studio),
      media,
    };
    const v2Content = migrateSiteContentV1ToV2(v1Content);
    const v3Content = migrateSiteContentV2ToV3(v2Content);
    return validateSiteContent(v3Content);
  }

  if (obj.schemaVersion === 2) {
    assertExactKeys(
      obj,
      ["schemaVersion", "revision", "updatedAt", "common", "home", "studio", "contactPage", "media"],
      "siteContent"
    );
    const v2Content: SiteContentV2 = {
      schemaVersion: 2,
      revision: obj.revision.toLowerCase(),
      updatedAt: obj.updatedAt,
      common: validateCommonContent(obj.common),
      home: validateHomeContent(obj.home, { isLegacy: true }),
      studio: validateStudioContent(obj.studio),
      contactPage: validateContactPageContent(obj.contactPage, { isLegacy: true }),
      media,
    };
    const v3Content = migrateSiteContentV2ToV3(v2Content);
    return validateSiteContent(v3Content);
  }

  if (obj.schemaVersion === 3) {
    assertExactKeys(
      obj,
      ["schemaVersion", "revision", "updatedAt", "common", "home", "studio", "contactPage", "company", "legalPages", "media"],
      "siteContent"
    );
    return {
      schemaVersion: 3,
      revision: obj.revision.toLowerCase(),
      updatedAt: obj.updatedAt,
      common: validateCommonContent(obj.common),
      home: validateHomeContent(obj.home),
      studio: validateStudioContent(obj.studio),
      contactPage: validateContactPageContent(obj.contactPage),
      company: validateCompanyContent(obj.company),
      legalPages: validateLegalPagesContent(obj.legalPages),
      media,
    };
  }

  throw new ValidationError(`schemaVersion non supporté: ${String(obj.schemaVersion)}. Attendu: 1, 2 ou 3`);
}

/**
 * Pure domain validation wrapper delegating directly to the canonical site content validator.
 * Enforces schemaVersion === 3 strictly without silent migration.
 */
export function validateSiteContentDocument(val: unknown): {
  success: true;
  data: SiteContent;
} | {
  success: false;
  reason: string;
  error?: string;
} {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return { success: false, reason: "invalid_schema", error: "siteContent doit être un objet racine" };
  }
  const obj = val as Record<string, unknown>;
  if (typeof obj.schemaVersion !== "number" || obj.schemaVersion !== 3) {
    return {
      success: false,
      reason: "unsupported_version",
      error: `schemaVersion doit être 3, reçu: ${String(obj.schemaVersion)}`,
    };
  }
  try {
    const data = validateSiteContent(val);
    return { success: true, data };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { success: false, reason: "invalid_schema", error: err.message };
    }
    return { success: false, reason: "invalid_schema", error: err instanceof Error ? err.message : String(err) };
  }
}
