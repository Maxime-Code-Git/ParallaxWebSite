import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import defaultSiteContent from "../app/content/default-site-content.json";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";
import { performSiteBackup } from "../../../scripts/backup.js";
import { performSiteRestore } from "../../../scripts/restore.js";

describe("Complete Site Backup and Restoration Suite", () => {
  let tempFixtureDir: string;
  let backupOutputDir: string;
  let restoreTargetDir: string;

  let fixtureSiteContent: string;
  let fixtureSiteMedia: string;
  let fixturePortfolioContent: string;
  let fixturePortfolioMedia: string;
  let fixtureGalleryDb: string;
  let fixtureRateLimitDb: string;
  let fixtureGalleryImport: string;

  beforeEach(() => {
    tempFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-backup-fixture-"));
    backupOutputDir = path.join(tempFixtureDir, "backups");
    restoreTargetDir = path.join(tempFixtureDir, "restored");

    // 1. Prepare JSON fixtures
    fixtureSiteContent = path.join(tempFixtureDir, "site-content.json");
    fs.writeFileSync(fixtureSiteContent, JSON.stringify(defaultSiteContent, null, 2), "utf-8");

    fixturePortfolioContent = path.join(tempFixtureDir, "portfolio-content.json");
    fs.writeFileSync(fixturePortfolioContent, JSON.stringify(createDefaultPortfolioContent(), null, 2), "utf-8");

    // 2. Prepare media fixtures
    fixtureSiteMedia = path.join(tempFixtureDir, "media-site");
    fs.mkdirSync(fixtureSiteMedia, { recursive: true });
    fs.writeFileSync(path.join(fixtureSiteMedia, "test-site-image.webp"), Buffer.from("SITE_IMAGE_BYTES_12345"));

    fixturePortfolioMedia = path.join(tempFixtureDir, "media-portfolio");
    fs.mkdirSync(fixturePortfolioMedia, { recursive: true });
    fs.writeFileSync(path.join(fixturePortfolioMedia, "test-portfolio-image.webp"), Buffer.from("PORTFOLIO_IMAGE_BYTES_67890"));

    // 3. Prepare gallery imports
    fixtureGalleryImport = path.join(tempFixtureDir, "gallery-import");
    fs.mkdirSync(path.join(fixtureGalleryImport, "client-gallery-1"), { recursive: true });
    fs.writeFileSync(path.join(fixtureGalleryImport, "client-gallery-1", "photo1.jpg"), Buffer.from("PHOTO_1_BYTES"));

    // 4. Prepare SQLite databases with tables, WAL mode, and records
    fixtureGalleryDb = path.join(tempFixtureDir, "galleries.sqlite");
    const gdb = new DatabaseSync(fixtureGalleryDb);
    gdb.exec("PRAGMA journal_mode = WAL;");
    gdb.exec("CREATE TABLE galleries (id TEXT PRIMARY KEY, title TEXT);");
    gdb.exec("INSERT INTO galleries VALUES ('gal-1', 'Mariage Maxime & Sophie');");
    gdb.close();

    fixtureRateLimitDb = path.join(tempFixtureDir, "rate-limit.sqlite");
    const rdb = new DatabaseSync(fixtureRateLimitDb);
    rdb.exec("PRAGMA journal_mode = WAL;");
    rdb.exec("CREATE TABLE claims (claim_hash TEXT PRIMARY KEY, status TEXT);");
    rdb.exec("INSERT INTO claims VALUES ('hash-123', 'completed');");
    rdb.close();
  });

  afterEach(() => {
    if (fs.existsSync(tempFixtureDir)) {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true });
    }
  });

  it("performs dry-run without writing any files or directories", () => {
    const res = performSiteBackup({
      dryRun: true,
      outDir: path.join(backupOutputDir, "test-dry"),
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        SITE_MEDIA_PATH: fixtureSiteMedia,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        PORTFOLIO_MEDIA_PATH: fixturePortfolioMedia,
        GALLERY_DB_PATH: fixtureGalleryDb,
        RATE_LIMIT_DB_PATH: fixtureRateLimitDb,
        GALLERY_IMPORT_PATH: fixtureGalleryImport,
      },
    });

    expect(res.success).toBe(true);
    expect(res.dryRun).toBe(true);
    if (res.dryRun) {
      expect(res.totalEstimatedBytes).toBeGreaterThan(0);
      expect(fs.existsSync(res.backupDir)).toBe(false);
    }
  });

  it("creates a complete, consistent backup with SQLite VACUUM INTO snapshots and SHA-256 manifest", () => {
    const backupDir = path.join(backupOutputDir, "run-1");

    const res = performSiteBackup({
      dryRun: false,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        SITE_MEDIA_PATH: fixtureSiteMedia,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        PORTFOLIO_MEDIA_PATH: fixturePortfolioMedia,
        GALLERY_DB_PATH: fixtureGalleryDb,
        RATE_LIMIT_DB_PATH: fixtureRateLimitDb,
        GALLERY_IMPORT_PATH: fixtureGalleryImport,
      },
    });

    expect(res.success).toBe(true);
    expect(fs.existsSync(backupDir)).toBe(true);

    // Verify directory permissions 0700
    const dirStat = fs.statSync(backupDir);
    expect((dirStat.mode & 0o777).toString(8)).toBe("700");

    // Verify manifest.json
    const manifestPath = path.join(backupDir, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.totalFiles).toBeGreaterThanOrEqual(6);
    expect(manifest.totalBytes).toBeGreaterThan(0);

    // Verify every file exists in backup and is protected in mode 0600
    for (const f of manifest.files) {
      const fullP = path.join(backupDir, f.backupRelPath);
      expect(fs.existsSync(fullP)).toBe(true);
      const stat = fs.statSync(fullP);
      expect((stat.mode & 0o777).toString(8)).toBe("600");
    }

    // Verify verification-only on valid backup succeeds
    const verifyRes = performSiteRestore({
      backupDir,
      verifyOnly: true,
    });
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.verified).toBe(true);
  });

  it("detects tampered backup files during integrity check", () => {
    const backupDir = path.join(backupOutputDir, "run-tampered");

    performSiteBackup({
      dryRun: false,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        GALLERY_DB_PATH: fixtureGalleryDb,
      },
    });

    // Tamper with backed up site-content.json
    const backedUpContent = path.join(backupDir, "content/site-content.json");
    fs.appendFileSync(backedUpContent, " ");

    const res = performSiteRestore({
      backupDir,
      verifyOnly: true,
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe("INTEGRITY_CHECK_FAILED");
    expect(res.errors?.length).toBeGreaterThan(0);
    expect(res.errors?.[0]).toContain("Checksum SHA-256 invalide");
  });

  it("restores all components into an isolated destination and demonstrates SQLite and JSON readability", () => {
    const backupDir = path.join(backupOutputDir, "run-restore-test");

    performSiteBackup({
      dryRun: false,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        SITE_MEDIA_PATH: fixtureSiteMedia,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        PORTFOLIO_MEDIA_PATH: fixturePortfolioMedia,
        GALLERY_DB_PATH: fixtureGalleryDb,
        RATE_LIMIT_DB_PATH: fixtureRateLimitDb,
        GALLERY_IMPORT_PATH: fixtureGalleryImport,
      },
    });

    // Execute isolated restore
    const restoreRes = performSiteRestore({
      backupDir,
      targetDir: restoreTargetDir,
    });

    expect(restoreRes.success).toBe(true);
    expect(restoreRes.isIsolated).toBe(true);
    expect(restoreRes.restoredCount).toBeGreaterThanOrEqual(6);

    // 1. Verify restored SQLite database is readable and contains sample data
    const restoredGalleryDb = path.join(restoreTargetDir, "db/galleries.sqlite");
    expect(fs.existsSync(restoredGalleryDb)).toBe(true);

    const checkDb = new DatabaseSync(restoredGalleryDb, { readOnly: true });
    const rows = checkDb.prepare("SELECT id, title FROM galleries").all() as Array<{ id: string; title: string }>;
    expect(rows).toEqual([{ id: "gal-1", title: "Mariage Maxime & Sophie" }]);
    checkDb.close();

    // 2. Verify restored JSON files
    const restoredSiteJson = path.join(restoreTargetDir, "content/site-content.json");
    expect(fs.existsSync(restoredSiteJson)).toBe(true);
    const parsedSite = JSON.parse(fs.readFileSync(restoredSiteJson, "utf-8"));
    expect(parsedSite.schemaVersion).toBe(3);

    // 3. Verify restored media files
    const restoredMediaFile = path.join(restoreTargetDir, "media/site/test-site-image.webp");
    expect(fs.existsSync(restoredMediaFile)).toBe(true);
    expect(fs.readFileSync(restoredMediaFile).toString()).toBe("SITE_IMAGE_BYTES_12345");

    const restoredImportPhoto = path.join(restoreTargetDir, "imports/gallery-import/client-gallery-1/photo1.jpg");
    expect(fs.existsSync(restoredImportPhoto)).toBe(true);
    expect(fs.readFileSync(restoredImportPhoto).toString()).toBe("PHOTO_1_BYTES");
  });
});
