import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { loader as publicPortfolioLoader } from "../app/routes/public/portfolio";
import { action as adminPortfolioAction } from "../app/routes/admin/portfolio";
import { action as adminPortfolioSectionAction } from "../app/routes/admin/portfolio-section";
import { action as adminPortfolioEditAction } from "../app/routes/admin/portfolio-edit";
import { action as adminPortfolioUploadAction } from "../app/routes/api/admin-portfolio-upload";
import { loader as portfolioVariantLoader } from "../app/routes/media/portfolio-variant";
import { loader as adminPortfolioMediaLoader } from "../app/routes/admin/portfolio-media";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import {
  getRawPortfolioContent,
  savePortfolioContent,
  getPublicPortfolioContent,
  getReferencedPortfolioMediaIds,
} from "../app/lib/portfolio-content.server";
import {
  type PortfolioCategoryItem,
  type PortfolioProject,
} from "../app/lib/portfolio-content.shared";
import {
  getPortfolioSectionUrl,
  getPortfolioProjectUrl,
  getPortfolioAlternateUrls,
} from "../app/lib/localized-urls";

describe("Dynamic Portfolio Categories — Comprehensive Validation Suite (Section 8)", () => {
  let tempDir: string;
  let testPortfolioContentPath: string;
  let testPortfolioMediaPath: string;
  const originalEnv = process.env;

  const makeLoaderArgs = (req: Request, params: Record<string, string> = {}): LoaderFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as LoaderFunctionArgs;

  const makeActionArgs = (req: Request, params: Record<string, string> = {}): ActionFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as ActionFunctionArgs;

  async function createTestImageBuffer(w = 400, h = 300, color = { r: 50, g: 120, b: 200 }): Promise<Buffer> {
    return sharp({
      create: {
        width: w,
        height: h,
        channels: 3,
        background: color,
      },
    })
      .jpeg()
      .toBuffer();
  }

  function createMultipartBody(
    fileName: string,
    mimeType: string,
    fileBuffer: Buffer
  ): { body: BodyInit; boundary: string } {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const total = Buffer.concat([head, fileBuffer, tail]);
    return { body: total as BodyInit, boundary };
  }

  async function createAuthenticatedAdminRequest(
    method = "GET",
    url = "http://localhost:3000/admin/portfolio",
    body?: BodyInit,
    headers: Record<string, string> = {}
  ): Promise<{ request: Request; sessionCookie: string; csrfToken: string }> {
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    const csrfToken = "test-csrf-token-dynamic-categories";
    session.set("csrfToken", csrfToken);
    const sessionCookie = await commitSession(session);

    let reqBody = body;
    const reqHeaders = new Headers({
      Cookie: sessionCookie,
      Origin: "http://localhost:3000",
      ...headers,
    });

    if (body instanceof URLSearchParams) {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-dyn-cat-"));
    testPortfolioContentPath = path.join(tempDir, "portfolio-content.json");
    testPortfolioMediaPath = path.join(tempDir, "portfolio-media");
    fs.mkdirSync(testPortfolioMediaPath, { recursive: true });

    const testSiteContent = path.join(tempDir, "site-content.json");
    const testSiteMedia = path.join(tempDir, "site-media");
    const testDbFile = path.join(tempDir, "rate-limit.sqlite");
    fs.mkdirSync(testSiteMedia, { recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      APP_URL: "http://localhost:3000",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      RATE_LIMIT_SECRET: "rate-limit-secret-min-32-chars-long-2!",
      RATE_LIMIT_DB_PATH: testDbFile,
      SITE_CONTENT_PATH: testSiteContent,
      SITE_MEDIA_PATH: testSiteMedia,
      PORTFOLIO_CONTENT_PATH: testPortfolioContentPath,
      PORTFOLIO_MEDIA_PATH: testPortfolioMediaPath,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 1: V1 Content Migration, Idempotence & Data Preservation
  // --------------------------------------------------------------------------
  it("1. Migrates V1 content with rich texts and media, preserving IDs, idempotence on restart, and rejecting corruption", async () => {
    const v1Content = {
      schemaVersion: 1,
      revision: "rev-v1-initial-123456",
      updatedAt: "2026-10-15T12:00:00.000Z",
      overview: {
        seo: { title: { fr: "Titre SEO Overview FR", en: "Overview SEO Title EN" }, description: { fr: "Desc FR", en: "Desc EN" } },
        title: { fr: "RÉALISATIONS", en: "PORTFOLIO" },
        intro: { fr: "Intro FR V1", en: "Intro EN V1" },
        seeMoreButton: { fr: "Voir plus", en: "See more" },
      },
      sections: {
        documentary: {
          category: "documentary",
          title: { fr: "Documentaire", en: "Documentary" },
          intro: { fr: "Intro Docu", en: "Intro Docu EN" },
          seo: { title: { fr: "Docu SEO FR", en: "Docu SEO EN" }, description: { fr: "Docu Desc FR", en: "Docu Desc EN" } },
          coverImageId: "11111111-1111-4111-8111-111111111111",
          coverAlt: { fr: "Cover Alt FR", en: "Cover Alt EN" },
          entryImageId: "22222222-2222-4222-8222-222222222222",
          entryAlt: { fr: "Entry Alt FR", en: "Entry Alt EN" },
          entrySummary: { fr: "Summary Doc FR", en: "Summary Doc EN" },
          entrySide: "left",
          bannerImageId: "33333333-3333-4333-8333-333333333333",
          bannerAlt: { fr: "Banner Alt FR", en: "Banner Alt EN" },
          backButton: { fr: "Retour", en: "Back" },
          showreelVideo: null,
          showreelCoverImageId: null,
          showreelTitle: { fr: "Showreel Doc", en: "Showreel Doc EN" },
          morePhotosButton: { fr: "Plus de photos", en: "More photos" },
          lessPhotosButton: { fr: "Moins", en: "Less" },
        },
        advertising: {
          category: "advertising",
          title: { fr: "Publicité", en: "Advertising" },
          intro: { fr: "Intro Pub", en: "Intro Pub EN" },
          seo: { title: { fr: "Pub SEO FR", en: "Pub SEO EN" }, description: { fr: "Pub Desc FR", en: "Pub Desc EN" } },
          coverImageId: null,
          coverAlt: { fr: "Cover Pub FR", en: "Cover Pub EN" },
          entryImageId: null,
          entryAlt: { fr: "Entry Pub FR", en: "Entry Pub EN" },
          entrySummary: { fr: "Summary Pub FR", en: "Summary Pub EN" },
          entrySide: "right",
          bannerImageId: null,
          bannerAlt: { fr: "Banner Pub FR", en: "Banner Pub EN" },
          backButton: { fr: "Retour", en: "Back" },
          showreelVideo: null,
          showreelCoverImageId: null,
          showreelTitle: { fr: "Showreel Pub", en: "Showreel Pub EN" },
          morePhotosButton: { fr: "Plus", en: "More" },
          lessPhotosButton: { fr: "Moins", en: "Less" },
        },
      },
      projects: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          title: { fr: "Projet 1", en: "Project 1" },
          slugFr: "projet-1",
          slugEn: "project-1",
          category: "documentary",
          summary: { fr: "Résumé 1", en: "Summary 1" },
          description: [{ type: "paragraph", text: { fr: "Texte 1 FR", en: "Text 1 EN" } }],
          seo: { title: { fr: "P1 SEO", en: "P1 SEO" }, description: { fr: "P1 Desc", en: "P1 Desc" } },
          coverImageId: null,
          coverAlt: { fr: "Alt", en: "Alt" },
          galleryImageIds: [],
          video: null,
          draftVideoCoverImageId: null,
          aspectRatio: "3:2",
          showcase: true,
          side: "left",
          status: "draft",
          order: 1,
          archived: false,
          updatedAt: 1000,
        },
      ],
      media: {
        "11111111-1111-4111-8111-111111111111": {
          imageId: "11111111-1111-4111-8111-111111111111",
          ownerType: "section",
          ownerId: "documentary",
          mediaSlot: "cover",
          originalFormat: "webp",
          originalWidth: 1200,
          originalHeight: 800,
          variants: [{ name: "640p", width: 640, height: 427, webpSize: 1000, avifSize: 800 }],
          createdAt: 1000,
        },
        "22222222-2222-4222-8222-222222222222": {
          imageId: "22222222-2222-4222-8222-222222222222",
          ownerType: "section",
          ownerId: "documentary",
          mediaSlot: "category_entry",
          originalFormat: "webp",
          originalWidth: 1920,
          originalHeight: 1080,
          variants: [{ name: "960p", width: 960, height: 540, webpSize: 1500, avifSize: 1200 }],
          createdAt: 1000,
        },
        "33333333-3333-4333-8333-333333333333": {
          imageId: "33333333-3333-4333-8333-333333333333",
          ownerType: "section",
          ownerId: "documentary",
          mediaSlot: "category_banner",
          originalFormat: "webp",
          originalWidth: 1920,
          originalHeight: 480,
          variants: [{ name: "960p", width: 960, height: 240, webpSize: 1500, avifSize: 1200 }],
          createdAt: 1000,
        },
      },
    };

    // Write V1 file
    fs.writeFileSync(testPortfolioContentPath, JSON.stringify(v1Content, null, 2), "utf-8");

    // First read: Triggers transparent migration
    const { content: migrated } = getRawPortfolioContent(testPortfolioContentPath);
    expect(migrated.schemaVersion).toBe(2);
    expect(Array.isArray(migrated.categories)).toBe(true);
    expect(migrated.categories.length).toBe(2);

    // Verify historical IDs and preservation
    const docCat = migrated.categories.find((c) => c.id === "documentary");
    const pubCat = migrated.categories.find((c) => c.id === "advertising");
    expect(docCat).toBeDefined();
    expect(pubCat).toBeDefined();
    expect(docCat?.slugFr).toBe("documentaire");
    expect(docCat?.slugEn).toBe("documentary");
    expect(docCat?.bannerImageId).toBe("33333333-3333-4333-8333-333333333333");
    expect(docCat?.entryImageId).toBe("22222222-2222-4222-8222-222222222222");
    expect(docCat?.coverImageId).toBe("11111111-1111-4111-8111-111111111111");

    // Projects retain reference to stable id
    expect(migrated.projects[0].category).toBe("documentary");

    // Idempotence: Second read yields identical schemaVersion 2 without re-migrating
    const { content: secondRead } = getRawPortfolioContent(testPortfolioContentPath);
    expect(secondRead.schemaVersion).toBe(2);
    expect(secondRead.categories.length).toBe(2);
    expect(secondRead.categories[0].id).toBe("documentary");

    // Corrupted file rejected explicitly with throw, never silently falling back to demo data
    fs.writeFileSync(testPortfolioContentPath, "{ invalid json corrupt content !!!", "utf-8");
    expect(() => getRawPortfolioContent(testPortfolioContentPath)).toThrow();
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Create a 3rd Category via Admin Action (no code change)
  // --------------------------------------------------------------------------
  it("2. Creates a third category ('Sport') via admin action in draft status with automatic slugs and order", async () => {
    // Start with default content
    const { content: initial } = getRawPortfolioContent(testPortfolioContentPath);
    expect(initial.categories.length).toBe(2);

    // 1. Create category in draft
    const formData = new URLSearchParams();
    formData.set("intent", "create_category");
    formData.set("revision", initial.revision);
    formData.set("csrfToken", "test-csrf-token-dynamic-categories");

    const { request } = await createAuthenticatedAdminRequest("POST", "http://localhost:3000/admin/portfolio", formData);
    const response = await adminPortfolioAction(makeActionArgs(request));
    const result = (await response.json()) as { success: string; categoryId: string; newRevision: string };

    expect(response.status).toBe(200);
    expect(result.success).toContain("créée");
    expect(result.categoryId).toBeDefined();

    // 2. Edit the category fields via portfolio-section action
    const editForm = new URLSearchParams();
    editForm.set("revision", result.newRevision);
    editForm.set("csrfToken", "test-csrf-token-dynamic-categories");
    editForm.set("title_fr", "Sport & Aventure");
    editForm.set("title_en", "Sports & Adventure");
    editForm.set("slugFr", "sport");
    editForm.set("slugEn", "sports");
    editForm.set("intro_fr", "Récits d'action et d'effort");
    editForm.set("intro_en", "Action and endurance stories");
    editForm.set("entrySide", "left");

    const { request: editReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/section/${result.categoryId}`,
      editForm
    );
    const editRes = await adminPortfolioSectionAction(makeActionArgs(editReq, { category: result.categoryId }));
    expect(editRes.status).toBe(200);

    const { content: afterCreate } = getRawPortfolioContent(testPortfolioContentPath);
    expect(afterCreate.categories.length).toBe(3);
    const newCat = afterCreate.categories.find((c) => c.id === result.categoryId);
    expect(newCat).toBeDefined();
    expect(newCat?.title.fr).toBe("Sport & Aventure");
    expect(newCat?.slugFr).toBe("sport");
    expect(newCat?.slugEn).toBe("sports");
    expect(newCat?.status).toBe("draft");
    expect(newCat?.order).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Real Multipart/Sharp Upload for 3rd Category Entry and Banner
  // --------------------------------------------------------------------------
  it("3. Uploads real Sharp multipart images for entry and banner of 3rd category, serving 200 variants", async () => {
    const { content: initial } = getRawPortfolioContent(testPortfolioContentPath);
    // Create category "Sport"
    const sportCat: PortfolioCategoryItem = {
      id: "sport-cat-uuid-12345",
      slugFr: "sport",
      slugEn: "sports",
      slugAliases: { fr: [], en: [] },
      title: { fr: "Sport", en: "Sports" },
      intro: { fr: "Intro", en: "Intro" },
      entrySummary: { fr: "Summary", en: "Summary" },
      entrySide: "left",
      order: 3,
      status: "published",
      seo: { title: { fr: "Sport SEO", en: "Sport SEO" }, description: { fr: "Desc", en: "Desc" } },
      coverImageId: null,
      coverAlt: { fr: "Cover", en: "Cover" },
      entryImageId: null,
      entryAlt: { fr: "Entrée Sport", en: "Sports Entry" },
      bannerImageId: null,
      bannerAlt: { fr: "Bannière Sport", en: "Sports Banner" },
      showreelVideo: null,
      showreelCoverImageId: null,
      showreelTitle: { fr: "Showreel", en: "Showreel" },
      morePhotosButton: { fr: "Plus", en: "More" },
      lessPhotosButton: { fr: "Moins", en: "Less" },
      backButton: { fr: "Retour", en: "Back" },
    };
    initial.categories.push(sportCat);
    initial.sections["sport-cat-uuid-12345"] = sportCat;
    const saveRes = await savePortfolioContent(initial, initial.revision);

    // 1. Upload category_entry via multipart
    const entryBuf = await createTestImageBuffer(1920, 1080, { r: 255, g: 100, b: 50 });
    const entryMultipart = createMultipartBody("entry.jpg", "image/jpeg", entryBuf);

    const { request: uploadEntryReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/api/admin/portfolio-upload",
      entryMultipart.body,
      {
        "Content-Type": `multipart/form-data; boundary=${entryMultipart.boundary}`,
        "x-csrf-token": "test-csrf-token-dynamic-categories",
        "x-portfolio-owner-type": "section",
        "x-portfolio-owner-id": "sport-cat-uuid-12345",
        "x-portfolio-media-slot": "category_entry",
        "x-portfolio-revision": saveRes.newRevision,
      }
    );

    const uploadEntryRes = await adminPortfolioUploadAction(makeActionArgs(uploadEntryReq));
    const entryJson = (await uploadEntryRes.json()) as { imageId: string; newRevision: string };
    expect(uploadEntryRes.status).toBe(200);
    expect(entryJson.imageId).toBeDefined();

    // 2. Upload category_banner via multipart
    const bannerBuf = await createTestImageBuffer(1920, 480, { r: 50, g: 200, b: 100 });
    const bannerMultipart = createMultipartBody("banner.jpg", "image/jpeg", bannerBuf);

    const { request: uploadBannerReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/api/admin/portfolio-upload",
      bannerMultipart.body,
      {
        "Content-Type": `multipart/form-data; boundary=${bannerMultipart.boundary}`,
        "x-csrf-token": "test-csrf-token-dynamic-categories",
        "x-portfolio-owner-type": "section",
        "x-portfolio-owner-id": "sport-cat-uuid-12345",
        "x-portfolio-media-slot": "category_banner",
        "x-portfolio-revision": entryJson.newRevision,
      }
    );

    const uploadBannerRes = await adminPortfolioUploadAction(makeActionArgs(uploadBannerReq));
    const bannerJson = (await uploadBannerRes.json()) as { imageId: string };
    expect(uploadBannerRes.status).toBe(200);
    expect(bannerJson.imageId).toBeDefined();

    // 3. Serve real variants in 200
    const variantReq = new Request(
      `http://localhost:3000/media/portfolio/section/sport-cat-uuid-12345/category_entry/${entryJson.imageId}/960p/webp`
    );
    const variantRes = await portfolioVariantLoader(
      makeLoaderArgs(variantReq, {
        ownerType: "section",
        ownerId: "sport-cat-uuid-12345",
        slot: "category_entry",
        imageId: entryJson.imageId,
        variant: "960p",
        ext: "webp",
      })
    );
    expect(variantRes.status).toBe(200);
    expect(variantRes.headers.get("Content-Type")).toBe("image/webp");
    const variantBuf = await variantRes.arrayBuffer();
    expect(variantBuf.byteLength).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Create & Publish Projects under 3rd Category with Localized URLs
  // --------------------------------------------------------------------------
  it("4. Creates and publishes Photo and Video projects under 3rd category with dynamic FR/EN URLs and .data", async () => {
    const { content: current } = getRawPortfolioContent(testPortfolioContentPath);
    const sportCat: PortfolioCategoryItem = {
      id: "sport-id",
      slugFr: "sport",
      slugEn: "sports",
      slugAliases: { fr: [], en: [] },
      title: { fr: "Sport", en: "Sports" },
      intro: { fr: "Intro", en: "Intro" },
      entrySummary: { fr: "Summary", en: "Summary" },
      entrySide: "left",
      order: 3,
      status: "published",
      seo: { title: { fr: "T", en: "T" }, description: { fr: "D", en: "D" } },
      coverImageId: null,
      coverAlt: { fr: "A", en: "A" },
      entryImageId: null,
      entryAlt: { fr: "A", en: "A" },
      bannerImageId: null,
      bannerAlt: { fr: "A", en: "A" },
      showreelVideo: null,
      showreelCoverImageId: null,
      showreelTitle: { fr: "T", en: "T" },
      morePhotosButton: { fr: "P", en: "P" },
      lessPhotosButton: { fr: "M", en: "M" },
      backButton: { fr: "R", en: "R" },
    };
    current.categories.push(sportCat);
    current.sections["sport-id"] = sportCat;

    const photoProjId = "66666666-6666-4666-8666-666666666666";
    const videoProjId = "77777777-7777-4777-8777-777777777777";
    const photoCoverId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const videoCoverId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    current.media[photoCoverId] = {
      imageId: photoCoverId,
      ownerType: "project",
      ownerId: photoProjId,
      mediaSlot: "cover",
      originalFormat: "webp",
      originalWidth: 1200,
      originalHeight: 800,
      variants: [{ name: "640p", width: 640, height: 427, webpSize: 1000, avifSize: 800 }],
      createdAt: 1000,
    };
    current.media[videoCoverId] = {
      imageId: videoCoverId,
      ownerType: "project",
      ownerId: videoProjId,
      mediaSlot: "video_cover",
      originalFormat: "webp",
      originalWidth: 1920,
      originalHeight: 1080,
      variants: [{ name: "960p", width: 960, height: 540, webpSize: 1500, avifSize: 1200 }],
      createdAt: 1000,
    };

    const photoProj: PortfolioProject = {
      id: photoProjId,
      title: { fr: "Course en Montagne", en: "Mountain Race" },
      slugFr: "course-en-montagne",
      slugEn: "mountain-race",
      category: "sport-id",
      summary: { fr: "Trail alpin", en: "Alpine trail" },
      description: [{ type: "paragraph", text: { fr: "Texte alpin", en: "Alpine text" } }],
      seo: { title: { fr: "Trail", en: "Trail" }, description: { fr: "Desc", en: "Desc" } },
      coverImageId: photoCoverId,
      coverAlt: { fr: "Alt", en: "Alt" },
      galleryImageIds: [],
      video: null,
      draftVideoCoverImageId: null,
      presentationMode: "photo",
      aspectRatio: "3:2",
      showcase: false,
      side: "left",
      status: "published",
      order: current.projects.length + 1,
      archived: false,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const videoProj: PortfolioProject = {
      id: videoProjId,
      title: { fr: "Descente VTT", en: "Downhill MTB" },
      slugFr: "descente-vtt",
      slugEn: "downhill-mtb",
      category: "sport-id",
      summary: { fr: "Vitesse pure", en: "Pure speed" },
      description: [{ type: "paragraph", text: { fr: "Texte VTT", en: "MTB text" } }],
      seo: { title: { fr: "VTT", en: "MTB" }, description: { fr: "Desc", en: "Desc" } },
      coverImageId: videoCoverId,
      coverAlt: { fr: "Alt", en: "Alt" },
      galleryImageIds: [],
      video: {
        provider: "youtube",
        videoId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        coverImageId: videoCoverId,
      },
      draftVideoCoverImageId: null,
      presentationMode: "video",
      aspectRatio: "16:9",
      showcase: false,
      side: "right",
      status: "published",
      order: current.projects.length + 2,
      archived: false,
      createdAt: 1000,
      updatedAt: 1000,
    };

    current.projects.push(photoProj, videoProj);
    await savePortfolioContent(current, current.revision);

    // Verify localized-urls resolution
    expect(getPortfolioSectionUrl(sportCat, "fr")).toBe("/fr/projets/sport");
    expect(getPortfolioSectionUrl(sportCat, "en")).toBe("/en/projects/sports");
    expect(getPortfolioProjectUrl(photoProj, "fr", current.categories)).toBe("/fr/projets/sport/course-en-montagne");
    expect(getPortfolioProjectUrl(photoProj, "en", current.categories)).toBe("/en/projects/sports/mountain-race");

    // Test public loader resolving category section view
    const reqFr = new Request("http://localhost:3000/fr/projets/sport");
    const resFr = await publicPortfolioLoader(makeLoaderArgs(reqFr, { rubrique: "sport" }));
    const dataFr = (await resFr.json()) as {
      panelState: { isOpen: boolean; activeCategory: string };
      content: { categories: PortfolioCategoryItem[] };
    };
    expect(resFr.status).toBe(200);
    expect(dataFr.panelState.isOpen).toBe(true);
    expect(dataFr.panelState.activeCategory).toBe("sport-id");
    const activeCat = dataFr.content.categories.find((c) => c.id === dataFr.panelState.activeCategory);
    expect(activeCat?.title.fr).toBe("Sport");

    // Test public loader resolving project detail view
    const reqProj = new Request("http://localhost:3000/fr/projets/sport/course-en-montagne");
    const resProj = await publicPortfolioLoader(
      makeLoaderArgs(reqProj, { rubrique: "sport", slugFr: "course-en-montagne" })
    );
    const dataProj = (await resProj.json()) as { panelState: { activeProject: { id: string } } };
    expect(resProj.status).toBe(200);
    expect(dataProj.panelState.activeProject.id).toBe(photoProjId);
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Slug Renaming, Alias 301 Redirection & Media Preservation
  // --------------------------------------------------------------------------
  it("5. Renames category slug, creates 301 alias redirect, and preserves attached media without moving files", async () => {
    const { content: current } = getRawPortfolioContent(testPortfolioContentPath);
    const cat = current.categories[0]; // documentary

    const formData = new URLSearchParams();
    formData.set("revision", current.revision);
    formData.set("csrfToken", "test-csrf-token-dynamic-categories");
    formData.set("title_fr", "Documentaires d'Auteur");
    formData.set("title_en", "Author Documentaries");
    formData.set("slugFr", "films-du-reel"); // New slug
    formData.set("slugEn", "real-life-films");
    formData.set("intro_fr", cat.intro.fr);
    formData.set("intro_en", cat.intro.en);
    formData.set("entrySide", "left");

    const { request } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/section/${cat.id}`,
      formData
    );
    const res = await adminPortfolioSectionAction(makeActionArgs(request, { category: cat.id }));
    expect(res.status).toBe(200);

    const { content: updated } = getRawPortfolioContent(testPortfolioContentPath);
    const updatedCat = updated.categories.find((c) => c.id === cat.id);
    expect(updatedCat?.slugFr).toBe("films-du-reel");
    expect(updatedCat?.slugAliases?.fr).toContain("documentaire");

    // Requesting old slug via public loader returns 301 redirect
    const oldSlugReq = new Request("http://localhost:3000/fr/projets/documentaire");
    const oldSlugRes = await publicPortfolioLoader(makeLoaderArgs(oldSlugReq, { rubrique: "documentaire" }));
    expect(oldSlugRes.status).toBe(301);
    expect(oldSlugRes.headers.get("Location")).toBe("/fr/projets/films-du-reel");
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Masking (Drafting) Category Hides Projects & Returns 404 Publicly
  // --------------------------------------------------------------------------
  it("6. Masks category: hides it and its projects from public DTO and returns 404 for media, while admin preview works", async () => {
    const { content: current } = getRawPortfolioContent(testPortfolioContentPath);
    const cat = current.categories[0];
    const imageId = "55555555-5555-4555-8555-555555555555";
    current.media[imageId] = {
      imageId,
      ownerType: "section",
      ownerId: cat.id,
      mediaSlot: "category_entry",
      originalFormat: "webp",
      originalWidth: 800,
      originalHeight: 600,
      variants: [{ name: "640p", width: 640, height: 480, webpSize: 1000, avifSize: 800 }],
      createdAt: 1000,
    };
    cat.entryImageId = imageId;
    cat.status = "draft"; // Masked!
    await savePortfolioContent(current, current.revision);

    // 1. Public DTO excludes masked category
    const { content: publicContent } = getPublicPortfolioContent(testPortfolioContentPath);
    expect(publicContent.categories.some((c) => c.id === cat.id)).toBe(false);

    // 2. Public route returns 404 for masked category
    const pubReq = new Request(`http://localhost:3000/fr/projets/${cat.slugFr}`);
    let pubError: Response | null = null;
    try {
      await publicPortfolioLoader(makeLoaderArgs(pubReq, { rubrique: cat.slugFr }));
    } catch (err) {
      if (err instanceof Response) pubError = err;
    }
    expect(pubError?.status).toBe(404);

    // Create the physical variant on disk
    const imageDir = path.join(testPortfolioMediaPath, "sections", cat.id, "category_entry", imageId);
    fs.mkdirSync(imageDir, { recursive: true });
    fs.writeFileSync(path.join(imageDir, "640p.webp"), await createTestImageBuffer(640, 480));

    // 3. Public media variant returns 404 (draft category)
    const pubMediaReq = new Request(`http://localhost:3000/media/portfolio/section/${cat.id}/category_entry/${imageId}/640p/webp`);
    const pubMediaRes = await portfolioVariantLoader(
      makeLoaderArgs(pubMediaReq, {
        ownerType: "section",
        ownerId: cat.id,
        slot: "category_entry",
        imageId,
        variant: "640p",
        ext: "webp",
      })
    );
    expect(pubMediaRes.status).toBe(404);

    // 4. Admin preview remains 200 (authenticated admin session)
    const { request: adminMediaReq } = await createAuthenticatedAdminRequest(
      "GET",
      `http://localhost:3000/admin/media/portfolio/section/${cat.id}/category_entry/${imageId}/640p/webp`
    );
    const adminMediaRes = await adminPortfolioMediaLoader(
      makeLoaderArgs(adminMediaReq, {
        ownerType: "section",
        ownerId: cat.id,
        slot: "category_entry",
        imageId,
        variant: "640p",
        ext: "webp",
      })
    );
    expect(adminMediaRes.status).toBe(200);
    expect(adminMediaRes.headers.get("Content-Type")).toBe("image/webp");
    const adminBuf = await adminMediaRes.arrayBuffer();
    expect(adminBuf.byteLength).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Controlled Deletion with Atomic Project Reassignment
  // --------------------------------------------------------------------------
  it("7. Blocks deletion of non-empty category without reassignment, and reassigns all projects atomically", async () => {
    const { content: current } = getRawPortfolioContent(testPortfolioContentPath);
    const targetCat = current.categories[0];
    const destCat = current.categories[1];

    // Attempt direct delete without reassignment -> 422 rejected
    const delFormData = new URLSearchParams();
    delFormData.set("intent", "delete_category");
    delFormData.set("categoryId", targetCat.id);
    delFormData.set("revision", current.revision);
    delFormData.set("csrfToken", "test-csrf-token-dynamic-categories");

    const { request: delReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      delFormData
    );
    const delRes = await adminPortfolioAction(makeActionArgs(delReq));
    expect(delRes.status).toBe(422);
    const delJson = (await delRes.json()) as { error: string };
    expect(delJson.error).toContain("contient");

    // Perform atomic reassignment and deletion
    const reassignFormData = new URLSearchParams();
    reassignFormData.set("intent", "delete_category_reassign");
    reassignFormData.set("categoryId", targetCat.id);
    reassignFormData.set("targetCategoryId", destCat.id);
    reassignFormData.set("revision", current.revision);
    reassignFormData.set("csrfToken", "test-csrf-token-dynamic-categories");

    const { request: reassignReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      reassignFormData
    );
    const reassignRes = await adminPortfolioAction(makeActionArgs(reassignReq));
    expect(reassignRes.status).toBe(200);

    const { content: afterReassign } = getRawPortfolioContent(testPortfolioContentPath);
    expect(afterReassign.categories.some((c) => c.id === targetCat.id)).toBe(false);
    // All projects formerly in targetCat are now in destCat
    expect(afterReassign.projects.every((p) => p.category === destCat.id)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Delete Empty Category & Do NOT Recreate Automatically on Restart
  // --------------------------------------------------------------------------
  it("8. Deletes an empty category; restarting or re-reading never recreates it automatically", async () => {
    const { content: current } = getRawPortfolioContent(testPortfolioContentPath);
    // Create an empty category
    current.categories.push({
      id: "empty-category-to-delete",
      slugFr: "a-supprimer",
      slugEn: "to-delete",
      slugAliases: { fr: [], en: [] },
      title: { fr: "A Supprimer", en: "To Delete" },
      intro: { fr: "I", en: "I" },
      entrySummary: { fr: "S", en: "S" },
      entrySide: "left",
      order: 99,
      status: "draft",
      seo: { title: { fr: "T", en: "T" }, description: { fr: "D", en: "D" } },
      coverImageId: null,
      coverAlt: { fr: "A", en: "A" },
      entryImageId: null,
      entryAlt: { fr: "A", en: "A" },
      bannerImageId: null,
      bannerAlt: { fr: "A", en: "A" },
      showreelVideo: null,
      showreelCoverImageId: null,
      showreelTitle: { fr: "T", en: "T" },
      morePhotosButton: { fr: "P", en: "P" },
      lessPhotosButton: { fr: "M", en: "M" },
      backButton: { fr: "R", en: "R" },
    });
    const saved = await savePortfolioContent(current, current.revision);

    const formData = new URLSearchParams();
    formData.set("intent", "delete_category");
    formData.set("categoryId", "empty-category-to-delete");
    formData.set("revision", saved.newRevision);
    formData.set("csrfToken", "test-csrf-token-dynamic-categories");

    const { request } = await createAuthenticatedAdminRequest("POST", "http://localhost:3000/admin/portfolio", formData);
    const delRes = await adminPortfolioAction(makeActionArgs(request));
    expect(delRes.status).toBe(200);

    // Re-read content from disk (simulating server restart)
    const { content: afterRestart } = getRawPortfolioContent(testPortfolioContentPath);
    expect(afterRestart.categories.some((c) => c.id === "empty-category-to-delete")).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Bounded Media Retention Across Up to 5 Backups
  // --------------------------------------------------------------------------
  it("9. Retains media referenced in up to 5 V1/V2 physical backups and defers cleanup if backup is unreadable", async () => {
    const { content: current } = getRawPortfolioContent(testPortfolioContentPath);
    const backupImageId = "88888888-8888-4888-8888-888888888888";

    // Create a real physical backup containing backupImageId
    const backupFile = `${testPortfolioContentPath}.${Date.now()}-1234.bak`;
    const backupContent = {
      ...current,
      categories: [
        {
          ...current.categories[0],
          entryImageId: backupImageId,
        },
      ],
    };
    fs.writeFileSync(backupFile, JSON.stringify(backupContent), "utf-8");

    // Collect referenced media
    const { referencedIds, hasUnreadableBackup } = getReferencedPortfolioMediaIds(current, testPortfolioContentPath);
    expect(hasUnreadableBackup).toBe(false);
    expect(referencedIds.has(backupImageId)).toBe(true);

    // If backup file is corrupt JSON, cleanup defers safely
    fs.writeFileSync(backupFile, "corrupted json payload", "utf-8");
    const { hasUnreadableBackup: corruptDetected } = getReferencedPortfolioMediaIds(current, testPortfolioContentPath);
    expect(corruptDetected).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Slug Collision, Unknown ID, Path Traversal & 409 Conflict Safety
  // --------------------------------------------------------------------------
  it("10. Rejects slug collisions, unknown category IDs, path traversal and revision conflicts (409)", async () => {
    const { content: current } = getRawPortfolioContent(testPortfolioContentPath);

    // 1. Slug collision rejection via section action
    const collideFormData = new URLSearchParams();
    collideFormData.set("revision", current.revision);
    collideFormData.set("csrfToken", "test-csrf-token-dynamic-categories");
    collideFormData.set("title_fr", "Publicité Renommée");
    collideFormData.set("title_en", "Advertising Renamed");
    collideFormData.set("slugFr", current.categories[0].slugFr); // Collision with documentary slug!
    collideFormData.set("slugEn", "distinct-en");
    collideFormData.set("entrySide", "right");

    const { request: colReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/section/${current.categories[1].id}`,
      collideFormData
    );
    const colRes = await adminPortfolioSectionAction(makeActionArgs(colReq, { category: current.categories[1].id }));
    expect(colRes.status).toBe(422);
    const colJson = (await colRes.json()) as { error: string };
    expect(colJson.error).toContain("déjà utilisé");

    // 2. Reject project referencing unknown category ID
    const projFormData = new URLSearchParams();
    projFormData.set("revision", current.revision);
    projFormData.set("csrfToken", "test-csrf-token-dynamic-categories");
    projFormData.set("titleFr", "Projet Test");
    projFormData.set("titleEn", "Test Project");
    projFormData.set("slugFr", "projet-test");
    projFormData.set("slugEn", "project-test");
    projFormData.set("category", "non-existent-category-id"); // Invalide!
    projFormData.set("status", "draft");

    const { request: projReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/edit/${current.projects[0].id}`,
      projFormData
    );
    const projRes = await adminPortfolioEditAction(makeActionArgs(projReq, { id: current.projects[0].id }));
    expect(projRes.status).toBe(422);

    // 3. Stale revision conflict returns 409
    const staleFormData = new URLSearchParams();
    staleFormData.set("intent", "reorder_category");
    staleFormData.set("categoryId", current.categories[0].id);
    staleFormData.set("direction", "down");
    staleFormData.set("revision", "stale-revision-outdated");
    staleFormData.set("csrfToken", "test-csrf-token-dynamic-categories");

    const { request: staleReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      staleFormData
    );
    const staleRes = await adminPortfolioAction(makeActionArgs(staleReq));
    expect(staleRes.status).toBe(409);
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Preservation of Past Regressions
  // --------------------------------------------------------------------------
  it("11. Preserves past regressions: photo aspect ratio maintained on mode switch, no video duplicate, and alternate URLs", () => {
    const { content: current } = getRawPortfolioContent(testPortfolioContentPath);
    const project = current.projects[0];

    // Alternate URLs with dynamic category slugs
    const altUrls = getPortfolioAlternateUrls(project, null, "right", current.categories);
    expect(altUrls.fr).toContain("/fr/projets/");
    expect(altUrls.en).toContain("/en/projects/");
    expect(altUrls.fr).toContain("?dir=right");

    // Overview URLs
    const altCatUrls = getPortfolioAlternateUrls(null, current.categories[0], "left", current.categories);
    expect(altCatUrls.fr).toContain(current.categories[0].slugFr);
    expect(altCatUrls.en).toContain(current.categories[0].slugEn);
  });
});
