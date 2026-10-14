import type { DatabaseSync } from "node:sqlite";
import {
  getGalleryDb,
  processGalleryDeletions,
  deleteGalleriesWithIntentBulk,
  deleteGalleryWithIntent,
} from "./gallery-db.server";
import { GalleryConflictError, GalleryValidationError } from "./gallery.server";

export { deleteGalleriesWithIntentBulk, deleteGalleryWithIntent };

export interface RetentionSettings {
  enabled: boolean;
  retentionDays: number | null;
  logRetentionDays: number | null;
  revision: number;
  updatedAt: number;
}

export interface GalleryRetentionItem {
  id: string;
  publicId: string;
  title: string;
  clientName: string;
  projectDate: string;
  status: "draft" | "published" | "archived";
  expiresAt: number | null;
  revision: number;
  createdAt: number;
  retentionExempt: boolean;
  retentionExemptReason: string | null;
  photoCount: number;
  videoCount: number;
  totalSize: number;
  activeImportCount: number;
  knownImportFolders: string[];
  isExpired: boolean;
  isExpiringSoon: boolean;
  scheduledPurgeAt: number | null;
  isEligiblePurge: boolean;
  eligiblePurgeReason?: string;
  deletionStatus?: "pending" | "processing" | "failed" | "completed";
  deletionErrorCode?: string | null;
  deletionJobId?: string | null;
}

export interface RetentionImpactSimulation {
  proposedEnabled: boolean;
  proposedRetentionDays: number | null;
  totalGalleries: number;
  totalMediaCount: number;
  totalSize: number;
  immediatelyEligibleCount: number;
  immediatelyEligibleTotalSize: number;
  immediatelyEligibleGalleries: {
    id: string;
    title: string;
    clientName: string;
    expiresAt: number;
    scheduledPurgeAt: number;
    photoCount: number;
    videoCount: number;
    totalSize: number;
  }[];
}

export interface DeletionResult {
  id: string;
  jobId: string;
  title: string;
  mediaCount: number;
  totalSize: number;
  knownImportFolders: string[];
}

export interface DeletionJobsSummary {
  pending: number;
  processing: number;
  failed: number;
  failedJobs: {
    id: string;
    gallery_id: string;
    gallery_title: string | null;
    error_code: string | null;
    updated_at: number;
    attempt_count: number;
  }[];
}

/**
 * Returns current retention settings from SQLite.
 */
