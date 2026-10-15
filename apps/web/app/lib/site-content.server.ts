import fs from "node:fs";
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
  type SiteContentV1,
  type StudioContent,
  type StudioMember,
  type ContactPageContent,
  type ProjectTypeOption,
  DEFAULT_CONTACT_PAGE_CONTENT,
  DEFAULT_CONTACT_PAGE_MESSAGES,
  type AdminUploadLocation,
  ADMIN_UPLOAD_LOCATIONS,
  DEFAULT_LOCATION_IMAGES,
  type MediaVariantInfo,
  type UploadedMediaMetadata,
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
  return ENV.SITE_CONTENT_PATH;
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

export function validateContactPageContent(val: unknown): ContactPageContent {
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

export function migrateSiteContentV1ToV2(v1: SiteContentV1): SiteContent {
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

  if (obj.schemaVersion === 1) {
    assertExactKeys(
      obj,
      ["schemaVersion", "revision", "updatedAt", "common", "home", "studio", "media"],
      "siteContent"
    );
    const v1Content: SiteContentV1 = {
      schemaVersion: 1,
      revision: obj.revision.toLowerCase(),
      updatedAt: obj.updatedAt,
      common: validateCommonContent(obj.common),
      home: validateHomeContent(obj.home),
      studio: validateStudioContent(obj.studio),
      media,
    };
    return migrateSiteContentV1ToV2(v1Content);
  }

  if (obj.schemaVersion === 2) {
    assertExactKeys(
      obj,
      ["schemaVersion", "revision", "updatedAt", "common", "home", "studio", "contactPage", "media"],
      "siteContent"
    );
    return {
      schemaVersion: 2,
      revision: obj.revision.toLowerCase(),
      updatedAt: obj.updatedAt,
      common: validateCommonContent(obj.common),
      home: validateHomeContent(obj.home),
      studio: validateStudioContent(obj.studio),
      contactPage: validateContactPageContent(obj.contactPage),
      media,
    };
  }

  throw new ValidationError(`schemaVersion non supporté: ${String(obj.schemaVersion)}. Attendu: 1 ou 2`);
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
    const validated = validateSiteContent(parsed);
    if (parsed.schemaVersion === 1) {
      try {
        atomicWriteJson(filePath, validated);
      } catch (writeErr) {
        console.warn("Notice: Impossible d'écrire la migration V2 sur le disque:", writeErr);
      }
    }
    return { content: validated, isCorrupted: false };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("CRITICAL:")) {
      throw err;
    }
    console.error("Erreur de validation ou de lecture du contenu éditorial :", err);
    return { content: validateSiteContent(defaultContent), isCorrupted: true };
  }
}

export function getSiteContent(): SiteContent {
  return getRawSiteContent().content;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string | null | undefined): boolean {
  return typeof id === "string" && UUID_REGEX.test(id);
}

