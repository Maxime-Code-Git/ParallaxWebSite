import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireValidAdminSession, createAdminHeaders } from "../../lib/admin-auth.server";
import { validateOrigin } from "../../lib/security.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { ensureGalleryImportFolder } from "../../lib/gallery-folder.server";
import {
  initUploadSession,
  saveChunkStream,
  getUploadStatus,
  finalizeUpload,
  cancelUpload,
  isUploadTarget,
  UploadValidationError,
  DiskSpaceError,
} from "../../lib/gallery-upload.server";

function validateCsrf(request: Request, sessionCsrf: string | undefined): boolean {
  const headerCsrf = request.headers.get("X-CSRF-Token");
  const queryCsrf = new URL(request.url).searchParams.get("csrfToken");
  const token = headerCsrf || queryCsrf;
  if (!token || !sessionCsrf) return false;
  return constantTimeEqual(token, sessionCsrf);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireValidAdminSession(request);
  const { id } = params;
  if (!id || !/^[0-9a-zA-Z_-]+$/.test(id)) {
    return Response.json({ error: "Identifiant invalide." }, { status: 400, headers: createAdminHeaders() });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const uploadId = url.searchParams.get("uploadId");

  try {
    if (action === "status" && uploadId) {
      const status = getUploadStatus(id, uploadId);
      return Response.json(status, { headers: createAdminHeaders() });
    }

    if (action === "folder") {
      const folder = ensureGalleryImportFolder(id);
      return Response.json({ folderName: folder.folderName }, { headers: createAdminHeaders() });
    }

    return Response.json({ error: "Action inconnue." }, { status: 400, headers: createAdminHeaders() });
  } catch (err: unknown) {
    const status = err instanceof UploadValidationError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Erreur serveur.";
    return Response.json({ error: message }, { status, headers: createAdminHeaders() });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const session = await requireValidAdminSession(request);

  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Méthode non autorisée." }, { status: 405, headers: createAdminHeaders() });
  }

  if (!validateOrigin(request)) {
    return Response.json({ error: "Forbidden (Origin invalid)" }, { status: 403, headers: createAdminHeaders() });
  }

  const sessionCsrf = session.get("csrfToken") as string | undefined;
  if (!validateCsrf(request, sessionCsrf)) {
    return Response.json({ error: "Jeton CSRF invalide." }, { status: 403, headers: createAdminHeaders() });
  }

  const { id } = params;
  if (!id || !/^[0-9a-zA-Z_-]+$/.test(id)) {
    return Response.json({ error: "Identifiant invalide." }, { status: 400, headers: createAdminHeaders() });
  }

  const url = new URL(request.url);
  const actionParam = url.searchParams.get("action");

  try {
    if (request.method === "DELETE" || actionParam === "cancel") {
      const uploadId = url.searchParams.get("uploadId") || request.headers.get("X-Upload-Id");
      if (uploadId) {
        cancelUpload(id, uploadId);
      }
      return Response.json({ success: true }, { headers: createAdminHeaders() });
    }

    // Chunk upload (binary stream)
    if (actionParam === "chunk") {
      const uploadId = request.headers.get("X-Upload-Id");
      const chunkIndexStr = request.headers.get("X-Chunk-Index");
      if (!uploadId || chunkIndexStr === null || !/^\d+$/.test(chunkIndexStr.trim())) {
        return Response.json({ error: "Index de morceau manquant ou invalide." }, { status: 400, headers: createAdminHeaders() });
      }
      const chunkIndex = parseInt(chunkIndexStr, 10);
      if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
        return Response.json({ error: "Index de morceau invalide." }, { status: 400, headers: createAdminHeaders() });
      }

      if (!request.body) {
        return Response.json({ error: "Corps de requête vide." }, { status: 400, headers: createAdminHeaders() });
      }

      const res = await saveChunkStream(id, uploadId, chunkIndex, request.body);
      return Response.json(res, { headers: createAdminHeaders() });
    }

    // JSON action payloads (init or finalize)
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // not JSON or empty
    }

    const actionName = actionParam || String(body.action || "");

    if (actionName === "init") {
      const target = body.target;
      if (!isUploadTarget(target)) {
        return Response.json(
          { error: "Cible d'upload invalide (photos ou videos requis)." },
          { status: 400, headers: createAdminHeaders() }
        );
      }
      const fileName = String(body.fileName || "").trim();
      if (!fileName) {
        return Response.json({ error: "Nom de fichier requis." }, { status: 400, headers: createAdminHeaders() });
      }
      const fileSize = typeof body.fileSize === "number" ? body.fileSize : Number(body.fileSize);
      if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
        return Response.json({ error: "Taille de fichier invalide (doit être un entier positif et sûr)." }, { status: 400, headers: createAdminHeaders() });
      }
      const totalChunks = typeof body.totalChunks === "number" ? body.totalChunks : Number(body.totalChunks);
      if (!Number.isSafeInteger(totalChunks) || totalChunks <= 0) {
        return Response.json({ error: "Nombre de morceaux invalide." }, { status: 400, headers: createAdminHeaders() });
      }
      let chunkSize: number | undefined;
      if (body.chunkSize !== undefined) {
        chunkSize = typeof body.chunkSize === "number" ? body.chunkSize : Number(body.chunkSize);
        if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
          return Response.json({ error: "Taille de morceau invalide." }, { status: 400, headers: createAdminHeaders() });
        }
      }

      const res = initUploadSession(id, {
        target,
        fileName,
        fileSize,
        totalChunks,
        chunkSize,
      });
      return Response.json(res, { headers: createAdminHeaders() });
    }

    if (actionName === "finalize") {
      const uploadId = String(body.uploadId || url.searchParams.get("uploadId") || "");
      if (!uploadId) {
        return Response.json({ error: "uploadId manquant." }, { status: 400, headers: createAdminHeaders() });
      }

      const res = await finalizeUpload(id, uploadId);
      return Response.json(res, { headers: createAdminHeaders() });
    }

    return Response.json({ error: "Action non reconnue." }, { status: 400, headers: createAdminHeaders() });
  } catch (err: unknown) {
    if (err instanceof DiskSpaceError) {
      return Response.json({ error: err.message }, { status: 507, headers: createAdminHeaders() });
    }
    if (err instanceof UploadValidationError) {
      return Response.json({ error: err.message }, { status: err.status, headers: createAdminHeaders() });
    }
    const message = err instanceof Error ? err.message : "Erreur inattendue.";
    return Response.json({ error: message }, { status: 500, headers: createAdminHeaders() });
  }
}
