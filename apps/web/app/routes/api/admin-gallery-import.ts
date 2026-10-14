import type { ActionFunctionArgs } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin, readStrictFormUrlEncoded } from "../../lib/security.server";
import { getGalleryById } from "../../lib/gallery.server";
import {
  analyzeImportFolder,
  startImportJob,
  processImportJob,
} from "../../lib/gallery-import.server";

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
    return Response.json(
      { error: "Origine invalide." },
      { status: 403, headers: createAdminHeaders() }
    );
  }

  const galleryId = params.id;
  if (!galleryId) {
    return Response.json({ error: "Identifiant manquant." }, { status: 400, headers: createAdminHeaders() });
  }

  const gallery = getGalleryById(galleryId);
  if (!gallery) {
    return Response.json({ error: "Galerie introuvable." }, { status: 404, headers: createAdminHeaders() });
  }

  let body: URLSearchParams;
  try {
    body = await readStrictFormUrlEncoded(request, 4096);
  } catch {
    return Response.json({ error: "Corps de requête invalide." }, { status: 400, headers: createAdminHeaders() });
  }

  const formCsrf = body.get("csrfToken") || "";
  if (!formCsrf || !constantTimeEqual(formCsrf, expectedCsrfToken)) {
    return Response.json({ error: "Jeton CSRF invalide." }, { status: 403, headers: createAdminHeaders() });
  }

  const intent = body.get("intent");
  const folderName = (body.get("folderName") || "").trim();

  if (!folderName) {
    return Response.json({ error: "Dossier manquant." }, { status: 400, headers: createAdminHeaders() });
  }

  if (intent === "analyze") {
    try {
      const analysis = analyzeImportFolder(folderName);
      return Response.json({ analysis }, { headers: createAdminHeaders() });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400, headers: createAdminHeaders() }
      );
    }
  }

  if (intent === "start") {
    try {
      const jobId = startImportJob(gallery.id, folderName);
      // Fire background worker
      void processImportJob(jobId).catch((err) => {
        console.error("Background import worker error:", err);
      });

      return Response.json({ jobId, status: "pending" }, { headers: createAdminHeaders() });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400, headers: createAdminHeaders() }
      );
    }
  }

  return Response.json({ error: "Action inconnue." }, { status: 400, headers: createAdminHeaders() });
}