export function validateReferencedMediaConsistency(
  imageId: string,
  expectedLocation: AdminUploadLocation,
  mediaRegistry: Record<string, UploadedMediaMetadata> | undefined,
  context: string
): void {
  if (imageId in ALLOWED_IMAGE_MAP) {
    return;
  }
  const lowerId = imageId.toLowerCase();
  const meta = mediaRegistry?.[lowerId];
  if (!meta) {
    throw new ValidationError(
      `${context}: L'identifiant média '${imageId}' est inconnu dans le registre.`
    );
  }
  if (meta.imageId.toLowerCase() !== lowerId) {
    throw new ValidationError(
      `${context}: Discordance d'identifiant pour le média '${imageId}'.`
    );
  }
  if (meta.location !== expectedLocation) {
    throw new ValidationError(
      `${context}: L'emplacement du média '${meta.location}' ne correspond pas à l'emplacement attendu '${expectedLocation}'.`
    );
  }
  if (!Array.isArray(meta.variants) || meta.variants.length === 0) {
    throw new ValidationError(
      `${context}: Le média '${imageId}' ne possède aucune variante valide.`
    );
  }
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

  // Validate consistency of referenced media
  validateReferencedMediaConsistency(
    validatedHome.showreel.coverImageId,
    "showreel_cover",
    current.content.media,
    "home.showreel.coverImageId"
  );
  validateReferencedMediaConsistency(
    validatedHome.duo.imageId,
    "duo",
    current.content.media,
    "home.duo.imageId"
  );

  const nextRevision = crypto.randomBytes(16).toString("hex");

  // Prune media registry to retain only currently active locations
  const activeMediaIds = new Set<string>();
  if (isUuid(validatedHome.showreel.coverImageId)) {
    activeMediaIds.add(validatedHome.showreel.coverImageId.toLowerCase());
  }
  if (isUuid(validatedHome.duo.imageId)) {
    activeMediaIds.add(validatedHome.duo.imageId.toLowerCase());
  }
  for (const member of current.content.studio.team.members) {
    if (isUuid(member.imageId)) {
      activeMediaIds.add(member.imageId.toLowerCase());
    }
  }

  const prunedMedia: Record<string, UploadedMediaMetadata> = {};
  for (const id of activeMediaIds) {
    if (current.content.media?.[id]) {
      prunedMedia[id] = current.content.media[id];
    }
  }

  const nextContent: SiteContent = {
    ...current.content,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
    home: validatedHome,
    media: prunedMedia,
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

  // Validate consistency of referenced media for studio team members
  for (const member of validatedStudio.team.members) {
    const expectedLoc: AdminUploadLocation =
      member.id === "ludovic" ? "portrait_ludovic" : "portrait_maxime";
    validateReferencedMediaConsistency(
      member.imageId,
      expectedLoc,
      current.content.media,
      `studio.team.members[${member.id}].imageId`
    );
  }

  const nextRevision = crypto.randomBytes(16).toString("hex");

  // Prune media registry to retain only currently active locations
  const activeMediaIds = new Set<string>();
  if (isUuid(current.content.home.showreel.coverImageId)) {
    activeMediaIds.add(current.content.home.showreel.coverImageId.toLowerCase());
  }
  if (isUuid(current.content.home.duo.imageId)) {
    activeMediaIds.add(current.content.home.duo.imageId.toLowerCase());
  }
  for (const member of validatedStudio.team.members) {
    if (isUuid(member.imageId)) {
      activeMediaIds.add(member.imageId.toLowerCase());
    }
  }

  const prunedMedia: Record<string, UploadedMediaMetadata> = {};
  for (const id of activeMediaIds) {
    if (current.content.media?.[id]) {
      prunedMedia[id] = current.content.media[id];
    }
  }

  const nextContent: SiteContent = {
    ...current.content,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
    studio: validatedStudio,
    media: prunedMedia,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}

export function saveSiteMediaUpdate(
  location: AdminUploadLocation,
  newMedia: UploadedMediaMetadata,
  previousRevision: string
): { newRevision: string; content: SiteContent } {
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError();
  }

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const nextContent: SiteContent = structuredClone(current.content);
  nextContent.revision = nextRevision;
  nextContent.updatedAt = new Date().toISOString();

  if (location === "showreel_cover") {
    nextContent.home.showreel.coverImageId = newMedia.imageId;
  } else if (location === "duo") {
    nextContent.home.duo.imageId = newMedia.imageId;
  } else if (location === "portrait_ludovic") {
    const member = nextContent.studio.team.members.find((m) => m.id === "ludovic");
    if (!member) {
      throw new ValidationError("Membre studio 'ludovic' introuvable.");
    }
    member.imageId = newMedia.imageId;
  } else if (location === "portrait_maxime") {
    const member = nextContent.studio.team.members.find((m) => m.id === "maxime");
    if (!member) {
      throw new ValidationError("Membre studio 'maxime' introuvable.");
    }
    member.imageId = newMedia.imageId;
  } else {
    throw new ValidationError(`Emplacement média non supporté: ${String(location)}`);
  }

  // Prune media registry to retain only currently active locations
  const activeMediaIds = new Set<string>();
  if (isUuid(nextContent.home.showreel.coverImageId)) {
    activeMediaIds.add(nextContent.home.showreel.coverImageId.toLowerCase());
  }
  if (isUuid(nextContent.home.duo.imageId)) {
    activeMediaIds.add(nextContent.home.duo.imageId.toLowerCase());
  }
  for (const member of nextContent.studio.team.members) {
    if (isUuid(member.imageId)) {
      activeMediaIds.add(member.imageId.toLowerCase());
    }
  }

  const prunedMedia: Record<string, UploadedMediaMetadata> = {};
  for (const id of activeMediaIds) {
    if (id === newMedia.imageId.toLowerCase()) {
      prunedMedia[id] = newMedia;
    } else if (current.content.media?.[id]) {
      prunedMedia[id] = current.content.media[id];
    }
  }
  nextContent.media = prunedMedia;

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return { newRevision: nextRevision, content: nextContent };
}

export function saveSiteMediaRevert(
  location: AdminUploadLocation,
  previousRevision: string
): { newRevision: string; content: SiteContent; defaultImageId: string } {
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError();
  }

  const defaultImageId = DEFAULT_LOCATION_IMAGES[location];
  if (!defaultImageId) {
    throw new ValidationError(`Emplacement média non supporté: ${String(location)}`);
  }

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const nextContent: SiteContent = structuredClone(current.content);
  nextContent.revision = nextRevision;
  nextContent.updatedAt = new Date().toISOString();

  if (location === "showreel_cover") {
    nextContent.home.showreel.coverImageId = defaultImageId;
  } else if (location === "duo") {
    nextContent.home.duo.imageId = defaultImageId;
  } else if (location === "portrait_ludovic") {
    const member = nextContent.studio.team.members.find((m) => m.id === "ludovic");
    if (!member) {
      throw new ValidationError("Membre studio 'ludovic' introuvable.");
    }
    member.imageId = defaultImageId;
  } else if (location === "portrait_maxime") {
    const member = nextContent.studio.team.members.find((m) => m.id === "maxime");
    if (!member) {
      throw new ValidationError("Membre studio 'maxime' introuvable.");
    }
    member.imageId = defaultImageId;
  }

  // Prune media registry to retain only currently active locations
  const activeMediaIds = new Set<string>();
  if (isUuid(nextContent.home.showreel.coverImageId)) {
    activeMediaIds.add(nextContent.home.showreel.coverImageId.toLowerCase());
  }
  if (isUuid(nextContent.home.duo.imageId)) {
    activeMediaIds.add(nextContent.home.duo.imageId.toLowerCase());
  }
  for (const member of nextContent.studio.team.members) {
    if (isUuid(member.imageId)) {
      activeMediaIds.add(member.imageId.toLowerCase());
    }
  }

  const prunedMedia: Record<string, UploadedMediaMetadata> = {};
  for (const id of activeMediaIds) {
    if (current.content.media?.[id]) {
      prunedMedia[id] = current.content.media[id];
    }
  }
  nextContent.media = prunedMedia;

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return { newRevision: nextRevision, content: nextContent, defaultImageId };
}

