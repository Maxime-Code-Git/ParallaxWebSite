// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getSession,
  commitSession,
  destroySession,
  SESSION_MAX_AGE_SECONDS,
} from "../app/lib/session.server";

vi.mock("../app/lib/env.server", () => ({
  ENV: {
    ADMIN_SESSION_SECRET: "mock-session-secret-at-least-32-chars-long",
    ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$mock",
    PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

describe("session.server.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should configure session cookie with secure attributes", async () => {
    const session = await getSession();
    session.set("csrfToken", "test-token-123");

    const setCookie = await commitSession(session);
    expect(setCookie).toContain("__parallax_admin_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  });

  it("should store and retrieve session data accurately across cookie commits", async () => {
    const session = await getSession();
    session.set("adminId", "unique-admin-id");
    session.set("credentialVersion", "version-token");
    session.set("csrfToken", "csrf-xyz");
    const now = Date.now();
    session.set("createdAt", now);
    session.set("expiresAt", now + 28800 * 1000);

    const setCookie = await commitSession(session);

    // Extract cookie value
    const match = setCookie.match(/__parallax_admin_session=([^;]+)/);
    expect(match).not.toBeNull();
    const cookieHeader = `__parallax_admin_session=${match![1]}`;

    const retrievedSession = await getSession(cookieHeader);
    expect(retrievedSession.get("adminId")).toBe("unique-admin-id");
    expect(retrievedSession.get("credentialVersion")).toBe("version-token");
    expect(retrievedSession.get("csrfToken")).toBe("csrf-xyz");
    expect(retrievedSession.get("createdAt")).toBe(now);
  });

  it("should output expired date when destroying a session", async () => {
    const session = await getSession();
    session.set("adminId", "admin-to-delete");

    const destroyed = await destroySession(session);
    expect(destroyed).toContain("__parallax_admin_session=");
    expect(destroyed).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
});
