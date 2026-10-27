import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import crypto from "node:crypto";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { loader as portfolioPublicLoader } from "../app/routes/public/portfolio";
import { loader as adminPortfolioLoader, action as adminPortfolioAction } from "../app/routes/admin/portfolio";
import { loader as adminPortfolioEditLoader, action as adminPortfolioEditAction } from "../app/routes/admin/portfolio-edit";
import { action as adminPortfolioUploadAction } from "../app/routes/api/admin-portfolio-upload";
import { loader as portfolioVariantLoader } from "../app/routes/media/portfolio-variant";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import {
  type PortfolioContent,
  MAX_PORTFOLIO_PROJECT_GALLERY_PHOTOS,
} from "../app/lib/portfolio-content.shared";
import { getRawPortfolioContent } from "../app/lib/portfolio-content.server";

describe("Portfolio Gallery Limit: 21 Photos (Lot 3 Extension)", () => {
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
        background: { r: 50, g: 120, b: 200 },
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
    const csrfToken = "test-csrf-token-limit-21-photos";
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-limit-"));
    testPortfolioContent = path.join(tempDir, "portfolio-content.json");
    testPortfolioMedia = path.join(tempDir, "portfolio-media");
    testSiteContent = path.join(tempDir, "site-content.json");
    testSiteMedia = path.join(tempDir, "site-media");
    testDbFile = path.join(tempDir, "rate-limit.sqlite");

    fs.mkdirSync(testPortfolioMedia, { mode: 0o700, recursive: true });
    fs.mkdirSync(testSiteMedia, { mode: 0o700, recursive: true });

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

  async function setupProjectWithPhotos(photoCount: number): Promise<{
    projectId: string;
    coverId: string;
    galleryIds: string[];
    revision: string;
  }> {
    // 1. Initialize content via admin loader
    const { request: adminReq } = await createAuthenticatedAdminRequest();
    const adminLoaderRes = await adminPortfolioLoader(makeLoaderArgs(adminReq));
    const adminData = (await adminLoaderRes.json()) as { content: PortfolioContent };

    // 2. Create project
    const fdCreate = new FormData();
    fdCreate.set("intent", "create");
    fdCreate.set("category", "documentary");
    fdCreate.set("revision", adminData.content.revision);
    fdCreate.set("csrfToken", "test-csrf-token-limit-21-photos");

    const { request: createReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      fdCreate
    );
    const createRes = await adminPortfolioAction(makeActionArgs(createReq));
    const createData = (await createRes.json()) as { success?: string; createdId?: string; newRevision?: string; error?: string };
    if (!createData.createdId) {
      throw new Error(`Create failed with status ${createRes.status}: ${JSON.stringify(createData)}`);
    }
    const projectId = createData.createdId;
    const currentRevision = createData.newRevision || "";

    // 3. Upload cover image
    const imgBuffer = await createTestImageBuffer();
    const { body: coverBody, boundary: coverBoundary } = createMultipartBody("cover.jpg", "image/jpeg", imgBuffer);
    const { request: coverReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/api/admin/portfolio/upload",
      coverBody,
      {
        "Content-Type": `multipart/form-data; boundary=${coverBoundary}`,
        "x-csrf-token": "test-csrf-token-limit-21-photos",
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": projectId,
        "x-portfolio-media-slot": "cover",
        "x-portfolio-revision": currentRevision,
      }
    );
    const coverRes = await adminPortfolioUploadAction(makeActionArgs(coverReq));
    const coverData = (await coverRes.json()) as { success?: boolean; imageId: string; newRevision: string };
    if (!coverData.imageId) {
      throw new Error(`Cover upload failed with status ${coverRes.status}: ${JSON.stringify(coverData)}`);
    }
    const coverId = coverData.imageId;

    // 4. Directly inject mock gallery images into raw content for speed and consistency
    const { content } = getRawPortfolioContent();
    const proj = content.projects.find((p) => p.id === projectId);
    if (!proj) throw new Error("Project not found");

    const galleryIds: string[] = [];
    for (let i = 0; i < photoCount; i++) {
      const gid = crypto.randomUUID();
      galleryIds.push(gid);
      content.media[gid] = {
        imageId: gid,
        ownerType: "project",
        ownerId: projectId,
        mediaSlot: "gallery",
        originalFormat: "jpeg",
        originalWidth: 1920,
        originalHeight: 1080,
        createdAt: Date.now(),
        variants: [
          { name: "640p", width: 640, height: 360, avifSize: 500, webpSize: 600 },
          { name: "960p", width: 960, height: 540, avifSize: 800, webpSize: 900 },
          { name: "1440p", width: 1440, height: 810, avifSize: 1200, webpSize: 1300 },
          { name: "1920p", width: 1920, height: 1080, avifSize: 1600, webpSize: 1700 },
        ],
      };

      // Create variant file on disk
      const variantDir = path.join(testPortfolioMedia, "projects", projectId, "gallery", gid);
      fs.mkdirSync(variantDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(variantDir, "640p.webp"), "test-webp-data", { mode: 0o600 });
    }

    fs.writeFileSync(testPortfolioContent, JSON.stringify(content, null, 2), "utf-8");

    return { projectId, coverId, galleryIds, revision: content.revision };
  }

  it("verifies MAX_PORTFOLIO_PROJECT_GALLERY_PHOTOS constant is 21", () => {
    expect(MAX_PORTFOLIO_PROJECT_GALLERY_PHOTOS).toBe(21);
  });

  it("accepts and persists exactly 21 photos in admin portfolio-edit after reload", async () => {
    const { projectId, coverId, galleryIds, revision } = await setupProjectWithPhotos(21);
    expect(galleryIds.length).toBe(21);

    const fdEdit = new FormData();
    fdEdit.set("revision", revision);
    fdEdit.set("csrfToken", "test-csrf-token-limit-21-photos");
    fdEdit.set("titleFr", "Projet 21 Photos");
    fdEdit.set("titleEn", "Project 21 Photos");
    fdEdit.set("slugFr", "projet-21-photos");
    fdEdit.set("slugEn", "project-21-photos");
    fdEdit.set("category", "documentary");
    fdEdit.set("summaryFr", "Court résumé");
    fdEdit.set("summaryEn", "Short summary");
    fdEdit.set("descriptionFr", "Description complète du projet avec 21 photos.");
    fdEdit.set("descriptionEn", "Full project description with 21 photos.");
    fdEdit.set("status", "published");
    fdEdit.set("coverImageId", coverId);
    fdEdit.set("coverAltFr", "Couverture");
    fdEdit.set("coverAltEn", "Cover");
    fdEdit.set("galleryImageIds", JSON.stringify(galleryIds));

    const { request: editReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${projectId}`,
      fdEdit
    );

    const editRes = await adminPortfolioEditAction(makeActionArgs(editReq, { id: projectId }));
    const editData = (await editRes.json()) as { success?: string; newRevision?: string; error?: string };

    expect(editRes.status).toBe(200);
    expect(editData.success).toContain("succès");

    // Verify persistence after reload via admin edit loader
    const { request: reloadReq } = await createAuthenticatedAdminRequest(
      "GET",
      `http://localhost:3000/admin/portfolio/${projectId}`
    );
    const reloadRes = await adminPortfolioEditLoader(makeLoaderArgs(reloadReq, { id: projectId }));
    const reloadData = (await reloadRes.json()) as {
      project: { galleryImageIds: string[] };
    };

    expect(reloadData.project.galleryImageIds.length).toBe(21);
    expect(reloadData.project.galleryImageIds).toEqual(galleryIds);
  });

  it("rejects 22 photos in admin portfolio-edit with a clear 422 error", async () => {
    const { projectId, coverId, galleryIds, revision } = await setupProjectWithPhotos(22);
    expect(galleryIds.length).toBe(22);

    const fdEdit = new FormData();
    fdEdit.set("revision", revision);
    fdEdit.set("csrfToken", "test-csrf-token-limit-21-photos");
    fdEdit.set("titleFr", "Projet 22 Photos");
    fdEdit.set("titleEn", "Project 22 Photos");
    fdEdit.set("slugFr", "projet-22-photos");
    fdEdit.set("slugEn", "project-22-photos");
    fdEdit.set("category", "documentary");
    fdEdit.set("summaryFr", "Court résumé");
    fdEdit.set("summaryEn", "Short summary");
    fdEdit.set("descriptionFr", "Description complète.");
    fdEdit.set("descriptionEn", "Full description.");
    fdEdit.set("status", "published");
    fdEdit.set("coverImageId", coverId);
    fdEdit.set("coverAltFr", "Couverture");
    fdEdit.set("coverAltEn", "Cover");
    fdEdit.set("galleryImageIds", JSON.stringify(galleryIds));

    const { request: editReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${projectId}`,
      fdEdit
    );

    const editRes = await adminPortfolioEditAction(makeActionArgs(editReq, { id: projectId }));
    const editData = (await editRes.json()) as { error: string };

    expect(editRes.status).toBe(422);
    expect(editData.error).toBe("Un projet ne peut pas comporter plus de 21 photos dans sa galerie.");
  });

  it("rejects uploading a 22nd photo via upload API when project already has 21 photos", async () => {
    const { projectId, galleryIds, revision } = await setupProjectWithPhotos(21);

    // Save project with 21 gallery photos
    const { content } = getRawPortfolioContent();
    const proj = content.projects.find((p) => p.id === projectId);
    if (!proj) throw new Error("Project not found");
    proj.galleryImageIds = galleryIds;
    fs.writeFileSync(testPortfolioContent, JSON.stringify(content, null, 2), "utf-8");

    // Attempt to upload a 22nd gallery photo
    const imgBuffer = await createTestImageBuffer();
    const { body, boundary } = createMultipartBody("photo22.jpg", "image/jpeg", imgBuffer);
    const { request: uploadReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/api/admin/portfolio/upload",
      body,
      {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-csrf-token": "test-csrf-token-limit-21-photos",
        "x-portfolio-owner-type": "project",
        "x-portfolio-owner-id": projectId,
        "x-portfolio-media-slot": "gallery",
        "x-portfolio-revision": revision,
      }
    );

    const uploadRes = await adminPortfolioUploadAction(makeActionArgs(uploadReq));
    const uploadData = (await uploadRes.json()) as { error: string };

    expect(uploadRes.status).toBe(422);
    expect(uploadData.error).toBe("La galerie photos d'un projet est limitée à un maximum de 21 photos.");
  });

  it("displays all 21 photos on the public portfolio page and authorizes media variant access", async () => {
    const { projectId, coverId, galleryIds, revision } = await setupProjectWithPhotos(21);

    // Save and publish project with all 21 photos
    const fdEdit = new FormData();
    fdEdit.set("revision", revision);
    fdEdit.set("csrfToken", "test-csrf-token-limit-21-photos");
    fdEdit.set("titleFr", "Projet Public 21");
    fdEdit.set("titleEn", "Public Project 21");
    fdEdit.set("slugFr", "projet-public-21");
    fdEdit.set("slugEn", "public-project-21");
    fdEdit.set("category", "documentary");
    fdEdit.set("summaryFr", "Résumé");
    fdEdit.set("summaryEn", "Summary");
    fdEdit.set("descriptionFr", "Description complète.");
    fdEdit.set("descriptionEn", "Full description.");
    fdEdit.set("status", "published");
    fdEdit.set("coverImageId", coverId);
    fdEdit.set("coverAltFr", "Couverture");
    fdEdit.set("coverAltEn", "Cover");
    fdEdit.set("galleryImageIds", JSON.stringify(galleryIds));

    const { request: editReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${projectId}`,
      fdEdit
    );
    await adminPortfolioEditAction(makeActionArgs(editReq, { id: projectId }));

    // 1. Fetch public portfolio
    const pubReq = new Request("http://localhost:3000/fr/projets/documentaire/projet-public-21");
    const pubRes = await portfolioPublicLoader(
      makeLoaderArgs(pubReq, { rubrique: "documentaire", slugFr: "projet-public-21" })
    );
    const pubData = (await pubRes.json()) as {
      panelState: { activeProject: { id: string; galleryImageIds: string[] } | null };
      content: PortfolioContent;
    };

    expect(pubData.panelState.activeProject).toBeDefined();
    expect(pubData.panelState.activeProject?.id).toBe(projectId);
    expect(pubData.panelState.activeProject?.galleryImageIds.length).toBe(21);
    for (const gid of galleryIds) {
      expect(pubData.panelState.activeProject?.galleryImageIds).toContain(gid);
      expect(pubData.content.media[gid]).toBeDefined();
    }

    // 2. Verify all 21 gallery image variants are authorized via portfolioVariantLoader (HTTP 200)
    for (let i = 0; i < 21; i++) {
      const gid = galleryIds[i];
      const variantReq = new Request(
        `http://localhost:3000/media/portfolio/project/${projectId}/${gid}/640p.webp`
      );
      const variantRes = await portfolioVariantLoader(
        makeLoaderArgs(variantReq, {
          ownerType: "project",
          ownerId: projectId,
          slot: "gallery",
          imageId: gid,
          variant: "640p",
          ext: "webp",
        })
      );
      expect(variantRes.status).toBe(200);
      expect(variantRes.headers.get("Content-Type")).toBe("image/webp");
    }
  });

  it("supports reordering and deletion of gallery photos among 21 photos", async () => {
    const { projectId, coverId, galleryIds, revision } = await setupProjectWithPhotos(21);

    // Initial save with 21 photos
    const fdEdit = new FormData();
    fdEdit.set("revision", revision);
    fdEdit.set("csrfToken", "test-csrf-token-limit-21-photos");
    fdEdit.set("titleFr", "Projet Reorder");
    fdEdit.set("titleEn", "Project Reorder");
    fdEdit.set("slugFr", "projet-reorder");
    fdEdit.set("slugEn", "project-reorder");
    fdEdit.set("category", "documentary");
    fdEdit.set("summaryFr", "Résumé");
    fdEdit.set("summaryEn", "Summary");
    fdEdit.set("descriptionFr", "Description");
    fdEdit.set("descriptionEn", "Description");
    fdEdit.set("status", "draft");
    fdEdit.set("coverImageId", coverId);
    fdEdit.set("coverAltFr", "Couverture");
    fdEdit.set("coverAltEn", "Cover");
    fdEdit.set("galleryImageIds", JSON.stringify(galleryIds));

    const { request: editReq1 } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${projectId}`,
      fdEdit
    );
    const editRes1 = await adminPortfolioEditAction(makeActionArgs(editReq1, { id: projectId }));
    const editData1 = (await editRes1.json()) as { newRevision: string };

    // 1. Reorder: swap first and last image
    const reorderedIds = [...galleryIds];
    const first = reorderedIds[0];
    const last = reorderedIds[20];
    reorderedIds[0] = last;
    reorderedIds[20] = first;

    const fdReorder = new FormData();
    fdReorder.set("revision", editData1.newRevision);
    fdReorder.set("csrfToken", "test-csrf-token-limit-21-photos");
    fdReorder.set("titleFr", "Projet Reorder");
    fdReorder.set("titleEn", "Project Reorder");
    fdReorder.set("slugFr", "projet-reorder");
    fdReorder.set("slugEn", "project-reorder");
    fdReorder.set("category", "documentary");
    fdReorder.set("summaryFr", "Résumé");
    fdReorder.set("summaryEn", "Summary");
    fdReorder.set("descriptionFr", "Description");
    fdReorder.set("descriptionEn", "Description");
    fdReorder.set("status", "draft");
    fdReorder.set("coverImageId", coverId);
    fdReorder.set("coverAltFr", "Couverture");
    fdReorder.set("coverAltEn", "Cover");
    fdReorder.set("galleryImageIds", JSON.stringify(reorderedIds));

    const { request: reorderReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${projectId}`,
      fdReorder
    );
    const reorderRes = await adminPortfolioEditAction(makeActionArgs(reorderReq, { id: projectId }));
    const reorderData = (await reorderRes.json()) as { newRevision: string };
    expect(reorderRes.status).toBe(200);

    // Verify reordering persisted
    const { content: reorderedContent } = getRawPortfolioContent();
    const reorderedProj = reorderedContent.projects.find((p) => p.id === projectId);
    expect(reorderedProj?.galleryImageIds[0]).toBe(last);
    expect(reorderedProj?.galleryImageIds[20]).toBe(first);

    // 2. Delete: remove one photo (now 20 photos)
    const deletedList = reorderedIds.slice(1); // removes index 0
    expect(deletedList.length).toBe(20);

    const fdDelete = new FormData();
    fdDelete.set("revision", reorderData.newRevision);
    fdDelete.set("csrfToken", "test-csrf-token-limit-21-photos");
    fdDelete.set("titleFr", "Projet Reorder");
    fdDelete.set("titleEn", "Project Reorder");
    fdDelete.set("slugFr", "projet-reorder");
    fdDelete.set("slugEn", "project-reorder");
    fdDelete.set("category", "documentary");
    fdDelete.set("summaryFr", "Résumé");
    fdDelete.set("summaryEn", "Summary");
    fdDelete.set("descriptionFr", "Description");
    fdDelete.set("descriptionEn", "Description");
    fdDelete.set("status", "draft");
    fdDelete.set("coverImageId", coverId);
    fdDelete.set("coverAltFr", "Couverture");
    fdDelete.set("coverAltEn", "Cover");
    fdDelete.set("galleryImageIds", JSON.stringify(deletedList));

    const { request: deleteReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${projectId}`,
      fdDelete
    );
    const deleteRes = await adminPortfolioEditAction(makeActionArgs(deleteReq, { id: projectId }));
    expect(deleteRes.status).toBe(200);

    const { content: deletedContent } = getRawPortfolioContent();
    const deletedProj = deletedContent.projects.find((p) => p.id === projectId);
    expect(deletedProj?.galleryImageIds.length).toBe(20);
    expect(deletedProj?.galleryImageIds).not.toContain(last);
  });

  it("allows projects with fewer than 21 photos (maximum, not mandatory)", async () => {
    const { projectId, coverId, galleryIds, revision } = await setupProjectWithPhotos(5);
    expect(galleryIds.length).toBe(5);

    const fdEdit = new FormData();
    fdEdit.set("revision", revision);
    fdEdit.set("csrfToken", "test-csrf-token-limit-21-photos");
    fdEdit.set("titleFr", "Projet 5 Photos");
    fdEdit.set("titleEn", "Project 5 Photos");
    fdEdit.set("slugFr", "projet-5-photos");
    fdEdit.set("slugEn", "project-5-photos");
    fdEdit.set("category", "documentary");
    fdEdit.set("summaryFr", "Résumé");
    fdEdit.set("summaryEn", "Summary");
    fdEdit.set("descriptionFr", "Description");
    fdEdit.set("descriptionEn", "Description");
    fdEdit.set("status", "draft");
    fdEdit.set("coverImageId", coverId);
    fdEdit.set("coverAltFr", "Couverture");
    fdEdit.set("coverAltEn", "Cover");
    fdEdit.set("galleryImageIds", JSON.stringify(galleryIds));

    const { request: editReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${projectId}`,
      fdEdit
    );
    const editRes = await adminPortfolioEditAction(makeActionArgs(editReq, { id: projectId }));
    expect(editRes.status).toBe(200);

    const { content } = getRawPortfolioContent();
    const proj = content.projects.find((p) => p.id === projectId);
    expect(proj?.galleryImageIds.length).toBe(5);
  });
});
