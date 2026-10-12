// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as argon2 from "@node-rs/argon2";
import { RouterContextProvider } from "react-router";
import { loader as loginLoader, action as loginAction } from "../app/routes/admin/login";
import { loader as dashboardLoader } from "../app/routes/admin/dashboard";
import { loader as logoutLoader, action as logoutAction } from "../app/routes/admin/logout";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { checkRateLimit, resetRateLimit } from "../app/lib/rate-limit.server";
import { ENV } from "../app/lib/env.server";

vi.mock("../app/lib/env.server", () => ({
  ENV: {
    ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$placeholder",
    ADMIN_SESSION_SECRET: "test-session-secret-must-be-32-chars-long",
    RATE_LIMIT_SECRET: "test-rate-limit-secret-32-chars-long",
    PUBLIC_SITE_URL: "https://parallax.example.com",
    TRUST_PROXY: true,
  },
}));

vi.mock("../app/lib/rate-limit.server", () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
  RateLimitExceededError: class RateLimitExceededError extends Error {
    retryAfter: number;
    constructor(retryAfter: number) {
      super("Rate limit exceeded");
      this.retryAfter = retryAfter;
    }
  },
  RateLimitStorageError: class RateLimitStorageError extends Error {},
}));

function createRouteArgs(request: Request) {
  const url = new URL(request.url);
  return {
    request,
    params: {},
    context: new RouterContextProvider(),
    url,
    pattern: url.pathname,
  };
}

