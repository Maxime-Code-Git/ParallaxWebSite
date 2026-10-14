import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { openSecureMediaFile } from "../../lib/media-utils.server";
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

  if (media.media_type !== "video" || !media.poster_revision || media.poster_revision <= 0) {
    return new Response("Poster not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  const acceptHeader = request.headers.get("Accept") || "";
  const preferAvif = acceptHeader.includes("image/avif");

  let handle: ReturnType<typeof openSecureMediaFile> | null = null;
  let contentType = "image/webp";

  if (preferAvif) {
    try {
      handle = openSecureMediaFile(ENV.GALLERY_MEDIA_PATH, [
        gallery.id,
        ".posters",
        media.id,
        `${media.poster_revision}.avif`,
      ]);
      contentType = "image/avif";
    } catch {
      // Fallback to webp
    }
  }

  if (!handle) {
    try {
      handle = openSecureMediaFile(ENV.GALLERY_MEDIA_PATH, [
        gallery.id,
        ".posters",
        media.id,
        `${media.poster_revision}.webp`,
      ]);
      contentType = "image/webp";
    } catch {
      return new Response("Poster file not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
    }
  }

  if (request.method === "HEAD") {
    const sizeStr = handle.size.toString();
    handle.close();
    return new Response(null, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Content-Type": contentType,
        "Content-Length": sizeStr,
        Vary: "Accept",
      },
    });
  }

  const stream = handle.createReadStream();
  request.signal.addEventListener("abort", () => {
    handle?.close();
  });

  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      ...GALLERY_PRIVATE_HEADERS,
      "Content-Type": contentType,
      "Content-Length": handle.size.toString(),
      Vary: "Accept",
    },
  });
}
