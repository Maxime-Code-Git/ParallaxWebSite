import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import yazl from "yazl";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { getGalleryMediaList } from "../../lib/gallery.server";
import { getGalleryOriginalPath } from "../../lib/gallery-preview.server";
import { buildContentDisposition } from "../../lib/media-utils.server";

// Concurrency limiter for ZIP operations to avoid file descriptor / CPU exhaustion
let activeZipCount = 0;
const MAX_CONCURRENT_ZIPS = 3;

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
  const typeParam = url.searchParams.get("type");

  if (typeParam !== "all" && typeParam !== "photos" && typeParam !== "videos") {
    return new Response("Bad Request: type parameter must be 'all', 'photos', or 'videos'", {
      status: 400,
      headers: GALLERY_PRIVATE_HEADERS,
    });
  }

  const { gallery } = await requireGalleryAccess(request, publicId, undefined, true);

  let filterType: "photo" | "video" | undefined;
  if (typeParam === "photos") filterType = "photo";
  else if (typeParam === "videos") filterType = "video";

  const mediaItems = getGalleryMediaList(gallery.id, filterType);

  if (mediaItems.length === 0) {
    return new Response("No media to download for the requested type", {
      status: 404,
      headers: GALLERY_PRIVATE_HEADERS,
    });
  }

  const filesToAdd: { filePath: string; safeName: string }[] = [];
  const usedNames = new Set<string>();

  for (const item of mediaItems) {
    try {
      const filePath = getGalleryOriginalPath(gallery.id, item.id);
      if (fs.existsSync(filePath)) {
        const folder = item.media_type === "photo" ? "Photos" : "Videos";
        const rawBase = path.basename(item.original_filename || "media");
        let safeBase = rawBase.replace(/[\0\r\n/\\]/g, "_").trim();
        if (!safeBase) safeBase = "media";

        let archivePath = `${folder}/${safeBase}`;
        if (usedNames.has(archivePath)) {
          const ext = path.extname(safeBase);
          const stem = path.basename(safeBase, ext);
          let counter = 1;
          while (usedNames.has(`${folder}/${stem}-${counter}${ext}`)) {
            counter++;
          }
          archivePath = `${folder}/${stem}-${counter}${ext}`;
        }

        usedNames.add(archivePath);
        filesToAdd.push({ filePath, safeName: archivePath });
      }
    } catch {
      // Ignore unconfined or missing files
    }
  }

  if (filesToAdd.length === 0) {
    return new Response("No valid files found on disk for download", {
      status: 404,
      headers: GALLERY_PRIVATE_HEADERS,
    });
  }

  const cleanTitle = (gallery.title || "gallery")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);

  const zipFilename = `Parallax-${cleanTitle}-${typeParam}.zip`;
  const contentDisposition = buildContentDisposition("attachment", zipFilename);

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition,
      },
    });
  }

  if (activeZipCount >= MAX_CONCURRENT_ZIPS) {
    return new Response("Service Temporarily Busy: too many zip downloads in progress", {
      status: 503,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Retry-After": "5",
      },
    });
  }

  activeZipCount++;
  let slotReleased = false;
  const releaseSlot = () => {
    if (!slotReleased) {
      slotReleased = true;
      activeZipCount--;
    }
  };

  const zipfile = new yazl.ZipFile();

  for (const f of filesToAdd) {
    // Media files are already compressed (JPEG, PNG, WebP, AVIF, MP4, WebM) -> compress: false
    zipfile.addFile(f.filePath, f.safeName, { compress: false });
  }

  zipfile.end();

  const nodeReadable = Readable.from(zipfile.outputStream as Readable);

  nodeReadable.on("close", releaseSlot);
  nodeReadable.on("end", releaseSlot);
  nodeReadable.on("error", releaseSlot);

  request.signal.addEventListener("abort", () => {
    nodeReadable.destroy();
    releaseSlot();
  });

  const webStream = Readable.toWeb(nodeReadable);

  return new Response(webStream as ReadableStream, {
    status: 200,
    headers: {
      ...GALLERY_PRIVATE_HEADERS,
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition,
    },
  });
}
