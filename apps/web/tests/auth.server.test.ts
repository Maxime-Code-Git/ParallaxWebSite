// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as argon2 from "@node-rs/argon2";
import {
  getAdminConfig,
  computeCredentialVersion,
  verifyAdminPassword,
  constantTimeEqual,
  requireAdminSession,
} from "../app/lib/auth.server";
import { commitSession, getSession } from "../app/lib/session.server";

vi.mock("../app/lib/env.server", () => ({
  ENV: {
    ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$placeholder",
    ADMIN_SESSION_SECRET: "mock-session-secret-at-least-32-chars-long",
    PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

describe("auth.server.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("getAdminConfig throws 503 response if hash or secret is missing", async () => {
    const { ENV } = await import("../app/lib/env.server");
    const originalHash = ENV.ADMIN_PASSWORD_HASH;

    // @ts-expect-error Mocking readonly property
    ENV.ADMIN_PASSWORD_HASH = undefined;

    try {
      getAdminConfig();
      expect.fail("Expected getAdminConfig to throw");
    } catch (err: unknown) {
      expect(err instanceof Response).toBe(true);
      const res = err as Response;
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    } finally {
      // @ts-expect-error Restoring property
      ENV.ADMIN_PASSWORD_HASH = originalHash;
    }
  });

  it("computeCredentialVersion returns deterministic token and changes when secret changes", async () => {
    const version1 = computeCredentialVersion();
    const version2 = computeCredentialVersion();
    expect(version1).toBe(version2);
    expect(version1.length).toBe(32);

    const { ENV } = await import("../app/lib/env.server");
    const originalSecret = ENV.ADMIN_SESSION_SECRET;

    // @ts-expect-error Mocking property
    ENV.ADMIN_SESSION_SECRET = "another-different-secret-32-chars-long!!";
    const version3 = computeCredentialVersion();
    expect(version3).not.toBe(version1);

    // @ts-expect-error Restoring property
    ENV.ADMIN_SESSION_SECRET = originalSecret;
  });

  it("constantTimeEqual accurately compares strings of equal and unequal length", () => {
    expect(constantTimeEqual("token123", "token123")).toBe(true);
    expect(constantTimeEqual("token123", "token124")).toBe(false);
    expect(constantTimeEqual("token123", "short")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("verifyAdminPassword returns false on empty password or excessively long password (>256)", async () => {
    expect(await verifyAdminPassword("")).toBe(false);
    expect(await verifyAdminPassword("a".repeat(257))).toBe(false);
  });

  it("verifyAdminPassword validates against Argon2id hash", async () => {
    const rawPassword = "CorrectParallaxPassword2026!";
    const realHash = await argon2.hash(rawPassword, {
      algorithm: argon2.Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const { ENV } = await import("../app/lib/env.server");
    const originalHash = ENV.ADMIN_PASSWORD_HASH;

    // @ts-expect-error Mocking property
    ENV.ADMIN_PASSWORD_HASH = realHash;

    expect(await verifyAdminPassword(rawPassword)).toBe(true);
    expect(await verifyAdminPassword("WrongPassword123")).toBe(false);

    // @ts-expect-error Restoring property
    ENV.ADMIN_PASSWORD_HASH = originalHash;
  });

  it("requireAdminSession rejects unauthenticated, expired or credential-rotated session", async () => {
    // 1. Unauthenticated request
    const emptyReq = new Request("http://localhost:3000/admin");
    const res1 = await requireAdminSession(emptyReq);
    expect(res1.isValid).toBe(false);

    // 2. Active valid session
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("createdAt", Date.now());
    session.set("expiresAt", Date.now() + 3600 * 1000); // 1 hour future

    const cookie = await commitSession(session);
    const validReq = new Request("http://localhost:3000/admin", {
      headers: { Cookie: cookie },
    });
    const res2 = await requireAdminSession(validReq);
    expect(res2.isValid).toBe(true);

    // 3. Expired session
    session.set("expiresAt", Date.now() - 1000); // Expired
    const expiredCookie = await commitSession(session);
    const expiredReq = new Request("http://localhost:3000/admin", {
      headers: { Cookie: expiredCookie },
    });
    const res3 = await requireAdminSession(expiredReq);
    expect(res3.isValid).toBe(false);

    // 4. Rotated credential version
    session.set("expiresAt", Date.now() + 3600 * 1000);
    session.set("credentialVersion", "old-revoked-credential-version-!!");
    const rotatedCookie = await commitSession(session);
    const rotatedReq = new Request("http://localhost:3000/admin", {
      headers: { Cookie: rotatedCookie },
    });
    const res4 = await requireAdminSession(rotatedReq);
    expect(res4.isValid).toBe(false);
  });
});
