import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "./env.server";
import { getGalleryDb } from "./gallery-db.server";
import { getGalleryOriginalPath } from "./gallery-preview.server";
import { verifySecurePathChain } from "./media-image.server";
import { openSecureMediaFile } from "./media-utils.server";

const PREVIEW_FILENAME = "video-v1.mp4";
const MIN_DISK_FREE = 512 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENCODING_TIME = 2 * 60 * 60 * 1000;

export type GalleryVideoPreviewStatus =
  | { state: "missing" | "processing" | "ready" }
  | { state: "failed"; message: string };

class PreviewError extends Error {}

let activeKey: string | undefined;
const failures = new Map<string, string>();

export function isGalleryVideoPreviewProcessing(galleryId: string, mediaId: string): boolean {
  return activeKey === `${galleryId}:${mediaId}`;
}

export function galleryVideoPreviewSegments(galleryId: string, mediaId: string): string[] {
  return [galleryId, ".previews", mediaId, PREVIEW_FILENAME];
}

export function openGalleryVideoForPlayback(galleryId: string, mediaId: string, mimeType: string, usePreview: boolean) {
  // Each URL must serve the same representation throughout a range-based
  // playback, including when a preview is published during that playback.
  const segments = usePreview ? galleryVideoPreviewSegments(galleryId, mediaId) : [galleryId, mediaId];
  return {
    handle: openSecureMediaFile(ENV.GALLERY_MEDIA_PATH, segments),
    contentType: usePreview ? "video/mp4" : mimeType,
  };
}

export function hasGalleryVideoPreview(galleryId: string, mediaId: string): boolean {
  try {
    const base = path.resolve(ENV.GALLERY_MEDIA_PATH);
    const segments = galleryVideoPreviewSegments(galleryId, mediaId);
    verifySecurePathChain(base, segments, "file");
    return fs.statSync(path.join(base, ...segments)).size > 0;
  } catch {
    return false;
  }
}

export function getGalleryVideoPreviewStatus(galleryId: string, mediaId: string): GalleryVideoPreviewStatus {
  const key = `${galleryId}:${mediaId}`;
  if (hasGalleryVideoPreview(galleryId, mediaId)) return { state: "ready" };
  if (isGalleryVideoPreviewProcessing(galleryId, mediaId)) return { state: "processing" };
  const message = failures.get(key);
  return message ? { state: "failed", message } : { state: "missing" };
}

function findVideo(galleryId: string, mediaId: string) {
  return getGalleryDb().prepare(`
    SELECT mime_type FROM gallery_media
    WHERE gallery_id = ? AND id = ? AND media_type = 'video' AND is_ready = 1
  `).get(galleryId, mediaId) as { mime_type: string } | undefined;
}

function diskFree(directory: string): number {
  const { bsize, bavail } = fs.statfsSync(directory);
  return bsize * bavail;
}