export function getRetentionSettings(dbInstance?: DatabaseSync): RetentionSettings {
  const db = dbInstance || getGalleryDb();
  const row = db
    .prepare("SELECT enabled, retention_days, log_retention_days, revision, updated_at FROM retention_settings WHERE id = 1")
    .get() as
    | {
        enabled: number;
        retention_days: number | null;
        log_retention_days: number | null;
        revision: number;
        updated_at: number;
      }
    | undefined;

  if (!row) {
    return {
      enabled: false,
      retentionDays: null,
      logRetentionDays: null,
      revision: 1,
      updatedAt: Date.now(),
    };
  }

  return {
    enabled: Boolean(row.enabled),
    retentionDays: row.retention_days,
    logRetentionDays: row.log_retention_days,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

/**
 * Updates retention settings with optimistic revision check.
 */
export function updateRetentionSettings(
  data: {
    enabled: boolean;
    retentionDays: number | null;
    logRetentionDays: number | null;
  },
  expectedRevision: number
): RetentionSettings {
  if (data.retentionDays !== null) {
    if (!Number.isInteger(data.retentionDays) || data.retentionDays < 1 || data.retentionDays > 3650) {
      throw new GalleryValidationError("Le délai de conservation doit être un entier compris entre 1 et 3650 jours.");
    }
  }
  if (data.logRetentionDays !== null) {
    if (!Number.isInteger(data.logRetentionDays) || data.logRetentionDays < 1 || data.logRetentionDays > 3650) {
      throw new GalleryValidationError("La durée de conservation du journal doit être un entier compris entre 1 et 3650 jours.");
    }
  }

  const db = getGalleryDb();
  const now = Date.now();

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const current = db.prepare("SELECT revision FROM retention_settings WHERE id = 1").get() as
      | { revision: number }
      | undefined;

    if (!current) {
      throw new Error("Configuration introuvable");
    }

    if (current.revision !== expectedRevision) {
      throw new GalleryConflictError("Conflit de révision sur les paramètres de conservation. Veuillez recharger la page.");
    }

    db.prepare(`
      UPDATE retention_settings
      SET enabled = ?,
          retention_days = ?,
          log_retention_days = ?,
          revision = revision + 1,
          updated_at = ?
      WHERE id = 1 AND revision = ?
    `).run(
      data.enabled ? 1 : 0,
      data.retentionDays,
      data.logRetentionDays,
      now,
      expectedRevision
    );

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    throw err;
  }

  return getRetentionSettings();
}

/**
 * Calculates scheduled purge date in pure UTC milliseconds.
 * Returns null if policy is disabled, delay unconfigured, or gallery has no expiration.
 */
export function calculateScheduledPurgeAt(
  expiresAt: number | null,
  retentionDays: number | null,
  enabled: boolean
): number | null {
  if (!enabled || retentionDays === null || expiresAt === null) {
    return null;
  }
  return expiresAt + retentionDays * 86_400_000;
}

/**
 * Evaluates whether a gallery is eligible for automatic deletion.
 */
export function isGalleryEligibleForPurge(
  gallery: {
    status: string;
    expiresAt: number | null;
    retentionExempt: boolean;
    activeImportCount: number;
    deletionStatus?: string | null;
  },
  settings: RetentionSettings,
  now: number = Date.now()
): { eligible: boolean; reason: string } {
  if (!settings.enabled) {
    return { eligible: false, reason: "Politique de purge automatique désactivée" };
  }
  if (settings.retentionDays === null) {
    return { eligible: false, reason: "Délai de purge non configuré" };
  }
  if (gallery.status === "draft") {
    return { eligible: false, reason: "Brouillon sans expiration : non éligible" };
  }
  if (gallery.expiresAt === null) {
    return { eligible: false, reason: "Aucune date d'expiration définie" };
  }
  if (gallery.expiresAt > now) {
    return { eligible: false, reason: "Accès client non encore expiré" };
  }
  if (gallery.retentionExempt) {
    return { eligible: false, reason: "Galerie suspendue / exemptée de la purge automatique" };
  }
  if (gallery.activeImportCount > 0) {
    return { eligible: false, reason: "Importation active en cours : purge reportée" };
  }
  if (gallery.deletionStatus === "pending" || gallery.deletionStatus === "processing") {
    return { eligible: false, reason: "Suppression déjà en cours" };
  }

  const purgeAt = calculateScheduledPurgeAt(gallery.expiresAt, settings.retentionDays, true);
  if (purgeAt === null || purgeAt > now) {
    return { eligible: false, reason: "Échéance de purge non atteinte" };
  }

  return { eligible: true, reason: "Éligible à la purge automatique" };
}

/**
 * Sets gallery retention exemption with optional reason and optimistic concurrency check.
 */
export function setGalleryRetentionExempt(
  galleryId: string,
  exempt: boolean,
  reason?: string | null,
  expectedRevision?: number
): void {
  if (!galleryId || !/^[0-9a-fA-F-]{36}$/.test(galleryId)) {
    throw new GalleryValidationError("ID de galerie invalide");
  }
  const cleanReason = reason ? reason.trim().slice(0, 200) : null;
  const db = getGalleryDb();
  const now = Date.now();

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const current = db.prepare("SELECT revision FROM galleries WHERE id = ?").get(galleryId) as
      | { revision: number }
      | undefined;
    if (!current) {
      throw new GalleryValidationError("Galerie introuvable");
    }
    if (typeof expectedRevision === "number" && current.revision !== expectedRevision) {
      throw new GalleryConflictError("Conflit de révision lors de la modification de l'exemption.");
    }

    const res = db.prepare(`
      UPDATE galleries
      SET retention_exempt = ?,
          retention_exempt_reason = ?,
          revision = revision + 1,
          updated_at = ?
      WHERE id = ?
    `).run(exempt ? 1 : 0, cleanReason, now, galleryId);

    if (res.changes === 0) {
      throw new Error("Échec de la mise à jour de l'exemption");
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
}

/**
 * Simulates the impact of a proposed retention policy without modifying any database or disk state.
 */
export function simulateRetentionImpact(
  newSettings: { enabled: boolean; retentionDays: number | null },
  dbInstance?: DatabaseSync
): RetentionImpactSimulation {
  const db = dbInstance || getGalleryDb();
  const now = Date.now();

  const galleries = db.prepare(`
    SELECT
      g.id,
      g.title,
      g.client_name,
      g.status,
      g.expires_at,
      g.retention_exempt,
      COALESCE(SUM(CASE WHEN m.media_type = 'photo' AND m.is_ready = 1 THEN 1 ELSE 0 END), 0) as photo_count,
      COALESCE(SUM(CASE WHEN m.media_type = 'video' AND m.is_ready = 1 THEN 1 ELSE 0 END), 0) as video_count,
      COALESCE(SUM(CASE WHEN m.is_ready = 1 THEN m.file_size ELSE 0 END), 0) as total_size,
      (
        SELECT COUNT(*) FROM gallery_import_jobs ij
        WHERE ij.gallery_id = g.id AND ij.status IN ('pending', 'scanning', 'importing')
      ) as active_import_count,
      (
        SELECT dj.status FROM gallery_deletion_jobs dj
        WHERE dj.gallery_id = g.id
        ORDER BY dj.created_at DESC LIMIT 1
      ) as deletion_status
    FROM galleries g
    LEFT JOIN gallery_media m ON m.gallery_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `).all() as {
    id: string;
    title: string;
    client_name: string;
    status: string;
    expires_at: number | null;
    retention_exempt: number;
    photo_count: number;
    video_count: number;
    total_size: number;
    active_import_count: number;
    deletion_status: string | null;
  }[];

  let totalMediaCount = 0;
  let totalSize = 0;
  let immediatelyEligibleCount = 0;
  let immediatelyEligibleTotalSize = 0;
  const immediatelyEligibleGalleries: RetentionImpactSimulation["immediatelyEligibleGalleries"] = [];

  const simSettings: RetentionSettings = {
    enabled: newSettings.enabled,
    retentionDays: newSettings.retentionDays,
    logRetentionDays: null,
    revision: 0,
    updatedAt: now,
  };

  for (const g of galleries) {
    const photos = Number(g.photo_count) || 0;
    const videos = Number(g.video_count) || 0;
    const size = Number(g.total_size) || 0;

    totalMediaCount += photos + videos;
    totalSize += size;

    const eligibility = isGalleryEligibleForPurge(
      {
        status: g.status,
        expiresAt: g.expires_at,
        retentionExempt: Boolean(g.retention_exempt),
        activeImportCount: Number(g.active_import_count) || 0,
        deletionStatus: g.deletion_status,
      },
      simSettings,
      now
    );

    if (eligibility.eligible && g.expires_at !== null) {
      const scheduledPurgeAt = calculateScheduledPurgeAt(g.expires_at, newSettings.retentionDays, true) ?? now;
      immediatelyEligibleCount++;
      immediatelyEligibleTotalSize += size;
      immediatelyEligibleGalleries.push({
        id: g.id,
        title: g.title,
        clientName: g.client_name,
        expiresAt: g.expires_at,
        scheduledPurgeAt,
        photoCount: photos,
        videoCount: videos,
        totalSize: size,
      });
    }
  }

  return {
    proposedEnabled: newSettings.enabled,
    proposedRetentionDays: newSettings.retentionDays,
    totalGalleries: galleries.length,
    totalMediaCount,
    totalSize,
    immediatelyEligibleCount,
    immediatelyEligibleTotalSize,
    immediatelyEligibleGalleries,
  };
}

export interface GetGalleriesRetentionParams {
  search?: string;
  filter?: "all" | "active" | "expired" | "soon" | "eligible" | "exempt" | "importing" | "error";
  limit?: number;
  offset?: number;
}

/**
 * Returns paginated galleries with retention status, metrics and filters.
 */
export function getGalleriesRetentionList(params: GetGalleriesRetentionParams = {}): {
  items: GalleryRetentionItem[];
  total: number;
  settings: RetentionSettings;
} {
  const db = getGalleryDb();
  const settings = getRetentionSettings(db);
  const now = Date.now();
  const soonLimit = now + 7 * 86_400_000;

  const rawRows = db.prepare(`
    SELECT
      g.id,
      g.public_id,
      g.title,
      g.client_name,
      g.project_date,
      g.status,
      g.expires_at,
      g.revision,
      g.created_at,
      g.retention_exempt,
      g.retention_exempt_reason,
      COALESCE(SUM(CASE WHEN m.media_type = 'photo' AND m.is_ready = 1 THEN 1 ELSE 0 END), 0) as photo_count,
      COALESCE(SUM(CASE WHEN m.media_type = 'video' AND m.is_ready = 1 THEN 1 ELSE 0 END), 0) as video_count,
      COALESCE(SUM(CASE WHEN m.is_ready = 1 THEN m.file_size ELSE 0 END), 0) as total_size,
      (
        SELECT COUNT(*) FROM gallery_import_jobs ij
        WHERE ij.gallery_id = g.id AND ij.status IN ('pending', 'scanning', 'importing')
      ) as active_import_count,
      (
        SELECT GROUP_CONCAT(DISTINCT ij.import_folder) FROM gallery_import_jobs ij
        WHERE ij.gallery_id = g.id
      ) as known_import_folders_str,
      (
        SELECT dj.status FROM gallery_deletion_jobs dj
        WHERE dj.gallery_id = g.id
        ORDER BY dj.created_at DESC LIMIT 1
      ) as deletion_status,
      (
        SELECT dj.id FROM gallery_deletion_jobs dj
        WHERE dj.gallery_id = g.id
        ORDER BY dj.created_at DESC LIMIT 1
      ) as deletion_job_id,
      (
        SELECT dj.error_code FROM gallery_deletion_jobs dj
        WHERE dj.gallery_id = g.id AND dj.status = 'failed'
        ORDER BY dj.created_at DESC LIMIT 1
      ) as deletion_error_code
    FROM galleries g
    LEFT JOIN gallery_media m ON m.gallery_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC, g.id ASC
  `).all() as {
    id: string;
    public_id: string;
    title: string;
    client_name: string;
    project_date: string;
    status: "draft" | "published" | "archived";
    expires_at: number | null;
    revision: number;
    created_at: number;
    retention_exempt: number;
    retention_exempt_reason: string | null;
    photo_count: number;
    video_count: number;
    total_size: number;
    active_import_count: number;
    known_import_folders_str: string | null;
    deletion_status: "pending" | "processing" | "failed" | "completed" | null;
    deletion_job_id: string | null;
    deletion_error_code: string | null;
  }[];

  const search = (params.search || "").trim().toLowerCase();
  const filter = params.filter || "all";

  const allItems: GalleryRetentionItem[] = [];

  for (const r of rawRows) {
    const isExpired = r.expires_at !== null && r.expires_at < now;
    const isExpiringSoon = r.expires_at !== null && r.expires_at >= now && r.expires_at <= soonLimit;
    const scheduledPurgeAt = calculateScheduledPurgeAt(r.expires_at, settings.retentionDays, settings.enabled);

    const eligibility = isGalleryEligibleForPurge(
      {
        status: r.status,
        expiresAt: r.expires_at,
        retentionExempt: Boolean(r.retention_exempt),
        activeImportCount: Number(r.active_import_count) || 0,
        deletionStatus: r.deletion_status,
      },
      settings,
      now
    );

    const knownImportFolders = r.known_import_folders_str
      ? r.known_import_folders_str.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const item: GalleryRetentionItem = {
      id: r.id,
      publicId: r.public_id,
      title: r.title,
      clientName: r.client_name,
      projectDate: r.project_date,
      status: r.status,
      expiresAt: r.expires_at,
      revision: r.revision,
      createdAt: r.created_at,
      retentionExempt: Boolean(r.retention_exempt),
      retentionExemptReason: r.retention_exempt_reason,
      photoCount: Number(r.photo_count) || 0,
      videoCount: Number(r.video_count) || 0,
      totalSize: Number(r.total_size) || 0,
      activeImportCount: Number(r.active_import_count) || 0,
      knownImportFolders,
      isExpired,
      isExpiringSoon,
      scheduledPurgeAt,
      isEligiblePurge: eligibility.eligible,
      eligiblePurgeReason: eligibility.reason,
      deletionStatus: r.deletion_status || undefined,
      deletionErrorCode: r.deletion_error_code,
      deletionJobId: r.deletion_job_id,
    };

    // Apply search
    if (search) {
      const match =
        item.title.toLowerCase().includes(search) ||
        item.clientName.toLowerCase().includes(search) ||
        item.publicId.toLowerCase().includes(search) ||
        item.id.toLowerCase() === search;
      if (!match) continue;
    }

    // Apply filter
    if (filter === "active" && (!item.status || item.status !== "published" || item.isExpired)) {
      continue;
    }
    if (filter === "expired" && !item.isExpired) {
      continue;
    }
    if (filter === "soon" && !item.isExpiringSoon) {
      continue;
    }
    if (filter === "eligible" && !item.isEligiblePurge) {
      continue;
    }
    if (filter === "exempt" && !item.retentionExempt) {
      continue;
    }
    if (filter === "importing" && item.activeImportCount === 0) {
      continue;
    }
    if (filter === "error" && (!item.deletionErrorCode && item.deletionStatus !== "failed")) {
      continue;
    }

    allItems.push(item);
  }

  const limit = Math.min(100, Math.max(1, params.limit || 25));
  const offset = Math.max(0, params.offset || 0);
  const items = allItems.slice(offset, offset + limit);

  return {
    items,
    total: allItems.length,
    settings,
  };
}

/**
 * Returns summary of deletion jobs for admin overview and error resolution.
 */
export function getDeletionJobsSummary(): DeletionJobsSummary {
  const db = getGalleryDb();
  const counts = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
      COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) as processing,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed
    FROM gallery_deletion_jobs
  `).get() as { pending: number; processing: number; failed: number };

  const failedJobs = db.prepare(`
    SELECT id, gallery_id, gallery_title, error_code, updated_at, attempt_count
    FROM gallery_deletion_jobs
    WHERE status = 'failed'
    ORDER BY updated_at DESC
    LIMIT 20
  `).all() as unknown as DeletionJobsSummary["failedJobs"];

  return {
    pending: counts.pending,
    processing: counts.processing,
    failed: counts.failed,
    failedJobs,
  };
}

/**
 * Retries a failed gallery deletion job.
 */
export function retryFailedDeletionJob(jobId: string): void {
  if (!jobId || !/^[0-9a-fA-F-]{36}$/.test(jobId)) {
    throw new GalleryValidationError("ID de tâche de suppression invalide");
  }

  const db = getGalleryDb();
  const now = Date.now();

  db.exec("BEGIN EXCLUSIVE TRANSACTION;");
  try {
    const job = db.prepare("SELECT id, status FROM gallery_deletion_jobs WHERE id = ?").get(jobId) as
      | { id: string; status: string }
      | undefined;

    if (!job) {
      throw new GalleryValidationError("Tâche de suppression introuvable");
    }

    if (job.status !== "failed") {
      throw new GalleryValidationError("Seule une tâche en échec peut être relancée");
    }

    db.prepare(`
      UPDATE gallery_deletion_jobs
      SET status = 'pending',
          attempt_count = 0,
          error_code = NULL,
          worker_id = NULL,
          lease_expires_at = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(now, jobId);

    db.exec("COMMIT;");
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Ignored
    }
    throw err;
  }

  processGalleryDeletions();
}

