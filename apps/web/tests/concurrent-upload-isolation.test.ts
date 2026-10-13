import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import type { ActionFunctionArgs } from "react-router";
import { action as uploadAction } from "../app/routes/api/admin-media-upload";
import {
  processSiteMediaImage,
  imageProcessingLimiter,
} from "../app/lib/media-image.server";
import { getRawSiteContent } from "../app/lib/site-content.server";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";

describe("Concurrent Upload Isolation, Limiter 503, and Content-Length", () => {
  let tempDir: string;
  let testContentFile: string;
  let testDbFile: string;
  let testMediaDir: string;
  let workDir: string;
  const originalEnv = process.env;

  const makeActionArgs = (req: Request): ActionFunctionArgs =>
    ({
      request: req,
      params: {},
      context: {} as never,
    }) as unknown as ActionFunctionArgs;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-concurrent-test-"));
    testContentFile = path.join(tempDir, "site-content.json");
    testDbFile = path.join(tempDir, "rate-limit.sqlite");
    testMediaDir = path.join(tempDir, "site-media");
    workDir = path.join(tempDir, "work");

    fs.mkdirSync(testMediaDir, { mode: 0o700, recursive: true });
    fs.mkdirSync(workDir, { mode: 0o700, recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      RATE_LIMIT_SECRET: "rate-limit-secret-min-32-chars-long-2!",
      RATE_LIMIT_DB_PATH: testDbFile,
      SITE_CONTENT_PATH: testContentFile,
      SITE_MEDIA_PATH: testMediaDir,
      TRUST_PROXY: "false",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createValidAdminCookie(csrfToken = "test-csrf-token"): Promise<string> {
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    session.set("csrfToken", csrfToken);
    return commitSession(session);
  }

  async function createTestImageFile(fileName: string): Promise<string> {
    const filePath = path.join(workDir, fileName);
    const buffer = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    fs.writeFileSync(filePath, buffer, { mode: 0o600 });
    return filePath;
  }

  async function createMultipartBody(
    fileName: string,
    fileBuffer: Buffer
  ): Promise<{ body: Uint8Array; boundary: string }> {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const total = Buffer.concat([head, fileBuffer, tail]);
    return { body: new Uint8Array(total), boundary };
  }

  describe("Deterministic parallel upload staging isolation", () => {
    it("suspends upload 1 after creating staging files, upload 2 completes and cleans up, upload 1 is not purged", async () => {
      const img1Path = await createTestImageFile("img1.jpg");
      const img2Path = await createTestImageFile("img2.jpg");

      // 1. Upload 1 processes image into staging
      const upload1Meta = await processSiteMediaImage(
        img1Path,
        workDir,
        "duo",
        testMediaDir
      );

      expect(fs.existsSync(upload1Meta.stagingDir)).toBe(true);
      const upload1Webp = path.join(upload1Meta.stagingDir, "640p", `${upload1Meta.imageId}-640p.webp`);
      expect(fs.existsSync(upload1Webp)).toBe(true);

      // 2. Upload 2 runs in parallel, completes publication and cleans up
      const cookie = await createValidAdminCookie();
      const initial = getRawSiteContent();

      const img2Buffer = fs.readFileSync(img2Path);
      const { body, boundary } = await createMultipartBody("img2.jpg", img2Buffer);

      const req2 = new Request(
        "http://localhost:3000/api/admin/media-upload",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "http://localhost:3000",
            "x-csrf-token": "test-csrf-token",
            "x-media-location": "showreel_cover",
            "x-content-revision": initial.content.revision,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length.toString(),
          },
          body: body as unknown as BodyInit,
          duplex: "half",
        } as RequestInit
      );

      const res2 = await uploadAction(makeActionArgs(req2));
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.success).toBe(true);

      // Verify Upload 2 was published to site/showreel_cover/<imageId>
      const upload2Dir = path.join(testMediaDir, "site", "showreel_cover", json2.imageId);
      expect(fs.existsSync(upload2Dir)).toBe(true);

      // 3. Crucial verification: Upload 1's staging files MUST NOT have been purged by Upload 2's cleanup!
      expect(fs.existsSync(upload1Meta.stagingDir)).toBe(true);
      expect(fs.existsSync(upload1Webp)).toBe(true);

      // 4. Now simulate Upload 1 attempting to publish with its now-outdated initial revision
      // (as in the case of a revision conflict)
      const { content: currentAfterUpload2 } = getRawSiteContent();
      expect(currentAfterUpload2.revision).not.toBe(initial.content.revision);

      // Re-run an action attempt with stale revision
      const img1Buffer = fs.readFileSync(img1Path);
      const { body: body1, boundary: boundary1 } = await createMultipartBody("img1.jpg", img1Buffer);

      const req1Stale = new Request(
        "http://localhost:3000/api/admin/media-upload",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "http://localhost:3000",
            "x-csrf-token": "test-csrf-token",
            "x-media-location": "duo",
            "x-content-revision": initial.content.revision, // Stale!
            "Content-Type": `multipart/form-data; boundary=${boundary1}`,
            "Content-Length": body1.length.toString(),
          },
          body: body1 as unknown as BodyInit,
          duplex: "half",
        } as RequestInit
      );

      const res1 = await uploadAction(makeActionArgs(req1Stale));
      expect(res1.status).toBe(409);
      const json1 = await res1.json();
      expect(json1.conflict).toBe(true);
      expect(json1.latestRevision).toBe(currentAfterUpload2.revision);

      // Verify Upload 2's media files were NOT touched or corrupted by Upload 1's 409
      expect(fs.existsSync(upload2Dir)).toBe(true);
    });
  });

  describe("Limiter saturation returns HTTP 503 with Retry-After: 2", () => {
    it("returns 503 and Retry-After header when ConcurrencyLimiter is saturated", async () => {
      const cookie = await createValidAdminCookie();
      const initial = getRawSiteContent();

      // Saturate the limiter with 2 concurrent tasks
      let release1: () => void;
      let release2: () => void;

      const task1 = imageProcessingLimiter.run(() => new Promise((resolve) => { release1 = resolve as () => void; }));
      const task2 = imageProcessingLimiter.run(() => new Promise((resolve) => { release2 = resolve as () => void; }));

      try {
        expect(imageProcessingLimiter.getActiveCount()).toBe(2);

        // 3rd request to upload action must receive 503 Service Unavailable
        const imgPath = await createTestImageFile("test.jpg");
        const imgBuffer = fs.readFileSync(imgPath);
        const { body, boundary } = await createMultipartBody("test.jpg", imgBuffer);

        const req = new Request(
          "http://localhost:3000/api/admin/media-upload",
          {
            method: "POST",
            headers: {
              Cookie: cookie,
              Origin: "http://localhost:3000",
              "x-csrf-token": "test-csrf-token",
              "x-media-location": "showreel_cover",
              "x-content-revision": initial.content.revision,
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Content-Length": body.length.toString(),
            },
            body: body as unknown as BodyInit,
            duplex: "half",
          } as RequestInit
        );

        const res = await uploadAction(makeActionArgs(req));
        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("2");
        const json = await res.json();
        expect(json.error).toMatch(/Trop de traitements d'images/);
      } finally {
        release1!();
        release2!();
        await Promise.all([task1, task2]);
      }
    });
  });

  describe("Strict decimal Content-Length validation", () => {
    it("rejects non-decimal and partially numeric Content-Length with 400", async () => {
      const cookie = await createValidAdminCookie();
      const initial = getRawSiteContent();

      const invalidValues = ["123abc", "+500", "12.34", "0x10", "10e5", "   ", "abc"];

      for (const val of invalidValues) {
        const req = new Request(
          "http://localhost:3000/api/admin/media-upload",
          {
            method: "POST",
            headers: {
              Cookie: cookie,
              Origin: "http://localhost:3000",
              "x-csrf-token": "test-csrf-token",
              "x-media-location": "showreel_cover",
              "x-content-revision": initial.content.revision,
              "Content-Type": "multipart/form-data; boundary=test",
              "Content-Length": val,
            },
          }
        );

        const res = await uploadAction(makeActionArgs(req));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/Content-Length invalide/);
      }
    });

    it("rejects Content-Length exceeding maximum file size with 413", async () => {
      const cookie = await createValidAdminCookie();
      const initial = getRawSiteContent();

      const oversized = (30 * 1024 * 1024).toString(); // 30 MiB

      const req = new Request(
        "http://localhost:3000/api/admin/media-upload",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "http://localhost:3000",
            "x-csrf-token": "test-csrf-token",
            "x-media-location": "showreel_cover",
            "x-content-revision": initial.content.revision,
            "Content-Type": "multipart/form-data; boundary=test",
            "Content-Length": oversized,
          },
        }
      );

      const res = await uploadAction(makeActionArgs(req));
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toMatch(/taille maximale/);
    });
  });
});
