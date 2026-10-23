import type { ActionFunctionArgs } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin, readStrictFormUrlEncoded } from "../../lib/security.server";
import { getGalleryById } from "../../lib/gallery.server";
import {
  generateGalleryMetadataExport,
  streamGalleryOriginalsZip,
} from "../../lib/gallery-export.server";
import { buildContentDisposition } from "../../lib/media-utils.server";

export async function action({ request }: ActionFunctionArgs) {
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

  let body: URLSearchParams;
  try {
    body = await readStrictFormUrlEncoded(request, 8192);
  } catch {
    return Response.json(
      { error: "Corps de requête invalide." },
      { status: 400, headers: createAdminHeaders() }
    );
  }

  const formCsrf = body.get("csrfToken") || "";
  if (!formCsrf || !constantTimeEqual(formCsrf, expectedCsrfToken)) {
    return Response.json(
      { error: "Jeton CSRF invalide." },
      { status: 403, headers: createAdminHeaders() }
    );
  }

  const galleryId = (body.get("galleryId") || "").trim();
  const exportType = (body.get("exportType") || "json").trim().toLowerCase();

  if (!galleryId || !/^[0-9a-fA-F-]{36}$/.test(galleryId)) {
    return Response.json(
      { error: "Identifiant de galerie manquant ou invalide." },
      { status: 400, headers: createAdminHeaders() }
    );
  }

  const gallery = getGalleryById(galleryId);
  if (!gallery) {
    return Response.json(
      { error: "Galerie introuvable." },
      { status: 404, headers: createAdminHeaders() }
    );
  }

  if (exportType === "json") {
    try {
      const data = generateGalleryMetadataExport(galleryId);
      const safeTitle = (gallery.title || "galerie")
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 50);
      const filename = `Parallax-Metadata-${safeTitle}.json`;

      const headers = createAdminHeaders();
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.set("Content-Disposition", buildContentDisposition("attachment", filename));
      headers.set("Cache-Control", "no-store");
      headers.set("X-Content-Type-Options", "nosniff");

      return new Response(JSON.stringify(data, null, 2), {
        status: 200,
        headers,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("EXPORT_BLOCKED") ? 409 : 500;
      return Response.json({ error: message }, { status, headers: createAdminHeaders() });
    }
  }

  if (exportType === "zip") {
    return streamGalleryOriginalsZip(galleryId, request.signal);
  }

  return Response.json(
    { error: "Type d'export non supporté. Valeurs autorisées : 'json' ou 'zip'." },
    { status: 400, headers: createAdminHeaders() }
  );
}
