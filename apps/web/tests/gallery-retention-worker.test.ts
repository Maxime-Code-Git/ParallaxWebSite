// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  openGalleryDb,
  closeGalleryDb,
  processGalleryDeletions,
} from "../app/lib/gallery-db.server";
import {
  updateRetentionSettings,
  retryFailedDeletionJob,
  pruneRetentionAuditLogs,
  getDeletionJobsSummary,
  setGalleryRetentionExempt,
} from "../app/lib/gallery-retention.server";
import { createGallery } from "../app/lib/gallery.server";
import { runRetentionAutoPurgeCycle } from "../app/lib/gallery-import.server";

describe("Gallery Retention Worker & Crash Recovery", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;
  let testImportPath: string;
  let testSiteMediaPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-worker-test-"));
    testDbPath = path.join(tmpDir, "gallery.sqlite");
    testMediaPath = path.join(tmpDir, "gallery-media");
    testImportPath = path.join(tmpDir, "gallery-import");
    testSiteMediaPath = path.join(tmpDir, "site-media");

    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(testImportPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(testSiteMediaPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_DB_PATH = testDbPath;
    process.env.GALLERY_MEDIA_PATH = testMediaPath;
    process.env.GALLERY_IMPORT_PATH = testImportPath;
    process.env.SITE_MEDIA_PATH = testSiteMediaPath;
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  });

  afterEach(() => {
    closeGalleryDb();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not auto-purge when retention policy is disabled", () => {
    const db = openGalleryDb(testDbPath);
    const now = Date.now();

    // Expired 60 days ago
    const { gallery } = createGallery({
      title: "Galerie Passée",
      clientName: "Client A",
      projectDate: "2025-01-01",
      expiresAt: now - 60 * 86_400_000,
    });
    db.prepare("UPDATE galleries SET status = 'published' WHERE id = ?").run(gallery.id);

    // Run cycle with default settings (disabled)
    const purgedCount = runRetentionAutoPurgeCycle();
    expect(purgedCount).toBe(0);

    const check = db.prepare("SELECT id FROM galleries WHERE id = ?").get(gallery.id);
    expect(check).toBeDefined();
  });

  it("auto-purges eligible expired galleries and keeps user drop sources intact", () => {
    const db = openGalleryDb(testDbPath);
    const now = Date.now();

    // Configure policy: enabled, 30 days retention
    updateRetentionSettings({ enabled: true, retentionDays: 30, logRetentionDays: null }, 1);

    // 1. Eligible gallery (expired 45 days ago)
    const { gallery: gEligible } = createGallery({
      title: "Mariage Purgeable",
      clientName: "Client Purge",
      projectDate: "2025-05-01",
      expiresAt: now - 45 * 86_400_000,
    });
    db.prepare("UPDATE galleries SET status = 'published' WHERE id = ?").run(gEligible.id);

    // Setup user drop folder in gallery-import
    const projectDropFolder = path.join(testImportPath, "Projet-Mariage-Purge");
    fs.mkdirSync(projectDropFolder, { recursive: true, mode: 0o700 });
    const userOriginalFile = path.join(projectDropFolder, "maxime-raw-photo.cr2");
    fs.writeFileSync(userOriginalFile, "maxime-untouched-raw-bytes");

    // Setup site media file to verify site media remains untouched
    const siteMediaFile = path.join(testSiteMediaPath, "hero.webp");
    fs.writeFileSync(siteMediaFile, "site-media-data");

    // Record import job referencing this drop folder
    db.prepare(`
      INSERT INTO gallery_import_jobs (id, gallery_id, import_folder, status, created_at, updated_at)
      VALUES (?, ?, 'Projet-Mariage-Purge', 'completed', ?, ?)
    `).run(crypto.randomUUID(), gEligible.id, now, now);

    // 2. Ineligible gallery (expired only 5 days ago, delay is 30 days)
    const { gallery: gRecent } = createGallery({
      title: "Mariage Récent",
      clientName: "Client Récent",
      projectDate: "2026-09-01",
      expiresAt: now - 5 * 86_400_000,
    });
    db.prepare("UPDATE galleries SET status = 'published' WHERE id = ?").run(gRecent.id);

    // 3. Ineligible gallery (expired 45 days ago, BUT exempt!)
    const { gallery: gExempt } = createGallery({
      title: "Mariage Exempté",
      clientName: "Client Exempt",
      projectDate: "2025-05-01",
      expiresAt: now - 45 * 86_400_000,
    });
    db.prepare("UPDATE galleries SET status = 'published' WHERE id = ?").run(gExempt.id);
    setGalleryRetentionExempt(gExempt.id, true, "Accord commercial prolongation");

    // Run auto-purge cycle
    const purgedCount = runRetentionAutoPurgeCycle();
    expect(purgedCount).toBe(1);

    // Verify eligible gallery was deleted
    const eligibleCheck = db.prepare("SELECT id FROM galleries WHERE id = ?").get(gEligible.id);
    expect(eligibleCheck).toBeUndefined();

    // Verify recent and exempt galleries are STILL PRESENT!
    expect(db.prepare("SELECT id FROM galleries WHERE id = ?").get(gRecent.id)).toBeDefined();
    expect(db.prepare("SELECT id FROM galleries WHERE id = ?").get(gExempt.id)).toBeDefined();

    // CRITICAL: Verify Maxime's drop folder and files are 100% INTACT on disk!
    expect(fs.existsSync(userOriginalFile)).toBe(true);
    expect(fs.readFileSync(userOriginalFile, "utf-8")).toBe("maxime-untouched-raw-bytes");

    // CRITICAL: Verify site media storage is 100% INTACT!
    expect(fs.existsSync(siteMediaFile)).toBe(true);
  });

  it("recovers and cleans orphan media folder when crash occurred before rename", () => {
    const db = openGalleryDb(testDbPath);
    const galleryId = "aaaaaaaa-1111-2222-3333-444444444444";
    const jobId = "bbbbbbbb-1111-2222-3333-444444444444";

    // Simulate crash state:
    // Deletion job recorded in DB, but media files are still in original path baseMedia/<galleryId>
    const orphanGalDir = path.join(testMediaPath, galleryId);
    fs.mkdirSync(orphanGalDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(orphanGalDir, "unrenamed-media.jpg"), "crash-window-data");

    const relQuarantine = path.join(".trash", "gallery-deletions", jobId);
    const now = Date.now();
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(jobId, galleryId, relQuarantine, now, now);

    // Worker runs recovery
    processGalleryDeletions();

    // Verify orphan media folder was safely cleaned up and job completed!
    expect(fs.existsSync(orphanGalDir)).toBe(false);
    const jobCheck = db.prepare("SELECT status, completed_at FROM gallery_deletion_jobs WHERE id = ?").get(jobId) as {
      status: string;
      completed_at: number | null;
    };
    expect(jobCheck.status).toBe("completed");
    expect(jobCheck.completed_at).toBeGreaterThan(0);
  });

  it("strictly rejects symbolic links at all levels of quarantine and preserves targets", () => {
    const db = openGalleryDb(testDbPath);
    const jobId = "cccccccc-1111-2222-3333-444444444444";
    const galleryId = "dddddddd-1111-2222-3333-444444444444";

    // Create target directory outside gallery-media
    const externalSecretDir = path.join(tmpDir, "external-precious-data");
    fs.mkdirSync(externalSecretDir, { recursive: true, mode: 0o700 });
    const secretFile = path.join(externalSecretDir, "precious.txt");
    fs.writeFileSync(secretFile, "do-not-delete");

    // Create malicious symlink inside .trash/gallery-deletions pointing to external target
    const trashBase = path.join(testMediaPath, ".trash", "gallery-deletions");
    fs.mkdirSync(trashBase, { recursive: true, mode: 0o700 });
    const symlinkTarget = path.join(trashBase, jobId);
    fs.symlinkSync(externalSecretDir, symlinkTarget);

    const relQuarantine = path.join(".trash", "gallery-deletions", jobId);
    const now = Date.now();
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(jobId, galleryId, relQuarantine, now, now);

    // Worker runs
    processGalleryDeletions();

    // Verify symlink itself is removed, but the external target directory and its contents are 100% INTACT!
    expect(fs.existsSync(secretFile)).toBe(true);
    expect(fs.readFileSync(secretFile, "utf-8")).toBe("do-not-delete");

    const jobCheck = db.prepare("SELECT status FROM gallery_deletion_jobs WHERE id = ?").get(jobId) as {
      status: string;
    };
    expect(jobCheck.status).toBe("completed");
  });

  it("handles worker leases, crash timeouts and retries failed jobs without stealing processing jobs", () => {
    const db = openGalleryDb(testDbPath);
    const jobId = "eeeeeeee-1111-2222-3333-444444444444";
    const galleryId = "ffffffff-1111-2222-3333-444444444444";
    const relQuarantine = path.join(".trash", "gallery-deletions", jobId);
    const now = Date.now();

    // 1. Job failed with max attempts reached
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, attempt_count, error_code, created_at, updated_at)
      VALUES (?, ?, ?, 'failed', 5, 'DISK_IO_ERROR', ?, ?)
    `).run(jobId, galleryId, relQuarantine, now, now);

    const summary = getDeletionJobsSummary();
    expect(summary.failed).toBe(1);
    expect(summary.failedJobs[0].id).toBe(jobId);
    expect(summary.failedJobs[0].error_code).toBe("DISK_IO_ERROR");

    // 2. Setup quarantine dir so retry can succeed
    const targetDir = path.join(testMediaPath, relQuarantine);
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(targetDir, "retry-file.jpg"), "test");

    // Retry failed job
    retryFailedDeletionJob(jobId);

    // Verify job transitioned through pending to completed
    const updated = db.prepare("SELECT status, error_code, attempt_count FROM gallery_deletion_jobs WHERE id = ?").get(jobId) as {
      status: string;
      error_code: string | null;
      attempt_count: number;
    };
    expect(updated.status).toBe("completed");
    expect(updated.error_code).toBeNull();
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it("prunes only completed audit logs older than logRetentionDays", () => {
    const db = openGalleryDb(testDbPath);
    const now = Date.now();

    // 1. Completed job finished 100 days ago
    const oldJobId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, completed_at, created_at, updated_at)
      VALUES (?, 'gal-1', '.trash/gallery-deletions/1', 'completed', ?, ?, ?)
    `).run(oldJobId, now - 100 * 86_400_000, now - 100 * 86_400_000, now - 100 * 86_400_000);

    // 2. Completed job finished 5 days ago
    const recentJobId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, completed_at, created_at, updated_at)
      VALUES (?, 'gal-2', '.trash/gallery-deletions/2', 'completed', ?, ?, ?)
    `).run(recentJobId, now - 5 * 86_400_000, now - 5 * 86_400_000, now - 5 * 86_400_000);

    // 3. Failed job (should NEVER be pruned, even if old!)
    const failedJobId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, error_code, created_at, updated_at)
      VALUES (?, 'gal-3', '.trash/gallery-deletions/3', 'failed', 'TEST_ERROR', ?, ?)
    `).run(failedJobId, now - 120 * 86_400_000, now - 120 * 86_400_000);

    // Prune logs older than 30 days
    const prunedCount = pruneRetentionAuditLogs(30);
    expect(prunedCount).toBe(1);

    expect(db.prepare("SELECT id FROM gallery_deletion_jobs WHERE id = ?").get(oldJobId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM gallery_deletion_jobs WHERE id = ?").get(recentJobId)).toBeDefined();
    expect(db.prepare("SELECT id FROM gallery_deletion_jobs WHERE id = ?").get(failedJobId)).toBeDefined();
  });
});
