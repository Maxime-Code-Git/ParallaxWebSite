// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action as adminPortfolioEditAction } from "../app/routes/admin/portfolio-edit";
import { loader as clientLoginLoader, action as clientLoginAction } from "../app/routes/public/client-login";
import { loader as galleryLoader } from "../app/routes/public/gallery";
import { loader as galleryMediaLoader } from "../app/routes/api/gallery-media";
import { loader as galleryDownloadOriginalLoader } from "../app/routes/api/gallery-download-original";
import {
  authenticateGalleryCode,
  createGalleryCsrfToken,
  getGallerySessionStorage,
  generateGalleryCode,
  encryptGalleryCode,
  hashGalleryCode,
} from "../app/lib/gallery-auth.server";
import { getGalleryDb, closeGalleryDb } from "../app/lib/gallery-db.server";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { getRawPortfolioContent } from "../app/lib/portfolio-content.server";
import type { PortfolioContent, PortfolioMediaItem } from "../app/lib/portfolio-content.shared";

const PROJ_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_PROJ_ID = "99999999-9999-4999-8999-999999999999";
const IMG_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMG_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IMG_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FOREIGN_IMG = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SEC_DOC_IMG = "22222222-2222-4222-8222-222222222222";

function createMockPortfolioMedia(
  imageId: string,
  ownerType: "section" | "project",
  ownerId: string,
  mediaSlot: "category_entry" | "category_banner" | "cover" | "video_cover" | "showreel_cover" | "gallery"
): PortfolioMediaItem {
  return {
    imageId,
    ownerType,
    ownerId,
    mediaSlot,
    originalFormat: "webp",
    originalWidth: 1920,
    originalHeight: 1080,
    variants: [
      {
        name: "640p",
        width: 640,
        height: 360,
        webpSize: 15000,
        avifSize: 12000,
      },
    ],
    createdAt: 1700000000000,
  };
}

