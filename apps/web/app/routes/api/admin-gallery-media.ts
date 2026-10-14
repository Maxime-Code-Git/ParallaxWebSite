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
} from "../../lib/gallery-preview.server";
import { parseRangeHeader, parseWidth, openSecureMediaFile } from "../../lib/media-utils.server";
import { ENV } from "../../lib/env.server";

function makeAdminHeaders(extra?: Record<string, string>): Headers {
  const headers = createAdminHeaders();
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      headers.set(k, v);
    }
  }
  return headers;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: makeAdminHeaders({ Allow: "GET, HEAD" }),
    });
  }

  await requireValidAdminSession(request);

  const galleryId = params.id;
  const mediaId = params.mediaId;

  if (!galleryId || !mediaId) {
    return new Response("Bad Request", { status: 400, headers: makeAdminHeaders() });
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
    return new Response("Media not found", { status: 404, headers: makeAdminHeaders() });
  }

  const url = new URL(request.url);
  const isPosterRequest = url.pathname.endsWith("/poster") || url.searchParams.get("poster") === "true";

  // Poster request
  if (isPosterRequest) {
    if (media.media_type !== "video" || !media.poster_revision || media.poster_revision <= 0) {
      return new Response("Poster not found", { status: 404, headers: makeAdminHeaders() });
    }

    let handle: ReturnType<typeof openSecureMediaFile>;
    try {
      handle = openSecureMediaFile(ENV.GALLERY_MEDIA_PATH, [
        galleryId,
        ".posters",
        mediaId,
        `${media.poster_revision}.webp`,
      ]);
    } catch {
      return new Response("Poster not found", { status: 404, headers: makeAdminHeaders() });
    }

    if (request.method === "HEAD") {
      const sizeStr = handle.size.toString();
      handle.close();
      return new Response(null, {
        status: 200,
        headers: makeAdminHeaders({
          "Content-Type": "image/webp",
          "Content-Length": sizeStr,
        }),
      });
    }

    const stream = handle.createReadStream();
    request.signal.addEventListener("abort", () => {
      handle.close();
    });

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: makeAdminHeaders({
        "Content-Type": "image/webp",
        "Content-Length": handle.size.toString(),
      }),
    });
  }

  // Video request
  if (media.media_type === "video") {
    let handle: ReturnType<typeof openSecureMediaFile>;
    try {
      handle = openSecureMediaFile(ENV.GALLERY_MEDIA_PATH, [galleryId, mediaId]);
    } catch {
      return new Response("File not found", { status: 404, headers: makeAdminHeaders() });
    }

    const totalSize = handle.size;
    const rangeHeader = request.headers.get("Range");

    if (rangeHeader !== null) {
      const parsedRange = parseRangeHeader(rangeHeader, totalSize);
      if (!parsedRange) {
        handle.close();
        return new Response(null, {
          status: 416,
          headers: makeAdminHeaders({
            "Content-Range": `bytes */${totalSize}`,
            "Accept-Ranges": "bytes",
          }),
        });
      }

      const { start, end } = parsedRange;
      const chunkSize = end - start + 1;

      if (request.method === "HEAD") {
        handle.close();
        return new Response(null, {
          status: 206,
          headers: makeAdminHeaders({
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize.toString(),
            "Content-Type": media.mime_type,
          }),
        });
      }

      const stream = handle.createReadStream({ start, end });
      request.signal.addEventListener("abort", () => {
        handle.close();
      });

      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: makeAdminHeaders({
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": media.mime_type,
        }),
      });
    }

    if (request.method === "HEAD") {
      handle.close();
      return new Response(null, {
        status: 200,
        headers: makeAdminHeaders({
          "Accept-Ranges": "bytes",
          "Content-Length": totalSize.toString(),
          "Content-Type": media.mime_type,
        }),
      });
    }

    const stream = handle.createReadStream();
    request.signal.addEventListener("abort", () => {
      handle.close();
    });

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: makeAdminHeaders({
        "Accept-Ranges": "bytes",
        "Content-Length": totalSize.toString(),
        "Content-Type": media.mime_type,
      }),
    });
  }

  // Photo preview request
  const widthParam = parseWidth(url.searchParams.get("width")) || 960;

  let originalPath: string;
  try {
    originalPath = getGalleryOriginalPath(galleryId, mediaId);
  } catch {
    return new Response("File not found", { status: 404, headers: makeAdminHeaders() });
  }

  try {
    await ensurePreview(galleryId, mediaId, originalPath, widthParam);
    const handle = openSecureMediaFile(ENV.GALLERY_MEDIA_PATH, [
      galleryId,
      ".previews",
      mediaId,
      `${widthParam}.webp`,
    ]);

    if (request.method === "HEAD") {
      const sizeStr = handle.size.toString();
      handle.close();
      return new Response(null, {
        status: 200,
        headers: makeAdminHeaders({
          "Content-Type": "image/webp",
          "Content-Length": sizeStr,
        }),
      });
    }

    const stream = handle.createReadStream();
    request.signal.addEventListener("abort", () => {
      handle.close();
    });

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: makeAdminHeaders({
        "Content-Type": "image/webp",
        "Content-Length": handle.size.toString(),
      }),
    });
  } catch {
    return new Response("Service Unavailable", { status: 503, headers: makeAdminHeaders() });
  }
}
