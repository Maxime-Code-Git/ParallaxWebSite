import { type ActionFunctionArgs } from "react-router";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import busboy from "busboy";
import { requireValidAdminSession } from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin } from "../../lib/security.server";
import { ENV } from "../../lib/env.server";
import {
  type AdminUploadLocation,
  ADMIN_UPLOAD_LOCATIONS,
  type SiteContent,
} from "../../lib/site-content.shared";
import {
  getRawSiteContent,
  saveSiteMediaUpdate,
  saveSiteMediaRevert,
  getSiteContentFilePath,
  RevisionConflictError,
  ValidationError,
  CorruptedContentError,
} from "../../lib/site-content.server";
import {
  MAX_FILE_SIZE,
  SafeImageError,
  ConcurrencyLimitError,
  processSiteMediaImage,
  publishStagedMedia,
  cleanupStagedMedia,
  cleanupMediaDirectory,
  cleanupUnreferencedMedia,
  type ProcessedMediaWithStaging,
} from "../../lib/media-image.server";

const MULTIPART_OVERHEAD_MARGIN = 64 * 1024; // 64 KiB margin for boundary & part headers
const MAX_BODY_SIZE = MAX_FILE_SIZE + MULTIPART_OVERHEAD_MARGIN;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json(
    { error: message, ...extra },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    }
  );
}

