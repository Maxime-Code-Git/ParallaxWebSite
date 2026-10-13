import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import {
  type AdminUploadLocation,
  ADMIN_UPLOAD_LOCATIONS,
  type MediaVariantInfo,
  type UploadedMediaMetadata,
  type SiteContent,
} from "./site-content.shared";
import { getBackups } from "./atomic-fs.server";

export class SafeImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeImageError";
  }
}

export class ConcurrencyLimitError extends Error {
  constructor(
    message = "Trop de traitements d'images en cours simultanément. Veuillez réessayer dans quelques instants."
  ) {
    super(message);
    this.name = "ConcurrencyLimitError";
  }
}

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MiB
export const MAX_PIXELS = 80_000_000; // 80 MP
export const MAX_DIMENSION = 12000;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const WEBP_QUALITY = 82;
const AVIF_QUALITY = 65;
const AVIF_EFFORT = 4;

const VARIANT_BREAKPOINTS = [
  { name: "640p" as const, maxWidth: 640 },
  { name: "960p" as const, maxWidth: 960 },
  { name: "1440p" as const, maxWidth: 1440 },
  { name: "1920p" as const, maxWidth: 1920 },
] as const;

export class ConcurrencyLimiter {
  private active = 0;
  constructor(private readonly max: number = 2) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      throw new ConcurrencyLimitError();
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
    }
  }

  getActiveCount(): number {
    return this.active;
  }
}

export const imageProcessingLimiter = new ConcurrencyLimiter(2);

export function verifySecurePathChain(
  basePath: string,
  segments: string[],
  expectedLeafType?: "file" | "directory"
): string {
  let canonicalBase: string;
  try {
    const resolvedBase = path.resolve(basePath);
    const baseStat = fs.lstatSync(resolvedBase);
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
      throw new SafeImageError("Répertoire de base invalide ou lien symbolique.");
    }
    canonicalBase = fs.realpathSync(resolvedBase);
  } catch (err) {
    if (err instanceof SafeImageError) throw err;
    throw new SafeImageError("Répertoire de base inaccessible.");
  }

  for (const seg of segments) {
    if (
      !seg ||
      seg === "." ||
      seg === ".." ||
      seg.includes("/") ||
      seg.includes("\\") ||
      seg.includes("\0")
    ) {
      throw new SafeImageError("Segment de chemin invalide.");
    }
  }

  let current = canonicalBase;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    current = path.join(current, seg);

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      throw new SafeImageError("Composant de chemin introuvable.");
    }

    if (stat.isSymbolicLink()) {
      throw new SafeImageError("Les liens symboliques sont strictement interdits.");
    }

    let realCurrent: string;
    try {
      realCurrent = fs.realpathSync(current);
    } catch {
      throw new SafeImageError("Composant de chemin inaccessible.");
    }

    const rel = path.relative(canonicalBase, realCurrent);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new SafeImageError("Confinement strict non respecté.");
    }

    const isLeaf = i === segments.length - 1;
    if (!isLeaf) {
      if (!stat.isDirectory()) {
        throw new SafeImageError("Composant intermédiaire n'est pas un répertoire.");
      }
    } else if (expectedLeafType) {
      if (expectedLeafType === "directory" && !stat.isDirectory()) {
        throw new SafeImageError("Le chemin final n'est pas un répertoire.");
      }
      if (expectedLeafType === "file" && !stat.isFile()) {
        throw new SafeImageError("Le chemin final n'est pas un fichier.");
      }
    }
  }

  return current;
}

export function validateConfinement(filePath: string, allowedDir: string): void {
  const resolvedAllowed = path.resolve(allowedDir);
  const resolvedFile = path.resolve(filePath);

  const rel = path.relative(resolvedAllowed, resolvedFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new SafeImageError("Validation du chemin de fichier échouée (en dehors du répertoire autorisé).");
  }

  if (fs.existsSync(resolvedFile)) {
    const lstat = fs.lstatSync(resolvedFile);
    if (lstat.isSymbolicLink()) {
      throw new SafeImageError("Les liens symboliques sont strictement interdits.");
    }

    const realFilePath = fs.realpathSync(resolvedFile);
    let realAllowedDir: string;
    try {
      realAllowedDir = fs.realpathSync(resolvedAllowed);
    } catch {
      throw new SafeImageError("Répertoire parent inaccessible.");
    }
    const realRel = path.relative(realAllowedDir, realFilePath);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
      throw new SafeImageError("Confinement strict du fichier non respecté.");
    }
  }
}

