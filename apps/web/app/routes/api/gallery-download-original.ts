import fs from "node:fs";
import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { getGalleryOriginalPath } from "../../lib/gallery-preview.server";
import { buildContentDisposition } from "../../lib/media-utils.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...GALLERY_PRIVATE_HEADERS, Allow: "GET, HEAD" },
    });
  }

  const { publicId, mediaId } = params;
  if (!publicId || !mediaId) {
    return new Response("Bad Request", { status: 400, headers: GALLERY_PRIVATE_HEADERS });
  }

  const { gallery, media } = await requireGalleryAccess(request, publicId, mediaId, true);
  if (!media) {
    return new Response("Media not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  let filePath: string;
  try {
    filePath = getGalleryOriginalPath(gallery.id, media.id);
  } catch {
    return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  if (!fs.existsSync(filePath)) {
    return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  const contentDisposition = buildContentDisposition("attachment", media.original_filename);

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Content-Length": stats.size.toString(),
        "Content-Type": media.mime_type || "application/octet-stream",
        "Content-Disposition": contentDisposition,
      },
    });
  }

  const stream = fs.createReadStream(filePath, { flags: "r", mode: 0o600 });
  request.signal.addEventListener("abort", () => {
    stream.destroy();
  });

  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      ...GALLERY_PRIVATE_HEADERS,
      "Content-Length": stats.size.toString(),
      "Content-Type": media.mime_type || "application/octet-stream",
      "Content-Disposition": contentDisposition,
    },
  });
}
