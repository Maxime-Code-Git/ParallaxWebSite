import path from "node:path";
import { Readable } from "node:stream";
import yazl from "yazl";
import { ENV } from "./env.server";
import { getGalleryDb } from "./gallery-db.server";
import { getRetentionSettings, calculateScheduledPurgeAt } from "./gallery-retention.server";
import { getGalleryById, getGalleryMediaList, type GalleryMediaRow } from "./gallery.server";
import {
  openSecureMediaFile,
  buildContentDisposition,
  type SecureMediaHandle,
} from "./media-utils.server";
import { createAdminHeaders } from "./admin-auth.server";

export interface GalleryMetadataExportDto {
  schemaVersion: 1;
  exportedAt: string;
  gallery: {
    id: string;
    publicId: string;
    title: string;
    clientName: string;
    projectDate: string;
    location: string | null;
    introFr: string | null;
    introEn: string | null;
    signatureFr: string | null;
    signatureEn: string | null;
    status: "draft" | "published" | "archived";
    expiresAt: number | null;
    revision: number;
    createdAt: number;
    updatedAt: number;
  };
  retention: {
    retentionExempt: boolean;
    retentionExemptReason: string | null;
    scheduledPurgeAt: number | null;
    policyEnabled: boolean;
    policyRetentionDays: number | null;
  };
  media: {
    id: string;
    mediaType: "photo" | "video";
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    contentHash: string;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }[];
}

/**
 * Creates a lazy Readable stream that only verifies path chain and opens file descriptor
 * when yazl actually begins pulling bytes for that specific entry.
 * Strictly enforces O_NOFOLLOW and guarantees immediate descriptor closure on abort.
 */
export function createLazySecureEntryStream(
  baseMedia: string,
  galleryId: string,
  mediaId: string,
  expectedSize: number,
  signal: AbortSignal
): Readable {
  let handle: SecureMediaHandle | null = null;
  let fileStream: ReturnType<SecureMediaHandle["createReadStream"]> | null = null;
  let isClosed = false;

  const cleanup = () => {
    if (!isClosed) {
      isClosed = true;
      const fs = fileStream;
      fileStream = null;
      if (fs && !fs.destroyed && !fs.closed) {
        fs.destroy();
      }
      if (handle) {
        handle.close();
        handle = null;
      }
    }
  };

  const stream = new Readable({
    read() {
      if (isClosed || signal.aborted) {
        cleanup();
        this.push(null);
        return;
      }

      if (!handle) {
        try {
          handle = openSecureMediaFile(baseMedia, [galleryId, mediaId]);
          if (expectedSize > 0 && handle.size !== expectedSize) {
            cleanup();
            this.destroy(new Error("Taille de fichier discordante"));
            return;
          }

          fileStream = handle.createReadStream();
          fileStream.on("data", (chunk) => {
            if (!this.push(chunk)) {
              fileStream?.pause();
            }
          });
          fileStream.on("end", () => {
            this.push(null);
          });
          fileStream.on("close", () => {
            isClosed = true;
            fileStream = null;
            if (handle) {
              handle.close();
              handle = null;
            }
          });
          fileStream.on("error", (err) => {
            cleanup();
            if (!this.destroyed) {
              this.destroy(err);
            }
          });
        } catch (err) {
          cleanup();
          if (!this.destroyed) {
            this.destroy(err instanceof Error ? err : new Error(String(err)));
          }
          return;
        }
      } else if (fileStream?.isPaused()) {
        fileStream.resume();
      }
    },
    destroy(err, cb) {
      cleanup();
      cb(err);
    },
  });

  if (signal.aborted) {
    cleanup();
    stream.destroy();
  } else {
    signal.addEventListener(
      "abort",
      () => {
        cleanup();
        stream.destroy();
      },
      { once: true }
    );
  }

  return stream;
}

/**
 * Generates structured JSON metadata export for a single targeted gallery.
 * Completely excludes plaintext codes, ciphertext, hashes, sessions, CSRF tokens,
 * system traces, and absolute local filesystem paths.
 */
export function generateGalleryMetadataExport(galleryId: string): GalleryMetadataExportDto {
  if (!galleryId || !/^[0-9a-fA-F-]{36}$/.test(galleryId)) {
    throw new Error("ID de galerie invalide");
  }

  const gallery = getGalleryById(galleryId);
  if (!gallery) {
    throw new Error("Galerie introuvable");
  }

  const db = getGalleryDb();

  // Check if a deletion is currently pending or processing
  const deletionJob = db.prepare(`
    SELECT id, status FROM gallery_deletion_jobs
    WHERE gallery_id = ? AND status IN ('pending', 'processing')
  `).get(galleryId) as { id: string; status: string } | undefined;

  if (deletionJob) {
    throw new Error("EXPORT_BLOCKED_DELETION_IN_PROGRESS: La galerie est en cours de suppression.");
  }

  const settings = getRetentionSettings(db);
  const scheduledPurgeAt = calculateScheduledPurgeAt(gallery.expires_at, settings.retentionDays, settings.enabled);

  const mediaRows: GalleryMediaRow[] = getGalleryMediaList(galleryId);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    gallery: {
      id: gallery.id,
      publicId: gallery.public_id,
      title: gallery.title,
      clientName: gallery.client_name,
      projectDate: gallery.project_date,
      location: gallery.location,
      introFr: gallery.intro_fr,
      introEn: gallery.intro_en,
      signatureFr: gallery.signature_fr,
      signatureEn: gallery.signature_en,
      status: gallery.status,
      expiresAt: gallery.expires_at,
      revision: gallery.revision,
      createdAt: gallery.created_at,
      updatedAt: gallery.updated_at,
    },
    retention: {
      retentionExempt: Boolean(gallery.retention_exempt),
      retentionExemptReason: gallery.retention_exempt_reason || null,
      scheduledPurgeAt,
      policyEnabled: settings.enabled,
      policyRetentionDays: settings.retentionDays,
    },
    media: mediaRows.map((m) => ({
      id: m.id,
      mediaType: m.media_type,
      originalFilename: m.original_filename,
      mimeType: m.mime_type,
      fileSize: m.file_size,
      contentHash: m.content_hash,
      width: m.width,
      height: m.height,
      sortOrder: m.sort_order,
    })),
  };
}