/**
 * Prunes completed deletion audit logs older than logRetentionDays.
 * Never touches pending or failed jobs.
 */
export function pruneRetentionAuditLogs(maxDays?: number | null): number {
  const db = getGalleryDb();
  let days = maxDays;
  if (days === undefined) {
    const settings = getRetentionSettings(db);
    days = settings.logRetentionDays;
  }

  if (days === null || days === undefined || days <= 0) {
    return 0;
  }

  const cutoff = Date.now() - days * 86_400_000;
  const res = db.prepare(`
    DELETE FROM gallery_deletion_jobs
    WHERE status = 'completed' AND completed_at IS NOT NULL AND completed_at < ?
  `).run(cutoff);

  return Number(res.changes);
}

/**
 * Returns all galleries immediately eligible for automatic retention purge.
 */
export function getRetentionEligibleGalleries(limit = 50): { id: string; revision: number; title: string }[] {
  const db = getGalleryDb();
  const settings = getRetentionSettings(db);
  if (!settings.enabled || settings.retentionDays === null) {
    return [];
  }

  const now = Date.now();
  const cutoffExpiresAt = now - settings.retentionDays * 86_400_000;

  const rows = db.prepare(`
    SELECT g.id, g.revision, g.title
    FROM galleries g
    WHERE g.status != 'draft'
      AND g.expires_at IS NOT NULL
      AND g.expires_at <= ?
      AND g.retention_exempt = 0
      AND (
        SELECT COUNT(*) FROM gallery_import_jobs ij
        WHERE ij.gallery_id = g.id AND ij.status IN ('pending', 'scanning', 'importing')
      ) = 0
      AND (
        SELECT COUNT(*) FROM gallery_deletion_jobs dj
        WHERE dj.gallery_id = g.id AND dj.status IN ('pending', 'processing')
      ) = 0
    ORDER BY g.expires_at ASC
    LIMIT ?
  `).all(cutoffExpiresAt, limit) as { id: string; revision: number; title: string }[];

  return rows;
}


