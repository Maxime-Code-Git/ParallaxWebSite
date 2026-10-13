// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as argon2 from "@node-rs/argon2";
import { RouterContextProvider } from "react-router";
import {
  loader as loginLoader,
  action as loginAction,
  headers as loginHeaders,
} from "../app/routes/admin/login";
import {
  loader as dashboardLoader,
  headers as dashboardHeaders,
} from "../app/routes/admin/dashboard";
import {
  loader as logoutLoader,
  action as logoutAction,
  headers as logoutHeaders,
} from "../app/routes/admin/logout";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { checkRateLimit, resetRateLimit, RateLimitStorageError } from "../app/lib/rate-limit.server";

let mockHash: string | undefined = "$argon2id$v=19$m=19456,t=2,p=1$placeholder";
let mockSessionSecret = "test-session-secret-must-be-32-chars-long";
let mockRateLimitSecret = "test-rate-limit-secret-32-chars-long";
let mockPublicSiteUrl = "https://parallax.example.com";
let mockRateLimitDbPath = "/tmp/rate-limit.sqlite";

vi.mock("../app/lib/env.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/env.server")>();
  return {
    ...actual,
    ENV: {
      get ADMIN_PASSWORD_HASH(): string | undefined {
        return mockHash;
      },
      get ADMIN_SESSION_SECRET(): string | undefined {
        return mockSessionSecret;
      },
      get RATE_LIMIT_SECRET(): string {
        return mockRateLimitSecret;
      },
      get PUBLIC_SITE_URL(): string {
        return mockPublicSiteUrl;
      },
      get RATE_LIMIT_DB_PATH(): string {
        return mockRateLimitDbPath;
      },
      get TRUST_PROXY(): boolean {
        return true;
      },
    },
    validateAdminConfig: () => {
      if (!mockHash || !mockSessionSecret || mockSessionSecret.length < 32 || !mockHash.startsWith("$argon2id$")) {
        throw new Error("Invalid admin config mock");
      }
      return {
        hash: mockHash,
        sessionSecret: mockSessionSecret,
        rateLimitSecret: mockRateLimitSecret,
        rateLimitDbPath: mockRateLimitDbPath,
        siteUrl: mockPublicSiteUrl,
        trustProxy: true,
      };
    },
  };
});

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
    mockHash = testPasswordHash;
    mockSessionSecret = "test-session-secret-must-be-32-chars-long";
    mockRateLimitSecret = "test-rate-limit-secret-32-chars-long";
    mockPublicSiteUrl = "https://parallax.example.com";
    mockRateLimitDbPath = "/tmp/rate-limit.sqlite";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Route Headers exports", () => {
    it("exports headers functions that enforce Cache-Control: no-store and X-Robots-Tag: noindex, nofollow", () => {
      const args = {
        loaderHeaders: new Headers(),
        actionHeaders: new Headers(),
        errorHeaders: undefined,
        parentHeaders: new Headers(),
      };
      for (const headersFn of [loginHeaders, dashboardHeaders, logoutHeaders]) {
        const h = headersFn(args);
        expect(h.get("Cache-Control")).toContain("no-store");
        expect(h.get("X-Robots-Tag")).toBe("noindex, nofollow");
      }
    });
  });

  describe("GET /admin (loginLoader)", () => {
    it("throws 503 response when ADMIN_PASSWORD_HASH is missing", async () => {
      mockHash = undefined;

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

    it("emits a clean anonymous session cookie with new CSRF token when receiving an expired session", async () => {
      const session = await getSession();
      session.set("adminId", "old-admin");
      session.set("credentialVersion", "old-version");
      session.set("csrfToken", "old-csrf-token");
      session.set("createdAt", Date.now() - 36000 * 1000);
      session.set("expiresAt", Date.now() - 1000); // Expired
      const expiredCookie = await commitSession(session);

      const req = new Request("https://parallax.example.com/admin", {
        headers: { Cookie: expiredCookie },
      });

      const res = (await loginLoader(createRouteArgs(req))) as Response;
      expect(res.status).toBe(200);

      // Check Set-Cookie: contains new anonymous session cookie
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("__parallax_admin_session=");

      const data = (await res.json()) as { csrfToken: string };
      expect(data.csrfToken).toBeDefined();
      expect(data.csrfToken).not.toBe("old-csrf-token");

      // Verify that the new cookie matches the new csrfToken
      const newSession = await getSession(setCookie);
      expect(newSession.get("csrfToken")).toBe(data.csrfToken);
      expect(newSession.has("adminId")).toBe(false);
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
      extraField?: string;
    }) {
      const form = new URLSearchParams();
      if (opts.csrfToken !== undefined) form.set("csrfToken", opts.csrfToken);
      if (opts.password !== undefined) form.set("password", opts.password);
      if (opts.extraField !== undefined) form.set("extraField", opts.extraField);

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

    it("rejects unexpected form fields with 400", async () => {
      const session = await getSession();
      session.set("csrfToken", "valid-csrf");
      const cookie = await commitSession(session);

      const req = await createLoginRequest({
        cookie,
        csrfToken: "valid-csrf",
        password: TEST_PASSWORD,
        extraField: "unexpected-field",
      });
      const res = (await loginAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(400);
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

    it("converts SQLite error during resetRateLimit into 503 without issuing a session", async () => {
      vi.mocked(resetRateLimit).mockImplementationOnce(() => {
        throw new RateLimitStorageError("DB locked");
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
      expect(res.status).toBe(503);
      expect(res.headers.get("Set-Cookie")).toBeNull();
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
      sessionExpired?: boolean;
      noSession?: boolean;
      extraField?: string;
    }) {
      let cookie = "";
      if (!opts.noSession) {
        const session = await getSession();
        session.set("adminId", "adm-1");
        session.set("credentialVersion", computeCredentialVersion());
        session.set("createdAt", Date.now());
        session.set("expiresAt", opts.sessionExpired ? Date.now() - 1000 : Date.now() + 3600 * 1000);
        if (opts.sessionCsrf) session.set("csrfToken", opts.sessionCsrf);
        cookie = await commitSession(session);
      }

      const form = new URLSearchParams();
      if (opts.csrfToken !== undefined) form.set("csrfToken", opts.csrfToken);
      if (opts.extraField !== undefined) form.set("extraField", opts.extraField);

      const headers = new Headers();
      headers.set("Origin", opts.origin ?? "https://parallax.example.com");
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      if (cookie) headers.set("Cookie", cookie);

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

    it("rejects logout with unexpected form fields with 400", async () => {
      const req = await createLogoutRequest({
        csrfToken: "tok",
        sessionCsrf: "tok",
        extraField: "bad",
      });
      const res = (await logoutAction(createRouteArgs(req))) as Response;
      expect(res.status).toBe(400);
    });

    it("rejects logout when session is expired or unauthenticated with 403 and clears cookie", async () => {
      const reqExpired = await createLogoutRequest({
        csrfToken: "tok",
        sessionCsrf: "tok",
        sessionExpired: true,
      });
      const res = (await logoutAction(createRouteArgs(reqExpired))) as Response;
      expect(res.status).toBe(403);
      expect(res.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");

      const reqNoSession = await createLogoutRequest({
        csrfToken: "tok",
        noSession: true,
      });
      const resNoSession = (await logoutAction(createRouteArgs(reqNoSession))) as Response;
      expect(resNoSession.status).toBe(403);
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

  describe("End-to-End User Journey in memory", () => {
    it("handles complete sequence: expired session -> GET login -> new anonymous cookie -> POST login -> dashboard -> logout", async () => {
      // 1. Client visits GET /admin with expired session
      const expiredSession = await getSession();
      expiredSession.set("adminId", "expired-user");
      expiredSession.set("expiresAt", Date.now() - 5000);
      const expiredCookie = await commitSession(expiredSession);

      const req1 = new Request("https://parallax.example.com/admin", {
        headers: { Cookie: expiredCookie },
      });
      const res1 = (await loginLoader(createRouteArgs(req1))) as Response;
      expect(res1.status).toBe(200);

      const anonCookie = res1.headers.get("Set-Cookie")!;
      const { csrfToken } = (await res1.json()) as { csrfToken: string };
      expect(csrfToken).toBeDefined();

      // 2. Client submits POST /admin with anonymous cookie and csrfToken
      const form = new URLSearchParams();
      form.set("csrfToken", csrfToken);
      form.set("password", TEST_PASSWORD);

      const req2 = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: {
          Origin: "https://parallax.example.com",
          "Content-Type": "application/x-www-form-urlencoded",
          "cf-connecting-ip": "192.168.1.1",
          Cookie: anonCookie,
        },
        body: form.toString(),
      });
      const res2 = (await loginAction(createRouteArgs(req2))) as Response;
      expect(res2.status).toBe(303);
      expect(res2.headers.get("Location")).toBe("/admin/dashboard");
      const authCookie = res2.headers.get("Set-Cookie")!;
      expect(authCookie).toContain("__parallax_admin_session=");

      // 3. Client visits GET /admin/dashboard with authCookie
      const req3 = new Request("https://parallax.example.com/admin/dashboard", {
        headers: { Cookie: authCookie },
      });
      const res3 = (await dashboardLoader(createRouteArgs(req3))) as Response;
      expect(res3.status).toBe(200);
      const { csrfToken: dashCsrf } = (await res3.json()) as { csrfToken: string };
      expect(dashCsrf).toBeDefined();

      // 4. Client submits POST /admin/logout with authCookie and dashCsrf
      const logoutForm = new URLSearchParams();
      logoutForm.set("csrfToken", dashCsrf);

      const req4 = new Request("https://parallax.example.com/admin/logout", {
        method: "POST",
        headers: {
          Origin: "https://parallax.example.com",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: authCookie,
        },
        body: logoutForm.toString(),
      });
      const res4 = (await logoutAction(createRouteArgs(req4))) as Response;
      expect(res4.status).toBe(303);
      expect(res4.headers.get("Location")).toBe("/admin");
      expect(res4.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });
  });
});
