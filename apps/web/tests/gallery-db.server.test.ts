// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  openGalleryDb,
  getGalleryDb,
  closeGalleryDb,
  deleteGalleryAndQuarantine,
  processGalleryDeletions,
  GalleryDatabaseError,
} from "../app/lib/gallery-db.server";
import { createGallery, rotateGalleryCode } from "../app/lib/gallery.server";

describe("gallery-db.server.ts (Parallax V1 Schema & Transactions)", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-db-test-"));
    testDbPath = path.join(tmpDir, "gallery.sqlite");
    testMediaPath = path.join(tmpDir, "gallery-media");
    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_DB_PATH = testDbPath;
    process.env.GALLERY_MEDIA_PATH = testMediaPath;
    process.env.GALLERY_IMPORT_PATH = path.join(tmpDir, "gallery-import");
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  });

  afterEach(() => {
    closeGalleryDb();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates clean V1 schema on a fresh SQLite database and sets secure PRAGMAs", () => {
    const db = openGalleryDb(testDbPath);
    expect(db).toBeDefined();

    // Check PRAGMAs
    const fk = db.prepare("PRAGMA foreign_keys;").get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);

    // Check V1 tables
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("gallery_schema");
    expect(tableNames).toContain("galleries");
    expect(tableNames).toContain("gallery_codes");
    expect(tableNames).toContain("gallery_media");
    expect(tableNames).toContain("gallery_import_jobs");
    expect(tableNames).toContain("gallery_deletion_jobs");

    // Version in gallery_schema
    const schemaRow = db.prepare("SELECT version, name FROM gallery_schema").get() as {
      version: number;
      name: string;
    };
    expect(schemaRow.version).toBe(1);
    expect(schemaRow.name).toBe("parallax_gallery_v1");

    db.close();
  });

  it("re-opens existing V1 schema idempotently without re-initializing", () => {
    const db1 = openGalleryDb(testDbPath);
    db1.close();

    const db2 = openGalleryDb(testDbPath);
    const schemaRow = db2.prepare("SELECT version FROM gallery_schema").get() as { version: number };
    expect(schemaRow.version).toBe(1);
    db2.close();
  });

  it("strictly rejects a foreign Sempra database with migration history", () => {
    const sempraDbPath = path.join(tmpDir, "sempra.sqlite");
    const foreignDb = new DatabaseSync(sempraDbPath);
    foreignDb.exec("CREATE TABLE gallery_migrations (id INTEGER PRIMARY KEY);");
    foreignDb.close();

    expect(() => openGalleryDb(sempraDbPath)).toThrow(GalleryDatabaseError);
    expect(() => openGalleryDb(sempraDbPath)).toThrow("Base de donnees Sempra detectee");
  });

  it("strictly rejects a rate-limit database accidentally passed as gallery db", () => {
    const rateLimitDbPath = path.join(tmpDir, "ratelimit.sqlite");
    const foreignDb = new DatabaseSync(rateLimitDbPath);
    foreignDb.exec("CREATE TABLE requests (id TEXT PRIMARY KEY);");
    foreignDb.close();

    expect(() => openGalleryDb(rateLimitDbPath)).toThrow(GalleryDatabaseError);
    expect(() => openGalleryDb(rateLimitDbPath)).toThrow("Base de limitation de debit");
  });

  it("creates gallery and access code atomically with single row and HMAC uniqueness", () => {
    const db = getGalleryDb();

    const { gallery, plainCode } = createGallery({
      title: "Mariage Maxime & Julie",
      clientName: "Maxime & Julie",
      projectDate: "2026-06-15",
      location: "Bruxelles",
      introFr: "Bienvenue",
      introEn: "Welcome",
      signatureFr: "Maxime & Ludovic",
      signatureEn: "Maxime & Ludovic",
    });

    expect(gallery).toBeDefined();
    expect(plainCode).toBeDefined();
    expect(plainCode.startsWith("PARALLAX-")).toBe(true);

    const galleryRow = db.prepare("SELECT * FROM galleries WHERE id = ?").get(gallery.id) as Record<string, unknown>;
    expect(galleryRow).toBeDefined();
    expect(galleryRow.title).toBe("Mariage Maxime & Julie");
    expect(galleryRow.status).toBe("draft");

    const codeRow = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id) as {
      gallery_id: string;
      code_hash: string;
      code_encrypted: string;
      version: number;
    };
    expect(codeRow).toBeDefined();
    expect(codeRow.version).toBe(1);
    expect(codeRow.code_hash).toBeDefined();
    expect(codeRow.code_encrypted).toBeDefined();
    // Plain code should NOT be stored in SQLite
    expect(codeRow.code_encrypted).not.toBe(plainCode);

    // Verify code uniqueness: duplicate code_hash fails
    expect(() => {
      db.prepare(`
        INSERT INTO gallery_codes (gallery_id, code_hash, code_encrypted, version, updated_at)
        VALUES (?, ?, ?, 1, ?)
      `).run("other-gallery-id", codeRow.code_hash, "encrypted-blob", Date.now());
    }).toThrow();
  });

  it("rotates gallery code atomically, increments version to version + 1 and preserves single row", () => {
    const db = getGalleryDb();

    const { gallery, plainCode: code1 } = createGallery({
      title: "Test Rotation",
      clientName: "Client Rotation",
      projectDate: "2026-08-01",
    });

    const { code: code2, version: v2 } = rotateGalleryCode(gallery.id);

    expect(v2).toBe(2);
    expect(code2).not.toBe(code1);

    const codes = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").all(gallery.id) as {
      code_hash: string;
      code_encrypted: string;
      version: number;
    }[];
    expect(codes.length).toBe(1);
    expect(codes[0].version).toBe(2);
  });

  it("deletes gallery and moves media directory to quarantine, then processes deletion job", () => {
    const db = getGalleryDb();

    const { gallery } = createGallery({
      title: "A supprimer",
      clientName: "Client Delete",
      projectDate: "2026-09-01",
    });

    const galleryId = gallery.id;

    // Setup gallery folder with files
    const galDir = path.join(testMediaPath, galleryId);
    fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(galDir, "sample-photo.jpg"), "fake-jpg-content");

    deleteGalleryAndQuarantine(galleryId);

    // Gallery and code rows deleted in SQLite
    const galCheck = db.prepare("SELECT * FROM galleries WHERE id = ?").get(galleryId);
    expect(galCheck).toBeUndefined();
    const codeCheck = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(galleryId);
    expect(codeCheck).toBeUndefined();

    // Original folder moved to quarantine
    expect(fs.existsSync(galDir)).toBe(false);

    // Deletion job queued in gallery_deletion_jobs
    const jobs = db.prepare("SELECT * FROM gallery_deletion_jobs WHERE gallery_id = ?").all(galleryId) as {
      id: string;
      status: string;
      relative_quarantine_path: string;
    }[];
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("pending");

    const quarantineFullPath = path.join(testMediaPath, jobs[0].relative_quarantine_path);
    expect(fs.existsSync(quarantineFullPath)).toBe(true);
    expect(fs.existsSync(path.join(quarantineFullPath, "sample-photo.jpg"))).toBe(true);

    // Run background deletion worker
    processGalleryDeletions();

    // Verify quarantine folder deleted and job marked completed
    expect(fs.existsSync(quarantineFullPath)).toBe(false);
    const updatedJob = db.prepare("SELECT status FROM gallery_deletion_jobs WHERE id = ?").get(jobs[0].id) as {
      status: string;
    };
    expect(updatedJob.status).toBe("completed");
  });

  it("strictly protects against symlink ancestor traversal and symlinks inside quarantine", () => {
    const db = getGalleryDb();
    const jobId = "11111111-2222-3333-4444-555555555555";
    const galleryId = "66666666-7777-8888-9999-000000000000";

    // Create an outside sensitive folder
    const outsideSecretDir = path.join(tmpDir, "outside-secret-dir");
    fs.mkdirSync(outsideSecretDir, { recursive: true, mode: 0o700 });
    const sensitiveFile = path.join(outsideSecretDir, "important.data");
    fs.writeFileSync(sensitiveFile, "do-not-delete");

    // Case 1: Symlink inside quarantine pointing to outside secret file
    const trashJobDir = path.join(testMediaPath, ".trash", "gallery-deletions", jobId);
    fs.mkdirSync(trashJobDir, { recursive: true, mode: 0o700 });
    const evilSymlink = path.join(trashJobDir, "evil-symlink");
    fs.symlinkSync(sensitiveFile, evilSymlink);

    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(jobId, galleryId, `.trash/gallery-deletions/${jobId}`, Date.now(), Date.now());

    processGalleryDeletions();

    // Evil symlink removed, but target outside sensitive file remains untouched!
    expect(fs.existsSync(trashJobDir)).toBe(false);
    expect(fs.existsSync(sensitiveFile)).toBe(true);
    expect(fs.readFileSync(sensitiveFile, "utf-8")).toBe("do-not-delete");

    // Case 2: Ancestor .trash/gallery-deletions replaced by a symlink pointing outside
    const evilJobId = "22222222-3333-4444-5555-666666666666";
    const deletionsParent = path.join(testMediaPath, ".trash", "gallery-deletions");
    fs.rmSync(deletionsParent, { recursive: true, force: true });
    fs.symlinkSync(outsideSecretDir, deletionsParent);

    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(evilJobId, galleryId, `.trash/gallery-deletions/${evilJobId}`, Date.now(), Date.now());

    processGalleryDeletions();

    // Ancestor symlink rejected: outside secret directory and file remain completely intact!
    expect(fs.existsSync(sensitiveFile)).toBe(true);
    expect(fs.readFileSync(sensitiveFile, "utf-8")).toBe("do-not-delete");

    // Clean up symlink so next tests are isolated
    fs.unlinkSync(deletionsParent);
    fs.mkdirSync(deletionsParent, { recursive: true, mode: 0o700 });
  });

  it("recovers and cleans unrenamed orphan media folders in crash window", () => {
    const db = getGalleryDb();
    const jobId = "33333333-4444-5555-6666-777777777777";
    const galleryId = "44444444-5555-6666-7777-888888888888";

    // Simulate crash where job was recorded in SQLite, but folder rename to .trash crashed
    // so folder still exists as gallery-media/:galleryId
    const orphanGalDir = path.join(testMediaPath, galleryId);
    fs.mkdirSync(orphanGalDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(orphanGalDir, "unmoved-photo.jpg"), "unmoved-bytes");

    db.prepare(`
      INSERT INTO gallery_deletion_jobs (id, gallery_id, relative_quarantine_path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(jobId, galleryId, `.trash/gallery-deletions/${jobId}`, Date.now(), Date.now());

    processGalleryDeletions();

    // Orphan gallery media folder has been recovered and deleted safely
    expect(fs.existsSync(orphanGalDir)).toBe(false);

    const job = db.prepare("SELECT status FROM gallery_deletion_jobs WHERE id = ?").get(jobId) as { status: string };
    expect(job.status).toBe("completed");
  });
});
