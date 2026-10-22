import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import defaultSiteContent from "../app/content/default-site-content.json";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";
import { performSiteBackup, computeSha256 } from "../../../scripts/backup.js";
import { performSiteRestore } from "../../../scripts/restore.js";

const rootDir = path.resolve(__dirname, "../../..");
const backupScriptPath = path.join(rootDir, "scripts/backup.js");
const restoreScriptPath = path.join(rootDir, "scripts/restore.js");

function initRealisticGalleryDb(dbPath: string): void {
  const gdb = new DatabaseSync(dbPath);
  gdb.exec("PRAGMA journal_mode = WAL;");
  gdb.exec(`
    CREATE TABLE gallery_schema (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
    INSERT INTO gallery_schema VALUES (1, 'V1_INITIAL', 1700000000);
    CREATE TABLE galleries (
      id TEXT PRIMARY KEY,
      public_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      client_name TEXT NOT NULL,
      project_date TEXT NOT NULL,
      location TEXT,
      intro_fr TEXT,
      intro_en TEXT,
      signature_fr TEXT,
      signature_en TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      expires_at INTEGER,
      cover_media_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE gallery_codes (
      gallery_id TEXT PRIMARY KEY,
      code_hash TEXT UNIQUE NOT NULL,
      code_encrypted TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE gallery_media (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  gdb.exec("INSERT INTO galleries (id, public_id, title, client_name, project_date, created_at, updated_at) VALUES ('g1', 'pub-1', 'Mariage A&B', 'Maxime', '2026-10-01', 1700000000, 1700000000);");
  gdb.close();
}

function initRealisticRateLimitDb(dbPath: string): void {
  const rdb = new DatabaseSync(dbPath);
  rdb.exec("PRAGMA journal_mode = WAL;");
  rdb.exec(`
    CREATE TABLE requests (hash TEXT NOT NULL, timestamp INTEGER NOT NULL);
    CREATE TABLE contact_claims (
      token_hash TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      lease_expires_at INTEGER NOT NULL DEFAULT 0,
      retention_expires_at INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  rdb.exec("INSERT INTO requests VALUES ('hash-123', 1700000000);");
  rdb.exec("INSERT INTO contact_claims (token_hash, status, created_at) VALUES ('token-abc', 'claimed', 1700000000);");
  rdb.close();
}

describe("Complete Site Backup and Restoration Suite", () => {
  let tempFixtureDir: string;
  let backupOutputDir: string;

  let fixtureSiteContent: string;
  let fixtureSiteMedia: string;
  let fixturePortfolioContent: string;
  let fixturePortfolioMedia: string;
  let fixtureGalleryDb: string;
  let fixtureRateLimitDb: string;
  let fixtureGalleryImport: string;
  let fixtureEnvLocal: string;

  beforeEach(() => {
    tempFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-backup-fixture-"));
    backupOutputDir = path.join(tempFixtureDir, "backups");

    // 1. Prepare valid JSON fixtures
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

    // 4. Prepare realistic SQLite databases
    fixtureGalleryDb = path.join(tempFixtureDir, "galleries.sqlite");
    initRealisticGalleryDb(fixtureGalleryDb);

    fixtureRateLimitDb = path.join(tempFixtureDir, "rate-limit.sqlite");
    initRealisticRateLimitDb(fixtureRateLimitDb);

    // 5. Prepare isolated fixture config
    fixtureEnvLocal = path.join(tempFixtureDir, "fixture.env.local");
    fs.writeFileSync(
      fixtureEnvLocal,
      `TEST_SECRET=isolated-secret-value\nCONTACT_TO_EMAIL=parallax.creative.studiolm@gmail.com\n`,
      { mode: 0o600 }
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempFixtureDir)) {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true });
    }
  });

  it("1. performs dry-run without writing any files or directories", () => {
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

  it("2. enforces isolation: does not read or include real repo .env.local when options.env is supplied", () => {
    const backupDir = path.join(backupOutputDir, "run-isolation");
    const res = performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });

    expect(res.success).toBe(true);
    if (!res.dryRun) {
      // Must NOT include real .env.local
      const envItem = res.manifest.files.find((f) => f.component === "ENV_CONFIG");
      expect(envItem).toBeUndefined();
      expect(fs.existsSync(path.join(backupDir, "config/env.local"))).toBe(false);
    }
  });

  it("3. requires serviceStopped: true for full backup and fails if precondition is missing", () => {
    const backupDir = path.join(backupOutputDir, "run-precondition");
    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: false,
        outDir: backupDir,
        env: {
          SITE_CONTENT_PATH: fixtureSiteContent,
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        },
      });
    }).toThrow(/La cohérence globale de la sauvegarde exige l'arrêt préalable/);
  });

  it("4. rejects missing required sources and never reports a successful empty backup", () => {
    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: true,
        outDir: path.join(backupOutputDir, "run-missing"),
        env: {
          // SITE_CONTENT_PATH is missing
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        },
      });
    }).toThrow(/Composant indispensable manquant/);

    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: true,
        outDir: path.join(backupOutputDir, "run-absent-file"),
        env: {
          SITE_CONTENT_PATH: path.join(tempFixtureDir, "non-existent-site.json"),
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        },
      });
    }).toThrow(/Fichier indispensable introuvable/);
  });

  it("5. rejects invalid JSON schema with real shared validators", () => {
    // Write invalid schemaVersion 999
    fs.writeFileSync(
      fixtureSiteContent,
      JSON.stringify({ ...defaultSiteContent, schemaVersion: 999 }, null, 2),
      "utf-8"
    );

    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: true,
        outDir: path.join(backupOutputDir, "run-invalid-schema"),
        env: {
          SITE_CONTENT_PATH: fixtureSiteContent,
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        },
      });
    }).toThrow(/Composant indispensable SITE_CONTENT invalide/);
  });

  it("6. rejects corrupted SQLite source without naive fallback copy", () => {
    // Write garbage into sqlite file
    fs.writeFileSync(fixtureGalleryDb, Buffer.from("this is not a valid sqlite database"));

    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: true,
        outDir: path.join(backupOutputDir, "run-corrupt-db"),
        env: {
          SITE_CONTENT_PATH: fixtureSiteContent,
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
          GALLERY_DB_PATH: fixtureGalleryDb,
        },
      });
    }).toThrow(/file is not a database|integrity_check/);
  });

  it("7. captures WAL transactions cleanly into snapshot via SQLite VACUUM INTO", () => {
    // Add extra row in WAL mode right before backup
    const gdb = new DatabaseSync(fixtureGalleryDb);
    gdb.exec("INSERT INTO galleries (id, public_id, title, client_name, project_date, created_at, updated_at) VALUES ('g2', 'pub-2', 'Projet Wal Test', 'Client Test', '2026-10-02', 1700000010, 1700000010);");
    gdb.close();

    const backupDir = path.join(backupOutputDir, "run-wal");
    const res = performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        GALLERY_DB_PATH: fixtureGalleryDb,
      },
    });

    expect(res.success).toBe(true);

    // Verify snapshot file has the WAL row
    const snapshotDb = new DatabaseSync(path.join(backupDir, "db/galleries.sqlite"), { readOnly: true });
    const row = snapshotDb.prepare("SELECT title FROM galleries WHERE id = 'g2'").get() as { title: string };
    snapshotDb.close();

    expect(row.title).toBe("Projet Wal Test");
  });

  it("8. rejects backup output directories that overlap sources or existing backup folders", () => {
    // Output directory placed inside a media source directory
    const invalidOut = path.join(fixtureSiteMedia, "nested-backup");
    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: true,
        outDir: invalidOut,
        env: {
          SITE_CONTENT_PATH: fixtureSiteContent,
          SITE_MEDIA_PATH: fixtureSiteMedia,
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        },
      });
    }).toThrow(/se trouve à l'intérieur d'une source/);

    // Existing backup directory cannot be overwritten
    const validDir = path.join(backupOutputDir, "existing-dir");
    fs.mkdirSync(validDir, { recursive: true });
    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: true,
        outDir: validDir,
        env: {
          SITE_CONTENT_PATH: fixtureSiteContent,
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        },
      });
    }).toThrow(/Le dossier de destination existe déjà/);
  });

  it("9. computeSha256 calculates accurate checksums with bounded memory buffer", () => {
    const testFile = path.join(tempFixtureDir, "large-sample.bin");
    const testBuffer = Buffer.alloc(1024 * 1024, 0xab); // 1 MB
    fs.writeFileSync(testFile, testBuffer);

    const expectedSha = "074c29674e21baa420ee0eca0d85b9283b0cfb3ac912da2098f6b3a7f8d6678f";
    const checksum = computeSha256(testFile);
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(checksum).toBe(expectedSha);
  });

  it("10. restore rejects path traversal attempts in manifest without touching external files", () => {
    const backupDir = path.join(backupOutputDir, "traversal-test");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });

    // Plant external sentinel file
    const sentinelFile = path.join(tempFixtureDir, "sentinel.txt");
    fs.writeFileSync(sentinelFile, "ORIGINAL_SENTINEL_CONTENT");

    // Tamper manifest with path traversal
    const manifestPath = path.join(backupDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.files[0].backupRelPath = "../sentinel.txt";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    const isolatedRestore = path.join(tempFixtureDir, "isolated-restore");
    expect(() => {
      performSiteRestore({
        backupDir,
        targetDir: isolatedRestore,
      });
    }).toThrow(/Chemin non sécurisé détecté dans le manifeste/);

    // Sentinel must be untouched
    expect(fs.readFileSync(sentinelFile, "utf-8")).toBe("ORIGINAL_SENTINEL_CONTENT");
  });

  it("11. restore rejects altered checksums and invalid schemas with non-zero exit", () => {
    const backupDir = path.join(backupOutputDir, "tampered-checksum");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });

    // Tamper 1 byte in backup file
    const fileToTamper = path.join(backupDir, "content/site-content.json");
    fs.appendFileSync(fileToTamper, " ");

    const res = performSiteRestore({
      backupDir,
      verifyOnly: true,
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe("INTEGRITY_CHECK_FAILED");
  });

  it("12. executes full backup and isolated restore cycle end-to-end with real CLI subprocesses", () => {
    const backupDir = path.join(backupOutputDir, "cli-cycle");
    const isolatedRestoreDir = path.join(tempFixtureDir, "cli-restored");

    // 1. Run real Node CLI backup dry-run
    const dryRunProc = spawnSync(
      process.execPath,
      [backupScriptPath, "--dry-run", "--out-dir", backupDir, "--config-path", fixtureEnvLocal],
      {
        env: {
          ...process.env,
          SITE_CONTENT_PATH: fixtureSiteContent,
          SITE_MEDIA_PATH: fixtureSiteMedia,
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
          PORTFOLIO_MEDIA_PATH: fixturePortfolioMedia,
          GALLERY_DB_PATH: fixtureGalleryDb,
          RATE_LIMIT_DB_PATH: fixtureRateLimitDb,
          GALLERY_IMPORT_PATH: fixtureGalleryImport,
        },
        encoding: "utf-8",
      }
    );

    expect(dryRunProc.status).toBe(0);
    expect(dryRunProc.stdout).toContain("[OK] Simulation de sauvegarde réussie.");
    expect(fs.existsSync(backupDir)).toBe(false);

    // 2. Run real Node CLI full backup with --service-stopped
    const backupProc = spawnSync(
      process.execPath,
      [backupScriptPath, "--service-stopped", "--out-dir", backupDir, "--config-path", fixtureEnvLocal],
      {
        env: {
          ...process.env,
          SITE_CONTENT_PATH: fixtureSiteContent,
          SITE_MEDIA_PATH: fixtureSiteMedia,
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
          PORTFOLIO_MEDIA_PATH: fixturePortfolioMedia,
          GALLERY_DB_PATH: fixtureGalleryDb,
          RATE_LIMIT_DB_PATH: fixtureRateLimitDb,
          GALLERY_IMPORT_PATH: fixtureGalleryImport,
        },
        encoding: "utf-8",
      }
    );

    expect(backupProc.status).toBe(0);
    expect(backupProc.stdout).toContain("[SUCCÈS] Sauvegarde créée dans :");
    expect(fs.existsSync(path.join(backupDir, "manifest.json"))).toBe(true);

    // 3. Run real Node CLI restore --verify-only
    const verifyProc = spawnSync(
      process.execPath,
      [restoreScriptPath, "--verify-only", "--backup-dir", backupDir],
      {
        env: { ...process.env },
        encoding: "utf-8",
      }
    );

    expect(verifyProc.status).toBe(0);
    expect(verifyProc.stdout).toContain("[OK] Intégrité de la sauvegarde validée :");

    // 4. Run real Node CLI restore into isolated target dir
    const restoreProc = spawnSync(
      process.execPath,
      [restoreScriptPath, "--backup-dir", backupDir, "--target-dir", isolatedRestoreDir],
      {
        env: { ...process.env },
        encoding: "utf-8",
      }
    );

    expect(restoreProc.status).toBe(0);
    expect(restoreProc.stdout).toContain("[SUCCÈS]");
    expect(restoreProc.stdout).toContain("Restauré sur cible isolée");

    // 5. Verify restored files and validate data
    const restoredSiteJson = JSON.parse(
      fs.readFileSync(path.join(isolatedRestoreDir, "content/site-content.json"), "utf-8")
    );
    expect(restoredSiteJson.schemaVersion).toBe(3);

    const restoredPortfolioJson = JSON.parse(
      fs.readFileSync(path.join(isolatedRestoreDir, "content/portfolio-content.json"), "utf-8")
    );
    expect(restoredPortfolioJson.schemaVersion).toBe(2);

    const restoredMediaFile = path.join(isolatedRestoreDir, "media/site/test-site-image.webp");
    expect(fs.readFileSync(restoredMediaFile).toString()).toBe("SITE_IMAGE_BYTES_12345");

    const restoredConfigFile = path.join(isolatedRestoreDir, "config/env.local");
    expect(fs.existsSync(restoredConfigFile)).toBe(true);
    expect(fs.readFileSync(restoredConfigFile, "utf-8")).toContain("TEST_SECRET=isolated-secret-value");

    const restoredDb = new DatabaseSync(path.join(isolatedRestoreDir, "db/galleries.sqlite"), { readOnly: true });
    const check = restoredDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    expect(check.integrity_check).toBe("ok");
    const count = restoredDb.prepare("SELECT count(*) as count FROM galleries").get() as { count: number };
    expect(count.count).toBeGreaterThanOrEqual(1);
    restoredDb.close();
  });
});
