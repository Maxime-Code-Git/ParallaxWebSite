import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import type { ActionFunctionArgs } from "react-router";
import busboy from "busboy";
import sharp from "sharp";
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin } from "../../lib/security.server";
import { getGalleryDb } from "../../lib/gallery-db.server";
import { ENV } from "../../lib/env.server";

const MAX_FILE_SIZE = 60 * 1024 * 1024;
const MAX_PAYLOAD_SIZE = MAX_FILE_SIZE + 1024 * 1024;
const MAX_POSTER_PIXELS = 120_000_000;
const MAX_POSTER_SIDE = 20_000;
const POSTER_DIMENSIONS_ERROR = "Image trop grande : maximum 120 mégapixels et 20 000 pixels par côté.";
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

class PosterUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PosterUploadError";
  }
}

async function parseMultipartUpload(
  request: Request,
  contentType: string,
  tempDirectory: string,
  expectedCsrfToken: string
): Promise<string> {
  if (!request.body) throw new PosterUploadError("Corps de requête manquant.", 400);

  const reader = request.body.getReader();
  const state: {
    activeWriteStream: fs.WriteStream | null;
    fileWritePromise: Promise<void> | null;
  } = {
    activeWriteStream: null,
    fileWritePromise: null,
  };
  let uploadedFilePath: string | null = null;
  let fileCount = 0;
  let settled = false;
  let resolveParser!: () => void;
  let rejectParser!: (error: Error) => void;
  let receivedCsrf = "";
  let totalBytes = 0;

  const parserDone = new Promise<void>((resolve, reject) => {
    resolveParser = resolve;
    rejectParser = reject;
  });
  void parserDone.catch(() => undefined);

  const parser = busboy({
    headers: { "content-type": contentType },
    limits: {
      files: 1,
      fields: 2,
      fileSize: MAX_FILE_SIZE,
    },
  });

  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    state.activeWriteStream?.destroy();
    rejectParser(error);
  };

  parser.on("field", (name, value) => {
    if (name === "csrfToken") {
      receivedCsrf = value;
    }
  });

  parser.on("file", (fieldName, file, info) => {
    fileCount += 1;
    if (fieldName !== "file" || fileCount !== 1) {
      file.resume();
      fail(new PosterUploadError("Un seul fichier d'image est autorisé.", 400));
      return;
    }

    if (!ALLOWED_MIME_TYPES.has(info.mimeType)) {
      file.resume();
      fail(new PosterUploadError(`Format non supporté (${info.mimeType}). Formats autorisés : JPEG, PNG, WebP, AVIF.`, 415));
      return;
    }

    const tempPath = path.join(tempDirectory, `${crypto.randomUUID()}.upload`);
    const writeStream = fs.createWriteStream(tempPath, { flags: "wx", mode: 0o600 });
    state.activeWriteStream = writeStream;

    file.on("limit", () => {
      fail(new PosterUploadError("Le fichier dépasse la limite autorisée de 60 Mio.", 413));
    });
    file.on("error", () => {
      fail(new PosterUploadError("Erreur lors de la lecture du flux de téléversement.", 400));
    });
    writeStream.on("error", () => {
      fail(new PosterUploadError("Erreur d'écriture du fichier temporaire.", 500));
    });

    state.fileWritePromise = finished(writeStream).then(() => {
      uploadedFilePath = tempPath;
      state.activeWriteStream = null;
    });

    void state.fileWritePromise.catch((err) => {
      fail(err instanceof PosterUploadError ? err : new PosterUploadError("Erreur d'écriture temporaire.", 500));
    });

    file.pipe(writeStream);
  });

  parser.on("close", () => {
    void (async () => {
      try {
        if (state.fileWritePromise) await state.fileWritePromise;
        if (fileCount !== 1 || !uploadedFilePath) {
          throw new PosterUploadError("Le formulaire doit contenir exactement un fichier.", 400);
        }
        if (!receivedCsrf || !expectedCsrfToken || !constantTimeEqual(receivedCsrf, expectedCsrfToken)) {
          throw new PosterUploadError("Jeton de sécurité CSRF invalide.", 403);
        }
        if (!settled) {
          settled = true;
          resolveParser();
        }
      } catch (err: unknown) {
        fail(err instanceof Error ? err : new PosterUploadError("Échec du téléversement.", 400));
      }
    })();
  });

  try {
    while (!settled) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;
      if (totalBytes > MAX_PAYLOAD_SIZE) {
        fail(new PosterUploadError("Charge utile trop volumineuse.", 413));
        break;
      }

      if (!parser.write(Buffer.from(value))) {
        await Promise.race([once(parser, "drain"), parserDone]);
      }
    }

    if (!settled) parser.end();
    await parserDone;
    return uploadedFilePath!;
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    parser.destroy();
    state.activeWriteStream?.destroy();
    if (state.fileWritePromise) await state.fileWritePromise.catch(() => undefined);
    await parserDone.catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }
}

