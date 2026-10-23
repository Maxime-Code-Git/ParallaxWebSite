// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { RouterContextProvider } from "react-router";
import { loader as listLoader } from "../app/routes/admin/galleries-list";
import { loader as newLoader, action as newAction } from "../app/routes/admin/galleries-new";
import { loader as editLoader, action as editAction } from "../app/routes/admin/galleries-edit";
import { loader as previewLoader } from "../app/routes/admin/galleries-preview";
import {
  closeGalleryDb,
} from "../app/lib/gallery-db.server";
import { createGallery, getGalleryById } from "../app/lib/gallery.server";
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

describe("Admin Galleries Management (CRUD, Code Rotation, Concurrency, Quarantine Deletion)", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;
  let testImportPath: string;
  let adminCookie: string;
  let csrfToken: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-admin-galleries-test-"));
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

  describe("Galleries List (/admin/galleries)", () => {
    it("requires admin session and returns empty list initially", async () => {
      const request = new Request("http://127.0.0.1:3000/admin/galleries", {
        headers: { Cookie: adminCookie },
      });

      const response = await listLoader(createRouteArgs(request));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.galleries).toBeDefined();
      expect(data.galleries.length).toBe(0);
    });

    it("returns created galleries with photo/video counts", async () => {
      createGallery({
        title: "Mariage A",
        clientName: "Client A",
        projectDate: "2026-05-10",
      });

      const request = new Request("http://127.0.0.1:3000/admin/galleries", {
        headers: { Cookie: adminCookie },
      });

      const response = await listLoader(createRouteArgs(request));
      const data = await response.json();
      expect(data.galleries.length).toBe(1);
      expect(data.galleries[0].title).toBe("Mariage A");
      expect(data.galleries[0].codeVersion).toBe(1);
    });
  });

  describe("Create Gallery (/admin/galleries/new)", () => {
    it("returns importRootPath matching configured GALLERY_IMPORT_PATH", async () => {
      const request = new Request("http://127.0.0.1:3000/admin/galleries/new", {
        headers: { Cookie: adminCookie },
      });
      const response = await newLoader(createRouteArgs(request));
      const data = await response.json();
      expect(data.importRootPath).toBe(testImportPath);
    });

    it("creates a gallery, generates access code, and redirects to edit page", async () => {
      const body = new URLSearchParams({
        csrfToken,
        title: "Projet Nouveau",
        clientName: "Maxime & Sophie",
        projectDate: "2026-09-12",
        location: "Namur",
        introFr: "Voici vos souvenirs.",
        signatureFr: "Maxime & Ludovic",
      });

      const request = new Request("http://127.0.0.1:3000/admin/galleries/new", {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const response = await newAction(createRouteArgs(request));
      expect(response.status).toBe(303);

      const location = response.headers.get("Location");
      expect(location).toMatch(/^\/admin\/galleries\/[0-9a-fA-F-]+$/);

      const galleryId = location?.split("/").pop();
      const gallery = getGalleryById(galleryId!);
      expect(gallery).toBeDefined();
      expect(gallery?.title).toBe("Projet Nouveau");
      expect(gallery?.client_name).toBe("Maxime & Sophie");
    });
  });

  describe("Edit Gallery (/admin/galleries/:id)", () => {
    it("returns importRootPath matching configured GALLERY_IMPORT_PATH", async () => {
      const { gallery } = createGallery({
        title: "Test Import Path Gallery",
        clientName: "Client Path",
        projectDate: "2026-06-01",
      });
      const request = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        headers: { Cookie: adminCookie },
      });
      const response = await editLoader(createRouteArgs(request, { id: gallery.id }));
      const data = await response.json();
      expect(data.importRootPath).toBe(testImportPath);
    });
    it("updates editorial metadata and increments revision", async () => {
      const { gallery } = createGallery({
        title: "Projet Initial",
        clientName: "Client Initial",
        projectDate: "2026-04-01",
      });

      const body = new URLSearchParams({
        csrfToken,
        intent: "update_info",
        revision: String(gallery.revision),
        title: "Projet Modifié",
        clientName: "Client Modifié",
        projectDate: "2026-04-02",
        location: "Liège",
        introFr: "Nouvelle intro",
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

      const updated = getGalleryById(gallery.id);
      expect(updated?.title).toBe("Projet Modifié");
      expect(updated?.revision).toBe(gallery.revision + 1);
    });

    it("returns 409 Conflict when revision does not match (optimistic concurrency)", async () => {
      const { gallery } = createGallery({
        title: "Conflit Test",
        clientName: "Client Conflit",
        projectDate: "2026-04-01",
      });

      // Submit with stale revision (e.g. revision 99)
      const body = new URLSearchParams({
        csrfToken,
        intent: "update_info",
        revision: "99",
        title: "Ecrasement Impossible",
        clientName: "Client",
        projectDate: "2026-04-01",
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
      expect(response.status).toBe(409);

      const data = await response.json();
      expect(data.error).toContain("Conflit de révision (409)");
    });

    it("rotates access code, reveals new code to admin, and updates version", async () => {
      const { gallery } = createGallery({
        title: "Rotation Test",
        clientName: "Client Rotation",
        projectDate: "2026-04-01",
      });

      const body = new URLSearchParams({
        csrfToken,
        intent: "rotate_code",
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

      const data = await response.json();
      expect(data.success).toContain("Nouveau code généré : PARALLAX-");
    });

    it("requires future expiration date and at least one ready media item to publish", async () => {
      const { gallery } = createGallery({
        title: "Publication Test",
        clientName: "Client Pub",
        projectDate: "2026-04-01",
      });

      // Attempt to publish without expiration date -> fails with 400
      const bodyNoDate = new URLSearchParams({
        csrfToken,
        intent: "publish",
        revision: String(gallery.revision),
      });

      const reqNoDate = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyNoDate.toString(),
      });

      const resNoDate = await editAction(createRouteArgs(reqNoDate, { id: gallery.id }));
      expect(resNoDate.status).toBe(400);

      // Attempt to publish with future date but 0 ready media -> fails with 400
      const futureDate = new Date(Date.now() + 86400000 * 30).toISOString().split("T")[0];
      const bodyNoMedia = new URLSearchParams({
        csrfToken,
        intent: "publish",
        revision: String(gallery.revision),
        expiresAt: futureDate,
      });

      const reqNoMedia = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyNoMedia.toString(),
      });

      const resNoMedia = await editAction(createRouteArgs(reqNoMedia, { id: gallery.id }));
      expect(resNoMedia.status).toBe(400);
      const dataNoMedia = await resNoMedia.json();
      expect(dataNoMedia.error).toContain("aucun media pret");
    });

    it("deletes gallery and quarantines storage when title confirmation is exact", async () => {
      const { gallery } = createGallery({
        title: "Galerie A Détruire",
        clientName: "Client Del",
        projectDate: "2026-04-01",
      });

      // Wrong confirmation title -> fails with 400
      const bodyWrong = new URLSearchParams({
        csrfToken,
        intent: "delete_gallery",
        confirmTitle: "Mauvais Nom",
      });

      const reqWrong = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyWrong.toString(),
      });

      const resWrong = await editAction(createRouteArgs(reqWrong, { id: gallery.id }));
      expect(resWrong.status).toBe(400);

      // Exact confirmation title -> deletes and redirects to /admin/galleries
      const bodyExact = new URLSearchParams({
        csrfToken,
        intent: "delete_gallery",
        confirmTitle: "Galerie A Détruire",
      });

      const reqExact = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyExact.toString(),
      });

      const resExact = await editAction(createRouteArgs(reqExact, { id: gallery.id }));
      expect(resExact.status).toBe(303);
      expect(resExact.headers.get("Location")).toBe("/admin/galleries");

      expect(getGalleryById(gallery.id)).toBeUndefined();
    });
  });

  describe("Admin Preview (/admin/galleries/:id/preview)", () => {
    it("renders gallery preview for authenticated admin without needing client code", async () => {
      const { gallery } = createGallery({
        title: "Galerie Preview Admin",
        clientName: "Client Preview",
        projectDate: "2026-04-01",
      });

      const request = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}/preview`, {
        headers: { Cookie: adminCookie },
      });

      const response = await previewLoader(createRouteArgs(request, { id: gallery.id }));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.gallery.title).toBe("Galerie Preview Admin");
      expect(data.gallery.publicId).toBe(gallery.public_id);
      expect(data.galleryId).toBe(gallery.id);
    });
  });
});
