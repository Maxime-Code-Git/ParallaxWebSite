// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setupGalleryEnvironment } from "../../../scripts/gallery-setup.js";

describe("gallery-setup.js (npm run gallery:setup Idempotence & Security)", () => {
  let tmpDir: string;
  let testEnvPath: string;
  let testDataDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-setup-test-"));
    testEnvPath = path.join(tmpDir, ".env.local");
    testDataDir = path.join(tmpDir, "data");
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("configures fresh environment safely with 0600 file and 0700 directories", () => {
    const result = setupGalleryEnvironment({
      envPath: testEnvPath,
      dataDir: testDataDir,
      log: false,
    });

    expect(result.success).toBe(true);
    expect(result.configuredKeys.length).toBe(5);

    // Verify directories created
    expect(fs.existsSync(testDataDir)).toBe(true);
    expect(fs.existsSync(path.join(testDataDir, "gallery-media"))).toBe(true);
    expect(fs.existsSync(path.join(testDataDir, "gallery-import"))).toBe(true);

    // Verify .env.local created with 0600 permissions
    expect(fs.existsSync(testEnvPath)).toBe(true);
    const content = fs.readFileSync(testEnvPath, "utf-8");

    expect(content).toContain("GALLERY_DB_PATH=");
    expect(content).toContain("GALLERY_MEDIA_PATH=");
    expect(content).toContain("GALLERY_IMPORT_PATH=");
    expect(content).toContain("GALLERY_SECRET=");
    expect(content).toContain("GALLERY_CODE_ENCRYPTION_KEY=");

    // Extract secrets and verify 64-char hex format
    const secretMatch = content.match(/GALLERY_SECRET=([0-9a-fA-F]{64})/);
    const encKeyMatch = content.match(/GALLERY_CODE_ENCRYPTION_KEY=([0-9a-fA-F]{64})/);

    expect(secretMatch).not.toBeNull();
    expect(encKeyMatch).not.toBeNull();
    expect(secretMatch![1]).not.toBe(encKeyMatch![1]); // Must be distinct
  });

  it("executes idempotently without regenerating secrets or duplicating keys on second run", () => {
    // Run 1
    setupGalleryEnvironment({
      envPath: testEnvPath,
      dataDir: testDataDir,
      log: false,
    });
    const contentRun1 = fs.readFileSync(testEnvPath, "utf-8");

    // Run 2
    const resultRun2 = setupGalleryEnvironment({
      envPath: testEnvPath,
      dataDir: testDataDir,
      log: false,
    });

    expect(resultRun2.success).toBe(true);
    const contentRun2 = fs.readFileSync(testEnvPath, "utf-8");

    // Content should be 100% identical
    expect(contentRun2).toBe(contentRun1);

    // All keys should have status 'preserve'
    for (const item of resultRun2.configuredKeys) {
      expect(item.status).toBe("preserve");
    }
  });

  it("preserves pre-existing non-gallery configuration in .env.local", () => {
    const existingContent = [
      "ADMIN_PASSWORD_HASH=$argon2id$v=19$m=19456,t=2,p=1$custom-salt$custom-hash",
      "SITE_MEDIA_PATH=/custom/site-media",
      "PORTFOLIO_MEDIA_PATH=/custom/portfolio-media",
    ].join("\n");

    fs.writeFileSync(testEnvPath, existingContent, { mode: 0o600 });

    setupGalleryEnvironment({
      envPath: testEnvPath,
      dataDir: testDataDir,
      log: false,
    });

    const newContent = fs.readFileSync(testEnvPath, "utf-8");
    expect(newContent).toContain("ADMIN_PASSWORD_HASH=$argon2id$v=19$m=19456,t=2,p=1$custom-salt$custom-hash");
    expect(newContent).toContain("SITE_MEDIA_PATH=/custom/site-media");
    expect(newContent).toContain("PORTFOLIO_MEDIA_PATH=/custom/portfolio-media");
    expect(newContent).toContain("GALLERY_SECRET=");
  });

  it("respects dry-run mode without modifying filesystem", () => {
    const result = setupGalleryEnvironment({
      envPath: testEnvPath,
      dataDir: testDataDir,
      dryRun: true,
      log: false,
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(testEnvPath)).toBe(false);
    expect(fs.existsSync(testDataDir)).toBe(false);
  });

  it("rejects symbolic links for .env.local file", () => {
    const realFile = path.join(tmpDir, "real.env");
    fs.writeFileSync(realFile, "DUMMY=1");
    try {
      fs.symlinkSync(realFile, testEnvPath);
    } catch {
      return; // Skip on filesystems without symlink support
    }

    expect(() =>
      setupGalleryEnvironment({
        envPath: testEnvPath,
        dataDir: testDataDir,
        log: false,
      })
    ).toThrow("ne doit pas etre un lien symbolique");
  });
});
