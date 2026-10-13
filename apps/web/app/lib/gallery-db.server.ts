import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ENV } from "./env.server";

let singletonDb: DatabaseSync | undefined;
let currentDbPath: string | undefined;

export class GalleryDatabaseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "GalleryDatabaseError";
  }
}

/**
 * Validates directory permissions and symlink restrictions.
 */
function ensureSafeDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }

  const stat = fs.lstatSync(dirPath);
  if (stat.isSymbolicLink()) {
    throw new GalleryDatabaseError(`CRITICAL: Le dossier ${dirPath} ne doit pas etre un lien symbolique.`);
  }
  if (!stat.isDirectory()) {
    throw new GalleryDatabaseError(`CRITICAL: ${dirPath} doit etre un dossier.`);
  }

  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Ignored on filesystems where chmod is restricted
  }
}

/**
 * Opens and initializes the Parallax Gallery SQLite Database (Schema V1).
 */
export function openGalleryDb(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  ensureSafeDirectory(dir);

  if (fs.existsSync(dbPath)) {
    const stat = fs.lstatSync(dbPath);
    if (stat.isSymbolicLink()) {
      throw new GalleryDatabaseError(`CRITICAL: Le fichier SQLite ${dbPath} ne doit pas etre un lien symbolique.`);
    }
    if (!stat.isFile()) {
      throw new GalleryDatabaseError(`CRITICAL: ${dbPath} doit etre un fichier standard.`);
    }
  }

  const db = new DatabaseSync(dbPath);

  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {
    // Ignored
  }

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");

  // Validate or initialize Schema V1
  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    // Check for incompatible foreign tables (e.g. Sempra or rate-limit)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const tableNames = new Set(tables.map((t) => t.name));

    if (tableNames.has("gallery_migrations")) {
      throw new GalleryDatabaseError("CRITICAL: Base de donnees Sempra detectee. Parallax exige son propre schema independant V1.");
    }
    if (tableNames.has("requests") && !tableNames.has("galleries")) {
      throw new GalleryDatabaseError("CRITICAL: Base de limitation de debit (rate-limit) detectee. La base gallery doit etre distincte.");
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS gallery_schema (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const schemaRow = db.prepare("SELECT version, name FROM gallery_schema WHERE version = 1").get() as
      | { version: number; name: string }
      | undefined;

    if (!schemaRow) {
      if (tables.length > 0 && !tableNames.has("gallery_schema")) {
        throw new GalleryDatabaseError("CRITICAL: Schema SQLite incompatible ou non reconnu.");
      }

      // Initialize Parallax Gallery Schema V1
      db.exec(`
        CREATE TABLE IF NOT EXISTS galleries (
          id TEXT PRIMARY KEY,
          public_id TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          client_name TEXT NOT NULL,
          project_date TEXT NOT NULL,
          location TEXT,
          intro_fr TEXT,
          intro_en TEXT,
          signature_fr TEXT,
          signature_en TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          expires_at INTEGER,
          cover_media_id TEXT,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_galleries_public_id ON galleries(public_id);
        CREATE INDEX IF NOT EXISTS idx_galleries_status ON galleries(status);
        CREATE INDEX IF NOT EXISTS idx_galleries_created_at ON galleries(created_at);

        CREATE TABLE IF NOT EXISTS gallery_codes (
          gallery_id TEXT PRIMARY KEY,
          code_hash TEXT UNIQUE NOT NULL,
          code_encrypted TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_gallery_codes_hash ON gallery_codes(code_hash);

        CREATE TABLE IF NOT EXISTS gallery_media (
          id TEXT PRIMARY KEY,
          gallery_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          original_filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          is_ready INTEGER NOT NULL DEFAULT 0,
          preview_data TEXT,
          poster_revision INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
          UNIQUE(gallery_id, content_hash)
        );

        CREATE INDEX IF NOT EXISTS idx_gallery_media_list ON gallery_media(gallery_id, media_type, sort_order);
        CREATE INDEX IF NOT EXISTS idx_gallery_media_ready ON gallery_media(gallery_id, is_ready);

        CREATE TABLE IF NOT EXISTS gallery_import_jobs (
          id TEXT PRIMARY KEY,
          gallery_id TEXT NOT NULL,
          import_folder TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          progress_total INTEGER NOT NULL DEFAULT 0,
          progress_current INTEGER NOT NULL DEFAULT 0,
          scanned_photos INTEGER NOT NULL DEFAULT 0,
          scanned_videos INTEGER NOT NULL DEFAULT 0,
          rejected_files INTEGER NOT NULL DEFAULT 0,
          rejection_report TEXT,
          lease_worker_id TEXT,
          lease_token TEXT,
          lease_expires_at INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_gallery_import_active ON gallery_import_jobs(gallery_id, status);

        CREATE TABLE IF NOT EXISTS gallery_deletion_jobs (
          id TEXT PRIMARY KEY,
          gallery_id TEXT NOT NULL,
          relative_quarantine_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          worker_id TEXT,
          lease_expires_at INTEGER,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_gallery_deletion_status ON gallery_deletion_jobs(status, lease_expires_at);

        INSERT INTO gallery_schema (version, name, applied_at)
        VALUES (1, 'parallax_gallery_v1', ${Date.now()});
      `);
    } else if (schemaRow.name !== "parallax_gallery_v1") {
      throw new GalleryDatabaseError(`CRITICAL: Schema de base inconnu: ${schemaRow.name}`);
    }

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    db.close();
    if (err instanceof GalleryDatabaseError) throw err;
    throw new GalleryDatabaseError("Erreur d'initialisation du schema de base de donnees gallery", err);
  }

  return db;
}

/**
 * Returns the singleton gallery database instance.
 */
export function getGalleryDb(): DatabaseSync {
  const dbPath = ENV.GALLERY_DB_PATH;

  if (singletonDb && currentDbPath === dbPath) {
    return singletonDb;
  }

  if (singletonDb) {
    try {
      singletonDb.close();
    } catch {
      // Ignored
    }
    singletonDb = undefined;
  }

  singletonDb = openGalleryDb(dbPath);
  currentDbPath = dbPath;
  return singletonDb;
}

/**
 * Closes the singleton gallery database instance cleanly.
 */
export function closeGalleryDb(): void {
  if (singletonDb) {
    try {
      singletonDb.close();
    } catch {
      // Ignored
    }
    singletonDb = undefined;
    currentDbPath = undefined;
  }
}

/**
 * Deletes a gallery, quarantines its files in GALLERY_MEDIA_PATH/.trash/gallery-deletions/:jobId,
 * and schedules transactional deletion.
 */
export function deleteGalleryAndQuarantine(galleryId: string): void {
  if (!galleryId || typeof galleryId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(galleryId)) {
    throw new Error("Invalid gallery ID");
  }

  const db = getGalleryDb();

  const gallery = db.prepare("SELECT id FROM galleries WHERE id = ?").get(galleryId) as
    | { id: string }
    | undefined;

  if (!gallery) {
    throw new Error("Gallery not found");
  }

  const baseMedia = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const mediaDir = path.resolve(baseMedia, galleryId);

  // Strict confinement check
  const relMedia = path.relative(baseMedia, mediaDir);
  if (!relMedia || path.isAbsolute(relMedia) || relMedia.startsWith(".." + path.sep) || relMedia === "..") {
    throw new Error("Invalid media directory path");
  }

  let hasMediaDir = false;
  if (fs.existsSync(mediaDir)) {
    const stat = fs.lstatSync(mediaDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("INVALID_MEDIA_PATH");
    }
    hasMediaDir = true;
  }

  // Quarantine lives under GALLERY_MEDIA_PATH/.trash to guarantee same filesystem/volume
  const trashRoot = path.join(baseMedia, ".trash");
  const trashBase = path.join(trashRoot, "gallery-deletions");

  if (fs.existsSync(trashRoot)) {
    const rootStat = fs.lstatSync(trashRoot);
    if (rootStat.isSymbolicLink()) {
      throw new Error("INVALID_QUARANTINE_PATH");
    }
  }

  if (fs.existsSync(trashBase)) {
    const trashStat = fs.lstatSync(trashBase);
    if (trashStat.isSymbolicLink() || !trashStat.isDirectory()) {
      throw new Error("INVALID_QUARANTINE_PATH");
    }
  } else {
    fs.mkdirSync(trashBase, { recursive: true, mode: 0o700 });
  }

  const jobId = crypto.randomUUID();
  const quarantineDir = path.join(trashBase, jobId);
  const relativeQuarantinePath = path.relative(baseMedia, quarantineDir);

  if (hasMediaDir) {
    fs.renameSync(mediaDir, quarantineDir);
  } else {
    fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
  }

  const now = Date.now();
  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    // Delete gallery from DB (foreign keys ON DELETE CASCADE will purge codes, media, and import jobs)
    db.prepare("DELETE FROM galleries WHERE id = ?").run(galleryId);

    // Record deletion job
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(jobId, galleryId, relativeQuarantinePath, now, now);

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    // Attempt rollback of rename if media directory was moved
    if (hasMediaDir && fs.existsSync(quarantineDir)) {
      try {
        fs.renameSync(quarantineDir, mediaDir);
      } catch {
        // Ignored
      }
    }
    throw new GalleryDatabaseError("Erreur lors de la suppression de la galerie", err);
  }
}

