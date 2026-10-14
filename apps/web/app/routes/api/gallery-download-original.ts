import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { buildContentDisposition, openSecureMediaFile } from "../../lib/media-utils.server";
import { ENV } from "../../lib/env.server";

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

  let handle: ReturnType<typeof openSecureMediaFile>;
  try {
    handle = openSecureMediaFile(ENV.GALLERY_MEDIA_PATH, [gallery.id, media.id]);
  } catch {
    return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  const contentDisposition = buildContentDisposition("attachment", media.original_filename);

  if (request.method === "HEAD") {
    const sizeStr = handle.size.toString();
    handle.close();
    return new Response(null, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Content-Length": sizeStr,
        "Content-Type": media.mime_type || "application/octet-stream",
        "Content-Disposition": contentDisposition,
      },
    });
  }

  const stream = handle.createReadStream();
  request.signal.addEventListener("abort", () => {
    handle.close();
  });

  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      ...GALLERY_PRIVATE_HEADERS,
      "Content-Length": handle.size.toString(),
      "Content-Type": media.mime_type || "application/octet-stream",
      "Content-Disposition": contentDisposition,
    },
  });
}
