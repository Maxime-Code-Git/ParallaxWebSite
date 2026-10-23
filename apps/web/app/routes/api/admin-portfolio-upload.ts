import { type ActionFunctionArgs } from "react-router";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { once } from "node:events";
import busboy from "busboy";
import { requireValidAdminSession } from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin } from "../../lib/security.server";
import {
  PORTFOLIO_MEDIA_OWNER_TYPES,
  PORTFOLIO_MEDIA_SLOTS,
  PORTFOLIO_CATEGORIES,
  UUID_REGEX,
  type PortfolioMediaOwnerType,
  type PortfolioMediaSlot,
  type PortfolioCategory,
  type PortfolioMediaItem,
} from "../../lib/portfolio-content.shared";
import {
  getRawPortfolioContent,
  savePortfolioContent,
  getPortfolioMediaPath,
  cleanupUnreferencedPortfolioMedia,
} from "../../lib/portfolio-content.server";
import {
  MAX_FILE_SIZE,
  SafeImageError,
  ConcurrencyLimitError,
  processPortfolioMediaImage,
  publishStagedPortfolioMedia,
  cleanupStagedPortfolioMedia,
  cleanupPublishedPortfolioMedia,
  type ProcessedPortfolioMediaWithStaging,
} from "../../lib/media-image.server";
import {
  RevisionConflictError,
  ValidationError,
} from "../../lib/site-content.server";

