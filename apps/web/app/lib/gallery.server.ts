import crypto from "node:crypto";
import { getGalleryDb, GalleryConflictError } from "./gallery-db.server";
import {
  generateGalleryCode,
  hashGalleryCode,
  encryptGalleryCode,
  decryptGalleryCode,
  GalleryCodeDecryptionError,
} from "./gallery-auth.server";
import { deleteStoredGalleryMediaFiles } from "./gallery-preview.server";
import { computeGalleryFolderName, createGalleryFolderOnDisk } from "./gallery-folder.server";

export class GalleryCodeNotFoundError extends Error {
  constructor(message = "Code d'accès introuvable pour cette galerie.", options?: ErrorOptions) {
    super(message, options);
    this.name = "GalleryCodeNotFoundError";
  }
}

export { GalleryCodeDecryptionError };

export interface GalleryAccessCodeState {
  status: "available" | "unavailable";
  code: string | null;
  version: number;
  warning: string | null;
  reason?: "not_found" | "decryption_failed";
}

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
  code_version?: number;
  code_generation?: string | null;
  upload_folder?: string | null;
  retention_exempt?: number;
  retention_exempt_reason?: string | null;
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

export { GalleryConflictError };

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
           COALESCE(c.version, g.code_version, 1) as codeVersion,
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
 * Returns the access code state for administrative display.
 * Distinguishes available code from expected unavailability (missing row, decryption failure)
 * without masking SQLite database errors.
 */
export function getGalleryAccessCodeState(galleryId: string): GalleryAccessCodeState {
  const db = getGalleryDb();
  const gal = db.prepare("SELECT code_version FROM galleries WHERE id = ?").get(galleryId) as
    | { code_version: number }
    | undefined;
  const durableVersion = gal?.code_version ?? 1;

  const row = db.prepare("SELECT code_encrypted, version FROM gallery_codes WHERE gallery_id = ?").get(galleryId) as
    | { code_encrypted: string; version: number }
    | undefined;

  if (!row) {
    return {
      status: "unavailable",
      code: null,
      version: durableVersion,
      reason: "not_found",
      warning: "Aucun code d'accès n'est enregistré pour cette galerie. Vous pouvez générer un nouveau code ci-dessous pour ouvrir l'accès.",
    };
  }

  try {
    const decrypted = decryptGalleryCode(row.code_encrypted);
    return {
      status: "available",
      code: decrypted,
      version: row.version,
      warning: null,
    };
  } catch (err: unknown) {
    if (err instanceof GalleryCodeDecryptionError) {
      return {
        status: "unavailable",
        code: null,
        version: row.version,
        reason: "decryption_failed",
        warning:
          "Le code d'accès actuel ne peut pas être affiché avec la clé active (clé de chiffrement différente ou données altérées). Ce constat n'indique pas que l'accès client est interrompu si le secret d'authentification est inchangé. Une régénération est facultative et invalidera explicitement les sessions antérieures.",
      };
    }
    throw err;
  }
}

/**
 * Returns decrypted access code for administrative display.
 * Throws GalleryCodeNotFoundError if missing, or GalleryCodeDecryptionError if decryption fails.
 */
