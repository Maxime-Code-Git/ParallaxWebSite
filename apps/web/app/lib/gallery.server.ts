import crypto from "node:crypto";
import { getGalleryDb } from "./gallery-db.server";
import {
  generateGalleryCode,
  hashGalleryCode,
  encryptGalleryCode,
  decryptGalleryCode,
} from "./gallery-auth.server";

export interface Gallery {
  id: string;
  public_id: string;
  title: string;
  client_name: string;
  project_date: string;
  location: string | null;
  intro_fr: string | null;
  intro_en: string | null;
  signature_fr: string | null;
  signature_en: string | null;
  status: "draft" | "published" | "archived";
  expires_at: number | null;
  cover_media_id: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
}

export interface GalleryMediaRow {
  id: string;
  gallery_id: string;
  media_type: "photo" | "video";
  sort_order: number;
  original_filename: string;
  mime_type: string;
  file_size: number;
  content_hash: string;
  width: number | null;
  height: number | null;
  is_ready: number;
  preview_data: string | null;
  poster_revision: number;
  created_at: number;
  updated_at: number;
}

export interface GalleryCodeRow {
  gallery_id: string;
  code_hash: string;
  code_encrypted: string;
  version: number;
  updated_at: number;
}

export interface GalleryImportJobRow {
  id: string;
  gallery_id: string;
  import_folder: string;
  status: "pending" | "scanning" | "importing" | "completed" | "failed" | "cancelled";
  progress_total: number;
  progress_current: number;
  scanned_photos: number;
  scanned_videos: number;
  rejected_files: number;
  rejection_report: string | null;
  lease_worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: number | null;
  attempts: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface PublicGalleryDto {
  publicId: string;
  title: string;
  clientName: string;
  projectDate: string;
  location: string | null;
  intro: string;
  signature: string;
  hasPhotos: boolean;
  hasVideos: boolean;
  coverMediaId: string | null;
}

export interface PublicMediaDto {
  id: string;
  mediaType: "photo" | "video";
  originalFilename: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  posterRevision: number;
}

export class GalleryConflictError extends Error {
  constructor(message = "Conflit de revision : la galerie a ete modifiee par une autre operation.") {
    super(message);
    this.name = "GalleryConflictError";
  }
}

export class GalleryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GalleryValidationError";
  }
}

/**
 * Generates an opaque, URL-safe publicId (21 chars base64url).
 */