let activeExportZipCount = 0;
const MAX_CONCURRENT_EXPORT_ZIPS = 3;

/**
 * Streams private admin ZIP archive of original media items under authenticated admin credentials.
 * Utilizes lazy secure descriptors with O_NOFOLLOW and strict abort propagation.
 */
export async function streamGalleryOriginalsZip(
  galleryId: string,
  signal: AbortSignal
): Promise<Response> {
  if (!galleryId || !/^[0-9a-fA-F-]{36}$/.test(galleryId)) {
    return Response.json({ error: "ID de galerie invalide" }, { status: 400, headers: createAdminHeaders() });
  }

  const gallery = getGalleryById(galleryId);
  if (!gallery) {
    return Response.json({ error: "Galerie introuvable" }, { status: 404, headers: createAdminHeaders() });
  }

  const db = getGalleryDb();

  // Refuse export if deletion is already engaged
  const deletionJob = db.prepare(`
    SELECT id, status FROM gallery_deletion_jobs
    WHERE gallery_id = ? AND status IN ('pending', 'processing')
  `).get(galleryId) as { id: string; status: string } | undefined;

  if (deletionJob) {
    return Response.json(
      { error: "La galerie est en cours de suppression, export des originaux impossible." },
      { status: 409, headers: createAdminHeaders() }
    );
  }

  const mediaItems = getGalleryMediaList(galleryId);
  if (mediaItems.length === 0) {
    return Response.json(
      { error: "Aucun média original disponible pour cette galerie." },
      { status: 404, headers: createAdminHeaders() }
    );
  }

  const baseMedia = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const filesToAdd: { mediaId: string; safeName: string; size: number }[] = [];
  const usedNames = new Set<string>();

  for (const item of mediaItems) {
    const folder = item.media_type === "photo" ? "Photos" : "Videos";
    const rawBase = path.basename(item.original_filename || "media");
    let safeBase = rawBase.replace(/[\0\r\n/\\]/g, "_").trim();
    if (!safeBase) safeBase = "media";

    let archivePath = `${folder}/${safeBase}`;
    if (usedNames.has(archivePath)) {
      const ext = path.extname(safeBase);
      const stem = path.basename(safeBase, ext);
      let counter = 1;
      while (usedNames.has(`${folder}/${stem}-${counter}${ext}`)) {
        counter++;
      }
      archivePath = `${folder}/${stem}-${counter}${ext}`;
    }

    usedNames.add(archivePath);
    filesToAdd.push({ mediaId: item.id, safeName: archivePath, size: item.file_size });
  }

  const cleanTitle = (gallery.title || "galerie")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);

  const zipFilename = `Parallax-Admin-Export-${cleanTitle}.zip`;
  const contentDisposition = buildContentDisposition("attachment", zipFilename);

  if (activeExportZipCount >= MAX_CONCURRENT_EXPORT_ZIPS) {
    return Response.json(
      { error: "Trop d'exports ZIP en cours, veuillez réessayer dans quelques instants." },
      {
        status: 503,
        headers: {
          ...createAdminHeaders(),
          "Retry-After": "5",
        },
      }
    );
  }

  activeExportZipCount++;
  let slotReleased = false;
  const releaseSlot = () => {
    if (!slotReleased) {
      slotReleased = true;
      activeExportZipCount--;
    }
  };

  try {
    const zipfile = new yazl.ZipFile();

    for (const f of filesToAdd) {
      const entryStream = createLazySecureEntryStream(
        baseMedia,
        gallery.id,
        f.mediaId,
        f.size,
        signal
      );
      zipfile.addReadStream(entryStream, f.safeName, { compress: false, size: f.size });
    }

    zipfile.end();

    const outputStream = zipfile.outputStream as Readable;

    outputStream.on("close", releaseSlot);
    outputStream.on("end", releaseSlot);
    outputStream.on("error", releaseSlot);

    signal.addEventListener(
      "abort",
      () => {
        if (typeof outputStream.destroy === "function") {
          outputStream.destroy();
        }
        releaseSlot();
      },
      { once: true }
    );

    const webStream = Readable.toWeb(outputStream);

    const headers = createAdminHeaders();
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Disposition", contentDisposition);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(webStream as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (err) {
    releaseSlot();
    throw err;
  }
}