/**
 * Background worker processing pending gallery quarantine deletions.
 */
export function processGalleryDeletions(): void {
  const db = getGalleryDb();
  const workerId = crypto.randomUUID();
  const now = Date.now();
  const maxAttempts = 5;
  const batchSize = 5;
  const leaseDurationMs = 5 * 60 * 1000;

  let jobsToProcess: { id: string; relative_quarantine_path: string }[];

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const pending = db.prepare(`
      SELECT id, relative_quarantine_path
      FROM gallery_deletion_jobs
      WHERE (status = 'pending' OR (status = 'processing' AND lease_expires_at < ?))
        AND attempt_count < ?
      LIMIT ?
    `).all(now, maxAttempts, batchSize) as { id: string; relative_quarantine_path: string }[];

    if (pending.length === 0) {
      db.exec("COMMIT;");
      return;
    }

    const leaseExpiresAt = now + leaseDurationMs;
    const updateStmt = db.prepare(`
      UPDATE gallery_deletion_jobs
      SET status = 'processing',
          worker_id = ?,
          lease_expires_at = ?,
          updated_at = ?,
          attempt_count = attempt_count + 1
      WHERE id = ?
    `);

    for (const job of pending) {
      updateStmt.run(workerId, leaseExpiresAt, now, job.id);
    }

    db.exec("COMMIT;");
    jobsToProcess = pending;
  } catch {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    return;
  }

  const baseMedia = path.resolve(ENV.GALLERY_MEDIA_PATH);

  for (const job of jobsToProcess) {
    try {
      const fullQuarantinePath = path.resolve(baseMedia, job.relative_quarantine_path);

      // Verify strict confinement
      const rel = path.relative(baseMedia, fullQuarantinePath);
      if (!rel || path.isAbsolute(rel) || rel.startsWith(".." + path.sep) || rel === "..") {
        throw new Error("INVALID_QUARANTINE_PATH");
      }

      if (fs.existsSync(fullQuarantinePath)) {
        fs.rmSync(fullQuarantinePath, { recursive: true, force: true });
      }

      db.prepare(`
        UPDATE gallery_deletion_jobs
        SET status = 'completed',
            updated_at = ?
        WHERE id = ? AND worker_id = ?
      `).run(Date.now(), job.id, workerId);
    } catch (err: unknown) {
      const errCode = err instanceof Error ? err.message : "CLEANUP_FAILED";
      db.prepare(`
        UPDATE gallery_deletion_jobs
        SET status = 'failed',
            error_code = ?,
            updated_at = ?
        WHERE id = ? AND worker_id = ?
      `).run(errCode, Date.now(), job.id, workerId);
    }
  }
}
