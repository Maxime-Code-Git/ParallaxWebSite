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
  type SiteContentV2,
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
  type CompanyContent,
  DEFAULT_COMPANY_CONTENT,
  type LegalPageKey,
  LEGAL_PAGE_KEYS,
  type LegalSection,
  type CookieInventoryItem,
  type LegalDocument,
  type LegalPageRecord,
  type LegalPagesContent,
  DEFAULT_LEGAL_PAGES_CONTENT,
} from "./site-content.shared";

export class RevisionConflictError extends Error {
  public serverRevision?: string;
  constructor(
    message = "Conflit de révision. Le contenu a été modifié par un autre processus.",
    serverRevision?: string
  ) {
    super(message);
    this.name = "RevisionConflictError";
    this.serverRevision = serverRevision;
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
      "address",
      "enterpriseNumber",
      "vatNumber",
      "vatRegime",
      "publicationDirector",
      "privacyContact",
      "hostingProvider",
      "hostingAddress",
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

  if (obj.vatRegime !== undefined && typeof obj.vatRegime !== "string") {
    throw new ValidationError("company.vatRegime doit être une chaîne de caractères.");
  }

  if (obj.isPublished !== undefined && typeof obj.isPublished !== "boolean") {
    throw new ValidationError("company.isPublished doit être un booléen.");
  }

  const emailTrim = (obj.email as string).trim();
  if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
    throw new ValidationError("company.email doit être une adresse e-mail valide.");
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
    address: (obj.address as string).trim(),
    enterpriseNumber: (obj.enterpriseNumber as string).trim(),
    vatNumber: (obj.vatNumber as string).trim(),
    vatRegime: obj.vatRegime !== undefined ? (obj.vatRegime as string).trim() : "",
    publicationDirector: (obj.publicationDirector as string).trim(),
    privacyContact: (obj.privacyContact as string).trim(),
    hostingProvider: (obj.hostingProvider as string).trim(),
    hostingAddress: (obj.hostingAddress as string).trim(),
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
      if (typeof val === "string" && containsUnresolvedPlaceholders(val)) {
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
  company.email = v2.home?.contact?.email ?? "";
  company.phone = v2.contactPage?.card?.phone ?? "";
  company.instagramUrl = v2.home?.contact?.instagramUrl ?? "";
  company.youtubeUrl = v2.home?.contact?.youtubeUrl ?? "";
  company.tradeName = v2.common?.brandName || "Parallax";
  company.isPublished = false;

  return {
    schemaVersion: 3,
    revision: v2.revision,
    updatedAt: v2.updatedAt,
    common: structuredClone(v2.common),
    home: structuredClone(v2.home),
    studio: structuredClone(v2.studio),
    contactPage: structuredClone(v2.contactPage),
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
      home: validateHomeContent(obj.home),
      studio: validateStudioContent(obj.studio),
      media,
    };
    const v2Content = migrateSiteContentV1ToV2(v1Content);
    return migrateSiteContentV2ToV3(v2Content);
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
      home: validateHomeContent(obj.home),
      studio: validateStudioContent(obj.studio),
      contactPage: validateContactPageContent(obj.contactPage),
      media,
    };
    return migrateSiteContentV2ToV3(v2Content);
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
    if (parsed.schemaVersion === 1 || parsed.schemaVersion === 2) {
      try {
        atomicWriteJson(filePath, validated);
      } catch (writeErr) {
        console.warn("Notice: Impossible d'écrire la migration V3 sur le disque:", writeErr);
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

  const updatedCompany = structuredClone(current.content.company);
  updatedCompany.email = validatedHome.contact.email;
  updatedCompany.instagramUrl = validatedHome.contact.instagramUrl;
  updatedCompany.youtubeUrl = validatedHome.contact.youtubeUrl;

  const nextContent: SiteContent = {
    ...current.content,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
    home: validatedHome,
    company: updatedCompany,
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

  const updatedCompany = structuredClone(current.content.company);
  updatedCompany.phone = validatedContact.card.phone;
  if (canonicalCoordinates) {
    if (typeof canonicalCoordinates.email === "string") {
      updatedCompany.email = canonicalCoordinates.email.trim();
    }
    if (typeof canonicalCoordinates.instagramUrl === "string") {
      updatedCompany.instagramUrl = canonicalCoordinates.instagramUrl.trim();
    }
    if (typeof canonicalCoordinates.youtubeUrl === "string") {
      updatedCompany.youtubeUrl = canonicalCoordinates.youtubeUrl.trim();
    }
  }

  const nextContent: SiteContent = {
    ...current.content,
    schemaVersion: 3,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
    home: updatedHome,
    contactPage: validatedContact,
    company: updatedCompany,
    media: prunedMedia,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}

export function saveCompanyContent(
  newCompany: CompanyContent,
  previousRevision: string
): string {
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError(undefined, current.content.revision);
  }

  const validatedCompany = validateCompanyContent(newCompany);

  // Synchronize canonical coordinates
  const updatedCommon = structuredClone(current.content.common);
  if (validatedCompany.tradeName) {
    updatedCommon.brandName = validatedCompany.tradeName;
  }

  const updatedHome = structuredClone(current.content.home);
  updatedHome.contact.email = validatedCompany.email;
  updatedHome.contact.instagramUrl = validatedCompany.instagramUrl;
  updatedHome.contact.youtubeUrl = validatedCompany.youtubeUrl;

  const updatedContactPage = structuredClone(current.content.contactPage);
  updatedContactPage.card.phone = validatedCompany.phone;

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
    schemaVersion: 3,
    revision: nextRevision,
    updatedAt: new Date().toISOString(),
    common: updatedCommon,
    home: updatedHome,
    contactPage: updatedContactPage,
    company: validatedCompany,
    media: prunedMedia,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}

export function saveLegalPageDraft(
  pageKey: LegalPageKey,
  draft: LegalDocument,
  previousRevision: string
): string {
  if (!LEGAL_PAGE_KEYS.includes(pageKey)) {
    throw new ValidationError(`Clé de page légale invalide: '${String(pageKey)}'`);
  }
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError(undefined, current.content.revision);
  }

  const validatedDraft = validateLegalDocument(draft, `legalPages.${pageKey}.draft`);

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const updatedLegalPages = structuredClone(current.content.legalPages);
  const now = new Date().toISOString();

  updatedLegalPages[pageKey] = {
    ...updatedLegalPages[pageKey],
    draft: validatedDraft,
    lastUpdated: now,
  };

  const nextContent: SiteContent = {
    ...current.content,
    schemaVersion: 3,
    revision: nextRevision,
    updatedAt: now,
    legalPages: updatedLegalPages,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}

const FRENCH_MONTH_MAP: Record<string, number> = {
  janvier: 1,
  février: 2,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
  decembre: 12,
};

const ENGLISH_MONTH_MAP: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 2000 || year > 2099) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export function validateEffectiveDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  if (!trimmed) {
    throw new ValidationError("Une date d'entrée en vigueur est obligatoire pour publier le document.");
  }
  if (containsUnresolvedPlaceholders(trimmed)) {
    throw new ValidationError("La date d'entrée en vigueur contient des mentions non complétées (placeholders).");
  }

  // 1. ISO format: YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (!isValidCalendarDate(y, m, d)) {
      throw new ValidationError(
        `La date d'entrée en vigueur '${trimmed}' n'est pas une date de calendrier valide.`
      );
    }
    return trimmed;
  }

