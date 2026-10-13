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
  return path.join(base, galleryId, ".previews", mediaId, `${width}.webp`);
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
  return path.join(base, galleryId, ".posters", mediaId, `${revision}.${ext}`);
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
  const previewsDir = path.join(base, galleryId, ".previews", mediaId);
  const targetPath = path.join(previewsDir, `${width}.webp`);

  if (fs.existsSync(targetPath)) {
    try {
      const meta = await sharp(targetPath).metadata();
      return { path: targetPath, width: meta.width || width, height: meta.height || 0 };
    } catch {
      // Re-generate if corrupted
    }
  }

  const cacheKey = `${galleryId}:${mediaId}:${width}`;
  if (pendingGenerations.has(cacheKey)) {
    return pendingGenerations.get(cacheKey)!;
  }

  const generationPromise = (async () => {
    return imageProcessingLimiter.run(async () => {
      if (fs.existsSync(targetPath)) {
        const meta = await sharp(targetPath).metadata();
        return { path: targetPath, width: meta.width || width, height: meta.height || 0 };
      }

      if (!fs.existsSync(previewsDir)) {
        fs.mkdirSync(previewsDir, { recursive: true, mode: 0o700 });
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
 * Removes all previews for a media item.
 */
export function removePreviews(galleryId: string, mediaId: string): void {
  const base = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const previewsDir = path.join(base, galleryId, ".previews", mediaId);
  if (fs.existsSync(previewsDir)) {
    try {
      fs.rmSync(previewsDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  }
}