async function parseSingleUpload(
  request: Request,
  contentType: string,
  tempDirectory: string
): Promise<string> {
  if (!request.body) {
    throw new UploadRequestError("Le corps de la requête est absent.", 400);
  }

  const reader = request.body.getReader();
  let activeWriteStream: fs.WriteStream | null = null;
  let fileWritePromise: Promise<void> | null = null;
  let uploadedFilePath: string | null = null;
  let fileCount = 0;
  let settled = false;
  let resolveParser!: () => void;
  let rejectParser!: (error: Error) => void;

  const parserDone = new Promise<void>((resolve, reject) => {
    resolveParser = resolve;
    rejectParser = reject;
  });
  void parserDone.catch(() => undefined);

  const parser = busboy({
    headers: { "content-type": contentType },
    limits: {
      files: 1,
      fields: 0,
      parts: 2,
      fileSize: MAX_FILE_SIZE,
    },
  });

  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    activeWriteStream?.destroy();
    rejectParser(error);
  };

  const stopActiveWrite = () => activeWriteStream?.destroy();
  const waitForFileWrite = async () => {
    if (fileWritePromise) await fileWritePromise.catch(() => undefined);
  };

  parser.on("file", (fieldName, file, info) => {
    fileCount += 1;
    if (fieldName !== "file" || fileCount !== 1) {
      file.resume();
      fail(new UploadRequestError("L'import doit contenir exactement un fichier dans le champ 'file'.", 400));
      return;
    }
    if (!ALLOWED_MIME_TYPES.has(info.mimeType)) {
      file.resume();
      fail(new UploadRequestError("Format de fichier non pris en charge. Formats acceptés : JPEG, PNG, WebP.", 415));
      return;
    }

    const tempPath = path.join(tempDirectory, `${crypto.randomUUID()}`);
    activeWriteStream = fs.createWriteStream(tempPath, {
      flags: "wx",
      mode: 0o600,
    });

    file.on("limit", () =>
      fail(new UploadRequestError("Le fichier dépasse la taille maximale autorisée (25 Mo).", 413))
    );
    file.on("error", () => fail(new UploadRequestError("Erreur de flux lors de la réception du fichier.", 400)));
    activeWriteStream.on("error", () =>
      fail(new UploadRequestError("Erreur lors de l'écriture du fichier temporaire.", 500))
    );

    const currentWriteStream = activeWriteStream;
    fileWritePromise = finished(currentWriteStream).then(() => {
      uploadedFilePath = tempPath;
      activeWriteStream = null;
    });
    void fileWritePromise.catch((error) => {
      fail(
        error instanceof UploadRequestError
          ? error
          : new UploadRequestError("Erreur lors du stockage temporaire du fichier.", 500)
      );
    });
    file.pipe(currentWriteStream);
  });

  parser.on("partsLimit", () => fail(new UploadRequestError("Trop de parties dans la requête multipart.", 400)));
  parser.on("filesLimit", () => fail(new UploadRequestError("Un seul fichier peut être importé à la fois.", 400)));
  parser.on("fieldsLimit", () => fail(new UploadRequestError("Champs inattendus dans le formulaire.", 400)));
  parser.on("error", () => fail(new UploadRequestError("Format de corps multipart invalide.", 400)));
  parser.on("close", () => {
    void (async () => {
      try {
        if (fileWritePromise) await fileWritePromise;
        if (fileCount !== 1 || !uploadedFilePath) {
          throw new UploadRequestError("L'import doit contenir exactement un fichier.", 400);
        }
        if (!settled) {
          settled = true;
          resolveParser();
        }
      } catch (error: unknown) {
        fail(error instanceof Error ? error : new UploadRequestError("Échec de l'import.", 400));
      }
    })();
  });

  let bytesRead = 0;
  try {
    while (!settled) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.length;
      if (bytesRead > MAX_BODY_SIZE) {
        fail(new UploadRequestError("Le corps de la requête dépasse la taille maximale autorisée.", 413));
        break;
      }

      if (!parser.write(Buffer.from(value))) {
        await Promise.race([once(parser, "drain"), parserDone]);
      }
    }
    if (!settled) parser.end();
    await parserDone;
    return uploadedFilePath!;
  } catch (error: unknown) {
    await reader.cancel().catch(() => undefined);
    parser.destroy();
    stopActiveWrite();
    await waitForFileWrite();
    await parserDone.catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function loader() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // 1. Session & Origin
  const session = await requireValidAdminSession(request);
  if (!validateOrigin(request)) {
    return jsonError("Origine non autorisée.", 403);
  }

  // 2. CSRF token check (constant-time)
  const csrfToken = request.headers.get("x-csrf-token");
  const sessionCsrf = session.get("csrfToken");
  if (!csrfToken || !sessionCsrf || !constantTimeEqual(csrfToken, sessionCsrf)) {
    return jsonError("Jeton CSRF invalide ou expiré.", 403);
  }

  // 3. Location and revision headers check
  const location = request.headers.get("x-media-location") as AdminUploadLocation | null;
  if (!location || !ADMIN_UPLOAD_LOCATIONS.includes(location)) {
    return jsonError(
      `Emplacement non valide. Emplacements autorisés : ${ADMIN_UPLOAD_LOCATIONS.join(", ")}.`,
      400
    );
  }

  const previousRevision = request.headers.get("x-content-revision");
  if (!previousRevision || !/^[0-9a-f]{32}$/i.test(previousRevision)) {
    return jsonError("Format de révision invalide (attendu : hexadécimal de 32 caractères).", 400);
  }

  // Check revision against current content before heavy operations
  const current = getRawSiteContent();
  if (current.isCorrupted) {
    return jsonError("Fichier de contenu corrompu.", 500);
  }
  if (current.content.revision.toLowerCase() !== previousRevision.toLowerCase()) {
    return jsonError(
      "Conflit de révision : le contenu a été mis à jour par un autre enregistrement. Vos saisies ont été conservées.",
      409,
      { conflict: true, latestRevision: current.content.revision }
    );
  }

  // 4. Action: revert to reference image vs upload
  const mediaAction = request.headers.get("x-media-action");
  if (mediaAction === "revert") {
    try {
      const result = saveSiteMediaRevert(location, previousRevision);
      cleanupUnreferencedMedia(result.content, ENV.SITE_MEDIA_PATH, getSiteContentFilePath());
      return Response.json(
        {
          success: true,
          newRevision: result.newRevision,
          imageId: result.defaultImageId,
          isDefault: true,
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
          },
        }
      );
    } catch (err) {
      if (err instanceof RevisionConflictError) {
        return jsonError(
          "Conflit de révision : le contenu a été mis à jour par un autre enregistrement.",
          409,
          { conflict: true, latestRevision: getRawSiteContent().content.revision }
        );
      }
      return jsonError("Échec du rétablissement de l'image de référence.", 500);
    }
  }

  // 5. Image upload flow
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;[^\r\n]*boundary=/i.test(contentType)) {
    return jsonError("Type de média non supporté. Attendu : multipart/form-data.", 415);
  }

  const contentLengthHeader = request.headers.get("Content-Length");
  if (contentLengthHeader !== null) {
    const trimmed = contentLengthHeader.trim();
    if (!/^\d+$/.test(trimmed)) {
      return jsonError("En-tête Content-Length invalide.", 400);
    }
    const parsedLength = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return jsonError("En-tête Content-Length invalide.", 400);
    }
    if (parsedLength > MAX_BODY_SIZE) {
      return jsonError("Le fichier dépasse la taille maximale autorisée (25 Mo).", 413);
    }
  }

  let tempDirectory: string | null = null;
  let processedMedia: ProcessedMediaWithStaging | null = null;
  let isPublished = false;

  try {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-media-upload-"));
    try {
      fs.chmodSync(tempDirectory, 0o700);
    } catch {
      // best-effort
    }

    const uploadedFilePath = await parseSingleUpload(request, contentType, tempDirectory);

    // Process image into isolated staging directory
    processedMedia = await processSiteMediaImage(
      uploadedFilePath,
      tempDirectory,
      location,
      ENV.SITE_MEDIA_PATH
    );

    // Final revision check right before publishing from staging
    const latestBeforePublish = getRawSiteContent();
    if (latestBeforePublish.isCorrupted) {
      cleanupStagedMedia(processedMedia.imageId, ENV.SITE_MEDIA_PATH);
      return jsonError("Fichier de contenu corrompu.", 500);
    }
    if (latestBeforePublish.content.revision.toLowerCase() !== previousRevision.toLowerCase()) {
      cleanupStagedMedia(processedMedia.imageId, ENV.SITE_MEDIA_PATH);
      return jsonError(
        "Conflit de révision : le contenu a été mis à jour par un autre enregistrement. Vos saisies ont été conservées.",
        409,
        { conflict: true, latestRevision: latestBeforePublish.content.revision }
      );
    }

    // Atomically move from staging to site/<location>/<imageId>
    publishStagedMedia(processedMedia.imageId, location, ENV.SITE_MEDIA_PATH);
    isPublished = true;

    // Atomically save to SiteContent JSON with revision check (stripping internal stagingDir)
    const cleanMetadata = {
      imageId: processedMedia.imageId,
      location: processedMedia.location,
      originalWidth: processedMedia.originalWidth,
      originalHeight: processedMedia.originalHeight,
      variants: processedMedia.variants,
      createdAt: processedMedia.createdAt,
    };
    let saveResult: { newRevision: string; content: SiteContent };
    try {
      saveResult = saveSiteMediaUpdate(location, cleanMetadata, previousRevision);
    } catch (saveErr) {
      // Rollback published directory if JSON save failed
      const mediaDir = path.resolve(ENV.SITE_MEDIA_PATH, "site", location, processedMedia.imageId);
      cleanupMediaDirectory(mediaDir, ENV.SITE_MEDIA_PATH);
      throw saveErr;
    }

    // Clean up unreferenced media in background
    cleanupUnreferencedMedia(saveResult.content, ENV.SITE_MEDIA_PATH, getSiteContentFilePath());

    return Response.json(
      {
        success: true,
        newRevision: saveResult.newRevision,
        imageId: processedMedia.imageId,
        mediaMetadata: cleanMetadata,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
        },
      }
    );
  } catch (err: unknown) {
    // If saving or processing failed, clean up staging or published directory
    if (processedMedia) {
      if (isPublished) {
        const mediaDir = path.resolve(ENV.SITE_MEDIA_PATH, "site", location, processedMedia.imageId);
        cleanupMediaDirectory(mediaDir, ENV.SITE_MEDIA_PATH);
      } else {
        cleanupStagedMedia(processedMedia.imageId, ENV.SITE_MEDIA_PATH);
      }
    }

    if (err instanceof ConcurrencyLimitError) {
      return Response.json(
        { error: err.message },
        {
          status: 503,
          headers: {
            "Retry-After": "2",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
          },
        }
      );
    }

    if (err instanceof RevisionConflictError) {
      const latest = getRawSiteContent();
      return jsonError(
        "Conflit de révision : le contenu a été mis à jour par un autre enregistrement. Vos saisies ont été conservées.",
        409,
        { conflict: true, latestRevision: latest.content.revision }
      );
    }

    if (err instanceof UploadRequestError) {
      return jsonError(err.message, err.status);
    }

    if (err instanceof SafeImageError) {
      return jsonError(err.message, 422);
    }

    if (err instanceof ValidationError) {
      return jsonError(err.message, 422);
    }

    if (err instanceof CorruptedContentError) {
      return jsonError("Fichier de contenu corrompu.", 500);
    }

    return jsonError("Erreur interne lors du traitement de l'image.", 500);
  } finally {
    if (tempDirectory) {
      try {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
