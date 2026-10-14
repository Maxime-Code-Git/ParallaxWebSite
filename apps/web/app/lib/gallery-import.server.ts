import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { ENV } from "./env.server";
import { getGalleryDb, processGalleryDeletions } from "./gallery-db.server";
import { generateAllPreviews, removePreviews } from "./gallery-preview.server";
import { verifySecurePathChain, imageProcessingLimiter, ConcurrencyLimitError } from "./media-image.server";
import {
  getRetentionSettings,
  getRetentionEligibleGalleries,
  deleteGalleriesWithIntentBulk,
  pruneRetentionAuditLogs,
} from "./gallery-retention.server";

export const MAX_MEDIA_COUNT = 2000;
export const MAX_PHOTO_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB
export const MAX_VIDEO_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB
export const MAX_TOTAL_IMPORT_SIZE = 100 * 1024 * 1024 * 1024; // 100 GiB
export const MAX_IMAGE_DIMENSION = 12000;
export const MAX_IMAGE_PIXELS = 80_000_000; // 80 MP

const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm"]);

const LEASE_DURATION_MS = 60 * 1000; // 60 seconds

export class DeposedWorkerError extends Error {
  constructor(message = "Bail d'importation expiré ou transféré.") {
    super(message);
    this.name = "DeposedWorkerError";
  }
}

export interface RejectedFileItem {
  file: string;
  reason: string;
}

export interface ImportAnalysisResult {
  folderName: string;
  validPhotosCount: number;
  validVideosCount: number;
  totalSize: number;
  rejectedFiles: RejectedFileItem[];
}

interface ScannedCandidate {
  fullPath: string;
  relativeName: string;
  mediaType: "photo" | "video";
  mimeType: string;
  size: number;
}

/**
 * Validates and returns the sanitized list of subfolders available in GALLERY_IMPORT_PATH.
 */
export function getAvailableImportFolders(): string[] {
  const base = path.resolve(ENV.GALLERY_IMPORT_PATH);
  if (!fs.existsSync(base)) return [];

  const baseStat = fs.lstatSync(base);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) return [];

  const entries = fs.readdirSync(base, { withFileTypes: true });
  return entries
    .filter((e) => {
      if (!e.isDirectory()) return false;
      const fullPath = path.join(base, e.name);
      try {
        const stat = fs.lstatSync(fullPath);
        return !stat.isSymbolicLink();
      } catch {
        return false;
      }
    })
    .map((e) => e.name)
    .sort();
}

/**
 * Validates and confines an import folder name within GALLERY_IMPORT_PATH.
 */
function resolveImportFolder(folderName: string): string {
  const cleanName = path.basename(folderName.trim());
  if (!cleanName || cleanName === "." || cleanName === "..") {
    throw new Error("Nom de dossier d'import invalide");
  }

  const base = path.resolve(ENV.GALLERY_IMPORT_PATH);
  verifySecurePathChain(base, [cleanName], "directory");
  return path.join(base, cleanName);
}

/**
 * Detects MIME type from file header bytes (magic bytes).
 */
export function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // WebP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  // WebM
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "video/webm";
  }
  // MP4 / AVIF (ISO Base Media File Format)
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["avif", "avis", "mif1", "miaf"].includes(brand)) {
      return "image/avif";
    }
    if (brand.startsWith("mp4") || brand.startsWith("iso") || brand === "avc1" || brand.startsWith("M4V")) {
      return "video/mp4";
    }
  }

  return null;
}

/**
 * Scans candidate files in a subfolder (photos/ or videos/).
 */