export interface SaveContactCoordinates {
  email?: string;
  instagramUrl?: string;
  youtubeUrl?: string;
}

export function saveContactPageContent(
  newContactPage: ContactPageContent,
  previousRevision: string,
  canonicalCoordinates?: SaveContactCoordinates
): string {
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError();
  }

  const validatedContact = validateContactPageContent(newContactPage);

  const updatedHome = structuredClone(current.content.home);
  if (canonicalCoordinates) {
    if (typeof canonicalCoordinates.email === "string") {
      const emailTrim = canonicalCoordinates.email.trim();
      if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
        throw new ValidationError("L'adresse e-mail canonique est invalide.");
      }
      updatedHome.contact.email = emailTrim;
    }
    if (typeof canonicalCoordinates.instagramUrl === "string") {
      const igTrim = canonicalCoordinates.instagramUrl.trim();
      if (igTrim && !/^https?:\/\//i.test(igTrim)) {
        throw new ValidationError("L'URL Instagram canonique doit être une URL HTTP(S) valide.");
      }
      updatedHome.contact.instagramUrl = igTrim;
    }
    if (typeof canonicalCoordinates.youtubeUrl === "string") {
      const ytTrim = canonicalCoordinates.youtubeUrl.trim();
      if (ytTrim && !/^https?:\/\//i.test(ytTrim)) {
        throw new ValidationError("L'URL YouTube canonique doit être une URL HTTP(S) valide.");
      }
      updatedHome.contact.youtubeUrl = ytTrim;
    }
  }

  const nextRevision = crypto.randomBytes(16).toString("hex");

  // Prune media registry to retain only currently active locations
  const activeMediaIds = new Set<string>();
  if (isUuid(updatedHome.showreel.coverImageId)) {
    activeMediaIds.add(updatedHome.showreel.coverImageId.toLowerCase());
  }
  if (isUuid(updatedHome.duo.imageId)) {
    activeMediaIds.add(updatedHome.duo.imageId.toLowerCase());
  }
  for (const member of current.content.studio.team.members) {
    if (isUuid(member.imageId)) {
      activeMediaIds.add(member.imageId.toLowerCase());
    }
  }

  const prunedMedia: Record<string, UploadedMediaMetadata> = {};
  for (const id of activeMediaIds) {
    if (current.content.media?.[id]) {
      prunedMedia[id] = current.content.media[id];
    }
  }

  const nextContent: SiteContent = {
    ...current.content,
    schemaVersion: 2,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
    home: updatedHome,
    contactPage: validatedContact,
    media: prunedMedia,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}
