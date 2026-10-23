// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import * as argon2 from "@node-rs/argon2";
import { loader as loginLoader, action as loginAction } from "../app/routes/admin/login";
import { getCanonicalLoopbackRedirect } from "../app/lib/security.server";
import { requireValidAdminSession } from "../app/lib/admin-auth.server";
import { commitSession, getSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

let mockSiteUrl = "http://127.0.0.1:3000";
let mockLocalPreview = "true";
const TEST_PASSWORD = "CorrectAdminPassword123!";
let testHash = "";
let tempDir = "";
let testDbFile = "";

vi.mock("../app/lib/env.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/env.server")>();
  return {
    ...actual,
    isLocalPreviewMode: () => mockLocalPreview === "true",
    ENV: {
      get ADMIN_PASSWORD_HASH(): string {
        return testHash;
      },
      get ADMIN_SESSION_SECRET(): string {
        return "mock-session-secret-at-least-32-chars-long-for-tests!";
      },
      get RATE_LIMIT_SECRET(): string {
        return "mock-rate-limit-secret-32-chars-long-for-tests!";
      },
      get RATE_LIMIT_DB_PATH(): string {
        return testDbFile;
      },
      get PUBLIC_SITE_URL(): string {
        return mockSiteUrl;
      },
      get TRUST_PROXY(): boolean {
        return false;
      },
      get PARALLAX_LOCAL_PREVIEW(): string {
        return mockLocalPreview;
      },
    },
    validateAdminConfig: () => ({
      hash: testHash,
      sessionSecret: "mock-session-secret-at-least-32-chars-long-for-tests!",
      rateLimitSecret: "mock-rate-limit-secret-32-chars-long-for-tests!",
      rateLimitDbPath: testDbFile,
      siteUrl: mockSiteUrl,
      trustProxy: false,
    }),
  };
});

