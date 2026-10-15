// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import * as crypto from "node:crypto";
import {
  checkRateLimit,
  resetRateLimit,
  closeRateLimitDatabase,
  acquireContactClaim,
  RateLimitExceededError,
  RateLimitStorageError,
} from "../app/lib/rate-limit.server";

let mockDbPath = "";

vi.mock("../app/lib/env.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/env.server")>();
  return {
    ...actual,
    ENV: {
      get RATE_LIMIT_DB_PATH(): string {
        return mockDbPath;
      },
      get RATE_LIMIT_SECRET(): string {
        return "mock-rate-limit-secret-32-chars-long!";
      },
    },
  };
});

describe("rate-limit.server.ts", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-rate-limit-"));
    dbPath = path.join(tmpDir, "rate-limit.sqlite");
    mockDbPath = dbPath;
  });

  afterEach(() => {
    closeRateLimitDatabase();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("creates dedicated directory in 0700 and protects database file in 0600", () => {
    const subDir = path.join(tmpDir, "new-dedicated-dir");
    mockDbPath = path.join(subDir, "rate-limit.sqlite");

    checkRateLimit("127.0.0.1", "admin");
    const dirStat = fs.statSync(subDir);
    expect(dirStat.mode & 0o777).toBe(0o700);

    const fileStat = fs.statSync(mockDbPath);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it("refuses an existing directory with different permissions (0755) without modifying its mode", () => {
    const existingDir = path.join(tmpDir, "existing-dir-755");
    fs.mkdirSync(existingDir, { mode: 0o755 });
    fs.chmodSync(existingDir, 0o755);

    mockDbPath = path.join(existingDir, "rate-limit.sqlite");

    expect(() => checkRateLimit("127.0.0.1", "admin")).toThrow(
      "au lieu de 0700 requises"
    );

    // Verify permissions were NOT changed to 0700 and remain strictly 0755
    const statAfter = fs.statSync(existingDir);
    expect(statAfter.mode & 0o777).toBe(0o755);
  });

  it("accepts an existing directory that already has 0700 mode", () => {
    const existingDir = path.join(tmpDir, "existing-dir-700");
    fs.mkdirSync(existingDir, { mode: 0o700 });
    fs.chmodSync(existingDir, 0o700);

    mockDbPath = path.join(existingDir, "rate-limit.sqlite");

    expect(() => checkRateLimit("127.0.0.1", "admin")).not.toThrow();
    const fileStat = fs.statSync(mockDbPath);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it("refuses to initialize if dbPath is a symlink", () => {
    const realDbPath = path.join(tmpDir, "real.sqlite");
    fs.writeFileSync(realDbPath, "");
    fs.symlinkSync(realDbPath, dbPath);

    expect(() => checkRateLimit("127.0.0.1", "admin")).toThrow(
      "ne doit pas etre un lien symbolique"
    );
  });

  it("refuses to initialize if an ancestor directory is a symlink", () => {
    const realDir = path.join(tmpDir, "real_dir");
    fs.mkdirSync(realDir, { mode: 0o700 });
    const symlinkDir = path.join(tmpDir, "sym_dir");
    fs.symlinkSync(realDir, symlinkDir);

    mockDbPath = path.join(symlinkDir, "rate-limit.sqlite");
    expect(() => checkRateLimit("127.0.0.1", "admin")).toThrow(
      "ne doit pas etre un lien symbolique"
    );
  });

  it("allows 5 attempts and throws RateLimitExceededError on the 6th attempt", () => {
    const testIp = "192.168.1.100";

    // 5 attempts should pass
    for (let i = 0; i < 5; i++) {
      expect(() => checkRateLimit(testIp, "admin")).not.toThrow();
    }

    // 6th attempt must throw
    let thrownError: unknown;
    try {
      checkRateLimit(testIp, "admin");
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(RateLimitExceededError);
    const rlError = thrownError as RateLimitExceededError;
    expect(rlError.retryAfter).toBeGreaterThan(0);
    expect(rlError.retryAfter).toBeLessThanOrEqual(15 * 60);
  });

  it("persists counter across database closing and reopening", () => {
    const testIp = "192.168.1.105";

    for (let i = 0; i < 3; i++) {
      checkRateLimit(testIp, "admin");
    }

    closeRateLimitDatabase();

    checkRateLimit(testIp, "admin");
    checkRateLimit(testIp, "admin");

    expect(() => checkRateLimit(testIp, "admin")).toThrow(RateLimitExceededError);
  });

  it("verifies that raw client IP is NEVER stored in the database", () => {
    const testIp = "203.0.113.42";
    checkRateLimit(testIp, "admin");
    closeRateLimitDatabase();

    const rawDb = new DatabaseSync(dbPath);
    const rows = rawDb.prepare("SELECT hash, timestamp FROM requests").all() as Array<{
      hash: string;
      timestamp: number;
    }>;
    rawDb.close();

    expect(rows.length).toBe(1);
    expect(rows[0].hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].hash).not.toContain(testIp);
    expect(rows[0].hash).not.toContain("admin");
  });

  it("cleans up expired records outside the 15-minute sliding window", () => {
    const testIp = "198.51.100.1";
    checkRateLimit(testIp, "admin");
    closeRateLimitDatabase();

    // Manually age the recorded entry past 15 minutes (900_000 ms)
    const rawDb = new DatabaseSync(dbPath);
    const oldTimestamp = Date.now() - 16 * 60 * 1000;
    rawDb.prepare("UPDATE requests SET timestamp = ?").run(oldTimestamp);
    rawDb.close();

    // Now record 4 more attempts: they must succeed because old one was purged
    for (let i = 0; i < 4; i++) {
      expect(() => checkRateLimit(testIp, "admin")).not.toThrow();
    }
  });

  it("resetRateLimit successfully clears the rate limit counter", () => {
    const testIp = "192.168.1.200";

    for (let i = 0; i < 5; i++) {
      checkRateLimit(testIp, "admin");
    }

    expect(() => checkRateLimit(testIp, "admin")).toThrow(RateLimitExceededError);

    resetRateLimit(testIp, "admin");

    expect(() => checkRateLimit(testIp, "admin")).not.toThrow();
  });

  it("throws RateLimitStorageError on database operational failures", () => {
    // Point to a directory that cannot be created / accessed
    mockDbPath = "/dev/null/impossible-path/db.sqlite";
    expect(() => checkRateLimit("127.0.0.1", "admin")).toThrow(RateLimitStorageError);
  });

  it("protects auxiliary SQLite files (-wal, -shm) and rejects symlinks", () => {
    // First initialize DB
    checkRateLimit("127.0.0.1", "admin");
    closeRateLimitDatabase();

    const walPath = dbPath + "-wal";
    const realAux = path.join(tmpDir, "real_aux");
    fs.writeFileSync(realAux, "dummy");
    fs.symlinkSync(realAux, walPath);

    expect(() => checkRateLimit("127.0.0.1", "admin")).toThrow(
      "Le fichier auxiliaire"
    );
  });

  describe("Schema Migration & Legacy Backward Compatibility", () => {
    function computeTestHash(ip: string, namespace = "admin"): string {
      return crypto
        .createHmac("sha256", "mock-rate-limit-secret-32-chars-long!")
        .update(`${namespace}:${ip}`)
        .digest("hex");
    }

    it("1. migrates cleanly from a database without contact_claims (legacy lot 4)", () => {
      // DB with only requests table from earlier lots
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        CREATE TABLE requests (
          hash TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX idx_requests_hash_timestamp ON requests(hash, timestamp);
      `);
      const testHash = computeTestHash("127.0.0.1", "admin");
      rawDb.prepare("INSERT INTO requests (hash, timestamp) VALUES (?, ?)").run(testHash, Date.now() - 1000);
      rawDb.close();
      fs.chmodSync(dbPath, 0o600);

      // checkRateLimit should initialize and migrate without error
      expect(() => checkRateLimit("127.0.0.1", "admin")).not.toThrow();

      closeRateLimitDatabase();
      const verifyDb = new DatabaseSync(dbPath);
      const tables = verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("requests");
      expect(tableNames).toContain("contact_claims");

      const reqCount = verifyDb.prepare("SELECT COUNT(*) as c FROM requests WHERE hash = ?").get(testHash) as { c: number };
      expect(reqCount.c).toBe(2); // Pre-existing + newly recorded
      verifyDb.close();
    });

    it("2. migrates initial 4-column contact_claims schema, backfilling claim_id, retention and lease", () => {
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        CREATE TABLE requests (
          hash TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE TABLE contact_claims (
          token_hash TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      const createdAt = Date.now() - 30_000;
      const expiresAt = Date.now() + 300_000;
      rawDb.prepare(
        "INSERT INTO contact_claims (token_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).run("token-legacy-4col", "completed", createdAt, expiresAt);
      rawDb.close();
      fs.chmodSync(dbPath, 0o600);

      expect(() => checkRateLimit("127.0.0.1", "admin")).not.toThrow();

      closeRateLimitDatabase();
      const verifyDb = new DatabaseSync(dbPath);
      const row = verifyDb.prepare(
        "SELECT * FROM contact_claims WHERE token_hash = ?"
      ).get("token-legacy-4col") as {
        token_hash: string;
        claim_id: string;
        content_hash: string;
        status: string;
        created_at: number;
        lease_expires_at: number;
        retention_expires_at: number;
        expires_at: number;
      };
      verifyDb.close();

      expect(row).toBeDefined();
      expect(row.claim_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(row.content_hash).toBe("legacy:incompatible");
      expect(row.status).toBe("completed");
      expect(row.lease_expires_at).toBeGreaterThanOrEqual(createdAt);
      expect(row.retention_expires_at).toBeGreaterThanOrEqual(createdAt + 7_260_000);
      expect(row.expires_at).toBeGreaterThanOrEqual(row.retention_expires_at);
    });

    it("3. migrates schema with claim_id and content_hash (commit 55d9e6a), preserving existing values", () => {
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        CREATE TABLE requests (
          hash TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE TABLE contact_claims (
          token_hash TEXT PRIMARY KEY,
          claim_id TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      const existingClaimId = "preserved-uuid-12345678";
      const existingContentHash = "sha256:preexistingcontenthash123";
      const createdAt = Date.now() - 40_000;
      const expiresAt = Date.now() + 500_000;
      rawDb.prepare(
        "INSERT INTO contact_claims (token_hash, claim_id, content_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("token-55d9e6a", existingClaimId, existingContentHash, "completed", createdAt, expiresAt);
      rawDb.close();
      fs.chmodSync(dbPath, 0o600);

      expect(() => checkRateLimit("127.0.0.1", "admin")).not.toThrow();

      closeRateLimitDatabase();
      const verifyDb = new DatabaseSync(dbPath);
      const row = verifyDb.prepare(
        "SELECT * FROM contact_claims WHERE token_hash = ?"
      ).get("token-55d9e6a") as {
        token_hash: string;
        claim_id: string;
        content_hash: string;
        status: string;
        lease_expires_at: number;
        retention_expires_at: number;
      };
      verifyDb.close();

      expect(row.claim_id).toBe(existingClaimId);
      expect(row.content_hash).toBe(existingContentHash);
      expect(row.lease_expires_at).toBeGreaterThan(0);
      expect(row.retention_expires_at).toBeGreaterThanOrEqual(createdAt + 7_260_000);
    });

    it("4. handles fresh database creation and second idempotent initialization", () => {
      expect(() => checkRateLimit("127.0.0.1", "admin")).not.toThrow();
      expect(() => checkRateLimit("127.0.0.1", "admin")).not.toThrow();

      closeRateLimitDatabase();
      expect(() => checkRateLimit("127.0.0.1", "admin")).not.toThrow();
    });

    it("5. preserves requests table rows and active rate limit sliding-window counters across migration", () => {
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        CREATE TABLE requests (
          hash TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE TABLE contact_claims (
          token_hash TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      const testIp = "192.168.1.150";
      const testHash = computeTestHash(testIp, "admin");
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        rawDb.prepare("INSERT INTO requests (hash, timestamp) VALUES (?, ?)").run(testHash, now - (4 - i) * 1000);
      }
      rawDb.close();
      fs.chmodSync(dbPath, 0o600);

      // 5th attempt after migration: must pass
      expect(() => checkRateLimit(testIp, "admin")).not.toThrow();

      // 6th attempt: must throw RateLimitExceededError
      expect(() => checkRateLimit(testIp, "admin")).toThrow(RateLimitExceededError);
    });

    it("6. preserves historical completed claims against premature purge and protects expired in_progress claims", () => {
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        CREATE TABLE requests (hash TEXT NOT NULL, timestamp INTEGER NOT NULL);
        CREATE TABLE contact_claims (
          token_hash TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      const now = Date.now();
      const oneHourAgo = now - 3600_000;
      // Completed claim: token expired 10 minutes ago, but within the 2-hour retention window
      rawDb.prepare(
        "INSERT INTO contact_claims (token_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).run("token-completed-old", "completed", oneHourAgo, now - 600_000);

      // in_progress claim whose short lease expired 2 minutes ago
      rawDb.prepare(
        "INSERT INTO contact_claims (token_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).run("token-in-progress-expired", "in_progress", now - 120_000, now + 3600_000);

      rawDb.close();
      fs.chmodSync(dbPath, 0o600);

      // Trigger migration
      expect(() => checkRateLimit("127.0.0.1", "admin")).not.toThrow();

      closeRateLimitDatabase();
      const verifyDb = new DatabaseSync(dbPath);
      const completedRow = verifyDb.prepare("SELECT * FROM contact_claims WHERE token_hash = ?").get("token-completed-old") as {
        status: string;
        retention_expires_at: number;
      } | undefined;
      const inProgressRow = verifyDb.prepare("SELECT * FROM contact_claims WHERE token_hash = ?").get("token-in-progress-expired") as {
        status: string;
      } | undefined;
      verifyDb.close();

      expect(completedRow).toBeDefined();
      expect(completedRow?.status).toBe("completed");
      expect(completedRow!.retention_expires_at).toBeGreaterThan(now);

      expect(inProgressRow).toBeDefined();
      expect(inProgressRow?.status).toBe("uncertain");
    });

    it("7. safely rejects missing or incompatible legacy hash with conflict_content_mismatch", () => {
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        CREATE TABLE requests (hash TEXT NOT NULL, timestamp INTEGER NOT NULL);
        CREATE TABLE contact_claims (
          token_hash TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      const now = Date.now();
      rawDb.prepare(
        "INSERT INTO contact_claims (token_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).run("token-legacy-compat", "completed", now - 60_000, now + 3600_000);
      rawDb.close();
      fs.chmodSync(dbPath, 0o600);

      const result = acquireContactClaim("token-legacy-compat", "brand-new-submission-hash-12345", now + 3600_000);
      expect(result.status).toBe("conflict_content_mismatch");
      expect(result.status).not.toBe("completed");
      expect(result.status).not.toBe("acquired");
    });

    it("8. ensures indexes physically exist in sqlite_master and are utilized after close and reopen", () => {
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        CREATE TABLE requests (hash TEXT NOT NULL, timestamp INTEGER NOT NULL);
        CREATE TABLE contact_claims (
          token_hash TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      rawDb.close();
      fs.chmodSync(dbPath, 0o600);

      checkRateLimit("127.0.0.1", "admin");
      closeRateLimitDatabase();

      const verifyDb = new DatabaseSync(dbPath);
      const indexes = verifyDb.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'contact_claims'"
      ).all() as Array<{ name: string }>;
      const indexNames = indexes.map((idx) => idx.name);

      expect(indexNames).toContain("idx_contact_claims_retention");
      expect(indexNames).toContain("idx_contact_claims_expires");

      const queryPlan = verifyDb.prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM contact_claims WHERE retention_expires_at > ?"
      ).all(Date.now()) as Array<{ detail: string }>;

      verifyDb.close();

      const planDetails = queryPlan.map((p) => p.detail).join(" ");
      expect(planDetails).toContain("idx_contact_claims_retention");
    });

    it("9. guarantees safe transactional rollback on migration failure with zero data loss or database wipe", () => {
      const rawDb = new DatabaseSync(dbPath);
      rawDb.exec(`
        CREATE TABLE requests (hash TEXT NOT NULL, timestamp INTEGER NOT NULL);
        CREATE TABLE contact_claims (
          token_hash TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      rawDb.prepare("INSERT INTO requests (hash, timestamp) VALUES (?, ?)").run("precious-request-hash", 123456789);
      rawDb.prepare(
        "INSERT INTO contact_claims (token_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).run("precious-token", "completed", 123456789, 987654321);

      // Force failure during migration backfill
      rawDb.exec(`
        CREATE TRIGGER block_migration_test
        BEFORE UPDATE ON contact_claims
        BEGIN
          SELECT RAISE(ABORT, 'controlled_migration_failure');
        END;
      `);
      rawDb.close();
      fs.chmodSync(dbPath, 0o600);

      expect(() => checkRateLimit("127.0.0.1", "admin")).toThrow(RateLimitStorageError);

      closeRateLimitDatabase();
      const verifyDb = new DatabaseSync(dbPath);
      const req = verifyDb.prepare("SELECT * FROM requests WHERE hash = ?").get("precious-request-hash") as {
        hash: string;
        timestamp: number;
      };
      const claim = verifyDb.prepare("SELECT * FROM contact_claims WHERE token_hash = ?").get("precious-token") as {
        token_hash: string;
        status: string;
        created_at: number;
        expires_at: number;
      };
      verifyDb.close();

      expect(req).toBeDefined();
      expect(req.timestamp).toBe(123456789);
      expect(claim).toBeDefined();
      expect(claim.status).toBe("completed");
      expect(claim.created_at).toBe(123456789);
      expect(claim.expires_at).toBe(987654321);
    });
  });
});
