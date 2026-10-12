// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

vi.mock("../../../scripts/env-loader.js", () => ({}));

describe("Environment Validation (env.server.ts)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should accept valid HTTP URL for PUBLIC_SITE_URL in development and test", async () => {
    process.env.PUBLIC_SITE_URL = "http://localhost:3000";
    const { ENV } = await import("../app/lib/env.server");
    expect(ENV.PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });

  it("should reject invalid URL protocol for PUBLIC_SITE_URL", async () => {
    process.env.PUBLIC_SITE_URL = "ftp://localhost:3000";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.PUBLIC_SITE_URL).toThrow("CRITICAL: PUBLIC_SITE_URL");
  });

  it("should reject non-HTTPS URL in production for PUBLIC_SITE_URL", async () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_SITE_URL = "http://example.com";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.PUBLIC_SITE_URL).toThrow("CRITICAL: PUBLIC_SITE_URL doit obligatoirement utiliser https:// en production");
  });

  it("should accept valid HTTPS URL in production for PUBLIC_SITE_URL", async () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_SITE_URL = "https://parallax.studio";
    const { ENV } = await import("../app/lib/env.server");
    expect(ENV.PUBLIC_SITE_URL).toBe("https://parallax.studio");
  });

  it("should validate ADMIN_PASSWORD_HASH format", async () => {
    process.env.ADMIN_PASSWORD_HASH = "$bcrypt$invalid";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.ADMIN_PASSWORD_HASH).toThrow("Argon2id");

    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$valid";
    expect(ENV.ADMIN_PASSWORD_HASH).toBe("$argon2id$v=19$m=19456,t=2,p=1$valid");
  });

  it("should validate ADMIN_SESSION_SECRET minimum length (32 chars)", async () => {
    process.env.ADMIN_SESSION_SECRET = "too-short";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.ADMIN_SESSION_SECRET).toThrow("au moins 32 caracteres");

    process.env.ADMIN_SESSION_SECRET = "a".repeat(32);
    expect(ENV.ADMIN_SESSION_SECRET).toBe("a".repeat(32));
  });

  it("should validate RATE_LIMIT_SECRET minimum length (32 chars)", async () => {
    delete process.env.RATE_LIMIT_SECRET;
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.RATE_LIMIT_SECRET).toThrow("au moins 32 caracteres");

    process.env.RATE_LIMIT_SECRET = "short";
    expect(() => ENV.RATE_LIMIT_SECRET).toThrow("au moins 32 caracteres");

    process.env.RATE_LIMIT_SECRET = "b".repeat(32);
    expect(ENV.RATE_LIMIT_SECRET).toBe("b".repeat(32));
  });

  it("should validate RATE_LIMIT_DB_PATH in test must be under os.tmpdir()", async () => {
    process.env.RATE_LIMIT_DB_PATH = "/etc/rate-limit.sqlite";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.RATE_LIMIT_DB_PATH).toThrow("os.tmpdir()");

    const validTestPath = path.join(os.tmpdir(), "test-rate-limit.sqlite");
    process.env.RATE_LIMIT_DB_PATH = validTestPath;
    expect(ENV.RATE_LIMIT_DB_PATH).toBe(validTestPath);
  });

  it("should reject RATE_LIMIT_DB_PATH under forbidden directories (public/build)", async () => {
    const tmpSub = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-test-"));
    process.env.RATE_LIMIT_DB_PATH = path.join(process.cwd(), "public", "rate-limit.sqlite");
    process.env.NODE_ENV = "production";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.RATE_LIMIT_DB_PATH).toThrow("ne doit pas etre sous les dossiers public ou build");
    fs.rmSync(tmpSub, { recursive: true, force: true });
  });

  it("should reject symlink on RATE_LIMIT_DB_PATH", async () => {
    const tmpSub = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-test-sym-"));
    const realFile = path.join(tmpSub, "real.sqlite");
    fs.writeFileSync(realFile, "");
    const symlinkFile = path.join(tmpSub, "sym.sqlite");
    fs.symlinkSync(realFile, symlinkFile);

    process.env.RATE_LIMIT_DB_PATH = symlinkFile;
    process.env.NODE_ENV = "production";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.RATE_LIMIT_DB_PATH).toThrow("ne doit pas etre un lien symbolique");

    fs.rmSync(tmpSub, { recursive: true, force: true });
  });

  it("should evaluate TRUST_PROXY boolean correctly", async () => {
    process.env.TRUST_PROXY = "true";
    const { ENV: env1 } = await import("../app/lib/env.server");
    expect(env1.TRUST_PROXY).toBe(true);

    process.env.TRUST_PROXY = "false";
    expect(env1.TRUST_PROXY).toBe(false);

    delete process.env.TRUST_PROXY;
    expect(env1.TRUST_PROXY).toBe(false);
  });
});