describe("Admin Login Origin & Canonical Loopback Redirection", () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-admin-test-"));
    testDbFile = path.join(tempDir, "rate-limit.db");
    mockSiteUrl = "http://127.0.0.1:3000";
    mockLocalPreview = "true";
    testHash = await argon2.hash(TEST_PASSWORD, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  describe("getCanonicalLoopbackRedirect", () => {
    it("redirects GET from localhost:3000 to canonical 127.0.0.1:3000 with query params", () => {
      const req = new Request("http://localhost:3000/admin?ref=direct", {
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      const redirectUrl = getCanonicalLoopbackRedirect(req);
      expect(redirectUrl).toBe("http://127.0.0.1:3000/admin?ref=direct");
    });

    it("respects custom port from canonical config", () => {
      mockSiteUrl = "http://127.0.0.1:4567";
      const req = new Request("http://localhost:4567/admin/content", {
        headers: { Accept: "text/html" },
      });
      const redirectUrl = getCanonicalLoopbackRedirect(req);
      expect(redirectUrl).toBe("http://127.0.0.1:4567/admin/content");
    });

    it("redirects reverse alias when canonical is localhost and user visits 127.0.0.1", () => {
      mockSiteUrl = "http://localhost:3000";
      const req = new Request("http://127.0.0.1:3000/admin", {
        headers: { Accept: "text/html" },
      });
      const redirectUrl = getCanonicalLoopbackRedirect(req);
      expect(redirectUrl).toBe("http://localhost:3000/admin");
    });

    it("returns null when already on canonical origin", () => {
      const req = new Request("http://127.0.0.1:3000/admin", {
        headers: { Accept: "text/html" },
      });
      expect(getCanonicalLoopbackRedirect(req)).toBeNull();
    });

    it("returns null for non-GET requests (e.g. POST)", () => {
      const req = new Request("http://localhost:3000/admin", {
        method: "POST",
        headers: { Accept: "text/html" },
      });
      expect(getCanonicalLoopbackRedirect(req)).toBeNull();
    });

    it("returns null for non-HTML requests (e.g. JSON or images)", () => {
      const req = new Request("http://localhost:3000/admin", {
        headers: { Accept: "application/json" },
      });
      expect(getCanonicalLoopbackRedirect(req)).toBeNull();
    });

    it("returns null when not in local preview mode (production)", () => {
      mockLocalPreview = "false";
      const req = new Request("http://localhost:3000/admin", {
        headers: { Accept: "text/html" },
      });
      expect(getCanonicalLoopbackRedirect(req)).toBeNull();
    });

    it("returns null for arbitrary external hosts", () => {
      const req = new Request("http://evil.com/admin", {
        headers: { Accept: "text/html" },
      });
      expect(getCanonicalLoopbackRedirect(req)).toBeNull();
    });
  });

  describe("loginLoader", () => {
    it("redirects loopback alias with 302 and DOES NOT issue a session cookie on the alias", async () => {
      const req = new Request("http://localhost:3000/admin", {
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      const response = await loginLoader({ request: req, params: {}, context: {} } as unknown as LoaderFunctionArgs);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("http://127.0.0.1:3000/admin");
      expect(response.headers.get("Set-Cookie")).toBeNull();
    });

    it("issues a session cookie and CSRF token when visiting the canonical origin", async () => {
      const req = new Request("http://127.0.0.1:3000/admin", {
        headers: { Accept: "text/html" },
      });
      const response = await loginLoader({ request: req, params: {}, context: {} } as unknown as LoaderFunctionArgs);
      expect(response.status).toBe(200);
      const setCookie = response.headers.get("Set-Cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("__parallax_admin_session");
      const json = await response.json();
      expect(json.csrfToken).toBeTruthy();
    });

    it("redirects already authenticated session to dashboard with 303", async () => {
      const session = await getSession(null);
      session.set("adminId", "admin");
      session.set("expiresAt", Date.now() + 60_000);
      session.set("credentialVersion", computeCredentialVersion());
      const cookie = await commitSession(session);

      const req = new Request("http://127.0.0.1:3000/admin", {
        headers: {
          Accept: "text/html",
          Cookie: cookie,
        },
      });
      const response = await loginLoader({ request: req, params: {}, context: {} } as unknown as LoaderFunctionArgs);
      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe("/admin/dashboard");
    });
  });

  describe("loginAction", () => {
    it("rejects POST with wrong origin (localhost vs 127.0.0.1) and provides canonicalLoginUrl in local preview", async () => {
      const formData = new URLSearchParams();
      formData.append("password", TEST_PASSWORD);
      formData.append("csrfToken", "valid-or-invalid");

      const req = new Request("http://127.0.0.1:3000/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
        },
        body: formData.toString(),
      });

      const response = await loginAction({ request: req, params: {}, context: {} } as unknown as ActionFunctionArgs);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("Origine de la requête non autorisée.");
      expect(data.canonicalLoginUrl).toBe("http://127.0.0.1:3000/admin");
    });

    it("rejects POST from external origin and does not leak canonicalLoginUrl in production", async () => {
      mockLocalPreview = "false";
      const formData = new URLSearchParams();
      formData.append("password", TEST_PASSWORD);

      const req = new Request("http://127.0.0.1:3000/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://attacker.com",
        },
        body: formData.toString(),
      });

      const response = await loginAction({ request: req, params: {}, context: {} } as unknown as ActionFunctionArgs);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Origine de la requête non autorisée.");
      expect(data.canonicalLoginUrl).toBeUndefined();
    });

    it("authenticates successfully on canonical origin with valid CSRF and credentials", async () => {
      // 1. Get anonymous session & CSRF token from canonical loader
      const loaderReq = new Request("http://127.0.0.1:3000/admin");
      const loaderRes = await loginLoader({ request: loaderReq, params: {}, context: {} } as unknown as LoaderFunctionArgs);
      const cookieHeader = loaderRes.headers.get("Set-Cookie")!;
      const { csrfToken } = await loaderRes.json();

      // 2. Submit POST on canonical origin
      const formData = new URLSearchParams();
      formData.append("password", TEST_PASSWORD);
      formData.append("csrfToken", csrfToken);

      const postReq = new Request("http://127.0.0.1:3000/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://127.0.0.1:3000",
          Cookie: cookieHeader,
        },
        body: formData.toString(),
      });

      const response = await loginAction({ request: postReq, params: {}, context: {} } as unknown as ActionFunctionArgs);
      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe("/admin/dashboard");
      const authCookie = response.headers.get("Set-Cookie");
      expect(authCookie).toContain("__parallax_admin_session");
    });

    it("returns 401 on wrong password without leaking secrets", async () => {
      const loaderReq = new Request("http://127.0.0.1:3000/admin");
      const loaderRes = await loginLoader({ request: loaderReq, params: {}, context: {} } as unknown as LoaderFunctionArgs);
      const cookieHeader = loaderRes.headers.get("Set-Cookie")!;
      const { csrfToken } = await loaderRes.json();

      const formData = new URLSearchParams();
      formData.append("password", "WrongPassword123!");
      formData.append("csrfToken", csrfToken);

      const postReq = new Request("http://127.0.0.1:3000/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://127.0.0.1:3000",
          Cookie: cookieHeader,
        },
        body: formData.toString(),
      });

      const response = await loginAction({ request: postReq, params: {}, context: {} } as unknown as ActionFunctionArgs);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Identifiants invalides.");
      expect(JSON.stringify(data)).not.toContain("argon2");
      expect(JSON.stringify(data)).not.toContain(TEST_PASSWORD);
    });
  });

  describe("requireValidAdminSession", () => {
    it("redirects loopback alias access to canonical origin before session checks", async () => {
      const req = new Request("http://localhost:3000/admin/dashboard", {
        headers: { Accept: "text/html" },
      });
      try {
        await requireValidAdminSession(req);
        expect.unreachable("should have thrown redirect");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Response);
        const res = err as Response;
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe("http://127.0.0.1:3000/admin/dashboard");
      }
    });
  });
});
