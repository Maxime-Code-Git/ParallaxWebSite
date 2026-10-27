import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";
import { openGalleryDb, closeGalleryDb } from "../app/lib/gallery-db.server";
import { createGallery } from "../app/lib/gallery.server";
import { action, loader } from "../app/routes/api/admin-gallery-upload";
import * as sessionServer from "../app/lib/session.server";
import { ENV } from "../app/lib/env.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

describe("Gallery Upload HTTP API (api/admin-gallery-upload.ts)", () => {
  let tmpDir: string;
  let importBase: string;
  let mediaBase: string;
  let dbPath: string;
  let galleryId: string;
  const validCsrf = "csrf-token-123456";
  let cookieHeader: string;

  beforeEach(async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "parallax-upload-http-test-")));
    importBase = path.join(tmpDir, "imports");
    mediaBase = path.join(tmpDir, "media");
    dbPath = path.join(tmpDir, "gallery.sqlite");

    fs.mkdirSync(importBase, { recursive: true, mode: 0o700 });
    fs.mkdirSync(mediaBase, { recursive: true, mode: 0o700 });

    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$abc$def";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-must-be-32-chars-long";
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long-distinct";
    process.env.RATE_LIMIT_DB_PATH = path.join(tmpDir, "rate-limit.sqlite");
    process.env.PUBLIC_SITE_URL = "https://example.com";
    process.env.GALLERY_DB_PATH = dbPath;
    process.env.GALLERY_IMPORT_PATH = importBase;
    process.env.GALLERY_MEDIA_PATH = mediaBase;
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    vi.spyOn(ENV, "GALLERY_DB_PATH", "get").mockReturnValue(dbPath);
    vi.spyOn(ENV, "GALLERY_IMPORT_PATH", "get").mockReturnValue(importBase);
    vi.spyOn(ENV, "GALLERY_MEDIA_PATH", "get").mockReturnValue(mediaBase);
    vi.spyOn(ENV, "PUBLIC_SITE_URL", "get").mockReturnValue("https://example.com");
    vi.spyOn(ENV, "ADMIN_SESSION_SECRET", "get").mockReturnValue("test-session-secret-must-be-32-chars-long");
    vi.spyOn(ENV, "ADMIN_PASSWORD_HASH", "get").mockReturnValue("$argon2id$v=19$m=19456,t=2,p=1$abc$def");
    vi.spyOn(ENV, "GALLERY_SECRET", "get").mockReturnValue("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    vi.spyOn(ENV, "GALLERY_CODE_ENCRYPTION_KEY", "get").mockReturnValue("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210");
    vi.spyOn(ENV, "RATE_LIMIT_DB_PATH", "get").mockReturnValue(path.join(tmpDir, "rate-limit.sqlite"));

    openGalleryDb(dbPath);

    const { gallery } = createGallery({
      title: "Alice & Bob",
      clientName: "Alice & Bob",
      projectDate: "2026-09-20",
    });
    galleryId = gallery.id;

    const { computeCredentialVersion } = await import("../app/lib/auth.server");
    const session = await sessionServer.getSession();
    session.set("adminId", "123");
    session.set("expiresAt", Date.now() + 3600_000);
    session.set("credentialVersion", computeCredentialVersion());
    session.set("csrfToken", validCsrf);
    cookieHeader = await sessionServer.commitSession(session);
  });

  afterEach(() => {
    closeGalleryDb();
    vi.restoreAllMocks();
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.RATE_LIMIT_SECRET;
    delete process.env.RATE_LIMIT_DB_PATH;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.GALLERY_DB_PATH;
    delete process.env.GALLERY_IMPORT_PATH;
    delete process.env.GALLERY_MEDIA_PATH;
    delete process.env.GALLERY_SECRET;
    delete process.env.GALLERY_CODE_ENCRYPTION_KEY;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Authentication and Security Checks", () => {
    it("rejects unauthenticated requests by redirecting to /admin", async () => {
      const request = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}`, {
        method: "POST",
        headers: {
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
        },
      });

      try {
        await action({ request, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
        expect.unreachable("Should have redirected");
      } catch (err: unknown) {
        expect((err as Response).status).toBe(303);
        expect((err as Response).headers.get("Location")).toBe("/admin");
      }
    });

    it("rejects POST requests with invalid Origin (HTTP 403)", async () => {
      const request = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://evil.com",
          "X-CSRF-Token": validCsrf,
        },
      });

      const response = await action({ request, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(response.status).toBe(403);
    });

    it("rejects POST requests with invalid CSRF token (HTTP 403)", async () => {
      const request = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": "bad-csrf-token",
        },
      });

      const response = await action({ request, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(response.status).toBe(403);
    });

    it("rejects invalid gallery ID format with HTTP 400", async () => {
      const request = new Request("https://example.com/api/admin/gallery-upload/invalid!id!chars", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
        },
      });

      const response = await action({ request, params: { id: "invalid!id!chars" }, context: {} } as unknown as ActionFunctionArgs);
      expect(response.status).toBe(400);
    });
  });

  describe("API Lifecycle: init, status, chunk, finalize, cancel", () => {
    it("executes the full chunked upload cycle via HTTP action", async () => {
      const validJpeg = await sharp({
        create: {
          width: 50,
          height: 50,
          channels: 3,
          background: { r: 0, g: 128, b: 255 },
        },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      const totalSize = validJpeg.length;
      const chunkSize = 500;
      const totalChunks = Math.ceil(totalSize / chunkSize);

      // 1. Init
      const initReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=init`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "init",
          target: "photos",
          fileName: "test-photo.jpg",
          fileSize: totalSize,
          totalChunks,
          chunkSize,
        }),
      });

      const initRes = await action({ request: initReq, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(initRes.status).toBe(200);
      const initData = await initRes.json();
      expect(initData.uploadId).toBeDefined();
      const uploadId = initData.uploadId;

      // 2. Status before chunks
      const statusReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=status&uploadId=${uploadId}`, {
        method: "GET",
        headers: {
          Cookie: cookieHeader,
        },
      });
      const statusRes = await loader({ request: statusReq, params: { id: galleryId }, context: {} } as unknown as LoaderFunctionArgs);
      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();
      expect(statusData.uploadedChunks).toEqual([]);

      // 3. Upload chunks
      for (let c = 0; c < totalChunks; c++) {
        const start = c * chunkSize;
        const end = Math.min(start + chunkSize, totalSize);
        const chunkBlob = validJpeg.subarray(start, end);

        const chunkReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=chunk`, {
          method: "POST",
          headers: {
            Cookie: cookieHeader,
            Origin: "https://example.com",
            "X-CSRF-Token": validCsrf,
            "Content-Type": "application/octet-stream",
            "X-Upload-Id": uploadId,
            "X-Chunk-Index": String(c),
          },
          body: chunkBlob,
          duplex: "half",
        } as RequestInit);

        const chunkRes = await action({ request: chunkReq, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
        expect(chunkRes.status).toBe(200);
      }

      // 4. Finalize
      const finReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=finalize`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "finalize",
          uploadId,
        }),
      });

      const finRes = await action({ request: finReq, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(finRes.status).toBe(200);
      const finData = await finRes.json();
      expect(finData.success).toBe(true);
      expect(finData.fileName).toBe("test-photo.jpg");
    });

    it("cancels an upload session via DELETE or cancel action", async () => {
      const initReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=init`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "init",
          target: "photos",
          fileName: "cancel-me.jpg",
          fileSize: 1000,
          totalChunks: 1,
        }),
      });

      const initRes = await action({ request: initReq, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      const { uploadId } = await initRes.json();

      const cancelReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=cancel&uploadId=${uploadId}`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
        },
      });

      const cancelRes = await action({ request: cancelReq, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(cancelRes.status).toBe(200);

      // Status should now be 404 (session cancelled and removed)
      const statusReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=status&uploadId=${uploadId}`, {
        headers: { Cookie: cookieHeader },
      });
      const statusRes = await loader({ request: statusReq, params: { id: galleryId }, context: {} } as unknown as LoaderFunctionArgs);
      expect(statusRes.status).toBe(404);
    });
  });
});
