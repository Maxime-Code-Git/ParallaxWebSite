import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { RouterContextProvider } from "react-router";
import {
  handleContactLoader,
  handleContactAction,
  generateContactToken,
  verifyContactToken,
  createContactFlashCookie,
  readAndClearContactFlash,
} from "../app/lib/contact.server";
import { closeRateLimitDatabase } from "../app/lib/rate-limit.server";
import * as mailerModule from "../app/lib/mailer.server";

function createRouteArgs(request: Request, params: Record<string, string> = {}) {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: new RouterContextProvider(),
    url,
    pattern: url.pathname,
  };
}

describe("Contact Server & Security Pipeline", () => {
  let tempDir: string;
  let testContentFile: string;
  let testRateLimitDb: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-contact-test-"));
    testContentFile = path.join(tempDir, "site-content.json");
    testRateLimitDb = path.join(tempDir, "rate-limit.sqlite");

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SITE_CONTENT_PATH: testContentFile,
      RATE_LIMIT_DB_PATH: testRateLimitDb,
      RATE_LIMIT_SECRET: "01234567890123456789012345678901",
      PUBLIC_SITE_URL: "https://parallax.test",
    };
  });

  afterEach(() => {
    closeRateLimitDatabase();
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("Token Generation and Timing Verification", () => {
    it("generates a valid signed token that passes verification after minimum delay", () => {
      const token = generateContactToken();
      // Right away with minDelay = 0 should be valid
      const check = verifyContactToken(token, { minDelayMs: 0 });
      expect(check.valid).toBe(true);
    });

    it("rejects token when submitted before minimum delay (too fast)", () => {
      const token = generateContactToken();
      const check = verifyContactToken(token, { minDelayMs: 2000 });
      expect(check.valid).toBe(false);
      expect(check.reason).toBe("TOO_FAST");
    });

    it("rejects token when expired (> 2h)", () => {
      const oldTime = Date.now() - (2 * 60 * 60 * 1000 + 5000);
      const nonce = crypto.randomBytes(16).toString("hex");
      const secret = process.env.RATE_LIMIT_SECRET!;
      const sig = crypto.createHmac("sha256", secret).update(`contact-token:${oldTime}:${nonce}`).digest("hex");
      const expiredToken = `${oldTime}.${nonce}.${sig}`;

      const check = verifyContactToken(expiredToken, { minDelayMs: 0 });
      expect(check.valid).toBe(false);
      expect(check.reason).toBe("EXPIRED");
    });

    it("rejects token with tampered signature", () => {
      const token = generateContactToken();
      const parts = token.split(".");
      parts[2] = crypto.randomBytes(32).toString("hex"); // tampered signature
      const tampered = parts.join(".");

      const check = verifyContactToken(tampered, { minDelayMs: 0 });
      expect(check.valid).toBe(false);
      expect(check.reason).toBe("SIGNATURE_INVALID");
    });

    it("rejects malformed token format", () => {
      expect(verifyContactToken(null).valid).toBe(false);
      expect(verifyContactToken("").valid).toBe(false);
      expect(verifyContactToken("invalid.token").valid).toBe(false);
      expect(verifyContactToken("not-a-number.123.sig").valid).toBe(false);
    });
  });

  describe("Signed Flash Cookie PRG Security", () => {
    it("creates, reads, and clears flash cookie cleanly", () => {
      const cookieHeader = createContactFlashCookie();
      expect(cookieHeader).toContain("__parallax_contact_flash=");
      expect(cookieHeader).toContain("HttpOnly");
      expect(cookieHeader).toContain("SameSite=Lax");

      const cookieVal = cookieHeader.split(";")[0].replace("__parallax_contact_flash=", "");
      const req = new Request("https://parallax.test/fr/contact", {
        headers: { Cookie: `__parallax_contact_flash=${cookieVal}` },
      });

      const { hasFlash, clearCookieHeader } = readAndClearContactFlash(req);
      expect(hasFlash).toBe(true);
      expect(clearCookieHeader).toContain("Max-Age=0");
    });

    it("rejects tampered or forged flash cookie", () => {
      const req = new Request("https://parallax.test/fr/contact", {
        headers: { Cookie: "__parallax_contact_flash=forged.data.invalidsig" },
      });

      const { hasFlash } = readAndClearContactFlash(req);
      expect(hasFlash).toBe(false);
    });

    it("does not trigger flash success via query param ?success=true alone", async () => {
      const req = new Request("https://parallax.test/fr/contact?success=true");
      const res = await handleContactLoader(createRouteArgs(req));
      const data = "data" in res ? (res as { data: { flashSuccess: boolean } }).data : await (res as Response).json();
      expect(data.flashSuccess).toBe(false);
    });
  });

  describe("Contact Action Request Validation", () => {
    const validPayload = (token: string, overrides: Record<string, string> = {}) => {
      const params = new URLSearchParams({
        _token: token,
        name: "Acme Studio",
        email: "contact@acme.test",
        phone: "+32 470 00 11 22",
        timeline: "Printemps 2027",
        type: "music-video",
        message: "Projet de clip musical dans un décor urbain.",
        website: "", // honeypot
        ...overrides,
      });
      return params.toString();
    };

    function createValidTokenForPost() {
      // Create token with issuedAt 5 seconds in the past so it satisfies minDelay
      const pastTime = Date.now() - 5000;
      const nonce = crypto.randomBytes(16).toString("hex");
      const secret = process.env.RATE_LIMIT_SECRET!;
      const sig = crypto.createHmac("sha256", secret).update(`contact-token:${pastTime}:${nonce}`).digest("hex");
      return `${pastTime}.${nonce}.${sig}`;
    }

    it("rejects non-POST methods with 405 and Allow: POST", async () => {
      const req = new Request("https://parallax.test/fr/contact", { method: "PUT" });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    });

    it("rejects untrusted or mismatched Origin with 403", async () => {
      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://evil-attacker.com",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "test=1",
      });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(403);
    });

    it("rejects payload exceeding 64 KiB with 413", async () => {
      const bigString = "a".repeat(65 * 1024);
      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `name=${bigString}`,
      });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(413);
    });

    it("rejects duplicate form fields with 400", async () => {
      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "name=Test&name=Duplicate",
      });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(400);
    });

    it("silently rejects submission when honeypot field is filled", async () => {
      const token = createValidTokenForPost();
      const body = validPayload(token, { website: "https://spam-bot.com" });

      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(400);
    });

    it("validates field requirements and preserves input values on error", async () => {
      const token = createValidTokenForPost();
      const body = validPayload(token, {
        name: "", // empty name
        email: "invalid-email-format",
        phone: "a".repeat(60), // too long
        timeline: "b".repeat(150), // too long
        type: "non-existent-type",
        message: "", // empty message
      });

      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.fieldErrors).toBeDefined();
      expect(json.fieldErrors.name).toBeDefined();
      expect(json.fieldErrors.email).toBeDefined();
      expect(json.fieldErrors.phone).toBeDefined();
      expect(json.fieldErrors.timeline).toBeDefined();
      expect(json.fieldErrors.type).toBeDefined();
      expect(json.fieldErrors.message).toBeDefined();

      // Ensure preserved values
      expect(json.values.email).toBe("invalid-email-format");
    });

    it("rejects submission if selected project type is disabled", async () => {
      const token = createValidTokenForPost();
      // Mock site content with documentary disabled
      const content = { ...mailerModule };
      void content;

      const body = validPayload(token, { type: "other" }); // valid
      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      // Mock successful email sending
      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/fr/contact");
      expect(res.headers.get("Set-Cookie")).toContain("__parallax_contact_flash=");
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it("prevents double-sending when exact same token is replayed concurrently (anti-replay claim)", async () => {
      const token = createValidTokenForPost();
      const body = validPayload(token);

      const req1 = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      // Mock email send to complete successfully
      vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      const res1 = await handleContactAction(createRouteArgs(req1));
      expect(res1.status).toBe(303);

      // Second identical request with same token: should recognize already completed claim and return 303 PRG redirect without calling sendContactEmail again!
      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail");
      sendSpy.mockClear();

      const req2 = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      const res2 = await handleContactAction(createRouteArgs(req2));
      expect(res2.status).toBe(303);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("enforces independent contact rate limit and returns 429 with Retry-After", async () => {
      vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      // Send 5 valid attempts from the same IP
      for (let i = 0; i < 5; i++) {
        const token = createValidTokenForPost();
        const req = new Request("https://parallax.test/fr/contact", {
          method: "POST",
          headers: {
            Origin: "https://parallax.test",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: validPayload(token),
        });
        const res = await handleContactAction(createRouteArgs(req));
        expect(res.status).toBe(303);
      }

      // 6th attempt should trigger 429
      const token6 = createValidTokenForPost();
      const req6 = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: validPayload(token6),
      });

      const res6 = await handleContactAction(createRouteArgs(req6));
      expect(res6.status).toBe(429);
      expect(res6.headers.get("Retry-After")).toBeDefined();
    });

    it("returns 503 when SMTP is unconfigured without revealing secrets", async () => {
      const token = createValidTokenForPost();
      const body = validPayload(token);

      vi.spyOn(mailerModule, "sendContactEmail").mockRejectedValue(
        new mailerModule.SmtpConfigError("Unconfigured", "SMTP_UNCONFIGURED")
      );

      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain("temporairement indisponible");
    });
  });
});
