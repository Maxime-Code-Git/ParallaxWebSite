import { type LoaderFunctionArgs } from "react-router";
import { Readable } from "node:stream";
import fs from "node:fs";
import { ENV } from "../../lib/env.server";
import {
  type AdminUploadLocation,
  ADMIN_UPLOAD_LOCATIONS,
} from "../../lib/site-content.shared";
import { getRawSiteContent } from "../../lib/site-content.server";
import { verifySecurePathChain } from "../../lib/media-image.server";

const ALLOWED_VARIANTS = new Set(["640p", "960p", "1440p", "1920p"]);
const ALLOWED_EXTS = new Set(["webp", "avif"]);

function isMediaReferencedInActiveContent(imageId: string, location: AdminUploadLocation): boolean {
  try {
    const { content } = getRawSiteContent();
    if (!content) return false;

    const lowerId = imageId.toLowerCase();

    // Check location specific match
    if (location === "showreel_cover" && content.home?.showreel?.coverImageId?.toLowerCase() === lowerId) {
      return true;
    }
    if (location === "duo" && content.home?.duo?.imageId?.toLowerCase() === lowerId) {
      return true;
    }
    if (
      location === "portrait_ludovic" &&
      content.studio?.team?.members?.some(
        (m) => m.id === "ludovic" && m.imageId?.toLowerCase() === lowerId
      )
    ) {
      return true;
    }
    if (
      location === "portrait_maxime" &&
      content.studio?.team?.members?.some(
        (m) => m.id === "maxime" && m.imageId?.toLowerCase() === lowerId
      )
    ) {
      return true;
    }

    // General match in active media map with matching location
    if (content.media && content.media[lowerId] && content.media[lowerId].location === location) {
      // Must also be currently attached to one of the sections
      if (
        content.home?.showreel?.coverImageId?.toLowerCase() === lowerId ||
        content.home?.duo?.imageId?.toLowerCase() === lowerId ||
        content.studio?.team?.members?.some((m) => m.imageId?.toLowerCase() === lowerId)
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const { location, imageId, variant, ext } = params;

  if (!location || !ADMIN_UPLOAD_LOCATIONS.includes(location as AdminUploadLocation)) {
    return new Response("Not Found", { status: 404 });
  }

  if (!imageId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) {
    return new Response("Not Found", { status: 404 });
  }

  if (!variant || !ALLOWED_VARIANTS.has(variant)) {
    return new Response("Not Found", { status: 404 });
  }

  if (!ext || !ALLOWED_EXTS.has(ext)) {
    return new Response("Not Found", { status: 404 });
  }

  // Check that the media is attached to active content
  if (!isMediaReferencedInActiveContent(imageId, location as AdminUploadLocation)) {
    return new Response("Not Found", { status: 404 });
  }

  let mediaBasePath: string;
  try {
    mediaBasePath = ENV.SITE_MEDIA_PATH;
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  let filePath: string;
  try {
    const fileId = `${imageId}-${variant}`;
    const filename = `${fileId}.${ext}`;
    filePath = verifySecurePathChain(
      mediaBasePath,
      ["site", location, imageId, variant, filename],
      "file"
    );
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = await handle.stat();

    if (!stat.isFile()) {
      await handle.close();
      handle = null;
      return new Response("Not Found", { status: 404 });
    }

    const contentType = ext === "webp" ? "image/webp" : "image/avif";
    const etag = `W/"${stat.size.toString(16)}-${stat.mtime.getTime().toString(16)}"`;

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", stat.size.toString());
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("ETag", etag);

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      await handle.close();
      handle = null;
      return new Response(null, { status: 304, headers });
    }

    if (request.method === "HEAD") {
      await handle.close();
      handle = null;
      return new Response(null, { status: 200, headers });
    }

    const stream = handle.createReadStream({ autoClose: true });
    handle = null; // Stream takes ownership of closing the handle

    const webStream = Readable.toWeb(stream);
    return new Response(webStream as ReadableStream, { status: 200, headers });
  } catch {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    return new Response("Not Found", { status: 404 });
  }
}
