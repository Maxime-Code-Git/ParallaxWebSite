import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_PAYLOAD_SIZE = MAX_FILE_SIZE + 1024 * 1024; // 26 MB
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
      fail(new PosterUploadError("Le fichier dépasse la limite autorisée de 25 Mo.", 413));
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

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...createAdminHeaders(), Allow: "POST" },
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

  let tempDir: string | null = null;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-poster-upload-"));
    fs.chmodSync(tempDir, 0o700);

    const uploadedPath = await parseMultipartUpload(request, contentType, tempDir, expectedCsrfToken);

    // Validate image dimensions and format with sharp
    const meta = await sharp(uploadedPath, { limitInputPixels: 40_000_000 }).metadata();
    if (!meta.format || !["jpeg", "png", "webp", "avif"].includes(meta.format)) {
      return Response.json({ error: "Contenu de fichier image invalide." }, { status: 415, headers: createAdminHeaders() });
    }

    if ((meta.width || 0) * (meta.height || 0) > 40_000_000) {
      return Response.json({ error: "Dimensions de l'image trop importantes." }, { status: 413, headers: createAdminHeaders() });
    }

    const nextRevision = (media.poster_revision || 0) + 1;
    const tempWebp = path.join(tempDir, `${nextRevision}.webp`);
    const tempAvif = path.join(tempDir, `${nextRevision}.avif`);

    // Process and strip metadata (EXIF auto-orient, max width 1920)
    await sharp(uploadedPath, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 })
      .toFile(tempWebp);

    await sharp(uploadedPath, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1920, withoutEnlargement: true })
      .avif({ quality: 80, effort: 4 })
      .toFile(tempAvif);

    const postersDir = path.join(ENV.GALLERY_MEDIA_PATH, galleryId, ".posters", mediaId);
    if (!fs.existsSync(postersDir)) {
      fs.mkdirSync(postersDir, { recursive: true, mode: 0o700 });
    }

    const finalWebp = path.join(postersDir, `${nextRevision}.webp`);
    const finalAvif = path.join(postersDir, `${nextRevision}.avif`);

    fs.renameSync(tempWebp, finalWebp);
    try {
      fs.renameSync(tempAvif, finalAvif);
    } catch {
      // Best effort for avif
    }

    fs.chmodSync(finalWebp, 0o600);
    if (fs.existsSync(finalAvif)) fs.chmodSync(finalAvif, 0o600);

    // Update revision in DB
    db.prepare(`
      UPDATE gallery_media
      SET poster_revision = ?, updated_at = ?
      WHERE id = ? AND gallery_id = ?
    `).run(nextRevision, Date.now(), mediaId, galleryId);

    // Clean up old revisions
    if (media.poster_revision > 0) {
      try {
        fs.unlinkSync(path.join(postersDir, `${media.poster_revision}.webp`));
      } catch {
        // Ignored
      }
      try {
        fs.unlinkSync(path.join(postersDir, `${media.poster_revision}.avif`));
      } catch {
        // Ignored
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
