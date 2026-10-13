// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  checkRateLimit,
  resetRateLimit,
  closeRateLimitDatabase,
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

  it("enforces safe directory permissions (0700) and file permissions (0600)", () => {
    checkRateLimit("127.0.0.1", "admin");
    const dirStat = fs.statSync(tmpDir);
    expect(dirStat.mode & 0o777).toBe(0o700);

    const fileStat = fs.statSync(dbPath);
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
});
