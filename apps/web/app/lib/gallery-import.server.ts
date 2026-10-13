import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { ENV } from "./env.server";
import { getGalleryDb } from "./gallery-db.server";
import { generateAllPreviews, removePreviews } from "./gallery-preview.server";
import { verifySecurePathChain } from "./media-image.server";

export const MAX_MEDIA_COUNT = 2000;
export const MAX_PHOTO_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB
export const MAX_VIDEO_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GiB
export const MAX_TOTAL_IMPORT_SIZE = 100 * 1024 * 1024 * 1024; // 100 GiB
export const MAX_IMAGE_DIMENSION = 12000;

const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm"]);

const LEASE_DURATION_MS = 60 * 1000; // 60 seconds

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
  rejected: RejectedFileItem[]
): ScannedCandidate[] {
  const subDir = path.join(folderPath, subName);
  if (!fs.existsSync(subDir)) return [];

  const subStat = fs.lstatSync(subDir);
  if (subStat.isSymbolicLink() || !subStat.isDirectory()) {
    rejected.push({ file: subName, reason: "Le sous-dossier ne doit pas etre un lien symbolique." });
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
        rejected.push({ file: relativeName, reason: "Format de fichier non reconnu ou non supporte." });
        continue;
      }

      if (isPhoto && !PHOTO_MIMES.has(mime)) {
        rejected.push({ file: relativeName, reason: `Format ${mime} non autorise dans le dossier photos.` });
        continue;
      }
      if (!isPhoto && !VIDEO_MIMES.has(mime)) {
        rejected.push({ file: relativeName, reason: `Format ${mime} non autorise dans le dossier videos.` });
        continue;
      }

      results.push({
        fullPath,
        relativeName,
        mediaType: isPhoto ? "photo" : "video",
        mimeType: mime,
        size: stat.size,
      });
    } catch (err) {
      rejected.push({ file: relativeName, reason: `Erreur d'acces au fichier: ${err instanceof Error ? err.message : String(err)}` });
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

  const photos = scanSubFolder(folderPath, "photos", rejectedFiles);
  const videos = scanSubFolder(folderPath, "videos", rejectedFiles);

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
 * Enforces that only one active import job exists per gallery.
 */
export function startImportJob(galleryId: string, folderName: string): string {
  resolveImportFolder(folderName);
  const db = getGalleryDb();

  // Check if an active import job already exists
  const activeJob = db.prepare(`
    SELECT id, status FROM gallery_import_jobs
    WHERE gallery_id = ? AND status IN ('pending', 'scanning', 'importing')
  `).get(galleryId) as { id: string; status: string } | undefined;

  if (activeJob) {
    throw new Error(`Un import est deja en cours pour cette galerie (statut: ${activeJob.status}).`);
  }

  const analysis = analyzeImportFolder(folderName);
  if (analysis.validPhotosCount === 0 && analysis.validVideosCount === 0) {
    throw new Error("Le dossier d'import ne contient aucun fichier photo ou video valide.");
  }

  const jobId = crypto.randomUUID();
  const now = Date.now();
  const totalFiles = analysis.validPhotosCount + analysis.validVideosCount;

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
 * Streams file content and computes SHA-256 hash from a securely opened file descriptor.
 */
async function streamCopyAndHash(
  sourcePath: string,
  destPath: string
): Promise<{ hash: string; size: number }> {
  const fd = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const outFd = fs.openSync(destPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);

  const hashStream = crypto.createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  let totalSize = 0;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hashStream.update(chunk);
      fs.writeSync(outFd, chunk);
      totalSize += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
    fs.closeSync(outFd);
  }

  return { hash: hashStream.digest("hex"), size: totalSize };
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
  };

  const galleryId = job.gallery_id;
  const folderPath = resolveImportFolder(job.import_folder);

  const rejected: RejectedFileItem[] = [];
  if (job.rejection_report) {
    try {
      rejected.push(...JSON.parse(job.rejection_report));
    } catch {
      // Ignored
    }
  }

  // Scan candidates
  const photos = scanSubFolder(folderPath, "photos", rejected);
  const videos = scanSubFolder(folderPath, "videos", rejected);
  const allCandidates = [...photos, ...videos];

  const baseMedia = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const galleryDir = path.join(baseMedia, galleryId);

  if (!fs.existsSync(galleryDir)) {
    fs.mkdirSync(galleryDir, { recursive: true, mode: 0o700 });
  }

  let processedCount = 0;

  // Heartbeat helper
  const renewLease = () => {
    const res = db.prepare(`
      UPDATE gallery_import_jobs
      SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
    `).run(Date.now() + LEASE_DURATION_MS, Date.now(), jobId, workerId, leaseToken);

    if (res.changes === 0) {
      throw new Error("Perte du bail d'importation : travail abandonne.");
    }
  };

  try {
    for (const candidate of allCandidates) {
      renewLease();

      const mediaId = crypto.randomUUID();
      const tmpDest = path.join(galleryDir, `.tmp.${mediaId}`);
      const finalDest = path.join(galleryDir, mediaId);

      // Stream copy and calculate hash
      const { hash: contentHash, size: fileSize } = await streamCopyAndHash(candidate.fullPath, tmpDest);
      fs.renameSync(tmpDest, finalDest);

      // Check deduplication within gallery
      const existing = db.prepare(`
        SELECT id FROM gallery_media WHERE gallery_id = ? AND content_hash = ?
      `).get(galleryId, contentHash) as { id: string } | undefined;

      if (existing) {
        fs.rmSync(finalDest, { force: true });
        rejected.push({ file: candidate.relativeName, reason: "Fichier ignore : contenu en double dans la galerie." });
        processedCount++;
        db.prepare(`
          UPDATE gallery_import_jobs
          SET progress_current = ?, updated_at = ?
          WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
        `).run(processedCount, Date.now(), jobId, workerId, leaseToken);
        continue;
      }

      let width: number | null = null;
      let height: number | null = null;
      let previewData: string | null = null;

      if (candidate.mediaType === "photo") {
        try {
          const meta = await sharp(finalDest).metadata();
          width = meta.width || null;
          height = meta.height || null;

          if (width && height && (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION)) {
            fs.rmSync(finalDest, { force: true });
            rejected.push({ file: candidate.relativeName, reason: `Dimensions hors limites (${width}x${height}, max ${MAX_IMAGE_DIMENSION}px).` });
            processedCount++;
            continue;
          }

          // Generate previews
          const previews = await generateAllPreviews(galleryId, mediaId, finalDest);
          previewData = JSON.stringify(previews);
        } catch (imgErr) {
          fs.rmSync(finalDest, { force: true });
          removePreviews(galleryId, mediaId);
          rejected.push({ file: candidate.relativeName, reason: `Image corrompue ou decodage Sharp impossible: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}` });
          processedCount++;
          continue;
        }
      }

      // Check lease before inserting into database
      renewLease();

      const maxSortRow = db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) as maxSort FROM gallery_media WHERE gallery_id = ?
      `).get(galleryId) as { maxSort: number };

      const sortOrder = maxSortRow.maxSort + 1;
      const originalFilename = path.basename(candidate.relativeName);
      const createdAt = Date.now();

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

      processedCount++;
      db.prepare(`
        UPDATE gallery_import_jobs
        SET progress_current = ?, updated_at = ?
        WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
      `).run(processedCount, Date.now(), jobId, workerId, leaseToken);
    }

    // Finalize job
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
    `).run(rejected.length, JSON.stringify(rejected), Date.now(), jobId, workerId, leaseToken);
  } catch (err) {
    db.prepare(`
      UPDATE gallery_import_jobs
      SET status = 'failed',
          error_message = ?,
          lease_worker_id = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = ?
      WHERE id = ? AND lease_worker_id = ? AND lease_token = ?
    `).run(err instanceof Error ? err.message : String(err), Date.now(), jobId, workerId, leaseToken);
    throw err;
  }
}

/**
 * Recovers interrupted import jobs on server startup.
 */
export function resumeInterruptedImports(): void {
  const db = getGalleryDb();
  const now = Date.now();

  // Reset expired leases so they can be picked up or inspected
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
