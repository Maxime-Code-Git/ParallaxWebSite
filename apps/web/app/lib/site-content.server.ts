import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import defaultContent from "../content/default-site-content.json";
import { atomicWriteJson } from "./atomic-fs.server";
import { ENV } from "./env.server";

export * from "./site-content.shared";
import {
  ALLOWED_IMAGE_MAP,
  type HomeContent,
  type SiteContent,
  type StudioContent,
  type ContactPageContent,
  type AdminUploadLocation,
  DEFAULT_LOCATION_IMAGES,
  type UploadedMediaMetadata,
  type CompanyContent,
  type LegalPageKey,
  LEGAL_PAGE_KEYS,
  type LegalDocument,
  DEFAULT_LEGAL_PAGES_CONTENT,
  resolveLegalDocument,
  findDocumentUnresolvedCompanyTokens,
  isRpmApplicable,
  getLegalPersonalityType,
  getVatRegimeType,
  COMPANY_TOKEN_DETAILS,
  cleanHomeContent,
  cleanStudioContent,
  cleanContactContent,
  cleanLegalDocument,
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

import {
  ValidationError,
  validateLocalizedString,
  validateAllowedImageId,
  validateMediaVariantInfo,
  validateUploadedMediaMetadata,
  validateCommonContent,
  type ValidateHomeOptions,
  validateHomeContent,
  validateStudioMember,
  validateStudioContent,
  validateProjectTypeOption,
  type ValidateContactPageOptions,
  validateContactPageContent,
  containsUnresolvedPlaceholders,
  validateCompanyContent,
  validateLegalSection,
  validateCookieInventoryItem,
  validateLegalDocument,
  validateLegalPageRecord,
  validateLegalPagesContent,
  migrateSiteContentV1ToV2,
  migrateSiteContentV2ToV3,
  validateSiteContent,
} from "@parallax/shared";

export {
  ValidationError,
  validateLocalizedString,
  validateAllowedImageId,
  validateMediaVariantInfo,
  validateUploadedMediaMetadata,
  validateCommonContent,
  type ValidateHomeOptions,
  validateHomeContent,
  validateStudioMember,
  validateStudioContent,
  validateProjectTypeOption,
  type ValidateContactPageOptions,
  validateContactPageContent,
  containsUnresolvedPlaceholders,
  validateCompanyContent,
  validateLegalSection,
  validateCookieInventoryItem,
  validateLegalDocument,
  validateLegalPageRecord,
  validateLegalPagesContent,
  migrateSiteContentV1ToV2,
  migrateSiteContentV2ToV3,
  validateSiteContent,
};

export function getSiteContentFilePath(): string {
  return ENV.SITE_CONTENT_PATH;
}

export function ensureSiteContentFileInitialized(): string {
  const filePath = getSiteContentFilePath();
  if (!fs.existsSync(filePath)) {
    const validated = validateSiteContent(defaultContent);
    atomicWriteJson(filePath, validated);
  }
  return filePath;
}

export function getRawSiteContent(): { content: SiteContent; isCorrupted: boolean; corruptionError?: string } {
  try {
    const filePath = ensureSiteContentFileInitialized();
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    const rawVersion = parsed.schemaVersion === undefined ? 1 : parsed.schemaVersion;
    const validated = validateSiteContent(parsed);
    if (rawVersion === 1 || rawVersion === 2) {
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
    const sanitizedError = err instanceof Error ? err.message : "Erreur de format ou de validation";
    return { content: validateSiteContent(defaultContent), isCorrupted: true, corruptionError: sanitizedError };
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

  const validatedHome = validateHomeContent(cleanHomeContent(newHome));

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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
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

  const validatedStudio = validateStudioContent(cleanStudioContent(newStudio));

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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
  return { newRevision: nextRevision, content: fullyValidated };
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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
  return { newRevision: nextRevision, content: fullyValidated, defaultImageId };
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

  const validatedContact = validateContactPageContent(cleanContactContent(newContactPage));

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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
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

  const validatedDraft = validateLegalDocument(cleanLegalDocument(draft), `legalPages.${pageKey}.draft`);

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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
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
  let draft = cleanLegalDocument(pageRecord.draft);

  if (candidateDraft) {
    draft = validateLegalDocument(cleanLegalDocument(candidateDraft), "candidateDraft");
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

  const comp = current.content.company;

  // Validate that all company tokens used in the document can be resolved
  const unresolvedTokens = findDocumentUnresolvedCompanyTokens(draft, comp);
  if (unresolvedTokens.length > 0) {
    const formattedList = unresolvedTokens
      .map((tok) => {
        const details = COMPANY_TOKEN_DETAILS[tok];
        if (details) {
          return `${details.labelFr} (dans '${details.sectionFr}', /admin/company)`;
        }
        return tok;
      })
      .join(", ");
    throw new ValidationError(
      `Le document fait référence à des informations d'entreprise non renseignées ou incomplètes : ${formattedList}. Veuillez compléter ces champs dans 'Paramètres de l'entreprise' (/admin/company) avant de publier.`
    );
  }

  // Check if document references company tokens
  const hasCompanyTokens = (text?: string) => Boolean(text && /\{\{company\./.test(text));
  const docUsesCompanyTokens =
    hasCompanyTokens(draft.seoTitle.fr) ||
    hasCompanyTokens(draft.seoTitle.en) ||
    hasCompanyTokens(draft.seoDescription.fr) ||
    hasCompanyTokens(draft.seoDescription.en) ||
    hasCompanyTokens(draft.publicTitle.fr) ||
    hasCompanyTokens(draft.publicTitle.en) ||
    hasCompanyTokens(draft.intro.fr) ||
    hasCompanyTokens(draft.intro.en) ||
    draft.sections.some(
      (s) =>
        hasCompanyTokens(s.title.fr) ||
        hasCompanyTokens(s.title.en) ||
        s.paragraphs.some((p) => hasCompanyTokens(p.fr) || hasCompanyTokens(p.en)) ||
        (s.listItems || []).some((li) => hasCompanyTokens(li.fr) || hasCompanyTokens(li.en))
    );

  if ((docUsesCompanyTokens || pageKey === "mentions") && !comp.isPublished) {
    throw new ValidationError(
      "Les paramètres d'entreprise doivent être confirmés et publiés dans 'Paramètres de l'entreprise' avant de publier ce document légal."
    );
  }

  // Validate resolved text for any placeholders
  const resolved = resolveLegalDocument(draft, comp, "public");
  if (containsUnresolvedPlaceholders(resolved.seoTitle.fr) || containsUnresolvedPlaceholders(resolved.seoTitle.en)) {
    throw new ValidationError("Le titre SEO résolu contient des mentions non complétées (placeholders).");
  }
  if (containsUnresolvedPlaceholders(resolved.seoDescription.fr) || containsUnresolvedPlaceholders(resolved.seoDescription.en)) {
    throw new ValidationError("La description SEO résolue contient des mentions non complétées (placeholders).");
  }
  if (containsUnresolvedPlaceholders(resolved.publicTitle.fr) || containsUnresolvedPlaceholders(resolved.publicTitle.en)) {
    throw new ValidationError("Le titre public résolu contient des mentions non complétées (placeholders).");
  }
  if (containsUnresolvedPlaceholders(resolved.intro.fr) || containsUnresolvedPlaceholders(resolved.intro.en)) {
    throw new ValidationError("L'introduction résolue contient des mentions non complétées (placeholders).");
  }
  for (const s of resolved.sections) {
    if (containsUnresolvedPlaceholders(s.title.fr) || containsUnresolvedPlaceholders(s.title.en)) {
      throw new ValidationError(`La section '${s.id}' résolue contient des mentions non complétées.`);
    }
    for (const p of s.paragraphs) {
      if (containsUnresolvedPlaceholders(p.fr) || containsUnresolvedPlaceholders(p.en)) {
        throw new ValidationError(`Un paragraphe de la section '${s.id}' résolue contient des mentions non complétées.`);
      }
    }
    for (const li of s.listItems || []) {
      if (containsUnresolvedPlaceholders(li.fr) || containsUnresolvedPlaceholders(li.en)) {
        throw new ValidationError(`Un élément de liste de la section '${s.id}' résolue contient des mentions non complétées.`);
      }
    }
  }

  if (pageKey === "mentions") {
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
    if (isRpmApplicable(comp) === true && !comp.rpmJurisdiction?.trim()) {
      throw new ValidationError(
        "Pour une personne morale, l'indication du Registre des Personnes Morales (RPM) compétent est obligatoire (art. 2:20 CSA). Veuillez renseigner 'RPM / Tribunal de l'entreprise compétent' dans 'Paramètres de l'entreprise' (/admin/company) avant de publier."
      );
    }
    if (isRpmApplicable(comp) === undefined) {
      throw new ValidationError(
        "La situation juridique de l'entreprise doit être confirmée dans 'Paramètres de l'entreprise' (/admin/company) afin de déterminer si le Registre des Personnes Morales (RPM) s'applique aux mentions légales."
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

  if (pageKey === "terms") {
    if (!comp.vatRegime?.trim()) {
      throw new ValidationError(
        "Le document fait référence à des informations d'entreprise non renseignées ou incomplètes : Régime TVA (dans 'Identité & Statut juridique', /admin/company). Veuillez renseigner votre régime TVA dans 'Paramètres de l'entreprise' (/admin/company) avant de publier les CGV."
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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
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

  const fullyValidated = validateSiteContent(nextContent);
  const filePath = getSiteContentFilePath();
  atomicWriteJson(filePath, fullyValidated);
  return nextRevision;
}

export function getPublicLegalDocument(pageKey: LegalPageKey): LegalDocument | null {
  if (!LEGAL_PAGE_KEYS.includes(pageKey)) return null;
  const content = getSiteContent();
  const doc = content.legalPages?.[pageKey]?.published ?? null;
  if (!doc) return null;
  return cleanLegalDocument(doc);
}

export function getPublicCompanyContent(): Partial<CompanyContent> {
  const content = getSiteContent();
  const c = content.company;
  if (!c) return {};

  if (c.isPublished) {
    // Explicit public projection allowlist: only expose public-facing and confirmed legal fields,
    // never internal tokens, secrets or server-level fields.
    return {
      tradeName: c.tradeName || content.common?.brandName || "Parallax",
      legalName: c.legalName,
      legalForm: c.legalForm,
      address: c.address,
      enterpriseNumber: c.enterpriseNumber,
      vatNumber: c.vatNumber,
      vatRegime: c.vatRegime || "",
      rpmJurisdiction: c.rpmJurisdiction || "",
      publicationDirector: c.publicationDirector,
      privacyContact: c.privacyContact || "",
      privacyEmail: c.privacyEmail || "",
      dpoDesignated: Boolean(c.dpoDesignated),
      dpoContact: c.dpoContact || "",
      hostingProvider: c.hostingProvider,
      hostingAddress: c.hostingAddress,
      hostingCountry: c.hostingCountry || "",
      emailService: c.emailService || "",
      galleryStorageService: c.galleryStorageService || "",
      retentionContactRequests: c.retentionContactRequests || "",
      retentionClientRecords: c.retentionClientRecords || "",
      retentionMediaGalleries: c.retentionMediaGalleries || "",
      clientTypes: c.clientTypes || "",
      phone: c.phone || content.contactPage?.card?.phone || "",
      email: c.email || content.home?.contact?.email || "",
      instagramUrl: c.instagramUrl || content.home?.contact?.instagramUrl || "",
      youtubeUrl: c.youtubeUrl || content.home?.contact?.youtubeUrl || "",
      isPublished: true,
    };
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

export interface ApplyDraftsResult {
  changed: boolean;
  message: string;
  appliedKeys: LegalPageKey[];
  backupPath: string | null;
  newRevision: string | null;
}

/**
 * Idempotently applies reference legal drafts to the installation's drafts on disk.
 * Creates an out-of-rotation safety backup (.safety.bak) prior to writing.
 * Preserves published documents, other sections, media, and draft versions.
 */
export function applyDefaultLegalDrafts(customFilePath?: string): ApplyDraftsResult {
  const filePath = customFilePath || getSiteContentFilePath();
  if (!fs.existsSync(filePath)) {
    return {
      changed: false,
      message: "Fichier de configuration inexistant.",
      appliedKeys: [],
      backupPath: null,
      newRevision: null,
    };
  }

  const rawJson = fs.readFileSync(filePath, "utf-8");
  let content: SiteContent;
  try {
    content = JSON.parse(rawJson);
  } catch {
    throw new CorruptedContentError();
  }

  if (!content.legalPages) {
    throw new ValidationError("Le contenu ne contient pas de section legalPages.");
  }

  // Idempotency check: compare existing drafts against default reference drafts
  let needsUpdate = false;
  const targetKeys: LegalPageKey[] = ["mentions", "privacy", "terms", "cookies"];
  for (const key of targetKeys) {
    const existingDraft = content.legalPages[key]?.draft;
    const refDraft = DEFAULT_LEGAL_PAGES_CONTENT[key].draft;
    if (!existingDraft) {
      needsUpdate = true;
      break;
    }
    if (existingDraft.sections.length !== refDraft.sections.length) {
      needsUpdate = true;
      break;
    }
    if (existingDraft.intro.fr !== refDraft.intro.fr) {
      needsUpdate = true;
      break;
    }
    if (key === "cookies") {
      if ((existingDraft.inventory?.length ?? 0) !== (refDraft.inventory?.length ?? 0)) {
        needsUpdate = true;
        break;
      }
    }
    if (key === "terms") {
      const disputesSec = existingDraft.sections.find((s) => s.id === "disputes_law");
      const hasOutdatedDispute = disputesSec?.paragraphs.some(
        (p) => p.fr.includes("{{company.rpmJurisdiction}}") || p.fr.includes("ou Bruxelles")
      );
      if (hasOutdatedDispute) {
        needsUpdate = true;
        break;
      }
    }
  }

  if (!needsUpdate) {
    return {
      changed: false,
      message: "Les 4 brouillons légaux sont déjà à jour avec la rédaction de référence.",
      appliedKeys: [],
      backupPath: null,
      newRevision: content.revision,
    };
  }

  // Create an explicit private safety backup out of rotation (0o600 permissions)
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, ".json");
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const safetyBackupPath = path.join(dir, `${baseName}.pre-legal-drafts-${timestamp}-${randomSuffix}.safety.bak`);
  fs.copyFileSync(filePath, safetyBackupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(safetyBackupPath, 0o600);

  // Apply reference drafts, preserving existing published versions and any draft version counters
  const updatedLegalPages = structuredClone(content.legalPages);
  const now = new Date().toISOString();
  const appliedKeys: LegalPageKey[] = [];

  for (const key of targetKeys) {
    const existingRecord = updatedLegalPages[key];
    const refDraft = structuredClone(DEFAULT_LEGAL_PAGES_CONTENT[key].draft);
    const existingVersion = existingRecord?.draft?.version ?? 0;
    const existingEffective = existingRecord?.draft?.effectiveDate || "";

    updatedLegalPages[key] = {
      draft: {
        ...refDraft,
        version: existingVersion,
        effectiveDate: existingEffective,
      },
      published: existingRecord?.published ?? null,
      lastUpdated: now,
    };
    appliedKeys.push(key);
  }

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const nextContent: SiteContent = {
    ...content,
    schemaVersion: 3,
    revision: nextRevision,
    updatedAt: now,
    legalPages: updatedLegalPages,
  };

  const fullyValidated = validateSiteContent(nextContent);
  atomicWriteJson(filePath, fullyValidated);

  return {
    changed: true,
    message: "Les 4 brouillons légaux ont été mis à jour avec succès.",
    appliedKeys,
    backupPath: safetyBackupPath,
    newRevision: nextRevision,
  };
}

export interface AdaptDraftsResult {
  changed: boolean;
  message: string;
  adaptedKeys: LegalPageKey[];
  backupPath: string | null;
  newRevision: string | null;
}

/**
 * Targeted and idempotent adaptation of existing legal drafts and company status.
 * Replaces the outdated dispute clause in terms.draft with the neutral Belgian jurisdiction clause.
 * Preserves all published pages, coordinates, custom sections, and draft versions.
 * Normalizes legalPersonality and vatRegimeType if detectable and empty.
 * Creates an out-of-rotation safety backup (.safety.bak) prior to writing if changes are needed.
 */
export function adaptExistingLegalDrafts(customFilePath?: string): AdaptDraftsResult {
  const filePath = customFilePath || getSiteContentFilePath();
  if (!fs.existsSync(filePath)) {
    return {
      changed: false,
      message: "Fichier de configuration inexistant.",
      adaptedKeys: [],
      backupPath: null,
      newRevision: null,
    };
  }

  const rawJson = fs.readFileSync(filePath, "utf-8");
  let content: SiteContent;
  try {
    content = JSON.parse(rawJson);
  } catch {
    throw new CorruptedContentError();
  }

  if (!content.legalPages) {
    throw new ValidationError("Le contenu ne contient pas de section legalPages.");
  }

  let needsUpdate = false;
  const updatedLegalPages = structuredClone(content.legalPages);
  const adaptedKeys: LegalPageKey[] = [];

  // Check and adapt terms draft dispute clause
  const termsRecord = updatedLegalPages.terms;
  if (termsRecord?.draft?.sections) {
    const disputesSec = termsRecord.draft.sections.find((s) => s.id === "disputes_law");
    if (disputesSec) {
      let sectionUpdated = false;
      const neutralDisputeFr =
        DEFAULT_LEGAL_PAGES_CONTENT.terms.draft.sections.find((s) => s.id === "disputes_law")?.paragraphs[3]?.fr ||
        DEFAULT_LEGAL_PAGES_CONTENT.terms.draft.sections.find((s) => s.id === "disputes_law")?.paragraphs[2]?.fr ||
        "Compétence juridictionnelle : À défaut de résolution amiable, tout litige relatif à la formation, l'exécution ou l'interprétation des présentes conditions générales sera soumis aux juridictions compétentes selon les règles du droit commun belge, sous réserve des dispositions légales impératives protectrices des consommateurs.";
      const neutralDisputeEn =
        DEFAULT_LEGAL_PAGES_CONTENT.terms.draft.sections.find((s) => s.id === "disputes_law")?.paragraphs[3]?.en ||
        DEFAULT_LEGAL_PAGES_CONTENT.terms.draft.sections.find((s) => s.id === "disputes_law")?.paragraphs[2]?.en ||
        "Jurisdiction: Failing amicable settlement, any dispute concerning the formation, performance, or interpretation of these terms and conditions shall be brought before the competent courts in accordance with the ordinary rules of Belgian law, subject to mandatory statutory consumer protection provisions.";

      const updatedParagraphs = disputesSec.paragraphs.map((p) => {
        if (
          p.fr.includes("{{company.rpmJurisdiction}}") ||
          p.fr.includes("ou Bruxelles") ||
          p.fr.includes("compétence exclusive est attribuée aux tribunaux")
        ) {
          sectionUpdated = true;
          return {
            fr: neutralDisputeFr,
            en: neutralDisputeEn,
          };
        }
        return p;
      });

      if (sectionUpdated) {
        disputesSec.paragraphs = updatedParagraphs;
        needsUpdate = true;
        adaptedKeys.push("terms");
      }
    }
  }

  // Check company legalPersonality and vatRegimeType normalization
  let companyUpdated = false;
  const updatedCompany = structuredClone(content.company);
  if (!updatedCompany.legalPersonality) {
    const inferred = getLegalPersonalityType(updatedCompany);
    if (inferred) {
      updatedCompany.legalPersonality = inferred;
      companyUpdated = true;
      needsUpdate = true;
    }
  }
  if (!updatedCompany.vatRegimeType) {
    const inferredVat = getVatRegimeType(updatedCompany);
    if (inferredVat) {
      updatedCompany.vatRegimeType = inferredVat;
      companyUpdated = true;
      needsUpdate = true;
    }
  }

  if (!needsUpdate) {
    return {
      changed: false,
      message: "Aucune adaptation requise, les brouillons et paramètres sont déjà conformes.",
      adaptedKeys: [],
      backupPath: null,
      newRevision: content.revision,
    };
  }

  // Create an explicit private safety backup out of rotation (0o600 permissions)
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, ".json");
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const safetyBackupPath = path.join(
    dir,
    `${baseName}.pre-legal-adaptation-${timestamp}-${randomSuffix}.safety.bak`
  );
  fs.copyFileSync(filePath, safetyBackupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(safetyBackupPath, 0o600);

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();

  const nextContent: SiteContent = {
    ...content,
    revision: nextRevision,
    updatedAt: now,
    company: companyUpdated ? updatedCompany : content.company,
    legalPages: updatedLegalPages,
  };

  const fullyValidated = validateSiteContent(nextContent);
  atomicWriteJson(filePath, fullyValidated);

  return {
    changed: true,
    message: "Adaptation ciblée des brouillons et paramètres effectuée avec succès.",
    adaptedKeys,
    backupPath: safetyBackupPath,
    newRevision: nextRevision,
  };
}
