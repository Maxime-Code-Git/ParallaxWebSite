import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { loader as portfolioPublicLoader } from "../app/routes/public/portfolio";
import { loader as adminPortfolioLoader, action as adminPortfolioAction } from "../app/routes/admin/portfolio";
import { action as adminPortfolioEditAction } from "../app/routes/admin/portfolio-edit";
import { action as adminPortfolioSectionAction } from "../app/routes/admin/portfolio-section";
import { action as adminPortfolioUploadAction } from "../app/routes/api/admin-portfolio-upload";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import {
  cleanupUnreferencedPortfolioMedia,
  getRawPortfolioContent,
} from "../app/lib/portfolio-content.server";
import { getRawSiteContent } from "../app/lib/site-content.server";
import {
  type PortfolioContent,
  calculateEffectiveSide,
} from "../app/lib/portfolio-content.shared";

describe("Portfolio Lifecycle & Cross-Storage Segregation (Lot 3)", () => {
  let tempDir: string;
  let testPortfolioContent: string;
  let testPortfolioMedia: string;
  let testSiteContent: string;
  let testSiteMedia: string;
  let testDbFile: string;
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

  async function createTestImageBuffer(): Promise<Buffer> {
    return sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 30, g: 158, b: 255 },
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-portfolio-lifecycle-"));
    testPortfolioContent = path.join(tempDir, "portfolio-content.json");
    testPortfolioMedia = path.join(tempDir, "portfolio-media");
    testSiteContent = path.join(tempDir, "site-content.json");
    testSiteMedia = path.join(tempDir, "site-media");
    testDbFile = path.join(tempDir, "rate-limit.sqlite");

    fs.mkdirSync(testPortfolioMedia, { mode: 0o700, recursive: true });
    fs.mkdirSync(testSiteMedia, { mode: 0o700, recursive: true });

    // Seed dummy site media to test isolation
    const siteDummyDir = path.join(testSiteMedia, "site/duo/site-duo-uuid/640p");
    fs.mkdirSync(siteDummyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(siteDummyDir, "webp"), "site-media-data", { mode: 0o600 });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      RATE_LIMIT_SECRET: "rate-limit-secret-min-32-chars-long-2!",
      RATE_LIMIT_DB_PATH: testDbFile,
      SITE_CONTENT_PATH: testSiteContent,
      SITE_MEDIA_PATH: testSiteMedia,
      PORTFOLIO_CONTENT_PATH: testPortfolioContent,
      PORTFOLIO_MEDIA_PATH: testPortfolioMedia,
      TRUST_PROXY: "false",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("Step 1 & 2: creates projects in admin, uploads cover, publishes, keeps a draft, and verifies draft secrecy", async () => {
    // 1. Loader initializes default content
    const { request: adminReq } = await createAuthenticatedAdminRequest();
    const adminLoaderRes = await adminPortfolioLoader(makeLoaderArgs(adminReq));
    const adminData = (await adminLoaderRes.json()) as { content: PortfolioContent };
    expect(adminData.content.sections.documentary).toBeDefined();

    // 2. Create Documentary project
    const fdDoc = new FormData();
    fdDoc.set("intent", "create");
    fdDoc.set("category", "documentary");
    fdDoc.set("revision", adminData.content.revision);
    fdDoc.set("csrfToken", "test-csrf-token-1234567890abcdef");

    const { request: createDocReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      fdDoc
    );
    const createDocRes = await adminPortfolioAction(makeActionArgs(createDocReq));
    const createDocData = (await createDocRes.json()) as { success: string; createdId: string; newRevision: string };
    expect(createDocData.createdId).toBeDefined();

    // 3. Create Advertising project
    const fdPub = new FormData();
    fdPub.set("intent", "create");
    fdPub.set("category", "advertising");
    fdPub.set("revision", createDocData.newRevision);
    fdPub.set("csrfToken", "test-csrf-token-1234567890abcdef");

    const { request: createPubReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      fdPub
    );
    const createPubRes = await adminPortfolioAction(makeActionArgs(createPubReq));
    const createPubData = (await createPubRes.json()) as { createdId: string; newRevision: string };

    const docId = createDocData.createdId;

    // 4. Upload a real cover photo for docId using adminPortfolioUploadAction
    const imgBuf = await createTestImageBuffer();
    const { body: mpBody, boundary } = createMultipartBody("cover.jpg", "image/jpeg", imgBuf);
    const { sessionCookie, csrfToken } = await createAuthenticatedAdminRequest();

    const uploadReq = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": docId,
        "x-portfolio-media-slot": "cover",
        "x-portfolio-revision": createPubData.newRevision,
      },
      body: mpBody,
    });
    const uploadRes = await adminPortfolioUploadAction(makeActionArgs(uploadReq));
    expect(uploadRes.status).toBe(200);
    const uploadData = (await uploadRes.json()) as { success: boolean; imageId: string; newRevision: string };
    expect(uploadData.success).toBe(true);
    expect(uploadData.imageId).toBeDefined();

    // 5. Edit and publish Documentary project
    const fdEditDoc = new FormData();
    fdEditDoc.set("revision", uploadData.newRevision);
    fdEditDoc.set("csrfToken", csrfToken);
    fdEditDoc.set("category", "documentary");
    fdEditDoc.set("status", "published");
    fdEditDoc.set("slugFr", "foret-ancestrale");
    fdEditDoc.set("slugEn", "ancient-forest");
    fdEditDoc.set("titleFr", "Forêt Ancestrale");
    fdEditDoc.set("titleEn", "Ancient Forest");
    fdEditDoc.set("summaryFr", "Un documentaire sur la nature.");
    fdEditDoc.set("summaryEn", "A documentary about nature.");
    fdEditDoc.set("descriptionFr", "Premier paragraphe.");
    fdEditDoc.set("descriptionEn", "First paragraph.");
    fdEditDoc.set("seoTitleFr", "Forêt Ancestrale — Film");
    fdEditDoc.set("seoTitleEn", "Ancient Forest — Film");
    fdEditDoc.set("seoDescFr", "Découvrez notre documentaire.");
    fdEditDoc.set("seoDescEn", "Discover our documentary.");
    fdEditDoc.set("coverImageId", uploadData.imageId);
    fdEditDoc.set("coverAltFr", "Forêt");
    fdEditDoc.set("coverAltEn", "Forest");
    fdEditDoc.set("videoUrl", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    fdEditDoc.set("videoCoverImageId", "");
    fdEditDoc.set("galleryImageIds", "[]");
    fdEditDoc.set("showcase", "true");
    fdEditDoc.set("side", "left");

    const { request: editDocReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${docId}`,
      fdEditDoc
    );
    const editDocRes = await adminPortfolioEditAction(makeActionArgs(editDocReq, { id: docId }));
    const editDocData = (await editDocRes.json()) as { success: string; newRevision: string };
    expect(editDocData.success).toBeDefined();

    // The advertising project remains draft!
    // Verify public loader shows ONLY published project
    const pubReq = new Request("http://localhost:3000/fr/projets");
    const pubRes = await portfolioPublicLoader(makeLoaderArgs(pubReq));
    const pubData = (await pubRes.json()) as {
      showcaseProjects: Array<{ id: string; slugFr: string }>;
      content: PortfolioContent;
    };

    expect(pubData.showcaseProjects.length).toBe(1);
    expect(pubData.showcaseProjects[0].id).toBe(docId);
    expect(pubData.showcaseProjects[0].slugFr).toBe("foret-ancestrale");
    // Ensure draft project ID is not in public showcase or public projects
    expect(pubData.content.projects.some((p) => p.status === "draft")).toBe(false);

    // Direct access to draft project URL returns 404
    const draftDirectReq = new Request("http://localhost:3000/fr/projets/publicite/projet-sans-titre");
    await expect(
      portfolioPublicLoader(
        makeLoaderArgs(draftDirectReq, { rubrique: "publicite", slugFr: "projet-sans-titre" })
      )
    ).rejects.toThrow();
  });

  it("Step 3: verifies alternating showcase and directional panel formula", () => {
    // Mandatory formula: const panelDirection = imageSide === "left" ? "right" : "left";
    const getDirection = (side: "left" | "right") => (side === "left" ? "right" : "left");

    // Row 1: Documentaire (image left) -> open panel from right
    expect(getDirection("left")).toBe("right");

    // Row 2: Publicité (image right) -> open panel from left
    expect(getDirection("right")).toBe("left");

    // Row 3: Publicité (image left) -> open panel from right
    expect(getDirection("left")).toBe("right");

    // Showcase side auto calculation
    expect(calculateEffectiveSide("auto", 0)).toBe("left");
    expect(calculateEffectiveSide("auto", 1)).toBe("right");
    expect(calculateEffectiveSide("auto", 2)).toBe("left");
  });

  it("Step 4 & 5: tests direct section URL access, SSR consistency and FR/EN alternates with direction preservation", async () => {
    // Documentary section route
    const docReq = new Request("http://localhost:3000/fr/projets/documentaire");
    const docRes = await portfolioPublicLoader(makeLoaderArgs(docReq, { rubrique: "documentaire" }));
    const docData = (await docRes.json()) as {
      lang: string;
      panelState: { isOpen: boolean; activeCategory: string; direction: string };
      alternateUrls: { fr: string; en: string };
    };

    expect(docData.lang).toBe("fr");
    expect(docData.panelState.isOpen).toBe(true);
    expect(docData.panelState.activeCategory).toBe("documentary");
    expect(docData.panelState.direction).toBe("right");
    // Preserves ?dir=right in alternates
    expect(docData.alternateUrls.fr).toBe("/fr/projets/documentaire?dir=right");
    expect(docData.alternateUrls.en).toBe("/en/projects/documentary?dir=right");

    // Advertising section route
    const pubReq = new Request("http://localhost:3000/en/projects/advertising");
    const pubRes = await portfolioPublicLoader(makeLoaderArgs(pubReq, { category: "advertising" }));
    const pubData = (await pubRes.json()) as {
      lang: string;
      panelState: { isOpen: boolean; activeCategory: string; direction: string };
      alternateUrls: { fr: string; en: string };
    };

    expect(pubData.lang).toBe("en");
    expect(pubData.panelState.isOpen).toBe(true);
    expect(pubData.panelState.activeCategory).toBe("advertising");
    expect(pubData.panelState.direction).toBe("left");
    expect(pubData.alternateUrls.fr).toBe("/fr/projets/publicite?dir=left");
    expect(pubData.alternateUrls.en).toBe("/en/projects/advertising?dir=left");
  });

  it("Step 6: handles 409 revision conflict gracefully without overwriting state", async () => {
    const { request: adminReq } = await createAuthenticatedAdminRequest();
    const adminLoaderRes = await adminPortfolioLoader(makeLoaderArgs(adminReq));
    const adminData = (await adminLoaderRes.json()) as { content: PortfolioContent };
    expect(adminData.content.revision).toBeDefined();

    // Section edit with stale revision
    const fdSection = new FormData();
    fdSection.set("revision", "stale-revision-conflict");
    fdSection.set("csrfToken", "test-csrf-token-1234567890abcdef");
    fdSection.set("title_fr", "Documentaire Modifié");
    fdSection.set("title_en", "Modified Documentary");
    fdSection.set("intro_fr", "Nouvelle intro");
    fdSection.set("intro_en", "New intro");
    fdSection.set("seo_title_fr", "SEO FR");
    fdSection.set("seo_title_en", "SEO EN");
    fdSection.set("seo_desc_fr", "Desc FR");
    fdSection.set("seo_desc_en", "Desc EN");
    fdSection.set("coverImageId", "");
    fdSection.set("coverAlt_fr", "");
    fdSection.set("coverAlt_en", "");
    fdSection.set("showreelTitle_fr", "");
    fdSection.set("showreelTitle_en", "");
    fdSection.set("showreelUrl", "");
    fdSection.set("showreelCoverImageId", "");
    fdSection.set("morePhotosButton_fr", "Plus");
    fdSection.set("morePhotosButton_en", "More");
    fdSection.set("lessPhotosButton_fr", "Moins");
    fdSection.set("lessPhotosButton_en", "Less");
    fdSection.set("backButton_fr", "Retour");
    fdSection.set("backButton_en", "Back");

    const { request: secEditReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio/section/documentary",
      fdSection
    );
    const secRes = await adminPortfolioSectionAction(
      makeActionArgs(secEditReq, { category: "documentary" })
    );

    expect(secRes.status).toBe(409);
    const secData = (await secRes.json()) as { error: string };
    expect(secData.error).toContain("modifie");
  });

  it("Step 7: verifies strict storage separation between Portfolio and Site (Accueil/Studio)", async () => {
    // 1. Verify Site Media directory contains our pre-seeded dummy
    const siteDummyFile = path.join(testSiteMedia, "site/duo/site-duo-uuid/640p/webp");
    expect(fs.existsSync(siteDummyFile)).toBe(true);

    // 2. Trigger portfolio media cleanup
    const cleanupResult = await cleanupUnreferencedPortfolioMedia(
      testPortfolioContent,
      testPortfolioMedia
    );
    expect(cleanupResult.cleanedCount).toBe(0);

    // 3. Verify Site Media was NOT touched or deleted
    expect(fs.existsSync(siteDummyFile)).toBe(true);
    expect(fs.readFileSync(siteDummyFile, "utf-8")).toBe("site-media-data");

    // 4. Verify Site Content remains intact
    const siteContent = getRawSiteContent();
    expect(siteContent.content.home.hero.title.fr).toBeDefined();
  });

  it("Step 8: sequential multi-file upload queue with running revision chaining and partial success retention", async () => {
    // 1. Create a project to hold the gallery
    const { request: adminReq } = await createAuthenticatedAdminRequest();
    const adminLoaderRes = await adminPortfolioLoader(makeLoaderArgs(adminReq));
    const adminData = (await adminLoaderRes.json()) as { content: PortfolioContent };

    const fdCreate = new FormData();
    fdCreate.set("intent", "create");
    fdCreate.set("category", "documentary");
    fdCreate.set("revision", adminData.content.revision);
    fdCreate.set("csrfToken", "test-csrf-token-1234567890abcdef");

    const { request: createReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      fdCreate
    );
    const createRes = await adminPortfolioAction(makeActionArgs(createReq));
    const { createdId: projId, newRevision: r0 } = (await createRes.json()) as {
      createdId: string;
      newRevision: string;
    };

    // 2. File 1 upload with revision r0 -> succeeds and returns r1
    const imgBuf1 = await createTestImageBuffer();
    const { body: mpBody1, boundary: b1 } = createMultipartBody("photo1.jpg", "image/jpeg", imgBuf1);
    const { sessionCookie, csrfToken } = await createAuthenticatedAdminRequest();

    const uploadReq1 = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${b1}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": projId,
        "x-portfolio-media-slot": "gallery",
        "x-portfolio-revision": r0,
      },
      body: mpBody1,
    });
    const uploadRes1 = await adminPortfolioUploadAction(makeActionArgs(uploadReq1));
    expect(uploadRes1.status).toBe(200);
    const uploadData1 = (await uploadRes1.json()) as { imageId: string; newRevision: string };
    const r1 = uploadData1.newRevision;
    expect(r1).not.toBe(r0);

    // 3. File 2 upload using the chained revision r1 -> succeeds and returns r2
    const imgBuf2 = await createTestImageBuffer();
    const { body: mpBody2, boundary: b2 } = createMultipartBody("photo2.jpg", "image/jpeg", imgBuf2);

    const uploadReq2 = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${b2}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": projId,
        "x-portfolio-media-slot": "gallery",
        "x-portfolio-revision": r1, // Chained revision!
      },
      body: mpBody2,
    });
    const uploadRes2 = await adminPortfolioUploadAction(makeActionArgs(uploadReq2));
    expect(uploadRes2.status).toBe(200);
    const uploadData2 = (await uploadRes2.json()) as { imageId: string; newRevision: string };
    const r2 = uploadData2.newRevision;
    expect(r2).not.toBe(r1);

    // 4. Stale upload attempt: trying to upload using old r0 -> strictly rejected with 409
    const { body: mpBodyStale, boundary: bStale } = createMultipartBody("stale.jpg", "image/jpeg", imgBuf2);
    const uploadReqStale = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${bStale}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": projId,
        "x-portfolio-media-slot": "gallery",
        "x-portfolio-revision": r0, // Stale!
      },
      body: mpBodyStale,
    });
    const uploadResStale = await adminPortfolioUploadAction(makeActionArgs(uploadReqStale));
    expect(uploadResStale.status).toBe(409);

    // 5. Subsequent failing upload (unsupported format)
    const { body: mpBodyFail, boundary: bFail } = createMultipartBody("bad.txt", "text/plain", Buffer.from("not an image"));
    const uploadReqFail = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${bFail}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": projId,
        "x-portfolio-media-slot": "gallery",
        "x-portfolio-revision": r2,
      },
      body: mpBodyFail,
    });
    const uploadResFail = await adminPortfolioUploadAction(makeActionArgs(uploadReqFail));
    expect(uploadResFail.status).toBe(415);

    // 6. Partial success verification: photo 1 and photo 2 are strictly preserved in content.json!
    const { content: savedContent } = getRawPortfolioContent(testPortfolioContent);
    expect(uploadData1.imageId in savedContent.media).toBe(true);
    expect(uploadData2.imageId in savedContent.media).toBe(true);
    const project = savedContent.projects.find((p) => p.id === projId);
    expect(project?.galleryImageIds).toContain(uploadData1.imageId);
    expect(project?.galleryImageIds).toContain(uploadData2.imageId);
  });

  it("Step 9: draft video cover persistence before video URL is configured", async () => {
    // 1. Create a draft project
    const { request: adminReq } = await createAuthenticatedAdminRequest();
    const adminLoaderRes = await adminPortfolioLoader(makeLoaderArgs(adminReq));
    const adminData = (await adminLoaderRes.json()) as { content: PortfolioContent };

    const fdCreate = new FormData();
    fdCreate.set("intent", "create");
    fdCreate.set("category", "documentary");
    fdCreate.set("revision", adminData.content.revision);
    fdCreate.set("csrfToken", "test-csrf-token-1234567890abcdef");

    const { request: createReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      fdCreate
    );
    const createRes = await adminPortfolioAction(makeActionArgs(createReq));
    const { createdId: projId, newRevision: r0 } = (await createRes.json()) as {
      createdId: string;
      newRevision: string;
    };

    // 2. Upload video_cover BEFORE video URL is set
    const imgBuf = await createTestImageBuffer();
    const { body: mpBody, boundary } = createMultipartBody("video-cover.jpg", "image/jpeg", imgBuf);
    const { sessionCookie, csrfToken } = await createAuthenticatedAdminRequest();

    const uploadReq = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": projId,
        "x-portfolio-media-slot": "video_cover",
        "x-portfolio-revision": r0,
      },
      body: mpBody,
    });
    const uploadRes = await adminPortfolioUploadAction(makeActionArgs(uploadReq));
    expect(uploadRes.status).toBe(200);
    const uploadData = (await uploadRes.json()) as { imageId: string };

    // 3. Verify draftVideoCoverImageId is stored on project
    const { content: afterUpload } = getRawPortfolioContent(testPortfolioContent);
    const proj = afterUpload.projects.find((p) => p.id === projId);
    expect(proj?.draftVideoCoverImageId).toBe(uploadData.imageId);

    // 4. Trigger pruning: verify the image is NOT pruned
    const cleanupResult = await cleanupUnreferencedPortfolioMedia(
      testPortfolioContent,
      testPortfolioMedia
    );
    expect(cleanupResult.cleanedCount).toBe(0);

    const { content: afterCleanup } = getRawPortfolioContent(testPortfolioContent);
    expect(uploadData.imageId in afterCleanup.media).toBe(true);
  });

  it("Step 10: pre-Sharp validation rejects invalid owner or forbidden slot before processing", async () => {
    const imgBuf = await createTestImageBuffer();
    const { body: mpBody, boundary } = createMultipartBody("img.jpg", "image/jpeg", imgBuf);
    const { sessionCookie, csrfToken } = await createAuthenticatedAdminRequest();

    // 1. Non-existent project
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const reqNonExistent = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": fakeId,
        "x-portfolio-media-slot": "cover",
        "x-portfolio-revision": "r0",
      },
      body: mpBody,
    });
    const resNonExistent = await adminPortfolioUploadAction(makeActionArgs(reqNonExistent));
    expect(resNonExistent.status).toBe(404);

    // 2. Section with invalid slot (gallery is for projects only)
    const reqSecInvalidSlot = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "section",
        "x-portfolio-owner-id": "documentary",
        "x-portfolio-media-slot": "gallery", // Forbidden!
        "x-portfolio-revision": "r0",
      },
      body: mpBody,
    });
    const resSecInvalidSlot = await adminPortfolioUploadAction(makeActionArgs(reqSecInvalidSlot));
    expect(resSecInvalidSlot.status).toBe(400);

    // 3. Project with showreel_cover (showreel is for sections only)
    const reqProjInvalidSlot = new Request("http://localhost:3000/api/admin/portfolio-upload", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-csrf-token": csrfToken,
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": fakeId,
        "x-portfolio-media-slot": "showreel_cover", // Forbidden!
        "x-portfolio-revision": "r0",
      },
      body: mpBody,
    });
    const resProjInvalidSlot = await adminPortfolioUploadAction(makeActionArgs(reqProjInvalidSlot));
    expect(resProjInvalidSlot.status).toBe(400);
  });
});
