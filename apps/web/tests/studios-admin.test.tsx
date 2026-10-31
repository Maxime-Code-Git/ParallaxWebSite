// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action as uploadAction } from "../app/routes/api/admin-media-upload";
import { loader as studiosAdminLoader, action as studiosAdminAction } from "../app/routes/admin/studios";
import { loader as siteVariantLoader } from "../app/routes/media/site-variant";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import {
  getRawSiteContent,
  getStudiosContent,
  saveHomeContent,
  saveContactPageContent,
  saveCompanyContent,
  getSiteContentFilePath,
  validateSiteContent,
} from "../app/lib/site-content.server";
import { cleanupUnreferencedMedia, getReferencedMediaIds } from "../app/lib/media-image.server";
import defaultSiteContent from "../app/content/default-site-content.json";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";
import type { StudiosContent } from "../app/lib/site-content.shared";

describe("Studios Admin Integration & Media Lifecycle", () => {
  let tempDir: string;
  let testContentFile: string;
  let testDbFile: string;
  let testMediaDir: string;
  let testPortfolioFile: string;
  const originalEnv = process.env;

  const makeActionArgs = (req: Request): ActionFunctionArgs =>
    ({
      request: req,
      params: {},
      context: {} as never,
    }) as unknown as ActionFunctionArgs;

  const makeLoaderArgs = (req: Request, params: Record<string, string | undefined> = {}): LoaderFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as LoaderFunctionArgs;

  const createValidAdminCookie = async (csrfToken = "test-csrf-token"): Promise<string> => {
    const session = await getSession();
    session.set("adminId", "admin-test-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    session.set("csrfToken", csrfToken);
    return commitSession(session);
  };

  const createMultipartBody = async (
    filename: string,
    mimeType: string,
    fileBuffer: Buffer
  ): Promise<{ body: BodyInit; boundary: string; byteLength: number }> => {
    const boundary = "---------------------------testboundary123456789";
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const total = Buffer.concat([head, fileBuffer, tail]);
    return { body: new Uint8Array(total) as unknown as BodyInit, boundary, byteLength: total.byteLength };
  };

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-studios-admin-test-"));
    testContentFile = path.join(tempDir, "site-content.json");
    testDbFile = path.join(tempDir, "rate-limit.sqlite");
    testMediaDir = path.join(tempDir, "site-media");
    testPortfolioFile = path.join(tempDir, "portfolio-content.json");

    fs.mkdirSync(testMediaDir, { mode: 0o700, recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      RATE_LIMIT_SECRET: "rate-limit-secret-min-32-chars-long-2!",
      RATE_LIMIT_DB_PATH: testDbFile,
      SITE_CONTENT_PATH: testContentFile,
      PORTFOLIO_CONTENT_PATH: testPortfolioFile,
      SITE_MEDIA_PATH: testMediaDir,
      TRUST_PROXY: "false",
    };

    // Seed initial site content (clean schemaVersion 3 without studios initially)
    fs.writeFileSync(
      testContentFile,
      JSON.stringify(defaultSiteContent, null, 2),
      { mode: 0o600 }
    );

    fs.writeFileSync(
      testPortfolioFile,
      JSON.stringify(createDefaultPortfolioContent(), null, 2),
      { mode: 0o600 }
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("1. SchemaVersion 3 documents without studios validate cleanly (backward compatibility)", () => {
    const raw = JSON.parse(fs.readFileSync(testContentFile, "utf-8"));
    delete raw.studios;
    const validated = validateSiteContent(raw);
    expect(validated.studios).toBeUndefined();
    expect(validated.schemaVersion).toBe(3);
  });

  it("2. Uploads real photograph to studios_sempra with sharp variants and staging", async () => {
    const cookie = await createValidAdminCookie("token-sempra");
    const { content: current } = getRawSiteContent();

    const imgBuffer = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 10, g: 60, b: 50 } },
    })
      .jpeg()
      .toBuffer();

    const { body, boundary, byteLength } = await createMultipartBody("sempra-ambiance.jpg", "image/jpeg", imgBuffer);

    const req = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(byteLength),
        "x-csrf-token": "token-sempra",
        "x-media-location": "studios_sempra",
        "x-content-revision": current.revision,
      },
      body,
    });

    const res = await uploadAction(makeActionArgs(req));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.imageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // Verify content updated
    const { content: updated } = getRawSiteContent();
    expect(updated.studios?.sempra.imageId).toBe(json.imageId);
    expect(updated.media?.[json.imageId]).toBeDefined();
    expect(updated.media?.[json.imageId].location).toBe("studios_sempra");

    // Verify variants created on disk
    const variantPath = path.join(
      testMediaDir,
      "site",
      "studios_sempra",
      json.imageId,
      "640p",
      `${json.imageId}-640p.webp`
    );
    expect(fs.existsSync(variantPath)).toBe(true);
  });

  it("3. Maintains two strictly independent images: sempra vs parallax", async () => {
    const cookie = await createValidAdminCookie("token-indep");

    // Upload SEMPRA image
    let current = getRawSiteContent().content;
    const imgBuffer1 = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 10, g: 40, b: 30 } },
    })
      .jpeg()
      .toBuffer();

    const { body: body1, boundary: bound1, byteLength: len1 } = await createMultipartBody("sempra.jpg", "image/jpeg", imgBuffer1);
    const req1 = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${bound1}`,
        "Content-Length": String(len1),
        "x-csrf-token": "token-indep",
        "x-media-location": "studios_sempra",
        "x-content-revision": current.revision,
      },
      body: body1,
    });
    const res1 = await uploadAction(makeActionArgs(req1));
    const json1 = await res1.json();
    expect(json1.success).toBe(true);

    // Upload Parallax image
    current = getRawSiteContent().content;
    const imgBuffer2 = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 20, g: 30, b: 60 } },
    })
      .jpeg()
      .toBuffer();

    const { body: body2, boundary: bound2, byteLength: len2 } = await createMultipartBody("parallax.jpg", "image/jpeg", imgBuffer2);
    const req2 = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${bound2}`,
        "Content-Length": String(len2),
        "x-csrf-token": "token-indep",
        "x-media-location": "studios_parallax",
        "x-content-revision": current.revision,
      },
      body: body2,
    });
    const res2 = await uploadAction(makeActionArgs(req2));
    const json2 = await res2.json();
    expect(json2.success).toBe(true);

    // Verify both images are set independently
    const updated = getRawSiteContent().content;
    expect(updated.studios?.sempra.imageId).toBe(json1.imageId);
    expect(updated.studios?.parallax.imageId).toBe(json2.imageId);
    expect(json1.imageId).not.toBe(json2.imageId);
  });

  it("4. Removes image via revert action, leaving purely brand colored background (imageId: null)", async () => {
    const cookie = await createValidAdminCookie("token-remove");

    // First upload an image to studios_sempra
    let current = getRawSiteContent().content;
    const imgBuffer = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 5, g: 30, b: 25 } },
    })
      .jpeg()
      .toBuffer();

    const { body, boundary, byteLength } = await createMultipartBody("temp.jpg", "image/jpeg", imgBuffer);
    const reqUpload = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(byteLength),
        "x-csrf-token": "token-remove",
        "x-media-location": "studios_sempra",
        "x-content-revision": current.revision,
      },
      body,
    });
    const resUpload = await uploadAction(makeActionArgs(reqUpload));
    const jsonUpload = await resUpload.json();
    expect(jsonUpload.success).toBe(true);

    // Now send revert action to remove it
    current = getRawSiteContent().content;
    const reqRevert = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "x-csrf-token": "token-remove",
        "x-media-location": "studios_sempra",
        "x-media-action": "revert",
        "x-content-revision": current.revision,
      },
    });

    const resRevert = await uploadAction(makeActionArgs(reqRevert));
    expect(resRevert.status).toBe(200);
    const jsonRevert = await resRevert.json();
    expect(jsonRevert.success).toBe(true);
    expect(jsonRevert.imageId).toBe("");
    expect(jsonRevert.isDefault).toBe(true);

    // Verify in content: imageId is strictly null (no fallback photo!)
    const updated = getRawSiteContent().content;
    expect(updated.studios?.sempra.imageId).toBeNull();
    // And unreferenced media was cleaned from registry
    expect(updated.media?.[jsonUpload.imageId]).toBeUndefined();
  });

  it("5. Preserves studios configuration and media registry when saving Home, Contact, or Company", async () => {
    const cookie = await createValidAdminCookie("token-preserve");

    // Upload a photo on studios_parallax
    let current = getRawSiteContent().content;
    const imgBuffer = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 15, b: 25 } },
    })
      .jpeg()
      .toBuffer();

    const { body, boundary, byteLength } = await createMultipartBody("parallax.jpg", "image/jpeg", imgBuffer);
    const reqUpload = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(byteLength),
        "x-csrf-token": "token-preserve",
        "x-media-location": "studios_parallax",
        "x-content-revision": current.revision,
      },
      body,
    });
    const resUpload = await uploadAction(makeActionArgs(reqUpload));
    const jsonUpload = await resUpload.json();
    const parallaxImageId = jsonUpload.imageId;

    // Save Home page
    current = getRawSiteContent().content;
    const rev1 = saveHomeContent(current.home, current.revision);
    const afterHome = getRawSiteContent().content;
    expect(afterHome.studios?.parallax.imageId).toBe(parallaxImageId);
    expect(afterHome.media?.[parallaxImageId]).toBeDefined();

    // Save Contact page
    const rev2 = saveContactPageContent(afterHome.contactPage, rev1);
    const afterContact = getRawSiteContent().content;
    expect(afterContact.studios?.parallax.imageId).toBe(parallaxImageId);
    expect(afterContact.media?.[parallaxImageId]).toBeDefined();

    // Save Company settings
    saveCompanyContent(afterContact.company, rev2);
    const afterCompany = getRawSiteContent().content;
    expect(afterCompany.studios?.parallax.imageId).toBe(parallaxImageId);
    expect(afterCompany.media?.[parallaxImageId]).toBeDefined();
  });

  it("6. Protects referenced studios media against orphan cleanup (disk & registry)", async () => {
    const cookie = await createValidAdminCookie("token-orphan");

    // Upload an image to studios_sempra
    const current = getRawSiteContent().content;
    const imgBuffer = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 60, b: 40 } },
    })
      .jpeg()
      .toBuffer();

    const { body, boundary, byteLength } = await createMultipartBody("sempra.jpg", "image/jpeg", imgBuffer);
    const reqUpload = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(byteLength),
        "x-csrf-token": "token-orphan",
        "x-media-location": "studios_sempra",
        "x-content-revision": current.revision,
      },
      body,
    });
    const resUpload = await uploadAction(makeActionArgs(reqUpload));
    const { imageId } = await resUpload.json();

    const activeContent = getRawSiteContent().content;
    const refIds = getReferencedMediaIds(activeContent, getSiteContentFilePath());
    expect(refIds.has(imageId.toLowerCase())).toBe(true);

    // Run cleanupUnreferencedMedia
    const cleanupResult = cleanupUnreferencedMedia(activeContent, testMediaDir, getSiteContentFilePath());
    // The active studios media should NOT be in the cleaned list
    const wasCleaned = cleanupResult.cleaned.some((p) => p.includes(imageId));
    expect(wasCleaned).toBe(false);

    // Verify variant files still exist on disk
    const variantPath = path.join(
      testMediaDir,
      "site",
      "studios_sempra",
      imageId,
      "640p",
      `${imageId}-640p.webp`
    );
    expect(fs.existsSync(variantPath)).toBe(true);
  });

  it("7. Serves variants when referenced in studios and returns 404 when unreferenced", async () => {
    const cookie = await createValidAdminCookie("token-variant");

    // Upload image to studios_parallax
    const current = getRawSiteContent().content;
    const imgBuffer = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 25, g: 30, b: 50 } },
    })
      .jpeg()
      .toBuffer();

    const { body, boundary, byteLength } = await createMultipartBody("parallax.jpg", "image/jpeg", imgBuffer);
    const reqUpload = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(byteLength),
        "x-csrf-token": "token-variant",
        "x-media-location": "studios_parallax",
        "x-content-revision": current.revision,
      },
      body,
    });
    const resUpload = await uploadAction(makeActionArgs(reqUpload));
    const { imageId } = await resUpload.json();

    // Request variant from site-variant loader
    const variantReq = new Request(
      `http://localhost:3000/media/site/studios_parallax/${imageId}/640p/webp`
    );
    const variantRes = await siteVariantLoader(
      makeLoaderArgs(variantReq, {
        location: "studios_parallax",
        imageId,
        variant: "640p",
        ext: "webp",
      })
    );
    expect(variantRes.status).toBe(200);
    expect(variantRes.headers.get("Content-Type")).toBe("image/webp");

    // Requesting with wrong location returns 404
    const wrongLocRes = await siteVariantLoader(
      makeLoaderArgs(variantReq, {
        location: "studios_sempra",
        imageId,
        variant: "640p",
        ext: "webp",
      })
    );
    expect(wrongLocRes.status).toBe(404);
  });

  it("8. /admin/studios loader and action handle framing configuration and revision conflict", async () => {
    const cookie = await createValidAdminCookie("token-studios-admin");

    // Test loader
    const loaderReq = new Request("http://localhost:3000/admin/studios", {
      headers: { Cookie: cookie },
    });
    const loaderRes = await studiosAdminLoader(makeLoaderArgs(loaderReq));
    expect(loaderRes.status).toBe(200);
    const loaderData = await loaderRes.json();
    expect(loaderData.csrfToken).toBe("token-studios-admin");
    expect(loaderData.studios).toEqual({
      sempra: { imageId: null, framing: "center" },
      parallax: { imageId: null, framing: "center" },
    });

    // Test action with valid framing update
    const current = getRawSiteContent().content;
    const studiosUpdate: StudiosContent = {
      sempra: { imageId: null, framing: "top" },
      parallax: { imageId: null, framing: "bottom" },
    };

    const actionBody = new URLSearchParams({
      csrfToken: "token-studios-admin",
      revision: current.revision,
      studiosData: JSON.stringify(studiosUpdate),
    });

    const actionReq = new Request("http://localhost:3000/admin/studios", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: actionBody.toString(),
    });

    const actionRes = await studiosAdminAction(makeActionArgs(actionReq));
    expect(actionRes.status).toBe(200);
    const actionJson = await actionRes.json();
    expect(actionJson.success).toBe(true);

    const reloaded = getStudiosContent();
    expect(reloaded.sempra.framing).toBe("top");
    expect(reloaded.parallax.framing).toBe("bottom");

    // Test revision conflict (409)
    const conflictBody = new URLSearchParams({
      csrfToken: "token-studios-admin",
      revision: "0123456789abcdef0123456789abcdef", // Outdated
      studiosData: JSON.stringify(studiosUpdate),
    });

    const conflictReq = new Request("http://localhost:3000/admin/studios", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: conflictBody.toString(),
    });

    const conflictRes = await studiosAdminAction(makeActionArgs(conflictReq));
    expect(conflictRes.status).toBe(409);
    const conflictJson = await conflictRes.json();
    expect(conflictJson.conflict).toBe(true);
    expect(conflictJson.error).toContain("Conflit de révision");
  });
});