describe("Admin Routes Suite (/admin, /admin/dashboard, /admin/logout)", () => {
  const TEST_PASSWORD = "ValidAdminSecretPassword123!";
  let testPasswordHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testPasswordHash = await argon2.hash(TEST_PASSWORD, {
      algorithm: argon2.Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    // @ts-expect-error Mocking property
    ENV.ADMIN_PASSWORD_HASH = testPasswordHash;
    // @ts-expect-error Mocking property
    ENV.ADMIN_SESSION_SECRET = "test-session-secret-must-be-32-chars-long";
    // @ts-expect-error Mocking property
    ENV.PUBLIC_SITE_URL = "https://parallax.example.com";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /admin (loginLoader)", () => {
    it("throws 503 response when ADMIN_PASSWORD_HASH is missing", async () => {
      // @ts-expect-error Mocking property
      ENV.ADMIN_PASSWORD_HASH = undefined;

      const req = new Request("https://parallax.example.com/admin");
      await expect(loginLoader(createRouteArgs(req))).rejects.toMatchObject({
        status: 503,
      });
    });

    it("redirects 303 to /admin/dashboard if user already has an active valid session", async () => {
      const session = await getSession();
      session.set("adminId", "admin-uid-123");
      session.set("credentialVersion", computeCredentialVersion());
      session.set("createdAt", Date.now());
      session.set("expiresAt", Date.now() + 3600 * 1000);
      const cookie = await commitSession(session);

      const req = new Request("https://parallax.example.com/admin", {
        headers: { Cookie: cookie },
      });

      const res = (await loginLoader(createRouteArgs(req))) as Response;
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/admin/dashboard");
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    });

    it("returns anonymous session with CSRF token for unauthenticated visitor", async () => {
      const req = new Request("https://parallax.example.com/admin");
      const res = (await loginLoader(createRouteArgs(req))) as Response;

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(res.headers.get("Set-Cookie")).toContain("__parallax_admin_session=");

      const data = (await res.json()) as { csrfToken: string };
      expect(data.csrfToken).toBeDefined();
      expect(data.csrfToken.length).toBeGreaterThan(10);
    });
  });

  describe("POST /admin (loginAction)", () => {
    async function createLoginRequest(opts: {
      origin?: string;
      contentType?: string;
      body?: string;
      cookie?: string;
      ip?: string;
      csrfToken?: string;
      password?: string;
    }) {
      const form = new URLSearchParams();
      if (opts.csrfToken !== undefined) form.set("csrfToken", opts.csrfToken);
      if (opts.password !== undefined) form.set("password", opts.password);

      const rawBody = opts.body !== undefined ? opts.body : form.toString();
      const headers = new Headers();
      headers.set("Origin", opts.origin ?? "https://parallax.example.com");
      headers.set("Content-Type", opts.contentType ?? "application/x-www-form-urlencoded");
      headers.set("cf-connecting-ip", opts.ip ?? "192.168.1.1");
      if (opts.cookie) headers.set("Cookie", opts.cookie);

      return new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers,
        body: rawBody,
      });
    }

    it("rejects invalid Origin with 403", async () => {
      const req = await createLoginRequest({ origin: "https://evil.attacker.com" });
      const res = (await loginAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
    });

    it("rejects unsupported media type with 415", async () => {
      const req = await createLoginRequest({ contentType: "application/json" });
      const res = (await loginAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(415);
    });

    it("rejects payload exceeding 8 KiB with 413", async () => {
      const hugeBody = "password=" + "A".repeat(9000);
      const req = await createLoginRequest({ body: hugeBody });
      const res = (await loginAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(413);
    });

    it("rejects missing or mismatched CSRF token with 403", async () => {
      const session = await getSession();
      session.set("csrfToken", "valid-session-csrf");
      const cookie = await commitSession(session);

      const req = await createLoginRequest({
        cookie,
        csrfToken: "tampered-token",
        password: TEST_PASSWORD,
      });
      const res = (await loginAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(403);
    });

    it("enforces rate limit and returns 429 when rate limit exceeded", async () => {
      const { RateLimitExceededError } = await import("../app/lib/rate-limit.server");
      vi.mocked(checkRateLimit).mockImplementationOnce(() => {
        throw new RateLimitExceededError(600);
      });

      const session = await getSession();
      session.set("csrfToken", "valid-csrf");
      const cookie = await commitSession(session);

      const req = await createLoginRequest({
        cookie,
        csrfToken: "valid-csrf",
        password: TEST_PASSWORD,
      });

      const res = (await loginAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("600");
    });

    it("rejects incorrect password with 401 without leaking password or internal errors", async () => {
      const session = await getSession();
      session.set("csrfToken", "valid-csrf");
      const cookie = await commitSession(session);

      const req = await createLoginRequest({
        cookie,
        csrfToken: "valid-csrf",
        password: "IncorrectPassword!",
      });

      const res = (await loginAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(401);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Identifiants invalides.");
      expect(res.headers.get("Cache-Control")).toContain("no-store");
    });

    it("successfully logs in, sets session cookie, and redirects 303 to /admin/dashboard", async () => {
      const session = await getSession();
      session.set("csrfToken", "valid-csrf");
      const cookie = await commitSession(session);

      const req = await createLoginRequest({
        cookie,
        csrfToken: "valid-csrf",
        password: TEST_PASSWORD,
      });

      const res = (await loginAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/admin/dashboard");
      expect(res.headers.get("Set-Cookie")).toContain("__parallax_admin_session=");
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(vi.mocked(resetRateLimit)).toHaveBeenCalled();
    });
  });

  describe("GET /admin/dashboard (dashboardLoader)", () => {
    it("redirects 303 to /admin and clears cookie if user is not authenticated", async () => {
      const req = new Request("https://parallax.example.com/admin/dashboard");
      try {
        await dashboardLoader(createRouteArgs(req));
        expect.fail("Expected redirect");
      } catch (err: unknown) {
        expect(err instanceof Response).toBe(true);
        const res = err as Response;
        expect(res.status).toBe(303);
        expect(res.headers.get("Location")).toBe("/admin");
        expect(res.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
      }
    });

    it("returns dashboard data with csrfToken when user has active session", async () => {
      const session = await getSession();
      session.set("adminId", "adm-1");
      session.set("credentialVersion", computeCredentialVersion());
      session.set("csrfToken", "dash-csrf");
      session.set("createdAt", Date.now());
      session.set("expiresAt", Date.now() + 3600 * 1000);
      const cookie = await commitSession(session);

      const req = new Request("https://parallax.example.com/admin/dashboard", {
        headers: { Cookie: cookie },
      });

      const res = (await dashboardLoader(createRouteArgs(req))) as Response;
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      const data = (await res.json()) as { csrfToken: string };
      expect(data.csrfToken).toBe("dash-csrf");
    });
  });

  describe("GET /admin/logout (logoutLoader)", () => {
    it("returns 405 Method Not Allowed with Allow: POST on GET request", async () => {
      const req = new Request("https://parallax.example.com/admin/logout", {
        method: "GET",
      });
      const res = (await logoutLoader(createRouteArgs(req))) as Response;
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
      expect(res.headers.get("Cache-Control")).toContain("no-store");
    });
  });

  describe("POST /admin/logout (logoutAction)", () => {
    async function createLogoutRequest(opts: {
      origin?: string;
      csrfToken?: string;
      sessionCsrf?: string;
    }) {
      const session = await getSession();
      session.set("adminId", "adm-1");
      session.set("credentialVersion", computeCredentialVersion());
      if (opts.sessionCsrf) session.set("csrfToken", opts.sessionCsrf);
      const cookie = await commitSession(session);

      const form = new URLSearchParams();
      if (opts.csrfToken !== undefined) form.set("csrfToken", opts.csrfToken);

      const headers = new Headers();
      headers.set("Origin", opts.origin ?? "https://parallax.example.com");
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      headers.set("Cookie", cookie);

      return new Request("https://parallax.example.com/admin/logout", {
        method: "POST",
        headers,
        body: form.toString(),
      });
    }

    it("rejects logout with invalid Origin with 403", async () => {
      const req = await createLogoutRequest({ origin: "https://untrusted.origin.com" });
      const res = (await logoutAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(403);
    });

    it("rejects logout with mismatched CSRF token with 403", async () => {
      const req = await createLogoutRequest({
        csrfToken: "bad-token",
        sessionCsrf: "good-token",
      });
      const res = (await logoutAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(403);
    });

    it("successfully logs out, destroys session, and redirects 303 to /admin", async () => {
      const req = await createLogoutRequest({
        csrfToken: "matching-csrf",
        sessionCsrf: "matching-csrf",
      });
      const res = (await logoutAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/admin");
      expect(res.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });
  });
});
