import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { isLocalPreviewMode, ENV } from "../app/lib/env.server";
import routes from "../app/routes";

describe("PARALLAX_LOCAL_PREVIEW mode and security constraints", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns false when PARALLAX_LOCAL_PREVIEW is not set", () => {
    delete process.env.PARALLAX_LOCAL_PREVIEW;
    expect(isLocalPreviewMode()).toBe(false);
  });

  it("strictly rejects preview mode if TRUST_PROXY is true", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "true";
    process.env.HOST = "127.0.0.1";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";

    expect(() => isLocalPreviewMode()).toThrow("incompatible avec TRUST_PROXY=true");
  });

  it("strictly rejects preview mode if TRUST_PROXY is not explicitly false", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    delete process.env.TRUST_PROXY;
    process.env.HOST = "127.0.0.1";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";

    expect(() => isLocalPreviewMode()).toThrow("exige explicitement TRUST_PROXY=false");
  });

  it("strictly rejects preview mode if HOST is 0.0.0.0 (non-loopback)", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.HOST = "0.0.0.0";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";

    expect(() => isLocalPreviewMode()).toThrow("exige un bind loopback local explicite (HOST=127.0.0.1 ou localhost). Bind '0.0.0.0' interdit.");
  });

  it("strictly rejects preview mode if HOST is external IP or not loopback", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.HOST = "192.168.1.50";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";

    expect(() => isLocalPreviewMode()).toThrow("Bind '192.168.1.50' interdit");
  });

  it("strictly rejects preview mode if PUBLIC_SITE_URL is a public domain", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.HOST = "127.0.0.1";
    process.env.PUBLIC_SITE_URL = "http://parallax.studio";

    expect(() => isLocalPreviewMode()).toThrow("n'est autorise qu'avec une URL HTTP sur 127.0.0.1 ou localhost");
  });

  it("strictly rejects preview mode if PUBLIC_SITE_URL uses https on localhost", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.HOST = "127.0.0.1";
    process.env.PUBLIC_SITE_URL = "https://127.0.0.1:3000";

    expect(() => isLocalPreviewMode()).toThrow("n'est autorise qu'avec une URL HTTP sur 127.0.0.1 ou localhost");
  });

  it("accepts preview mode with valid 127.0.0.1 HTTP loopback, explicit HOST and TRUST_PROXY=false", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.HOST = "127.0.0.1";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3020";

    expect(isLocalPreviewMode()).toBe(true);
    expect(ENV.PUBLIC_SITE_URL).toBe("http://127.0.0.1:3020");
  });

  it("maintains HTTPS requirement in standard production when PARALLAX_LOCAL_PREVIEW is absent", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PARALLAX_LOCAL_PREVIEW;
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";

    expect(() => ENV.PUBLIC_SITE_URL).toThrow("PUBLIC_SITE_URL doit obligatoirement utiliser https:// en production");
  });

  it("confirms /preview/login route is completely removed and does not exist in routes", () => {
    const routePaths = routes.map((r: { path?: string }) => r.path).filter(Boolean);
    expect(routePaths).not.toContain("preview/login");
    expect(routePaths).not.toContain("preview");
    expect(routePaths.some((p: string | undefined) => p === "preview" || p?.startsWith("preview/"))).toBe(false);
  });

  it("requires authentication for admin dashboard even in preview mode (no auto-auth)", async () => {
    process.env.NODE_ENV = "test";
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.HOST = "127.0.0.1";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3020";
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";
    process.env.ADMIN_SESSION_SECRET = "01234567890123456789012345678901";
    process.env.RATE_LIMIT_SECRET = "rate-limit-secret-min-32-chars-long-2!";
    process.env.RATE_LIMIT_DB_PATH = path.join(os.tmpdir(), "rate-limit.sqlite");

    const { requireValidAdminSession } = await import("../app/lib/admin-auth.server");
    const request = new Request("http://127.0.0.1:3020/admin/dashboard");

    // Unauthenticated request must throw Response redirect to /admin with 303
    try {
      await requireValidAdminSession(request);
      expect.unreachable("Should have redirected");
    } catch (response: unknown) {
      expect(response).toBeInstanceOf(Response);
      const res = response as Response;
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/admin");
    }
  });
});
