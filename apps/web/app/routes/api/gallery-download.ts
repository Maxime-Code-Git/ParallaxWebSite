import path from "node:path";
import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import yazl from "yazl";
import { ENV } from "../../lib/env.server";
import {
  requireGalleryAccess,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { getGalleryMediaList } from "../../lib/gallery.server";
import {
  openSecureMediaFile,
  buildContentDisposition,
  type SecureMediaHandle,
} from "../../lib/media-utils.server";

// Concurrency limiter for ZIP operations to avoid file descriptor / memory exhaustion
let activeZipCount = 0;
const MAX_CONCURRENT_ZIPS = 3;

/**
 * Creates a lazy Readable stream that only verifies path chain and opens file descriptor
 * when yazl actually begins pulling bytes for that specific entry.
 * Strictly enforces O_NOFOLLOW and guarantees immediate descriptor closure on abort.
 */
function createLazySecureEntryStream(
  baseMedia: string,
  galleryId: string,
  mediaId: string,
  expectedSize: number,
  signal: AbortSignal
): Readable {
  let handle: SecureMediaHandle | null = null;
  let fileStream: ReturnType<SecureMediaHandle["createReadStream"]> | null = null;
  let isClosed = false;

  const cleanup = () => {
    if (!isClosed) {
      isClosed = true;
      const fs = fileStream;
      fileStream = null;
      if (fs && !fs.destroyed && !fs.closed) {
        fs.destroy();
      }
      if (handle) {
        handle.close();
        handle = null;
      }
    }
  };

  const stream = new Readable({
    read() {
      if (isClosed || signal.aborted) {
        cleanup();
        this.push(null);
        return;
      }

      if (!handle) {
        try {
          handle = openSecureMediaFile(baseMedia, [galleryId, mediaId]);
          if (expectedSize > 0 && handle.size !== expectedSize) {
            cleanup();
            this.destroy(new Error("File size mismatch"));
            return;
          }

          fileStream = handle.createReadStream();
          fileStream.on("data", (chunk) => {
            if (!this.push(chunk)) {
              fileStream?.pause();
            }
          });
          fileStream.on("end", () => {
            this.push(null);
          });
          fileStream.on("close", () => {
            isClosed = true;
            fileStream = null;
            if (handle) {
              handle.close();
              handle = null;
            }
          });
          fileStream.on("error", (err) => {
            cleanup();
            if (!this.destroyed) {
              this.destroy(err);
            }
          });
        } catch (err) {
          cleanup();
          if (!this.destroyed) {
            this.destroy(err instanceof Error ? err : new Error(String(err)));
          }
          return;
        }
      } else if (fileStream?.isPaused()) {
        fileStream.resume();
      }
    },
    destroy(err, cb) {
      cleanup();
      cb(err);
    },
  });

  if (signal.aborted) {
    cleanup();
    stream.destroy();
  } else {
    signal.addEventListener(
      "abort",
      () => {
        cleanup();
        stream.destroy();
      },
      { once: true }
    );
  }

  return stream;
}

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

  const baseMedia = path.resolve(ENV.GALLERY_MEDIA_PATH);
  const filesToAdd: { mediaId: string; safeName: string; size: number }[] = [];
  const usedNames = new Set<string>();

  for (const item of mediaItems) {
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
    filesToAdd.push({ mediaId: item.id, safeName: archivePath, size: item.file_size });
  }

  const cleanTitle = (gallery.title || "gallery")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);

  const zipFilename = `Parallax-${cleanTitle}-${typeParam}.zip`;
  const contentDisposition = buildContentDisposition("attachment", zipFilename);

  // HEAD returns headers without acquiring slot or initiating ZIP processing
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

  try {
    const zipfile = new yazl.ZipFile();

    for (const f of filesToAdd) {
      const entryStream = createLazySecureEntryStream(
        baseMedia,
        gallery.id,
        f.mediaId,
        f.size,
        request.signal
      );
      zipfile.addReadStream(entryStream, f.safeName, { compress: false, size: f.size });
    }

    zipfile.end();

    const outputStream = zipfile.outputStream as Readable;

    outputStream.on("close", releaseSlot);
    outputStream.on("end", releaseSlot);
    outputStream.on("error", releaseSlot);

    // Ensure slot release and total producer teardown on abort
    request.signal.addEventListener(
      "abort",
      () => {
        if (typeof outputStream.destroy === "function") {
          outputStream.destroy();
        }
        releaseSlot();
      },
      { once: true }
    );

    const webStream = Readable.toWeb(outputStream);

    return new Response(webStream as ReadableStream, {
      status: 200,
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition,
      },
    });
  } catch (err) {
    releaseSlot();
    throw err;
  }
}