  // 2. French textual format: e.g. "15 octobre 2026" or "1er octobre 2026" or "le 15 octobre 2026"
  const frMatch = trimmed.match(/^(?:le\s+)?(\d{1,2}|1er)\s+([a-zA-Zéûùàîïôë]+)\s+(\d{4})$/i);
  if (frMatch) {
    const day = frMatch[1].toLowerCase() === "1er" ? 1 : parseInt(frMatch[1], 10);
    const monthName = frMatch[2].toLowerCase();
    const year = parseInt(frMatch[3], 10);
    const month = FRENCH_MONTH_MAP[monthName];
    if (month && isValidCalendarDate(year, month, day)) {
      return trimmed;
    }
    throw new ValidationError(
      `La date d'entrée en vigueur '${trimmed}' n'est pas une date de calendrier valide.`
    );
  }

  // 3. English textual format: e.g. "October 15, 2026", "15 October 2026", "15th October 2026"
  const enMatch1 = trimmed.match(/^([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (enMatch1) {
    const monthName = enMatch1[1].toLowerCase();
    const day = parseInt(enMatch1[2], 10);
    const year = parseInt(enMatch1[3], 10);
    const month = ENGLISH_MONTH_MAP[monthName];
    if (month && isValidCalendarDate(year, month, day)) {
      return trimmed;
    }
    throw new ValidationError(
      `La date d'entrée en vigueur '${trimmed}' n'est pas une date de calendrier valide.`
    );
  }

  const enMatch2 = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]+),?\s+(\d{4})$/i);
  if (enMatch2) {
    const day = parseInt(enMatch2[1], 10);
    const monthName = enMatch2[2].toLowerCase();
    const year = parseInt(enMatch2[3], 10);
    const month = ENGLISH_MONTH_MAP[monthName];
    if (month && isValidCalendarDate(year, month, day)) {
      return trimmed;
    }
    throw new ValidationError(
      `La date d'entrée en vigueur '${trimmed}' n'est pas une date de calendrier valide.`
    );
  }

