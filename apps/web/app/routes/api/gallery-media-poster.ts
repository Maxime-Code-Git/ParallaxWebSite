import fs from "node:fs";
import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { getGalleryPosterPath } from "../../lib/gallery-preview.server";

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

  let posterPath = "";
  let contentType = "image/webp";

  if (preferAvif) {
    try {
      const candidatePath = getGalleryPosterPath(gallery.id, media.id, media.poster_revision, "avif");
      if (fs.existsSync(candidatePath)) {
        posterPath = candidatePath;
        contentType = "image/avif";
      }
    } catch {
      // Fallback to webp
    }
  }

  if (!posterPath) {
    try {
      const candidatePath = getGalleryPosterPath(gallery.id, media.id, media.poster_revision, "webp");
      if (fs.existsSync(candidatePath)) {
        posterPath = candidatePath;
        contentType = "image/webp";
      }
    } catch {
      return new Response("Poster file not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
    }
  }

  if (!posterPath || !fs.existsSync(posterPath)) {
    return new Response("Poster file not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(posterPath);
  } catch {
    return new Response("Poster file not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Content-Type": contentType,
        "Content-Length": stats.size.toString(),
        "Vary": "Accept",
      },
    });
  }

  const stream = fs.createReadStream(posterPath, { flags: "r", mode: 0o600 });
  request.signal.addEventListener("abort", () => {
    stream.destroy();
  });

  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      ...GALLERY_PRIVATE_HEADERS,
      "Content-Type": contentType,
      "Content-Length": stats.size.toString(),
      "Vary": "Accept",
    },
  });
}