export function ensureStrictDirectoryCreated(dirPath: string, allowedBasePath: string): void {
  const resolvedBase = path.resolve(allowedBasePath);
  const baseStat = fs.lstatSync(resolvedBase);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw new SafeImageError("Répertoire de base invalide ou lien symbolique.");
  }
  const canonicalBase = fs.realpathSync(resolvedBase);

  const resolvedTarget = path.resolve(dirPath);
  const lexicalRel = path.relative(resolvedBase, resolvedTarget);
  if (lexicalRel.startsWith("..") || path.isAbsolute(lexicalRel)) {
    throw new SafeImageError("Répertoire situé en dehors de la base autorisée.");
  }

  const segments = lexicalRel.split(path.sep).filter(Boolean);
  let current = canonicalBase;

  for (const seg of segments) {
    current = path.join(current, seg);
    if (!fs.existsSync(current)) {
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (err: unknown) {
        if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new SafeImageError("Impossible de créer le répertoire sécurisé.");
        }
      }
    }

    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new SafeImageError("Répertoire invalide ou lien symbolique détecté.");
    }

    const realCurrent = fs.realpathSync(current);
    const realRel = path.relative(canonicalBase, realCurrent);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
      throw new SafeImageError("Confinement strict du répertoire non respecté.");
    }

    try {
      fs.chmodSync(current, 0o700);
    } catch {
      // best-effort
    }
  }
}

export function atomicWriteFile(targetPath: string, content: Buffer, mode: number = 0o600): void {
  const dir = path.dirname(targetPath);
  const tmpName = path.join(dir, `.tmp.${crypto.randomBytes(8).toString("hex")}`);
  let fd: number | null = null;
  let dirFd: number | null = null;

  try {
    fd = fs.openSync(tmpName, "wx", mode);
    let bytesWritten = 0;
    while (bytesWritten < content.length) {
      const written = fs.writeSync(fd, content, bytesWritten, content.length - bytesWritten, bytesWritten);
      if (written <= 0) {
        throw new SafeImageError("Erreur d'écriture sur le disque.");
      }
      bytesWritten += written;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    fs.renameSync(tmpName, targetPath);

    try {
      dirFd = fs.openSync(dir, "r");
      fs.fsyncSync(dirFd);
    } catch {
      // best-effort sync on directory
    }
  } catch (err) {
    if (fs.existsSync(tmpName)) {
      try {
        fs.unlinkSync(tmpName);
      } catch {
        // ignore
      }
    }
    throw err;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    if (dirFd !== null) {
      try {
        fs.closeSync(dirFd);
      } catch {
        // ignore
      }
    }
  }
}

export async function validateImageFile(
  filePath: string,
  allowedDir: string
): Promise<{ format: "jpeg" | "png" | "webp"; width: number; height: number }> {
  try {
    // 1. Confinement check
    validateConfinement(filePath, allowedDir);

    // 2. Size check
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new SafeImageError("Le fichier image dépasse la taille maximale autorisée (25 Mo).");
    }

    // 3. Magic bytes check
    const headerBuffer = Buffer.alloc(4100);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, headerBuffer, 0, 4100, 0);
    } finally {
      fs.closeSync(fd);
    }

    const uint8View = new Uint8Array(headerBuffer.buffer, headerBuffer.byteOffset, headerBuffer.byteLength);
    const fileTypeResult = await fileTypeFromBuffer(uint8View);
    if (!fileTypeResult || !ALLOWED_MIME_TYPES.has(fileTypeResult.mime)) {
      throw new SafeImageError("Format d'image non supporté. Formats acceptés : JPEG, PNG, WebP.");
    }

    // 4. Sharp metadata check
    const metadata = await sharp(filePath, { limitInputPixels: MAX_PIXELS }).metadata();
    const width = metadata.width;
    const height = metadata.height;

    if (!width || !height) {
      throw new SafeImageError("Impossible de déterminer les dimensions de l'image.");
    }

    if (metadata.pages && metadata.pages > 1) {
      throw new SafeImageError("Les images animées ou multi-pages ne sont pas autorisées.");
    }

    let orientedWidth = width;
    let orientedHeight = height;
    if (metadata.orientation && metadata.orientation >= 5) {
      orientedWidth = height;
      orientedHeight = width;
    }

    if (!Number.isSafeInteger(orientedWidth) || !Number.isSafeInteger(orientedHeight)) {
      throw new SafeImageError("Dimensions d'image invalides.");
    }

    const totalPixels = orientedWidth * orientedHeight;
    if (totalPixels > MAX_PIXELS) {
      throw new SafeImageError("La résolution de l'image dépasse la limite de 80 millions de pixels.");
    }

    if (orientedWidth > MAX_DIMENSION || orientedHeight > MAX_DIMENSION) {
      throw new SafeImageError("Les dimensions de l'image dépassent la limite de 12 000 pixels.");
    }

    const formatExt = fileTypeResult.ext === "jpg" ? "jpeg" : fileTypeResult.ext;
    return {
      format: formatExt as "jpeg" | "png" | "webp",
      width: orientedWidth,
      height: orientedHeight,
    };
  } catch (err) {
    if (err instanceof SafeImageError) {
      throw err;
    }
    throw new SafeImageError("Le traitement de l'image a échoué (fichier corrompu ou illisible).");
  }
}

