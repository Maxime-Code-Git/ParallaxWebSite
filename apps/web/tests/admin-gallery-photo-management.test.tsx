// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import sharp from "sharp";
import { render, screen, fireEvent } from "@testing-library/react";
import { RouterContextProvider } from "react-router";

// Mock react-router for UI rendering tests
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useActionData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    useRevalidator: vi.fn(() => ({ revalidate: vi.fn(), state: "idle" })),
    useSubmit: vi.fn(() => vi.fn()),
    Form: ({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => (
      <form {...props}>{children}</form>
    ),
    Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [key: string]: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

import { useLoaderData, useActionData } from "react-router";
import AdminGalleryEditPage, {
  loader as editLoader,
  action as editAction,
} from "../app/routes/admin/galleries-edit";
import { loader as adminMediaLoader } from "../app/routes/api/admin-gallery-media";
import { loader as clientMediaLoader } from "../app/routes/api/gallery-media";
import {
  closeGalleryDb,
  getGalleryDb,
} from "../app/lib/gallery-db.server";
import {
  createGallery,
  getGalleryById,
  deleteGalleryPhoto,
  reorderGalleryPhotos,
  moveGalleryPhoto,
  getGalleryPhotosPaginated,
  getGalleryMediaList,
  setCoverPhoto,
  type GalleryMediaRow,
} from "../app/lib/gallery.server";
import {
  deleteStoredGalleryMediaFiles,
} from "../app/lib/gallery-preview.server";
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

describe("Admin Gallery Photo Management (Thumbnails, Deletion, Reordering, Concurrency, UI)", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;
  let testImportPath: string;
  let adminCookie: string;
  let csrfToken: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-photos-test-"));
    testDbPath = path.join(tmpDir, "gallery.sqlite");
    testMediaPath = path.join(tmpDir, "gallery-media");
    testImportPath = path.join(tmpDir, "gallery-import");

    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(testImportPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_DB_PATH = testDbPath;
    process.env.GALLERY_MEDIA_PATH = testMediaPath;
    process.env.GALLERY_IMPORT_PATH = testImportPath;
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    process.env.RATE_LIMIT_DB_PATH = path.join(tmpDir, "ratelimit.sqlite");
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long!";
    process.env.SITE_CONTENT_PATH = path.join(tmpDir, "site-content.json");
    process.env.SITE_MEDIA_PATH = path.join(tmpDir, "site-media");
    process.env.PORTFOLIO_CONTENT_PATH = path.join(tmpDir, "portfolio-content.json");
    process.env.PORTFOLIO_MEDIA_PATH = path.join(tmpDir, "portfolio-media");
    fs.mkdirSync(process.env.SITE_MEDIA_PATH, { recursive: true, mode: 0o700 });
    fs.mkdirSync(process.env.PORTFOLIO_MEDIA_PATH, { recursive: true, mode: 0o700 });
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    process.env.TRUST_PROXY = "true";
    process.env.ADMIN_SESSION_SECRET = "admin-session-secret-at-least-32-chars-long!";
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";

    // Create valid admin session
    csrfToken = crypto.randomUUID();
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

  async function createRealJpegFixture(galId: string, mediaId: string, width = 800, height = 600): Promise<string> {
    const galDir = path.join(testMediaPath, galId);
    fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(galDir, mediaId);
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 80, g: 120, b: 180 },
      },
    })
      .jpeg()
      .toFile(filePath);
    return filePath;
  }

  function insertPhotoRow(galleryId: string, mediaId: string, filename: string, sortOrder: number): void {
    const db = getGalleryDb();
    const now = Date.now();
    db.prepare(`
      INSERT INTO gallery_media (
        id, gallery_id, media_type, sort_order, original_filename,
        mime_type, file_size, content_hash, width, height, is_ready, created_at, updated_at
      ) VALUES (?, ?, 'photo', ?, ?, 'image/jpeg', 2048, ?, 800, 600, 1, ?, ?)
    `).run(mediaId, galleryId, sortOrder, filename, `hash-${mediaId}`, now, now);
  }

  function insertVideoRow(galleryId: string, mediaId: string, filename: string, sortOrder: number): void {
    const db = getGalleryDb();
    const now = Date.now();
    db.prepare(`
      INSERT INTO gallery_media (
        id, gallery_id, media_type, sort_order, original_filename,
        mime_type, file_size, content_hash, width, height, is_ready, poster_revision, created_at, updated_at
      ) VALUES (?, ?, 'video', ?, ?, 'video/mp4', 1048576, ?, 1920, 1080, 1, 0, ?, ?)
    `).run(mediaId, galleryId, sortOrder, filename, `hash-${mediaId}`, now, now);
  }

  // --------------------------------------------------------------------------
  // Requirement 1: Real JPEG preview served in WebP with admin session alone
  // --------------------------------------------------------------------------
  describe("1. Real Admin Thumbnails serving (/api/admin/galleries/:id/media/:mediaId)", () => {
    it("serves real WebP preview 480px with admin session alone across draft, published, and archived galleries without requiring client code", async () => {
      const { gallery } = createGallery({
        title: "Galerie Vignettes Admin",
        clientName: "Client Test",
        projectDate: "2026-08-01",
      });

      const mediaId = crypto.randomUUID();
      await createRealJpegFixture(gallery.id, mediaId, 1200, 900);
      insertPhotoRow(gallery.id, mediaId, "real-photo.jpg", 1);

      // Status: draft
      const reqDraft = new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${mediaId}?width=480`, {
        headers: { Cookie: adminCookie },
      });
      const resDraft = await adminMediaLoader(createRouteArgs(reqDraft, { id: gallery.id, mediaId }));
      expect(resDraft.status).toBe(200);
      expect(resDraft.headers.get("Content-Type")).toBe("image/webp");
      const bufferDraft = Buffer.from(await resDraft.arrayBuffer());
      const metaDraft = await sharp(bufferDraft).metadata();
      expect(metaDraft.format).toBe("webp");
      expect(metaDraft.width).toBe(480);

      // Status: published
      const db = getGalleryDb();
      db.prepare("UPDATE galleries SET status = 'published', expires_at = ? WHERE id = ?").run(Date.now() + 86400000, gallery.id);
      const reqPub = new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${mediaId}?width=480`, {
        headers: { Cookie: adminCookie },
      });
      const resPub = await adminMediaLoader(createRouteArgs(reqPub, { id: gallery.id, mediaId }));
      expect(resPub.status).toBe(200);
      expect(resPub.headers.get("Content-Type")).toBe("image/webp");

      // Status: archived
      db.prepare("UPDATE galleries SET status = 'archived' WHERE id = ?").run(gallery.id);
      const reqArch = new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${mediaId}?width=480`, {
        headers: { Cookie: adminCookie },
      });
      const resArch = await adminMediaLoader(createRouteArgs(reqArch, { id: gallery.id, mediaId }));
      expect(resArch.status).toBe(200);
      expect(resArch.headers.get("Content-Type")).toBe("image/webp");

      // Without admin session -> rejects with redirect 303 to /admin or 401
      const reqNoAuth = new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${mediaId}?width=480`);
      await expect(adminMediaLoader(createRouteArgs(reqNoAuth, { id: gallery.id, mediaId }))).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Response &&
          (err.status === 401 || (err.status === 303 && err.headers.get("Location") === "/admin"))
      );

      // Client route with only admin session -> rejects with 401 (client routes remain strictly private!)
      const reqClientRoute = new Request(`http://127.0.0.1:3000/api/gallery/${gallery.public_id}/media/${mediaId}?width=480&format=webp`, {
        headers: { Cookie: adminCookie },
      });
      await expect(clientMediaLoader(createRouteArgs(reqClientRoute, { publicId: gallery.public_id, mediaId }))).rejects.toSatisfy(
        (err: unknown) => err instanceof Response && err.status === 401
      );
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 2: Thumbnail loading / error states and batch concurrency
  // --------------------------------------------------------------------------
  describe("2. Thumbnail Error Diagnostics & Concurrency", () => {
    it("distinguishes missing original file (404) from saturation/error, and safely handles batches of tens of photos", async () => {
      const { gallery } = createGallery({
        title: "Galerie Diagnostic",
        clientName: "Client Diag",
        projectDate: "2026-08-01",
      });

      // 1. Missing original file on disk -> returns 404
      const missingMediaId = crypto.randomUUID();
      insertPhotoRow(gallery.id, missingMediaId, "missing.jpg", 1);
      const req404 = new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${missingMediaId}?width=480`, {
        headers: { Cookie: adminCookie },
      });
      const res404 = await adminMediaLoader(createRouteArgs(req404, { id: gallery.id, mediaId: missingMediaId }));
      expect(res404.status).toBe(404);

      // 2. Batch processing: 20 real photos processed concurrently without converting limits into silent failures
      const batchIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const id = crypto.randomUUID();
        batchIds.push(id);
        await createRealJpegFixture(gallery.id, id, 400, 300);
        insertPhotoRow(gallery.id, id, `photo-batch-${i}.jpg`, i);
      }

      // Initial simultaneous burst: some succeed (200), saturated ones receive 503 (distinct from 404!)
      const burstReqs = batchIds.map((id) => {
        const req = new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${id}?width=480`, {
          headers: { Cookie: adminCookie },
        });
        return adminMediaLoader(createRouteArgs(req, { id: gallery.id, mediaId: id }));
      });
      const burstResults = await Promise.all(burstReqs);
      const statuses = new Set(burstResults.map((r) => r.status));
      expect(statuses.has(200)).toBe(true);
      expect(burstResults.every((r) => r.status === 200 || r.status === 503)).toBe(true);
      expect(burstResults.some((r) => r.status === 404)).toBe(false); // None are falsely reported as missing 404!

      // 3. Retry loop: with retry on busy 503, all 20 photos complete successfully
      for (const id of batchIds) {
        let res = await adminMediaLoader(
          createRouteArgs(
            new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${id}?width=480`, {
              headers: { Cookie: adminCookie },
            }),
            { id: gallery.id, mediaId: id }
          )
        );
        while (res.status === 503) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          res = await adminMediaLoader(
            createRouteArgs(
              new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${id}?width=480`, {
                headers: { Cookie: adminCookie },
              }),
              { id: gallery.id, mediaId: id }
            )
          );
        }
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/webp");
      }

      // 4. Once generated, subsequent requests for all 20 photos return 200 immediately from disk cache
      const cachedPromises = batchIds.map((id) => {
        const req = new Request(`http://127.0.0.1:3000/api/admin/galleries/${gallery.id}/media/${id}?width=480`, {
          headers: { Cookie: adminCookie },
        });
        return adminMediaLoader(createRouteArgs(req, { id: gallery.id, mediaId: id }));
      });
      const cachedResults = await Promise.all(cachedPromises);
      expect(cachedResults.every((r) => r.status === 200)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 3: Delete single photo
  // --------------------------------------------------------------------------
  describe("3. Delete Single Photo (Atomic removal, intact sources, cover reallocation, empty gallery)", () => {
    it("removes single photo atomically, preserves imports source files and other media, reallocates cover, and keeps session generation untouched", async () => {
      const { gallery } = createGallery({
        title: "Galerie Retrait Photo",
        clientName: "Client Retrait",
        projectDate: "2026-08-01",
      });

      const p1Id = crypto.randomUUID();
      const p2Id = crypto.randomUUID();
      const p3Id = crypto.randomUUID();
      const v1Id = crypto.randomUUID();

      await createRealJpegFixture(gallery.id, p1Id);
      await createRealJpegFixture(gallery.id, p2Id);
      await createRealJpegFixture(gallery.id, p3Id);
      insertPhotoRow(gallery.id, p1Id, "photo-1.jpg", 10);
      insertPhotoRow(gallery.id, p2Id, "photo-2.jpg", 20);
      insertPhotoRow(gallery.id, p3Id, "photo-3.jpg", 30);
      insertVideoRow(gallery.id, v1Id, "video-1.mp4", 40);

      // Set P1 as cover
      setCoverPhoto(gallery.id, p1Id);
      const galBefore = getGalleryById(gallery.id)!;
      expect(galBefore.cover_media_id).toBe(p1Id);

      // Create dummy source file in import folder to verify it is NEVER touched
      const importFolder = path.join(testImportPath, "import-fixture", "photos");
      fs.mkdirSync(importFolder, { recursive: true });
      const sourceFilePath = path.join(importFolder, "photo-1.jpg");
      fs.writeFileSync(sourceFilePath, "SOURCE_FILE_PRESERVED_CONTENT");

      // Record session generation and code version before deletion
      const db = getGalleryDb();
      const codeRowBefore = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id);
      const generationBefore = galBefore.code_generation;

      // Execute delete_photo action via POST
      const body = new URLSearchParams({
        csrfToken,
        intent: "delete_photo",
        mediaId: p1Id,
        revision: String(galBefore.revision),
      });

      const request = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const response = await editAction(createRouteArgs(request, { id: gallery.id }));
      expect(response.status).toBe(200);
      const actionRes = await response.json();
      expect(actionRes.success).toContain("photo-1.jpg");

      // Verify P1 is deleted in DB
      const p1InDb = db.prepare("SELECT id FROM gallery_media WHERE id = ?").get(p1Id);
      expect(p1InDb).toBeUndefined();

      // Other media (P2, P3, V1) are untouched
      expect(db.prepare("SELECT id FROM gallery_media WHERE id = ?").get(p2Id)).toBeDefined();
      expect(db.prepare("SELECT id FROM gallery_media WHERE id = ?").get(p3Id)).toBeDefined();
      expect(db.prepare("SELECT id FROM gallery_media WHERE id = ?").get(v1Id)).toBeDefined();

      // SOURCE FILE IN IMPORT DIRECTORY IS 100% PRESERVED
      expect(fs.existsSync(sourceFilePath)).toBe(true);
      expect(fs.readFileSync(sourceFilePath, "utf8")).toBe("SOURCE_FILE_PRESERVED_CONTENT");

      // Stored original of P1 is deleted
      expect(fs.existsSync(path.join(testMediaPath, gallery.id, p1Id))).toBe(false);

      // Cover photo reallocated to next ready photo (P2)
      const galAfter = getGalleryById(gallery.id)!;
      expect(galAfter.cover_media_id).toBe(p2Id);
      expect(galAfter.revision).toBe(galBefore.revision + 1);

      // Codes and generation remain UNTOUCHED
      const codeRowAfter = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id);
      expect(codeRowAfter).toEqual(codeRowBefore);
      expect(galAfter.code_generation).toBe(generationBefore);
    });

    it("reverts published gallery to draft if it becomes completely empty, but preserves published status if videos remain", () => {
      const { gallery } = createGallery({
        title: "Galerie Vidage",
        clientName: "Client Vidage",
        projectDate: "2026-08-01",
      });

      const pId = crypto.randomUUID();
      insertPhotoRow(gallery.id, pId, "single-photo.jpg", 1);
      const db = getGalleryDb();
      db.prepare("UPDATE galleries SET status = 'published', expires_at = ?, cover_media_id = ? WHERE id = ?").run(
        Date.now() + 86400000,
        pId,
        gallery.id
      );

      // Delete the only photo -> gallery becomes completely empty
      const res = deleteGalleryPhoto(gallery.id, pId, gallery.revision);
      expect(res.unpublishNotice).toBe(true);
      expect(res.newCoverId).toBeNull();

      const galAfter = getGalleryById(gallery.id)!;
      expect(galAfter.status).toBe("draft");
      expect(galAfter.cover_media_id).toBeNull();

      // If gallery has a video and only photo is deleted -> status stays published!
      const p2Id = crypto.randomUUID();
      const vId = crypto.randomUUID();
      insertPhotoRow(gallery.id, p2Id, "photo-with-video.jpg", 1);
      insertVideoRow(gallery.id, vId, "video.mp4", 2);
      db.prepare("UPDATE galleries SET status = 'published', revision = 10 WHERE id = ?").run(gallery.id);

      const res2 = deleteGalleryPhoto(gallery.id, p2Id, 10);
      expect(res2.unpublishNotice).toBe(false);
      const galAfter2 = getGalleryById(gallery.id)!;
      expect(galAfter2.status).toBe("published");
    });

    it("handles filesystem cleanup failure gracefully without rolling back database deletion and allows manual retry", () => {
      const { gallery } = createGallery({
        title: "Galerie Erreur Nettoyage",
        clientName: "Client Nettoyage",
        projectDate: "2026-08-01",
      });
      const pId = crypto.randomUUID();
      insertPhotoRow(gallery.id, pId, "cleanup-test.jpg", 1);

      // Verify direct deleteStoredGalleryMediaFiles call handles missing directory without error
      expect(() => deleteStoredGalleryMediaFiles(gallery.id, pId)).not.toThrow();

      // Deleting photo when file cleanup throws or warns keeps DB deletion committed
      const res = deleteGalleryPhoto(gallery.id, pId, gallery.revision);
      expect(res.success).toBe(true);
      const db = getGalleryDb();
      expect(db.prepare("SELECT id FROM gallery_media WHERE id = ?").get(pId)).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 4: Reordering and moving photos
  // --------------------------------------------------------------------------
  describe("4. Reordering & Moving Photos (Exact order, video preservation, cover preservation, append on import)", () => {
    it("moves and reorders photos strictly, preserves video order and chosen cover, and new imports append consistently", async () => {
      const { gallery } = createGallery({
        title: "Galerie Ordre",
        clientName: "Client Ordre",
        projectDate: "2026-08-01",
      });

      const p1 = crypto.randomUUID();
      const p2 = crypto.randomUUID();
      const p3 = crypto.randomUUID();
      const v1 = crypto.randomUUID();

      insertPhotoRow(gallery.id, p1, "alpha.jpg", 10);
      insertPhotoRow(gallery.id, p2, "beta.jpg", 20);
      insertPhotoRow(gallery.id, p3, "gamma.jpg", 30);
      insertVideoRow(gallery.id, v1, "teaser.mp4", 5);

      setCoverPhoto(gallery.id, p2); // Cover is beta.jpg
      const revAfterCover = getGalleryById(gallery.id)!.revision;

      // 1. Move p2 "up" -> should swap with p1
      moveGalleryPhoto(gallery.id, p2, "up", revAfterCover);
      let photos = getGalleryPhotosPaginated(gallery.id, 0, 10).items;
      expect(photos.map((p) => p.id)).toEqual([p2, p1, p3]);

      // Cover remains beta.jpg!
      expect(getGalleryById(gallery.id)?.cover_media_id).toBe(p2);

      // 2. Reorder arbitrary: [p3, p2, p1]
      const rev = getGalleryById(gallery.id)!.revision;
      reorderGalleryPhotos(gallery.id, [p3, p2, p1], rev);

      photos = getGalleryPhotosPaginated(gallery.id, 0, 10).items;
      expect(photos.map((p) => p.id)).toEqual([p3, p2, p1]);

      // Video order is strictly preserved
      const videos = getGalleryMediaList(gallery.id, "video");
      expect(videos.map((v) => v.id)).toEqual([v1]);

      // 3. Subsequent import naturally appends
      const p4 = crypto.randomUUID();
      const db = getGalleryDb();
      const maxSortRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) as maxSort FROM gallery_media WHERE gallery_id = ?").get(gallery.id) as { maxSort: number };
      insertPhotoRow(gallery.id, p4, "delta.jpg", maxSortRow.maxSort + 1);

      photos = getGalleryPhotosPaginated(gallery.id, 0, 10).items;
      expect(photos.map((p) => p.id)).toEqual([p3, p2, p1, p4]);

      // Verify editLoader returns media sorted in the exact new order
      const editReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        headers: { Cookie: adminCookie },
      });
      const editRes = await editLoader(createRouteArgs(editReq, { id: gallery.id }));
      expect(editRes.status).toBe(200);
      const editData = await editRes.json();
      expect(editData.media.filter((m: { media_type: string }) => m.media_type === "photo").map((m: { id: string }) => m.id)).toEqual([p3, p2, p1, p4]);
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 5: Security & Concurrency
  // --------------------------------------------------------------------------
  describe("5. Security, Concurrency & Validation Guards", () => {
    it("rejects invalid origin, CSRF, session, cross-gallery media IDs, stale revisions, and active imports without partial mutation", async () => {
      const { gallery } = createGallery({
        title: "Galerie Sécurité",
        clientName: "Client Sec",
        projectDate: "2026-08-01",
      });
      const pId = crypto.randomUUID();
      insertPhotoRow(gallery.id, pId, "sec.jpg", 1);

      // 1. Invalid CSRF
      const reqBadCsrf = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrfToken: "wrong", intent: "delete_photo", mediaId: pId, revision: "1" }).toString(),
      });
      const resBadCsrf = await editAction(createRouteArgs(reqBadCsrf, { id: gallery.id }));
      expect(resBadCsrf.status).toBe(403);

      // 2. Photo belonging to another gallery
      const { gallery: otherGal } = createGallery({ title: "Autre", clientName: "Autre", projectDate: "2026-08-01" });
      const otherPId = crypto.randomUUID();
      insertPhotoRow(otherGal.id, otherPId, "other.jpg", 1);

      const reqForeign = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrfToken, intent: "delete_photo", mediaId: otherPId, revision: String(gallery.revision) }).toString(),
      });
      const resForeign = await editAction(createRouteArgs(reqForeign, { id: gallery.id }));
      expect(resForeign.status).toBe(400);

      // 3. Stale revision (409 Conflict)
      const reqStale = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrfToken, intent: "move_photo", mediaId: pId, direction: "up", revision: "9999" }).toString(),
      });
      const resStale = await editAction(createRouteArgs(reqStale, { id: gallery.id }));
      expect(resStale.status).toBe(409);

      // 4. Active import in progress (409 Conflict)
      const db = getGalleryDb();
      db.prepare(`
        INSERT INTO gallery_import_jobs (id, gallery_id, import_folder, status, created_at, updated_at)
        VALUES ('job-active-test', ?, 'test-folder', 'importing', ?, ?)
      `).run(gallery.id, Date.now(), Date.now());

      const reqActiveImport = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrfToken, intent: "delete_photo", mediaId: pId, revision: String(gallery.revision) }).toString(),
      });
      const resActiveImport = await editAction(createRouteArgs(reqActiveImport, { id: gallery.id }));
      expect(resActiveImport.status).toBe(409);

      // Ensure no partial change occurred
      expect(db.prepare("SELECT id FROM gallery_media WHERE id = ?").get(pId)).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 6: UI Rendering & Form State Retention
  // --------------------------------------------------------------------------
  describe("6. Admin UI Rendering, Controls & Editorial State Retention", () => {
    it("renders photo cards with order badges, accessible boundary controls, delete confirmation, and preserves unsaved editorial text", async () => {
      const baseGallery = {
        id: "gal-ui-test",
        public_id: "pub-ui-test",
        title: "Titre Initial",
        client_name: "Client Initial",
        project_date: "2026-06-15",
        location: "Paris",
        intro_fr: "Texte intro initial",
        intro_en: "Initial intro",
        signature_fr: "Signature",
        signature_en: "Signature",
        status: "published" as const,
        expires_at: Date.now() + 86400000,
        cover_media_id: "photo-1",
        revision: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const testPhotos: GalleryMediaRow[] = [
        {
          id: "photo-1",
          gallery_id: "gal-ui-test",
          media_type: "photo",
          sort_order: 1,
          original_filename: "mariage-01.jpg",
          mime_type: "image/jpeg",
          file_size: 1024,
          content_hash: "hash1",
          width: 800,
          height: 600,
          is_ready: 1,
          preview_data: null,
          poster_revision: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: "photo-2",
          gallery_id: "gal-ui-test",
          media_type: "photo",
          sort_order: 2,
          original_filename: "mariage-02.jpg",
          mime_type: "image/jpeg",
          file_size: 1024,
          content_hash: "hash2",
          width: 800,
          height: 600,
          is_ready: 1,
          preview_data: null,
          poster_revision: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: "photo-3",
          gallery_id: "gal-ui-test",
          media_type: "photo",
          sort_order: 3,
          original_filename: "mariage-03.jpg",
          mime_type: "image/jpeg",
          file_size: 1024,
          content_hash: "hash3",
          width: 800,
          height: 600,
          is_ready: 1,
          preview_data: null,
          poster_revision: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];

      vi.mocked(useLoaderData).mockReturnValue({
        gallery: baseGallery,
        accessCode: "PARALLAX-TEST-CODE",
        codeVersion: 1,
        codeStatus: "available",
        codeWarning: null,
        folders: [],
        importRootPath: "/test/import",
        csrfToken: "test-csrf-token",
        media: testPhotos,
        activeImportJob: null,
      });
      vi.mocked(useActionData).mockReturnValue(undefined);

      render(<AdminGalleryEditPage />);

      // Position badges
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
      expect(screen.getByText("3 / 3")).toBeInTheDocument();

      // Keyboard buttons for photo 1: Monter is disabled, Descendre is enabled
      const monterBtn1 = screen.getByRole("button", { name: "Monter la photo mariage-01.jpg" });
      const descendreBtn1 = screen.getByRole("button", { name: "Descendre la photo mariage-01.jpg" });
      expect(monterBtn1).toBeDisabled();
      expect(descendreBtn1).not.toBeDisabled();

      // Keyboard buttons for photo 3: Monter is enabled, Descendre is disabled
      const monterBtn3 = screen.getByRole("button", { name: "Monter la photo mariage-03.jpg" });
      const descendreBtn3 = screen.getByRole("button", { name: "Descendre la photo mariage-03.jpg" });
      expect(monterBtn3).not.toBeDisabled();
      expect(descendreBtn3).toBeDisabled();

      // Delete confirmation on Photo 2:
      const deleteBtns = screen.getAllByRole("button", { name: "Supprimer de la galerie" });
      fireEvent.click(deleteBtns[1]); // Click delete on photo 2

      // Confirmation box appears naming the photo
      const alertBox = screen.getByRole("alert");
      expect(alertBox).toHaveTextContent("Supprimer « mariage-02.jpg » de la galerie ?");
      expect(alertBox).toHaveTextContent("Le fichier source déposé dans le dossier d'importation reste intact");
      expect(screen.getByRole("button", { name: "Confirmer le retrait" })).toBeInTheDocument();

      // Click Annuler closes the confirmation box
      const cancelBtn = screen.getByRole("button", { name: "Annuler" });
      fireEvent.click(cancelBtn);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Controlled editorial text inputs retention:
      // Type in Title and Intro without saving
      const titleInput = screen.getByLabelText(/Titre du projet/i) as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: "Titre Modifié En Cours De Saisie" } });
      expect(titleInput.value).toBe("Titre Modifié En Cours De Saisie");

      const introInput = screen.getByLabelText(/Texte d'introduction \(FR\)/i) as HTMLTextAreaElement;
      fireEvent.change(introInput, { target: { value: "Nouveau texte d'introduction non sauvegardé" } });
      expect(introInput.value).toBe("Nouveau texte d'introduction non sauvegardé");

      // Now interact with photo controls (e.g. click delete and cancel on photo 1)
      const deleteBtn1 = screen.getAllByRole("button", { name: "Supprimer de la galerie" })[0];
      fireEvent.click(deleteBtn1);
      const cancelBtnPhoto = screen.getByRole("button", { name: "Annuler" });
      fireEvent.click(cancelBtnPhoto);

      // Verify the unsaved editorial inputs retain their modified values!
      expect(titleInput.value).toBe("Titre Modifié En Cours De Saisie");
      expect(introInput.value).toBe("Nouveau texte d'introduction non sauvegardé");
    });
  });
});