export function getGalleryDecryptedCode(galleryId: string): { code: string; version: number } {
  const state = getGalleryAccessCodeState(galleryId);
  if (state.status === "unavailable") {
    if (state.reason === "not_found") {
      throw new GalleryCodeNotFoundError(state.warning || "Code d'accès introuvable.");
    }
    throw new GalleryCodeDecryptionError(state.warning || "Impossible de déchiffrer le code d'accès.");
  }
  return { code: state.code!, version: state.version };
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

  const uploadFolder = computeGalleryFolderName(id, title || clientName);
  createGalleryFolderOnDisk(uploadFolder);

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    db.prepare(`
      INSERT INTO galleries (
        id, public_id, title, client_name, project_date, location,
        intro_fr, intro_en, signature_fr, signature_en,
        status, expires_at, cover_media_id, revision, code_version, upload_folder, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, 1, 1, ?, ?, ?)
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
      uploadFolder,
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
  const currentGallery = getGalleryById(galleryId);
  if (!currentGallery) {
    throw new GalleryValidationError("Galerie introuvable.");
  }

  const db = getGalleryDb();
  const plainCode = generateGalleryCode();
  const codeHash = hashGalleryCode(plainCode);
  const codeEncrypted = encryptGalleryCode(plainCode);
  const now = Date.now();

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const galRow = db.prepare("SELECT code_version FROM galleries WHERE id = ?").get(galleryId) as
      | { code_version: number }
      | undefined;
    const currentCode = db.prepare("SELECT version FROM gallery_codes WHERE gallery_id = ?").get(galleryId) as
      | { version: number }
      | undefined;

    const previousVersion = Math.max(galRow?.code_version ?? 0, currentCode?.version ?? 0);
    const newVersion = previousVersion + 1;

    const newGeneration = crypto.randomUUID();
    db.prepare("UPDATE galleries SET code_version = ?, code_generation = ?, updated_at = ? WHERE id = ?").run(newVersion, newGeneration, now, galleryId);

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
      ORDER BY sort_order ASC, created_at ASC, id ASC
    `).all(galleryId, mediaType) as unknown as GalleryMediaRow[];
  }
  return db.prepare(`
    SELECT * FROM gallery_media
    WHERE gallery_id = ? AND is_ready = 1
    ORDER BY sort_order ASC, created_at ASC, id ASC
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
    ORDER BY sort_order ASC, created_at ASC, id ASC
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

/**
 * Removes a single photo from a gallery atomically:
 * - Checks optimistic revision and belonging to the gallery.
 * - Rejects mutation if an import or gallery deletion is currently active.
 * - Reassigns cover photo if this was the cover (to next ready photo or null).
 * - Reverts gallery status to draft if it was published and becomes completely empty of media.
 * - Deletes the media row in DB and cleans up preview/poster/original files in storage.
 * - Strictly leaves source files in imports intact.
 */
export function deleteGalleryPhoto(
  galleryId: string,
  mediaId: string,
  expectedRevision: number
): { success: boolean; unpublishNotice: boolean; newCoverId: string | null; deletedFilename: string } {
  if (!galleryId || typeof galleryId !== "string") {
    throw new GalleryValidationError("ID de galerie invalide.");
  }
  if (!mediaId || typeof mediaId !== "string") {
    throw new GalleryValidationError("ID de média invalide.");
  }

  const db = getGalleryDb();

  // 1. Guard against active imports
  const activeImports = (
    db.prepare(`
      SELECT COUNT(*) as count FROM gallery_import_jobs
      WHERE gallery_id = ? AND status IN ('pending', 'scanning', 'importing')
    `).get(galleryId) as { count: number }
  ).count;

  if (activeImports > 0) {
    throw new GalleryConflictError(
      "Une opération d'importation est en cours pour cette galerie. Suppression de photo impossible pour le moment."
    );
  }

  // 2. Guard against active gallery deletion
  const activeDeletion = db.prepare(`
    SELECT id FROM gallery_deletion_jobs
    WHERE gallery_id = ? AND status IN ('pending', 'processing')
  `).get(galleryId);

  if (activeDeletion) {
    throw new GalleryConflictError(
      "Une suppression de la galerie est en cours. Suppression de photo impossible pour le moment."
    );
  }

  // 3. Verify media exists, belongs to gallery and is a photo
  const mediaItem = db.prepare(`
    SELECT id, gallery_id, media_type, original_filename
    FROM gallery_media
    WHERE id = ? AND gallery_id = ?
  `).get(mediaId, galleryId) as { id: string; gallery_id: string; media_type: string; original_filename: string } | undefined;

  if (!mediaItem) {
    throw new GalleryValidationError("Photo introuvable ou n'appartenant pas à cette galerie.");
  }
  if (mediaItem.media_type !== "photo") {
    throw new GalleryValidationError("Seules les photos peuvent être supprimées via cette action.");
  }

  // 4. Verify gallery and revision
  const currentGallery = db.prepare(`
    SELECT id, revision, status, cover_media_id
    FROM galleries
    WHERE id = ?
  `).get(galleryId) as { id: string; revision: number; status: string; cover_media_id: string | null } | undefined;

  if (!currentGallery) {
    throw new GalleryValidationError("Galerie introuvable.");
  }

  if (currentGallery.revision !== expectedRevision) {
    throw new GalleryConflictError();
  }

  // 5. Determine new cover if this photo was the cover
  let newCoverId = currentGallery.cover_media_id;
  if (currentGallery.cover_media_id === mediaId) {
    const nextPhoto = db.prepare(`
      SELECT id FROM gallery_media
      WHERE gallery_id = ? AND media_type = 'photo' AND is_ready = 1 AND id != ?
      ORDER BY sort_order ASC, created_at ASC, id ASC
      LIMIT 1
    `).get(galleryId, mediaId) as { id: string } | undefined;

    newCoverId = nextPhoto?.id || null;
  }

  // 6. Determine new status if gallery becomes completely empty
  const remainingMediaCount = (
    db.prepare(`
      SELECT COUNT(*) as count FROM gallery_media
      WHERE gallery_id = ? AND is_ready = 1 AND id != ?
    `).get(galleryId, mediaId) as { count: number }
  ).count;

  let newStatus = currentGallery.status;
  let unpublishNotice = false;
  if (remainingMediaCount === 0 && currentGallery.status === "published") {
    newStatus = "draft";
    unpublishNotice = true;
  }

  const now = Date.now();

  // 7. Atomic DB deletion and gallery update
  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const delRes = db.prepare("DELETE FROM gallery_media WHERE id = ? AND gallery_id = ?").run(mediaId, galleryId);
    if (delRes.changes === 0) {
      throw new GalleryValidationError("Échec de la suppression en base de données.");
    }

    const galRes = db.prepare(`
      UPDATE galleries
      SET cover_media_id = ?,
          status = ?,
          revision = revision + 1,
          updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(newCoverId, newStatus, now, galleryId, expectedRevision);

    if (galRes.changes === 0) {
      throw new GalleryConflictError();
    }

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    if (err instanceof GalleryConflictError || err instanceof GalleryValidationError) {
      throw err;
    }
    throw new Error(`Erreur lors de la suppression de la photo : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  // 8. Filesystem cleanup outside transaction (safe & confined)
  try {
    deleteStoredGalleryMediaFiles(galleryId, mediaId);
  } catch (cleanErr) {
    console.error(`[WARN] Erreur lors du nettoyage des fichiers du média ${mediaId}:`, cleanErr);
  }

  return {
    success: true,
    unpublishNotice,
    newCoverId,
    deletedFilename: mediaItem.original_filename,
  };
}

/**
 * Reorders photos of a gallery atomically according to an explicit ordered list of media IDs:
 * - Checks optimistic revision and guards against concurrent active imports / deletions.
 * - Validates completeness, uniqueness, and belonging of all provided photo IDs.
 * - Preserves video ordering and chosen cover photo.
 * - Strictly increases sort_order so that subsequent imports naturally append.
 */
export function reorderGalleryPhotos(
  galleryId: string,
  orderedMediaIds: string[],
  expectedRevision: number
): void {
  if (!galleryId || typeof galleryId !== "string") {
    throw new GalleryValidationError("ID de galerie invalide.");
  }
  if (!Array.isArray(orderedMediaIds) || orderedMediaIds.length === 0) {
    throw new GalleryValidationError("La liste des photos à réordonner est vide.");
  }

  const db = getGalleryDb();

  // Guard active imports
  const activeImports = (
    db.prepare(`
      SELECT COUNT(*) as count FROM gallery_import_jobs
      WHERE gallery_id = ? AND status IN ('pending', 'scanning', 'importing')
    `).get(galleryId) as { count: number }
  ).count;
  if (activeImports > 0) {
    throw new GalleryConflictError(
      "Une opération d'importation est en cours pour cette galerie. Réorganisation impossible pour le moment."
    );
  }

  // Guard active deletion
  const activeDeletion = db.prepare(`
    SELECT id FROM gallery_deletion_jobs
    WHERE gallery_id = ? AND status IN ('pending', 'processing')
  `).get(galleryId);
  if (activeDeletion) {
    throw new GalleryConflictError(
      "Une suppression de la galerie est en cours. Réorganisation impossible pour le moment."
    );
  }

  // Check gallery and revision
  const gallery = db.prepare("SELECT id, revision FROM galleries WHERE id = ?").get(galleryId) as
    | { id: string; revision: number }
    | undefined;
  if (!gallery) {
    throw new GalleryValidationError("Galerie introuvable.");
  }
  if (gallery.revision !== expectedRevision) {
    throw new GalleryConflictError();
  }

  // Fetch current ready photos
  const currentPhotos = db.prepare(`
    SELECT id, sort_order
    FROM gallery_media
    WHERE gallery_id = ? AND media_type = 'photo' AND is_ready = 1
    ORDER BY sort_order ASC, created_at ASC, id ASC
  `).all(galleryId) as unknown as { id: string; sort_order: number }[];

  if (orderedMediaIds.length !== currentPhotos.length) {
    throw new GalleryValidationError("La liste des photos ne correspond pas au nombre de photos de la galerie.");
  }

  const currentIds = new Set(currentPhotos.map((p) => p.id));
  const seenIds = new Set<string>();

  for (const id of orderedMediaIds) {
    if (typeof id !== "string" || !currentIds.has(id)) {
      throw new GalleryValidationError(`Photo invalide ou n'appartenant pas à cette galerie : ${id}`);
    }
    if (seenIds.has(id)) {
      throw new GalleryValidationError(`Doublon dans la liste des photos : ${id}`);
    }
    seenIds.add(id);
  }

  // Determine existing sort order slots or sequential slots
  const existingSortOrders = currentPhotos.map((p) => p.sort_order);
  const isDistinct = new Set(existingSortOrders).size === existingSortOrders.length;
  const newSortOrders = isDistinct
    ? existingSortOrders
    : orderedMediaIds.map((_, i) => i);

  const now = Date.now();

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const updateStmt = db.prepare(`
      UPDATE gallery_media
      SET sort_order = ?, updated_at = ?
      WHERE id = ? AND gallery_id = ?
    `);

    for (let i = 0; i < orderedMediaIds.length; i++) {
      updateStmt.run(newSortOrders[i], now, orderedMediaIds[i], galleryId);
    }

    const galRes = db.prepare(`
      UPDATE galleries
      SET revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(now, galleryId, expectedRevision);

    if (galRes.changes === 0) {
      throw new GalleryConflictError();
    }

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    if (err instanceof GalleryConflictError || err instanceof GalleryValidationError) {
      throw err;
    }
    throw new Error(`Erreur lors de la réorganisation des photos : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/**
 * Moves a single photo one step up or down among the gallery's ready photos:
 * - direction "up" moves towards position 0 (earlier).
 * - direction "down" moves towards the end (later).
 */
export function moveGalleryPhoto(
  galleryId: string,
  mediaId: string,
  direction: "up" | "down",
  expectedRevision: number
): void {
  const db = getGalleryDb();

  // Validate gallery existence and optimistic revision upfront
  const gallery = db.prepare("SELECT id, revision FROM galleries WHERE id = ?").get(galleryId) as
    | { id: string; revision: number }
    | undefined;
  if (!gallery) {
    throw new GalleryValidationError("Galerie introuvable.");
  }
  if (gallery.revision !== expectedRevision) {
    throw new GalleryConflictError();
  }

  const currentPhotos = db.prepare(`
    SELECT id
    FROM gallery_media
    WHERE gallery_id = ? AND media_type = 'photo' AND is_ready = 1
    ORDER BY sort_order ASC, created_at ASC, id ASC
  `).all(galleryId) as unknown as { id: string }[];

  const currentIndex = currentPhotos.findIndex((p) => p.id === mediaId);
  if (currentIndex === -1) {
    throw new GalleryValidationError("Photo introuvable dans cette galerie.");
  }

  if (direction === "up") {
    if (currentIndex === 0) return; // Already at top
    const targetIndex = currentIndex - 1;
    const reordered = currentPhotos.map((p) => p.id);
    const temp = reordered[currentIndex];
    reordered[currentIndex] = reordered[targetIndex];
    reordered[targetIndex] = temp;
    reorderGalleryPhotos(galleryId, reordered, expectedRevision);
  } else if (direction === "down") {
    if (currentIndex === currentPhotos.length - 1) return; // Already at bottom
    const targetIndex = currentIndex + 1;
    const reordered = currentPhotos.map((p) => p.id);
    const temp = reordered[currentIndex];
    reordered[currentIndex] = reordered[targetIndex];
    reordered[targetIndex] = temp;
    reorderGalleryPhotos(galleryId, reordered, expectedRevision);
  } else {
    throw new GalleryValidationError("Direction invalide (doit être 'up' ou 'down').");
  }
}