function encodePreview(original: string, destination: string, inputFormat: string): Promise<void> {
  const folder = path.dirname(destination);
  const scale =
    "scale=w='min(iw,if(gte(iw,ih),1280,720))':h='min(ih,if(gte(iw,ih),720,1280))'" +
    ":force_original_aspect_ratio=decrease:force_divisible_by=2,fps=fps='min(source_fps,30)'";

  return new Promise((resolve, reject) => {
    let storageError: PreviewError | undefined;
    const child = execFile("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-xerror",
      "-protocol_whitelist", "file", "-f", inputFormat, "-threads", "2",
      "-max_pixels", "67108864", "-i", original,
      "-map", "0:V:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1",
      "-filter_threads", "1", "-vf", scale,
      "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "24",
      "-pix_fmt", "yuv420p", "-maxrate", "2200k", "-bufsize", "4400k",
      "-c:a", "aac", "-ac", "2", "-b:a", "128k", "-movflags", "+faststart",
      "-f", "mp4", destination,
    ], {
      timeout: MAX_ENCODING_TIME,
      maxBuffer: 128 * 1024,
      env: { PATH: process.env.PATH, LANG: "C" },
    }, (error) => {
      clearInterval(storageMonitor);
      if (storageError) reject(storageError);
      else if (error?.code === "ENOENT") {
        reject(new PreviewError("FFmpeg est introuvable sur le serveur. Installez-le pour générer les aperçus."));
      } else if (error) {
        reject(new PreviewError("Impossible de compresser cette vidéo. Vérifiez le fichier et réessayez."));
      } else resolve();
    });

    const storageMonitor = setInterval(() => {
      try {
        if (diskFree(folder) >= MIN_DISK_FREE &&
          (fs.statSync(destination, { throwIfNoEntry: false })?.size ?? 0) < MAX_PREVIEW_BYTES) return;
        storageError = new PreviewError("Limite de stockage atteinte pendant la génération de l'aperçu.");
      } catch {
        storageError = new PreviewError("Le dossier de la vidéo n'est plus accessible.");
      }
      child.kill();
    }, 2000);
    storageMonitor.unref();
  });
}

async function generatePreview(galleryId: string, mediaId: string, mimeType: string) {
  const base = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const original = getGalleryOriginalPath(galleryId, mediaId);
  const originalSize = fs.statSync(original).size;
  const segments = galleryVideoPreviewSegments(galleryId, mediaId);
  const directorySegments = segments.slice(0, -1);
  const directory = path.join(base, ...directorySegments);

  for (const parts of [directorySegments.slice(0, 2), directorySegments]) {
    try {
      fs.mkdirSync(path.join(base, ...parts), { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    verifySecurePathChain(base, parts, "directory");
  }
  if (diskFree(directory) < MIN_DISK_FREE) {
    throw new PreviewError("Espace disque insuffisant pour générer l'aperçu.");
  }

  // A private temporary directory on the same filesystem allows atomic publishing.
  const workDir = fs.mkdtempSync(path.join(directory, ".encoding-"));
  const temporary = path.join(workDir, PREVIEW_FILENAME);
  try {
    await encodePreview(original, temporary, mimeType === "video/webm" ? "matroska" : "mov");
    const size = fs.statSync(temporary).size;
    if (size === 0 || size >= MAX_PREVIEW_BYTES) {
      throw new PreviewError("L'aperçu généré dépasse la limite autorisée ou est illisible.");
    }
    if (size >= originalSize) {
      throw new PreviewError("L'aperçu généré n'est pas plus léger que l'original. L'original est conservé pour la lecture.");
    }
    if (!findVideo(galleryId, mediaId)) {
      throw new PreviewError("La vidéo n'est plus disponible dans cette galerie.");
    }
    verifySecurePathChain(base, directorySegments, "directory");
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, path.join(base, ...segments));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Called from an authenticated admin POST, never from a playback request.
 * At most one video is encoded at a time across all galleries.
 */
export function startGalleryVideoPreview(galleryId: string, mediaId: string): "started" | "processing" | "ready" | "busy" | "not_found" {
  const video = findVideo(galleryId, mediaId);
  if (!video) return "not_found";
  const current = getGalleryVideoPreviewStatus(galleryId, mediaId);
  if (current.state === "ready" || current.state === "processing") return current.state;
  if (activeKey) return "busy";

  const key = `${galleryId}:${mediaId}`;
  activeKey = key;
  failures.delete(key);
  void generatePreview(galleryId, mediaId, video.mime_type).catch((error: unknown) => {
    failures.set(key, error instanceof PreviewError
      ? error.message
      : "Échec de la génération de l'aperçu. Vérifiez que le fichier est accessible, puis réessayez.");
    if (failures.size > 64) {
      const first = failures.keys().next().value;
      if (first !== undefined) failures.delete(first);
    }
  }).finally(() => { activeKey = undefined; });
  return "started";
}
