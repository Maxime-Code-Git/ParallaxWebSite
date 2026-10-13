import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import type { ActionFunctionArgs } from "react-router";
import { action as uploadAction, loader as uploadLoader } from "../app/routes/api/admin-media-upload";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { getRawSiteContent } from "../app/lib/site-content.server";

describe("admin-media-upload.ts API route", () => {
  let tempDir: string;
  let testContentFile: string;
  let testDbFile: string;
  let testMediaDir: string;
  const originalEnv = process.env;

  const makeActionArgs = (req: Request): ActionFunctionArgs =>
    ({
      request: req,
      params: {},
      context: {} as never,
    }) as unknown as ActionFunctionArgs;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-upload-route-test-"));
    testContentFile = path.join(tempDir, "site-content.json");
    testDbFile = path.join(tempDir, "rate-limit.sqlite");
    testMediaDir = path.join(tempDir, "site-media");
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
      SITE_MEDIA_PATH: testMediaDir,
      TRUST_PROXY: "false",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createValidAdminCookie(csrfToken = "valid-csrf-token"): Promise<string> {
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    session.set("csrfToken", csrfToken);
    return commitSession(session);
  }

  async function createMultipartBody(
    fileName: string,
    mimeType: string,
    fileBuffer: Buffer
  ): Promise<{ body: Uint8Array; boundary: string }> {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const total = Buffer.concat([head, fileBuffer, tail]);
    return { body: new Uint8Array(total), boundary };
  }

  it("loader rejects GET with 405 Method Not Allowed and Allow: POST", async () => {
    const res = await uploadLoader();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("action rejects non-POST request with 405", async () => {
    const req = new Request("http://localhost:3000/api/admin/media-upload", { method: "PUT" });
    const res = await uploadAction(makeActionArgs(req));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("action rejects unauthenticated request", async () => {
    const req = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
      },
    });

    await expect(uploadAction(makeActionArgs(req))).rejects.toThrow();
  });

  it("action rejects request with mismatched CSRF token", async () => {
    const cookie = await createValidAdminCookie("token-abc");
    const req = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "x-csrf-token": "wrong-token",
        "x-media-location": "showreel_cover",
      },
    });

    const res = await uploadAction(makeActionArgs(req));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/CSRF/i);
  });

  it("action rejects invalid location", async () => {
    const cookie = await createValidAdminCookie("token-abc");
    const { content } = getRawSiteContent();
    const req = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "x-csrf-token": "token-abc",
        "x-media-location": "invalid_location",
        "x-content-revision": content.revision,
      },
    });

    const res = await uploadAction(makeActionArgs(req));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Emplacement non valide/);
  });

  it("action rejects outdated revision with 409 Conflict", async () => {
    const cookie = await createValidAdminCookie("token-abc");
    const req = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "x-csrf-token": "token-abc",
        "x-media-location": "showreel_cover",
        "x-content-revision": "0".repeat(32),
      },
    });

    const res = await uploadAction(makeActionArgs(req));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.conflict).toBe(true);
  });

  it("action handles revert to reference image successfully", async () => {
    const cookie = await createValidAdminCookie("token-abc");
    const { content } = getRawSiteContent();

    const req = new Request("http://localhost:3000/api/admin/media-upload", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "x-csrf-token": "token-abc",
        "x-media-location": "showreel_cover",
        "x-content-revision": content.revision,
        "x-media-action": "revert",
      },
    });

    const res = await uploadAction(makeActionArgs(req));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.imageId).toBe("index-showreel");
    expect(json.isDefault).toBe(true);
    expect(json.newRevision).toBeDefined();

    // Verify persisted content has default image
    const updated = getRawSiteContent();
    expect(updated.content.home.showreel.coverImageId).toBe("index-showreel");
    expect(updated.content.revision).toBe(json.newRevision);
  });

  it("action accepts valid multipart JPEG upload and updates active content atomically", async () => {
    const cookie = await createValidAdminCookie("token-abc");
    const { content } = getRawSiteContent();

    // Generate real test JPEG
    const imgBuffer = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: { r: 50, g: 100, b: 150 } },
    })
      .jpeg()
      .toBuffer();

    const { body, boundary } = await createMultipartBody("cover.jpg", "image/jpeg", imgBuffer);

    const req = new Request(
      "http://localhost:3000/api/admin/media-upload",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "x-csrf-token": "token-abc",
          "x-media-location": "showreel_cover",
          "x-content-revision": content.revision,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length.toString(),
        },
        body: body as unknown as BodyInit,
        duplex: "half",
      } as RequestInit
    );

    const res = await uploadAction(makeActionArgs(req));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.imageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(json.mediaMetadata).toBeDefined();
    expect(json.mediaMetadata.location).toBe("showreel_cover");
    expect(json.mediaMetadata.variants.length).toBeGreaterThan(0);

    // Verify active content has been updated with new imageId and newRevision
    const updated = getRawSiteContent();
    expect(updated.content.home.showreel.coverImageId).toBe(json.imageId);
    expect(updated.content.revision).toBe(json.newRevision);
    expect(updated.content.media?.[json.imageId]).toBeDefined();

    // Verify variant files actually exist on disk
    const variantPath = path.join(testMediaDir, "site", "showreel_cover", json.imageId, "640p", `${json.imageId}-640p.webp`);
    expect(fs.existsSync(variantPath)).toBe(true);
  });

  it("action rejects fake image file with 422 and preserves original content", async () => {
    const cookie = await createValidAdminCookie("token-abc");
    const { content } = getRawSiteContent();
    const fakeBuffer = Buffer.from("Not an image, plain text file content");

    const { body, boundary } = await createMultipartBody("fake.jpg", "image/jpeg", fakeBuffer);

    const req = new Request(
      "http://localhost:3000/api/admin/media-upload",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "x-csrf-token": "token-abc",
          "x-media-location": "duo",
          "x-content-revision": content.revision,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length.toString(),
        },
        body: body as unknown as BodyInit,
        duplex: "half",
      } as RequestInit
    );

    const res = await uploadAction(makeActionArgs(req));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/Format d'image non supporté/);

    // Verify original content was untouched
    const after = getRawSiteContent();
    expect(after.content.revision).toBe(content.revision);
    expect(after.content.home.duo.imageId).toBe(content.home.duo.imageId);
  });
});
