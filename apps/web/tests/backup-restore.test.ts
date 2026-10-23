import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { DatabaseSync } from "node:sqlite";
import { spawnSync, spawn } from "node:child_process";
import defaultSiteContent from "../app/content/default-site-content.json";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";
import { openGalleryDb } from "../app/lib/gallery-db.server";
import { openRateLimitDb } from "../app/lib/rate-limit.server";
import { performSiteBackup, computeSha256 } from "../../../scripts/backup.js";
import { performSiteRestore } from "../../../scripts/restore.js";

const rootDir = path.resolve(__dirname, "../../..");
const backupScriptPath = path.join(rootDir, "scripts/backup.js");
const restoreScriptPath = path.join(rootDir, "scripts/restore.js");
const startServerScriptPath = path.join(rootDir, "scripts/start-server.js");

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr !== "object") {
        srv.close(() => reject(new Error("Unable to obtain free port")));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
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
  let fixtureGalleryMedia: string;
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

    fixtureGalleryMedia = path.join(tempFixtureDir, "media-gallery");
    fs.mkdirSync(fixtureGalleryMedia, { recursive: true });

    // 3. Prepare gallery imports
    fixtureGalleryImport = path.join(tempFixtureDir, "gallery-import");
    fs.mkdirSync(path.join(fixtureGalleryImport, "client-gallery-1"), { recursive: true });
    fs.writeFileSync(path.join(fixtureGalleryImport, "client-gallery-1", "photo1.jpg"), Buffer.from("PHOTO_1_BYTES"));

    // 4. Prepare realistic SQLite databases using real project initializers
    fixtureGalleryDb = path.join(tempFixtureDir, "galleries.sqlite");
    const gdb = openGalleryDb(fixtureGalleryDb);
    gdb.exec(
      "INSERT INTO galleries (id, public_id, title, client_name, project_date, created_at, updated_at) VALUES ('g1', 'pub-1', 'Mariage A&B', 'Maxime', '2026-10-01', 1700000000, 1700000000);"
    );
    gdb.close();

    fixtureRateLimitDb = path.join(tempFixtureDir, "rate-limit.sqlite");
    const rdb = openRateLimitDb(fixtureRateLimitDb);
    rdb.exec("INSERT INTO requests VALUES ('hash-123', 1700000000);");
    rdb.exec("INSERT INTO contact_claims (token_hash, status, created_at) VALUES ('token-abc', 'claimed', 1700000000);");
    rdb.close();

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

  // Base functional & security tests
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

  it("enforces isolation: does not read or include real repo .env.local when options.env is supplied", () => {
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
      const envItem = res.manifest.files.find((f) => f.component === "ENV_CONFIG");
      expect(envItem).toBeUndefined();
      expect(fs.existsSync(path.join(backupDir, "config/env.local"))).toBe(false);
    }
  });

  it("requires serviceStopped: true for full backup and fails if precondition is missing", () => {
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

  it("rejects missing required sources and never reports a successful empty backup", () => {
    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: true,
        outDir: path.join(backupOutputDir, "run-missing"),
        env: {
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

  it("rejects invalid JSON schema with real shared validators", () => {
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

  it("rejects corrupted SQLite source without naive fallback copy", () => {
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

  it("captures WAL transactions cleanly into snapshot via SQLite VACUUM INTO", () => {
    const gdb = new DatabaseSync(fixtureGalleryDb);
    gdb.exec(
      "INSERT INTO galleries (id, public_id, title, client_name, project_date, created_at, updated_at) VALUES ('g2', 'pub-2', 'Projet Wal Test', 'Client Test', '2026-10-02', 1700000010, 1700000010);"
    );
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

    const snapshotDb = new DatabaseSync(path.join(backupDir, "db/galleries.sqlite"), { readOnly: true });
    const row = snapshotDb.prepare("SELECT title FROM galleries WHERE id = 'g2'").get() as { title: string };
    snapshotDb.close();

    expect(row.title).toBe("Projet Wal Test");
  });

  it("computeSha256 calculates accurate checksums with bounded memory buffer", () => {
    const testFile = path.join(tempFixtureDir, "large-sample.bin");
    const testBuffer = Buffer.alloc(1024 * 1024, 0xab); // 1 MB
    fs.writeFileSync(testFile, testBuffer);

    const expectedSha = "074c29674e21baa420ee0eca0d85b9283b0cfb3ac912da2098f6b3a7f8d6678f";
    const checksum = computeSha256(testFile);
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(checksum).toBe(expectedSha);
  });

  // 10 Targeted Tests Required by Section 5

  it("Targeted Test 1: Cible symlink et parent intermédiaire symlink: refus et zéro fichier créé dans la sentinelle extérieure", () => {
    const backupDir = path.join(backupOutputDir, "symlink-target-test");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });

    // 1a: Direct symlink target pointing to outside sentinel dir
    const outsideTarget = path.join(tempFixtureDir, "outside-target-1a");
    fs.mkdirSync(outsideTarget, { recursive: true });
    const targetLink = path.join(tempFixtureDir, "target-link-1a");
    fs.symlinkSync(outsideTarget, targetLink);

    expect(() => {
      performSiteRestore({
        backupDir,
        targetDir: targetLink,
      });
    }).toThrow(/La cible de restauration existe déjà|non sécurisé.*lien symbolique/);

    // Verify 0 files created in external sentinel directory
    expect(fs.readdirSync(outsideTarget)).toHaveLength(0);

    // 1b: Intermediate symlink parent
    const outsideParent = path.join(tempFixtureDir, "outside-parent-1b");
    fs.mkdirSync(outsideParent, { recursive: true });
    const parentLink = path.join(tempFixtureDir, "parent-link-1b");
    fs.symlinkSync(outsideParent, parentLink);
    const nestedTarget = path.join(parentLink, "isolated-restore-1b");

    expect(() => {
      performSiteRestore({
        backupDir,
        targetDir: nestedTarget,
      });
    }).toThrow(/non sécurisé.*contient un lien symbolique dans sa hiérarchie/);

    expect(fs.readdirSync(outsideParent)).toHaveLength(0);
  });

  it("Targeted Test 2: Fichier de sauvegarde ou dossier interne symlink: refus avant lecture/copie extérieure", () => {
    const backupDir = path.join(backupOutputDir, "symlink-backup-test");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        SITE_MEDIA_PATH: fixtureSiteMedia,
      },
    });

    // 2a: Replace a backed-up file with a symlink to an outside file (external escape)
    const siteContentInBackup = path.join(backupDir, "content/site-content.json");
    fs.unlinkSync(siteContentInBackup);
    fs.symlinkSync(fixtureSiteContent, siteContentInBackup);

    const isolatedTarget = path.join(tempFixtureDir, "isolated-restore-symlink-backup");
    expect(() => {
      performSiteRestore({
        backupDir,
        targetDir: isolatedTarget,
      });
    }).toThrow(/Tentative d'évasion|Lien symbolique/);
    expect(fs.existsSync(isolatedTarget)).toBe(false);

    // 2b: Symlink within backup pointing to another backup file
    const backupDir2 = path.join(backupOutputDir, "symlink-internal-test");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir2,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });
    const backupSite2 = path.join(backupDir2, "content/site-content.json");
    const backupPort2 = path.join(backupDir2, "content/portfolio-content.json");
    fs.unlinkSync(backupSite2);
    // Symlink inside the backup pointing to sibling portfolio-content.json
    fs.symlinkSync(backupPort2, backupSite2);

    const isolatedTarget2 = path.join(tempFixtureDir, "isolated-restore-internal-symlink");
    const res2 = performSiteRestore({
      backupDir: backupDir2,
      targetDir: isolatedTarget2,
    });
    expect(res2.success).toBe(false);
    expect(res2.reason).toBe("VALIDATION_FAILED");
    expect(res2.errors?.some((e) => e.includes("Lien symbolique"))).toBe(true);
    expect(fs.existsSync(isolatedTarget2)).toBe(false);
  });

  it("Targeted Test 3: originalPath arbitraire: aucune incidence sur la cible; mode en place et --force refusés", () => {
    const backupDir = path.join(backupOutputDir, "original-path-test");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });

    // Plant outside sentinel file
    const sentinelFile = path.join(tempFixtureDir, "sentinel-victim.txt");
    fs.writeFileSync(sentinelFile, "SENTINEL_INITIAL_CONTENT", "utf-8");

    // Alter manifest originalPath to point to sentinel
    const manifestPath = path.join(backupDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const siteItem = manifest.files.find((f: { component: string }) => f.component === "SITE_CONTENT");
    siteItem.originalPath = sentinelFile;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    // 3a: Isolated restore to new target: restores properly into targetDir, sentinel untouched
    const freshTarget = path.join(tempFixtureDir, "fresh-target-orig-test");
    const res = performSiteRestore({
      backupDir,
      targetDir: freshTarget,
    });
    expect(res.success).toBe(true);
    expect(fs.existsSync(path.join(freshTarget, "content/site-content.json"))).toBe(true);
    expect(fs.readFileSync(sentinelFile, "utf-8")).toBe("SENTINEL_INITIAL_CONTENT");

    // 3b: In-place mode with force: true must be explicitly rejected
    expect(() => {
      performSiteRestore({
        backupDir,
        force: true,
        serviceStopped: true,
      });
    }).toThrow(/L'option --force est interdite/);
    expect(fs.readFileSync(sentinelFile, "utf-8")).toBe("SENTINEL_INITIAL_CONTENT");

    // 3c: In-place mode without targetDir must be rejected
    expect(() => {
      performSiteRestore({
        backupDir,
      });
    }).toThrow(/le paramètre targetDir est obligatoire/);
    expect(fs.readFileSync(sentinelFile, "utf-8")).toBe("SENTINEL_INITIAL_CONTENT");
  });

  it("Targeted Test 4: JSON de schéma invalide avec hash correct: refus avant toute publication et sources saines inchangées", () => {
    const backupDir = path.join(backupOutputDir, "invalid-schema-correct-hash");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });

    // Record original healthy source state
    const originalHealthySource = fs.readFileSync(fixtureSiteContent, "utf-8");

    // Replace site-content in backup with schemaVersion: 999
    const backupSiteContent = path.join(backupDir, "content/site-content.json");
    const corruptedObj = { ...defaultSiteContent, schemaVersion: 999 };
    fs.writeFileSync(backupSiteContent, JSON.stringify(corruptedObj, null, 2), "utf-8");

    // Recompute sha256 and sizeBytes in manifest to isolate deep schema validation
    const newSha = computeSha256(backupSiteContent);
    const newSize = fs.statSync(backupSiteContent).size;
    const manifestPath = path.join(backupDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const siteItem = manifest.files.find((f: { component: string }) => f.component === "SITE_CONTENT");
    siteItem.sha256 = newSha;
    siteItem.sizeBytes = newSize;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    const isolatedTarget = path.join(tempFixtureDir, "target-invalid-schema");
    const res = performSiteRestore({
      backupDir,
      targetDir: isolatedTarget,
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe("VALIDATION_FAILED");
    expect(res.errors?.some((e) => e.includes("Schéma SITE_CONTENT invalide"))).toBe(true);

    // Target directory was not created/published
    expect(fs.existsSync(isolatedTarget)).toBe(false);

    // Healthy original source is strictly untouched
    expect(fs.readFileSync(fixtureSiteContent, "utf-8")).toBe(originalHealthySource);
  });

  it("Targeted Test 5: SQLite invalide avec hash correct: refus avant toute publication et sources saines inchangées", () => {
    const backupDir = path.join(backupOutputDir, "invalid-sqlite-correct-hash");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        GALLERY_DB_PATH: fixtureGalleryDb,
      },
    });

    // Record original healthy database size
    const originalDbSize = fs.statSync(fixtureGalleryDb).size;

    // Replace database in backup with corrupted SQLite (missing galleries table)
    const backupDb = path.join(backupDir, "db/galleries.sqlite");
    const dummyDb = new DatabaseSync(backupDb);
    dummyDb.exec("DROP TABLE IF EXISTS galleries; CREATE TABLE other_table (id TEXT);");
    dummyDb.close();

    const newSha = computeSha256(backupDb);
    const newSize = fs.statSync(backupDb).size;
    const manifestPath = path.join(backupDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const dbItem = manifest.files.find((f: { component: string }) => f.component === "GALLERY_DB");
    dbItem.sha256 = newSha;
    dbItem.sizeBytes = newSize;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    const isolatedTarget = path.join(tempFixtureDir, "target-invalid-sqlite");
    const res = performSiteRestore({
      backupDir,
      targetDir: isolatedTarget,
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe("VALIDATION_FAILED");
    expect(res.errors?.some((e) => e.includes("GALLERY_DB tables requises manquantes"))).toBe(true);
    expect(fs.existsSync(isolatedTarget)).toBe(false);

    // Healthy original source DB untouched
    expect(fs.statSync(fixtureGalleryDb).size).toBe(originalDbSize);
  });

  it("Targeted Test 6: Cible existante (y compris vide) ou recouvrant la sauvegarde: refus sans altération", () => {
    const backupDir = path.join(backupOutputDir, "target-overlap-test");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });

    // 6a: Pre-existing empty target directory
    const existingTarget = path.join(tempFixtureDir, "empty-preexisting-target");
    fs.mkdirSync(existingTarget, { recursive: true });

    expect(() => {
      performSiteRestore({
        backupDir,
        targetDir: existingTarget,
      });
    }).toThrow(/La cible de restauration existe déjà/);

    // 6b: Overlapping target inside backup directory
    const overlappingTarget = path.join(backupDir, "nested-target");
    expect(() => {
      performSiteRestore({
        backupDir,
        targetDir: overlappingTarget,
      });
    }).toThrow(/ne peut pas chevaucher le dossier de sauvegarde/);
  });

  it("Targeted Test 7: Destination de backup atteignant une source via symlink: refus", () => {
    // Symlink pointing to source parent
    const symlinkToSource = path.join(tempFixtureDir, "symlink-to-sources");
    fs.symlinkSync(fixtureSiteMedia, symlinkToSource);
    const backupInSymlink = path.join(symlinkToSource, "nested-backup");

    expect(() => {
      performSiteBackup({
        dryRun: false,
        serviceStopped: true,
        outDir: backupInSymlink,
        env: {
          SITE_CONTENT_PATH: fixtureSiteContent,
          SITE_MEDIA_PATH: fixtureSiteMedia,
          PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
        },
      });
    }).toThrow(/non sécurisé.*contient un lien symbolique dans sa hiérarchie|se trouve à l'intérieur d'une source/);
  });

  it("Targeted Test 8: Manifeste de version inconnue, composant inconnu, doublon ou association composant/chemin incohérente: rejet", () => {
    const backupDir = path.join(backupOutputDir, "manifest-integrity-test");
    performSiteBackup({
      dryRun: false,
      serviceStopped: true,
      outDir: backupDir,
      env: {
        SITE_CONTENT_PATH: fixtureSiteContent,
        PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
      },
    });
    const manifestPath = path.join(backupDir, "manifest.json");
    const originalManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    // 8a: Unknown manifestVersion
    const badVersion = { ...originalManifest, manifestVersion: 999 };
    fs.writeFileSync(manifestPath, JSON.stringify(badVersion, null, 2), "utf-8");
    expect(() => performSiteRestore({ backupDir, verifyOnly: true })).toThrow(/Version de manifeste non supportée/);

    // 8b: Unknown component
    const badComponent = {
      ...originalManifest,
      manifestVersion: 1,
      totalFiles: originalManifest.totalFiles + 1,
      files: [
        ...originalManifest.files,
        {
          component: "MALICIOUS_COMPONENT",
          type: "file",
          backupRelPath: "content/malicious.json",
          sizeBytes: 10,
          sha256: "0".repeat(64),
        },
      ],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(badComponent, null, 2), "utf-8");
    expect(() => performSiteRestore({ backupDir, verifyOnly: true })).toThrow(/Composant inconnu ou non autorisé/);

    // 8c: Duplicate relative path
    const duplicatePath = {
      ...originalManifest,
      manifestVersion: 1,
      totalFiles: originalManifest.totalFiles + 1,
      files: [...originalManifest.files, { ...originalManifest.files[0] }],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(duplicatePath, null, 2), "utf-8");
    expect(() => performSiteRestore({ backupDir, verifyOnly: true })).toThrow(/Doublon de fichier détecté/);

    // 8d: Inconsistent component/path mapping
    const badMapping = {
      ...originalManifest,
      manifestVersion: 1,
      files: originalManifest.files.map((f: { component: string; backupRelPath: string }) =>
        f.component === "SITE_CONTENT" ? { ...f, backupRelPath: "content/other-site.json" } : f
      ),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(badMapping, null, 2), "utf-8");
    expect(() => performSiteRestore({ backupDir, verifyOnly: true })).toThrow(
      /Association composant\/chemin incohérente pour SITE_CONTENT/
    );
  });

  it("Targeted Test 9: Vrai cycle CLI Node backup -> verify-only -> restauration isolée neuve, puis relecture du contenu, des médias et des bases", () => {
    const backupDir = path.join(backupOutputDir, "cli-cycle-e2e");
    const isolatedRestoreDir = path.join(tempFixtureDir, "cli-restored-e2e");

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
          GALLERY_MEDIA_PATH: fixtureGalleryMedia,
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
          GALLERY_MEDIA_PATH: fixtureGalleryMedia,
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
    expect(verifyProc.stdout).toContain("[OK] Intégrité et conformité des schémas validées :");

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
    expect(restoreProc.stdout).toContain(isolatedRestoreDir);

    // 5. Verify restored files, media, and SQLite databases using project helpers
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

    // Open restored gallery SQLite with real project helper
    const restoredDb = new DatabaseSync(path.join(isolatedRestoreDir, "db/galleries.sqlite"), { readOnly: true });
    const check = restoredDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    expect(check.integrity_check).toBe("ok");
    const count = restoredDb.prepare("SELECT count(*) as count FROM galleries").get() as { count: number };
    expect(count.count).toBeGreaterThanOrEqual(1);
    restoredDb.close();

    // Open restored rate limit SQLite with real project helper
    const restoredRateDb = new DatabaseSync(path.join(isolatedRestoreDir, "db/rate-limit.sqlite"), { readOnly: true });
    const rateCheck = restoredRateDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    expect(rateCheck.integrity_check).toBe("ok");
    restoredRateDb.close();
  });

  it(
    "Targeted Test 10: Vrai démarrage du chemin documenté avec fixtures et contrôle HTTP sur port isolé",
    async () => {
      const testPort = await getFreePort();

      // Isolated test environment config
      const startupConfigFile = path.join(tempFixtureDir, "test-startup.env.local");
      const validGallerySecret = "ba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedc";
      const validGalleryKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const validAdminHash = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$abcdefghijklmnopqrstuvwxyz0123456789/+";

      fs.writeFileSync(
        startupConfigFile,
        `
NODE_ENV=production
PORT=${testPort}
HOST=127.0.0.1
PUBLIC_SITE_URL=https://127.0.0.1:${testPort}
ADMIN_PASSWORD_HASH=${validAdminHash}
ADMIN_SESSION_SECRET=admin-session-secret-at-least-32-chars-long!
RATE_LIMIT_SECRET=rate-limit-secret-at-least-32-chars-long!
GALLERY_SECRET=${validGallerySecret}
GALLERY_CODE_ENCRYPTION_KEY=${validGalleryKey}
SITE_CONTENT_PATH=${fixtureSiteContent}
PORTFOLIO_CONTENT_PATH=${fixturePortfolioContent}
SITE_MEDIA_PATH=${fixtureSiteMedia}
PORTFOLIO_MEDIA_PATH=${fixturePortfolioMedia}
GALLERY_DB_PATH=${fixtureGalleryDb}
RATE_LIMIT_DB_PATH=${fixtureRateLimitDb}
GALLERY_MEDIA_PATH=${fixtureGalleryMedia}
GALLERY_IMPORT_PATH=${fixtureGalleryImport}
`
      );

      // Launch documented startup wrapper as a child process
      const serverProcess = spawn(
        process.execPath,
        [startServerScriptPath, "--config-path", startupConfigFile],
        {
          stdio: "pipe",
          env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: String(testPort),
            HOST: "127.0.0.1",
            PUBLIC_SITE_URL: `https://127.0.0.1:${testPort}`,
            ADMIN_PASSWORD_HASH: validAdminHash,
            ADMIN_SESSION_SECRET: "admin-session-secret-at-least-32-chars-long!",
            RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-chars-long!",
            GALLERY_SECRET: validGallerySecret,
            GALLERY_CODE_ENCRYPTION_KEY: validGalleryKey,
            SITE_CONTENT_PATH: fixtureSiteContent,
            PORTFOLIO_CONTENT_PATH: fixturePortfolioContent,
            SITE_MEDIA_PATH: fixtureSiteMedia,
            PORTFOLIO_MEDIA_PATH: fixturePortfolioMedia,
            GALLERY_DB_PATH: fixtureGalleryDb,
            RATE_LIMIT_DB_PATH: fixtureRateLimitDb,
            GALLERY_MEDIA_PATH: fixtureGalleryMedia,
            GALLERY_IMPORT_PATH: fixtureGalleryImport,
            STARTUP_CONFIG_PATH: startupConfigFile,
          },
        }
      );

      let serverLogs = "";
      serverProcess.stdout.on("data", (d) => {
        serverLogs += d.toString();
      });
      serverProcess.stderr.on("data", (d) => {
        serverLogs += d.toString();
      });

      try {
        // Poll /api/health until server is ready (up to 12 seconds)
        const healthUrl = `http://127.0.0.1:${testPort}/api/health`;
        let healthy = false;
        let body: { status?: string } = {};

        const startMs = Date.now();
        while (Date.now() - startMs < 12000) {
          try {
            const res = await fetch(healthUrl);
            if (res.status === 200) {
              body = (await res.json()) as { status?: string };
              if (body.status === "ok") {
                healthy = true;
                break;
              }
            }
          } catch {
            // Server still starting up, wait 100ms
            await new Promise((r) => setTimeout(r, 100));
          }
        }

        if (!healthy) {
          console.error("Server output before timeout:", serverLogs);
        }

        expect(healthy).toBe(true);
        expect(body.status).toBe("ok");
      } finally {
        // Cleanly terminate server child process
        serverProcess.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          serverProcess.on("close", () => resolve());
          // Fallback safety timeout
          setTimeout(() => {
            try {
              serverProcess.kill("SIGKILL");
            } catch {
              /* ignore */
            }
            resolve();
          }, 3000);
        });
      }
    },
    20000
  );
});
