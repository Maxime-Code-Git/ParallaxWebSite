import * as fs from "node:fs";
import * as path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { ensureGalleryImportFolder } from "./gallery-folder.server";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FinalizeReceipt {
  success: true;
  fileName: string;
  target: UploadTarget;
  alreadyExists?: boolean;
  finalizedAt: number;
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    let bytesSinceYield = 0;
    const YIELD_THRESHOLD = 32 * 1024 * 1024; // 32 MB threshold to yield event loop

    stream.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      hash.update(buf);
      bytesSinceYield += buf.length;
      if (bytesSinceYield >= YIELD_THRESHOLD) {
        stream.pause();
        bytesSinceYield = 0;
        setImmediate(() => {
          stream.resume();
        });
      }
    });

    stream.on("error", (err) => {
      reject(err);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

export class BoundedByteCounter extends Transform {
  private bytesReceived = 0;
  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytesReceived += chunk.length;
    if (this.bytesReceived > this.maxBytes) {
      const err = new UploadValidationError(
        `Dépassement de la taille autorisée pour ce morceau (reçu > ${this.maxBytes} octets).`,
        400
      );
      callback(err);
      return;
    }
    callback(null, chunk);
  }

  getBytesReceived(): number {
    return this.bytesReceived;
  }
}

function cleanUploadChunks(uploadDir: string): void {
  try {
    const files = fs.readdirSync(uploadDir);
    for (const f of files) {
      if (f === "meta.json" || f === "finalized.json") continue;
      try {
        fs.unlinkSync(path.join(uploadDir, f));
      } catch {
        // ignore unlink error
      }
    }
  } catch {
    // ignore
  }
}

export const MAX_PHOTO_SIZE = 100 * 1024 * 1024; // 100 MB max for photos
export const MAX_VIDEO_SIZE = 20 * 1024 * 1024 * 1024; // 20 GB max for videos (21474836480 bytes, safe integer)
export const MAX_FILE_SIZE = MAX_VIDEO_SIZE;
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk
export const MIN_CHUNK_SIZE = 256 * 1024; // 256 KB min chunk (unless file is smaller)
export const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB max chunk accepted on server
export const MAX_TOTAL_CHUNKS = 5000; // 5000 chunks max per file (20 GB at 5 MB = 4096 chunks)
export const MAX_BATCH_FILES = 2000; // 2000 files max per selection/batch
export const MAX_ACTIVE_SESSIONS_PER_TARGET = 2; // 2 active sessions max per gallery and target
export const SAFETY_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB safety margin
export const ACTIVE_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity timeout

export const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
export const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

export type UploadTarget = "photos" | "videos";

export interface TargetConfig {
  folder: "photos" | "videos";
  mediaType: "photo" | "video";
  target: UploadTarget;
  maxSize: number;
  allowedMimes: Set<string>;
}

export const UPLOAD_TARGETS: Record<UploadTarget, TargetConfig> = {
  photos: {
    folder: "photos",
    mediaType: "photo",
    target: "photos",
    maxSize: MAX_PHOTO_SIZE,
    allowedMimes: PHOTO_MIME_TYPES,
  },
  videos: {
    folder: "videos",
    mediaType: "video",
    target: "videos",
    maxSize: MAX_VIDEO_SIZE,
    allowedMimes: VIDEO_MIME_TYPES,
  },
};

export function isUploadTarget(val: unknown): val is UploadTarget {
  return typeof val === "string" && Object.prototype.hasOwnProperty.call(UPLOAD_TARGETS, val);
}

export class DiskSpaceError extends Error {
  readonly status = 507;
  constructor(message = "Espace disque insuffisant sur le serveur.") {
    super(message);
    this.name = "DiskSpaceError";
  }
}

export class UploadValidationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UploadValidationError";
    this.status = status;
  }
}

export const diskChecker = {
  statfs: (targetPath: string) => fs.statfsSync(targetPath),
};

export const uploadLock = {
  isLocked: false,
  runSync<T>(fn: () => T): T {
    if (this.isLocked) {
      throw new UploadValidationError("Une initialisation d'upload est déjà en cours. Veuillez réessayer.", 429);
    }
    this.isLocked = true;
    try {
      return fn();
    } finally {
      this.isLocked = false;
    }
  },
};

