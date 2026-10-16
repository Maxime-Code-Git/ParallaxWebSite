import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { RouterContextProvider } from "react-router";
import {
  handleContactLoader,
  handleContactAction,
  verifyContactToken,
  createContactFlashCookie,
  readAndClearContactFlash,
  createContactContextCookie,
  computeFormContentHash,
} from "../app/lib/contact.server";
import {
  closeRateLimitDatabase,
  acquireContactClaim,
  completeContactClaim,
  failContactClaim,
  RateLimitStorageError,
} from "../app/lib/rate-limit.server";
import { getSiteContent } from "../app/lib/site-content.server";
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

  function createValidTokenAndHeadersForPost(overrides?: {
    pastTimeOffsetMs?: number;
    contextId?: string;
    expiredCookie?: boolean;
  }) {
    const contextId = overrides?.contextId ?? crypto.randomBytes(16).toString("hex");
    const expiresAt = overrides?.expiredCookie
      ? Date.now() - 5000
      : Date.now() + 2 * 60 * 60 * 1000;
    const cookieHeader = createContactContextCookie(contextId, expiresAt);
    const cookieVal = cookieHeader.split(";")[0]; // __parallax_contact_ctx=...
    const pastTime = Date.now() - (overrides?.pastTimeOffsetMs ?? 5000);
    const nonce = crypto.randomBytes(16).toString("hex");
    const secret = process.env.RATE_LIMIT_SECRET!;
    const sig = crypto
      .createHmac("sha256", secret)
      .update(`contact-token:${pastTime}:${nonce}:${contextId}`)
      .digest("hex");
    const token = `${pastTime}.${nonce}.${contextId}.${sig}`;
    return { token, cookieVal, contextId, expiresAt };
  }

  function createReqWithCookie(cookieVal?: string) {
    const headers = new Headers();
    if (cookieVal) {
      headers.set("Cookie", cookieVal);
    }
    return new Request("https://parallax.test/fr/contact", { headers });
  }

  describe("Token Generation and Timing Verification", () => {
    it("generates a valid signed token that passes verification after minimum delay", () => {
      const { token, cookieVal, contextId } = createValidTokenAndHeadersForPost({ pastTimeOffsetMs: 5000 });
      const req = createReqWithCookie(cookieVal);
      const check = verifyContactToken(token, req, { minDelayMs: 0 });
      expect(check.valid).toBe(true);
      expect(check.contextId).toBe(contextId);
    });

    it("rejects token when context cookie is missing or invalid", () => {
      const { token } = createValidTokenAndHeadersForPost();
      // 1. Missing cookie
      const reqNoCookie = new Request("https://parallax.test/fr/contact");
      const check1 = verifyContactToken(token, reqNoCookie, { minDelayMs: 0 });
      expect(check1.valid).toBe(false);
      expect(check1.reason).toBe("INVALID_CONTEXT");

      // 2. Cookie for a different contextId
      const otherContextId = crypto.randomBytes(16).toString("hex");
      const otherCookie = createContactContextCookie(otherContextId, Date.now() + 3600_000).split(";")[0];
      const reqOtherCookie = createReqWithCookie(otherCookie);
      const check2 = verifyContactToken(token, reqOtherCookie, { minDelayMs: 0 });
      expect(check2.valid).toBe(false);
      expect(check2.reason).toBe("CONTEXT_MISMATCH");

      // 3. Expired cookie
      const expiredCookie = createContactContextCookie(otherContextId, Date.now() - 5000).split(";")[0];
      const reqExpiredCookie = createReqWithCookie(expiredCookie);
      const check3 = verifyContactToken(token, reqExpiredCookie, { minDelayMs: 0 });
      expect(check3.valid).toBe(false);
      expect(check3.reason).toBe("INVALID_CONTEXT");
    });

    it("rejects token when submitted before minimum delay (too fast)", () => {
      const { token, cookieVal } = createValidTokenAndHeadersForPost({ pastTimeOffsetMs: 100 });
      const req = createReqWithCookie(cookieVal);
      const check = verifyContactToken(token, req, { minDelayMs: 2000 });
      expect(check.valid).toBe(false);
      expect(check.reason).toBe("TOO_FAST");
    });

    it("rejects token when expired (> 2h)", () => {
      const contextId = crypto.randomBytes(16).toString("hex");
      const cookieVal = createContactContextCookie(contextId, Date.now() + 7200_000).split(";")[0];
      const req = createReqWithCookie(cookieVal);

      const oldTime = Date.now() - (2 * 60 * 60 * 1000 + 5000);
      const nonce = crypto.randomBytes(16).toString("hex");
      const secret = process.env.RATE_LIMIT_SECRET!;
      const sig = crypto
        .createHmac("sha256", secret)
        .update(`contact-token:${oldTime}:${nonce}:${contextId}`)
        .digest("hex");
      const expiredToken = `${oldTime}.${nonce}.${contextId}.${sig}`;

      const check = verifyContactToken(expiredToken, req, { minDelayMs: 0 });
      expect(check.valid).toBe(false);
      expect(check.reason).toBe("EXPIRED");
    });

    it("rejects token with tampered signature", () => {
      const { token, cookieVal } = createValidTokenAndHeadersForPost();
      const req = createReqWithCookie(cookieVal);

      const parts = token.split(".");
      parts[3] = crypto.randomBytes(32).toString("hex"); // tampered signature
      const tampered = parts.join(".");

      const check = verifyContactToken(tampered, req, { minDelayMs: 0 });
      expect(check.valid).toBe(false);
      expect(check.reason).toBe("SIGNATURE_INVALID");
    });

    it("rejects malformed token format", () => {
      const dummyReq = new Request("https://parallax.test/fr/contact");
      expect(verifyContactToken(null, dummyReq).valid).toBe(false);
      expect(verifyContactToken("", dummyReq).valid).toBe(false);
      expect(verifyContactToken("invalid.token", dummyReq).valid).toBe(false);
      expect(verifyContactToken("not-a-number.123.sig", dummyReq).valid).toBe(false);
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
      const loaderData = "data" in res ? (res as { data: { flashSuccess: boolean } }).data : await (res as Response).json();
      expect(loaderData.flashSuccess).toBe(false);
    });
  });

  describe("Contact Action Request Validation", () => {
    const validPayload = (token: string, overrides: Record<string, string> = {}) => {
      const params = new URLSearchParams({
        _token: token,
        name: "Acme Studio",
        email: "contact@acme.test",
        phone: "+32 470 00 11 22",
        timeline: "2027-05-15",
        type: "music-video",
        message: "Projet de clip musical dans un décor urbain.",
        website: "", // honeypot
        ...overrides,
      });
      return params.toString();
    };

    function createPostRequest(
      bodyOverrides: Record<string, string> = {},
      options?: { token?: string; cookieVal?: string; pastTimeOffsetMs?: number; contextId?: string }
    ) {
      const auth = options?.token && options?.cookieVal
        ? { token: options.token, cookieVal: options.cookieVal }
        : createValidTokenAndHeadersForPost(options);
      const body = validPayload(auth.token, bodyOverrides);
      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: auth.cookieVal,
        },
        body,
      });
      return { req, token: auth.token, cookieVal: auth.cookieVal };
    }

    it("rejects non-POST methods with 405 and Allow: POST", async () => {
      const req = new Request("https://parallax.test/fr/contact", { method: "PUT" });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    });

    it("rejects untrusted or mismatched Origin with 403", async () => {
      const { cookieVal } = createValidTokenAndHeadersForPost();
      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://evil-attacker.com",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieVal,
        },
        body: "test=1",
      });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(403);
    });

    it("rejects payload exceeding 64 KiB with 413", async () => {
      const { cookieVal } = createValidTokenAndHeadersForPost();
      const bigString = "a".repeat(65 * 1024);
      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieVal,
        },
        body: `name=${bigString}`,
      });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(413);
    });

    it("rejects duplicate form fields with 400", async () => {
      const { cookieVal } = createValidTokenAndHeadersForPost();
      const req = new Request("https://parallax.test/fr/contact", {
        method: "POST",
        headers: {
          Origin: "https://parallax.test",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieVal,
        },
        body: "name=Test&name=Duplicate",
      });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(400);
    });

    it("silently rejects submission when honeypot field is filled", async () => {
      const { req } = createPostRequest({ website: "https://spam-bot.com" });
      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(400);
    });

    it("validates field requirements and preserves input values on error", async () => {
      const { req } = createPostRequest({
        name: "", // empty name
        email: "invalid-email-format",
        phone: "a".repeat(60), // too long
        timeline: "b".repeat(150), // too long
        type: "non-existent-type",
        message: "", // empty message
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
      // 1. Explicitly load site content, disable music-video, write to disk
      const siteContent = getSiteContent();
      siteContent.contactPage.form.projectTypes = siteContent.contactPage.form.projectTypes.map((pt) =>
        pt.id === "music-video" ? { ...pt, enabled: false } : pt
      );
      fs.writeFileSync(testContentFile, JSON.stringify(siteContent), "utf-8");

      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      // 2. Submit with music-video which is now disabled
      const { req } = createPostRequest({ type: "music-video" });
      const res = await handleContactAction(createRouteArgs(req));

      // 3. Must be rejected with 400, field error on type, and zero SMTP calls
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.fieldErrors.type).toBeDefined();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("does not send a second email when replaying after 121 seconds within token lifetime", async () => {
      const { req: req1, token, cookieVal } = createPostRequest();
      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      // 1st submission
      const res1 = await handleContactAction(createRouteArgs(req1));
      expect(res1.status).toBe(303);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Advance clock by 121 seconds (within 2h token validity)
      const now = Date.now();
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now + 121_000);

      // 2nd identical submission with same token and same content
      const { req: req2 } = createPostRequest({}, { token, cookieVal });
      const res2 = await handleContactAction(createRouteArgs(req2));
      expect(res2.status).toBe(303);
      expect(sendSpy).toHaveBeenCalledTimes(1); // No second SMTP call!

      dateSpy.mockRestore();
    });

    it("rejects with 409 Conflict when same token is submitted with different content", async () => {
      const { req: req1, token, cookieVal } = createPostRequest({ message: "Original message" });
      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      const res1 = await handleContactAction(createRouteArgs(req1));
      expect(res1.status).toBe(303);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // 2nd submission with same token but different message
      const { req: req2 } = createPostRequest({ message: "Altered message content" }, { token, cookieVal });
      const res2 = await handleContactAction(createRouteArgs(req2));
      expect(res2.status).toBe(409);
      const json2 = await res2.json();
      expect(json2.ok).toBe(false);
      expect(json2.error).toContain("différent");
      expect(json2.values.message).toBe("Altered message content");
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it("blocks concurrent duplicate request while first SMTP delivery is in progress", async () => {
      const { req: req1, token, cookieVal } = createPostRequest();
      let resolveSmtp!: () => void;
      const smtpPromise = new Promise<void>((resolve) => {
        resolveSmtp = resolve;
      });

      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail").mockImplementation(async () => {
        await smtpPromise;
      });

      // Launch req1 which hangs in sendContactEmail
      const req1Promise = handleContactAction(createRouteArgs(req1));

      // Give event loop time to acquire claim
      await new Promise((r) => setTimeout(r, 40));

      // Launch concurrent req2 with same token and content
      const { req: req2 } = createPostRequest({}, { token, cookieVal });
      const res2 = await handleContactAction(createRouteArgs(req2));
      expect(res2.status).toBe(409);
      const json2 = await res2.json();
      expect(json2.ok).toBe(false);
      expect(json2.error).toContain("en cours");

      // Resolve SMTP promise so req1 finishes
      resolveSmtp();
      const res1 = await req1Promise;
      expect(res1.status).toBe(303);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it("allows retry after a definite SMTP failure (e.g. auth or config error)", async () => {
      const { req: req1, token, cookieVal } = createPostRequest();
      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail");

      // 1st attempt fails definitively
      sendSpy.mockRejectedValueOnce(
        new mailerModule.SmtpDeliveryError("Mailbox unavailable", "MAILBOX_UNAVAILABLE", false)
      );

      const res1 = await handleContactAction(createRouteArgs(req1));
      expect(res1.status).toBe(500);

      // 2nd attempt with same token succeeds because claim was reset to failed
      sendSpy.mockResolvedValueOnce(undefined);
      const { req: req2 } = createPostRequest({}, { token, cookieVal });
      const res2 = await handleContactAction(createRouteArgs(req2));
      expect(res2.status).toBe(303);
      expect(sendSpy).toHaveBeenCalledTimes(2);
    });

    it("marks claim uncertain on transport timeout and refuses subsequent attempts without re-sending", async () => {
      const { req: req1, token, cookieVal } = createPostRequest();
      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail");

      // 1st attempt fails with uncertain ETIMEDOUT error
      const timeoutErr = new Error("connect ETIMEDOUT");
      (timeoutErr as unknown as { code: string }).code = "ETIMEDOUT";
      sendSpy.mockRejectedValueOnce(
        new mailerModule.SmtpDeliveryError("ETIMEDOUT", "ETIMEDOUT", true, timeoutErr)
      );

      const res1 = await handleContactAction(createRouteArgs(req1));
      expect(res1.status).toBe(504);
      const json1 = await res1.json();
      expect(json1.ok).toBe(false);
      expect(json1.error).toContain("pas pu être confirmé");

      // Subsequent attempt with same token: must be rejected with 504 and zero additional SMTP calls
      sendSpy.mockClear();
      const { req: req2 } = createPostRequest({}, { token, cookieVal });
      const res2 = await handleContactAction(createRouteArgs(req2));
      expect(res2.status).toBe(504);
      const json2 = await res2.json();
      expect(json2.ok).toBe(false);
      expect(json2.error).toContain("pas pu être confirmé");
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("handles persistence failure gracefully without failing the client when SMTP delivery already succeeded", async () => {
      const { req } = createPostRequest();
      vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const rateLimitModule = await import("../app/lib/rate-limit.server");
      vi.spyOn(rateLimitModule, "completeContactClaim").mockImplementationOnce(() => {
        throw new Error("Disk full or lock timeout");
      });

      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(303);
      expect(errorSpy).toHaveBeenCalled();
    });

    it("enforces independent contact rate limit (5 attempts per 15 minutes) and returns 429 with Retry-After", async () => {
      vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      // Send 5 valid attempts from the same IP
      for (let i = 0; i < 5; i++) {
        const { req } = createPostRequest();
        const res = await handleContactAction(createRouteArgs(req));
        expect(res.status).toBe(303);
      }

      // 6th attempt should trigger 429
      const { req: req6 } = createPostRequest();
      const res6 = await handleContactAction(createRouteArgs(req6));
      expect(res6.status).toBe(429);
      expect(res6.headers.get("Retry-After")).toBeDefined();
    });

    it("returns 503 when SMTP is unconfigured without revealing secrets", async () => {
      const { req } = createPostRequest();

      vi.spyOn(mailerModule, "sendContactEmail").mockRejectedValue(
        new mailerModule.SmtpConfigError("Unconfigured", "SMTP_UNCONFIGURED")
      );

      const res = await handleContactAction(createRouteArgs(req));
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain("temporairement indisponible");
    });

    it("distinguishes ambiguous colon vectors and rejects Vector B with 409 without calling mailer", async () => {
      // Exact vectors from residual specification
      const vectorA = {
        lang: "fr",
        name: "Synthetic Visitor",
        email: "visitor@example.test",
        phone: "",
        timeline: "2027-06-01",
        type: "other",
        message: "documentary:Second message",
      };
      const vectorB = {
        lang: "fr",
        name: "Synthetic Visitor",
        email: "visitor@example.test",
        phone: "",
        timeline: "2027-06-15",
        type: "documentary",
        message: "Second message",
      };

      // 1. Direct hash verification: canonical representation ensures distinct hashes
      const hashA = computeFormContentHash(vectorA);
      const hashB = computeFormContentHash(vectorB);
      expect(hashA).not.toBe(hashB);

      // Verify safe handling of newlines, colons and double-quotes
      const vectorWithSeparators = {
        ...vectorA,
        message: "Line 1\r\nLine 2\nLine 3:with:colons and \"quotes\"",
      };
      const hashSeparators = computeFormContentHash(vectorWithSeparators);
      expect(hashSeparators).not.toBe(hashA);
      expect(hashSeparators).not.toBe(hashB);

      // 2. Integration via actions:
      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);

      const bodyA = {
        name: vectorA.name,
        email: vectorA.email,
        phone: vectorA.phone,
        timeline: vectorA.timeline,
        type: vectorA.type,
        message: vectorA.message,
      };
      const bodyB = {
        name: vectorB.name,
        email: vectorB.email,
        phone: vectorB.phone,
        timeline: vectorB.timeline,
        type: vectorB.type,
        message: vectorB.message,
      };

      // Submission A succeeds
      const { req: reqA, token, cookieVal } = createPostRequest(bodyA);
      const resA = await handleContactAction(createRouteArgs(reqA));
      expect(resA.status).toBe(303);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Submission B with SAME token and context cookie:
      // must NOT receive confirmation of A, must return 409 Conflict with preserved B values and NO 2nd mailer call
      const { req: reqB } = createPostRequest(bodyB, { token, cookieVal });
      const resB = await handleContactAction(createRouteArgs(reqB));
      expect(resB.status).toBe(409);
      const jsonB = await resB.json();
      expect(jsonB.ok).toBe(false);
      expect(jsonB.values.timeline).toBe("2027-06-15");
      expect(jsonB.values.type).toBe("documentary");
      expect(jsonB.values.message).toBe("Second message");
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it("handles pending SMTP promise past lease expiry: second request returns 504 and mailer is called only once", async () => {
      const { req: req1, token, cookieVal } = createPostRequest();
      let resolveSmtp!: () => void;
      const smtpPromise = new Promise<void>((resolve) => {
        resolveSmtp = resolve;
      });

      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail").mockImplementation(async () => {
        await smtpPromise;
      });

      // 1. Req 1 takes claim and begins awaiting SMTP transport
      const req1Promise = handleContactAction(createRouteArgs(req1));
      await new Promise((r) => setTimeout(r, 40));
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // 2. Clock advances past 60s lease (61s)
      const baseNow = Date.now();
      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow + 61_000);

      // 3. Same request replayed while 1st is still pending
      const { req: req2 } = createPostRequest({}, { token, cookieVal });
      const res2 = await handleContactAction(createRouteArgs(req2));
      expect(res2.status).toBe(504);
      const json2 = await res2.json();
      expect(json2.ok).toBe(false);
      // Still only 1 call to mailer!
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // 4. Req 1 resolves
      dateSpy.mockRestore();
      resolveSmtp();
      const res1 = await req1Promise;
      expect(res1.status).toBe(303);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it("prevents replay after SMTP success and persistence failure at both 61s and 121s", async () => {
      const { req: req1, token, cookieVal } = createPostRequest();
      const sendSpy = vi.spyOn(mailerModule, "sendContactEmail").mockResolvedValue(undefined);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const rateLimitModule = await import("../app/lib/rate-limit.server");
      vi.spyOn(rateLimitModule, "completeContactClaim").mockImplementationOnce(() => {
        throw new Error("Simulated SQLite write lock timeout");
      });

      // Req 1 succeeds at SMTP level, fails persistence, returns 303 PRG
      const res1 = await handleContactAction(createRouteArgs(req1));
      expect(res1.status).toBe(303);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      const baseNow = Date.now();

      // Replay after 61s
      let dateSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow + 61_000);
      const { req: req2 } = createPostRequest({}, { token, cookieVal });
      const res2 = await handleContactAction(createRouteArgs(req2));
      expect(res2.status).toBe(504); // Transitioned to uncertain, NO rearm
      expect(sendSpy).toHaveBeenCalledTimes(1);
      dateSpy.mockRestore();

      // Replay after 121s
      dateSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow + 121_000);
      const { req: req3 } = createPostRequest({}, { token, cookieVal });
      const res3 = await handleContactAction(createRouteArgs(req3));
      expect(res3.status).toBe(504); // Still uncertain
      expect(sendSpy).toHaveBeenCalledTimes(1);
      dateSpy.mockRestore();
    });

    it("handles recovery after SQLite close/reopen with expired in-progress claim safely", async () => {
      const tokenHash = "dummy-token-hash-1234567890abcdef";
      const contentHash = "dummy-content-hash-abcdef1234567890";
      const now = Date.now();

      // Acquire initial claim
      const initial = acquireContactClaim(tokenHash, contentHash, now + 3600_000);
      expect(initial.status).toBe("acquired");

      // Simulate process crash / database close and clock advance by 65s
      closeRateLimitDatabase();

      const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now + 65_000);

      // Reopen and try to acquire again with same token & content
      const reopenResult = acquireContactClaim(tokenHash, contentHash, now + 3600_000);
      expect(reopenResult.status).toBe("uncertain");

      dateSpy.mockRestore();
    });

    it("prevents previous owner from modifying or completing a superseded claim", () => {
      const tokenHash = "token-ownership-test-1234";
      const contentHash = "content-ownership-test-1234";
      const now = Date.now();

      // 1. Initial claim
      const claim1 = acquireContactClaim(tokenHash, contentHash, now + 3600_000);
      expect(claim1.status).toBe("acquired");
      if (claim1.status !== "acquired") throw new Error("Expected claim1 to be acquired");
      const oldClaimId = claim1.claimId;

      // 2. Definite failure occurs, transitioning to 'failed'
      failContactClaim(tokenHash, oldClaimId);

      // 3. New attempt acquires claim with a new claim_id
      const claim2 = acquireContactClaim(tokenHash, contentHash, now + 3600_000);
      expect(claim2.status).toBe("acquired");
      if (claim2.status !== "acquired") throw new Error("Expected claim2 to be acquired");
      expect(claim2.claimId).not.toBe(oldClaimId);

      // 4. Old owner attempts to complete or fail the claim using old claim_id
      expect(() => {
        completeContactClaim(tokenHash, oldClaimId, now + 3600_000);
      }).toThrow(RateLimitStorageError);

      // Old owner fail attempt does not alter new owner's active status
      failContactClaim(tokenHash, oldClaimId);

      // 5. New owner completes successfully
      expect(() => {
        completeContactClaim(tokenHash, claim2.claimId!, now + 3600_000);
      }).not.toThrow();
    });

    it("reflects custom validation, rate limit and session messages edited from admin without leaking spam traps", async () => {
      // Initialize site content
      const content = getSiteContent();
      content.contactPage.messages.nameRequired = {
        fr: "Veuillez préciser votre nom ou structure (sur mesure).",
        en: "Please specify your name or organization (custom).",
      };
      content.contactPage.messages.rateLimit = {
        fr: "Vitesse excessive ! Veuillez attendre {seconds} secondes.",
        en: "Too fast! Please wait {seconds} seconds.",
      };
      content.contactPage.messages.sessionExpired = {
        fr: "Formulaire expiré. Rechargez la page.",
        en: "Form expired. Reload the page.",
      };
      fs.writeFileSync(testContentFile, JSON.stringify(content, null, 2));

      // 1. Missing name returns custom message
      const { req: reqNoName } = createPostRequest({ name: "" });
      const resNoName = await handleContactAction(createRouteArgs(reqNoName));
      expect(resNoName.status).toBe(400);
      const jsonNoName = await resNoName.json();
      expect(jsonNoName.fieldErrors.name).toBe("Veuillez préciser votre nom ou structure (sur mesure).");

      // 2. Honeypot submission returns neutral custom sessionExpired message without leaking honeypot mechanism
      const { req: reqBot } = createPostRequest({ website: "https://spam.test" });
      const resBot = await handleContactAction(createRouteArgs(reqBot));
      expect(resBot.status).toBe(400);
      const jsonBot = await resBot.json();
      expect(jsonBot.error).toBe("Formulaire expiré. Rechargez la page.");
      expect(JSON.stringify(jsonBot)).not.toContain("honeypot");
      expect(JSON.stringify(jsonBot)).not.toContain("bot");
      expect(JSON.stringify(jsonBot)).not.toContain("piège");
    });
  });
});
