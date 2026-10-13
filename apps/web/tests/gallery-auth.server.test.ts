// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  generateGalleryCode,
  normalizeGalleryCode,
  hashGalleryCode,
  encryptGalleryCode,
  decryptGalleryCode,
  getGallerySessionStorage,
  createGalleryCsrfToken,
  verifyGalleryCsrfToken,
  requireGalleryAccess,
  authenticateGalleryCode,
} from "../app/lib/gallery-auth.server";
import {
  getGalleryDb,
  closeGalleryDb,
} from "../app/lib/gallery-db.server";
import { createGallery, rotateGalleryCode } from "../app/lib/gallery.server";

describe("gallery-auth.server.ts (Cryptographic Tokens, Sessions, and Access Guards)", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-auth-test-"));
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
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    process.env.TRUST_PROXY = "true";
  });

  afterEach(() => {
    closeGalleryDb();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Code Generation and Normalization", () => {
    it("generates unambiguous access codes with >= 96 bits of entropy and PARALLAX- prefix", () => {
      const code = generateGalleryCode();
      expect(code.startsWith("PARALLAX-")).toBe(true);

      const segments = code.split("-");
      expect(segments.length).toBe(5); // PARALLAX, segment1, segment2, segment3, segment4
      expect(segments[0]).toBe("PARALLAX");

      // Verify character alphabet: only unambiguous characters (no 0, 1, I, O)
      const allowedChars = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;
      for (let i = 1; i < 5; i++) {
        expect(segments[i]).toMatch(allowedChars);
      }

      // Check randomness: two generated codes must not be identical
      const code2 = generateGalleryCode();
      expect(code).not.toBe(code2);
    });

    it("normalizes code by trimming whitespace, dashes, and underscores and converting to uppercase", () => {
      expect(normalizeGalleryCode("parallax-2345-6789")).toBe("PARALLAX23456789");
      expect(normalizeGalleryCode("  parallax_abcd_efgh  ")).toBe("PARALLAXABCDEFGH");
      expect(normalizeGalleryCode("Parallax 2345 6789")).toBe("PARALLAX23456789");
    });

    it("computes deterministic HMAC-SHA256 matching normalized representations", () => {
      const hash1 = hashGalleryCode("PARALLAX-2345-6789");
      const hash2 = hashGalleryCode("parallax 2345 6789");
      const hash3 = hashGalleryCode("  PARALLAX_2345_6789  ");

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("AES-256-GCM Encryption / Decryption", () => {
    it("encrypts and decrypts access codes with authenticating tag", () => {
      const originalCode = "PARALLAX-2345-6789-ABCD-EFGH";
      const encrypted = encryptGalleryCode(originalCode);

      expect(encrypted).not.toContain(originalCode);
      const parts = encrypted.split(":");
      expect(parts.length).toBe(3); // iv:ciphertext:tag
      expect(parts[0].length).toBe(24); // 12-byte IV in hex
      expect(parts[2].length).toBe(32); // 16-byte auth tag in hex

      const decrypted = decryptGalleryCode(encrypted);
      expect(decrypted).toBe(originalCode);
    });

    it("rejects tampered ciphertext during AES-256-GCM decryption", () => {
      const originalCode = "PARALLAX-2345-6789-ABCD-EFGH";
      const encrypted = encryptGalleryCode(originalCode);
      const parts = encrypted.split(":");

      // Flip one character in ciphertext
      const tamperedCiphertext =
        parts[1].slice(0, -2) + (parts[1].slice(-2) === "aa" ? "bb" : "aa");
      const tamperedEncrypted = `${parts[0]}:${tamperedCiphertext}:${parts[2]}`;

      expect(() => decryptGalleryCode(tamperedEncrypted)).toThrow();
    });
  });

  describe("CSRF Tokens", () => {
    it("creates and verifies 64-char hex CSRF tokens in constant time", async () => {
      const token = createGalleryCsrfToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      const storage = getGallerySessionStorage();
      const session = await storage.getSession();
      session.set("csrfToken", token);

      expect(verifyGalleryCsrfToken(session, token)).toBe(true);
      expect(verifyGalleryCsrfToken(session, "invalid-token")).toBe(false);
      expect(verifyGalleryCsrfToken(session, createGalleryCsrfToken())).toBe(false);
    });
  });

  describe("requireGalleryAccess Guard", () => {
    it("redirects or returns 401 when session cookie is absent", async () => {
      const request = new Request("http://127.0.0.1:3000/fr/galerie/pub-unknown");
      await expect(requireGalleryAccess(request, "pub-unknown")).rejects.toThrow();

      const apiRequest = new Request("http://127.0.0.1:3000/api/gallery/pub-unknown/photos");
      await expect(requireGalleryAccess(apiRequest, "pub-unknown", undefined, true)).rejects.toThrow();
    });

    it("grants access to published gallery when valid session matches code version", async () => {
      const { gallery } = createGallery({
        title: "Galerie Publique",
        clientName: "Client A",
        projectDate: "2026-07-01",
      });

      // Update gallery to published with future expiration
      const db = getGalleryDb();
      db.prepare("UPDATE galleries SET status = 'published', expires_at = ? WHERE id = ?").run(
        Date.now() + 86400000,
        gallery.id
      );

      // Create session cookie
      const storage = getGallerySessionStorage();
      const session = await storage.getSession();
      session.set("galleryId", gallery.id);
      session.set("codeVersion", 1);
      const cookieHeader = await storage.commitSession(session);

      const request = new Request(`http://127.0.0.1:3000/fr/galerie/${gallery.public_id}`, {
        headers: { Cookie: cookieHeader },
      });

      const result = await requireGalleryAccess(request, gallery.public_id);
      expect(result.gallery.id).toBe(gallery.id);
    });

    it("rejects access and revokes session if gallery is in draft status", async () => {
      const { gallery } = createGallery({
        title: "Galerie Brouillon",
        clientName: "Client B",
        projectDate: "2026-07-01",
      });

      const storage = getGallerySessionStorage();
      const session = await storage.getSession();
      session.set("galleryId", gallery.id);
      session.set("codeVersion", 1);
      const cookieHeader = await storage.commitSession(session);

      const request = new Request(`http://127.0.0.1:3000/fr/galerie/${gallery.public_id}`, {
        headers: { Cookie: cookieHeader },
      });

      await expect(requireGalleryAccess(request, gallery.public_id)).rejects.toThrow();
    });

    it("rejects access and revokes session if gallery has expired", async () => {
      const { gallery } = createGallery({
        title: "Galerie Expiree",
        clientName: "Client C",
        projectDate: "2026-07-01",
      });

      const db = getGalleryDb();
      db.prepare("UPDATE galleries SET status = 'published', expires_at = ? WHERE id = ?").run(
        Date.now() - 1000, // in the past
        gallery.id
      );

      const storage = getGallerySessionStorage();
      const session = await storage.getSession();
      session.set("galleryId", gallery.id);
      session.set("codeVersion", 1);
      const cookieHeader = await storage.commitSession(session);

      const request = new Request(`http://127.0.0.1:3000/fr/galerie/${gallery.public_id}`, {
        headers: { Cookie: cookieHeader },
      });

      await expect(requireGalleryAccess(request, gallery.public_id)).rejects.toThrow();
    });

    it("immediately revokes access when code is rotated to a new version", async () => {
      const { gallery } = createGallery({
        title: "Galerie Rotation",
        clientName: "Client D",
        projectDate: "2026-07-01",
      });

      const db = getGalleryDb();
      db.prepare("UPDATE galleries SET status = 'published', expires_at = ? WHERE id = ?").run(
        Date.now() + 86400000,
        gallery.id
      );

      // Client holds session with version 1
      const storage = getGallerySessionStorage();
      const session = await storage.getSession();
      session.set("galleryId", gallery.id);
      session.set("codeVersion", 1);
      const cookieHeader = await storage.commitSession(session);

      const request = new Request(`http://127.0.0.1:3000/fr/galerie/${gallery.public_id}`, {
        headers: { Cookie: cookieHeader },
      });

      // Verify access works before rotation
      const before = await requireGalleryAccess(request, gallery.public_id);
      expect(before.gallery.id).toBe(gallery.id);

      // Rotate code to version 2
      rotateGalleryCode(gallery.id);

      // Same request with version 1 cookie must now be rejected!
      await expect(requireGalleryAccess(request, gallery.public_id)).rejects.toThrow();
    });

    it("rejects access to media belonging to a different gallery", async () => {
      const { gallery: g1 } = createGallery({
        title: "Galerie 1",
        clientName: "Client 1",
        projectDate: "2026-07-01",
      });
      const { gallery: g2 } = createGallery({
        title: "Galerie 2",
        clientName: "Client 2",
        projectDate: "2026-07-01",
      });

      const db = getGalleryDb();
      db.prepare("UPDATE galleries SET status = 'published', expires_at = ? WHERE id = ?").run(
        Date.now() + 86400000,
        g1.id
      );

      // Insert media for gallery 2
      const media2Id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO gallery_media (id, gallery_id, media_type, sort_order, original_filename, mime_type, file_size, content_hash, is_ready, created_at, updated_at)
        VALUES (?, ?, 'photo', 1, 'photo2.jpg', 'image/jpeg', 1000, 'hash2', 1, ?, ?)
      `).run(media2Id, g2.id, Date.now(), Date.now());

      // Client session for gallery 1
      const storage = getGallerySessionStorage();
      const session = await storage.getSession();
      session.set("galleryId", g1.id);
      session.set("codeVersion", 1);
      const cookieHeader = await storage.commitSession(session);

      const request = new Request(`http://127.0.0.1:3000/api/gallery/${g1.public_id}/media/${media2Id}`, {
        headers: { Cookie: cookieHeader },
      });

      // Client authorized for gallery 1 attempting to access media2 from gallery 2 must fail with 404
      await expect(requireGalleryAccess(request, g1.public_id, media2Id, true)).rejects.toThrow();
    });
  });

  describe("authenticateGalleryCode Submission", () => {
    it("authenticates valid code and sets signed session cookie", async () => {
      const { gallery, plainCode } = createGallery({
        title: "Galerie Login",
        clientName: "Client Login",
        projectDate: "2026-07-01",
      });

      const db = getGalleryDb();
      db.prepare("UPDATE galleries SET status = 'published', expires_at = ? WHERE id = ?").run(
        Date.now() + 86400000,
        gallery.id
      );

      const storage = getGallerySessionStorage();
      const session = await storage.getSession();
      const csrf = createGalleryCsrfToken();
      session.set("csrfToken", csrf);

      const request = new Request("http://127.0.0.1:3000/fr/espace-client", {
        method: "POST",
        headers: {
          "x-forwarded-for": "127.0.0.1",
          Origin: "http://127.0.0.1:3000",
        },
      });

      const result = await authenticateGalleryCode(request, plainCode, csrf, session, "fr");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.publicId).toBe(gallery.public_id);
        expect(result.sessionCookie).toContain("__parallax_gallery_session");
      }
    });

    it("rejects invalid code with status 401", async () => {
      const storage = getGallerySessionStorage();
      const session = await storage.getSession();
      const csrf = createGalleryCsrfToken();
      session.set("csrfToken", csrf);

      const request = new Request("http://127.0.0.1:3000/fr/espace-client", {
        method: "POST",
        headers: {
          "x-forwarded-for": "127.0.0.1",
          Origin: "http://127.0.0.1:3000",
        },
      });

      const result = await authenticateGalleryCode(
        request,
        "PARALLAX-WRONG-CODE-9999-0000",
        csrf,
        session,
        "fr"
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(401);
      }
    });
  });
});