export interface ProcessedMediaWithStaging extends UploadedMediaMetadata {
  stagingDir: string;
}

export async function processSiteMediaImage(
  tempFilePath: string,
  allowedTempDir: string,
  location: AdminUploadLocation,
  mediaBasePath: string
): Promise<ProcessedMediaWithStaging> {
  return imageProcessingLimiter.run(async () => {
    const { width: originalWidth, height: originalHeight } = await validateImageFile(
      tempFilePath,
      allowedTempDir
    );

    const imageId = crypto.randomUUID();
    const createdFiles: string[] = [];
    const createdDirs: string[] = [];

    const resolvedMediaBasePath = path.resolve(mediaBasePath);
    ensureStrictDirectoryCreated(resolvedMediaBasePath, path.resolve(resolvedMediaBasePath, ".."));

    // Write variants into a dedicated staging directory: staging/<imageId>
    // This isolates in-progress uploads from being seen or purged by concurrent cleanups
    const stagingBaseDir = path.resolve(resolvedMediaBasePath, "staging");
    const stagingDir = path.resolve(stagingBaseDir, imageId);

    try {
      for (const dir of [stagingBaseDir, stagingDir]) {
        ensureStrictDirectoryCreated(dir, resolvedMediaBasePath);
        createdDirs.push(dir);
      }

      const variants: MediaVariantInfo[] = [];

      for (const breakpoint of VARIANT_BREAKPOINTS) {
        if (originalWidth <= breakpoint.maxWidth && originalHeight <= breakpoint.maxWidth) {
          // Skip larger variants if original is already smaller, provided we have at least one variant
          if (variants.length > 0) {
            continue;
          }
        }

        const variantDir = path.resolve(stagingDir, breakpoint.name);
        ensureStrictDirectoryCreated(variantDir, resolvedMediaBasePath);
        createdDirs.push(variantDir);

        const variantFileId = `${imageId}-${breakpoint.name}`;
        const webpPath = path.resolve(variantDir, `${variantFileId}.webp`);
        const avifPath = path.resolve(variantDir, `${variantFileId}.avif`);
        validateConfinement(webpPath, resolvedMediaBasePath);
        validateConfinement(avifPath, resolvedMediaBasePath);

        // Resize pipeline: EXIF auto-orientation, sRGB, stripped metadata, withoutEnlargement
        const pipeline = sharp(tempFilePath, { limitInputPixels: MAX_PIXELS })
          .rotate()
          .resize(breakpoint.maxWidth, breakpoint.maxWidth, { fit: "inside", withoutEnlargement: true })
          .toColorspace("srgb");

        const webpBuffer = await pipeline.clone().webp({ quality: WEBP_QUALITY }).toBuffer();
        const avifBuffer = await pipeline.clone().avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toBuffer();

        // Retrieve actual produced dimensions for this variant
        const outputMeta = await sharp(webpBuffer).metadata();
        const producedWidth = outputMeta.width || breakpoint.maxWidth;
        const producedHeight = outputMeta.height || breakpoint.maxWidth;

        atomicWriteFile(webpPath, webpBuffer, 0o600);
        createdFiles.push(webpPath);

        atomicWriteFile(avifPath, avifBuffer, 0o600);
        createdFiles.push(avifPath);

        variants.push({
          name: breakpoint.name,
          width: producedWidth,
          height: producedHeight,
          sizeBytesWebp: webpBuffer.length,
          sizeBytesAvif: avifBuffer.length,
          fileId: variantFileId,
        });
      }

      return {
        imageId,
        location,
        originalWidth,
        originalHeight,
        variants,
        createdAt: new Date().toISOString(),
        stagingDir,
      };
    } catch (err) {
      // Rollback created files and directories in staging
      for (const f of createdFiles.reverse()) {
        try {
          fs.unlinkSync(f);
        } catch {
          // ignore
        }
      }
      for (const d of createdDirs.reverse()) {
        try {
          fs.rmdirSync(d);
        } catch {
          // ignore
        }
      }
      if (err instanceof SafeImageError) {
        throw err;
      }
      throw new SafeImageError("Échec du traitement et de l'enregistrement de l'image.");
    }
  });
}

