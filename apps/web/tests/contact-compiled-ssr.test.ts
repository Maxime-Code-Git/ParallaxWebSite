import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequestHandler, type ServerBuild } from "react-router";

describe("Compiled SSR Contact Handler", () => {
  let handler: (request: Request) => Promise<Response>;
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-ssr-contact-test-"));
    process.env.SITE_CONTENT_PATH = path.join(tempDir, "site-content.json");
    process.env.RATE_LIMIT_DB_PATH = path.join(tempDir, "rate-limit.sqlite");
    process.env.RATE_LIMIT_SECRET = "01234567890123456789012345678901";
    process.env.PUBLIC_SITE_URL = "http://localhost:3000";

    // @ts-expect-error - Compiled server build bundle has no declaration file
    const build = (await import("../build/server/index.js")) as unknown as ServerBuild;
    handler = createRequestHandler(build, "production");
  });

  afterAll(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves GET /fr/contact with 200 and Cache-Control: no-store without noindex", async () => {
    const req = new Request("http://localhost:3000/fr/contact", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.includes("__parallax_contact_ctx"))).toBe(true);
  });

  it("serves GET /en/contact with 200 and Cache-Control: no-store without noindex", async () => {
    const req = new Request("http://localhost:3000/en/contact", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("serves GET /fr/contact.data with 200 and Cache-Control: no-store", async () => {
    const req = new Request("http://localhost:3000/fr/contact.data");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("serves GET /en/contact.data with 200 and Cache-Control: no-store", async () => {
    const req = new Request("http://localhost:3000/en/contact.data");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