import { imageProcessingLimiter, verifySecurePathChain } from "../../lib/media-image.server";

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    const headers = createAdminHeaders();
    headers.set("Allow", "POST");
    return new Response("Method Not Allowed", {
      status: 405,
      headers,
    });
  }

  const session = await requireValidAdminSession(request);
  const expectedCsrfToken = session.get("csrfToken") || "";

  if (!validateOrigin(request)) {
    return Response.json({ error: "Origine invalide." }, { status: 403, headers: createAdminHeaders() });
  }

  const galleryId = params.id;
  const mediaId = params.mediaId;

  if (!galleryId || !mediaId) {
    return Response.json({ error: "Paramètres manquants." }, { status: 400, headers: createAdminHeaders() });
  }

  const db = getGalleryDb();
  const media = db.prepare(`
    SELECT id, gallery_id, media_type, poster_revision
    FROM gallery_media
    WHERE id = ? AND gallery_id = ?
  `).get(mediaId, galleryId) as { id: string; gallery_id: string; media_type: string; poster_revision: number } | undefined;

  if (!media) {
    return Response.json({ error: "Média introuvable dans cette galerie." }, { status: 404, headers: createAdminHeaders() });
  }

  if (media.media_type !== "video") {
    return Response.json({ error: "Ce média n'est pas une vidéo." }, { status: 400, headers: createAdminHeaders() });
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!/^multipart\/form-data\s*;[^\r\n]*boundary=/i.test(contentType)) {
    return Response.json({ error: "Type de contenu non supporté (multipart attendu)." }, { status: 415, headers: createAdminHeaders() });
  }

  const baseMedia = path.resolve(ENV.GALLERY_MEDIA_PATH);
  try {
    verifySecurePathChain(baseMedia, [galleryId], "directory");
  } catch {
    return Response.json({ error: "Répertoire de galerie inaccessible ou invalide." }, { status: 404, headers: createAdminHeaders() });
  }

  let tempDir: string | null = null;
  try {
    // Create staging on same volume as GALLERY_MEDIA_PATH
    const stagingBase = path.join(baseMedia, ".staging");
    if (!fs.existsSync(stagingBase)) {
      fs.mkdirSync(stagingBase, { recursive: true, mode: 0o700 });
    }
    verifySecurePathChain(baseMedia, [".staging"], "directory");

    tempDir = fs.mkdtempSync(path.join(stagingBase, "poster-upload-"));
    fs.chmodSync(tempDir, 0o700);

    const uploadedPath = await parseMultipartUpload(request, contentType, tempDir, expectedCsrfToken);

    // Validate image dimensions and format with sharp under limiter
    const meta = await imageProcessingLimiter.run(async () => {
      return sharp(uploadedPath, { limitInputPixels: MAX_POSTER_PIXELS }).metadata().catch((err: unknown) => {
        if (err instanceof Error && /pixel limit/i.test(err.message)) {
          throw new PosterUploadError(POSTER_DIMENSIONS_ERROR, 413);
        }
        throw new PosterUploadError("Le fichier image est invalide ou illisible.", 415);
      });
    });

    const isAvif = meta.format === "heif" && meta.compression === "av1";
    if ((!meta.format || !["jpeg", "png", "webp", "avif"].includes(meta.format)) && !isAvif) {
      return Response.json({ error: "Contenu de fichier image invalide." }, { status: 415, headers: createAdminHeaders() });
    }

    const { width = 0, height = 0 } = meta;
    if (!width || !height || (meta.pages ?? 1) > 1) {
      return Response.json({ error: "Une image fixe et lisible est requise." }, { status: 415, headers: createAdminHeaders() });
    }
    if (width * height > MAX_POSTER_PIXELS || Math.max(width, height) > MAX_POSTER_SIDE) {
      return Response.json({ error: POSTER_DIMENSIONS_ERROR }, { status: 413, headers: createAdminHeaders() });
    }

    const nextRevision = (media.poster_revision || 0) + 1;
    const tempWebp = path.join(tempDir, `${nextRevision}.webp`);
    const tempAvif = path.join(tempDir, `${nextRevision}.avif`);

    // Process and strip metadata (EXIF auto-orient, longest side at most 1920).
    await imageProcessingLimiter.run(async () => {
      const pipeline = sharp(uploadedPath, { limitInputPixels: MAX_POSTER_PIXELS })
        .rotate()
        .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true });
      await pipeline.clone()
        .webp({ quality: 85, effort: 4 })
        .toFile(tempWebp);

      await pipeline.clone()
        .avif({ quality: 80, effort: 4 })
        .toFile(tempAvif);
    });

    fs.chmodSync(tempWebp, 0o600);
    fs.chmodSync(tempAvif, 0o600);

    // Securely prepare destination posters directories
    const postersParent = path.join(baseMedia, galleryId, ".posters");
    if (!fs.existsSync(postersParent)) {
      fs.mkdirSync(postersParent, { recursive: true, mode: 0o700 });
    }
    verifySecurePathChain(baseMedia, [galleryId, ".posters"], "directory");

    const postersDir = path.join(postersParent, mediaId);
    if (!fs.existsSync(postersDir)) {
      fs.mkdirSync(postersDir, { recursive: true, mode: 0o700 });
    }
    verifySecurePathChain(baseMedia, [galleryId, ".posters", mediaId], "directory");

    const finalWebp = path.join(postersDir, `${nextRevision}.webp`);
    const finalAvif = path.join(postersDir, `${nextRevision}.avif`);

    // A newer upload may have completed during processing. Check before renaming
    // so a losing writer never overwrites or deletes the winning files.
    const current = db.prepare("SELECT poster_revision FROM gallery_media WHERE id = ? AND gallery_id = ?")
      .get(mediaId, galleryId) as { poster_revision: number } | undefined;
    if (!current || current.poster_revision !== media.poster_revision) {
      throw new PosterUploadError("Le poster a changé pendant le traitement. Réessayez.", 409);
    }

    fs.renameSync(tempWebp, finalWebp);
    try {
      fs.renameSync(tempAvif, finalAvif);
    } catch {
      // Best effort for avif
    }

    fs.chmodSync(finalWebp, 0o600);
    if (fs.existsSync(finalAvif)) fs.chmodSync(finalAvif, 0o600);

    // Update revision in DB with optimistic concurrency check
    const updateRes = db.prepare(`
      UPDATE gallery_media
      SET poster_revision = ?, updated_at = ?
      WHERE id = ? AND gallery_id = ? AND poster_revision = ?
    `).run(nextRevision, Date.now(), mediaId, galleryId, media.poster_revision);

    if (updateRes.changes === 0) {
      try {
        fs.unlinkSync(finalWebp);
      } catch {
        // Ignored
      }
      try {
        fs.unlinkSync(finalAvif);
      } catch {
        // Ignored
      }
      return Response.json(
        { error: "Conflit de révision (409) : le poster a été modifié par une autre opération en arrière-plan." },
        { status: 409, headers: createAdminHeaders() }
      );
    }

    // Clean up old revisions without following symlinks
    if (media.poster_revision > 0) {
      for (const ext of ["webp", "avif"]) {
        const oldFile = path.join(postersDir, `${media.poster_revision}.${ext}`);
        if (fs.existsSync(oldFile)) {
          try {
            const stat = fs.lstatSync(oldFile);
            if (!stat.isSymbolicLink()) {
              fs.unlinkSync(oldFile);
            }
          } catch {
            // Ignored
          }
        }
      }
    }

    return Response.json(
      { success: true, revision: nextRevision },
      { headers: createAdminHeaders() }
    );
  } catch (err) {
    if (err instanceof PosterUploadError) {
      return Response.json({ error: err.message }, { status: err.status, headers: createAdminHeaders() });
    }
    return Response.json(
      { error: `Erreur serveur: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500, headers: createAdminHeaders() }
    );
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  }
}
