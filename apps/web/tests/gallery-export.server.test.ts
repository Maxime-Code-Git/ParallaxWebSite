// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { RouterContextProvider } from "react-router";
import {
  getGalleryDb,
  closeGalleryDb,
} from "../app/lib/gallery-db.server";
import { createGallery } from "../app/lib/gallery.server";
import {
  generateGalleryMetadataExport,
  streamGalleryOriginalsZip,
} from "../app/lib/gallery-export.server";
import { action as exportAction } from "../app/routes/api/admin-gallery-export";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";

function createRouteArgs(request: Request, params: Record<string, string> = {}) {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: new RouterContextProvider(),
    url,
    pattern: url.pathname,
  };
}

describe("Gallery Private Exports (JSON Metadata & Original Media ZIP)", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;
  let galleryId: string;
  let adminCookie: string;
  const csrfToken = "valid-csrf-token-xyz-123";

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-export-test-"));
    testDbPath = path.join(tmpDir, "gallery.sqlite");
    testMediaPath = path.join(tmpDir, "gallery-media");
    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_DB_PATH = testDbPath;
    process.env.GALLERY_MEDIA_PATH = testMediaPath;
    process.env.GALLERY_IMPORT_PATH = path.join(tmpDir, "gallery-import");
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    process.env.ADMIN_SESSION_SECRET = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    process.env.RATE_LIMIT_DB_PATH = path.join(tmpDir, "ratelimit.sqlite");
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long!";

    const { gallery } = createGallery({
      title: "Mariage Exportable",
      clientName: "Sophie & Pierre",
      projectDate: "2026-06-20",
      location: "Château de La Hulpe",
      introFr: "Vos plus beaux souvenirs.",
      introEn: "Your finest memories.",
    });
    galleryId = gallery.id;

    // Add media items to DB and disk
    const db = getGalleryDb();
    const mediaId1 = crypto.randomUUID();
    const mediaId2 = crypto.randomUUID();
    const galDir = path.join(testMediaPath, galleryId);
    fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });

    const photoContent = Buffer.from("fake-photo-binary-data");
    const videoContent = Buffer.from("fake-video-binary-data");
    fs.writeFileSync(path.join(galDir, mediaId1), photoContent);
    fs.writeFileSync(path.join(galDir, mediaId2), videoContent);

    const now = Date.now();
    db.prepare(`
      INSERT INTO gallery_media (
        id, gallery_id, media_type, sort_order, original_filename,
        mime_type, file_size, content_hash, width, height, is_ready, created_at, updated_at
      ) VALUES
        (?, ?, 'photo', 0, 'photo-01.jpg', 'image/jpeg', ?, 'hash-photo-1', 1920, 1080, 1, ?, ?),
        (?, ?, 'video', 1, 'video-01.mp4', 'video/mp4', ?, 'hash-video-1', 1920, 1080, 1, ?, ?)
    `).run(
      mediaId1, galleryId, photoContent.length, now, now,
      mediaId2, galleryId, videoContent.length, now, now
    );

    // Setup admin cookie
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";
    const session = await getSession();
    session.set("adminId", crypto.randomUUID());
    session.set("credentialVersion", computeCredentialVersion());
    session.set("csrfToken", csrfToken);
    session.set("createdAt", Date.now());
    session.set("expiresAt", Date.now() + 8 * 3600 * 1000);
    adminCookie = await commitSession(session);
  });

  afterEach(() => {
    closeGalleryDb();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("generates structured JSON metadata export containing editorial & media inventory without secrets", () => {
    const data = generateGalleryMetadataExport(galleryId);

    expect(data.schemaVersion).toBe(1);
    expect(data.exportedAt).toBeDefined();
    expect(data.gallery.id).toBe(galleryId);
    expect(data.gallery.title).toBe("Mariage Exportable");
    expect(data.gallery.clientName).toBe("Sophie & Pierre");
    expect(data.gallery.location).toBe("Château de La Hulpe");
    expect(data.gallery.introFr).toBe("Vos plus beaux souvenirs.");

    expect(data.media.length).toBe(2);
    expect(data.media[0].originalFilename).toBe("photo-01.jpg");
    expect(data.media[0].contentHash).toBe("hash-photo-1");
    expect(data.media[1].originalFilename).toBe("video-01.mp4");

    // CRITICAL: Ensure sensitive fields are NEVER present in JSON export!
    const jsonStr = JSON.stringify(data);
    expect(jsonStr).not.toContain("code_hash");
    expect(jsonStr).not.toContain("code_encrypted");
    expect(jsonStr).not.toContain("csrfToken");
    expect(jsonStr).not.toContain("adminUser");
    expect(jsonStr).not.toContain("/Users/");
  });

  it("refuses metadata export if deletion is already engaged for the gallery", () => {
    const db = getGalleryDb();
    const now = Date.now();
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, created_at, updated_at)
      VALUES (?, ?, '.trash/gallery-deletions/1', 'pending', ?, ?)
    `).run(crypto.randomUUID(), galleryId, now, now);

    expect(() => generateGalleryMetadataExport(galleryId)).toThrow(/EXPORT_BLOCKED/);
  });

  it("streams original media in ZIP with proper binary header and lazy handles", async () => {
    const controller = new AbortController();
    const response = await streamGalleryOriginalsZip(galleryId, controller.signal);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain("attachment; filename=");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Verify ZIP magic bytes (PK\x03\x04)
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4b); // K
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);
  });

  it("refuses ZIP export if deletion is already engaged for the gallery", async () => {
    const db = getGalleryDb();
    const now = Date.now();
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, created_at, updated_at)
      VALUES (?, ?, '.trash/gallery-deletions/1', 'processing', ?, ?)
    `).run(crypto.randomUUID(), galleryId, now, now);

    const controller = new AbortController();
    const response = await streamGalleryOriginalsZip(galleryId, controller.signal);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toContain("en cours de suppression");
  });

  it("enforces admin authentication, Origin and CSRF on export API endpoint", async () => {
    // 1. Non-POST method -> 405
    const getReq = new Request("http://127.0.0.1:3000/api/admin/data-retention/gallery-export", {
      method: "GET",
      headers: { Cookie: adminCookie },
    });
    const resGet = await exportAction(createRouteArgs(getReq));
    expect(resGet.status).toBe(405);
    expect(resGet.headers.get("Allow")).toBe("POST");

    // 2. Missing admin cookie -> redirects with 303 to /admin
    const anonReq = new Request("http://127.0.0.1:3000/api/admin/data-retention/gallery-export", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://127.0.0.1:3000" },
      body: `galleryId=${galleryId}&exportType=json&csrfToken=${csrfToken}`,
    });
    try {
      await exportAction(createRouteArgs(anonReq));
      expect.unreachable("Should have redirected to login");
    } catch (e: unknown) {
      const res = e as Response;
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/admin");
    }

    // 3. Invalid Origin -> 403
    const badOriginReq = new Request("http://127.0.0.1:3000/api/admin/data-retention/gallery-export", {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://malicious-attacker.com",
      },
      body: `galleryId=${galleryId}&exportType=json&csrfToken=${csrfToken}`,
    });
    const resBadOrigin = await exportAction(createRouteArgs(badOriginReq));
    expect(resBadOrigin.status).toBe(403);

    // 4. Invalid CSRF -> 403
    const badCsrfReq = new Request("http://127.0.0.1:3000/api/admin/data-retention/gallery-export", {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://127.0.0.1:3000",
      },
      body: `galleryId=${galleryId}&exportType=json&csrfToken=wrong-csrf-token`,
    });
    const resBadCsrf = await exportAction(createRouteArgs(badCsrfReq));
    expect(resBadCsrf.status).toBe(403);

    // 5. Valid POST JSON export -> 200
    const validJsonReq = new Request("http://127.0.0.1:3000/api/admin/data-retention/gallery-export", {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://127.0.0.1:3000",
      },
      body: `galleryId=${galleryId}&exportType=json&csrfToken=${csrfToken}`,
    });
    const resJson = await exportAction(createRouteArgs(validJsonReq));
    expect(resJson.status).toBe(200);
    expect(resJson.headers.get("Content-Type")).toContain("application/json");
    expect(resJson.headers.get("Content-Disposition")).toContain("attachment; filename=");
    const parsed = await resJson.json();
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.gallery.id).toBe(galleryId);

    // 6. Valid POST ZIP export -> 200
    const validZipReq = new Request("http://127.0.0.1:3000/api/admin/data-retention/gallery-export", {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://127.0.0.1:3000",
      },
      body: `galleryId=${galleryId}&exportType=zip&csrfToken=${csrfToken}`,
    });
    const resZip = await exportAction(createRouteArgs(validZipReq));
    expect(resZip.status).toBe(200);
    expect(resZip.headers.get("Content-Type")).toBe("application/zip");
    const zipData = await resZip.arrayBuffer();
    expect(zipData.byteLength).toBeGreaterThan(100);
  });
});
