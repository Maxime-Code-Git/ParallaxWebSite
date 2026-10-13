import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import type {
  AdminUploadLocation,
  MediaVariantInfo,
  UploadedMediaMetadata,
  SiteContent,
} from "./site-content.shared";

export class SafeImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeImageError";
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
      throw new SafeImageError(
        "Trop de traitements d'images en cours simultanément. Veuillez réessayer dans quelques instants."
      );
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
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    } catch (err: unknown) {
      if (!(err instanceof Error) || (err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new SafeImageError("Impossible de créer le répertoire sécurisé.");
      }
    }
  }

  try {
    const stat = fs.lstatSync(dirPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new SafeImageError("Répertoire de destination invalide ou lien symbolique.");
    }
    const realBase = fs.realpathSync(allowedBasePath);
    const realDir = fs.realpathSync(dirPath);
    const rel = path.relative(realBase, realDir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new SafeImageError("Répertoire situé en dehors de la base autorisée.");
    }
    try {
      fs.chmodSync(dirPath, 0o700);
    } catch {
      // best-effort
    }
  } catch (err) {
    if (err instanceof SafeImageError) throw err;
    throw new SafeImageError("Erreur lors de la vérification du répertoire de stockage.");
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

export async function processSiteMediaImage(
  tempFilePath: string,
  allowedTempDir: string,
  location: AdminUploadLocation,
  mediaBasePath: string
): Promise<UploadedMediaMetadata> {
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

    const siteDir = path.resolve(resolvedMediaBasePath, "site");
    const locationDir = path.resolve(siteDir, location);
    const mediaDir = path.resolve(locationDir, imageId);

    try {
      for (const dir of [siteDir, locationDir, mediaDir]) {
        if (!fs.existsSync(dir)) {
          ensureStrictDirectoryCreated(dir, resolvedMediaBasePath);
          createdDirs.push(dir);
        }
      }

      const variants: MediaVariantInfo[] = [];

      for (const breakpoint of VARIANT_BREAKPOINTS) {
        if (originalWidth <= breakpoint.maxWidth && originalHeight <= breakpoint.maxWidth) {
          // Skip larger variants if original is already smaller, provided we have at least one variant
          if (variants.length > 0) {
            continue;
          }
        }

        const variantDir = path.resolve(mediaDir, breakpoint.name);
        if (!fs.existsSync(variantDir)) {
          ensureStrictDirectoryCreated(variantDir, resolvedMediaBasePath);
          createdDirs.push(variantDir);
        }

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
      };
    } catch (err) {
      // Rollback created files and directories
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

export function cleanupMediaDirectory(mediaDir: string): void {
  if (fs.existsSync(mediaDir)) {
    try {
      fs.rmSync(mediaDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

export function getReferencedMediaIds(siteContent: SiteContent, siteContentPath?: string): Set<string> {
  const referenced = new Set<string>();

  const checkAndAdd = (id: string | null | undefined) => {
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      referenced.add(id.toLowerCase());
    }
  };

  const inspectContent = (content: SiteContent) => {
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
    if (content.media) {
      for (const mediaId of Object.keys(content.media)) {
        checkAndAdd(mediaId);
      }
    }
  };

  inspectContent(siteContent);

  // Also check up to 5 backups of site-content.json to prevent purging restored references
  if (siteContentPath) {
    for (let i = 1; i <= 5; i++) {
      const bakPath = `${siteContentPath}.bak.${i}`;
      if (fs.existsSync(bakPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(bakPath, "utf-8")) as SiteContent;
          inspectContent(raw);
        } catch {
          // ignore corrupted backup inspection
        }
      }
    }
  }

  return referenced;
}

export function cleanupUnreferencedMedia(
  activeContent: SiteContent,
  mediaBasePath: string,
  siteContentPath?: string
): void {
  try {
    const referenced = getReferencedMediaIds(activeContent, siteContentPath);
    const siteDir = path.resolve(mediaBasePath, "site");
    if (!fs.existsSync(siteDir)) return;

    for (const location of fs.readdirSync(siteDir)) {
      const locationDir = path.resolve(siteDir, location);
      if (!fs.statSync(locationDir).isDirectory()) continue;

      for (const item of fs.readdirSync(locationDir)) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)) {
          if (!referenced.has(item.toLowerCase())) {
            const mediaDir = path.resolve(locationDir, item);
            cleanupMediaDirectory(mediaDir);
          }
        }
      }
    }
  } catch {
    // Non-critical background cleanup failure
  }
}