  throw new ValidationError(
    "La date d'entrée en vigueur doit être une date valide avec une année à 4 chiffres (ex: '15 octobre 2026' ou '2026-10-15')."
  );
}

export function publishLegalPage(
  pageKey: LegalPageKey,
  previousRevision: string,
  effectiveDateOverride?: string,
  candidateDraft?: LegalDocument
): string {
  if (!LEGAL_PAGE_KEYS.includes(pageKey)) {
    throw new ValidationError(`Clé de page légale invalide: '${String(pageKey)}'`);
  }
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError(undefined, current.content.revision);
  }

  const pageRecord = current.content.legalPages[pageKey];
  let draft = pageRecord.draft;

  if (candidateDraft) {
    draft = validateLegalDocument(candidateDraft, "candidateDraft");
  }

  // Strict server-side validation for publication
  if (!draft.seoTitle.fr?.trim() || !draft.seoTitle.en?.trim()) {
    throw new ValidationError("Le titre SEO (FR et EN) est obligatoire pour publier.");
  }
  if (containsUnresolvedPlaceholders(draft.seoTitle.fr) || containsUnresolvedPlaceholders(draft.seoTitle.en)) {
    throw new ValidationError("Le titre SEO contient des mentions non complétées (placeholders).");
  }

  if (!draft.seoDescription.fr?.trim() || !draft.seoDescription.en?.trim()) {
    throw new ValidationError("La description SEO (FR et EN) est obligatoire pour publier.");
  }
  if (containsUnresolvedPlaceholders(draft.seoDescription.fr) || containsUnresolvedPlaceholders(draft.seoDescription.en)) {
    throw new ValidationError("La description SEO contient des mentions non complétées (placeholders).");
  }

  if (!draft.publicTitle.fr?.trim() || !draft.publicTitle.en?.trim()) {
    throw new ValidationError("Le titre public (FR et EN) est obligatoire pour publier.");
  }
  if (containsUnresolvedPlaceholders(draft.publicTitle.fr) || containsUnresolvedPlaceholders(draft.publicTitle.en)) {
    throw new ValidationError("Le titre public contient des mentions non complétées (placeholders).");
  }

  if (!draft.intro.fr?.trim() || !draft.intro.en?.trim()) {
    throw new ValidationError("L'introduction (FR et EN) est obligatoire pour publier.");
  }
  if (containsUnresolvedPlaceholders(draft.intro.fr) || containsUnresolvedPlaceholders(draft.intro.en)) {
    throw new ValidationError("L'introduction contient des mentions non complétées (placeholders).");
  }

  const effectiveDate = validateEffectiveDate(effectiveDateOverride?.trim() || draft.effectiveDate?.trim() || "");

  if (draft.sections.length === 0) {
    throw new ValidationError("Au moins une section de contenu est requise pour publier.");
  }

  const sectionIds = new Set<string>();
  for (const [idx, s] of draft.sections.entries()) {
    if (sectionIds.has(s.id)) {
      throw new ValidationError(`Identifiant de section dupliqué: '${s.id}'.`);
    }
    sectionIds.add(s.id);

    if (!s.title.fr?.trim() || !s.title.en?.trim()) {
      throw new ValidationError(`La section #${idx + 1} ('${s.id}') manque d'un titre FR ou EN.`);
    }

    if (containsUnresolvedPlaceholders(s.title.fr) || containsUnresolvedPlaceholders(s.title.en)) {
      throw new ValidationError(`La section '${s.id}' contient des mentions non complétées (placeholders).`);
    }

    if (!Array.isArray(s.paragraphs) || s.paragraphs.length === 0) {
      throw new ValidationError(`La section '${s.id}' doit contenir au moins un paragraphe.`);
    }

    for (const [pIdx, p] of s.paragraphs.entries()) {
      if (!p.fr?.trim() || !p.en?.trim()) {
        throw new ValidationError(`Le paragraphe #${pIdx + 1} de la section '${s.id}' est vide.`);
      }
      if (containsUnresolvedPlaceholders(p.fr) || containsUnresolvedPlaceholders(p.en)) {
        throw new ValidationError(`Le paragraphe #${pIdx + 1} de la section '${s.id}' contient des mentions non complétées.`);
      }
    }

    for (const li of s.listItems || []) {
      if (!li.fr?.trim() || !li.en?.trim()) {
        throw new ValidationError(`Un élément de liste de la section '${s.id}' est vide.`);
      }
      if (containsUnresolvedPlaceholders(li.fr) || containsUnresolvedPlaceholders(li.en)) {
        throw new ValidationError(`Un élément de liste de la section '${s.id}' contient des mentions non complétées.`);
      }
    }
  }

  if (pageKey === "cookies") {
    if (!draft.inventory || draft.inventory.length === 0) {
      throw new ValidationError("La politique cookies requiert un inventaire technique documenté pour publication.");
    }
    const cookieIds = new Set<string>();
    for (const c of draft.inventory) {
      if (cookieIds.has(c.id)) {
        throw new ValidationError(`Identifiant de cookie dupliqué dans l'inventaire: '${c.id}'.`);
      }
      cookieIds.add(c.id);

      if (!c.name.fr?.trim() || !c.name.en?.trim()) {
        throw new ValidationError(`Le cookie '${c.id}' manque d'un nom FR ou EN.`);
      }
      if (containsUnresolvedPlaceholders(c.name.fr) || containsUnresolvedPlaceholders(c.name.en)) {
        throw new ValidationError(`Le cookie '${c.id}' contient des mentions non complétées.`);
      }
      if (!c.provider.fr?.trim() || !c.provider.en?.trim()) {
        throw new ValidationError(`Le cookie '${c.id}' manque d'un fournisseur FR ou EN.`);
      }
      if (containsUnresolvedPlaceholders(c.provider.fr) || containsUnresolvedPlaceholders(c.provider.en)) {
        throw new ValidationError(`Le fournisseur du cookie '${c.id}' contient des mentions non complétées.`);
      }
      if (!c.purpose.fr?.trim() || !c.purpose.en?.trim()) {
        throw new ValidationError(`Le cookie '${c.id}' manque d'une finalité FR ou EN.`);
      }
      if (containsUnresolvedPlaceholders(c.purpose.fr) || containsUnresolvedPlaceholders(c.purpose.en)) {
        throw new ValidationError(`La finalité du cookie '${c.id}' contient des mentions non complétées.`);
      }
      if (!c.duration.fr?.trim() || !c.duration.en?.trim()) {
        throw new ValidationError(`Le cookie '${c.id}' manque d'une durée FR ou EN.`);
      }
      if (containsUnresolvedPlaceholders(c.duration.fr) || containsUnresolvedPlaceholders(c.duration.en)) {
        throw new ValidationError(`La durée du cookie '${c.id}' contient des mentions non complétées.`);
      }
    }
  }

  if (pageKey === "mentions") {
    const comp = current.content.company;
    if (!comp.isPublished) {
      throw new ValidationError(
        "Les paramètres d'entreprise doivent être confirmés et publiés avant de publier les mentions légales."
      );
    }
    if (
      !comp.legalName ||
      !comp.legalForm ||
      !comp.address ||
      !comp.enterpriseNumber ||
      !comp.publicationDirector ||
      !comp.hostingProvider ||
      !comp.hostingAddress
    ) {
      throw new ValidationError(
        "Les mentions d'entreprise indispensables (dénomination légale, forme, siège social, BCE, directeur de publication, hébergeur) doivent être renseignées avant de publier les mentions légales."
      );
    }
    if (
      containsUnresolvedPlaceholders(comp.legalName) ||
      containsUnresolvedPlaceholders(comp.address) ||
      containsUnresolvedPlaceholders(comp.enterpriseNumber) ||
      containsUnresolvedPlaceholders(comp.publicationDirector) ||
      containsUnresolvedPlaceholders(comp.hostingProvider) ||
      containsUnresolvedPlaceholders(comp.hostingAddress)
    ) {
      throw new ValidationError(
        "Les paramètres d'entreprise contiennent des mentions non complétées (placeholders)."
      );
    }
  }

  const currentVersion = Math.max(pageRecord.published?.version ?? 0, pageRecord.draft?.version ?? 0);
  const nextVersion = currentVersion > 0 ? currentVersion + 1 : 1;
  const now = new Date().toISOString();

  const publishedDoc: LegalDocument = {
    ...structuredClone(draft),
    effectiveDate,
    version: nextVersion,
  };

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const updatedLegalPages = structuredClone(current.content.legalPages);

  updatedLegalPages[pageKey] = {
    draft: { ...structuredClone(draft), effectiveDate, version: nextVersion },
    published: publishedDoc,
    lastUpdated: now,
  };

  const nextContent: SiteContent = {
    ...current.content,
    schemaVersion: 3,
    revision: nextRevision,
    updatedAt: now,
    legalPages: updatedLegalPages,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}

