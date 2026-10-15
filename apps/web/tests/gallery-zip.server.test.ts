// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { RouterContextProvider } from "react-router";
import { loader as downloadLoader } from "../app/routes/api/gallery-download";
import {
  getGalleryDb,
  closeGalleryDb,
} from "../app/lib/gallery-db.server";
import { createGallery } from "../app/lib/gallery.server";
import { getGallerySessionStorage } from "../app/lib/gallery-auth.server";

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

describe("gallery-download.ts (ZIP Streaming with yazl)", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;
  let publishedGallery: { id: string; public_id: string };
  let authCookie: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-zip-test-"));
    testDbPath = path.join(tmpDir, "gallery.sqlite");
    testMediaPath = path.join(tmpDir, "gallery-media");
    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_DB_PATH = testDbPath;
    process.env.GALLERY_MEDIA_PATH = testMediaPath;
    process.env.GALLERY_IMPORT_PATH = path.join(tmpDir, "gallery-import");
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    process.env.RATE_LIMIT_DB_PATH = path.join(tmpDir, "ratelimit.sqlite");
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long!";

    const { gallery } = createGallery({
      title: "Mariage Maxime & Julie",
      clientName: "Maxime & Julie",
      projectDate: "2026-06-15",
    });

    publishedGallery = gallery;

    const db = getGalleryDb();
    db.prepare("UPDATE galleries SET status = 'published', expires_at = ? WHERE id = ?").run(
      Date.now() + 86400000,
      gallery.id
    );

    // Setup session cookie
    const now = Date.now();
    const storage = getGallerySessionStorage();
    const session = await storage.getSession();
    session.set("galleryId", gallery.id);
    session.set("codeVersion", 1);
    session.set("issuedAt", now);
    session.set("expiresAt", now + 8 * 3600 * 1000);
    authCookie = await storage.commitSession(session);
  });

  afterEach(() => {
    closeGalleryDb();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects non-GET/HEAD methods with 405 Method Not Allowed", async () => {
    const request = new Request("http://127.0.0.1:3000/api/gallery/pub-id/download?type=all", {
      method: "POST",
      headers: { Cookie: authCookie },
    });

    const response = await downloadLoader(createRouteArgs(request, { publicId: publishedGallery.public_id }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("rejects invalid type parameters with 400 Bad Request", async () => {
    const request = new Request(`http://127.0.0.1:3000/api/gallery/${publishedGallery.public_id}/download?type=invalid`, {
      method: "GET",
      headers: { Cookie: authCookie },
    });

    const response = await downloadLoader(createRouteArgs(request, { publicId: publishedGallery.public_id }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when gallery has no media for the requested type", async () => {
    const request = new Request(`http://127.0.0.1:3000/api/gallery/${publishedGallery.public_id}/download?type=photos`, {
      method: "GET",
      headers: { Cookie: authCookie },
    });

    const response = await downloadLoader(createRouteArgs(request, { publicId: publishedGallery.public_id }));
    expect(response.status).toBe(404);
  });

  it("responds to HEAD request with 200, Content-Type application/zip, and Content-Disposition", async () => {
    const db = getGalleryDb();
    const galDir = path.join(testMediaPath, publishedGallery.id);
    fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });

    const photoId = crypto.randomUUID();
    fs.writeFileSync(path.join(galDir, photoId), "photo-content");
    db.prepare(`
      INSERT INTO gallery_media (id, gallery_id, media_type, sort_order, original_filename, mime_type, file_size, content_hash, is_ready, created_at, updated_at)
      VALUES (?, ?, 'photo', 1, 'photo-01.jpg', 'image/jpeg', 13, 'hash1', 1, ?, ?)
    `).run(photoId, publishedGallery.id, Date.now(), Date.now());

    const request = new Request(`http://127.0.0.1:3000/api/gallery/${publishedGallery.public_id}/download?type=photos`, {
      method: "HEAD",
      headers: { Cookie: authCookie },
    });

    const response = await downloadLoader(createRouteArgs(request, { publicId: publishedGallery.public_id }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain("Parallax-Mariage_Maxime_Julie-photos.zip");
  });

  it("streams valid ZIP archive with photos and videos in Photos/ and Videos/ folders", async () => {
    const db = getGalleryDb();
    const galDir = path.join(testMediaPath, publishedGallery.id);
    fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });

    // Insert 2 photos with identical original filename to test disambiguation
    const photo1Id = crypto.randomUUID();
    const photo2Id = crypto.randomUUID();
    const videoId = crypto.randomUUID();

    fs.writeFileSync(path.join(galDir, photo1Id), "photo1-bytes");
    fs.writeFileSync(path.join(galDir, photo2Id), "photo2-bytes");
    fs.writeFileSync(path.join(galDir, videoId), "video-bytes");

    db.prepare(`
      INSERT INTO gallery_media (id, gallery_id, media_type, sort_order, original_filename, mime_type, file_size, content_hash, is_ready, created_at, updated_at)
      VALUES (?, ?, 'photo', 1, 'photo.jpg', 'image/jpeg', 12, 'h1', 1, ?, ?)
    `).run(photo1Id, publishedGallery.id, Date.now(), Date.now());

    db.prepare(`
      INSERT INTO gallery_media (id, gallery_id, media_type, sort_order, original_filename, mime_type, file_size, content_hash, is_ready, created_at, updated_at)
      VALUES (?, ?, 'photo', 2, 'photo.jpg', 'image/jpeg', 12, 'h2', 1, ?, ?)
    `).run(photo2Id, publishedGallery.id, Date.now(), Date.now());

    db.prepare(`
      INSERT INTO gallery_media (id, gallery_id, media_type, sort_order, original_filename, mime_type, file_size, content_hash, is_ready, created_at, updated_at)
      VALUES (?, ?, 'video', 3, 'film.mp4', 'video/mp4', 11, 'h3', 1, ?, ?)
    `).run(videoId, publishedGallery.id, Date.now(), Date.now());

    const request = new Request(`http://127.0.0.1:3000/api/gallery/${publishedGallery.public_id}/download?type=all`, {
      method: "GET",
      headers: { Cookie: authCookie },
    });

    const response = await downloadLoader(createRouteArgs(request, { publicId: publishedGallery.public_id }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Verify ZIP magic bytes (PK\x03\x04)
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);

    // Verify folder structure and filenames in archive
    const zipString = buffer.toString("utf-8");
    expect(zipString).toContain("Photos/photo.jpg");
    expect(zipString).toContain("Photos/photo-1.jpg"); // disambiguated
    expect(zipString).toContain("Videos/film.mp4");
  }, 20000);

  it("aborts archive creation and releases concurrency slot when client aborts request", async () => {
    const db = getGalleryDb();
    const galDir = path.join(testMediaPath, publishedGallery.id);
    fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });

    const photoId = crypto.randomUUID();
    fs.writeFileSync(path.join(galDir, photoId), Buffer.alloc(1024, 0x5a));
    db.prepare(`
      INSERT INTO gallery_media (id, gallery_id, media_type, sort_order, original_filename, mime_type, file_size, content_hash, is_ready, created_at, updated_at)
      VALUES (?, ?, 'photo', 1, 'abort-test.jpg', 'image/jpeg', 1024, 'hash-abort', 1, ?, ?)
    `).run(photoId, publishedGallery.id, Date.now(), Date.now());

    const abortController = new AbortController();
    const request = new Request(`http://127.0.0.1:3000/api/gallery/${publishedGallery.public_id}/download?type=photos`, {
      method: "GET",
      headers: { Cookie: authCookie },
      signal: abortController.signal,
    });

    const response = await downloadLoader(createRouteArgs(request, { publicId: publishedGallery.public_id }));
    expect(response.status).toBe(200);

    // Abort request
    abortController.abort();

    // The stream should cancel/error on read or terminate
    if (response.body) {
      const reader = response.body.getReader();
      try {
        await reader.read();
      } catch {
        // Expected cancellation / abort
      }
    }

    // Next request succeeds immediately showing slot was cleanly released
    const nextRequest = new Request(`http://127.0.0.1:3000/api/gallery/${publishedGallery.public_id}/download?type=photos`, {
      method: "HEAD",
      headers: { Cookie: authCookie },
    });
    const nextRes = await downloadLoader(createRouteArgs(nextRequest, { publicId: publishedGallery.public_id }));
    expect(nextRes.status).toBe(200);
  }, 20000);
});
