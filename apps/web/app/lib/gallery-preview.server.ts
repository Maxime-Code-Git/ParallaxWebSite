import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { ENV } from "./env.server";
import { imageProcessingLimiter, verifySecurePathChain } from "./media-image.server";

export const ALLOWED_WIDTHS = [480, 960, 1920] as const;
export type AllowedWidth = (typeof ALLOWED_WIDTHS)[number];

const pendingGenerations = new Map<string, Promise<{ path: string; width: number; height: number }>>();

export function isAllowedWidth(width: number): width is AllowedWidth {
  return (ALLOWED_WIDTHS as readonly number[]).includes(width);
}

/**
 * Returns safe absolute path for a preview file.
 */
export function getPreviewPath(galleryId: string, mediaId: string, width: AllowedWidth): string {
  const base = path.resolve(ENV.GALLERY_MEDIA_PATH);
  verifySecurePathChain(base, [galleryId], "directory");
  verifySecurePathChain(base, [galleryId, ".previews"], "directory");
  verifySecurePathChain(base, [galleryId, ".previews", mediaId], "directory");
  const filePath = path.join(base, galleryId, ".previews", mediaId, `${width}.webp`);
  if (fs.existsSync(filePath)) {
    verifySecurePathChain(base, [galleryId, ".previews", mediaId, `${width}.webp`], "file");
  }
  return filePath;
}

/**
 * Returns safe absolute path for an original gallery media file.
 */
export function getGalleryOriginalPath(galleryId: string, mediaId: string): string {
  const base = path.resolve(ENV.GALLERY_MEDIA_PATH);
  verifySecurePathChain(base, [galleryId], "directory");
  verifySecurePathChain(base, [galleryId, mediaId], "file");
  return path.join(base, galleryId, mediaId);
}

/**
 * Returns safe absolute path for a video poster image.
 */
export function getGalleryPosterPath(galleryId: string, mediaId: string, revision: number, ext: "webp" | "avif" = "webp"): string {
  const base = path.resolve(ENV.GALLERY_MEDIA_PATH);
  verifySecurePathChain(base, [galleryId], "directory");
  verifySecurePathChain(base, [galleryId, ".posters"], "directory");
  verifySecurePathChain(base, [galleryId, ".posters", mediaId], "directory");
  const fileName = `${revision}.${ext}`;
  const filePath = path.join(base, galleryId, ".posters", mediaId, fileName);
  if (fs.existsSync(filePath)) {
    verifySecurePathChain(base, [galleryId, ".posters", mediaId, fileName], "file");
  }
  return filePath;
}

/**
 * Generates or retrieves a persistent WebP preview variant.
 */
export async function ensurePreview(
  galleryId: string,
  mediaId: string,
  originalPath: string,
  width: AllowedWidth
): Promise<{ path: string; width: number; height: number }> {
  const base = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const galleryPath = path.join(base, galleryId);
  if (!fs.existsSync(galleryPath)) {
    fs.mkdirSync(galleryPath, { recursive: true, mode: 0o700 });
  }
  verifySecurePathChain(base, [galleryId], "directory");

  const previewsParent = path.join(base, galleryId, ".previews");
  if (!fs.existsSync(previewsParent)) {
    fs.mkdirSync(previewsParent, { recursive: true, mode: 0o700 });
  }
  verifySecurePathChain(base, [galleryId, ".previews"], "directory");

  const previewsDir = path.join(previewsParent, mediaId);
  if (!fs.existsSync(previewsDir)) {
    fs.mkdirSync(previewsDir, { recursive: true, mode: 0o700 });
  }
  verifySecurePathChain(base, [galleryId, ".previews", mediaId], "directory");

  const targetPath = path.join(previewsDir, `${width}.webp`);

  if (fs.existsSync(targetPath)) {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      try {
        fs.unlinkSync(targetPath);
      } catch {
        // Ignored
      }
    } else {
      try {
        const meta = await sharp(targetPath).metadata();
        return { path: targetPath, width: meta.width || width, height: meta.height || 0 };
      } catch {
        // Re-generate if corrupted
      }
    }
  }

  const cacheKey = `${galleryId}:${mediaId}:${width}`;
  if (pendingGenerations.has(cacheKey)) {
    return pendingGenerations.get(cacheKey)!;
  }

  const generationPromise = (async () => {
    return imageProcessingLimiter.run(async () => {
      if (fs.existsSync(targetPath)) {
        const stat = fs.lstatSync(targetPath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          try {
            fs.unlinkSync(targetPath);
          } catch {
            // Ignored
          }
        } else {
          try {
            const meta = await sharp(targetPath).metadata();
            return { path: targetPath, width: meta.width || width, height: meta.height || 0 };
          } catch {
            // Re-generate if corrupted
          }
        }
      }

      let quality = 80;
      if (width === 480) quality = 80;
      else if (width === 960) quality = 80;
      else if (width === 1920) quality = 84;

      const tmpPath = path.join(previewsDir, `.tmp.${width}.${crypto.randomUUID()}.webp`);

      const transformer = sharp(originalPath, { failOn: "error" })
        .rotate() // Auto-orient via EXIF
        .resize({
          width,
          withoutEnlargement: true,
          fit: "inside",
        })
        .webp({
          quality,
          effort: 4,
        });

      const info = await transformer.toFile(tmpPath);
      try {
        fs.chmodSync(tmpPath, 0o600);
      } catch {
        // Ignored
      }
      fs.renameSync(tmpPath, targetPath);

      return { path: targetPath, width: info.width, height: info.height };
    });
  })();

  pendingGenerations.set(cacheKey, generationPromise);
  try {
    return await generationPromise;
  } finally {
    pendingGenerations.delete(cacheKey);
  }
}

/**
 * Generates all 3 standard preview variants in sequence (480, 960, 1920)
 * and returns metadata for persistent DB storage.
 */
export async function generateAllPreviews(
  galleryId: string,
  mediaId: string,
  originalPath: string
): Promise<Record<AllowedWidth, { width: number; height: number }>> {
  const results = {} as Record<AllowedWidth, { width: number; height: number }>;
  for (const w of ALLOWED_WIDTHS) {
    const res = await ensurePreview(galleryId, mediaId, originalPath, w);
    results[w] = { width: res.width, height: res.height };
  }
  return results;
}

/**
 * Removes all previews for a media item safely without following symlinks.
 */
export function removePreviews(galleryId: string, mediaId: string): void {
  const base = path.resolve(ENV.GALLERY_MEDIA_PATH);
  try {
    verifySecurePathChain(base, [galleryId], "directory");
    verifySecurePathChain(base, [galleryId, ".previews"], "directory");
  } catch {
    return;
  }

  const previewsDir = path.join(base, galleryId, ".previews", mediaId);
  if (fs.existsSync(previewsDir)) {
    try {
      const stat = fs.lstatSync(previewsDir);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(previewsDir);
      } else {
        fs.rmSync(previewsDir, { recursive: true, force: true });
      }
    } catch {
      // Ignored
    }
  }
}
