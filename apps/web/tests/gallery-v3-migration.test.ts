// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { RouterContextProvider } from "react-router";
import {
  openGalleryDb,
  closeGalleryDb,
} from "../app/lib/gallery-db.server";
import {
  createGallery,
  getGalleryById,
  getGalleries,
  rotateGalleryCode,
  getGalleryAccessCodeState,
} from "../app/lib/gallery.server";
import {
  requireGalleryAccess,
  authenticateGalleryCode,
  getGallerySessionStorage,
  createGalleryCsrfToken,
  encryptGalleryCode,
  hashGalleryCode,
} from "../app/lib/gallery-auth.server";
import { loader as editLoader, action as editAction } from "../app/routes/admin/galleries-edit";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";

function createRouteArgs(request: Request, params: Record<string, string> = {}) {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: new RouterContextProvider(),
    url,
    pattern: url.pathname,
  };
}

/**
 * Creates an authentic historical V2 SQLite database without code_version column,
 * matching Schema V2 from commit 017b2f813c1ab9a47df4008694f3331c3dd81f3c.
 */
function createHistoricalV2Database(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE gallery_schema (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
    INSERT INTO gallery_schema (version, name, applied_at) VALUES (1, 'parallax_gallery_v1', 1700000000000);
    INSERT INTO gallery_schema (version, name, applied_at) VALUES (2, 'parallax_gallery_v2', 1700000001000);

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
      retention_exempt INTEGER NOT NULL DEFAULT 0,
      retention_exempt_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX idx_galleries_public_id ON galleries(public_id);
    CREATE INDEX idx_galleries_status ON galleries(status);
    CREATE INDEX idx_galleries_created_at ON galleries(created_at);

    CREATE TABLE gallery_codes (
      gallery_id TEXT PRIMARY KEY,
      code_hash TEXT UNIQUE NOT NULL,
      code_encrypted TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_gallery_codes_hash ON gallery_codes(code_hash);

    CREATE TABLE gallery_media (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      is_ready INTEGER NOT NULL DEFAULT 0,
      preview_data TEXT,
      poster_revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
      UNIQUE(gallery_id, content_hash)
    );

    CREATE TABLE gallery_import_jobs (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      import_folder TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_total INTEGER NOT NULL DEFAULT 0,
      progress_current INTEGER NOT NULL DEFAULT 0,
      scanned_photos INTEGER NOT NULL DEFAULT 0,
      scanned_videos INTEGER NOT NULL DEFAULT 0,
      rejected_files INTEGER NOT NULL DEFAULT 0,
      rejection_report TEXT,
      lease_worker_id TEXT,
      lease_token TEXT,
      lease_expires_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_gallery_import_unique_active ON gallery_import_jobs(gallery_id) WHERE status IN ('pending', 'scanning', 'importing');

    CREATE TABLE gallery_deletion_jobs (
      id TEXT PRIMARY KEY,
      gallery_id TEXT NOT NULL,
      relative_quarantine_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      worker_id TEXT,
      lease_expires_at INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      decision_source TEXT NOT NULL DEFAULT 'manual',
      gallery_title TEXT,
      media_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE retention_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      retention_days INTEGER DEFAULT NULL,
      log_retention_days INTEGER DEFAULT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO retention_settings (id, enabled, retention_days, log_retention_days, revision, updated_at)
    VALUES (1, 0, NULL, NULL, 1, 1700000001000);
  `);
  return db;
}

describe("Gallery Schema V3 Migration & Historical V2 Resilience", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;
  let testImportPath: string;
  let adminCookie: string;
  let csrfToken: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-v3-migration-test-"));
    testDbPath = path.join(tmpDir, "gallery.sqlite");
    testMediaPath = path.join(tmpDir, "gallery-media");
    testImportPath = path.join(tmpDir, "gallery-import");

    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(testImportPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_DB_PATH = testDbPath;
    process.env.GALLERY_MEDIA_PATH = testMediaPath;
    process.env.GALLERY_IMPORT_PATH = testImportPath;
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    process.env.RATE_LIMIT_DB_PATH = path.join(tmpDir, "ratelimit.sqlite");
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long!";
    process.env.SITE_CONTENT_PATH = path.join(tmpDir, "site-content.json");
    process.env.SITE_MEDIA_PATH = path.join(tmpDir, "site-media");
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    process.env.TRUST_PROXY = "true";
    process.env.ADMIN_SESSION_SECRET = "admin-session-secret-at-least-32-chars-long!";
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";

    // Setup admin session
    csrfToken = crypto.randomUUID();
    const session = await getSession();
    session.set("adminId", crypto.randomUUID());
    session.set("credentialVersion", computeCredentialVersion());
    session.set("csrfToken", csrfToken);
    session.set("createdAt", Date.now());
    session.set("expiresAt", Date.now() + 8 * 3600 * 1000);
    adminCookie = await commitSession(session);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeGalleryDb();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("1. migrates gallery with code in version 7 to durable version 7, preserving code, data and active session", async () => {
    // Setup historical V2 database
    const rawDb = createHistoricalV2Database(testDbPath);
    const galId = crypto.randomUUID();
    const pubId = "pub-v2-version-7";
    const plainCode = "PARALLAX-77777-88888-99999-00000";
    const codeHash = hashGalleryCode(plainCode);
    const codeEnc = encryptGalleryCode(plainCode);
    const tCode = Date.now() - 3600000;

    rawDb.prepare(`
      INSERT INTO galleries (
        id, public_id, title, client_name, project_date, location, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, 'Galerie Historique V7', 'Client V7', '2026-05-15', 'Bruxelles', 'published', ?, ?, ?)
    `).run(galId, pubId, Date.now() + 86400000, tCode, tCode);

    rawDb.prepare(`
      INSERT INTO gallery_codes (gallery_id, code_hash, code_encrypted, version, updated_at)
      VALUES (?, ?, ?, 7, ?)
    `).run(galId, codeHash, codeEnc, tCode);

    // Prepare active client session created for version 7
    const clientStorage = getGallerySessionStorage();
    const clientSession = await clientStorage.getSession();
    clientSession.set("galleryId", galId);
    clientSession.set("codeVersion", 7);
    clientSession.set("issuedAt", tCode + 60000); // 1 minute after code creation
    clientSession.set("expiresAt", Date.now() + 8 * 3600 * 1000);
    const clientCookie = await clientStorage.commitSession(clientSession);

    rawDb.close();

    // Open with current initialiser -> triggers Schema V3 Migration
    const db = openGalleryDb(testDbPath);

    // Verify V3 schema marker registered
    const v3Row = db.prepare("SELECT version, name FROM gallery_schema WHERE version = 3").get() as {
      version: number;
      name: string;
    };
    expect(v3Row).toBeDefined();
    expect(v3Row.version).toBe(3);
    expect(v3Row.name).toBe("parallax_gallery_v3");

    // Verify galleries.code_version was backfilled to 7
    const galRow = db.prepare("SELECT * FROM galleries WHERE id = ?").get(galId) as {
      code_version: number;
      title: string;
      client_name: string;
    };
    expect(galRow.code_version).toBe(7);
    expect(galRow.title).toBe("Galerie Historique V7");
    expect(galRow.client_name).toBe("Client V7");

    // Verify existing client session remains valid
    const accessReq = new Request(`http://127.0.0.1:3000/fr/galerie/${pubId}`, {
      headers: { Cookie: clientCookie },
    });
    const accessResult = await requireGalleryAccess(accessReq, pubId, undefined, true);
    expect(accessResult.gallery.id).toBe(galId);
  });

  it("2. safely migrates gallery with missing code row and rejects ancient version 2 cookie after explicit recovery", async () => {
    // Equality deliberately defeats an issuedAt < code.updated_at-only guard.
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    // Setup historical V2 database with a gallery whose code row was deleted in V2
    const rawDb = createHistoricalV2Database(testDbPath);
    const galId = crypto.randomUUID();
    const pubId = "pub-v2-deleted-code";
    const tAncient = Date.now();

    rawDb.prepare(`
      INSERT INTO galleries (
        id, public_id, title, client_name, project_date, location, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, 'Galerie Code Supprimé En V2', 'Client Orphelin', '2026-05-15', 'Liège', 'published', ?, ?, ?)
    `).run(galId, pubId, Date.now() + 86400000, tAncient, tAncient);

    // Create an ancient client session signed when the gallery was at version 2 (prior to deletion)
    const clientStorage = getGallerySessionStorage();
    const ancientSession = await clientStorage.getSession();
    ancientSession.set("galleryId", galId);
    ancientSession.set("codeVersion", 2); // Ancient version was 2!
    ancientSession.set("issuedAt", tAncient);
    ancientSession.set("expiresAt", Date.now() + 8 * 3600 * 1000);
    const ancientCookie = await ancientStorageCookie(ancientSession);

    // In V2, the code row does NOT exist (already deleted)
    rawDb.close();

    // Open with current initialiser -> triggers Schema V3 Migration
    openGalleryDb(testDbPath);

    // 1. Verify code state in admin loader is unavailable (not_found) without crash
    const state = getGalleryAccessCodeState(galId);
    expect(state.status).toBe("unavailable");
    expect(state.reason).toBe("not_found");
    expect(state.code).toBeNull();
    expect(state.warning).toContain("Aucun code d'accès n'est enregistré");

    // 2. Ancient cookie during absence is rejected (401)
    const accessReqDuring = new Request(`http://127.0.0.1:3000/fr/galerie/${pubId}`, {
      headers: { Cookie: ancientCookie },
    });
    await expect(requireGalleryAccess(accessReqDuring, pubId, undefined, true)).rejects.toSatisfy((err: unknown) => {
      return err instanceof Response && err.status === 401;
    });

    // 3. Admin performs explicit recovery/rotation
    const rotateBody = new URLSearchParams({
      csrfToken,
      intent: "rotate_code",
    });
    const rotateReq = new Request(`http://127.0.0.1:3000/admin/galleries/${galId}`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: rotateBody.toString(),
    });
    const rotateRes = await editAction(createRouteArgs(rotateReq, { id: galId }));
    expect(rotateRes.status).toBe(200);
    const rotateData = await rotateRes.json();
    const newCode = rotateData.success.match(/PARALLAX-[A-Z0-9-]+/)![0];

    // 4. CRITICAL: Ancient version 2 cookie MUST REMAIN REJECTED after recovery,
    // even if the fallback version happened to be 2!
    const accessReqAfter = new Request(`http://127.0.0.1:3000/fr/galerie/${pubId}`, {
      headers: { Cookie: ancientCookie },
    });
    await expect(requireGalleryAccess(accessReqAfter, pubId, undefined, true)).rejects.toSatisfy((err: unknown) => {
      return err instanceof Response && err.status === 401;
    });

    // 5. Fresh client login with newly generated code succeeds
    const newClientSession = await clientStorage.getSession();
    const clientCsrf = createGalleryCsrfToken();
    newClientSession.set("csrfToken", clientCsrf);
    const clientLoginReq = new Request("http://127.0.0.1:3000/fr/espace-client", {
      headers: {
        Origin: "http://127.0.0.1:3000",
        "x-forwarded-for": "127.0.0.1",
      },
    });
    const authResult = await authenticateGalleryCode(clientLoginReq, newCode, clientCsrf, newClientSession);
    expect(authResult.success).toBe(true);

    if (authResult.success) {
      const generation = getGalleryById(galId)?.code_generation;
      expect(generation).toMatch(/^[0-9a-f-]{36}$/);
      const freshSession = await clientStorage.getSession(authResult.sessionCookie);
      expect(freshSession.get("codeGeneration")).toBe(generation);
      const accessReqNew = new Request(`http://127.0.0.1:3000/fr/galerie/${pubId}`, {
        headers: { Cookie: authResult.sessionCookie },
      });
      const accessResult = await requireGalleryAccess(accessReqNew, pubId, undefined, true);
      expect(accessResult.gallery.id).toBe(galId);

      // The generation survives reopening, and two rotations in the same millisecond differ.
      closeGalleryDb();
      expect(getGalleryById(galId)?.code_generation).toBe(generation);
      const rotation2 = rotateGalleryCode(galId);
      const generation2 = getGalleryById(galId)?.code_generation;
      expect(generation2).not.toBe(generation);
      await expect(requireGalleryAccess(accessReqNew, pubId, undefined, true)).rejects.toSatisfy(
        (err: unknown) => err instanceof Response && err.status === 401
      );
      const secondSession = await clientStorage.getSession();
      const csrf2 = createGalleryCsrfToken();
      secondSession.set("csrfToken", csrf2);
      const auth2 = await authenticateGalleryCode(clientLoginReq, rotation2.code, csrf2, secondSession);
      expect(auth2.success).toBe(true);
      if (auth2.success) {
        const req2 = new Request(`http://127.0.0.1:3000/fr/galerie/${pubId}`, { headers: { Cookie: auth2.sessionCookie } });
        expect((await requireGalleryAccess(req2, pubId, undefined, true)).gallery.id).toBe(galId);
      }
    }
  });

  it("3. supports createGallery, getGalleries list, HTML editor loader, .data loader, and code rotation on migrated V2 database", async () => {
    // Setup historical V2 db
    const rawDb = createHistoricalV2Database(testDbPath);
    rawDb.close();

    // Migrate to V3
    openGalleryDb(testDbPath);

    // 1. createGallery()
    const { gallery, plainCode } = createGallery({
      title: "Nouvelle Galerie Post-Migration",
      clientName: "Client Post-Migration",
      projectDate: "2026-06-20",
    });
    expect(gallery.id).toBeDefined();
    expect(gallery.code_version).toBe(1);

    // 2. getGalleries() list
    const list = getGalleries();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(gallery.id);
    expect(list[0].codeVersion).toBe(1);

    // 3. Edit HTML loader
    const htmlReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}`, {
      headers: { Cookie: adminCookie },
    });
    const htmlRes = await editLoader(createRouteArgs(htmlReq, { id: gallery.id }));
    expect(htmlRes.status).toBe(200);
    const htmlData = await htmlRes.json();
    expect(htmlData.codeStatus).toBe("available");
    expect(htmlData.accessCode).toBe(plainCode);
    expect(htmlData.codeVersion).toBe(1);

    // 4. Edit .data loader
    const dataReq = new Request(`http://127.0.0.1:3000/admin/galleries/${gallery.id}.data`, {
      headers: { Cookie: adminCookie },
    });
    const dataRes = await editLoader(createRouteArgs(dataReq, { id: gallery.id }));
    expect(dataRes.status).toBe(200);

    // 5. rotateGalleryCode()
    const rotation = rotateGalleryCode(gallery.id);
    expect(rotation.version).toBe(2);
    expect(rotation.code).not.toBe(plainCode);

    const updatedGallery = getGalleryById(gallery.id);
    expect(updatedGallery?.code_version).toBe(2);
  });

  it("4. preserves superior durable version and is idempotent on second opening", async () => {
    const rawDb = createHistoricalV2Database(testDbPath);
    // Add galleries.code_version manually with an already superior version (e.g. 15)
    // while gallery_codes is at version 7, before V3 marker exists
    rawDb.exec("ALTER TABLE galleries ADD COLUMN code_version INTEGER NOT NULL DEFAULT 1;");
    const galId = crypto.randomUUID();
    rawDb.prepare(`
      INSERT INTO galleries (
        id, public_id, title, client_name, project_date, code_version, status, created_at, updated_at
      ) VALUES (?, 'pub-higher', 'Galerie Version Haute', 'Client', '2026-05-15', 15, 'draft', ?, ?)
    `).run(galId, Date.now(), Date.now());

    rawDb.prepare(`
      INSERT INTO gallery_codes (gallery_id, code_hash, code_encrypted, version, updated_at)
      VALUES (?, 'dummy-hash', 'dummy-enc', 7, ?)
    `).run(galId, Date.now());

    rawDb.close();

    // First open: V3 runs
    const db1 = openGalleryDb(testDbPath);
    const gal1 = db1.prepare("SELECT code_version FROM galleries WHERE id = ?").get(galId) as { code_version: number };
    // Must NOT lower the superior durable version: MAX(7, 15) = 15!
    expect(gal1.code_version).toBe(15);

    // Capture state snapshot
    const snap1 = {
      schema: db1.prepare("SELECT * FROM gallery_schema ORDER BY version").all(),
      galleries: db1.prepare("SELECT * FROM galleries ORDER BY id").all(),
      codes: db1.prepare("SELECT * FROM gallery_codes ORDER BY gallery_id").all(),
    };
    db1.close();

    // Second open: should do 0 mutations
    const db2 = openGalleryDb(testDbPath);
    const snap2 = {
      schema: db2.prepare("SELECT * FROM gallery_schema ORDER BY version").all(),
      galleries: db2.prepare("SELECT * FROM galleries ORDER BY id").all(),
      codes: db2.prepare("SELECT * FROM gallery_codes ORDER BY gallery_id").all(),
    };
    expect(snap2).toEqual(snap1);
    db2.close();
  });

  it("5. rolls back completely on injected migration failure, leaves no false V3 marker, and resumes cleanly on next open", () => {
    const rawDb = createHistoricalV2Database(testDbPath);
    const galId = crypto.randomUUID();
    rawDb.prepare(`
      INSERT INTO galleries (id, public_id, title, client_name, project_date, status, created_at, updated_at)
      VALUES (?, 'pub-trigger', 'Galerie Trigger', 'Client Trigger', '2026-06-01', 'draft', ?, ?)
    `).run(galId, Date.now(), Date.now());
    rawDb.prepare(`
      INSERT INTO gallery_codes (gallery_id, code_hash, code_encrypted, version, updated_at)
      VALUES (?, 'hash-trig', 'enc-trig', 1, ?)
    `).run(galId, Date.now());

    // Inject a trigger that forces an error on updating galleries
    rawDb.exec(`
      CREATE TRIGGER fail_on_update
      BEFORE UPDATE ON galleries
      BEGIN
        SELECT RAISE(FAIL, 'injected migration error');
      END;
    `);
    rawDb.close();

    // Attempt open -> must throw GalleryDatabaseError and rollback
    expect(() => openGalleryDb(testDbPath)).toThrow();

    // Check database state after rollback
    const verifyDb = new DatabaseSync(testDbPath);
    const v3Row = verifyDb.prepare("SELECT version FROM gallery_schema WHERE version = 3").get();
    expect(v3Row).toBeUndefined(); // NO false V3 marker!

    // Clear injected failure trigger
    verifyDb.exec("DROP TRIGGER fail_on_update;");
    verifyDb.close();

    // Next open succeeds cleanly
    const cleanDb = openGalleryDb(testDbPath);
    const v3RowClean = cleanDb.prepare("SELECT version FROM gallery_schema WHERE version = 3").get() as { version: number };
    expect(v3RowClean).toBeDefined();
    expect(v3RowClean.version).toBe(3);
    cleanDb.close();
  });

  it("6. cleanly migrates fresh database and pure V1 database, and preserves code deletion/repair revocation regression", () => {
    // 6a. Fresh database
    const freshDbPath = path.join(tmpDir, "fresh.sqlite");
    const freshDb = openGalleryDb(freshDbPath);
    const freshSchema = freshDb.prepare("SELECT version, name FROM gallery_schema ORDER BY version").all() as {
      version: number;
      name: string;
    }[];
    expect(freshSchema.length).toBe(4);
    expect(freshSchema[0].version).toBe(1);
    expect(freshSchema[1].version).toBe(2);
    expect(freshSchema[2].version).toBe(3);
    expect(freshSchema[3].version).toBe(4);
    freshDb.close();

    // 6b. Pure V1 database (only Schema V1)
    const v1DbPath = path.join(tmpDir, "v1.sqlite");
    const rawV1 = new DatabaseSync(v1DbPath);
    rawV1.exec(`
      CREATE TABLE gallery_schema (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
      INSERT INTO gallery_schema VALUES (1, 'parallax_gallery_v1', 1700000000000);
      CREATE TABLE galleries (
        id TEXT PRIMARY KEY, public_id TEXT UNIQUE NOT NULL, title TEXT NOT NULL, client_name TEXT NOT NULL,
        project_date TEXT NOT NULL, location TEXT, intro_fr TEXT, intro_en TEXT, signature_fr TEXT, signature_en TEXT,
        status TEXT NOT NULL DEFAULT 'draft', expires_at INTEGER, cover_media_id TEXT, revision INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE gallery_codes (
        gallery_id TEXT PRIMARY KEY, code_hash TEXT UNIQUE NOT NULL, code_encrypted TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
        FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
      );
      CREATE TABLE gallery_media (
        id TEXT PRIMARY KEY, gallery_id TEXT NOT NULL, media_type TEXT NOT NULL, sort_order INTEGER NOT NULL,
        original_filename TEXT NOT NULL, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL,
        content_hash TEXT NOT NULL, width INTEGER, height INTEGER, is_ready INTEGER NOT NULL DEFAULT 0,
        preview_data TEXT, poster_revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE, UNIQUE(gallery_id, content_hash)
      );
      CREATE TABLE gallery_import_jobs (
        id TEXT PRIMARY KEY, gallery_id TEXT NOT NULL, import_folder TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        progress_total INTEGER NOT NULL DEFAULT 0, progress_current INTEGER NOT NULL DEFAULT 0, scanned_photos INTEGER NOT NULL DEFAULT 0,
        scanned_videos INTEGER NOT NULL DEFAULT 0, rejected_files INTEGER NOT NULL DEFAULT 0, rejection_report TEXT,
        lease_worker_id TEXT, lease_token TEXT, lease_expires_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error_message TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE
      );
      CREATE TABLE gallery_deletion_jobs (
        id TEXT PRIMARY KEY, gallery_id TEXT NOT NULL, relative_quarantine_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        worker_id TEXT, lease_expires_at INTEGER, attempt_count INTEGER NOT NULL DEFAULT 0, error_code TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `);
    rawV1.close();

    // Migrate pure V1 -> runs V2 then V3
    const migratedV1 = openGalleryDb(v1DbPath);
    const v1Schema = migratedV1.prepare("SELECT version FROM gallery_schema ORDER BY version").all() as { version: number }[];
    expect(v1Schema.map((s) => s.version)).toEqual([1, 2, 3, 4]);

    const galCols = (migratedV1.prepare("PRAGMA table_info(galleries)").all() as { name: string }[]).map((c) => c.name);
    expect(galCols).toContain("retention_exempt");
    expect(galCols).toContain("code_version");
    migratedV1.close();
  });

  it("7. migrates an existing V3 database to V4 atomically and idempotently", () => {
    const raw = createHistoricalV2Database(testDbPath);
    raw.exec("ALTER TABLE galleries ADD COLUMN code_version INTEGER NOT NULL DEFAULT 1;");
    raw.exec("INSERT INTO gallery_schema VALUES (3, 'parallax_gallery_v3', 1700000002000);");
    const retentionBefore = raw.prepare("SELECT * FROM retention_settings").all();
    raw.exec(`
      CREATE TRIGGER fail_v4 BEFORE INSERT ON gallery_schema WHEN NEW.version = 4
      BEGIN SELECT RAISE(ABORT, 'injected V4 failure'); END;
    `);
    raw.close();

    expect(() => openGalleryDb(testDbPath)).toThrow();
    const verify = new DatabaseSync(testDbPath);
    expect(verify.prepare("SELECT version FROM gallery_schema WHERE version = 4").get()).toBeUndefined();
    expect((verify.prepare("PRAGMA table_info(galleries)").all() as { name: string }[]).some((c) => c.name === "code_generation")).toBe(false);
    expect(verify.prepare("SELECT * FROM retention_settings").all()).toEqual(retentionBefore);
    verify.exec("DROP TRIGGER fail_v4;");
    verify.close();

    const migrated = openGalleryDb(testDbPath);
    expect((migrated.prepare("PRAGMA table_info(galleries)").all() as { name: string }[]).some((c) => c.name === "code_generation")).toBe(true);
    const snapshot = migrated.prepare("SELECT * FROM gallery_schema ORDER BY version").all();
    expect(snapshot).toHaveLength(4);
    migrated.close();
    const reopened = openGalleryDb(testDbPath);
    expect(reopened.prepare("SELECT * FROM gallery_schema ORDER BY version").all()).toEqual(snapshot);
    expect(reopened.prepare("SELECT * FROM retention_settings").all()).toEqual(retentionBefore);
    reopened.close();
  });

  it("8. rolls back generation and version together when code rotation fails", () => {
    const { gallery } = createGallery({ title: "Rotation atomique", clientName: "Fixture", projectDate: "2026-10-25" });
    rotateGalleryCode(gallery.id);
    const db = openGalleryDb(testDbPath);
    const beforeGallery = db.prepare("SELECT * FROM galleries WHERE id = ?").get(gallery.id);
    const beforeCode = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id);
    db.exec(`
      CREATE TRIGGER fail_code_rotation BEFORE UPDATE ON gallery_codes
      BEGIN SELECT RAISE(ABORT, 'injected code rotation failure'); END;
    `);
    expect(() => rotateGalleryCode(gallery.id)).toThrow();
    expect(db.prepare("SELECT * FROM galleries WHERE id = ?").get(gallery.id)).toEqual(beforeGallery);
    expect(db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id)).toEqual(beforeCode);
    db.exec("DROP TRIGGER fail_code_rotation;");
    rotateGalleryCode(gallery.id);
    expect(getGalleryById(gallery.id)?.code_generation).not.toBe((beforeGallery as { code_generation: string }).code_generation);
    db.close();
  });
});

async function ancientStorageCookie(session: Parameters<ReturnType<typeof getGallerySessionStorage>["commitSession"]>[0]): Promise<string> {
  const storage = getGallerySessionStorage();
  return storage.commitSession(session);
}