export function publishStagedMedia(
  imageId: string,
  location: AdminUploadLocation,
  mediaBasePath: string
): string {
  const resolvedMediaBasePath = path.resolve(mediaBasePath);
  const stagingDir = path.resolve(resolvedMediaBasePath, "staging", imageId);

  // Validate staging directory
  verifySecurePathChain(resolvedMediaBasePath, ["staging", imageId], "directory");

  const siteDir = path.resolve(resolvedMediaBasePath, "site");
  const locationDir = path.resolve(siteDir, location);
  const finalMediaDir = path.resolve(locationDir, imageId);

  // Ensure site and location parent directories exist and are verified
  ensureStrictDirectoryCreated(locationDir, resolvedMediaBasePath);

  // If final media dir already exists somehow, clean it first
  if (fs.existsSync(finalMediaDir)) {
    cleanupMediaDirectory(finalMediaDir, resolvedMediaBasePath);
  }

  // Atomically rename stagingDir to finalMediaDir on the same filesystem
  fs.renameSync(stagingDir, finalMediaDir);

  // Verify final directory structure
  verifySecurePathChain(resolvedMediaBasePath, ["site", location, imageId], "directory");

  return finalMediaDir;
}

export function cleanupStagedMedia(imageId: string, mediaBasePath: string): void {
  const resolvedMediaBasePath = path.resolve(mediaBasePath);
  const stagingDir = path.resolve(resolvedMediaBasePath, "staging", imageId);
  cleanupMediaDirectory(stagingDir, resolvedMediaBasePath);
}

export function cleanupMediaDirectory(mediaDir: string, allowedBasePath?: string): void {
  try {
    const resolvedMediaDir = path.resolve(mediaDir);
    const effectiveAllowedBase = allowedBasePath
      ? path.resolve(allowedBasePath)
      : path.dirname(resolvedMediaDir);

    if (!fs.existsSync(effectiveAllowedBase)) return;
    const baseStat = fs.lstatSync(effectiveAllowedBase);
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) return;
    const canonicalBase = fs.realpathSync(effectiveAllowedBase);

    const lexicalRel = path.relative(effectiveAllowedBase, resolvedMediaDir);
    if (!lexicalRel || lexicalRel.startsWith("..") || path.isAbsolute(lexicalRel)) {
      return;
    }

    // Verify intermediate path components have NO symlinks and stay confined
    const segments = lexicalRel.split(path.sep).filter(Boolean);
    let current = canonicalBase;
    for (let i = 0; i < segments.length - 1; i++) {
      current = path.join(current, segments[i]);
      if (!fs.existsSync(current)) return;
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return;
      const real = fs.realpathSync(current);
      const parentRel = path.relative(canonicalBase, real);
      if (parentRel.startsWith("..") || path.isAbsolute(parentRel)) return;
    }

    // Now check the target itself
    if (!fs.existsSync(resolvedMediaDir)) return;
    const targetStat = fs.lstatSync(resolvedMediaDir);

    // If target is a symlink, DO NOT traverse or delete target; only unlink the symlink itself
    if (targetStat.isSymbolicLink()) {
      fs.unlinkSync(resolvedMediaDir);
      return;
    }

    if (!targetStat.isDirectory()) {
      fs.unlinkSync(resolvedMediaDir);
      return;
    }

    const realTarget = fs.realpathSync(resolvedMediaDir);
    const targetRel = path.relative(canonicalBase, realTarget);
    if (targetRel.startsWith("..") || path.isAbsolute(targetRel)) {
      return;
    }

    fs.rmSync(resolvedMediaDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup without throwing or leaking
  }
}

export class ReferencedMediaIds extends Set<string> {
  hasUnreadableBackup = false;
  get referenced(): Set<string> {
    return this;
  }
}

