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

export class GalleryConflictError extends Error {
  constructor(message = "Conflit de revision : la galerie a ete modifiee par une autre operation.") {
    super(message);
    this.name = "GalleryConflictError";
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
          code_version INTEGER NOT NULL DEFAULT 1,
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
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gallery_import_unique_active ON gallery_import_jobs(gallery_id) WHERE status IN ('pending', 'scanning', 'importing');

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

    // Idempotent migration for existing Parallax V1 databases: ensure unique active import index
    const hasUniqueIndex = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_gallery_import_unique_active'")
      .get();
    if (!hasUniqueIndex) {
      db.exec(`
        UPDATE gallery_import_jobs
        SET status = 'failed',
            error_message = 'Doublon d''import hérité annulé pour garantir l''unicité',
            updated_at = ${Date.now()}
        WHERE status IN ('pending', 'scanning', 'importing')
          AND id NOT IN (
            SELECT id FROM gallery_import_jobs
            WHERE status IN ('pending', 'scanning', 'importing')
            GROUP BY gallery_id
            HAVING MAX(created_at)
          );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gallery_import_unique_active
        ON gallery_import_jobs(gallery_id)
        WHERE status IN ('pending', 'scanning', 'importing');
      `);
    }

    // Parallax Gallery Schema V2 Migration (Data retention & deletion audit)
    const v2Row = db
      .prepare("SELECT version FROM gallery_schema WHERE version = 2")
      .get() as { version: number } | undefined;

    if (!v2Row) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS retention_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          retention_days INTEGER DEFAULT NULL,
          log_retention_days INTEGER DEFAULT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL
        );
      `);

      const hasSettings = db.prepare("SELECT 1 FROM retention_settings WHERE id = 1").get();
      if (!hasSettings) {
        db.prepare(`
          INSERT INTO retention_settings (id, enabled, retention_days, log_retention_days, revision, updated_at)
          VALUES (1, 0, NULL, NULL, 1, ?)
        `).run(Date.now());
      }

      const galleryCols = (
        db.prepare("PRAGMA table_info(galleries)").all() as { name: string }[]
      ).map((c) => c.name);

      if (!galleryCols.includes("retention_exempt")) {
        db.exec("ALTER TABLE galleries ADD COLUMN retention_exempt INTEGER NOT NULL DEFAULT 0;");
      }
      if (!galleryCols.includes("retention_exempt_reason")) {
        db.exec("ALTER TABLE galleries ADD COLUMN retention_exempt_reason TEXT;");
      }
      const deletionCols = (
        db.prepare("PRAGMA table_info(gallery_deletion_jobs)").all() as { name: string }[]
      ).map((c) => c.name);

      if (!deletionCols.includes("decision_source")) {
        db.exec("ALTER TABLE gallery_deletion_jobs ADD COLUMN decision_source TEXT NOT NULL DEFAULT 'manual';");
      }
      if (!deletionCols.includes("gallery_title")) {
        db.exec("ALTER TABLE gallery_deletion_jobs ADD COLUMN gallery_title TEXT;");
      }
      if (!deletionCols.includes("media_count")) {
        db.exec("ALTER TABLE gallery_deletion_jobs ADD COLUMN media_count INTEGER DEFAULT 0;");
      }
      if (!deletionCols.includes("total_size")) {
        db.exec("ALTER TABLE gallery_deletion_jobs ADD COLUMN total_size INTEGER DEFAULT 0;");
      }
      if (!deletionCols.includes("completed_at")) {
        db.exec("ALTER TABLE gallery_deletion_jobs ADD COLUMN completed_at INTEGER;");
      }

      db.prepare(`
        INSERT INTO gallery_schema (version, name, applied_at)
        VALUES (2, 'parallax_gallery_v2', ?)
      `).run(Date.now());
    }

    // Parallax Gallery Schema V3 Migration (Durable gallery code version)
    const v3Row = db
      .prepare("SELECT version FROM gallery_schema WHERE version = 3")
      .get() as { version: number } | undefined;

    if (!v3Row) {
      const galleryCols = (
        db.prepare("PRAGMA table_info(galleries)").all() as { name: string }[]
      ).map((c) => c.name);

      if (!galleryCols.includes("code_version")) {
        db.exec("ALTER TABLE galleries ADD COLUMN code_version INTEGER NOT NULL DEFAULT 1;");
      }

      // Initialize durable code_version from existing gallery_codes without ever lowering an already superior durable version
      db.exec(`
        UPDATE galleries
        SET code_version = (
          SELECT MAX(COALESCE(c.version, 1), COALESCE(galleries.code_version, 1))
          FROM gallery_codes c
          WHERE c.gallery_id = galleries.id
        )
        WHERE EXISTS (
          SELECT 1 FROM gallery_codes WHERE gallery_codes.gallery_id = galleries.id
        );
      `);

      db.prepare(`
        INSERT INTO gallery_schema (version, name, applied_at)
        VALUES (3, 'parallax_gallery_v3', ?)
      `).run(Date.now());
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
 * Recursively removes entries within a directory without following any symbolic links.
 * Symbolic links themselves are unlinked without recursing into target directories.
 */
function safeRemoveDirectoryWithoutFollowingSymlinks(dirPath: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullEntryPath = path.join(dirPath, entry.name);
    try {
      if (entry.isSymbolicLink() || entry.isFile()) {
        fs.unlinkSync(fullEntryPath);
      } else if (entry.isDirectory()) {
        safeRemoveDirectoryWithoutFollowingSymlinks(fullEntryPath);
        fs.rmdirSync(fullEntryPath);
      }
    } catch {
      // Ignore individual file unlink errors
    }
  }
}

/**
 * Safely removes a quarantine target folder, strictly verifying every ancestor component
 * to reject symbolic links, and never following symlinks to outside directories.
 */
function safeDeleteQuarantineTarget(baseMedia: string, jobId: string, galleryId?: string): void {
  if (!/^[0-9a-fA-F-]{36}$/.test(jobId)) {
    throw new Error("INVALID_JOB_ID");
  }

  const canonicalBase = fs.realpathSync(baseMedia);
  const baseStat = fs.lstatSync(canonicalBase);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw new Error("INVALID_BASE_MEDIA");
  }

  // 1. Ancestor .trash check
  const trashRoot = path.join(canonicalBase, ".trash");
  if (fs.existsSync(trashRoot)) {
    const trashStat = fs.lstatSync(trashRoot);
    if (trashStat.isSymbolicLink() || !trashStat.isDirectory()) {
      throw new Error("INVALID_QUARANTINE_ANCESTOR");
    }

    // 2. Ancestor gallery-deletions check
    const deletionsRoot = path.join(trashRoot, "gallery-deletions");
    if (fs.existsSync(deletionsRoot)) {
      const deletionsStat = fs.lstatSync(deletionsRoot);
      if (deletionsStat.isSymbolicLink() || !deletionsStat.isDirectory()) {
        throw new Error("INVALID_QUARANTINE_ANCESTOR");
      }

      // 3. Quarantine target folder
      const targetDir = path.join(deletionsRoot, jobId);
      if (fs.existsSync(targetDir)) {
        const targetStat = fs.lstatSync(targetDir);
        if (targetStat.isSymbolicLink()) {
          fs.unlinkSync(targetDir);
        } else if (targetStat.isDirectory()) {
          safeRemoveDirectoryWithoutFollowingSymlinks(targetDir);
          try {
            fs.rmdirSync(targetDir);
          } catch {
            // Ignored
          }
        }
      }
    }
  }

  // 4. Crash window recovery: if source media folder still exists under baseMedia/<galleryId>, safely clean it
  if (galleryId && /^[0-9a-fA-F-]{36}$/.test(galleryId)) {
    const orphanMediaDir = path.join(canonicalBase, galleryId);
    if (fs.existsSync(orphanMediaDir)) {
      const orphanStat = fs.lstatSync(orphanMediaDir);
      if (orphanStat.isSymbolicLink()) {
        fs.unlinkSync(orphanMediaDir);
      } else if (orphanStat.isDirectory()) {
        safeRemoveDirectoryWithoutFollowingSymlinks(orphanMediaDir);
        try {
          fs.rmdirSync(orphanMediaDir);
        } catch {
          // Ignored
        }
      }
    }
  }
}

export { safeDeleteQuarantineTarget };

export interface DeletionResult {
  id: string;
  jobId: string;
  title: string;
  mediaCount: number;
  totalSize: number;
  knownImportFolders: string[];
}

/**
 * Executes unified transactional deletion for up to 50 galleries in a closed, bounded set.
 * Atomically validates all IDs, optimistic revisions, cancels active imports, records durable intent,
 * immediately revokes client access via database cascades, moves media to quarantine outside SQLite lock,
 * and triggers asynchronous cleanup.
 */
export function deleteGalleriesWithIntentBulk(
  items: { id: string; expectedRevision?: number }[],
  options: {
    decisionSource?: string;
    checkAutoEligibility?: boolean;
  } = {}
): DeletionResult[] {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("Aucune galerie sélectionnée pour la suppression.");
  }
  if (items.length > 50) {
    throw new Error("La sélection groupée est limitée à 50 galeries maximum.");
  }

  const seenIds = new Set<string>();
  for (const item of items) {
    if (!item.id || typeof item.id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(item.id)) {
      throw new Error(`ID de galerie invalide : ${item?.id}`);
    }
    if (seenIds.has(item.id)) {
      throw new Error(`Doublon détecté dans la sélection : ${item.id}`);
    }
    seenIds.add(item.id);
  }

  const db = getGalleryDb();
  const baseMedia = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const now = Date.now();
  const decisionSource = options.decisionSource || "manual";

  const deletionPlans: {
    galleryId: string;
    jobId: string;
    title: string;
    mediaCount: number;
    totalSize: number;
    knownImportFolders: string[];
    relativeQuarantinePath: string;
  }[] = [];

  // 1. Transactional validation and intent persistence
  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    for (const item of items) {
      const gallery = db.prepare(`
        SELECT id, title, revision, status, expires_at, retention_exempt
        FROM galleries
        WHERE id = ?
      `).get(item.id) as
        | {
            id: string;
            title: string;
            revision: number;
            status: string;
            expires_at: number | null;
            retention_exempt: number;
          }
        | undefined;

      if (!gallery) {
        throw new Error(`Galerie introuvable : ${item.id}`);
      }

      if (typeof item.expectedRevision === "number" && gallery.revision !== item.expectedRevision) {
        throw new GalleryConflictError(
          `Conflit de révision (409) sur la galerie « ${gallery.title} » : la galerie a été modifiée par une autre opération en arrière-plan.`
        );
      }

      // Check for active imports count
      const activeImports = (
        db.prepare(`
          SELECT COUNT(*) as count FROM gallery_import_jobs
          WHERE gallery_id = ? AND status IN ('pending', 'scanning', 'importing')
        `).get(item.id) as { count: number }
      ).count;

      // Check if deletion is already in progress
      const existingJob = db.prepare(`
        SELECT id FROM gallery_deletion_jobs
        WHERE gallery_id = ? AND status IN ('pending', 'processing')
      `).get(item.id) as { id: string } | undefined;

      if (existingJob) {
        throw new Error(`Une suppression est déjà en cours pour la galerie « ${gallery.title} »`);
      }

      if (options.checkAutoEligibility) {
        const settingsRow = db.prepare("SELECT enabled, retention_days FROM retention_settings WHERE id = 1").get() as
          | { enabled: number; retention_days: number | null }
          | undefined;
        const enabled = Boolean(settingsRow?.enabled);
        const retentionDays = settingsRow?.retention_days ?? null;

        if (!enabled || retentionDays === null) {
          throw new Error("Politique de purge automatique désactivée ou non configurée");
        }
        if (gallery.status === "draft" || gallery.expires_at === null || gallery.expires_at > now) {
          throw new Error(`La galerie « ${gallery.title} » n'est pas expirée`);
        }
        if (gallery.retention_exempt) {
          throw new Error(`La galerie « ${gallery.title} » est suspendue / exemptée de purge`);
        }
        if (activeImports > 0) {
          throw new Error(`La galerie « ${gallery.title} » a une importation active en cours`);
        }
        const scheduledPurgeAt = gallery.expires_at + retentionDays * 86_400_000;
        if (scheduledPurgeAt > now) {
          throw new Error(`La date de purge prévisionnelle n'est pas atteinte pour « ${gallery.title} »`);
        }
      }

      // Query media stats
      const stats = db.prepare(`
        SELECT COUNT(*) as mediaCount, COALESCE(SUM(file_size), 0) as totalSize
        FROM gallery_media
        WHERE gallery_id = ?
      `).get(item.id) as { mediaCount: number; totalSize: number };

      // Query known import folders
      const importFolders = (
        db.prepare(`
          SELECT DISTINCT import_folder FROM gallery_import_jobs
          WHERE gallery_id = ?
        `).all(item.id) as { import_folder: string }[]
      ).map((r) => r.import_folder);

      // Cancel any active import jobs
      db.prepare(`
        UPDATE gallery_import_jobs
        SET status = 'cancelled',
            error_message = 'Importation annulée suite à la suppression de la galerie',
            updated_at = ?
        WHERE gallery_id = ? AND status IN ('pending', 'scanning', 'importing')
      `).run(now, item.id);

      const jobId = crypto.randomUUID();
      const relativeQuarantinePath = path.join(".trash", "gallery-deletions", jobId);

      // Record durable deletion intent
      db.prepare(`
        INSERT INTO gallery_deletion_jobs (
          id, gallery_id, relative_quarantine_path, status, decision_source,
          gallery_title, media_count, total_size, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `).run(
        jobId,
        gallery.id,
        relativeQuarantinePath,
        decisionSource,
        gallery.title,
        stats.mediaCount,
        stats.totalSize,
        now,
        now
      );

      // Delete gallery record: foreign keys ON DELETE CASCADE immediately purge gallery_codes, gallery_media!
      db.prepare("DELETE FROM galleries WHERE id = ?").run(gallery.id);

      deletionPlans.push({
        galleryId: gallery.id,
        jobId,
        title: gallery.title,
        mediaCount: stats.mediaCount,
        totalSize: stats.totalSize,
        knownImportFolders: importFolders,
        relativeQuarantinePath,
      });
    }

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    throw err;
  }

  // 2. Filesystem movements to quarantine (outside transaction)
  const trashBase = path.join(baseMedia, ".trash", "gallery-deletions");
  if (!fs.existsSync(trashBase)) {
    try {
      fs.mkdirSync(trashBase, { recursive: true, mode: 0o700 });
    } catch {
      // Ignored
    }
  }

  for (const plan of deletionPlans) {
    const mediaDir = path.resolve(baseMedia, plan.galleryId);
    const quarantineDir = path.resolve(baseMedia, plan.relativeQuarantinePath);

    // Confinement check
    const relMedia = path.relative(baseMedia, mediaDir);
    if (!relMedia || path.isAbsolute(relMedia) || relMedia.startsWith(".." + path.sep) || relMedia === "..") {
      continue;
    }

    if (fs.existsSync(mediaDir)) {
      try {
        const stat = fs.lstatSync(mediaDir);
        if (!stat.isSymbolicLink() && stat.isDirectory()) {
          fs.renameSync(mediaDir, quarantineDir);
        }
      } catch {
        // Recovery worker will clean up baseMedia/<galleryId> if rename fails
      }
    } else {
      try {
        fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
      } catch {
        // Ignored
      }
    }
  }

  return deletionPlans.map((p) => ({
    id: p.galleryId,
    jobId: p.jobId,
    title: p.title,
    mediaCount: p.mediaCount,
    totalSize: p.totalSize,
    knownImportFolders: p.knownImportFolders,
  }));
}

