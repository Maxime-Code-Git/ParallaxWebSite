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

export function cleanLocalizedString(
  loc: LocalizedString | null | undefined
): LocalizedString {
  if (!loc || typeof loc !== "object") return { fr: "", en: "" };
  return {
    fr: cleanTypography(loc.fr, "fr"),
    en: cleanTypography(loc.en, "en"),
  };
}

export function cleanCommonContent<T>(common: T): T {
  if (!common || typeof common !== "object") return common;
  const clone = structuredClone(common) as Record<string, unknown>;

  const navigation = clone.navigation;
  if (navigation && typeof navigation === "object") {
    const nav = navigation as Record<string, unknown>;
    for (const key of Object.keys(nav)) {
      if (nav[key]) {
        nav[key] = cleanLocalizedString(nav[key] as LocalizedString);
      }
    }
  }
  const footer = clone.footer;
  if (footer && typeof footer === "object") {
    const foot = footer as Record<string, unknown>;
    for (const key of Object.keys(foot)) {
      if (foot[key]) {
        foot[key] = cleanLocalizedString(foot[key] as LocalizedString);
      }
    }
  }

  return clone as unknown as T;
}

export function cleanHomeContent<T>(home: T): T {
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
    if (savoirFaire.videoTitle) savoirFaire.videoTitle = cleanLocalizedString(savoirFaire.videoTitle as LocalizedString);
    if (Array.isArray(savoirFaire.photoItems)) {
      savoirFaire.photoItems = savoirFaire.photoItems.map((item) => cleanLocalizedString(item as LocalizedString));
    }
    if (Array.isArray(savoirFaire.videoItems)) {
      savoirFaire.videoItems = savoirFaire.videoItems.map((item) => cleanLocalizedString(item as LocalizedString));
    }
  }
  const contact = clone.contact as Record<string, unknown> | undefined;
  if (contact) {
    if (contact.badge) contact.badge = cleanLocalizedString(contact.badge as LocalizedString);
    if (contact.title) contact.title = cleanLocalizedString(contact.title as LocalizedString);
    if (contact.subtitle) contact.subtitle = cleanLocalizedString(contact.subtitle as LocalizedString);
    if (contact.cta) contact.cta = cleanLocalizedString(contact.cta as LocalizedString);
  }
  const sempra = clone.sempra as Record<string, unknown> | undefined;
  if (sempra) {
    if (sempra.badge) sempra.badge = cleanLocalizedString(sempra.badge as LocalizedString);
    if (sempra.title) sempra.title = cleanLocalizedString(sempra.title as LocalizedString);
    if (sempra.text) sempra.text = cleanLocalizedString(sempra.text as LocalizedString);
    if (sempra.buttonText) sempra.buttonText = cleanLocalizedString(sempra.buttonText as LocalizedString);
    if (sempra.imageAlt) sempra.imageAlt = cleanLocalizedString(sempra.imageAlt as LocalizedString);
  }

  return clone as unknown as T;
}

