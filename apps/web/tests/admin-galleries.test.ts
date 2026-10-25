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
  getGalleryDb,
} from "../app/lib/gallery-db.server";
import { createGallery, getGalleryById } from "../app/lib/gallery.server";
import {
  authenticateGalleryCode,
  getGallerySessionStorage,
  createGalleryCsrfToken,
} from "../app/lib/gallery-auth.server";
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

  describe("Gallery Access Code Unavailability Resilience and Explicit Rotation", () => {
    it("opens edit page with available code when key and code are valid", async () => {
      const { gallery, plainCode } = createGallery({
        title: "Galerie Code Valide",
        clientName: "Client Valide",
        projectDate: "2026-07-01",
      });

      const request = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        headers: { Cookie: adminCookie },
      });

      const response = await editLoader(createRouteArgs(request, { id: gallery.id }));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.codeStatus).toBe("available");
      expect(data.accessCode).toBe(plainCode);
      expect(data.codeVersion).toBe(1);
      expect(data.codeWarning).toBeNull();
      expect(data.gallery.title).toBe("Galerie Code Valide");
    });

    it("opens edit page with unavailable code when encryption key is changed, without mutating database", async () => {
      const { gallery } = createGallery({
        title: "Galerie Clé Modifiée",
        clientName: "Client Clé",
        projectDate: "2026-07-01",
      });

      // Switch encryption key to simulate copied database or key rotation in environment
      const originalKey = process.env.GALLERY_CODE_ENCRYPTION_KEY;
      process.env.GALLERY_CODE_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      try {
        const db = getGalleryDb();
        const codeRowBefore = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id);
        const galleryRowBefore = db.prepare("SELECT * FROM galleries WHERE id = ?").get(gallery.id);

        const request = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
          headers: { Cookie: adminCookie },
        });

        const response = await editLoader(createRouteArgs(request, { id: gallery.id }));
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.codeStatus).toBe("unavailable");
        expect(data.accessCode).toBeNull();
        expect(data.codeVersion).toBe(1);
        expect(data.codeWarning).toContain("Le code d'accès actuel ne peut pas être déchiffré avec la clé active");
        expect(data.gallery.title).toBe("Galerie Clé Modifiée");

        // Verify zero mutation in database during GET
        const codeRowAfter = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id);
        const galleryRowAfter = db.prepare("SELECT * FROM galleries WHERE id = ?").get(gallery.id);
        expect(codeRowAfter).toEqual(codeRowBefore);
        expect(galleryRowAfter).toEqual(galleryRowBefore);
      } finally {
        process.env.GALLERY_CODE_ENCRYPTION_KEY = originalKey;
      }
    });

    it("opens edit page with unavailable code when encrypted code string is malformed or corrupted", async () => {
      const { gallery } = createGallery({
        title: "Galerie Code Corrompu",
        clientName: "Client Corrompu",
        projectDate: "2026-07-01",
      });

      const db = getGalleryDb();
      db.prepare("UPDATE gallery_codes SET code_encrypted = 'invalid-hex-corrupted' WHERE gallery_id = ?").run(gallery.id);

      const request = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        headers: { Cookie: adminCookie },
      });

      const response = await editLoader(createRouteArgs(request, { id: gallery.id }));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.codeStatus).toBe("unavailable");
      expect(data.accessCode).toBeNull();
      expect(data.codeWarning).toBeTruthy();
    });

    it("opens edit page with unavailable code when gallery_codes row is completely absent", async () => {
      const { gallery } = createGallery({
        title: "Galerie Sans Ligne Code",
        clientName: "Client Sans Code",
        projectDate: "2026-07-01",
      });

      const db = getGalleryDb();
      db.prepare("DELETE FROM gallery_codes WHERE gallery_id = ?").run(gallery.id);

      const request = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        headers: { Cookie: adminCookie },
      });

      const response = await editLoader(createRouteArgs(request, { id: gallery.id }));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.codeStatus).toBe("unavailable");
      expect(data.accessCode).toBeNull();
      expect(data.codeVersion).toBe(0);
      expect(data.codeWarning).toContain("Aucun code d'accès n'est enregistré pour cette galerie");
    });

    it("executes standard GET and .data GET requests without any mutation of galleries, codes, revisions, or media", async () => {
      const { gallery } = createGallery({
        title: "Galerie Immuable GET",
        clientName: "Client Immuable",
        projectDate: "2026-07-01",
      });

      const db = getGalleryDb();
      const snapBefore = {
        gallery: db.prepare("SELECT * FROM galleries WHERE id = ?").get(gallery.id),
        code: db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id),
        mediaCount: (db.prepare("SELECT COUNT(*) as count FROM gallery_media WHERE gallery_id = ?").get(gallery.id) as { count: number }).count,
      };

      // Standard GET
      const standardReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        headers: { Cookie: adminCookie },
      });
      const standardRes = await editLoader(createRouteArgs(standardReq, { id: gallery.id }));
      expect(standardRes.status).toBe(200);

      // .data GET
      const dataReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}.data`, {
        headers: { Cookie: adminCookie },
      });
      const dataRes = await editLoader(createRouteArgs(dataReq, { id: gallery.id }));
      expect(dataRes.status).toBe(200);

      const snapAfter = {
        gallery: db.prepare("SELECT * FROM galleries WHERE id = ?").get(gallery.id),
        code: db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id),
        mediaCount: (db.prepare("SELECT COUNT(*) as count FROM gallery_media WHERE gallery_id = ?").get(gallery.id) as { count: number }).count,
      };

      expect(snapAfter).toEqual(snapBefore);
    });

    it("allows editorial updates via update_info even when the access code is unavailable", async () => {
      const { gallery } = createGallery({
        title: "Titre Avant Modif",
        clientName: "Client Avant Modif",
        projectDate: "2026-07-01",
      });

      // Break code to simulate unavailable state
      const db = getGalleryDb();
      db.prepare("UPDATE gallery_codes SET code_encrypted = 'corrupted:ciphertext:tag' WHERE gallery_id = ?").run(gallery.id);

      const body = new URLSearchParams({
        csrfToken,
        intent: "update_info",
        revision: String(gallery.revision),
        title: "Titre Après Modif Sans Code",
        clientName: "Client Modifié Avec Succès",
        projectDate: "2026-07-02",
        location: "Namur",
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
      expect(updated?.title).toBe("Titre Après Modif Sans Code");
      expect(updated?.client_name).toBe("Client Modifié Avec Succès");
      expect(updated?.location).toBe("Namur");
      expect(updated?.revision).toBe(gallery.revision + 1);
    });

    it("rotates code explicitly on demand: restores availability, issues valid client code, revokes old access, and increments version", async () => {
      const { gallery } = createGallery({
        title: "Galerie Pour Régénération",
        clientName: "Client Rotation",
        projectDate: "2026-07-01",
      });

      // Break current code in DB
      const db = getGalleryDb();
      db.prepare("UPDATE gallery_codes SET code_encrypted = 'bad:cipher:tag' WHERE gallery_id = ?").run(gallery.id);

      // Verify loader sees it as unavailable
      const checkReq1 = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        headers: { Cookie: adminCookie },
      });
      const checkRes1 = await editLoader(createRouteArgs(checkReq1, { id: gallery.id }));
      const checkData1 = await checkRes1.json();
      expect(checkData1.codeStatus).toBe("unavailable");

      // Request rotation explicitly via rotate_code
      const body = new URLSearchParams({
        csrfToken,
        intent: "rotate_code",
      });

      const rotateReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const rotateRes = await editAction(createRouteArgs(rotateReq, { id: gallery.id }));
      expect(rotateRes.status).toBe(200);
      const rotateData = await rotateRes.json();
      expect(rotateData.success).toMatch(/Nouveau code généré : (PARALLAX-[A-Z0-9-]+)\. Les anciennes sessions ont été révoquées\./);

      const match = rotateData.success.match(/PARALLAX-[A-Z0-9-]+/);
      const newPlainCode = match![0];

      // Re-query loader: code is now available, plaintext matches, version incremented
      const checkReq2 = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        headers: { Cookie: adminCookie },
      });
      const checkRes2 = await editLoader(createRouteArgs(checkReq2, { id: gallery.id }));
      const checkData2 = await checkRes2.json();
      expect(checkData2.codeStatus).toBe("available");
      expect(checkData2.accessCode).toBe(newPlainCode);
      expect(checkData2.codeVersion).toBe(2);
      expect(checkData2.codeWarning).toBeNull();

      // Publish gallery with future expiration to verify client authentication with newly generated code
      db.prepare("UPDATE galleries SET status = 'published', expires_at = ? WHERE id = ?").run(
        Date.now() + 24 * 3600 * 1000,
        gallery.id
      );

      // Test that client authentication succeeds with the newly generated code
      const clientStorage = getGallerySessionStorage();
      const clientSession = await clientStorage.getSession();
      const clientCsrf = createGalleryCsrfToken();
      clientSession.set("csrfToken", clientCsrf);

      const authReq = new Request("http://127.0.0.1:3000/fr/espace-client", {
        headers: {
          Origin: "http://127.0.0.1:3000",
          "x-forwarded-for": "127.0.0.1",
        },
      });
      const authResult = await authenticateGalleryCode(authReq, newPlainCode, clientCsrf, clientSession);
      if (!authResult.success) {
        throw new Error(`Authentication failed unexpectedly: ${authResult.error}`);
      }
      expect(authResult.publicId).toBe(gallery.public_id);
      expect(authResult.sessionCookie).toBeTruthy();
    });

    it("rejects unauthenticated requests to edit loader and action", async () => {
      const { gallery } = createGallery({
        title: "Galerie Protégée",
        clientName: "Client Protégé",
        projectDate: "2026-07-01",
      });

      const unauthLoaderReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`);
      await expect(editLoader(createRouteArgs(unauthLoaderReq, { id: gallery.id }))).rejects.toSatisfy((err: unknown) => {
        if (err instanceof Response) {
          return err.status === 303 || err.status === 401;
        }
        return false;
      });

      const body = new URLSearchParams({
        csrfToken: "fake-csrf",
        intent: "rotate_code",
      });
      const unauthActionReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
      await expect(editAction(createRouteArgs(unauthActionReq, { id: gallery.id }))).rejects.toSatisfy((err: unknown) => {
        if (err instanceof Response) {
          return err.status === 303 || err.status === 401;
        }
        return false;
      });
    });

    it("rejects rotate_code action requests with invalid Origin or invalid CSRF without any mutation", async () => {
      const { gallery } = createGallery({
        title: "Galerie Sécurité Action",
        clientName: "Client Sécurité",
        projectDate: "2026-07-01",
      });

      const db = getGalleryDb();
      const codeRowBefore = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id);

      // 1. Invalid Origin
      const bodyValidCsrf = new URLSearchParams({
        csrfToken,
        intent: "rotate_code",
      });
      const badOriginReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://evil-attacker.com",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyValidCsrf.toString(),
      });
      const badOriginRes = await editAction(createRouteArgs(badOriginReq, { id: gallery.id }));
      expect(badOriginRes.status).toBe(403);

      // 2. Invalid CSRF
      const bodyBadCsrf = new URLSearchParams({
        csrfToken: "invalid-csrf-token",
        intent: "rotate_code",
      });
      const badCsrfReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
        method: "POST",
        headers: {
          Cookie: adminCookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyBadCsrf.toString(),
      });
      const badCsrfRes = await editAction(createRouteArgs(badCsrfReq, { id: gallery.id }));
      expect(badCsrfRes.status).toBe(403);

      // Verify database unchanged
      const codeRowAfter = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id);
      expect(codeRowAfter).toEqual(codeRowBefore);
    });
  });
});
