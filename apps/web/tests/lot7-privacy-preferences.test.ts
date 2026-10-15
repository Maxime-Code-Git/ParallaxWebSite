import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createSignedPrivacyCookie,
  parsePrivacyCookie,
} from "../app/lib/privacy-preferences.server";
import {
  PRIVACY_COOKIE_NAME,
  PRIVACY_COOKIE_MAX_AGE_SECONDS,
  PRIVACY_POLICY_VERSION,
  DEFAULT_PRIVACY_PREFERENCES,
} from "../app/lib/privacy-preferences.shared";
import { action as preferencesAction, loader as preferencesLoader } from "../app/routes/api/privacy-preferences";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const makeActionArgs = (req: Request): ActionFunctionArgs =>
  ({
    request: req,
    params: {},
    context: {} as never,
  }) as unknown as ActionFunctionArgs;

const makeLoaderArgs = (req: Request): LoaderFunctionArgs =>
  ({
    request: req,
    params: {},
    context: {} as never,
  }) as unknown as LoaderFunctionArgs;

describe("Lot 7 - Privacy Preferences Cookie & API Endpoint", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("generates signed cookie with HMAC-SHA256, 180-day TTL, and verifies signature strictly", () => {
    const cookieHeader = createSignedPrivacyCookie({ youtube: true, vimeo: false });

    expect(cookieHeader).toContain(`${PRIVACY_COOKIE_NAME}=`);
    expect(cookieHeader).toContain(`Max-Age=${PRIVACY_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookieHeader).toContain("Path=/");
    expect(cookieHeader).toContain("SameSite=Lax");

    // Extract cookie value
    const match = cookieHeader.match(new RegExp(`${PRIVACY_COOKIE_NAME}=([^;]+)`));
    expect(match).not.toBeNull();
    const cookieValue = match![1];

    // Verification succeeds
    const parsed = parsePrivacyCookie(`${PRIVACY_COOKIE_NAME}=${cookieValue}`);
    expect(parsed).not.toBeNull();
    expect(parsed?.youtube).toBe(true);
    expect(parsed?.vimeo).toBe(false);
    expect(parsed?.version).toBe(PRIVACY_POLICY_VERSION);
  });

  it("rejects forged, tampered, expired, or version-mismatched cookies", () => {
    const validHeader = createSignedPrivacyCookie({ youtube: true, vimeo: true });
    const match = validHeader.match(new RegExp(`${PRIVACY_COOKIE_NAME}=([^;]+)`));
    const parts = match![1].split(".");

    // 1. Tampered payload with original signature
    const tamperedValue = `${parts[0]}.0.0.${parts[3]}.${parts[4]}`;
    const parsedTampered = parsePrivacyCookie(`${PRIVACY_COOKIE_NAME}=${tamperedValue}`);
    expect(parsedTampered).toEqual(DEFAULT_PRIVACY_PREFERENCES);

    // 2. Forged signature
    const forgedValue = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}.deadbeef1234567890`;
    const parsedForged = parsePrivacyCookie(`${PRIVACY_COOKIE_NAME}=${forgedValue}`);
    expect(parsedForged).toEqual(DEFAULT_PRIVACY_PREFERENCES);

    // 3. Expired timestamp (> 180 days in past)
    const expiredTimestamp = Math.floor(Date.now() / 1000) - (PRIVACY_COOKIE_MAX_AGE_SECONDS + 100);
    const expiredPayload = `${parts[0]}.${parts[1]}.${parts[2]}.${expiredTimestamp}.${parts[4]}`;
    const parsedExpired = parsePrivacyCookie(`${PRIVACY_COOKIE_NAME}=${expiredPayload}`);
    expect(parsedExpired).toEqual(DEFAULT_PRIVACY_PREFERENCES);

    // 4. Mismatched version
    const wrongVersion = `999.${parts[1]}.${parts[2]}.${parts[3]}.${parts[4]}`;
    const parsedWrongVersion = parsePrivacyCookie(`${PRIVACY_COOKIE_NAME}=${wrongVersion}`);
    expect(parsedWrongVersion).toEqual(DEFAULT_PRIVACY_PREFERENCES);
  });

  it("API GET /api/privacy/preferences reads preferences safely with private no-store headers", async () => {
    const cookieHeader = createSignedPrivacyCookie({ youtube: true, vimeo: false });
    const match = cookieHeader.match(new RegExp(`${PRIVACY_COOKIE_NAME}=([^;]+)`));

    const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
      method: "GET",
      headers: {
        Cookie: `${PRIVACY_COOKIE_NAME}=${match![1]}`,
      },
    });

    const res = await preferencesLoader(makeLoaderArgs(req));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.preferences.youtube).toBe(true);
    expect(json.preferences.vimeo).toBe(false);
  });

  it("API POST /api/privacy/preferences updates preferences with JSON and sets signed cookie", async () => {
    const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ youtube: true, vimeo: true }),
    });

    const res = await preferencesAction(makeActionArgs(req));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(PRIVACY_COOKIE_NAME);

    // Verify cookie contains true for both
    const parsed = parsePrivacyCookie(setCookie!);
    expect(parsed?.youtube).toBe(true);
    expect(parsed?.vimeo).toBe(true);
  });

  it("API POST /api/privacy/preferences supports action revoke_all", async () => {
    const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "revoke_all" }),
    });

    const res = await preferencesAction(makeActionArgs(req));
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("Set-Cookie");
    const parsed = parsePrivacyCookie(setCookie!);
    expect(parsed?.youtube).toBe(false);
    expect(parsed?.vimeo).toBe(false);
  });

  it("API POST /api/privacy/preferences supports non-JS form submission with 303 redirect", async () => {
    const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        youtube: "true",
        redirectTo: "/fr/cookies",
      }).toString(),
    });

    const res = await preferencesAction(makeActionArgs(req));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/fr/cookies");

    const setCookie = res.headers.get("Set-Cookie");
    const parsed = parsePrivacyCookie(setCookie!);
    expect(parsed?.youtube).toBe(true);
    expect(parsed?.vimeo).toBe(false);
  });

  it("API POST enforces security controls (Origin 403, Method 405, Size limit 413)", async () => {
    // 1. Method Not Allowed
    const putReq = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
      method: "PUT",
    });
    const putRes = await preferencesAction(makeActionArgs(putReq));
    expect(putRes.status).toBe(405);
    expect(putRes.headers.get("Allow")).toBe("POST");

    // 2. Bad Origin
    const badOriginReq = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
      method: "POST",
      headers: {
        Origin: "https://evil-site.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ youtube: true }),
    });
    const badOriginRes = await preferencesAction(makeActionArgs(badOriginReq));
    expect(badOriginRes.status).toBe(403);

    // 3. Payload Too Large (> 8 KiB)
    const hugeBody = JSON.stringify({ padding: "a".repeat(10 * 1024) });
    const hugeReq = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
      },
      body: hugeBody,
    });
    const hugeRes = await preferencesAction(makeActionArgs(hugeReq));
    expect(hugeRes.status).toBe(413);
  });
});