export function cleanStudioContent<T>(studio: T): T {
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

export function cleanContactContent<T>(contact: T): T {
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
    for (const key of ["title", "emailLabel", "phoneLabel", "socialLabel", "responseTimeNotice"]) {
      if (card[key]) card[key] = cleanLocalizedString(card[key] as LocalizedString);
    }
  }
  const messages = clone.messages as Record<string, unknown> | undefined;
  if (messages && typeof messages === "object") {
    for (const key of Object.keys(messages)) {
      if (messages[key]) messages[key] = cleanLocalizedString(messages[key] as LocalizedString);
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

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY_ID_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;

function isLoc(v: unknown): v is LocalizedString {
  return Boolean(
    v &&
      typeof v === "object" &&
      typeof (v as LocalizedString).fr === "string" &&
      typeof (v as LocalizedString).en === "string"
  );
}

export function validatePortfolioContentDocument(val: unknown): {
  success: true;
  data: PortfolioContentLike;
} | {
  success: false;
  reason: string;
  error?: string;
} {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return { success: false, reason: "invalid_schema", error: "Le contenu portfolio doit être un objet racine" };
  }
  const obj = val as Record<string, unknown>;
  const allowedKeys = new Set(["schemaVersion", "revision", "updatedAt", "overview", "categories", "sections", "projects", "media"]);
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) {
      return { success: false, reason: "invalid_schema", error: `Clé inattendue "${k}" à la racine du portfolio` };
    }
  }

  if (obj.schemaVersion !== 2) {
    return { success: false, reason: "unsupported_version", error: `schemaVersion doit être 2, reçu: ${String(obj.schemaVersion)}` };
  }

  if (typeof obj.revision !== "string" || obj.revision.length < 8 || obj.revision.length > 64) {
    return { success: false, reason: "invalid_schema", error: "Révision invalide" };
  }

  if (typeof obj.updatedAt !== "string") {
    return { success: false, reason: "invalid_schema", error: "updatedAt doit être une chaîne" };
  }

  // overview
  if (!obj.overview || typeof obj.overview !== "object" || Array.isArray(obj.overview)) {
    return { success: false, reason: "invalid_schema", error: "overview doit être un objet" };
  }
  const ov = obj.overview as Record<string, unknown>;
  if (!isLoc(ov.title) || !isLoc(ov.intro) || !isLoc(ov.seeMoreButton)) {
    return { success: false, reason: "invalid_schema", error: "overview.title, intro et seeMoreButton doivent être des chaînes bilingues valides" };
  }
  if (!ov.seo || typeof ov.seo !== "object" || !isLoc((ov.seo as Record<string, unknown>).title) || !isLoc((ov.seo as Record<string, unknown>).description)) {
    return { success: false, reason: "invalid_schema", error: "overview.seo doit contenir title et description bilingues" };
  }

  // categories
  if (!Array.isArray(obj.categories)) {
    return { success: false, reason: "invalid_schema", error: "categories doit être un tableau" };
  }
  const categoryIds = new Set<string>();
  for (let i = 0; i < obj.categories.length; i++) {
    const c = obj.categories[i];
    if (!c || typeof c !== "object") {
      return { success: false, reason: "invalid_schema", error: `categories[${i}] doit être un objet` };
    }
    const cat = c as Record<string, unknown>;
    if (typeof cat.id !== "string" || !CATEGORY_ID_REGEX.test(cat.id)) {
      return { success: false, reason: "invalid_schema", error: `categories[${i}].id invalide` };
    }
    if (typeof cat.slugFr !== "string" || !SLUG_REGEX.test(cat.slugFr) || typeof cat.slugEn !== "string" || !SLUG_REGEX.test(cat.slugEn)) {
      return { success: false, reason: "invalid_schema", error: `categories[${i}] slugs invalides` };
    }
    categoryIds.add(cat.id);
    if (!isLoc(cat.title) || !isLoc(cat.intro) || !isLoc(cat.showreelTitle) || !isLoc(cat.morePhotosButton) || !isLoc(cat.lessPhotosButton) || !isLoc(cat.backButton)) {
      return { success: false, reason: "invalid_schema", error: `categories[${i}] textes bilingues obligatoires manquants` };
    }
    if (cat.seo && typeof cat.seo === "object") {
      const cSeo = cat.seo as Record<string, unknown>;
      if (!isLoc(cSeo.title) || !isLoc(cSeo.description)) {
        return { success: false, reason: "invalid_schema", error: `categories[${i}].seo invalide` };
      }
    }
  }

  // projects
  if (!Array.isArray(obj.projects)) {
    return { success: false, reason: "invalid_schema", error: "projects doit être un tableau" };
  }
  for (let i = 0; i < obj.projects.length; i++) {
    const p = obj.projects[i];
    if (!p || typeof p !== "object") {
      return { success: false, reason: "invalid_schema", error: `projects[${i}] doit être un objet` };
    }
    const proj = p as Record<string, unknown>;
    if (typeof proj.id !== "string" || !proj.id) {
      return { success: false, reason: "invalid_schema", error: `projects[${i}].id invalide` };
    }
    if (typeof proj.category !== "string" || !categoryIds.has(proj.category)) {
      return {
        success: false,
        reason: "invalid_schema",
        error: `projects[${i}] (${proj.id}) référence une catégorie inconnue: "${String(proj.category)}"`
      };
    }
    if (!isLoc(proj.title) || !isLoc(proj.summary) || !isLoc(proj.coverAlt)) {
      return { success: false, reason: "invalid_schema", error: `projects[${i}] champs bilingues obligatoires manquants` };
    }
    if (proj.seo && typeof proj.seo === "object") {
      const pSeo = proj.seo as Record<string, unknown>;
      if (!isLoc(pSeo.title) || !isLoc(pSeo.description)) {
        return { success: false, reason: "invalid_schema", error: `projects[${i}].seo invalide` };
      }
    }
    if (Array.isArray(proj.description)) {
      for (let j = 0; j < proj.description.length; j++) {
        const b = proj.description[j];
        if (!b || typeof b !== "object" || !isLoc((b as Record<string, unknown>).text)) {
          return { success: false, reason: "invalid_schema", error: `projects[${i}].description[${j}] texte invalide` };
        }
      }
    }
    if (proj.galleryAlt && typeof proj.galleryAlt === "object") {
      for (const [imgId, alt] of Object.entries(proj.galleryAlt)) {
        if (!isLoc(alt)) {
          return { success: false, reason: "invalid_schema", error: `projects[${i}].galleryAlt["${imgId}"] invalide` };
        }
      }
    }
  }

  // media
  if (obj.media !== undefined) {
    if (!obj.media || typeof obj.media !== "object" || Array.isArray(obj.media)) {
      return { success: false, reason: "invalid_schema", error: "media doit être un objet" };
    }
  }

  return { success: true, data: obj as unknown as PortfolioContentLike };
}