export interface UploadMetadata {
  uploadId: string;
  galleryId: string;
  target: UploadTarget;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  uploadedChunks: number[];
  createdAt: number;
  updatedAt: number;
  status?: "active" | "finalized";
  finalFileName?: string;
  alreadyExists?: boolean;
  finalizedAt?: number;
}

export const receiptWriter = {
  writeReceipt(uploadDir: string, receipt: FinalizeReceipt): void {
    const receiptPath = path.join(uploadDir, "finalized.json");
    const tmpReceiptPath = path.join(
      uploadDir,
      `finalized.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`
    );
    fs.writeFileSync(tmpReceiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    try {
      const fd = fs.openSync(tmpReceiptPath, "r");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // fsync optional
    }
    fs.renameSync(tmpReceiptPath, receiptPath);
  },
};

const ongoingFinalizations = new Map<
  string,
  Promise<{
    success: boolean;
    fileName: string;
    target: UploadTarget;
    alreadyExists?: boolean;
  }>
>();

function writeMetadataAtomic(uploadDir: string, meta: UploadMetadata): void {
  const metaPath = path.join(uploadDir, "meta.json");
  const tmpMetaPath = path.join(
    uploadDir,
    `meta.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  fs.writeFileSync(tmpMetaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  try {
    const fd = fs.openSync(tmpMetaPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // fsync optional on certain filesystems
  }
  fs.renameSync(tmpMetaPath, metaPath);
}

export function computeAllActiveDiskReservations(basePath: string, excludeUploadId?: string): number {
  if (!fs.existsSync(basePath)) return 0;
  let totalReserved = 0;
  const now = Date.now();
  const maxAgeMs = ACTIVE_SESSION_TIMEOUT_MS;

  const processTmpUploadsDir = (tmpUploadsDir: string) => {
    if (!fs.existsSync(tmpUploadsDir)) return;
    try {
      const uploadDirs = fs.readdirSync(tmpUploadsDir, { withFileTypes: true });
      for (const uDir of uploadDirs) {
        if (!uDir.isDirectory()) continue;
        if (excludeUploadId && uDir.name === excludeUploadId) continue;

        const uploadPath = path.join(tmpUploadsDir, uDir.name);
        const receiptPath = path.join(uploadPath, "finalized.json");
        if (fs.existsSync(receiptPath)) continue;

        const metaPath = path.join(uploadPath, "meta.json");
        if (!fs.existsSync(metaPath)) continue;

        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;
          if (meta.status === "finalized") continue;
          const lastActive = meta.updatedAt || meta.createdAt;
          if (now - lastActive > maxAgeMs) continue;

          let bytesOnDisk = 0;
          try {
            const files = fs.readdirSync(uploadPath);
            for (const f of files) {
              if (f.startsWith("chunk_") || f === "assembled.tmp") {
                const st = fs.statSync(path.join(uploadPath, f));
                bytesOnDisk += st.size;
              }
            }
          } catch {
            // ignore file stat errors
          }

          const peakNeeded = meta.fileSize * 2;
          const remainingReservation = Math.max(0, peakNeeded - bytesOnDisk);
          totalReserved += remainingReservation;
        } catch {
          // ignore corrupted or unreadable meta
        }
      }
    } catch {
      // ignore
    }
  };

  try {
    const directTmp = path.join(basePath, ".tmp_uploads");
    if (fs.existsSync(directTmp)) {
      processTmpUploadsDir(directTmp);
    }

    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".tmp_uploads") {
        const childTmp = path.join(basePath, entry.name, ".tmp_uploads");
        processTmpUploadsDir(childTmp);
      }
    }
  } catch (err) {
    console.warn("Could not compute active disk reservations:", err);
  }

  return totalReserved;
}

export function countActiveSessionsForTarget(
  galleryFolderPath: string,
  galleryId: string,
  target: UploadTarget
): number {
  const tmpUploadsDir = path.join(galleryFolderPath, ".tmp_uploads");
  if (!fs.existsSync(tmpUploadsDir)) return 0;
  let count = 0;
  const now = Date.now();

  try {
    const entries = fs.readdirSync(tmpUploadsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const uploadPath = path.join(tmpUploadsDir, entry.name);
      const receiptPath = path.join(uploadPath, "finalized.json");
      if (fs.existsSync(receiptPath)) continue;

      const metaPath = path.join(uploadPath, "meta.json");
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;
          if (meta.status === "finalized") continue;
          const lastActive = meta.updatedAt || meta.createdAt;
          if (
            meta.galleryId === galleryId &&
            meta.target === target &&
            now - lastActive <= ACTIVE_SESSION_TIMEOUT_MS
          ) {
            count++;
          }
        } catch {
          // Do not delete recent session if reading meta momentarily fails
        }
      }
    }
  } catch {
    // ignore
  }

  return count;
}

export function checkDiskSpace(
  targetPath: string,
  requiredBytes: number,
  importBasePath?: string,
  excludeUploadId?: string
): void {
  try {
    const stats = diskChecker.statfs(targetPath);
    const rawFreeBytes = stats.bavail * stats.bsize;
    const base = importBasePath || path.dirname(targetPath);
    const activeReservations = computeAllActiveDiskReservations(base, excludeUploadId);

    const effectiveFreeBytes = rawFreeBytes - activeReservations;
    if (effectiveFreeBytes < requiredBytes + SAFETY_BUFFER_BYTES) {
      throw new DiskSpaceError();
    }
  } catch (err) {
    if (err instanceof DiskSpaceError) throw err;
    console.warn("Could not check disk space:", err);
  }
}

export function sanitizeUploadFileName(rawName: string): string {
  if (!rawName || typeof rawName !== "string") return "fichier";
  const base = path.basename(rawName).trim();
  const clean = base
    .replace(/[\0\r\n\t\\/]/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/^[.-]+/, "");
  return clean.slice(0, 200) || "fichier";
}

export function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "video/webm";
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (["avif", "avis", "mif1", "miaf"].includes(brand)) return "image/avif";
    if (brand.startsWith("iso") || brand.startsWith("mp4") || brand === "avc1" || brand.startsWith("M4V")) return "video/mp4";
  }
  return null;
}

function getUploadsBaseDir(galleryFolderPath: string): string {
  const dir = path.join(galleryFolderPath, ".tmp_uploads");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function cleanupAbandonedUploads(galleryFolderPath: string, maxAgeMs = ACTIVE_SESSION_TIMEOUT_MS): void {
  try {
    const baseDir = path.join(galleryFolderPath, ".tmp_uploads");
    if (!fs.existsSync(baseDir)) return;
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const uploadDir = path.join(baseDir, entry.name);
        const metaPath = path.join(uploadDir, "meta.json");
        let shouldRemove = false;
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;
            const lastActive = meta.updatedAt || meta.createdAt;
            if (now - lastActive > maxAgeMs) shouldRemove = true;
          } catch {
            try {
              const stat = fs.statSync(uploadDir);
              if (now - stat.mtimeMs > maxAgeMs) shouldRemove = true;
            } catch {
              // ignore stat error
            }
          }
        } else {
          try {
            const stat = fs.statSync(uploadDir);
            if (now - stat.mtimeMs > maxAgeMs) shouldRemove = true;
          } catch {
            // ignore stat error
          }
        }
        if (shouldRemove) {
          fs.rmSync(uploadDir, { recursive: true, force: true });
        }
      }
    }
  } catch (err) {
    console.warn("Error cleaning up abandoned uploads:", err);
  }
}

export function initUploadSession(
  galleryId: string,
  params: {
    uploadId?: string;
    target: UploadTarget;
    fileName: string;
    fileSize: number;
    totalChunks: number;
    chunkSize?: number;
  }
): {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  target: UploadTarget;
  finalized?: boolean;
} {
  return uploadLock.runSync(() => {
    let uploadId = params.uploadId;
    if (uploadId !== undefined) {
      if (typeof uploadId !== "string" || !UUID_REGEX.test(uploadId)) {
        throw new UploadValidationError("Identifiant d'upload invalide.", 400);
      }
    } else {
      uploadId = crypto.randomUUID();
    }

    if (!isUploadTarget(params.target)) {
      throw new UploadValidationError("Cible d'upload invalide (photos ou videos requis).", 400);
    }
    const config = UPLOAD_TARGETS[params.target];

    const cleanName = sanitizeUploadFileName(params.fileName);
    if (!cleanName || cleanName === "fichier") {
      throw new UploadValidationError("Nom de fichier invalide.", 400);
    }

    if (
      typeof params.fileSize !== "number" ||
      !Number.isSafeInteger(params.fileSize) ||
      params.fileSize <= 0
    ) {
      throw new UploadValidationError("Taille de fichier invalide (doit être un entier positif et sûr).", 400);
    }

    if (params.fileSize > config.maxSize) {
      const maxLabel = config.mediaType === "photo"
        ? `${Math.round(MAX_PHOTO_SIZE / 1024 / 1024)} Mo`
        : `${Math.round(MAX_VIDEO_SIZE / 1024 / 1024 / 1024)} Go`;
      throw new UploadValidationError(`Taille de fichier trop grande (maximum ${maxLabel}).`, 400);
    }

    let chunkSize = DEFAULT_CHUNK_SIZE;
    if (params.chunkSize !== undefined) {
      if (
        typeof params.chunkSize !== "number" ||
        !Number.isSafeInteger(params.chunkSize) ||
        params.chunkSize <= 0 ||
        params.chunkSize > MAX_CHUNK_SIZE
      ) {
        throw new UploadValidationError(`Taille de morceau invalide (maximum ${Math.round(MAX_CHUNK_SIZE / 1024 / 1024)} Mo).`, 400);
      }
      chunkSize = params.chunkSize;
    }

    const calculatedTotalChunks = Math.ceil(params.fileSize / chunkSize);
    if (calculatedTotalChunks > MAX_TOTAL_CHUNKS) {
      throw new UploadValidationError(`Nombre de morceaux trop élevé (maximum ${MAX_TOTAL_CHUNKS}).`, 400);
    }

    if (
      typeof params.totalChunks !== "number" ||
      !Number.isSafeInteger(params.totalChunks) ||
      params.totalChunks !== calculatedTotalChunks
    ) {
      throw new UploadValidationError(`Nombre de morceaux incohérent (attendu ${calculatedTotalChunks}, reçu ${params.totalChunks}).`, 400);
    }

    const folder = ensureGalleryImportFolder(galleryId);
    cleanupAbandonedUploads(folder.folderPath);

    const baseDir = getUploadsBaseDir(folder.folderPath);
    const uploadDir = path.join(baseDir, uploadId);
    const receiptPath = path.join(uploadDir, "finalized.json");
    const metaPath = path.join(uploadDir, "meta.json");

    // Idempotent resume: if already finalized with this uploadId
    if (fs.existsSync(receiptPath)) {
      try {
        const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf-8")) as FinalizeReceipt;
        return {
          uploadId,
          chunkSize,
          totalChunks: calculatedTotalChunks,
          uploadedChunks: Array.from({ length: calculatedTotalChunks }, (_, i) => i),
          target: receipt.target || params.target,
          finalized: true,
        };
      } catch {
        // ignore corrupted receipt
      }
    }

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;
        if (meta.galleryId === galleryId && meta.finalFileName) {
          const recordedDest = path.join(folder.folderPath, config.folder, meta.finalFileName);
          if (meta.alreadyExists || fs.existsSync(recordedDest)) {
            return {
              uploadId,
              chunkSize: meta.chunkSize,
              totalChunks: meta.totalChunks,
              uploadedChunks: Array.from({ length: meta.totalChunks }, (_, i) => i),
              target: meta.target,
              finalized: true,
            };
          }
        }
      } catch {
        // ignore
      }
    }

    // Idempotent resume: if session is already active with matching parameters
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;
        if (meta.galleryId === galleryId) {
          if (
            meta.target === params.target &&
            meta.fileName === cleanName &&
            meta.fileSize === params.fileSize &&
            meta.totalChunks === calculatedTotalChunks
          ) {
            meta.updatedAt = Date.now();
            writeMetadataAtomic(uploadDir, meta);
            return {
              uploadId,
              chunkSize: meta.chunkSize,
              totalChunks: meta.totalChunks,
              uploadedChunks: meta.uploadedChunks,
              target: meta.target,
            };
          } else {
            throw new UploadValidationError("Une session différente existe déjà avec cet identifiant d'upload.", 409);
          }
        }
      } catch (err) {
        if (err instanceof UploadValidationError) throw err;
        // ignore corrupted meta and continue
      }
    }

    const activeSessions = countActiveSessionsForTarget(folder.folderPath, galleryId, config.target);
    if (activeSessions >= MAX_ACTIVE_SESSIONS_PER_TARGET) {
      throw new UploadValidationError(
        `Nombre maximal de sessions actives atteint (${MAX_ACTIVE_SESSIONS_PER_TARGET} par type de média). Veuillez attendre la fin des transferts en cours.`,
        429
      );
    }

    // Peak disk space check: chunks on disk + assembled file + safety margin
    const importBase = path.dirname(folder.folderPath);
    checkDiskSpace(folder.folderPath, params.fileSize * 2, importBase);

    fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });

    const now = Date.now();
    const metadata: UploadMetadata = {
      uploadId,
      galleryId,
      target: params.target,
      fileName: cleanName,
      fileSize: params.fileSize,
      totalChunks: calculatedTotalChunks,
      chunkSize,
      uploadedChunks: [],
      createdAt: now,
      updatedAt: now,
      status: "active",
    };

    writeMetadataAtomic(uploadDir, metadata);

    return {
      uploadId,
      chunkSize,
      totalChunks: calculatedTotalChunks,
      uploadedChunks: [],
      target: params.target,
    };
  });
}

export async function saveChunkStream(
  galleryId: string,
  uploadId: string,
  chunkIndex: number,
  chunkStream: NodeJS.ReadableStream | ReadableStream<Uint8Array>
): Promise<{ success: boolean; chunkIndex: number; totalUploaded: number }> {
  if (!UUID_REGEX.test(uploadId)) {
    throw new UploadValidationError("Identifiant d'upload invalide.", 400);
  }

  const folder = ensureGalleryImportFolder(galleryId);
  const uploadDir = path.join(getUploadsBaseDir(folder.folderPath), uploadId);

  const metaPath = path.join(uploadDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    throw new UploadValidationError("Session d'upload introuvable ou expirée.", 404);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;

  // Strict attachment of uploadId to gallery
  if (meta.galleryId !== galleryId) {
    throw new UploadValidationError("L'upload n'appartient pas à cette galerie.", 403);
  }

  if (
    typeof chunkIndex !== "number" ||
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= meta.totalChunks
  ) {
    throw new UploadValidationError("Index de morceau invalide.", 400);
  }

  const expectedChunkSize = (chunkIndex === meta.totalChunks - 1)
    ? meta.fileSize - (meta.totalChunks - 1) * meta.chunkSize
    : meta.chunkSize;

  const importBase = path.dirname(folder.folderPath);
  checkDiskSpace(folder.folderPath, expectedChunkSize, importBase, uploadId);

  const chunkPartPath = path.join(
    uploadDir,
    `chunk_${chunkIndex}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.part`
  );
  const chunkFinalPath = path.join(uploadDir, `chunk_${chunkIndex}`);

  const cleanupPart = () => {
    try {
      if (fs.existsSync(chunkPartPath)) {
        fs.unlinkSync(chunkPartPath);
      }
    } catch {
      // ignore unlink error
    }
  };

  // Clean any previous orphan .part files for this specific chunk
  try {
    const existing = fs.readdirSync(uploadDir);
    for (const f of existing) {
      if (f.startsWith(`chunk_${chunkIndex}.`) && f.endsWith(".part")) {
        try {
          fs.unlinkSync(path.join(uploadDir, f));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  const nodeStream = "pipe" in chunkStream
    ? (chunkStream as NodeJS.ReadableStream)
    : Readable.fromWeb(chunkStream as import("stream/web").ReadableStream);

  const limiter = new BoundedByteCounter(expectedChunkSize);
  const writeStream = fs.createWriteStream(chunkPartPath, { mode: 0o600 });

  try {
    await pipeline(nodeStream, limiter, writeStream);

    if (!writeStream.closed) {
      await new Promise<void>((resolve) => writeStream.once("close", () => resolve()));
    }

    // Verify exact received chunk size
    const chunkStat = fs.statSync(chunkPartPath);
    if (chunkStat.size !== expectedChunkSize) {
      cleanupPart();
      throw new UploadValidationError(
        `Taille du morceau invalide (reçu ${chunkStat.size} octets, attendu ${expectedChunkSize} octets).`,
        400
      );
    }

    // Atomic rename to final chunk
    fs.renameSync(chunkPartPath, chunkFinalPath);
  } catch (err) {
    try {
      if (!writeStream.destroyed && !writeStream.closed) {
        writeStream.destroy();
      }
    } catch {
      // ignore
    }
    cleanupPart();
    throw err;
  }

  // Update meta with updatedAt
  const uploadedSet = new Set(meta.uploadedChunks);
  uploadedSet.add(chunkIndex);
  meta.uploadedChunks = Array.from(uploadedSet).sort((a, b) => a - b);
  meta.updatedAt = Date.now();

  writeMetadataAtomic(uploadDir, meta);

  return {
    success: true,
    chunkIndex,
    totalUploaded: meta.uploadedChunks.length,
  };
}

export function getUploadStatus(
  galleryId: string,
  uploadId: string
): {
  uploadId: string;
  totalChunks: number;
  uploadedChunks: number[];
  fileName: string;
  target: UploadTarget;
  finalized?: boolean;
} {
  if (!UUID_REGEX.test(uploadId)) {
    throw new UploadValidationError("Identifiant d'upload invalide.", 400);
  }

  const folder = ensureGalleryImportFolder(galleryId);
  const uploadDir = path.join(getUploadsBaseDir(folder.folderPath), uploadId);
  const receiptPath = path.join(uploadDir, "finalized.json");
  const metaPath = path.join(uploadDir, "meta.json");

  if (fs.existsSync(receiptPath)) {
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf-8")) as FinalizeReceipt;
      const meta = fs.existsSync(metaPath)
        ? (JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata)
        : null;
      return {
        uploadId,
        totalChunks: meta?.totalChunks ?? 1,
        uploadedChunks: meta?.uploadedChunks ?? [0],
        fileName: receipt.fileName,
        target: receipt.target,
        finalized: true,
      };
    } catch {
      // ignore
    }
  }

  if (!fs.existsSync(metaPath)) {
    throw new UploadValidationError("Session d'upload introuvable ou expirée.", 404);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;

  if (meta.galleryId !== galleryId) {
    throw new UploadValidationError("L'upload n'appartient pas à cette galerie.", 403);
  }

  const config = UPLOAD_TARGETS[meta.target];
  if (config && meta.finalFileName) {
    const recordedDest = path.join(folder.folderPath, config.folder, meta.finalFileName);
    if (meta.alreadyExists || fs.existsSync(recordedDest)) {
      return {
        uploadId,
        totalChunks: meta.totalChunks,
        uploadedChunks: meta.uploadedChunks,
        fileName: meta.finalFileName,
        target: meta.target,
        finalized: true,
      };
    }
  }

  const existingChunks: number[] = [];
  for (let i = 0; i < meta.totalChunks; i++) {
    const chunkPath = path.join(uploadDir, `chunk_${i}`);
    if (fs.existsSync(chunkPath)) {
      const stat = fs.statSync(chunkPath);
      const expectedSize = (i === meta.totalChunks - 1)
        ? meta.fileSize - (meta.totalChunks - 1) * meta.chunkSize
        : meta.chunkSize;
      if (stat.size === expectedSize) {
        existingChunks.push(i);
      }
    }
  }

  return {
    uploadId,
    totalChunks: meta.totalChunks,
    uploadedChunks: existingChunks,
    fileName: meta.fileName,
    target: meta.target,
    finalized: meta.status === "finalized",
  };
}

export async function finalizeUpload(
  galleryId: string,
  uploadId: string
): Promise<{
  success: boolean;
  fileName: string;
  target: UploadTarget;
  alreadyExists?: boolean;
}> {
  if (!UUID_REGEX.test(uploadId)) {
    throw new UploadValidationError("Identifiant d'upload invalide.", 400);
  }

  const lockKey = `${galleryId}:${uploadId}`;
  const existing = ongoingFinalizations.get(lockKey);
  if (existing) {
    return await existing;
  }

  const finalizePromise = executeFinalizeUpload(galleryId, uploadId);
  ongoingFinalizations.set(lockKey, finalizePromise);
  try {
    return await finalizePromise;
  } finally {
    ongoingFinalizations.delete(lockKey);
  }
}

async function executeFinalizeUpload(
  galleryId: string,
  uploadId: string
): Promise<{
  success: boolean;
  fileName: string;
  target: UploadTarget;
  alreadyExists?: boolean;
}> {
  const folder = ensureGalleryImportFolder(galleryId);
  const uploadDir = path.join(getUploadsBaseDir(folder.folderPath), uploadId);
  const receiptPath = path.join(uploadDir, "finalized.json");

  // 1. Idempotent finalization: return cached receipt if already finalized
  if (fs.existsSync(receiptPath)) {
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf-8")) as FinalizeReceipt;
      return {
        success: true,
        fileName: receipt.fileName,
        target: receipt.target,
        alreadyExists: receipt.alreadyExists,
      };
    } catch {
      // unreadable receipt, proceed
    }
  }

  const metaPath = path.join(uploadDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    throw new UploadValidationError("Session d'upload introuvable ou expirée.", 404);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;

  if (meta.galleryId !== galleryId) {
    throw new UploadValidationError("L'upload n'appartient pas à cette galerie.", 403);
  }

  const config = UPLOAD_TARGETS[meta.target];
  if (!config) {
    throw new UploadValidationError("Cible d'upload inconnue dans les métadonnées.", 400);
  }

  const destDir = path.join(folder.folderPath, config.folder);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  }

  // 2. Recovery check: Was the file already published before a failure/crash while writing receipt?
  if (meta.finalFileName) {
    const recordedDest = path.join(destDir, meta.finalFileName);
    if (meta.alreadyExists || fs.existsSync(recordedDest)) {
      const receipt: FinalizeReceipt = {
        success: true,
        fileName: meta.finalFileName,
        target: meta.target,
        alreadyExists: meta.alreadyExists ? true : undefined,
        finalizedAt: meta.finalizedAt || Date.now(),
      };
      receiptWriter.writeReceipt(uploadDir, receipt);
      meta.status = "finalized";
      meta.updatedAt = Date.now();
      writeMetadataAtomic(uploadDir, meta);
      cleanUploadChunks(uploadDir);
      return {
        success: true,
        fileName: meta.finalFileName,
        target: meta.target,
        alreadyExists: meta.alreadyExists ? true : undefined,
      };
    }
  }

  // 3. Normal finalization path
  // Disk space check right before finalize for assembled file
  const importBase = path.dirname(folder.folderPath);
  checkDiskSpace(folder.folderPath, meta.fileSize, importBase, uploadId);

  // Verify all chunks are present and match their exact expected size
  let totalChunksSize = 0;
  for (let i = 0; i < meta.totalChunks; i++) {
    const chunkPath = path.join(uploadDir, `chunk_${i}`);
    if (!fs.existsSync(chunkPath)) {
      throw new UploadValidationError(`Morceau ${i + 1}/${meta.totalChunks} manquant. Veuillez reprendre l'envoi.`, 400);
    }
    const chunkStat = fs.statSync(chunkPath);
    const expectedSize = (i === meta.totalChunks - 1)
      ? meta.fileSize - (meta.totalChunks - 1) * meta.chunkSize
      : meta.chunkSize;
    if (chunkStat.size !== expectedSize) {
      throw new UploadValidationError(`Taille du morceau ${i + 1} incohérente (reçu ${chunkStat.size}, attendu ${expectedSize}).`, 400);
    }
    totalChunksSize += chunkStat.size;
  }

  if (totalChunksSize !== meta.fileSize) {
    throw new UploadValidationError("Somme des tailles des morceaux incohérente avec la taille déclarée.", 400);
  }

  // Assemble into temporary assembly file
  const assembledPath = path.join(uploadDir, "assembled.tmp");
  if (fs.existsSync(assembledPath)) {
    try {
      fs.unlinkSync(assembledPath);
    } catch {
      // ignore unlink error
    }
  }

  if (meta.totalChunks === 1) {
    const chunkPath = path.join(uploadDir, "chunk_0");
    if (!fs.existsSync(chunkPath)) {
      throw new UploadValidationError("Morceau 1/1 manquant. Veuillez reprendre l'envoi.", 400);
    }
    fs.copyFileSync(chunkPath, assembledPath);
    fs.chmodSync(assembledPath, 0o600);
    await yieldToEventLoop();
  } else {
    const assembledFd = fs.openSync(assembledPath, "w", 0o600);
    try {
      const copyBuffer = Buffer.alloc(64 * 1024);
      for (let i = 0; i < meta.totalChunks; i++) {
        const chunkPath = path.join(uploadDir, `chunk_${i}`);
        const chunkFd = fs.openSync(chunkPath, "r");
        try {
          let bytesRead = 0;
          while ((bytesRead = fs.readSync(chunkFd, copyBuffer, 0, copyBuffer.length, null)) > 0) {
            fs.writeSync(assembledFd, copyBuffer, 0, bytesRead);
          }
        } finally {
          fs.closeSync(chunkFd);
        }
        await yieldToEventLoop();
      }
      fs.fsyncSync(assembledFd);
    } finally {
      fs.closeSync(assembledFd);
    }
  }

  // Check assembled size
  const assembledStat = fs.statSync(assembledPath);
  if (assembledStat.size !== meta.fileSize) {
    try {
      fs.unlinkSync(assembledPath);
    } catch {
      // ignore unlink error
    }
    throw new UploadValidationError("Taille du fichier assemblé incorrecte.", 400);
  }

  // Validate magic bytes with safe fd handling in try/finally
  const fd = fs.openSync(assembledPath, "r");
  let headerBuf: Buffer;
  let bytesRead: number;
  try {
    headerBuf = Buffer.alloc(1024);
    bytesRead = fs.readSync(fd, headerBuf, 0, 1024, 0);
  } finally {
    fs.closeSync(fd);
  }

  const detected = detectMimeType(headerBuf.subarray(0, bytesRead));

  if (!detected) {
    try {
      fs.unlinkSync(assembledPath);
    } catch {
      // ignore unlink error
    }
    fs.rmSync(uploadDir, { recursive: true, force: true });
    throw new UploadValidationError("Format de fichier non reconnu.", 415);
  }

  if (!config.allowedMimes.has(detected)) {
    try {
      fs.unlinkSync(assembledPath);
    } catch {
      // ignore unlink error
    }
    fs.rmSync(uploadDir, { recursive: true, force: true });
    const expectedTypeLabel = config.mediaType === "photo"
      ? "une image supportée (JPEG, PNG, WEBP, AVIF)"
      : "une vidéo supportée (MP4, WEBM)";
    throw new UploadValidationError(`Le fichier envoyé n'est pas ${expectedTypeLabel}.`, 415);
  }

  let finalFileName = meta.fileName;
  let destFilePath = path.join(destDir, finalFileName);
  let alreadyExists = false;

  // Check for existing file with same name
  if (fs.existsSync(destFilePath)) {
    const existingStat = fs.statSync(destFilePath);
    let isIdentical = false;

    // Fast path: if sizes differ, files cannot be identical
    if (existingStat.size === assembledStat.size) {
      await yieldToEventLoop();
      const hashAssembled = await computeFileSha256(assembledPath);
      await yieldToEventLoop();
      const hashExisting = await computeFileSha256(destFilePath);
      if (hashAssembled === hashExisting) {
        isIdentical = true;
      }
    }

    if (isIdentical) {
      // Exactly the same file content already exists
      try {
        fs.unlinkSync(assembledPath);
      } catch {
        // ignore unlink error
      }
      alreadyExists = true;
    } else {
      // Different content: generate unique name
      const parsed = path.parse(meta.fileName);
      let counter = 1;
      while (fs.existsSync(path.join(destDir, `${parsed.name} (${counter})${parsed.ext}`))) {
        counter++;
      }
      finalFileName = `${parsed.name} (${counter})${parsed.ext}`;
      destFilePath = path.join(destDir, finalFileName);
    }
  }

  // 4. MEMORIZE chosen destination in metadata BEFORE moving or deleting chunks
  meta.finalFileName = finalFileName;
  meta.alreadyExists = alreadyExists ? true : undefined;
  meta.finalizedAt = Date.now();
  meta.updatedAt = Date.now();
  writeMetadataAtomic(uploadDir, meta);

  // 5. Publish file to final destination
  if (!alreadyExists) {
    fs.renameSync(assembledPath, destFilePath);
    fs.chmodSync(destFilePath, 0o600);
  }

  // 6. Write durable finalized receipt
  const receipt: FinalizeReceipt = {
    success: true,
    fileName: finalFileName,
    target: meta.target,
    alreadyExists: alreadyExists ? true : undefined,
    finalizedAt: meta.finalizedAt,
  };

  receiptWriter.writeReceipt(uploadDir, receipt);

  // 7. Update status to finalized
  meta.status = "finalized";
  meta.updatedAt = Date.now();
  writeMetadataAtomic(uploadDir, meta);

  // 8. ONLY NOW clean chunks after receipt has been secured
  cleanUploadChunks(uploadDir);

  return {
    success: true,
    fileName: finalFileName,
    target: meta.target,
    alreadyExists: alreadyExists ? true : undefined,
  };
}

export function cancelUpload(galleryId: string, uploadId: string): void {
  if (!UUID_REGEX.test(uploadId)) {
    return;
  }
  const lockKey = `${galleryId}:${uploadId}`;
  if (ongoingFinalizations.has(lockKey)) {
    return;
  }
  try {
    const folder = ensureGalleryImportFolder(galleryId);
    const uploadDir = path.join(getUploadsBaseDir(folder.folderPath), uploadId);
    const metaPath = path.join(uploadDir, "meta.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMetadata;
      if (meta.galleryId !== galleryId) {
        return;
      }
    }
    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}
