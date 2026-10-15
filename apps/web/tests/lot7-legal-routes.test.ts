import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  resolveLegalRoute,
  loader as legalLoader,
  meta as legalMeta,
  type LegalPageLoaderData,
} from "../app/routes/public/legal-page";
import { loader as redirectLoader } from "../app/routes/public/legal-redirect";
import {
  getSiteContent,
  saveLegalPageDraft,
  publishLegalPage,
} from "../app/lib/site-content.server";
import type { LoaderFunctionArgs } from "react-router";

type MetaTag = {
  title?: string;
  name?: string;
  content?: string;
  tagName?: string;
  rel?: string;
  href?: string;
  hrefLang?: string;
};

const makeLoaderArgs = (req: Request): LoaderFunctionArgs =>
  ({
    request: req,
    params: {},
    context: {} as never,
  }) as unknown as LoaderFunctionArgs;

describe("Lot 7 - Public Legal Routes, Canonical URLs, and SEO Headers", () => {
  let tempDir: string;
  let testContentFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-lot7-routes-"));
    testContentFile = path.join(tempDir, "site-content.json");
    process.env.SITE_CONTENT_PATH = testContentFile;
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("resolveLegalRoute correctly resolves all 8 canonical public legal paths in FR and EN", () => {
    expect(resolveLegalRoute("/fr/mentions-legales")).toEqual({ pageKey: "mentions", lang: "fr" });
    expect(resolveLegalRoute("/en/legal-notice")).toEqual({ pageKey: "mentions", lang: "en" });

    expect(resolveLegalRoute("/fr/confidentialite")).toEqual({ pageKey: "privacy", lang: "fr" });
    expect(resolveLegalRoute("/en/privacy-policy")).toEqual({ pageKey: "privacy", lang: "en" });

    expect(resolveLegalRoute("/fr/cgv")).toEqual({ pageKey: "terms", lang: "fr" });
    expect(resolveLegalRoute("/en/terms")).toEqual({ pageKey: "terms", lang: "en" });

    expect(resolveLegalRoute("/fr/cookies")).toEqual({ pageKey: "cookies", lang: "fr" });
    expect(resolveLegalRoute("/en/cookies")).toEqual({ pageKey: "cookies", lang: "en" });

    // Trailing slashes
    expect(resolveLegalRoute("/fr/cookies/")).toEqual({ pageKey: "cookies", lang: "fr" });

    // Invalid route
    expect(resolveLegalRoute("/fr/unknown-legal-page")).toBeNull();
    expect(resolveLegalRoute("/fr/mentions")).toBeNull();
  });

  it("legalRouteLoader returns 404 for unknown legal routes", async () => {
    const req = new Request("http://127.0.0.1:3000/fr/non-existent-page", { method: "GET" });
    await expect(legalLoader(makeLoaderArgs(req))).rejects.toThrow();
  });

  it("legacy redirect route returns 301 Permanent Redirect to canonical URLs", () => {
    // 1. /en/mentions-legales -> /en/legal-notice
    const req1 = new Request("http://127.0.0.1:3000/en/mentions-legales");
    const res1 = redirectLoader(makeLoaderArgs(req1));
    expect(res1.status).toBe(301);
    expect(res1.headers.get("Location")).toBe("/en/legal-notice");

    // 2. /en/confidentialite -> /en/privacy-policy
    const req2 = new Request("http://127.0.0.1:3000/en/confidentialite");
    const res2 = redirectLoader(makeLoaderArgs(req2));
    expect(res2.status).toBe(301);
    expect(res2.headers.get("Location")).toBe("/en/privacy-policy");

    // 3. /en/cgv -> /en/terms
    const req3 = new Request("http://127.0.0.1:3000/en/cgv");
    const res3 = redirectLoader(makeLoaderArgs(req3));
    expect(res3.status).toBe(301);
    expect(res3.headers.get("Location")).toBe("/en/terms");

    // 4. /fr/politique-de-confidentialite -> /fr/confidentialite
    const req4 = new Request("http://127.0.0.1:3000/fr/politique-de-confidentialite");
    const res4 = redirectLoader(makeLoaderArgs(req4));
    expect(res4.status).toBe(301);
    expect(res4.headers.get("Location")).toBe("/fr/confidentialite");
  });

  it("published legal page returns public Cache-Control and full SEO canonical + hreflang tags", async () => {
    const initial = getSiteContent();

    // Setup and publish privacy page
    const draft = {
      ...initial.legalPages.privacy.draft,
      publicTitle: { fr: "Vie privée", en: "Privacy" },
      seoTitle: { fr: "Vie privée — Parallax", en: "Privacy — Parallax" },
      seoDescription: { fr: "Description de vie privée", en: "Privacy description" },
      intro: { fr: "Introduction conforme", en: "Compliant introduction" },
      sections: [
        {
          id: "intro",
          title: { fr: "Titre", en: "Title" },
          paragraphs: [{ fr: "Contenu légal", en: "Legal content" }],
        },
      ],
    };

    const rev1 = saveLegalPageDraft("privacy", draft, initial.revision);
    publishLegalPage("privacy", rev1, "2026-10-15");

    const req = new Request("http://127.0.0.1:3000/fr/confidentialite", { method: "GET" });
    const response = await legalLoader(makeLoaderArgs(req));
    const loaderResult = response as unknown as { data: LegalPageLoaderData; init?: { headers?: HeadersInit } };
    const data = loaderResult.data;
    const headers = new Headers(loaderResult.init?.headers);

    // Legal routes enforce private, no-store to allow immediate unpublishing and prevent caching visitor state
    expect(headers.get("Cache-Control")).toContain("private");
    expect(headers.get("Cache-Control")).toContain("no-store");

    const metaTags = legalMeta({ data }) as MetaTag[];

    // Canonical link
    const canonical = metaTags.find((t) => t.tagName === "link" && t.rel === "canonical");
    expect(canonical?.href).toBe("http://127.0.0.1:3000/fr/confidentialite");

    // Hreflang alternates
    const alternateFr = metaTags.find((t) => t.tagName === "link" && t.rel === "alternate" && t.hrefLang === "fr");
    const alternateEn = metaTags.find((t) => t.tagName === "link" && t.rel === "alternate" && t.hrefLang === "en");
    expect(alternateFr?.href).toBe("http://127.0.0.1:3000/fr/confidentialite");
    expect(alternateEn?.href).toBe("http://127.0.0.1:3000/en/privacy-policy");

    // Indexable robots tag
    const robots = metaTags.find((t) => t.name === "robots");
    expect(robots?.content).toBe("index, follow");
  });

  it("cookies page enforces private no-store headers with Vary: Cookie to avoid caching visitor choices", async () => {
    const req = new Request("http://127.0.0.1:3000/fr/cookies", { method: "GET" });
    const response = await legalLoader(makeLoaderArgs(req));

    const loaderResult = response as unknown as { init?: { headers?: HeadersInit } };
    const headers = new Headers(loaderResult.init?.headers);

    expect(headers.get("Cache-Control")).toContain("private");
    expect(headers.get("Cache-Control")).toContain("no-store");
    expect(headers.get("Vary")).toBe("Cookie");
  });
});