const MULTIPART_OVERHEAD_MARGIN = 64 * 1024;
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

  const stopActiveWrite = () => {
    if (activeWriteStream && !activeWriteStream.destroyed) {
      activeWriteStream.destroy();
    }
  };

  const waitForFileWrite = async () => {
    if (fileWritePromise) {
      await fileWritePromise;
    }
  };

  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    stopActiveWrite();
    rejectParser(error);
  };

  parser.on("file", (fieldName, fileStream, info) => {
    fileCount += 1;
    if (fieldName !== "file" || fileCount !== 1) {
      fileStream.resume();
      fail(new UploadRequestError("L'import doit contenir exactement un fichier dans le champ 'file'.", 400));
      return;
    }

    const mime = info.mimeType.toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      fileStream.resume();
      fail(
        new UploadRequestError(
          "Format de fichier non autorisé. Formats acceptés : JPEG, PNG, WebP.",
          415
        )
      );
      return;
    }

    const tempPath = path.join(tempDirectory, `${crypto.randomUUID()}`);
    uploadedFilePath = tempPath;
    const writeStream = fs.createWriteStream(tempPath, {
      flags: "wx",
      mode: 0o600,
    });
    activeWriteStream = writeStream;

    fileWritePromise = new Promise<void>((resolve, reject) => {
      writeStream.once("finish", resolve);
      writeStream.once("error", reject);
      fileStream.once("error", reject);
    });

    fileStream.on("limit", () => {
      fail(new UploadRequestError("Le fichier dépasse la limite autorisée de 25 Mo.", 413));
    });
    fileStream.on("error", () => {
      fail(new UploadRequestError("Erreur de flux lors de la réception du fichier.", 400));
    });
    writeStream.on("error", () => {
      fail(new UploadRequestError("Erreur lors de l'écriture du fichier temporaire.", 500));
    });

    fileStream.pipe(writeStream);
  });

  parser.on("filesLimit", () => {
    fail(new UploadRequestError("Un seul fichier peut être téléversé par requête.", 400));
  });

  parser.on("finish", async () => {
    if (settled) return;
    try {
      await waitForFileWrite();
      if (!uploadedFilePath) {
        fail(new UploadRequestError("Aucun fichier trouvé dans la requête.", 400));
        return;
      }
      settled = true;
      resolveParser();
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
    }
  });

  parser.on("error", (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    fail(new UploadRequestError(`Erreur lors du traitement multipart : ${message}`, 400));
  });

  let bytesRead = 0;
  try {
    while (true) {
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
    await waitForFileWrite().catch(() => undefined);
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

  // 2. CSRF token check
  const headerCsrf = request.headers.get("x-csrf-token");
  const sessionCsrf = session.get("csrfToken");
  if (!headerCsrf || !sessionCsrf || !constantTimeEqual(headerCsrf, sessionCsrf)) {
    return jsonError("Jeton CSRF invalide ou expiré.", 403);
  }

  // 3. Metadata headers
  const ownerType = request.headers.get("x-portfolio-owner-type") as PortfolioMediaOwnerType;
  const ownerId = request.headers.get("x-portfolio-owner-id");
  const mediaSlot = request.headers.get("x-portfolio-media-slot") as PortfolioMediaSlot;
  const previousRevision = request.headers.get("x-portfolio-revision");

  if (!ownerType || !PORTFOLIO_MEDIA_OWNER_TYPES.includes(ownerType)) {
    return jsonError("Type de propriétaire non autorisé.", 400);
  }
  if (!ownerId) {
    return jsonError("Identifiant de propriétaire manquant.", 400);
  }
  if (!mediaSlot || !PORTFOLIO_MEDIA_SLOTS.includes(mediaSlot)) {
    return jsonError("Emplacement de média non autorisé.", 400);
  }
  if (!previousRevision || typeof previousRevision !== "string") {
    return jsonError("Révision du portfolio manquante.", 400);
  }

  // 4. Pre-Sharp Owner & Slot validation against active content
  const { content: currentContent } = getRawPortfolioContent();

  if (ownerType === "section") {
    if (
      mediaSlot !== "cover" &&
      mediaSlot !== "showreel_cover" &&
      mediaSlot !== "category_entry" &&
      mediaSlot !== "category_banner"
    ) {
      return jsonError("Emplacement de média non autorisé pour une rubrique.", 400);
    }
    if (!PORTFOLIO_CATEGORIES.includes(ownerId as PortfolioCategory)) {
      return jsonError("Rubrique inconnue.", 404);
    }
  } else if (ownerType === "project") {
    if (mediaSlot !== "cover" && mediaSlot !== "video_cover" && mediaSlot !== "gallery") {
      return jsonError("Emplacement de média non autorisé pour un projet.", 400);
    }
    if (!UUID_REGEX.test(ownerId)) {
      return jsonError("Identifiant de projet invalide (UUID attendu).", 400);
    }
    const projectExists = currentContent.projects.some((p) => p.id === ownerId);
    if (!projectExists) {
      return jsonError("Projet introuvable.", 404);
    }
  }

  // Check revision against current content before heavy operations
  if (currentContent.revision !== previousRevision) {
    return jsonError(
      "Un autre utilisateur ou onglet a modifié le portfolio. Veuillez recharger la page.",
      409,
      { currentRevision: currentContent.revision }
    );
  }

  // 5. Content-Type and Content-Length
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return jsonError("Type de contenu invalide. 'multipart/form-data' attendu.", 415);
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    if (!/^\d+$/.test(contentLengthHeader)) {
      return jsonError("En-tête Content-Length invalide.", 400);
    }
    const declaredSize = Number.parseInt(contentLengthHeader, 10);
    if (declaredSize > MAX_BODY_SIZE) {
      return jsonError("La taille de la requête dépasse la limite de 25 Mo autorisée.", 413);
    }
  }

  // 6. Parse multipart body into secure temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-portfolio-upload-"));
  let processedResult: ProcessedPortfolioMediaWithStaging | null = null;
  let publishedSuccessfully = false;
  const mediaBasePath = getPortfolioMediaPath();

  try {
    const tempFilePath = await parseSingleUpload(request, contentType, tempDir);

    // 7. Process image via shared Sharp ConcurrencyLimiter (isolated in staging/<imageId>)
    try {
      processedResult = await processPortfolioMediaImage(
        tempFilePath,
        tempDir,
        ownerType,
        ownerId,
        mediaSlot,
        mediaBasePath
      );
    } catch (procErr) {
      if (procErr instanceof ConcurrencyLimitError) {
        return Response.json(
          { error: procErr.message },
          {
            status: 503,
            headers: {
              "Retry-After": "2",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          }
        );
      }
      if (procErr instanceof SafeImageError) {
        return jsonError(procErr.message, 422);
      }
      throw procErr;
    }

    // 8. Verify revision again before publishing
    const { content: freshContent } = getRawPortfolioContent();
    if (freshContent.revision !== previousRevision) {
      cleanupStagedPortfolioMedia(processedResult.imageId, mediaBasePath);
      return jsonError(
        "Conflit de révision : le portfolio a été modifié pendant le traitement de l'image.",
        409,
        { currentRevision: freshContent.revision }
      );
    }

    // 9. Publish from staging to final directory
    publishStagedPortfolioMedia(
      processedResult.imageId,
      ownerType,
      ownerId,
      mediaSlot,
      mediaBasePath
    );
    publishedSuccessfully = true;

    // 10. Update content JSON atomically
    const metadataToStore: PortfolioMediaItem = {
      imageId: processedResult.imageId,
      ownerType: processedResult.ownerType,
      ownerId: processedResult.ownerId,
      mediaSlot: processedResult.mediaSlot,
      originalFormat: processedResult.originalFormat,
      originalWidth: processedResult.originalWidth,
      originalHeight: processedResult.originalHeight,
      variants: processedResult.variants,
      createdAt: processedResult.createdAt,
    };
    const nextContent: typeof freshContent = JSON.parse(JSON.stringify(freshContent));
    nextContent.media[processedResult.imageId] = metadataToStore;

    if (ownerType === "section") {
      const sec = nextContent.sections[ownerId as PortfolioCategory];
      if (sec) {
        if (mediaSlot === "cover") {
          sec.coverImageId = processedResult.imageId;
        } else if (mediaSlot === "showreel_cover") {
          sec.showreelCoverImageId = processedResult.imageId;
        } else if (mediaSlot === "category_entry") {
          sec.entryImageId = processedResult.imageId;
        } else if (mediaSlot === "category_banner") {
          sec.bannerImageId = processedResult.imageId;
        }
      }
    } else if (ownerType === "project") {
      const proj = nextContent.projects.find((p) => p.id === ownerId);
      if (proj) {
        if (mediaSlot === "cover") {
          proj.coverImageId = processedResult.imageId;
        } else if (mediaSlot === "video_cover") {
          proj.draftVideoCoverImageId = processedResult.imageId;
          if (proj.video) {
            proj.video.coverImageId = processedResult.imageId;
          }
        } else if (mediaSlot === "gallery") {
          if (!proj.galleryImageIds.includes(processedResult.imageId)) {
            proj.galleryImageIds.push(processedResult.imageId);
          }
        }
        proj.updatedAt = Date.now();
      }
    }

    let saveResult: { success: boolean; newRevision: string; content: typeof freshContent };
    try {
      saveResult = await savePortfolioContent(nextContent, previousRevision);
    } catch (saveErr) {
      // Rollback newly published directory if save failed!
      cleanupPublishedPortfolioMedia(ownerType, ownerId, mediaSlot, processedResult.imageId, mediaBasePath);
      if (saveErr instanceof RevisionConflictError) {
        return jsonError(saveErr.message, 409);
      }
      if (saveErr instanceof ValidationError) {
        return jsonError(saveErr.message, 422);
      }
      throw saveErr;
    }

    // 11. Clean up unreferenced media in background
    void cleanupUnreferencedPortfolioMedia().catch(() => undefined);

    return Response.json(
      {
        success: true,
        imageId: processedResult.imageId,
        metadata: metadataToStore,
        newRevision: saveResult.newRevision,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch (err: unknown) {
    if (processedResult?.imageId) {
      if (publishedSuccessfully) {
        cleanupPublishedPortfolioMedia(ownerType, ownerId, mediaSlot, processedResult.imageId, mediaBasePath);
      } else {
        cleanupStagedPortfolioMedia(processedResult.imageId, mediaBasePath);
      }
    }
    if (err instanceof UploadRequestError) {
      return jsonError(err.message, err.status);
    }
    const message = err instanceof Error ? err.message : "Erreur interne lors du téléversement.";
    return jsonError(message, 500);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  }
}