function scanSubFolder(
  folderPath: string,
  subName: "photos" | "videos",
  rejected: RejectedFileItem[],
  runningTotalCount: { count: number }
): ScannedCandidate[] {
  const subDir = path.join(folderPath, subName);
  if (!fs.existsSync(subDir)) return [];

  const subStat = fs.lstatSync(subDir);
  if (subStat.isSymbolicLink() || !subStat.isDirectory()) {
    rejected.push({ file: subName, reason: "Le sous-dossier ne doit pas être un lien symbolique." });
    return [];
  }

  const entries = fs.readdirSync(subDir, { withFileTypes: true });
  const results: ScannedCandidate[] = [];

  for (const entry of entries) {
    const fullPath = path.join(subDir, entry.name);
    const relativeName = `${subName}/${entry.name}`;

    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        rejected.push({ file: relativeName, reason: "Les liens symboliques sont interdits." });
        continue;
      }
      if (!stat.isFile()) {
        rejected.push({ file: relativeName, reason: "Ce n'est pas un fichier standard." });
        continue;
      }

      // Check max media count limit
      if (runningTotalCount.count >= MAX_MEDIA_COUNT) {
        rejected.push({
          file: relativeName,
          reason: `Limite maximale de ${MAX_MEDIA_COUNT} fichiers par import dépassée.`,
        });
        continue;
      }

      // Check max size
      const isPhoto = subName === "photos";
      const maxAllowed = isPhoto ? MAX_PHOTO_FILE_SIZE : MAX_VIDEO_FILE_SIZE;
      if (stat.size > maxAllowed) {
        rejected.push({
          file: relativeName,
          reason: `Fichier trop volumineux (${(stat.size / 1024 / 1024).toFixed(1)} Mo, limite: ${(maxAllowed / 1024 / 1024).toFixed(0)} Mo).`,
        });
        continue;
      }
      if (stat.size === 0) {
        rejected.push({ file: relativeName, reason: "Fichier vide (0 octet)." });
        continue;
      }

      // Read magic bytes
      const fd = fs.openSync(fullPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let mime: string | null = null;
      try {
        const header = Buffer.alloc(64);
        const bytesRead = fs.readSync(fd, header, 0, 64, 0);
        if (bytesRead >= 12) {
          mime = detectMimeFromBuffer(header);
        }
      } finally {
        fs.closeSync(fd);
      }

      if (!mime) {
        rejected.push({ file: relativeName, reason: "Format de fichier non reconnu ou non supporté." });
        continue;
      }

      if (isPhoto && !PHOTO_MIMES.has(mime)) {
        rejected.push({ file: relativeName, reason: `Format ${mime} non autorisé dans le dossier photos.` });
        continue;
      }
      if (!isPhoto && !VIDEO_MIMES.has(mime)) {
        rejected.push({ file: relativeName, reason: `Format ${mime} non autorisé dans le dossier vidéos.` });
        continue;
      }

      runningTotalCount.count++;
      results.push({
        fullPath,
        relativeName,
        mediaType: isPhoto ? "photo" : "video",
        mimeType: mime,
        size: stat.size,
      });
    } catch (err) {
      rejected.push({ file: relativeName, reason: `Erreur d'accès au fichier: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  return results;
}

/**
 * Analyzes the contents of an import folder without writing to database or storage.
 */
export function analyzeImportFolder(folderName: string): ImportAnalysisResult {
  const folderPath = resolveImportFolder(folderName);
  const rejectedFiles: RejectedFileItem[] = [];
  const runningTotalCount = { count: 0 };

  const photos = scanSubFolder(folderPath, "photos", rejectedFiles, runningTotalCount);
  const videos = scanSubFolder(folderPath, "videos", rejectedFiles, runningTotalCount);

  const totalSize = [...photos, ...videos].reduce((acc, f) => acc + f.size, 0);

  return {
    folderName: path.basename(folderPath),
    validPhotosCount: photos.length,
    validVideosCount: videos.length,
    totalSize,
    rejectedFiles,
  };
}

/**
 * Creates a persistent import job in the database.
 * Enforces limits and atomic uniqueness per gallery.
 */
export function startImportJob(galleryId: string, folderName: string): string {
  resolveImportFolder(folderName);
  const db = getGalleryDb();

  // Check if gallery exists
  const gallery = db.prepare("SELECT id FROM galleries WHERE id = ?").get(galleryId);
  if (!gallery) {
    throw new Error("Galerie introuvable.");
  }

  // Pre-check for active import job
  const activeJob = db.prepare(`
    SELECT id, status FROM gallery_import_jobs
    WHERE gallery_id = ? AND status IN ('pending', 'scanning', 'importing')
  `).get(galleryId) as { id: string; status: string } | undefined;

  if (activeJob) {
    throw new Error(`Un import est deja en cours pour cette galerie (statut: ${activeJob.status}).`);
  }

  const analysis = analyzeImportFolder(folderName);
  const totalFiles = analysis.validPhotosCount + analysis.validVideosCount;
  if (totalFiles === 0) {
    throw new Error("Le dossier d'import ne contient aucun fichier photo ou vidéo valide.");
  }

  if (totalFiles > MAX_MEDIA_COUNT) {
    throw new Error(`Le lot d'importation contient ${totalFiles} fichiers, dépassant la limite autorisée de ${MAX_MEDIA_COUNT} médias.`);
  }

  if (analysis.totalSize > MAX_TOTAL_IMPORT_SIZE) {
    throw new Error(
      `Le volume total du lot (${(analysis.totalSize / (1024 * 1024 * 1024)).toFixed(1)} Go) dépasse la limite autorisée de ${(MAX_TOTAL_IMPORT_SIZE / (1024 * 1024 * 1024)).toFixed(0)} Go.`
    );
  }

  const existingCountRow = db.prepare(`
    SELECT COUNT(*) as count FROM gallery_media WHERE gallery_id = ?
  `).get(galleryId) as { count: number };
  const existingCount = existingCountRow?.count ?? 0;

  if (existingCount + totalFiles > MAX_MEDIA_COUNT) {
    throw new Error(
      `La galerie contient déjà ${existingCount} médias. L'import de ${totalFiles} médias dépasserait la limite maximale de ${MAX_MEDIA_COUNT} médias par galerie.`
    );
  }

  const jobId = crypto.randomUUID();
  const now = Date.now();

  try {
    db.prepare(`
      INSERT INTO gallery_import_jobs (
        id, gallery_id, import_folder, status,
        progress_total, progress_current,
        scanned_photos, scanned_videos, rejected_files, rejection_report,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      galleryId,
      folderName,
      totalFiles,
      analysis.validPhotosCount,
      analysis.validVideosCount,
      analysis.rejectedFiles.length,
      JSON.stringify(analysis.rejectedFiles),
      now,
      now
    );
  } catch (err: unknown) {
    if (err instanceof Error && (err.message.includes("UNIQUE") || err.message.includes("constraint"))) {
      throw new Error("Un import est deja en cours pour cette galerie.", { cause: err });
    }
    throw err;
  }

  return jobId;
}

/**
 * Returns progress and status of an import job.
 */
export function getImportJobStatus(jobId: string) {
  const db = getGalleryDb();
  return db.prepare("SELECT * FROM gallery_import_jobs WHERE id = ?").get(jobId) as
    | {
        id: string;
        gallery_id: string;
        import_folder: string;
        status: string;
        progress_total: number;
        progress_current: number;
        scanned_photos: number;
        scanned_videos: number;
        rejected_files: number;
        rejection_report: string | null;
        error_message: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;
}

/**
 * Streams file content and computes SHA-256 hash securely.
 * Closes descriptors reliably and yields periodically for large files.
 */
async function streamCopyAndHash(
  sourcePath: string,
  destPath: string,
  heartbeat?: () => void
): Promise<{ hash: string; size: number }> {
  let fd: number | null = null;
  let outFd: number | null = null;

  try {
    fd = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    outFd = fs.openSync(destPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);

    const hashStream = crypto.createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let totalSize = 0;
    let bytesSinceYield = 0;

    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hashStream.update(chunk);
      fs.writeSync(outFd, chunk);
      totalSize += bytesRead;
      bytesSinceYield += bytesRead;

      // Yield event loop every 16MB for large files and verify heartbeat
      if (bytesSinceYield >= 16 * 1024 * 1024) {
        bytesSinceYield = 0;
        heartbeat?.();
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    return { hash: hashStream.digest("hex"), size: totalSize };
  } catch (err) {
    try {
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
    } catch {
      // Ignored
    }
    throw err;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignored
      }
    }
    if (outFd !== null) {
      try {
        fs.closeSync(outFd);
      } catch {
        // Ignored
      }
    }
  }
}

/**
 * Confines and verifies the gallery media directory, strictly rejecting symlinks.
 */
function ensureGalleryDirectory(baseMedia: string, galleryId: string): string {
  if (!/^[0-9a-fA-F-]{36}$/.test(galleryId)) {
    throw new Error("Identifiant de galerie invalide.");
  }

  const canonicalBase = fs.realpathSync(baseMedia);
  const target = path.join(canonicalBase, galleryId);

  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Le dossier média de la galerie ne doit pas être un lien symbolique.");
    }
    const realTarget = fs.realpathSync(target);
    const rel = path.relative(canonicalBase, realTarget);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Confinement strict non respecté pour le dossier galerie.");
    }
  } else {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  }

  return target;
}

/**
 * Safely removes a directory without following symlinks.
 */
function safeRemoveDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dirPath, entry.name);
      try {
        if (entry.isSymbolicLink() || entry.isFile()) {
          fs.unlinkSync(p);
        } else if (entry.isDirectory()) {
          safeRemoveDirectory(p);
          fs.rmdirSync(p);
        }
      } catch {
        // Ignored
      }
    }
    fs.rmdirSync(dirPath);
  } catch {
    // Ignored
  }
}

/**
 * Runs processing for a specific import job under atomic lease.
 */
export async function processImportJob(jobId: string, workerId = crypto.randomUUID()): Promise<void> {
  const db = getGalleryDb();
  const leaseToken = crypto.randomUUID();
  const now = Date.now();
  const leaseExpiresAt = now + LEASE_DURATION_MS;

  // 1. Atomic claim of job
  const claimRes = db.prepare(`
    UPDATE gallery_import_jobs
    SET status = 'importing',
        lease_worker_id = ?,
        lease_token = ?,
        lease_expires_at = ?,
        updated_at = ?
    WHERE id = ? AND (status = 'pending' OR (status = 'importing' AND lease_expires_at < ?))
  `).run(workerId, leaseToken, leaseExpiresAt, now, jobId, now);

  if (claimRes.changes === 0) {
    return; // Already being processed by another worker
  }

  const job = db.prepare("SELECT * FROM gallery_import_jobs WHERE id = ?").get(jobId) as {
    gallery_id: string;
    import_folder: string;
    rejection_report: string | null;
  } | undefined;

  if (!job) return;

  const galleryId = job.gallery_id;
  const folderPath = resolveImportFolder(job.import_folder);

  const baseMedia = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const canonicalBase = fs.realpathSync(baseMedia);

  // Staging folder for this worker on the exact same media volume
  const stagingRoot = path.join(canonicalBase, ".staging", "imports");
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const workerStagingDir = path.join(stagingRoot, `${jobId}-${workerId}`);
  fs.mkdirSync(workerStagingDir, { recursive: true, mode: 0o700 });

  // Confinement check & directory creation on destination directory
  const galleryDir = ensureGalleryDirectory(canonicalBase, galleryId);

  const rejected: RejectedFileItem[] = [];
  if (job.rejection_report) {
    try {
      rejected.push(...JSON.parse(job.rejection_report));
    } catch {
      // Ignored
    }
  }

  // Scan candidates
  const runningTotalCount = { count: 0 };
  const photos = scanSubFolder(folderPath, "photos", rejected, runningTotalCount);
  const videos = scanSubFolder(folderPath, "videos", rejected, runningTotalCount);
  const allCandidates = [...photos, ...videos];

  let processedCount = 0;

  // Lease renewal helper with strict expiration check
  const renewLease = () => {
    const currentNow = Date.now();
    const nextExpiry = currentNow + LEASE_DURATION_MS;
    const res = db.prepare(`
      UPDATE gallery_import_jobs
      SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
        AND status = 'importing' AND lease_expires_at > ?
    `).run(nextExpiry, currentNow, jobId, workerId, leaseToken, currentNow);

    if (res.changes === 0) {
      throw new DeposedWorkerError("Bail d'importation expiré ou transféré : travail abandonné.");
    }
  };

  try {
    for (const candidate of allCandidates) {
      renewLease();

      // Check if gallery was deleted during processing
      const galleryStillExists = db.prepare("SELECT id FROM galleries WHERE id = ?").get(galleryId);
      if (!galleryStillExists) {
        throw new DeposedWorkerError("La galerie a été supprimée pendant l'importation.");
      }

      const mediaId = crypto.randomUUID();
      const stagedOriginal = path.join(workerStagingDir, `${mediaId}.orig`);

      // 1. Stream copy and calculate hash in worker's private staging directory
      const { hash: contentHash, size: fileSize } = await streamCopyAndHash(
        candidate.fullPath,
        stagedOriginal,
        renewLease
      );

      // Check deduplication within gallery
      const existing = db.prepare(`
        SELECT id FROM gallery_media WHERE gallery_id = ? AND content_hash = ?
      `).get(galleryId, contentHash) as { id: string } | undefined;

      if (existing) {
        try {
          fs.unlinkSync(stagedOriginal);
        } catch {
          // Ignored
        }
        rejected.push({ file: candidate.relativeName, reason: "Fichier ignoré : contenu en double dans la galerie." });
        processedCount++;
        renewLease();
        db.prepare(`
          UPDATE gallery_import_jobs
          SET progress_current = ?, updated_at = ?
          WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
            AND status = 'importing' AND lease_expires_at > ?
        `).run(processedCount, Date.now(), jobId, workerId, leaseToken, Date.now());
        continue;
      }

      let width: number | null = null;
      let height: number | null = null;
      let previewData: string | null = null;

      if (candidate.mediaType === "photo") {
        let sharpSuccess = false;
        let attempts = 0;
        const MAX_SHARP_RETRIES = 20;

        while (!sharpSuccess && attempts < MAX_SHARP_RETRIES) {
          renewLease();

          try {
            // Read metadata using limiter
            const meta = await imageProcessingLimiter.run(async () => {
              return await sharp(stagedOriginal).metadata();
            });

            width = meta.width || null;
            height = meta.height || null;

            if (meta.pages && meta.pages > 1) {
              rejected.push({
                file: candidate.relativeName,
                reason: "Les images animées ou multipages ne sont pas acceptées.",
              });
              break;
            }

            if (width && height) {
              if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
                rejected.push({
                  file: candidate.relativeName,
                  reason: `Dimensions hors limites (${width}x${height}, max ${MAX_IMAGE_DIMENSION}px).`,
                });
                break;
              }
              if (width * height > MAX_IMAGE_PIXELS) {
                rejected.push({
                  file: candidate.relativeName,
                  reason: `Nombre de pixels hors limites (${((width * height) / 1_000_000).toFixed(1)} MP, max ${(MAX_IMAGE_PIXELS / 1_000_000).toFixed(0)} MP).`,
                });
                break;
              }
            }

            // Generate previews (ensurePreview uses imageProcessingLimiter)
            const previews = await generateAllPreviews(galleryId, mediaId, stagedOriginal);
            previewData = JSON.stringify(previews);
            sharpSuccess = true;
          } catch (imgErr) {
            if (imgErr instanceof ConcurrencyLimitError) {
              attempts++;
              if (attempts >= MAX_SHARP_RETRIES) {
                throw new Error("Saturation prolongée du traitement d'images; l'import sera repris au prochain cycle.", { cause: imgErr });
              }
              renewLease();
              await new Promise((resolve) => setTimeout(resolve, 100 * Math.min(attempts, 5)));
              continue;
            }

            // Genuine corruption / decoding failure
            try {
              fs.unlinkSync(stagedOriginal);
            } catch {
              // Ignored
            }
            removePreviews(galleryId, mediaId);
            rejected.push({
              file: candidate.relativeName,
              reason: `Image corrompue ou décodage Sharp impossible: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`,
            });
            break;
          }
        }

        if (!sharpSuccess) {
          processedCount++;
          renewLease();
          db.prepare(`
            UPDATE gallery_import_jobs
            SET progress_current = ?, updated_at = ?
            WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
              AND status = 'importing' AND lease_expires_at > ?
          `).run(processedCount, Date.now(), jobId, workerId, leaseToken, Date.now());
          continue;
        }
      }

      // Check lease and gallery existence before persistent publication
      renewLease();
      if (!db.prepare("SELECT id FROM galleries WHERE id = ?").get(galleryId)) {
        throw new DeposedWorkerError("Galerie supprimée avant la publication du média.");
      }

      // Confinement check on destination directory
      const finalDest = path.join(galleryDir, mediaId);

      // Publish staged original to final destination
      fs.renameSync(stagedOriginal, finalDest);

      const maxSortRow = db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) as maxSort FROM gallery_media WHERE gallery_id = ?
      `).get(galleryId) as { maxSort: number };

      const sortOrder = maxSortRow.maxSort + 1;
      const originalFilename = path.basename(candidate.relativeName);
      const createdAt = Date.now();
      processedCount++;

      // Atomic persistence under active lease
      db.exec("BEGIN EXCLUSIVE TRANSACTION;");
      try {
        const leaseCheck = db.prepare(`
          UPDATE gallery_import_jobs
          SET progress_current = ?, updated_at = ?
          WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
            AND status = 'importing' AND lease_expires_at > ?
        `).run(processedCount, createdAt, jobId, workerId, leaseToken, createdAt);

        if (leaseCheck.changes === 0) {
          throw new DeposedWorkerError("Perte du bail lors de l'enregistrement en base de données.");
        }

        db.prepare(`
          INSERT INTO gallery_media (
            id, gallery_id, media_type, sort_order, original_filename,
            mime_type, file_size, content_hash, width, height,
            is_ready, preview_data, poster_revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
        `).run(
          mediaId,
          galleryId,
          candidate.mediaType,
          sortOrder,
          originalFilename,
          candidate.mimeType,
          fileSize,
          contentHash,
          width,
          height,
          previewData,
          createdAt,
          createdAt
        );

        db.exec("COMMIT;");
      } catch (txErr) {
        try {
          db.exec("ROLLBACK;");
        } catch {
          // Ignored
        }
        // Rollback published disk files if transaction failed or lease lost
        try {
          fs.unlinkSync(finalDest);
        } catch {
          // Ignored
        }
        removePreviews(galleryId, mediaId);
        throw txErr;
      }
    }

    // Finalize job under valid lease
    renewLease();
    db.prepare(`
      UPDATE gallery_import_jobs
      SET status = 'completed',
          progress_current = progress_total,
          rejected_files = ?,
          rejection_report = ?,
          lease_worker_id = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = ?
      WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
        AND status = 'importing' AND lease_expires_at > ?
    `).run(rejected.length, JSON.stringify(rejected), Date.now(), jobId, workerId, leaseToken, Date.now());
  } catch (err) {
    if (err instanceof DeposedWorkerError) {
      // Deposed worker leaves job intact for the new owner
      return;
    }

    // Record failure only if lease is still held
    db.prepare(`
      UPDATE gallery_import_jobs
      SET status = 'failed',
          error_message = ?,
          lease_worker_id = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = ?
      WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
        AND status = 'importing' AND lease_expires_at > ?
    `).run(err instanceof Error ? err.message : String(err), Date.now(), jobId, workerId, leaseToken, Date.now());
    throw err;
  } finally {
    // Worker always cleans up its own staging directory
    safeRemoveDirectory(workerStagingDir);
  }
}

/**
 * Recovers and processes the next pending or expired-lease import job.
 */
export async function processNextPendingImport(): Promise<boolean> {
  const db = getGalleryDb();
  const now = Date.now();

  const candidate = db.prepare(`
    SELECT id FROM gallery_import_jobs
    WHERE status = 'pending' OR (status = 'importing' AND lease_expires_at < ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(now) as { id: string } | undefined;

  if (!candidate) return false;

  try {
    await processImportJob(candidate.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recovers interrupted import jobs by marking expired ones pending.
 */
export function resumeInterruptedImports(): void {
  const db = getGalleryDb();
  const now = Date.now();

  db.prepare(`
    UPDATE gallery_import_jobs
    SET status = 'pending',
        lease_worker_id = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = ?
    WHERE status = 'importing' AND lease_expires_at < ?
  `).run(now, now);
}

let backgroundTimer: NodeJS.Timeout | null = null;
let isRunningBackground = false;

/**
 * Executes a single cycle of automatic retention purge for eligible expired galleries.
 */
export function runRetentionAutoPurgeCycle(): number {
  const db = getGalleryDb();
  const settings = getRetentionSettings(db);
  if (!settings.enabled || settings.retentionDays === null) return 0;

  const eligible = getRetentionEligibleGalleries(50);
  if (eligible.length === 0) return 0;

  const items = eligible.map((g: { id: string; revision: number }) => ({ id: g.id, expectedRevision: g.revision }));
  try {
    const results = deleteGalleriesWithIntentBulk(items, {
      decisionSource: `policy_rev_${settings.revision}`,
      checkAutoEligibility: true,
    });
    return results.length;
  } catch {
    return 0;
  }
}

/**
 * Starts the single-instance background worker supervisor.
 * Recovers pending imports, quarantine deletions, and runs retention policy automatically.
 */
export function startGalleryBackgroundSupervisor(intervalMs = 3000): void {
  if (backgroundTimer) return;

  const runCycle = async () => {
    if (isRunningBackground) return;
    isRunningBackground = true;
    try {
      processGalleryDeletions();
      await processNextPendingImport();
      runRetentionAutoPurgeCycle();
      pruneRetentionAuditLogs();
    } catch {
      // Suppress background errors
    } finally {
      isRunningBackground = false;
    }
  };

  backgroundTimer = setInterval(runCycle, intervalMs);
  backgroundTimer.unref();

  const cleanup = () => {
    if (backgroundTimer) {
      clearInterval(backgroundTimer);
      backgroundTimer = null;
    }
  };

  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);
}

/**
 * Stops the background supervisor cleanly.
 */
export function stopGalleryBackgroundSupervisor(): void {
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
    backgroundTimer = null;
  }
}
