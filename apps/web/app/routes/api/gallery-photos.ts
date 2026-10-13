import type { LoaderFunctionArgs } from "react-router";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { getGalleryPhotosPaginated } from "../../lib/gallery.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...GALLERY_PRIVATE_HEADERS, Allow: "GET, HEAD" },
    });
  }

  const { publicId } = params;
  if (!publicId) {
    return new Response("Bad Request", { status: 400, headers: GALLERY_PRIVATE_HEADERS });
  }

  const url = new URL(request.url);
  const skipParam = url.searchParams.get("skip") || "0";

  // Strict decimal integer validation
  if (!/^\d+$/.test(skipParam)) {
    return new Response("Bad Request: skip parameter must be a non-negative integer", {
      status: 400,
      headers: GALLERY_PRIVATE_HEADERS,
    });
  }

  const skip = parseInt(skipParam, 10);
  if (!Number.isSafeInteger(skip) || skip < 0) {
    return new Response("Bad Request: invalid skip value", {
      status: 400,
      headers: GALLERY_PRIVATE_HEADERS,
    });
  }

  const { gallery } = await requireGalleryAccess(request, publicId, undefined, true);
  const pagination = getGalleryPhotosPaginated(gallery.id, skip, 24);

  const photos = pagination.items.map((m) => ({
    id: m.id,
    originalFilename: m.original_filename,
    width: m.width,
    height: m.height,
    mimeType: m.mime_type,
  }));

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }

  return Response.json(
    {
      photos,
      total: pagination.total,
      hasMore: pagination.hasMore,
    },
    {
      headers: GALLERY_PRIVATE_HEADERS,
    }
  );
}
