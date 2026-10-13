// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateOrigin,
  getClientIp,
  readStrictFormUrlEncoded,
  ActionSecurityError,
} from "../app/lib/security.server";

let mockSiteUrl = "https://parallax.example.com";
let mockTrustProxy = true;

vi.mock("../app/lib/env.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/lib/env.server")>();
  return {
    ...actual,
    ENV: {
      get PUBLIC_SITE_URL(): string {
        return mockSiteUrl;
      },
      get TRUST_PROXY(): boolean {
        return mockTrustProxy;
      },
    },
  };
});

describe("security.server.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSiteUrl = "https://parallax.example.com";
    mockTrustProxy = true;
  });

  describe("validateOrigin", () => {
    it("accepts exact origin match", () => {
      const req = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "https://parallax.example.com" },
      });
      expect(validateOrigin(req)).toBe(true);
    });

    it("rejects missing origin", () => {
      const req = new Request("https://parallax.example.com/admin");
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects 'null' origin", () => {
      const req = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "null" },
      });
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects origin with a pathname", () => {
      const req = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "https://parallax.example.com/admin" },
      });
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects origin with credentials, query or fragment", () => {
      const reqWithCreds = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "https://user:pass@parallax.example.com" },
      });
      expect(validateOrigin(reqWithCreds)).toBe(false);

      const reqWithQuery = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "https://parallax.example.com?query=1" },
      });
      expect(validateOrigin(reqWithQuery)).toBe(false);

      const reqWithHash = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "https://parallax.example.com#hash" },
      });
      expect(validateOrigin(reqWithHash)).toBe(false);
    });

    it("rejects multiple comma-separated origins", () => {
      const req = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "https://parallax.example.com, https://other.example.com" },
      });
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects different domain", () => {
      const req = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "https://evil.example.com" },
      });
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects subdomain of configured origin", () => {
      const req = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "https://sub.parallax.example.com" },
      });
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects malformed origin", () => {
      const req = new Request("https://parallax.example.com/admin", {
        headers: { Origin: "not-a-url" },
      });
      expect(validateOrigin(req)).toBe(false);
    });
  });

  describe("getClientIp", () => {
    it("prefers cf-connecting-ip over x-forwarded-for when TRUST_PROXY is true", () => {
      const req = new Request("https://parallax.example.com", {
        headers: {
          "cf-connecting-ip": "1.2.3.4",
          "x-forwarded-for": "5.6.7.8",
        },
      });
      expect(getClientIp(req)).toBe("1.2.3.4");
    });

    it("falls back to x-forwarded-for if cf-connecting-ip is missing", () => {
      const req = new Request("https://parallax.example.com", {
        headers: {
          "x-forwarded-for": "10.0.0.1",
        },
      });
      expect(getClientIp(req)).toBe("10.0.0.1");
    });

    it("rejects chained or comma-separated IPs in proxy headers", () => {
      const req = new Request("https://parallax.example.com", {
        headers: {
          "cf-connecting-ip": "1.2.3.4, 5.6.7.8",
        },
      });
      expect(getClientIp(req)).toBeNull();
    });

    it("rejects invalid IP format in proxy headers", () => {
      const req = new Request("https://parallax.example.com", {
        headers: {
          "cf-connecting-ip": "invalid-ip-string",
        },
      });
      expect(getClientIp(req)).toBeNull();
    });

    it("ignores proxy headers when TRUST_PROXY is false and returns conservative 127.0.0.1", () => {
      mockTrustProxy = false;
      const req = new Request("https://parallax.example.com", {
        headers: {
          "cf-connecting-ip": "1.2.3.4",
        },
      });
      expect(getClientIp(req)).toBe("127.0.0.1");
    });
  });

  describe("readStrictFormUrlEncoded", () => {
    it("accepts valid application/x-www-form-urlencoded body with allowed fields", async () => {
      const req = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "password=secret&csrfToken=token123",
      });
      const params = await readStrictFormUrlEncoded(req, 8192, ["password", "csrfToken"]);
      expect(params.get("password")).toBe("secret");
      expect(params.get("csrfToken")).toBe("token123");
    });

    it("rejects non-POST method with 405", async () => {
      const req = new Request("https://parallax.example.com/admin", {
        method: "GET",
      });
      await expect(readStrictFormUrlEncoded(req)).rejects.toMatchObject({
        status: 405,
      });
    });

    it("rejects incorrect Content-Type with 415", async () => {
      const req = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "secret" }),
      });
      await expect(readStrictFormUrlEncoded(req)).rejects.toMatchObject({
        status: 415,
      });
    });

    it("rejects invalid or empty Content-Length with 400", async () => {
      const reqEmpty = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": "",
        },
        body: "a=1",
      });
      await expect(readStrictFormUrlEncoded(reqEmpty)).rejects.toMatchObject({
        status: 400,
      });

      const reqLetters = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": "not-a-number",
        },
        body: "a=1",
      });
      await expect(readStrictFormUrlEncoded(reqLetters)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("rejects Content-Length exceeding max limit with 413", async () => {
      const req = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": "9000",
        },
        body: "a=1",
      });
      await expect(readStrictFormUrlEncoded(req, 8192)).rejects.toMatchObject({
        status: 413,
      });
    });

    it("rejects stream exceeding max limit even without Content-Length with 413", async () => {
      const bigPayload = "a=" + "x".repeat(9000);
      const req = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bigPayload,
      });
      req.headers.delete("Content-Length");

      await expect(readStrictFormUrlEncoded(req, 8192)).rejects.toMatchObject({
        status: 413,
      });
    });

    it("rejects duplicate sensitive form fields with 400", async () => {
      const req = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "password=pass1&password=pass2&csrfToken=tok",
      });
      await expect(readStrictFormUrlEncoded(req)).rejects.toThrowError(
        new ActionSecurityError("Duplicate field not permitted: password", 400)
      );
    });

    it("rejects unexpected fields when allowedFields is specified with 400", async () => {
      const req = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "password=secret&csrfToken=token&extraField=malicious",
      });
      await expect(
        readStrictFormUrlEncoded(req, 8192, ["password", "csrfToken"])
      ).rejects.toThrowError(new ActionSecurityError("Unexpected field not permitted: extraField", 400));
    });

    it("rejects invalid UTF-8 encoding in payload with 400", async () => {
      const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
      const req = new Request("https://parallax.example.com/admin", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: invalidUtf8,
      });
      await expect(readStrictFormUrlEncoded(req)).rejects.toMatchObject({
        status: 400,
      });
    });
  });
});