describe("Portfolio Media, Admin Thumbnails, Responsive Overlap, and Client Galleries", () => {
  let tempDir: string;
  let testPortfolioContent: string;
  let testPortfolioMedia: string;
  let testSiteContent: string;
  let testGalleryDbPath: string;
  let testGalleryMediaPath: string;
  let testRateLimitDbPath: string;
  const originalEnv = process.env;

  const makeActionArgs = (req: Request, params: Record<string, string> = {}): ActionFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as ActionFunctionArgs;

  const makeLoaderArgs = (req: Request, params: Record<string, string> = {}): LoaderFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as LoaderFunctionArgs;

  async function createAuthenticatedAdminRequest(
    method = "POST",
    url = `http://localhost:3000/admin/portfolio/${PROJ_ID}`,
    body?: BodyInit,
    headers: Record<string, string> = {}
  ): Promise<{ request: Request; sessionCookie: string; csrfToken: string }> {
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    const csrfToken = "test-csrf-token-1234567890abcdef";
    session.set("csrfToken", csrfToken);
    const sessionCookie = await commitSession(session);

    let reqBody = body;
    const reqHeaders = new Headers({
      Cookie: sessionCookie,
      Origin: "http://localhost:3000",
      ...headers,
    });

    if (body instanceof FormData) {
      const usp = new URLSearchParams();
      for (const [key, val] of body.entries()) {
        if (typeof val === "string") usp.append(key, val);
      }
      reqHeaders.set("Content-Type", "application/x-www-form-urlencoded");
      reqBody = usp.toString();
    } else if (body instanceof URLSearchParams) {
      reqHeaders.set("Content-Type", "application/x-www-form-urlencoded");
      reqBody = body.toString();
    }

    const request = new Request(url, {
      method,
      headers: reqHeaders,
      body: reqBody,
    });

    return { request, sessionCookie, csrfToken };
  }

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-test-suite-"));
    testPortfolioContent = path.join(tempDir, "portfolio-content.json");
    testPortfolioMedia = path.join(tempDir, "portfolio-media");
    testSiteContent = path.join(tempDir, "site-content.json");
    testGalleryDbPath = path.join(tempDir, "gallery.sqlite");
    testGalleryMediaPath = path.join(tempDir, "gallery-media");
    testRateLimitDbPath = path.join(tempDir, "ratelimit.sqlite");

    fs.mkdirSync(testPortfolioMedia, { mode: 0o700, recursive: true });
    fs.mkdirSync(testGalleryMediaPath, { mode: 0o700, recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      PORTFOLIO_CONTENT_PATH: testPortfolioContent,
      PORTFOLIO_MEDIA_PATH: testPortfolioMedia,
      SITE_CONTENT_PATH: testSiteContent,
      GALLERY_DB_PATH: testGalleryDbPath,
      GALLERY_MEDIA_PATH: testGalleryMediaPath,
      GALLERY_IMPORT_PATH: path.join(tempDir, "gallery-import"),
      GALLERY_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      GALLERY_CODE_ENCRYPTION_KEY: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      RATE_LIMIT_DB_PATH: testRateLimitDbPath,
      RATE_LIMIT_SECRET: "test-rate-limit-secret-32-chars-long!",
      TRUST_PROXY: "false",
    };

    // Seed fully valid portfolio content following schemaVersion 2
    const initialPortfolio: PortfolioContent = {
      schemaVersion: 2,
      revision: "b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6",
      updatedAt: "2026-03-01T10:00:00.000Z",
      overview: {
        title: { fr: "Portfolio", en: "Portfolio" },
        intro: { fr: "Nos réalisations", en: "Our works" },
        seo: {
          title: { fr: "Portfolio — Studio", en: "Portfolio — Studio" },
          description: { fr: "Découvrez nos projets", en: "Discover our projects" },
        },
        seeMoreButton: {
          fr: "Voir plus de projets de ce genre et découvrir nos autres réalisations",
          en: "See more projects of this kind and discover our other creative work",
        },
      },
      categories: [
        {
          id: "documentary",
          slugFr: "documentaire",
          slugEn: "documentary",
          order: 0,
          status: "published",
          title: { fr: "Documentaire", en: "Documentary" },
          intro: { fr: "Films", en: "Films" },
          seo: { title: { fr: "Docu", en: "Docu" }, description: { fr: "Desc", en: "Desc" } },
          coverImageId: SEC_DOC_IMG,
          coverAlt: { fr: "Couverture", en: "Cover" },
          entryImageId: SEC_DOC_IMG,
          entryAlt: { fr: "Entree", en: "Entry" },
          entrySummary: { fr: "Resume", en: "Summary" },
          entrySide: "left",
          bannerImageId: SEC_DOC_IMG,
          bannerAlt: { fr: "Banniere", en: "Banner" },
          showreelTitle: { fr: "Showreel", en: "Showreel" },
          showreelVideo: null,
          showreelCoverImageId: SEC_DOC_IMG,
          morePhotosButton: { fr: "Voir plus", en: "See more" },
          lessPhotosButton: { fr: "Voir moins", en: "See less" },
          backButton: { fr: "Retour", en: "Back" },
        },
      ],
      sections: {},
      projects: [
        {
          id: PROJ_ID,
          category: "documentary",
          slugFr: "projet-un",
          slugEn: "project-one",
          title: { fr: "Projet Un", en: "Project One" },
          summary: { fr: "Résumé", en: "Summary" },
          description: [
            { type: "paragraph", text: { fr: "Description du projet.", en: "Project description." } },
          ],
          seo: { title: { fr: "Titre", en: "Title" }, description: { fr: "Desc", en: "Desc" } },
          coverImageId: IMG_1,
          coverAlt: { fr: "Couverture", en: "Cover" },
          galleryImageIds: [IMG_1, IMG_2, IMG_3],
          galleryAlt: {
            [IMG_1]: { fr: "Alt 1 FR", en: "Alt 1 EN" },
            [IMG_2]: { fr: "Alt 2 FR", en: "Alt 2 EN" },
            [IMG_3]: { fr: "Alt 3 FR", en: "Alt 3 EN" },
          },
          video: null,
          showcase: true,
          side: "auto",
          order: 0,
          status: "published",
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      media: {
        [SEC_DOC_IMG]: createMockPortfolioMedia(SEC_DOC_IMG, "section", "documentary", "category_entry"),
        [IMG_1]: createMockPortfolioMedia(IMG_1, "project", PROJ_ID, "cover"),
        [IMG_2]: createMockPortfolioMedia(IMG_2, "project", PROJ_ID, "gallery"),
        [IMG_3]: createMockPortfolioMedia(IMG_3, "project", PROJ_ID, "gallery"),
        [FOREIGN_IMG]: createMockPortfolioMedia(FOREIGN_IMG, "project", FOREIGN_PROJ_ID, "gallery"),
      },
    };
    fs.writeFileSync(testPortfolioContent, JSON.stringify(initialPortfolio, null, 2), "utf8");
  });

  afterEach(() => {
    closeGalleryDb();
    process.env = originalEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("Point 2 & 3: Project Gallery Photos Removal, Reordering and Validation", () => {
    it("successfully reorders galleryImageIds and persists the exact order", async () => {
      const formData = new URLSearchParams();
      formData.set("revision", "b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6");
      formData.set("category", "documentary");
      formData.set("slugFr", "projet-un");
      formData.set("slugEn", "project-one");
      formData.set("titleFr", "Projet Un");
      formData.set("titleEn", "Project One");
      formData.set("summaryFr", "Résumé");
      formData.set("summaryEn", "Summary");
      formData.set("seoTitleFr", "Titre");
      formData.set("seoTitleEn", "Title");
      formData.set("seoDescFr", "Desc");
      formData.set("seoDescEn", "Desc");
      formData.set("coverImageId", IMG_1);
      formData.set("coverAltFr", "Couverture");
      formData.set("coverAltEn", "Cover");
      formData.set("galleryImageIds", JSON.stringify([IMG_3, IMG_1, IMG_2]));
      formData.set(
        "galleryAlt",
        JSON.stringify({
          [IMG_1]: { fr: "Alt 1 FR", en: "Alt 1 EN" },
          [IMG_2]: { fr: "Alt 2 FR", en: "Alt 2 EN" },
          [IMG_3]: { fr: "Alt 3 FR", en: "Alt 3 EN" },
        })
      );

      const { request, csrfToken } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/${PROJ_ID}`,
        formData
      );
      formData.set("csrfToken", csrfToken);

      const authedReq = new Request(`http://localhost:3000/admin/portfolio/${PROJ_ID}`, {
        method: "POST",
        headers: request.headers,
        body: formData.toString(),
      });

      const res = await adminPortfolioEditAction(makeActionArgs(authedReq, { id: PROJ_ID }));
      expect(res.status).toBe(200);

      const { content: updated } = getRawPortfolioContent();
      const proj = updated.projects.find((p) => p.id === PROJ_ID);
      expect(proj?.galleryImageIds).toEqual([IMG_3, IMG_1, IMG_2]);
      expect(proj?.galleryAlt?.[IMG_3]?.fr).toBe("Alt 3 FR");
    });

    it("removing an image from galleryImageIds preserves remaining images and preserves cover reference", async () => {
      // Removing IMG_1 from gallery while IMG_1 is still coverImageId
      const formData = new URLSearchParams();
      formData.set("revision", "b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6");
      formData.set("category", "documentary");
      formData.set("slugFr", "projet-un");
      formData.set("slugEn", "project-one");
      formData.set("titleFr", "Projet Un");
      formData.set("titleEn", "Project One");
      formData.set("summaryFr", "Résumé");
      formData.set("summaryEn", "Summary");
      formData.set("seoTitleFr", "Titre");
      formData.set("seoTitleEn", "Title");
      formData.set("seoDescFr", "Desc");
      formData.set("seoDescEn", "Desc");
      formData.set("coverImageId", IMG_1);
      formData.set("coverAltFr", "Couverture");
      formData.set("coverAltEn", "Cover");
      formData.set("galleryImageIds", JSON.stringify([IMG_2, IMG_3]));

      const { request, csrfToken } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/${PROJ_ID}`,
        formData
      );
      formData.set("csrfToken", csrfToken);

      const authedReq = new Request(`http://localhost:3000/admin/portfolio/${PROJ_ID}`, {
        method: "POST",
        headers: request.headers,
        body: formData.toString(),
      });

      const res = await adminPortfolioEditAction(makeActionArgs(authedReq, { id: PROJ_ID }));
      expect(res.status).toBe(200);

      const { content: updated } = getRawPortfolioContent();
      const proj = updated.projects.find((p) => p.id === PROJ_ID);
      // Gallery has only 2 images now
      expect(proj?.galleryImageIds).toEqual([IMG_2, IMG_3]);
      // CoverImageId is safely preserved
      expect(proj?.coverImageId).toBe(IMG_1);
    });

    it("rejects invalid JSON in galleryImageIds with 422 and does NOT interpret as empty array", async () => {
      const formData = new URLSearchParams();
      formData.set("revision", "b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6");
      formData.set("category", "documentary");
      formData.set("slugFr", "projet-un");
      formData.set("slugEn", "project-one");
      formData.set("titleFr", "Projet Un");
      formData.set("titleEn", "Project One");
      formData.set("summaryFr", "Résumé");
      formData.set("summaryEn", "Summary");
      formData.set("seoTitleFr", "Titre");
      formData.set("seoTitleEn", "Title");
      formData.set("seoDescFr", "Desc");
      formData.set("seoDescEn", "Desc");
      formData.set("galleryImageIds", "INVALID_NOT_JSON{[[");

      const { request, csrfToken } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/${PROJ_ID}`,
        formData
      );
      formData.set("csrfToken", csrfToken);

      const authedReq = new Request(`http://localhost:3000/admin/portfolio/${PROJ_ID}`, {
        method: "POST",
        headers: request.headers,
        body: formData.toString(),
      });

      const res = await adminPortfolioEditAction(makeActionArgs(authedReq, { id: PROJ_ID }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain("Format JSON invalide pour la liste des photos de la galerie");

      // Verify DB was NOT modified
      const { content: current } = getRawPortfolioContent();
      const proj = current.projects.find((p) => p.id === PROJ_ID);
      expect(proj?.galleryImageIds).toHaveLength(3);
    });

    it("rejects duplicate IDs in galleryImageIds with 422", async () => {
      const formData = new URLSearchParams();
      formData.set("revision", "b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6");
      formData.set("category", "documentary");
      formData.set("slugFr", "projet-un");
      formData.set("slugEn", "project-one");
      formData.set("titleFr", "Projet Un");
      formData.set("titleEn", "Project One");
      formData.set("summaryFr", "Résumé");
      formData.set("summaryEn", "Summary");
      formData.set("seoTitleFr", "Titre");
      formData.set("seoTitleEn", "Title");
      formData.set("seoDescFr", "Desc");
      formData.set("seoDescEn", "Desc");
      formData.set("galleryImageIds", JSON.stringify([IMG_1, IMG_1]));

      const { request, csrfToken } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/${PROJ_ID}`,
        formData
      );
      formData.set("csrfToken", csrfToken);

      const authedReq = new Request(`http://localhost:3000/admin/portfolio/${PROJ_ID}`, {
        method: "POST",
        headers: request.headers,
        body: formData.toString(),
      });

      const res = await adminPortfolioEditAction(makeActionArgs(authedReq, { id: PROJ_ID }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain("La galerie ne doit pas comporter de doublons");
    });

    it("rejects unauthorized/foreign media IDs with 422", async () => {
      const formData = new URLSearchParams();
      formData.set("revision", "b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6");
      formData.set("category", "documentary");
      formData.set("slugFr", "projet-un");
      formData.set("slugEn", "project-one");
      formData.set("titleFr", "Projet Un");
      formData.set("titleEn", "Project One");
      formData.set("summaryFr", "Résumé");
      formData.set("summaryEn", "Summary");
      formData.set("seoTitleFr", "Titre");
      formData.set("seoTitleEn", "Title");
      formData.set("seoDescFr", "Desc");
      formData.set("seoDescEn", "Desc");
      formData.set("galleryImageIds", JSON.stringify([IMG_1, FOREIGN_IMG]));

      const { request, csrfToken } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/${PROJ_ID}`,
        formData
      );
      formData.set("csrfToken", csrfToken);

      const authedReq = new Request(`http://localhost:3000/admin/portfolio/${PROJ_ID}`, {
        method: "POST",
        headers: request.headers,
        body: formData.toString(),
      });

      const res = await adminPortfolioEditAction(makeActionArgs(authedReq, { id: PROJ_ID }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain("appartient pas à ce projet");
    });
  });

  describe("Point 4 & 5: CSS Containment Rules for Lightbox and Admin Thumbnails", () => {
    it("portfolio.module.css includes stable lightbox bounding frame and object-fit: contain", () => {
      const cssPath = path.resolve(__dirname, "../app/routes/public/portfolio.module.css");
      const cssContent = fs.readFileSync(cssPath, "utf8");

      expect(cssContent).toContain("width: min(calc(100vw - 160px), 1600px)");
      expect(cssContent).toContain("height: min(calc(100dvh - 120px), 920px)");
      expect(cssContent).toContain("object-fit: contain");
      expect(cssContent).toContain("env(safe-area-inset-top");
    });

    it("portfolio.module.css (admin) includes bounded 64x48 thumbnail and responsive table wrapper", () => {
      const cssPath = path.resolve(__dirname, "../app/routes/admin/portfolio.module.css");
      const cssContent = fs.readFileSync(cssPath, "utf8");

      expect(cssContent).toContain(".tableResponsiveWrapper");
      expect(cssContent).toContain("width: 64px");
      expect(cssContent).toContain("height: 48px");
      expect(cssContent).toContain(".projectThumb picture");
      expect(cssContent).toContain(".projectThumb img");
      expect(cssContent).toContain("object-fit: cover");
      expect(cssContent).toContain(".projectThumbPlaceholder");
    });
  });

  describe("Point 6: Client Galleries Authentication, Full Journey Handlers, and Rate Limiting", () => {
    let galleryId: string;
    let publicId: string;
    let generatedCode: string;
    let photoMediaId: string;

    beforeEach(async () => {
      const db = getGalleryDb();
      galleryId = "gal-e2e-test-1";
      publicId = "pub-e2e-uuid-1";
      photoMediaId = "med-photo-e2e-1";
      generatedCode = generateGalleryCode();
      const codeHash = hashGalleryCode(generatedCode);
      const encCode = encryptGalleryCode(generatedCode);

      // Create a published gallery in the DB
      db.prepare(`
        INSERT INTO galleries (id, public_id, title, client_name, project_date, status, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?)
      `).run(
        galleryId,
        publicId,
        "Galerie Test",
        "Client Test",
        "2026-10-25",
        Date.now() + 30 * 24 * 3600_000,
        Date.now(),
        Date.now()
      );

      db.prepare(`
        INSERT INTO gallery_codes (gallery_id, code_hash, code_encrypted, version, updated_at)
        VALUES (?, ?, ?, 1, ?)
      `).run(galleryId, codeHash, encCode, Date.now());

      // Create a real JPEG file on disk under gallery directory
      const galDir = path.join(testGalleryMediaPath, galleryId);
      fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });
      const originalFilePath = path.join(galDir, photoMediaId);

      const jpegBuffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 30, g: 100, b: 200 },
        },
      })
        .jpeg()
        .toBuffer();
      fs.writeFileSync(originalFilePath, jpegBuffer, { mode: 0o600 });

      const contentHash = crypto.createHash("sha256").update(jpegBuffer).digest("hex");

      db.prepare(`
        INSERT INTO gallery_media (
          id, gallery_id, media_type, sort_order, original_filename, mime_type, file_size, content_hash,
          width, height, is_ready, preview_data, poster_revision, created_at, updated_at
        ) VALUES (?, ?, 'photo', 0, 'photo-client.jpg', 'image/jpeg', ?, ?, 800, 600, 1, '{"widths":[480,960]}', 0, ?, ?)
      `).run(photoMediaId, galleryId, jpegBuffer.length, contentHash, Date.now(), Date.now());
    });

    it("executes the complete client gallery authentication journey via real handlers (FR, EN, .data, private WebP, original download, unauth guard)", async () => {
      // 1. Call real login loader to obtain anonymous CSRF token and context session cookie
      const loginLoaderReq = new Request("http://localhost:3000/fr/espace-client");
      const loginLoaderRes = await clientLoginLoader(makeLoaderArgs(loginLoaderReq));
      expect(loginLoaderRes.status).toBe(200);

      const loaderData = await loginLoaderRes.json();
      expect(loaderData.lang).toBe("fr");
      expect(loaderData.csrfToken).toBeTruthy();

      const loaderCookie = loginLoaderRes.headers.get("Set-Cookie");
      expect(loaderCookie).toBeTruthy();

      // 2. Submit credentials to real clientLoginAction
      const formData = new URLSearchParams();
      formData.set("code", generatedCode);
      formData.set("csrfToken", loaderData.csrfToken);

      const actionReq = new Request("http://localhost:3000/fr/espace-client", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: loaderCookie!,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const actionRes = await clientLoginAction(makeActionArgs(actionReq));
      expect(actionRes.status).toBe(303);
      expect(actionRes.headers.get("Location")).toBe(`/fr/galerie/${publicId}`);

      const authSessionCookie = actionRes.headers.get("Set-Cookie");
      expect(authSessionCookie).toBeTruthy();
      expect(authSessionCookie).toContain("__parallax_gallery_session=");

      // 3. Test .data URL action submission
      const dataActionReq = new Request("http://localhost:3000/fr/espace-client.data", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: loaderCookie!,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });
      const dataActionRes = await clientLoginAction(makeActionArgs(dataActionReq));
      expect(dataActionRes.status).toBe(303);
      expect(dataActionRes.headers.get("Location")).toBe(`/fr/galerie/${publicId}`);

      // 4. Test EN login action route redirection
      const enActionReq = new Request("http://localhost:3000/en/client-area", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: loaderCookie!,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });
      const enActionRes = await clientLoginAction(makeActionArgs(enActionReq));
      expect(enActionRes.status).toBe(303);
      expect(enActionRes.headers.get("Location")).toBe(`/en/gallery/${publicId}`);

      // 5. Call real galleryLoader with authenticated session cookie
      const galleryReq = new Request(`http://localhost:3000/fr/galerie/${publicId}`, {
        headers: {
          Cookie: authSessionCookie!,
        },
      });
      const galleryRes = await galleryLoader(makeLoaderArgs(galleryReq, { publicId }));
      expect(galleryRes.status).toBe(200);

      const galleryData = await galleryRes.json();
      expect(galleryData.gallery.title).toBe("Galerie Test");
      expect(galleryData.initialPhotos).toHaveLength(1);
      expect(galleryData.initialPhotos[0].id).toBe(photoMediaId);
      expect(galleryData.initialPhotos[0].originalFilename).toBe("photo-client.jpg");

      // 6. Access private WebP variant via real galleryMediaLoader
      const mediaReq = new Request(
        `http://localhost:3000/api/gallery/${publicId}/media/${photoMediaId}?width=480&format=webp`,
        {
          headers: {
            Cookie: authSessionCookie!,
          },
        }
      );
      const mediaRes = await galleryMediaLoader(makeLoaderArgs(mediaReq, { publicId, mediaId: photoMediaId }));
      expect(mediaRes.status).toBe(200);
      expect(mediaRes.headers.get("Content-Type")).toBe("image/webp");
      expect(mediaRes.headers.get("Cache-Control")).toBe("no-store");

      // 7. Access original download via real galleryDownloadOriginalLoader
      const downloadReq = new Request(
        `http://localhost:3000/api/gallery/${publicId}/download/original/${photoMediaId}`,
        {
          headers: {
            Cookie: authSessionCookie!,
          },
        }
      );
      const downloadRes = await galleryDownloadOriginalLoader(
        makeLoaderArgs(downloadReq, { publicId, mediaId: photoMediaId })
      );
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("Content-Disposition")).toContain('attachment; filename="photo-client.jpg"');
      expect(downloadRes.headers.get("Cache-Control")).toBe("no-store");

      // 8. Verify unauthenticated requests to private media are strictly rejected
      const unauthMediaReq = new Request(
        `http://localhost:3000/api/gallery/${publicId}/media/${photoMediaId}?width=480&format=webp`
      );
      await expect(
        galleryMediaLoader(makeLoaderArgs(unauthMediaReq, { publicId, mediaId: photoMediaId }))
      ).rejects.toSatisfy((err: unknown) => {
        if (err instanceof Response) {
          return err.status === 401;
        }
        return false;
      });

      const unauthDownloadReq = new Request(
        `http://localhost:3000/api/gallery/${publicId}/download/original/${photoMediaId}`
      );
      await expect(
        galleryDownloadOriginalLoader(makeLoaderArgs(unauthDownloadReq, { publicId, mediaId: photoMediaId }))
      ).rejects.toSatisfy((err: unknown) => {
        if (err instanceof Response) {
          return err.status === 401;
        }
        return false;
      });
    });

    it("rejects code for draft gallery with 401 generic error", async () => {
      const db = getGalleryDb();
      // Put gallery in draft status
      db.prepare("UPDATE galleries SET status = 'draft' WHERE id = ?").run(galleryId);

      const sessionStorage = getGallerySessionStorage();
      const session = await sessionStorage.getSession();
      const csrfToken = createGalleryCsrfToken();
      session.set("csrfToken", csrfToken);
      session.set("csrfExpiresAt", Date.now() + 15 * 60 * 1000);

      const req = new Request("http://localhost:3000/fr/espace-client", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
        },
      });

      const result = await authenticateGalleryCode(req, generatedCode, csrfToken, session, "fr");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(401);
        expect(result.error).toContain("Code d'accès incorrect ou galerie non disponible");
      }
    });

    it("returns 401 with preserved code on invalid code, and returns 429 with Retry-After when rate limit threshold (5 attempts in 15 min) is exceeded", async () => {
      const sessionStorage = getGallerySessionStorage();
      const session = await sessionStorage.getSession();
      const csrfToken = createGalleryCsrfToken();
      session.set("csrfToken", csrfToken);
      session.set("csrfExpiresAt", Date.now() + 15 * 60 * 1000);
      const sessionCookie = await sessionStorage.commitSession(session);

      const wrongCode = "PARALLAX-WRONG-CODE";

      // Attempt 1: Returns 401 with submittedCode preserved
      const formData = new URLSearchParams();
      formData.set("code", wrongCode);
      formData.set("csrfToken", csrfToken);

      const req1 = new Request("http://localhost:3000/fr/espace-client", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: sessionCookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const res1 = await clientLoginAction(makeActionArgs(req1));
      expect(res1.status).toBe(401);
      const data1 = await res1.json();
      expect(data1.submittedCode).toBe(wrongCode);
      expect(data1.error).toContain("Code d'accès incorrect ou galerie non disponible");

      // Attempts 2, 3, 4, 5: Consume remaining rate limit quota for 127.0.0.1
      for (let i = 2; i <= 5; i++) {
        const req = new Request("http://localhost:3000/fr/espace-client", {
          method: "POST",
          headers: {
            Origin: "http://localhost:3000",
            Cookie: sessionCookie,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });
        const res = await clientLoginAction(makeActionArgs(req));
        expect(res.status).toBe(401);
      }

      // Attempt 6: Exceeds rate limit -> Must return 429 with Retry-After and human-readable error
      const req6 = new Request("http://localhost:3000/fr/espace-client", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: sessionCookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const res6 = await clientLoginAction(makeActionArgs(req6));
      expect(res6.status).toBe(429);
      expect(res6.headers.get("Retry-After")).toBeTruthy();

      const data6 = await res6.json();
      expect(data6.submittedCode).toBe(wrongCode);
      expect(data6.error).toMatch(/Trop de tentatives\. Veuillez réessayer dans environ \d+ minute/);
    });
  });

  describe("Point 7: Responsive Portfolio Overlap Styles and Natural CTA Wrapping", () => {
    it("portfolio.module.css avoids hardcoded 240px translation without clamps", () => {
      const cssPath = path.resolve(__dirname, "../app/routes/public/portfolio.module.css");
      const cssContent = fs.readFileSync(cssPath, "utf8");

      expect(cssContent).not.toMatch(/translateX\(-240px\)/);
      expect(cssContent).not.toMatch(/translateX\(240px\)/);
      expect(cssContent).toContain("translateX(clamp(-150px, calc(-16vw + 60px), -60px))");
      expect(cssContent).toContain("translateX(clamp(60px, calc(16vw - 60px), 150px))");
      expect(cssContent).toContain("margin-top: clamp(-56px, -4vw, -24px)");
    });

    it("portfolio.module.css uses responsive flex scaling for photo boxes", () => {
      const cssPath = path.resolve(__dirname, "../app/routes/public/portfolio.module.css");
      const cssContent = fs.readFileSync(cssPath, "utf8");

      expect(cssContent).toContain("flex: 1 1 54%");
      expect(cssContent).toContain("max-width: 600px");
      expect(cssContent).toContain("min-width: 280px");
    });

    it("portfolio.module.css allows CTA labels to wrap naturally across lines without white-space: nowrap", () => {
      const cssPath = path.resolve(__dirname, "../app/routes/public/portfolio.module.css");
      const cssContent = fs.readFileSync(cssPath, "utf8");

      // Verify seeMoreBtn and btnLabel do NOT have white-space: nowrap
      expect(cssContent).not.toMatch(/\.seeMoreBtn\s*\{[^}]*white-space:\s*nowrap/);
      expect(cssContent).not.toMatch(/\.btnLabelDesktop\s*\{[^}]*white-space:\s*nowrap/);

      // Verify max-width and wrapping attributes
      expect(cssContent).toContain("max-width: 100%");
      expect(cssContent).toContain("overflow-wrap: break-word");
      expect(cssContent).toContain("flex-shrink: 0");
    });
  });
});