export function unpublishLegalPage(
  pageKey: LegalPageKey,
  previousRevision: string
): string {
  if (!LEGAL_PAGE_KEYS.includes(pageKey)) {
    throw new ValidationError(`Clé de page légale invalide: '${String(pageKey)}'`);
  }
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    throw new CorruptedContentError();
  }
  if (current.content.revision !== previousRevision) {
    throw new RevisionConflictError(undefined, current.content.revision);
  }

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const updatedLegalPages = structuredClone(current.content.legalPages);
  const now = new Date().toISOString();

  const pageRecord = updatedLegalPages[pageKey];
  const lastVersion = Math.max(pageRecord.published?.version ?? 0, pageRecord.draft?.version ?? 0);
  const updatedDraft = {
    ...structuredClone(pageRecord.draft),
    version: lastVersion > 0 ? lastVersion : 1,
  };

  updatedLegalPages[pageKey] = {
    draft: updatedDraft,
    published: null,
    lastUpdated: now,
  };

  const nextContent: SiteContent = {
    ...current.content,
    schemaVersion: 3,
    revision: nextRevision,
    updatedAt: now,
    legalPages: updatedLegalPages,
  };

  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, nextContent);
  return nextRevision;
}

export function getPublicLegalDocument(pageKey: LegalPageKey): LegalDocument | null {
  if (!LEGAL_PAGE_KEYS.includes(pageKey)) return null;
  const content = getSiteContent();
  return content.legalPages?.[pageKey]?.published ?? null;
}

export function getPublicCompanyContent(): Partial<CompanyContent> {
  const content = getSiteContent();
  const c = content.company;
  if (!c) return {};

  if (c.isPublished) {
    return structuredClone(c);
  }

  // If not confirmed for public publication, only return public-facing vitrine coordinates
  return {
    tradeName: c.tradeName || content.common?.brandName || "Parallax",
    email: c.email || content.home?.contact?.email || "",
    phone: c.phone || content.contactPage?.card?.phone || "",
    instagramUrl: c.instagramUrl || content.home?.contact?.instagramUrl || "",
    youtubeUrl: c.youtubeUrl || content.home?.contact?.youtubeUrl || "",
    isPublished: false,
  };
}
