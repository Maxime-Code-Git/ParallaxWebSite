import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isLocalPreviewMode, ENV } from "../app/lib/env.server";

describe("PARALLAX_LOCAL_PREVIEW mode and session security", () => {
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
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";

    expect(() => isLocalPreviewMode()).toThrow("incompatible avec TRUST_PROXY=true");
  });

  it("strictly rejects preview mode if PUBLIC_SITE_URL is a public domain", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.PUBLIC_SITE_URL = "http://parallax.studio";

    expect(() => isLocalPreviewMode()).toThrow("n'est autorise qu'avec une URL HTTP sur 127.0.0.1 ou localhost");
  });

  it("strictly rejects preview mode if PUBLIC_SITE_URL uses https on localhost", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.PUBLIC_SITE_URL = "https://127.0.0.1:3000";

    expect(() => isLocalPreviewMode()).toThrow("n'est autorise qu'avec une URL HTTP sur 127.0.0.1 ou localhost");
  });

  it("accepts preview mode with valid 127.0.0.1 HTTP loopback and TRUST_PROXY=false", () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
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

  it("preview-login loader throws 404 when not in preview mode", async () => {
    delete process.env.PARALLAX_LOCAL_PREVIEW;
    const { loader } = await import("../app/routes/preview-login");
    await expect(loader()).rejects.toThrow();
  });

  it("preview-login loader redirects to /admin/dashboard with cookie in preview mode", async () => {
    process.env.PARALLAX_LOCAL_PREVIEW = "true";
    process.env.TRUST_PROXY = "false";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3020";
    process.env.ADMIN_SESSION_SECRET = "01234567890123456789012345678901";

    const authModule = await import("../app/lib/auth.server");
    vi.spyOn(authModule, "getAdminConfig").mockReturnValue({
      hash: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      secret: "01234567890123456789012345678901",
    });
    vi.spyOn(authModule, "computeCredentialVersion").mockReturnValue("test-version");

    const { loader } = await import("../app/routes/preview-login");
    const response = await loader();
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/dashboard");
    expect(response.headers.get("Set-Cookie")).toContain("__parallax_admin_session=");
  });
});
