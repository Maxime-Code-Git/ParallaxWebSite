// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  checkRateLimit,
  resetRateLimit,
  closeRateLimitDatabase,
  RateLimitExceededError,
} from "../app/lib/rate-limit.server";
import { ENV } from "../app/lib/env.server";

vi.mock("../app/lib/env.server", () => ({
  ENV: {
    RATE_LIMIT_DB_PATH: "",
    RATE_LIMIT_SECRET: "mock-rate-limit-secret-32-chars-long!",
  },
}));

describe("rate-limit.server.ts", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-rate-limit-"));
    dbPath = path.join(tmpDir, "rate-limit.sqlite");
    // @ts-expect-error Mocking for test
    ENV.RATE_LIMIT_DB_PATH = dbPath;
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
      "Le fichier de base rate-limit ne doit pas etre un lien symbolique"
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

    // Close database connection
    closeRateLimitDatabase();

    // Reopen and record 2 more attempts
    checkRateLimit(testIp, "admin");
    checkRateLimit(testIp, "admin");

    // 6th attempt must fail
    expect(() => checkRateLimit(testIp, "admin")).toThrow(RateLimitExceededError);
  });

  it("resetRateLimit successfully clears the rate limit counter", () => {
    const testIp = "192.168.1.200";

    for (let i = 0; i < 5; i++) {
      checkRateLimit(testIp, "admin");
    }

    // Rate limit is now exhausted
    expect(() => checkRateLimit(testIp, "admin")).toThrow(RateLimitExceededError);

    // Reset rate limit (e.g. after successful login)
    resetRateLimit(testIp, "admin");

    // Should immediately be allowed again
    expect(() => checkRateLimit(testIp, "admin")).not.toThrow();
  });
});