/**
 * Single gallery deletion using the unified transactional deletion service.
 */
export function deleteGalleryWithIntent(
  galleryId: string,
  options: {
    decisionSource?: string;
    expectedRevision?: number;
    checkAutoEligibility?: boolean;
  } = {}
): DeletionResult {
  const results = deleteGalleriesWithIntentBulk(
    [{ id: galleryId, expectedRevision: options.expectedRevision }],
    {
      decisionSource: options.decisionSource || "manual",
      checkAutoEligibility: options.checkAutoEligibility,
    }
  );
  return results[0];
}

/**
 * Deletes a gallery and quarantines its files using the unified transactional deletion service.
 */
export function deleteGalleryAndQuarantine(galleryId: string, expectedRevision?: number): void {
  deleteGalleryWithIntent(galleryId, { decisionSource: "manual", expectedRevision });
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

  let jobsToProcess: { id: string; gallery_id: string; relative_quarantine_path: string; attempt_count: number }[];

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const pending = db.prepare(`
      SELECT id, gallery_id, relative_quarantine_path, attempt_count
      FROM gallery_deletion_jobs
      WHERE (status = 'pending' OR (status = 'processing' AND lease_expires_at < ?))
        AND attempt_count < ?
      LIMIT ?
    `).all(now, maxAttempts, batchSize) as {
      id: string;
      gallery_id: string;
      relative_quarantine_path: string;
      attempt_count: number;
    }[];

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
      // Validate relative quarantine path convention exactly
      const expectedRel = path.join(".trash", "gallery-deletions", job.id);
      const normalizedJobRel = path.normalize(job.relative_quarantine_path);
      if (normalizedJobRel !== expectedRel) {
        throw new Error("INVALID_QUARANTINE_CONVENTION");
      }

      safeDeleteQuarantineTarget(baseMedia, job.id, job.gallery_id);

      db.prepare(`
        UPDATE gallery_deletion_jobs
        SET status = 'completed',
            completed_at = ?,
            worker_id = NULL,
            lease_expires_at = NULL,
            updated_at = ?
        WHERE id = ? AND worker_id = ?
      `).run(Date.now(), Date.now(), job.id, workerId);
    } catch (err: unknown) {
      const rawCode = err instanceof Error ? err.message : "CLEANUP_FAILED";
      const safeCode = rawCode.slice(0, 100);
      db.prepare(`
        UPDATE gallery_deletion_jobs
        SET status = 'failed',
            error_code = ?,
            worker_id = NULL,
            lease_expires_at = NULL,
            updated_at = ?
        WHERE id = ? AND worker_id = ?
      `).run(safeCode, Date.now(), job.id, workerId);
    }
  }
}
