import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { LoaderFunctionArgs } from "react-router";
import { loader as mediaLoader } from "../app/routes/media/site-variant";
import { saveSiteMediaUpdate, getRawSiteContent } from "../app/lib/site-content.server";

describe("site-variant.ts media route", () => {
  let tempDir: string;
  let testContentFile: string;
  let testMediaDir: string;
  const originalEnv = process.env;

  const makeLoaderArgs = (req: Request, params: Record<string, string | undefined>): LoaderFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as LoaderFunctionArgs;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-media-route-test-"));
    testContentFile = path.join(tempDir, "site-content.json");
    testMediaDir = path.join(tempDir, "site-media");
    fs.mkdirSync(testMediaDir, { mode: 0o700, recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SITE_CONTENT_PATH: testContentFile,
      SITE_MEDIA_PATH: testMediaDir,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects non-GET and non-HEAD methods with 405", async () => {
    const req = new Request("http://localhost:3000/media/site/showreel_cover/123/640p/webp", {
      method: "POST",
    });
    const res = await mediaLoader(makeLoaderArgs(req, {
      location: "showreel_cover",
      imageId: "11111111-1111-4111-8111-111111111111",
      variant: "640p",
      ext: "webp",
    }));

    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("returns 404 for unknown location", async () => {
    const req = new Request("http://localhost:3000/media/site/unknown/11111111-1111-4111-8111-111111111111/640p/webp");
    const res = await mediaLoader(makeLoaderArgs(req, {
      location: "unknown",
      imageId: "11111111-1111-4111-8111-111111111111",
      variant: "640p",
      ext: "webp",
    }));

    expect(res.status).toBe(404);
  });

  it("returns 404 for invalid imageId format (not UUID)", async () => {
    const req = new Request("http://localhost:3000/media/site/showreel_cover/not-a-uuid/640p/webp");
    const res = await mediaLoader(makeLoaderArgs(req, {
      location: "showreel_cover",
      imageId: "not-a-uuid",
      variant: "640p",
      ext: "webp",
    }));

    expect(res.status).toBe(404);
  });

  it("returns 404 for invalid variant or extension", async () => {
    const req1 = new Request("http://localhost:3000/media/site/showreel_cover/11111111-1111-4111-8111-111111111111/100p/webp");
    const res1 = await mediaLoader(makeLoaderArgs(req1, {
      location: "showreel_cover",
      imageId: "11111111-1111-4111-8111-111111111111",
      variant: "100p",
      ext: "webp",
    }));
    expect(res1.status).toBe(404);

    const req2 = new Request("http://localhost:3000/media/site/showreel_cover/11111111-1111-4111-8111-111111111111/640p/exe");
    const res2 = await mediaLoader(makeLoaderArgs(req2, {
      location: "showreel_cover",
      imageId: "11111111-1111-4111-8111-111111111111",
      variant: "640p",
      ext: "exe",
    }));
    expect(res2.status).toBe(404);
  });

  it("returns 404 for media not referenced in active content", async () => {
    const unreferencedId = "11111111-1111-4111-8111-111111111111";
    const req = new Request(`http://localhost:3000/media/site/showreel_cover/${unreferencedId}/640p/webp`);
    const res = await mediaLoader(makeLoaderArgs(req, {
      location: "showreel_cover",
      imageId: unreferencedId,
      variant: "640p",
      ext: "webp",
    }));

    expect(res.status).toBe(404);
  });

  it("serves variant file when referenced in active content with correct headers and ETag", async () => {
    const validImageId = "a1b2c3d4-1111-4111-8111-111111111111";

    const { content } = getRawSiteContent();
    saveSiteMediaUpdate(
      "showreel_cover",
      {
        imageId: validImageId,
        location: "showreel_cover",
        originalWidth: 1920,
        originalHeight: 1080,
        variants: [
          {
            name: "640p",
            width: 640,
            height: 360,
            sizeBytesWebp: 12,
            sizeBytesAvif: 10,
            fileId: `${validImageId}-640p`,
          },
        ],
        createdAt: new Date().toISOString(),
      },
      content.revision
    );

    // Create the actual variant file on disk
    const variantDir = path.join(testMediaDir, "site", "showreel_cover", validImageId, "640p");
    fs.mkdirSync(variantDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(variantDir, `${validImageId}-640p.webp`);
    fs.writeFileSync(filePath, "test-content", { mode: 0o600 });

    const req = new Request(`http://localhost:3000/media/site/showreel_cover/${validImageId}/640p/webp`);
    const res = await mediaLoader(makeLoaderArgs(req, {
      location: "showreel_cover",
      imageId: validImageId,
      variant: "640p",
      ext: "webp",
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const etag = res.headers.get("ETag");
    expect(etag).toBeTruthy();

    const text = await res.text();
    expect(text).toBe("test-content");

    // Test 304 Not Modified when ETag matches
    const condReq = new Request(`http://localhost:3000/media/site/showreel_cover/${validImageId}/640p/webp`, {
      headers: { "If-None-Match": etag! },
    });
    const condRes = await mediaLoader(makeLoaderArgs(condReq, {
      location: "showreel_cover",
      imageId: validImageId,
      variant: "640p",
      ext: "webp",
    }));
    expect(condRes.status).toBe(304);

    // Test HEAD request
    const headReq = new Request(`http://localhost:3000/media/site/showreel_cover/${validImageId}/640p/webp`, {
      method: "HEAD",
    });
    const headRes = await mediaLoader(makeLoaderArgs(headReq, {
      location: "showreel_cover",
      imageId: validImageId,
      variant: "640p",
      ext: "webp",
    }));
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("Content-Type")).toBe("image/webp");
    const headBody = await headRes.text();
    expect(headBody).toBe("");
  });
});