export function generatePublicId(): string {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Returns all galleries with media statistics for admin listing.
 */
export function getGalleries(): (Gallery & { photoCount: number; videoCount: number; codeVersion: number })[] {
  const db = getGalleryDb();
  const rows = db.prepare(`
    SELECT g.*,
           COALESCE(c.version, 1) as codeVersion,
           (SELECT COUNT(*) FROM gallery_media m WHERE m.gallery_id = g.id AND m.media_type = 'photo' AND m.is_ready = 1) as photoCount,
           (SELECT COUNT(*) FROM gallery_media m WHERE m.gallery_id = g.id AND m.media_type = 'video' AND m.is_ready = 1) as videoCount
    FROM galleries g
    LEFT JOIN gallery_codes c ON c.gallery_id = g.id
    ORDER BY g.created_at DESC
  `).all() as unknown as (Gallery & { photoCount: number; videoCount: number; codeVersion: number })[];
  return rows;
}

/**
 * Returns a gallery by internal UUID.
 */
export function getGalleryById(id: string): Gallery | undefined {
  const db = getGalleryDb();
  return db.prepare("SELECT * FROM galleries WHERE id = ?").get(id) as Gallery | undefined;
}

/**
 * Returns a gallery by publicId.
 */
export function getGalleryByPublicId(publicId: string): Gallery | undefined {
  const db = getGalleryDb();
  return db.prepare("SELECT * FROM galleries WHERE public_id = ?").get(publicId) as Gallery | undefined;
}

/**
 * Returns decrypted access code for administrative display.
 */
export function getGalleryDecryptedCode(galleryId: string): { code: string; version: number } {
  const db = getGalleryDb();
  const row = db.prepare("SELECT code_encrypted, version FROM gallery_codes WHERE gallery_id = ?").get(galleryId) as
    | { code_encrypted: string; version: number }
    | undefined;

  if (!row) {
    throw new Error("Code introuvable pour cette galerie");
  }

  const decrypted = decryptGalleryCode(row.code_encrypted);
  return { code: decrypted, version: row.version };
}

/**
 * Creates a new gallery and generates its unique access code in an atomic transaction.
 */
export function createGallery(data: {
  title: string;
  clientName: string;
  projectDate: string;
  location?: string;
  introFr?: string;
  introEn?: string;
  signatureFr?: string;
  signatureEn?: string;
  expiresAt?: number | null;
}): { gallery: Gallery; plainCode: string } {
  const title = (data.title || "").trim();
  const clientName = (data.clientName || "").trim();
  const projectDate = (data.projectDate || "").trim();

  if (!title) throw new GalleryValidationError("Le titre du projet est obligatoire.");
  if (!clientName) throw new GalleryValidationError("Le nom du client est obligatoire.");
  if (!projectDate) throw new GalleryValidationError("La date du projet est obligatoire.");

  const db = getGalleryDb();
  const id = crypto.randomUUID();
  const publicId = generatePublicId();
  const plainCode = generateGalleryCode();
  const codeHash = hashGalleryCode(plainCode);
  const codeEncrypted = encryptGalleryCode(plainCode);
  const now = Date.now();

  const introFr = data.introFr ? data.introFr.trim() : "Merci pour votre confiance. Voici vos photos et vidéos : téléchargez-les à volonté, elles sont à vous.";
  const introEn = data.introEn ? data.introEn.trim() : "Thank you for your trust. Here are your photos and videos: feel free to download them, they are yours.";
  const signatureFr = data.signatureFr ? data.signatureFr.trim() : "Maxime & Ludovic";
  const signatureEn = data.signatureEn ? data.signatureEn.trim() : "Maxime & Ludovic";

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    db.prepare(`
      INSERT INTO galleries (
        id, public_id, title, client_name, project_date, location,
        intro_fr, intro_en, signature_fr, signature_en,
        status, expires_at, cover_media_id, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, 1, ?, ?)
    `).run(
      id,
      publicId,
      title,
      clientName,
      projectDate,
      data.location?.trim() || null,
      introFr,
      introEn,
      signatureFr,
      signatureEn,
      data.expiresAt || null,
      now,
      now
    );

    db.prepare(`
      INSERT INTO gallery_codes (gallery_id, code_hash, code_encrypted, version, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(id, codeHash, codeEncrypted, now);

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    throw new GalleryValidationError(`Erreur lors de la creation de la galerie: ${err instanceof Error ? err.message : String(err)}`);
  }

  const gallery = getGalleryById(id)!;
  return { gallery, plainCode };
}

/**
 * Updates gallery editorial metadata with optimistic concurrency check.
 */
export function updateGallery(
  id: string,
  expectedRevision: number,
  data: {
    title: string;
    clientName: string;
    projectDate: string;
    location?: string;
    introFr?: string;
    introEn?: string;
    signatureFr?: string;
    signatureEn?: string;
    expiresAt?: number | null;
  }
): Gallery {
  const current = getGalleryById(id);
  if (!current) {
    throw new GalleryValidationError("Galerie introuvable.");
  }

  const now = Date.now();

  const title = (data.title || "").trim();
  const clientName = (data.clientName || "").trim();
  const projectDate = (data.projectDate || "").trim();

  if (!title) throw new GalleryValidationError("Le titre du projet est obligatoire.");
  if (!clientName) throw new GalleryValidationError("Le nom du client est obligatoire.");
  if (!projectDate) throw new GalleryValidationError("La date du projet est obligatoire.");

  // For published galleries, expiration must be finite, valid, and strictly in the future.
  if (current.status === "published") {
    if (
      data.expiresAt === null ||
      data.expiresAt === undefined ||
      typeof data.expiresAt !== "number" ||
      !Number.isFinite(data.expiresAt) ||
      data.expiresAt <= now
    ) {
      throw new GalleryValidationError(
        "Une galerie publiée doit obligatoirement avoir une date d'expiration future et valide."
      );
    }
  } else if (data.expiresAt !== undefined && data.expiresAt !== null) {
    if (typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt) || data.expiresAt <= 0) {
      throw new GalleryValidationError("Date d'expiration invalide.");
    }
  }

  const db = getGalleryDb();
  const res = db.prepare(`
    UPDATE galleries
    SET title = ?,
        client_name = ?,
        project_date = ?,
        location = ?,
        intro_fr = ?,
        intro_en = ?,
        signature_fr = ?,
        signature_en = ?,
        expires_at = ?,
        revision = revision + 1,
        updated_at = ?
    WHERE id = ? AND revision = ?
  `).run(
    title,
    clientName,
    projectDate,
    data.location?.trim() || null,
    data.introFr?.trim() || null,
    data.introEn?.trim() || null,
    data.signatureFr?.trim() || null,
    data.signatureEn?.trim() || null,
    data.expiresAt ?? null,
    now,
    id,
    expectedRevision
  );

  if (res.changes === 0) {
    throw new GalleryConflictError();
  }

  return getGalleryById(id)!;
}

/**
 * Rotates the access code: increments version, generates fresh code, revokes old client sessions.
 */
export function rotateGalleryCode(galleryId: string): { code: string; version: number } {
  const db = getGalleryDb();
  const plainCode = generateGalleryCode();
  const codeHash = hashGalleryCode(plainCode);
  const codeEncrypted = encryptGalleryCode(plainCode);
  const now = Date.now();

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const currentCode = db.prepare("SELECT version FROM gallery_codes WHERE gallery_id = ?").get(galleryId) as
      | { version: number }
      | undefined;

    const newVersion = (currentCode?.version || 0) + 1;

    db.prepare(`
      INSERT INTO gallery_codes (gallery_id, code_hash, code_encrypted, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(gallery_id) DO UPDATE SET
        code_hash = excluded.code_hash,
        code_encrypted = excluded.code_encrypted,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(galleryId, codeHash, codeEncrypted, newVersion, now);

    db.exec("COMMIT;");
    return { code: plainCode, version: newVersion };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    throw new Error(`Erreur lors du renouvellement du code: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/**
 * Publishes a gallery: verifies future expiration, ready media, valid cover photo.
 */
export function publishGallery(
  galleryId: string,
  expectedRevision: number,
  expiresAt: number,
  coverMediaId?: string | null
): Gallery {
  if (!expiresAt || expiresAt <= Date.now()) {
    throw new GalleryValidationError("La date d'expiration doit etre obligatoirement future pour publier la galerie.");
  }

  const db = getGalleryDb();

  // Verify at least one ready media item
  const mediaCount = db.prepare(`
    SELECT COUNT(*) as count FROM gallery_media WHERE gallery_id = ? AND is_ready = 1
  `).get(galleryId) as { count: number };

  if (mediaCount.count === 0) {
    throw new GalleryValidationError("Impossible de publier : la galerie ne contient aucun media pret.");
  }

  // Verify cover media
  let targetCoverId = coverMediaId;
  if (!targetCoverId) {
    const existing = db.prepare("SELECT cover_media_id FROM galleries WHERE id = ?").get(galleryId) as {
      cover_media_id: string | null;
    } | undefined;
    targetCoverId = existing?.cover_media_id || undefined;
  }

  if (targetCoverId) {
    const coverCheck = db.prepare(`
      SELECT id FROM gallery_media WHERE id = ? AND gallery_id = ? AND media_type = 'photo' AND is_ready = 1
    `).get(targetCoverId, galleryId);

    if (!coverCheck) {
      throw new GalleryValidationError("La photo de couverture choisie est invalide ou n'appartient pas a cette galerie.");
    }
  } else {
    // Pick first ready photo as default cover
    const firstPhoto = db.prepare(`
      SELECT id FROM gallery_media WHERE gallery_id = ? AND media_type = 'photo' AND is_ready = 1 ORDER BY sort_order ASC LIMIT 1
    `).get(galleryId) as { id: string } | undefined;

    if (firstPhoto) {
      targetCoverId = firstPhoto.id;
    }
  }

  const now = Date.now();
  const res = db.prepare(`
    UPDATE galleries
    SET status = 'published',
        expires_at = ?,
        cover_media_id = ?,
        revision = revision + 1,
        updated_at = ?
    WHERE id = ? AND revision = ?
  `).run(expiresAt, targetCoverId || null, now, galleryId, expectedRevision);

  if (res.changes === 0) {
    throw new GalleryConflictError();
  }

  return getGalleryById(galleryId)!;
}

/**
 * Unpublishes a gallery back to draft status.
 */
export function unpublishGallery(galleryId: string, expectedRevision: number): Gallery {
  const db = getGalleryDb();
  const now = Date.now();
  const res = db.prepare(`
    UPDATE galleries
    SET status = 'draft',
        revision = revision + 1,
        updated_at = ?
    WHERE id = ? AND revision = ?
  `).run(now, galleryId, expectedRevision);

  if (res.changes === 0) {
    throw new GalleryConflictError();
  }

  return getGalleryById(galleryId)!;
}

/**
 * Archives a gallery.
 */
export function archiveGallery(galleryId: string, expectedRevision: number): Gallery {
  const db = getGalleryDb();
  const now = Date.now();
  const res = db.prepare(`
    UPDATE galleries
    SET status = 'archived',
        revision = revision + 1,
        updated_at = ?
    WHERE id = ? AND revision = ?
  `).run(now, galleryId, expectedRevision);

  if (res.changes === 0) {
    throw new GalleryConflictError();
  }

  return getGalleryById(galleryId)!;
}

/**
 * Sets the cover photo for a gallery.
 */
export function setCoverPhoto(galleryId: string, mediaId: string, expectedRevision?: number): Gallery {
  const db = getGalleryDb();
  const photo = db.prepare(`
    SELECT id FROM gallery_media WHERE id = ? AND gallery_id = ? AND media_type = 'photo' AND is_ready = 1
  `).get(mediaId, galleryId);

  if (!photo) {
    throw new GalleryValidationError("La photo de couverture doit etre une photo prete de la meme galerie.");
  }

  const now = Date.now();
  if (typeof expectedRevision === "number") {
    const res = db.prepare(`
      UPDATE galleries
      SET cover_media_id = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(mediaId, now, galleryId, expectedRevision);

    if (res.changes === 0) {
      throw new GalleryConflictError();
    }
  } else {
    db.prepare(`
      UPDATE galleries
      SET cover_media_id = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `).run(mediaId, now, galleryId);
  }

  return getGalleryById(galleryId)!;
}

/**
 * Returns media list for a gallery.
 */
export function getGalleryMediaList(galleryId: string, mediaType?: "photo" | "video"): GalleryMediaRow[] {
  const db = getGalleryDb();
  if (mediaType) {
    return db.prepare(`
      SELECT * FROM gallery_media
      WHERE gallery_id = ? AND media_type = ? AND is_ready = 1
      ORDER BY sort_order ASC
    `).all(galleryId, mediaType) as unknown as GalleryMediaRow[];
  }
  return db.prepare(`
    SELECT * FROM gallery_media
    WHERE gallery_id = ? AND is_ready = 1
    ORDER BY sort_order ASC
  `).all(galleryId) as unknown as GalleryMediaRow[];
}

/**
 * Returns photos paginated by skip/limit.
 */
export function getGalleryPhotosPaginated(galleryId: string, skip = 0, limit = 24): { items: GalleryMediaRow[]; total: number; hasMore: boolean } {
  const db = getGalleryDb();
  const safeSkip = Math.max(0, Math.floor(skip));
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));

  const countRow = db.prepare(`
    SELECT COUNT(*) as count FROM gallery_media WHERE gallery_id = ? AND media_type = 'photo' AND is_ready = 1
  `).get(galleryId) as { count: number };

  const total = countRow.count;
  const items = db.prepare(`
    SELECT * FROM gallery_media
    WHERE gallery_id = ? AND media_type = 'photo' AND is_ready = 1
    ORDER BY sort_order ASC
    LIMIT ? OFFSET ?
  `).all(galleryId, safeLimit, safeSkip) as unknown as GalleryMediaRow[];

  const hasMore = safeSkip + items.length < total;
  return { items, total, hasMore };
}

/**
 * Formats a PublicGalleryDto localized for client presentation.
 */
export function formatPublicGalleryDto(gallery: Gallery, lang: "fr" | "en"): PublicGalleryDto {
  const db = getGalleryDb();
  const photoCount = (db.prepare(`
    SELECT COUNT(*) as count FROM gallery_media WHERE gallery_id = ? AND media_type = 'photo' AND is_ready = 1
  `).get(gallery.id) as { count: number }).count;

  const videoCount = (db.prepare(`
    SELECT COUNT(*) as count FROM gallery_media WHERE gallery_id = ? AND media_type = 'video' AND is_ready = 1
  `).get(gallery.id) as { count: number }).count;

  const intro = (lang === "en" ? gallery.intro_en : gallery.intro_fr) || (lang === "en" ? gallery.intro_fr : gallery.intro_en) || "";
  const signature = (lang === "en" ? gallery.signature_en : gallery.signature_fr) || (lang === "en" ? gallery.signature_fr : gallery.signature_en) || "";

  return {
    publicId: gallery.public_id,
    title: gallery.title,
    clientName: gallery.client_name,
    projectDate: gallery.project_date,
    location: gallery.location,
    intro,
    signature,
    hasPhotos: photoCount > 0,
    hasVideos: videoCount > 0,
    coverMediaId: gallery.cover_media_id,
  };
}

/**
 * Extracts public variant dimensions from preview_data for accurate client srcset generation.
 * Strips internal details, file paths, or private configuration.
 */
export function parsePreviewVariants(
  previewDataRaw: string | null | undefined
): Record<number, { width: number; height: number }> | null {
  if (!previewDataRaw) return null;
  try {
    const parsed = JSON.parse(previewDataRaw);
    if (!parsed || typeof parsed !== "object") return null;
    const variants: Record<number, { width: number; height: number }> = {};
    for (const [key, val] of Object.entries(parsed)) {
      const numKey = Number.parseInt(key, 10);
      if (
        Number.isFinite(numKey) &&
        val &&
        typeof val === "object" &&
        "width" in val &&
        "height" in val
      ) {
        variants[numKey] = {
          width: Number((val as { width: unknown }).width) || numKey,
          height: Number((val as { height: unknown }).height) || 0,
        };
      }
    }
    return Object.keys(variants).length > 0 ? variants : null;
  } catch {
    return null;
  }
}
