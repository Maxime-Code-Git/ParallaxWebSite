// @vitest-environment node
import { describe, it, expect } from "vitest";
import { generateNonce, buildCsp, addSecurityHeaders } from "../app/entry.server";

describe("entry.server.tsx Security and CSP", () => {
  it("generates distinct 16-byte base64 nonces on consecutive calls", () => {
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).not.toBe(nonce2);
    expect(Buffer.from(nonce1, "base64").length).toBe(16);
  });

  it("builds strict CSP containing nonce and no unsafe-inline in production", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const nonce = generateNonce();
      const csp = buildCsp(nonce);

      expect(csp).toContain(`'nonce-${nonce}'`);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).not.toContain("'unsafe-inline'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      // Exclude third-party video iframes until future lot
      expect(csp).not.toContain("youtube");
      expect(csp).not.toContain("vimeo");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("permits style unsafe-inline in development for Vite HMR", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      const nonce = generateNonce();
      const csp = buildCsp(nonce);
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("connect-src 'self' ws: wss:");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("addSecurityHeaders attaches all expected security headers", () => {
    const headers = new Headers();
    const nonce = generateNonce();
    addSecurityHeaders(headers, nonce);

    expect(headers.get("Content-Security-Policy")).toBeDefined();
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });
});
