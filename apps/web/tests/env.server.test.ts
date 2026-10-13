// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { execFile } from "node:child_process";

vi.mock("../../../scripts/env-loader.js", () => ({
  getMonorepoRoot: () => path.resolve(__dirname, "../../.."),
}));

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

  it("should validate standard Argon2id format for ADMIN_PASSWORD_HASH", async () => {
    process.env.ADMIN_PASSWORD_HASH = "$bcrypt$invalid";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.ADMIN_PASSWORD_HASH).toThrow("Argon2id");

    process.env.ADMIN_PASSWORD_HASH = "$argon2id$incomplete";
    expect(() => ENV.ADMIN_PASSWORD_HASH).toThrow("Argon2id");

    const validHash = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";
    process.env.ADMIN_PASSWORD_HASH = validHash;
    expect(ENV.ADMIN_PASSWORD_HASH).toBe(validHash);
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

  it("should reject RATE_LIMIT_DB_PATH inside the repository in dev and prod", async () => {
    const insideRepoPath = path.resolve(__dirname, "../../data/rate-limit.sqlite");
    process.env.RATE_LIMIT_DB_PATH = insideRepoPath;
    process.env.NODE_ENV = "production";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.RATE_LIMIT_DB_PATH).toThrow("ne doit pas se trouver dans le depot");
  });

  it("should reject symlinks on the file or in ancestor components", async () => {
    const tmpSub = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-test-sym-"));
    const realFile = path.join(tmpSub, "real.sqlite");
    fs.writeFileSync(realFile, "");
    const symlinkFile = path.join(tmpSub, "sym.sqlite");
    fs.symlinkSync(realFile, symlinkFile);

    process.env.RATE_LIMIT_DB_PATH = symlinkFile;
    process.env.NODE_ENV = "test";
    const { ENV } = await import("../app/lib/env.server");
    expect(() => ENV.RATE_LIMIT_DB_PATH).toThrow("ne doit pas etre un lien symbolique");

    // Ancestor symlink check
    const realDir = path.join(tmpSub, "real_dir");
    fs.mkdirSync(realDir);
    const symlinkDir = path.join(tmpSub, "sym_dir");
    fs.symlinkSync(realDir, symlinkDir);
    process.env.RATE_LIMIT_DB_PATH = path.join(symlinkDir, "file.sqlite");
    expect(() => ENV.RATE_LIMIT_DB_PATH).toThrow("ne doit pas etre un lien symbolique");

    fs.rmSync(tmpSub, { recursive: true, force: true });
  });

  it("validateAdminConfig validates complete configuration and distinct secrets", async () => {
    const { validateAdminConfig } = await import("../app/lib/env.server");

    process.env.PUBLIC_SITE_URL = "http://localhost:3000";
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";
    process.env.ADMIN_SESSION_SECRET = "session-secret-min-32-chars-long-1!";
    process.env.RATE_LIMIT_SECRET = "session-secret-min-32-chars-long-1!"; // Identical!
    process.env.RATE_LIMIT_DB_PATH = path.join(os.tmpdir(), "rate-limit.sqlite");

    // Identical secrets must throw
    expect(() => validateAdminConfig()).toThrow("doivent obligatoirement etre distincts");

    // Distinct secrets must succeed
    process.env.RATE_LIMIT_SECRET = "rate-limit-secret-min-32-chars-long-2!";
    const config = validateAdminConfig();
    expect(config.sessionSecret).not.toBe(config.rateLimitSecret);
    expect(config.hash).toBe(process.env.ADMIN_PASSWORD_HASH);
  });

  describe("validate-startup.js production pre-check CLI", () => {
    const scriptPath = path.resolve(__dirname, "../scripts/validate-startup.js");

    it("rejects execution with exit code 1 when configuration is missing", async () => {
      await new Promise<void>((resolve, reject) => {
        execFile(
          "node",
          [scriptPath],
          {
            env: {
              PATH: process.env.PATH,
              NODE_ENV: "production",
            },
          },
          (error, _stdout, stderr) => {
            try {
              expect(error).not.toBeNull();
              expect(error?.code).toBe(1);
              expect(stderr).toContain("Erreur critique de configuration au demarrage");
              resolve();
            } catch (err) {
              reject(err);
            }
          }
        );
      });
    });

    it("accepts execution with exit code 0 when artificial configuration is valid without requiring future variables", async () => {
      const validDir = fs.realpathSync(os.tmpdir());
      const validDbPath = path.join(validDir, `startup-test-${Date.now()}.sqlite`);
      const validContentPath = path.join(validDir, `startup-content-test-${Date.now()}.json`);
      const validMediaPath = path.join(validDir, `startup-media-test-${Date.now()}`);
      fs.mkdirSync(validMediaPath, { recursive: true, mode: 0o700 });
      await new Promise<void>((resolve, reject) => {
        execFile(
          "node",
          [scriptPath],
          {
            env: {
              PATH: process.env.PATH,
              NODE_ENV: "production",
              PUBLIC_SITE_URL: "https://parallax.example.com",
              ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
              ADMIN_SESSION_SECRET: "valid-session-secret-min-32-chars-long!",
              RATE_LIMIT_SECRET: "valid-ratelimit-secret-min-32-chars-long!",
              RATE_LIMIT_DB_PATH: validDbPath,
              SITE_CONTENT_PATH: validContentPath,
              SITE_MEDIA_PATH: validMediaPath,
              TRUST_PROXY: "false",
            },
          },
          (error, stdout) => {
            try {
              expect(error).toBeNull();
              expect(stdout).toContain("Configuration de demarrage valide avec succes");
              resolve();
            } catch (err) {
              reject(err);
            }
          }
        );
      });
    });

    it("validates valid SITE_MEDIA_PATH when provided to validate-startup.js", async () => {
      const validDir = fs.realpathSync(os.tmpdir());
      const validDbPath = path.join(validDir, `startup-test-media-${Date.now()}.sqlite`);
      const validContentPath = path.join(validDir, `startup-content-test-media-${Date.now()}.json`);
      const validMediaPath = path.join(validDir, `startup-media-dir-${Date.now()}`);
      fs.mkdirSync(validMediaPath, { recursive: true, mode: 0o700 });

      await new Promise<void>((resolve, reject) => {
        execFile(
          "node",
          [scriptPath],
          {
            env: {
              PATH: process.env.PATH,
              NODE_ENV: "production",
              PUBLIC_SITE_URL: "https://parallax.example.com",
              ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
              ADMIN_SESSION_SECRET: "valid-session-secret-min-32-chars-long!",
              RATE_LIMIT_SECRET: "valid-ratelimit-secret-min-32-chars-long!",
              RATE_LIMIT_DB_PATH: validDbPath,
              SITE_CONTENT_PATH: validContentPath,
              SITE_MEDIA_PATH: validMediaPath,
              TRUST_PROXY: "false",
            },
          },
          (error, stdout) => {
            try {
              expect(error).toBeNull();
              expect(stdout).toContain("Configuration de demarrage valide avec succes");
              resolve();
            } catch (err) {
              reject(err);
            }
          }
        );
      });
    });
  });
});