export function getReferencedMediaIds(
  siteContent: SiteContent,
  siteContentPath?: string
): ReferencedMediaIds {
  const result = new ReferencedMediaIds();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const checkAndAdd = (id: string | null | undefined) => {
    if (id && UUID_REGEX.test(id)) {
      result.add(id.toLowerCase());
    }
  };

  const inspectActiveLocations = (content: SiteContent) => {
    if (!content) return;
    if (content.home?.showreel?.coverImageId) {
      checkAndAdd(content.home.showreel.coverImageId);
    }
    if (content.home?.duo?.imageId) {
      checkAndAdd(content.home.duo.imageId);
    }
    if (Array.isArray(content.studio?.team?.members)) {
      for (const member of content.studio.team.members) {
        checkAndAdd(member.imageId);
      }
    }
  };

  // 1. Inspect currently active content locations
  inspectActiveLocations(siteContent);

  // 2. Read up to 5 real backups via getBackups(siteContentPath)
  if (siteContentPath && fs.existsSync(siteContentPath)) {
    try {
      const backups = getBackups(siteContentPath);
      const retainedBackups = backups.slice(0, 5);
      const dir = path.dirname(siteContentPath);

      for (const bakFile of retainedBackups) {
        const bakPath = path.join(dir, bakFile);
        try {
          const raw = JSON.parse(fs.readFileSync(bakPath, "utf-8")) as SiteContent;
          inspectActiveLocations(raw);
        } catch {
          console.warn(`[getReferencedMediaIds] Sauvegarde illisible: ${bakFile}. Nettoyage différé.`);
          result.hasUnreadableBackup = true;
        }
      }
    } catch {
      result.hasUnreadableBackup = true;
    }
  }

  return result;
}

export function cleanupUnreferencedMedia(
  activeContent: SiteContent,
  mediaBasePath: string,
  siteContentPath?: string
): { cleaned: string[]; deferred?: boolean } {
  try {
    const refResult = getReferencedMediaIds(activeContent, siteContentPath);
    if (refResult.hasUnreadableBackup) {
      console.warn("[cleanupUnreferencedMedia] Sauvegarde illisible détectée. Nettoyage différé pour protéger les médias.");
      return { cleaned: [], deferred: true };
    }

    const cleaned: string[] = [];
    const resolvedMediaBasePath = path.resolve(mediaBasePath);
    if (!fs.existsSync(resolvedMediaBasePath)) return { cleaned };

    const baseStat = fs.lstatSync(resolvedMediaBasePath);
    if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) return { cleaned };
    const canonicalBase = fs.realpathSync(resolvedMediaBasePath);

    const siteDir = path.join(canonicalBase, "site");
    if (!fs.existsSync(siteDir)) return { cleaned };
    const siteStat = fs.lstatSync(siteDir);
    if (siteStat.isSymbolicLink() || !siteStat.isDirectory()) return { cleaned };
    const realSiteDir = fs.realpathSync(siteDir);
    if (path.relative(canonicalBase, realSiteDir).startsWith("..")) return { cleaned };

    // Inspect ONLY the 4 explicitly allowed locations
    for (const location of ADMIN_UPLOAD_LOCATIONS) {
      const locationDir = path.join(siteDir, location);
      if (!fs.existsSync(locationDir)) continue;

      const locStat = fs.lstatSync(locationDir);
      if (locStat.isSymbolicLink() || !locStat.isDirectory()) {
        // Refuse symlinks or non-directory items in site/
        continue;
      }
      const realLocDir = fs.realpathSync(locationDir);
      if (path.relative(canonicalBase, realLocDir).startsWith("..")) {
        continue;
      }

      for (const item of fs.readdirSync(locationDir)) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)) {
          const lowerId = item.toLowerCase();
          if (!refResult.has(lowerId)) {
            const mediaDir = path.join(locationDir, item);
            cleanupMediaDirectory(mediaDir, canonicalBase);
            cleaned.push(mediaDir);
          }
        }
      }
    }

    // Clean up stale staging directories older than 1 hour if any remain
    const stagingDir = path.join(canonicalBase, "staging");
    if (fs.existsSync(stagingDir)) {
      const stagingStat = fs.lstatSync(stagingDir);
      if (!stagingStat.isSymbolicLink() && stagingStat.isDirectory()) {
        const oneHourAgo = Date.now() - 3600_000;
        for (const item of fs.readdirSync(stagingDir)) {
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)) {
            const dir = path.join(stagingDir, item);
            try {
              const stat = fs.statSync(dir);
              if (stat.mtimeMs < oneHourAgo) {
                cleanupMediaDirectory(dir, canonicalBase);
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }

    return { cleaned };
  } catch {
    // Non-critical background cleanup failure
    return { cleaned: [] };
  }
}

