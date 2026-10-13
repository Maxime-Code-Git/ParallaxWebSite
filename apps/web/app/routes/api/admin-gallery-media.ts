import fs from "node:fs";
import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import { getGalleryDb } from "../../lib/gallery-db.server";
import {
  getGalleryOriginalPath,
  ensurePreview,
  getGalleryPosterPath,
} from "../../lib/gallery-preview.server";
import { parseRangeHeader, parseWidth } from "../../lib/media-utils.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...createAdminHeaders(), Allow: "GET, HEAD" },
    });
  }

  await requireValidAdminSession(request);

  const galleryId = params.id;
  const mediaId = params.mediaId;

  if (!galleryId || !mediaId) {
    return new Response("Bad Request", { status: 400, headers: createAdminHeaders() });
  }

  const db = getGalleryDb();
  const media = db.prepare(`
    SELECT id, gallery_id, media_type, mime_type, original_filename, poster_revision
    FROM gallery_media
    WHERE id = ? AND gallery_id = ?
  `).get(mediaId, galleryId) as
    | {
        id: string;
        gallery_id: string;
        media_type: string;
        mime_type: string;
        original_filename: string;
        poster_revision: number;
      }
    | undefined;

  if (!media) {
    return new Response("Media not found", { status: 404, headers: createAdminHeaders() });
  }

  const url = new URL(request.url);
  const isPosterRequest = url.pathname.endsWith("/poster") || url.searchParams.get("poster") === "true";

  // Poster request
  if (isPosterRequest) {
    if (media.media_type !== "video" || !media.poster_revision || media.poster_revision <= 0) {
      return new Response("Poster not found", { status: 404, headers: createAdminHeaders() });
    }

    let posterPath: string;
    try {
      posterPath = getGalleryPosterPath(galleryId, mediaId, media.poster_revision, "webp");
    } catch {
      return new Response("Poster not found", { status: 404, headers: createAdminHeaders() });
    }

    if (!fs.existsSync(posterPath)) {
      return new Response("Poster not found", { status: 404, headers: createAdminHeaders() });
    }

    const stats = fs.statSync(posterPath);
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          ...createAdminHeaders(),
          "Content-Type": "image/webp",
          "Content-Length": stats.size.toString(),
        },
      });
    }

    const stream = fs.createReadStream(posterPath, { flags: "r", mode: 0o600 });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        ...createAdminHeaders(),
        "Content-Type": "image/webp",
        "Content-Length": stats.size.toString(),
      },
    });
  }

  // Video request
  if (media.media_type === "video") {
    let videoPath: string;
    try {
      videoPath = getGalleryOriginalPath(galleryId, mediaId);
    } catch {
      return new Response("File not found", { status: 404, headers: createAdminHeaders() });
    }

    if (!fs.existsSync(videoPath)) {
      return new Response("File not found", { status: 404, headers: createAdminHeaders() });
    }

    const stats = fs.statSync(videoPath);
    const totalSize = stats.size;
    const rangeHeader = request.headers.get("Range");

    if (rangeHeader !== null) {
      const parsedRange = parseRangeHeader(rangeHeader, totalSize);
      if (!parsedRange) {
        return new Response(null, {
          status: 416,
          headers: {
            ...createAdminHeaders(),
            "Content-Range": `bytes */${totalSize}`,
            "Accept-Ranges": "bytes",
          },
        });
      }

      const { start, end } = parsedRange;
      const chunkSize = end - start + 1;

      if (request.method === "HEAD") {
        return new Response(null, {
          status: 206,
          headers: {
            ...createAdminHeaders(),
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize.toString(),
            "Content-Type": media.mime_type,
          },
        });
      }

      const stream = fs.createReadStream(videoPath, { start, end, flags: "r", mode: 0o600 });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...createAdminHeaders(),
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": media.mime_type,
        },
      });
    }

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          ...createAdminHeaders(),
          "Accept-Ranges": "bytes",
          "Content-Length": totalSize.toString(),
          "Content-Type": media.mime_type,
        },
      });
    }

    const stream = fs.createReadStream(videoPath, { flags: "r", mode: 0o600 });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        ...createAdminHeaders(),
        "Accept-Ranges": "bytes",
        "Content-Length": totalSize.toString(),
        "Content-Type": media.mime_type,
      },
    });
  }

  // Photo preview request
  const widthParam = parseWidth(url.searchParams.get("width")) || 960;

  let originalPath: string;
  try {
    originalPath = getGalleryOriginalPath(galleryId, mediaId);
  } catch {
    return new Response("File not found", { status: 404, headers: createAdminHeaders() });
  }

  if (!fs.existsSync(originalPath)) {
    return new Response("File not found", { status: 404, headers: createAdminHeaders() });
  }

  try {
    const previewResult = await ensurePreview(galleryId, mediaId, originalPath, widthParam);
    const stats = fs.statSync(previewResult.path);

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          ...createAdminHeaders(),
          "Content-Type": "image/webp",
          "Content-Length": stats.size.toString(),
        },
      });
    }

    const stream = fs.createReadStream(previewResult.path, { flags: "r", mode: 0o600 });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        ...createAdminHeaders(),
        "Content-Type": "image/webp",
        "Content-Length": stats.size.toString(),
      },
    });
  } catch {
    return new Response("Service Unavailable", { status: 503, headers: createAdminHeaders() });
  }
}