export function validateSiteContentDocument(val: unknown): {
  success: true;
  data: Record<string, unknown>;
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
    return { success: false, reason: "unsupported_version", error: `schemaVersion doit être 3, reçu: ${String(obj.schemaVersion)}` };
  }

  if (typeof obj.revision !== "string" || !/^[0-9a-f]{32}$/i.test(obj.revision)) {
    return { success: false, reason: "invalid_schema", error: "revision doit être une chaîne hexadécimale de 32 caractères" };
  }

  if (typeof obj.updatedAt !== "string") {
    return { success: false, reason: "invalid_schema", error: "updatedAt doit être une chaîne" };
  }

  // common
  if (!obj.common || typeof obj.common !== "object") {
    return { success: false, reason: "invalid_schema", error: "common requis" };
  }
  const common = obj.common as Record<string, unknown>;
  if (typeof common.brandName !== "string") {
    return { success: false, reason: "invalid_schema", error: "common.brandName doit être une chaîne" };
  }

  // home
  if (!obj.home || typeof obj.home !== "object") {
    return { success: false, reason: "invalid_schema", error: "home requis" };
  }
  const home = obj.home as Record<string, unknown>;
  if (!home.hero || typeof home.hero !== "object" || !isLoc((home.hero as Record<string, unknown>).title)) {
    return { success: false, reason: "invalid_schema", error: "home.hero.title requis" };
  }

  // studio
  if (!obj.studio || typeof obj.studio !== "object") {
    return { success: false, reason: "invalid_schema", error: "studio requis" };
  }

  // contactPage
  if (!obj.contactPage || typeof obj.contactPage !== "object") {
    return { success: false, reason: "invalid_schema", error: "contactPage requis" };
  }

  // company
  if (!obj.company || typeof obj.company !== "object") {
    return { success: false, reason: "invalid_schema", error: "company requis" };
  }
  const company = obj.company as Record<string, unknown>;
  if (company.email !== undefined && typeof company.email === "string" && company.email.trim() !== "") {
    if (!EMAIL_REGEX.test(company.email.trim())) {
      return { success: false, reason: "invalid_schema", error: `company.email est invalide: "${company.email}"` };
    }
  }

  // legalPages
  if (!obj.legalPages || typeof obj.legalPages !== "object") {
    return { success: false, reason: "invalid_schema", error: "legalPages requis" };
  }
  const legalPages = obj.legalPages as Record<string, unknown>;
  for (const pageKey of ["mentions", "privacy", "terms", "cookies"]) {
    const page = legalPages[pageKey];
    if (!page || typeof page !== "object") {
      return { success: false, reason: "invalid_schema", error: `legalPages.${pageKey} requis` };
    }
    const pRecord = page as Record<string, unknown>;
    if (!pRecord.draft || typeof pRecord.draft !== "object") {
      return { success: false, reason: "invalid_schema", error: `legalPages.${pageKey}.draft requis` };
    }
    const draft = pRecord.draft as Record<string, unknown>;
    if (!isLoc(draft.seoTitle) || !isLoc(draft.seoDescription) || !isLoc(draft.publicTitle) || !isLoc(draft.intro)) {
      return { success: false, reason: "invalid_schema", error: `legalPages.${pageKey}.draft titres et intro requis` };
    }
  }

  // media
  if (obj.media !== undefined) {
    if (!obj.media || typeof obj.media !== "object" || Array.isArray(obj.media)) {
      return { success: false, reason: "invalid_schema", error: "media doit être un objet" };
    }
    for (const k of Object.keys(obj.media as Record<string, unknown>)) {
      if (!UUID_REGEX.test(k)) {
        return { success: false, reason: "invalid_schema", error: `Clé de média non-UUID: "${k}"` };
      }
    }
  }

  return { success: true, data: obj };
}
