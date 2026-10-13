import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import defaultContent from "../content/default-site-content.json";
import { atomicWriteJson } from "./atomic-fs.server";
import { ENV } from "./env.server";

export * from "./site-content.shared";
import {
  ALLOWED_IMAGE_MAP,
  type AllowedImageId,
  type CommonContent,
  type HomeContent,
  type LocalizedString,
  type SiteContent,
  type StudioContent,
  type StudioMember,
} from "./site-content.shared";

export class RevisionConflictError extends Error {
  constructor(message = "Conflit de révision. Le contenu a été modifié par un autre processus.") {
    super(message);
    this.name = "RevisionConflictError";
  }
}

export class CorruptedContentError extends Error {
  constructor(message = "Le fichier de contenu éditorial est corrompu ou illisible.") {
    super(message);
    this.name = "CorruptedContentError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function getSiteContentFilePath(): string {
  if (process.env.SITE_CONTENT_PATH) {
    return path.resolve(process.env.SITE_CONTENT_PATH);
  }
  return path.resolve(ENV.SITE_CONTENT_PATH);
}

function assertObject(val: unknown, context: string): Record<string, unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    throw new ValidationError(`${context} doit être un objet.`);
  }
  return val as Record<string, unknown>;
}

function assertExactKeys(obj: Record<string, unknown>, allowedKeys: string[], context: string): void {
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (!allowedKeys.includes(k)) {
      throw new ValidationError(`Propriété inconnue '${k}' dans ${context}.`);
    }
  }
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
  return { fr: obj.fr, en: obj.en };
}

export function validateAllowedImageId(val: unknown, context: string): AllowedImageId {
  if (typeof val !== "string" || !(val in ALLOWED_IMAGE_MAP)) {
    throw new ValidationError(
      `${context} doit être un identifiant d'image valide (${Object.keys(ALLOWED_IMAGE_MAP).join(", ")}). Reçu: ${String(val)}`
    );
  }
  return val as AllowedImageId;
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

export function validateHomeContent(val: unknown): HomeContent {
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
  const photoItems = sf.photoItems.map((item, idx) =>
    validateLocalizedString(item, `home.savoirFaire.photoItems[${idx}]`)
  );

  if (!Array.isArray(sf.videoItems)) {
    throw new ValidationError("home.savoirFaire.videoItems doit être une liste.");
  }
  const videoItems = sf.videoItems.map((item, idx) =>
    validateLocalizedString(item, `home.savoirFaire.videoItems[${idx}]`)
  );

  const contact = assertObject(obj.contact, "home.contact");
  assertExactKeys(contact, ["title", "emailLabel", "email", "socialLabel", "instagramUrl", "youtubeUrl"], "home.contact");
  if (typeof contact.email !== "string") {
    throw new ValidationError("home.contact.email doit être une chaîne.");
  }
  if (typeof contact.instagramUrl !== "string") {
    throw new ValidationError("home.contact.instagramUrl doit être une chaîne.");
  }
  if (typeof contact.youtubeUrl !== "string") {
    throw new ValidationError("home.contact.youtubeUrl doit être une chaîne.");
  }

  const sempra = assertObject(obj.sempra, "home.sempra");
  assertExactKeys(sempra, ["badge", "title", "buttonText", "buttonUrl"], "home.sempra");
  if (typeof sempra.buttonUrl !== "string") {
    throw new ValidationError("home.sempra.buttonUrl doit être une chaîne.");
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

export function validateSiteContent(val: unknown): SiteContent {
  const obj = assertObject(val, "siteContent");
  assertExactKeys(obj, ["schemaVersion", "revision", "updatedAt", "common", "home", "studio"], "siteContent");

  if (obj.schemaVersion !== 1) {
    throw new ValidationError(`schemaVersion non supporté: ${String(obj.schemaVersion)}. Attendu: 1`);
  }
  if (typeof obj.revision !== "string" || !/^[0-9a-f]{32}$/i.test(obj.revision)) {
    throw new ValidationError("revision doit être une chaîne hexadécimale de 32 caractères.");
  }
  if (typeof obj.updatedAt !== "string") {
    throw new ValidationError("updatedAt doit être une chaîne ISO-8601.");
  }

  return {
    schemaVersion: 1,
    revision: obj.revision.toLowerCase(),
    updatedAt: obj.updatedAt,
    common: validateCommonContent(obj.common),
    home: validateHomeContent(obj.home),
    studio: validateStudioContent(obj.studio),
  };
}

export function ensureSiteContentFileInitialized(): string {
  const filePath = getSiteContentFilePath();
  if (!fs.existsSync(filePath)) {
    const validated = validateSiteContent(defaultContent);
    atomicWriteJson(filePath, validated);
  }
  return filePath;
}

export function getRawSiteContent(): { content: SiteContent; isCorrupted: boolean } {
  try {
    const filePath = ensureSiteContentFileInitialized();
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return { content: validateSiteContent(parsed), isCorrupted: false };
  } catch (err) {
    console.error("Erreur de validation ou de lecture du contenu éditorial :", err);
    return { content: validateSiteContent(defaultContent), isCorrupted: true };
  }
}

export function getSiteContent(): SiteContent {
  return getRawSiteContent().content;
}

export function saveHomeContent(newHome: HomeContent, previousRevision: string): string {
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError();
  }

  const validatedHome = validateHomeContent(newHome);
  const nextRevision = crypto.randomBytes(16).toString("hex");
  const nextContent: SiteContent = {
    ...current.content,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
    home: validatedHome,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}

export function saveStudioContent(newStudio: StudioContent, previousRevision: string): string {
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError();
  }

  const validatedStudio = validateStudioContent(newStudio);
  const nextRevision = crypto.randomBytes(16).toString("hex");
  const nextContent: SiteContent = {
    ...current.content,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
    studio: validatedStudio,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}
