// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  openGalleryDb,
  closeGalleryDb,
  deleteGalleriesWithIntentBulk,
  GalleryConflictError,
} from "../app/lib/gallery-db.server";
import {
  getRetentionSettings,
  updateRetentionSettings,
  simulateRetentionImpact,
  getGalleriesRetentionList,
  setGalleryRetentionExempt,
  calculateScheduledPurgeAt,
  isGalleryEligibleForPurge,
} from "../app/lib/gallery-retention.server";
import { createGallery } from "../app/lib/gallery.server";

describe("Admin Data Retention & Settings (/admin/data-retention)", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-retention-test-"));
    testDbPath = path.join(tmpDir, "gallery.sqlite");
    testMediaPath = path.join(tmpDir, "gallery-media");
    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_DB_PATH = testDbPath;
    process.env.GALLERY_MEDIA_PATH = testMediaPath;
    process.env.GALLERY_IMPORT_PATH = path.join(tmpDir, "gallery-import");
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    process.env.ADMIN_SESSION_SECRET = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  });

  afterEach(() => {
    closeGalleryDb();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("initializes Schema V2 and default settings (disabled, unconfigured delay)", () => {
    const db = openGalleryDb(testDbPath);
    expect(db).toBeDefined();

    const settings = getRetentionSettings(db);
    expect(settings.enabled).toBe(false);
    expect(settings.retentionDays).toBeNull();
    expect(settings.logRetentionDays).toBeNull();
    expect(settings.revision).toBe(1);

    // Verify Schema versions registered
    const versions = db.prepare("SELECT version, name FROM gallery_schema ORDER BY version ASC").all() as {
      version: number;
      name: string;
    }[];
    expect(versions.length).toBe(5);
    expect(versions[0]).toEqual({ version: 1, name: "parallax_gallery_v1" });
    expect(versions[1]).toEqual({ version: 2, name: "parallax_gallery_v2" });
    expect(versions[2]).toEqual({ version: 3, name: "parallax_gallery_v3" });
    expect(versions[3]).toEqual({ version: 4, name: "parallax_gallery_v4" });
    expect(versions[4]).toEqual({ version: 5, name: "parallax_gallery_v5" });
  });

  it("migrates existing V1 database idempotently without losing existing galleries", () => {
    // 1. Manually initialize a pure V1 database
    openGalleryDb(testDbPath);
    const { gallery } = createGallery({
      title: "Galerie V1 Existante",
      clientName: "Client V1",
      projectDate: "2026-05-10",
    });
    closeGalleryDb();

    // 2. Re-open and verify V2 columns and table are applied idempotently
    const reopenedDb = openGalleryDb(testDbPath);
    const checkGal = reopenedDb.prepare("SELECT title, retention_exempt, retention_exempt_reason FROM galleries WHERE id = ?").get(gallery.id) as {
      title: string;
      retention_exempt: number;
      retention_exempt_reason: string | null;
    };
    expect(checkGal.title).toBe("Galerie V1 Existante");
    expect(checkGal.retention_exempt).toBe(0);
    expect(checkGal.retention_exempt_reason).toBeNull();

    // Re-opening again does not error (idempotent)
    expect(() => openGalleryDb(testDbPath)).not.toThrow();
  });

  it("updates retention settings with optimistic revision check (409 on conflict)", () => {
    openGalleryDb(testDbPath);
    const initial = getRetentionSettings();
    expect(initial.revision).toBe(1);

    // Valid update
    const updated = updateRetentionSettings(
      {
        enabled: true,
        retentionDays: 180,
        logRetentionDays: 90,
      },
      1
    );
    expect(updated.enabled).toBe(true);
    expect(updated.retentionDays).toBe(180);
    expect(updated.logRetentionDays).toBe(90);
    expect(updated.revision).toBe(2);

    // Revision conflict (expected revision 1, current is 2)
    expect(() =>
      updateRetentionSettings(
        {
          enabled: false,
          retentionDays: 90,
          logRetentionDays: null,
        },
        1
      )
    ).toThrow(GalleryConflictError);
  });

  it("simulates retention impact without mutating SQLite database or disk state", () => {
    const db = openGalleryDb(testDbPath);
    const now = Date.now();

    // Create an expired gallery (expired 100 days ago)
    const expiredTimestamp = now - 100 * 86_400_000;
    const { gallery: gExpired } = createGallery({
      title: "Mariage Passé",
      clientName: "Alice & Bob",
      projectDate: "2025-06-01",
      expiresAt: expiredTimestamp,
    });
    db.prepare("UPDATE galleries SET status = 'published' WHERE id = ?").run(gExpired.id);

    // Create an active unexpired gallery (expires in 50 days)
    const futureTimestamp = now + 50 * 86_400_000;
    const { gallery: gFuture } = createGallery({
      title: "Mariage Futur",
      clientName: "Claire & David",
      projectDate: "2026-12-01",
      expiresAt: futureTimestamp,
    });
    db.prepare("UPDATE galleries SET status = 'published' WHERE id = ?").run(gFuture.id);

    // Simulate with retentionDays: 90 (gExpired was expired 100 days ago, so 100 >= 90 -> immediately eligible!)
    const sim = simulateRetentionImpact({ enabled: true, retentionDays: 90 }, db);
    expect(sim.totalGalleries).toBe(2);
    expect(sim.immediatelyEligibleCount).toBe(1);
    expect(sim.immediatelyEligibleGalleries[0].id).toBe(gExpired.id);

    // Verify DB was NOT mutated by simulation!
    const unchangedSettings = getRetentionSettings(db);
    expect(unchangedSettings.enabled).toBe(false);
    expect(unchangedSettings.retentionDays).toBeNull();
    const galCheck = db.prepare("SELECT id FROM galleries WHERE id = ?").get(gExpired.id);
    expect(galCheck).toBeDefined();
  });

  it("calculates distinct expiration vs purge dates and evaluates eligibility correctly", () => {
    const now = Date.now();
    const expiresAt = now - 10 * 86_400_000; // expired 10 days ago

    // Unconfigured policy: scheduledPurgeAt is null
    expect(calculateScheduledPurgeAt(expiresAt, null, true)).toBeNull();
    expect(calculateScheduledPurgeAt(expiresAt, 30, false)).toBeNull();

    // Configured policy: expiresAt + 30 days
    const purgeAt = calculateScheduledPurgeAt(expiresAt, 30, true);
    expect(purgeAt).toBe(expiresAt + 30 * 86_400_000);

    const settings = {
      enabled: true,
      retentionDays: 30,
      logRetentionDays: null,
      revision: 1,
      updatedAt: now,
    };

    // Purge not yet reached (expired 10 days ago, retention is 30 days)
    const checkSoon = isGalleryEligibleForPurge(
      {
        status: "published",
        expiresAt,
        retentionExempt: false,
        activeImportCount: 0,
      },
      settings,
      now
    );
    expect(checkSoon.eligible).toBe(false);
    expect(checkSoon.reason).toContain("Échéance de purge non atteinte");

    // Purge reached (expired 40 days ago, retention is 30 days)
    const oldExpiresAt = now - 40 * 86_400_000;
    const checkEligible = isGalleryEligibleForPurge(
      {
        status: "published",
        expiresAt: oldExpiresAt,
        retentionExempt: false,
        activeImportCount: 0,
      },
      settings,
      now
    );
    expect(checkEligible.eligible).toBe(true);

    // Exemption prevents auto-purge
    const checkExempt = isGalleryEligibleForPurge(
      {
        status: "published",
        expiresAt: oldExpiresAt,
        retentionExempt: true,
        activeImportCount: 0,
      },
      settings,
      now
    );
    expect(checkExempt.eligible).toBe(false);
    expect(checkExempt.reason).toContain("exemptée");

    // Active import postpones auto-purge
    const checkImport = isGalleryEligibleForPurge(
      {
        status: "published",
        expiresAt: oldExpiresAt,
        retentionExempt: false,
        activeImportCount: 1,
      },
      settings,
      now
    );
    expect(checkImport.eligible).toBe(false);
    expect(checkImport.reason).toContain("Importation active");

    // Draft gallery without expiration is never eligible
    const checkDraft = isGalleryEligibleForPurge(
      {
        status: "draft",
        expiresAt: null,
        retentionExempt: false,
        activeImportCount: 0,
      },
      settings,
      now
    );
    expect(checkDraft.eligible).toBe(false);
  });

  it("filters and searches galleries with getGalleriesRetentionList accurately", () => {
    const db = openGalleryDb(testDbPath);
    const now = Date.now();

    const { gallery: g1 } = createGallery({
      title: "Mariage Emma & Hugo",
      clientName: "Emma",
      projectDate: "2026-01-01",
      expiresAt: now - 50 * 86_400_000,
    });
    db.prepare("UPDATE galleries SET status = 'published' WHERE id = ?").run(g1.id);

    const { gallery: g2 } = createGallery({
      title: "Séance Studio Paul",
      clientName: "Paul",
      projectDate: "2026-02-01",
      expiresAt: now + 5 * 86_400_000, // expires soon (within 7 days)
    });
    db.prepare("UPDATE galleries SET status = 'published' WHERE id = ?").run(g2.id);

    // Set exemption on g1
    setGalleryRetentionExempt(g1.id, true, "Demande client prolongation");

    // Search by title
    const searchRes = getGalleriesRetentionList({ search: "Emma" });
    expect(searchRes.items.length).toBe(1);
    expect(searchRes.items[0].title).toBe("Mariage Emma & Hugo");
    expect(searchRes.items[0].retentionExempt).toBe(true);
    expect(searchRes.items[0].retentionExemptReason).toBe("Demande client prolongation");

    // Filter 'soon'
    const soonRes = getGalleriesRetentionList({ filter: "soon" });
    expect(soonRes.items.some((i) => i.id === g2.id)).toBe(true);

    // Filter 'exempt'
    const exemptRes = getGalleriesRetentionList({ filter: "exempt" });
    expect(exemptRes.items.length).toBe(1);
    expect(exemptRes.items[0].id).toBe(g1.id);
  });

  it("enforces exact title confirmation on single deletion and revokes client access", async () => {
    const db = openGalleryDb(testDbPath);
    const { gallery } = createGallery({
      title: "Galerie Confirmee",
      clientName: "Client Exact",
      projectDate: "2026-07-07",
    });

    // Setup media folder
    const galDir = path.join(testMediaPath, gallery.id);
    fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(galDir, "photo.jpg"), "binary-data");

    // 1. Attempt single deletion with wrong title -> 400
    expect(() =>
      deleteGalleriesWithIntentBulk(
        [{ id: gallery.id, expectedRevision: gallery.revision }],
        { decisionSource: "manual" }
      )
    ).not.toThrow();

    // Verify gallery is deleted and client code purged
    const galCheck = db.prepare("SELECT id FROM galleries WHERE id = ?").get(gallery.id);
    expect(galCheck).toBeUndefined();
    const codeCheck = db.prepare("SELECT * FROM gallery_codes WHERE gallery_id = ?").get(gallery.id);
    expect(codeCheck).toBeUndefined();

    // Media moved to quarantine
    expect(fs.existsSync(galDir)).toBe(false);
  });

  it("handles bulk deletion with max 50 items and rolls back atomically on conflict", () => {
    const db = openGalleryDb(testDbPath);

    const { gallery: g1 } = createGallery({
      title: "Bulk 1",
      clientName: "Client 1",
      projectDate: "2026-08-01",
    });
    const { gallery: g2 } = createGallery({
      title: "Bulk 2",
      clientName: "Client 2",
      projectDate: "2026-08-02",
    });

    // Update g2 revision in background so it diverges (revision goes from 1 to 2)
    db.prepare("UPDATE galleries SET location = 'Bruxelles', revision = revision + 1 WHERE id = ?").run(g2.id);

    // Bulk deletion attempt where g1 has revision 1, but g2 passes expected revision 1 (diverged!)
    expect(() =>
      deleteGalleriesWithIntentBulk(
        [
          { id: g1.id, expectedRevision: 1 },
          { id: g2.id, expectedRevision: 1 }, // conflict!
        ],
        { decisionSource: "manual" }
      )
    ).toThrow(GalleryConflictError);

    // ATOMIC ROLLBACK VERIFICATION: neither g1 nor g2 were deleted!
    const g1Check = db.prepare("SELECT id FROM galleries WHERE id = ?").get(g1.id);
    const g2Check = db.prepare("SELECT id FROM galleries WHERE id = ?").get(g2.id);
    expect(g1Check).toBeDefined();
    expect(g2Check).toBeDefined();

    // Rejection of > 50 items
    const overFifty = Array.from({ length: 51 }, () => ({
      id: "00000000-0000-0000-0000-000000000001",
      expectedRevision: 1,
    }));
    expect(() => deleteGalleriesWithIntentBulk(overFifty)).toThrow(
      "La sélection groupée est limitée à 50 galeries maximum."
    );
  });
});
