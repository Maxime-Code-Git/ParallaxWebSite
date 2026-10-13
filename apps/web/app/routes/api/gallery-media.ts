import fs from "node:fs";
import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import {
  getGalleryOriginalPath,
  ensurePreview,
} from "../../lib/gallery-preview.server";
import { parseRangeHeader, parseWidth, parseFormat } from "../../lib/media-utils.server";

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

  // 1. Video handling
  if (media.media_type === "video") {
    let videoPath: string;
    try {
      videoPath = getGalleryOriginalPath(gallery.id, media.id);
    } catch {
      return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
    }

    if (!fs.existsSync(videoPath)) {
      return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
    }

    let stats: fs.Stats;
    try {
      stats = fs.statSync(videoPath);
    } catch {
      return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
    }

    const totalSize = stats.size;
    const rangeHeader = request.headers.get("Range");

    if (rangeHeader !== null) {
      const parsedRange = parseRangeHeader(rangeHeader, totalSize);
      if (!parsedRange) {
        return new Response(null, {
          status: 416,
          headers: {
            ...GALLERY_PRIVATE_HEADERS,
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
            ...GALLERY_PRIVATE_HEADERS,
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize.toString(),
            "Content-Type": media.mime_type,
          },
        });
      }

      const stream = fs.createReadStream(videoPath, {
        start,
        end,
        flags: "r",
        mode: 0o600,
      });

      request.signal.addEventListener("abort", () => {
        stream.destroy();
      });

      const webStream = Readable.toWeb(stream) as ReadableStream;

      return new Response(webStream, {
        status: 206,
        headers: {
          ...GALLERY_PRIVATE_HEADERS,
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": media.mime_type,
        },
      });
    }

    // No range specified
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          ...GALLERY_PRIVATE_HEADERS,
          "Accept-Ranges": "bytes",
          "Content-Length": totalSize.toString(),
          "Content-Type": media.mime_type,
        },
      });
    }

    const stream = fs.createReadStream(videoPath, { flags: "r", mode: 0o600 });
    request.signal.addEventListener("abort", () => {
      stream.destroy();
    });

    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Accept-Ranges": "bytes",
        "Content-Length": totalSize.toString(),
        "Content-Type": media.mime_type,
      },
    });
  }

  // 2. Photo preview handling (variants only, never original fallback)
  const url = new URL(request.url);
  const widthParam = parseWidth(url.searchParams.get("width"));
  const formatParam = parseFormat(url.searchParams.get("format"));

  if (!widthParam || !formatParam) {
    return new Response("Bad Request: valid width (480, 960, 1920) and format=webp are required", {
      status: 400,
      headers: GALLERY_PRIVATE_HEADERS,
    });
  }

  let originalPath: string;
  try {
    originalPath = getGalleryOriginalPath(gallery.id, media.id);
  } catch {
    return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  if (!fs.existsSync(originalPath)) {
    return new Response("File not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
  }

  try {
    const previewResult = await ensurePreview(gallery.id, media.id, originalPath, widthParam);
    const previewPath = previewResult.path;

    const stats = fs.statSync(previewPath);

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          ...GALLERY_PRIVATE_HEADERS,
          "Content-Type": "image/webp",
          "Content-Length": stats.size.toString(),
          "Cache-Control": "private, max-age=86400, stale-while-revalidate=3600",
        },
      });
    }

    const stream = fs.createReadStream(previewPath, { flags: "r", mode: 0o600 });
    request.signal.addEventListener("abort", () => {
      stream.destroy();
    });

    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Content-Type": "image/webp",
        "Content-Length": stats.size.toString(),
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=3600",
      },
    });
  } catch {
    return new Response("Service Unavailable: image processing busy", {
      status: 503,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Retry-After": "2",
      },
    });
  }
}
