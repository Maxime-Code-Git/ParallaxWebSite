import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import defaultSiteContent from "../app/content/default-site-content.json";
import { createDefaultPortfolioContent, getPublicPortfolioContent } from "../app/lib/portfolio-content.server";
import { loader as robotsLoader } from "../app/routes/public/robots";
import { loader as sitemapLoader } from "../app/routes/public/sitemap";
import { meta as homeMeta } from "../app/routes/public/home";
import { meta as studioMeta } from "../app/routes/public/studio";
import { meta as contactMeta } from "../app/routes/public/contact";
import { meta as portfolioMeta } from "../app/routes/public/portfolio";
import { meta as legalMeta } from "../app/routes/public/legal-page";
import { ENV } from "../app/lib/env.server";
import type { SiteContent } from "../app/lib/site-content.shared";

type MetaDescriptor = {
  title?: string;
  name?: string;
  property?: string;
  content?: string;
  rel?: string;
  href?: string;
  hrefLang?: string;
  tagName?: string;
  [key: string]: unknown;
};

describe("Technical SEO, Robots, Sitemap and Metadata Suite", () => {
  let tmpDir: string;
  let testSiteContent: string;
  let testPortfolioContent: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-seo-test-"));
    testSiteContent = path.join(tmpDir, "site-content.json");
    testPortfolioContent = path.join(tmpDir, "portfolio-content.json");

    // Initialize valid isolated content fixtures with published legal docs
    const siteData = structuredClone(defaultSiteContent) as unknown as SiteContent;
    siteData.legalPages.mentions.published = { ...structuredClone(siteData.legalPages.mentions.draft), version: 1 };
    siteData.legalPages.privacy.published = { ...structuredClone(siteData.legalPages.privacy.draft), version: 1 };
    siteData.legalPages.terms.published = { ...structuredClone(siteData.legalPages.terms.draft), version: 1 };
    siteData.legalPages.cookies.published = { ...structuredClone(siteData.legalPages.cookies.draft), version: 1 };

    fs.writeFileSync(testSiteContent, JSON.stringify(siteData, null, 2), "utf-8");
    fs.writeFileSync(testPortfolioContent, JSON.stringify(createDefaultPortfolioContent(), null, 2), "utf-8");

    process.env.SITE_CONTENT_PATH = testSiteContent;
    process.env.PORTFOLIO_CONTENT_PATH = testPortfolioContent;
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("1. robots.txt Route", () => {
    it("returns valid text/plain response with sitemap and disallow rules", async () => {
      const res = await robotsLoader();

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      expect(res.headers.get("Cache-Control")).toContain("public, max-age=3600");

      const text = await res.text();
      expect(text).toContain("Disallow: /admin\n");
      expect(text).toContain("Disallow: /admin/\n");
      expect(text).toContain("Disallow: /api/");
      expect(text).toContain("Disallow: /fr/galerie/");
      expect(text).toContain("Disallow: /en/gallery/");
      expect(text).toContain("Disallow: /fr/espace-client");
      expect(text).toContain("Disallow: /en/client-area");

      const publicSiteUrl = ENV.PUBLIC_SITE_URL.replace(/\/$/, "");
      expect(text).toContain(`Sitemap: ${publicSiteUrl}/sitemap.xml`);
    });
  });

  describe("2. Dynamic sitemap.xml Route", () => {
    it("returns valid application/xml response with proper XML structure and namespaces", async () => {
      const res = await sitemapLoader();

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/xml");
      expect(res.headers.get("Cache-Control")).toContain("public, max-age=3600");

      const xml = await res.text();
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
      expect(xml.endsWith("</urlset>\n")).toBe(true);

      const base = ENV.PUBLIC_SITE_URL.replace(/\/$/, "");

      // Public vitrine pages
      expect(xml).toContain(`<loc>${base}/fr</loc>`);
      expect(xml).toContain(`<loc>${base}/en</loc>`);
      expect(xml).toContain(`<loc>${base}/fr/studio</loc>`);
      expect(xml).toContain(`<loc>${base}/en/studio</loc>`);
      expect(xml).toContain(`<loc>${base}/fr/contact</loc>`);
      expect(xml).toContain(`<loc>${base}/en/contact</loc>`);

      // Portfolio overview
      expect(xml).toContain(`<loc>${base}/fr/projets</loc>`);
      expect(xml).toContain(`<loc>${base}/en/projects</loc>`);

      // Alternates for Home
      expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="fr" href="${base}/fr"/>`);
      expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${base}/en"/>`);
      expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${base}/fr"/>`);

      // Dynamic published categories and projects coverage
      const { publicCategories, publicProjects } = getPublicPortfolioContent();
      for (const cat of publicCategories) {
        expect(xml).toContain(`<loc>${base}/fr/projets/${encodeURIComponent(cat.slugFr)}</loc>`);
        expect(xml).toContain(`<loc>${base}/en/projects/${encodeURIComponent(cat.slugEn)}</loc>`);
      }

      for (const proj of publicProjects) {
        const cat = publicCategories.find((c) => c.id === proj.category);
        if (cat) {
          expect(xml).toContain(
            `<loc>${base}/fr/projets/${encodeURIComponent(cat.slugFr)}/${encodeURIComponent(proj.slugFr)}</loc>`
          );
          expect(xml).toContain(
            `<loc>${base}/en/projects/${encodeURIComponent(cat.slugEn)}/${encodeURIComponent(proj.slugEn)}</loc>`
          );
        }
      }

      // Check strictly excluded paths
      expect(xml).not.toContain("/admin");
      expect(xml).not.toContain("/api");
      expect(xml).not.toContain("/galerie");
      expect(xml).not.toContain("/gallery");
      expect(xml).not.toContain("?dir=");
      expect(xml).not.toContain("?type=");
    });

    it("excludes unpublished legal documents and formats W3C lastmod correctly", async () => {
      // Modify site content fixture so 'cookies' is NOT published
      const siteData = JSON.parse(fs.readFileSync(testSiteContent, "utf-8"));
      siteData.legalPages.cookies.published = null;
      fs.writeFileSync(testSiteContent, JSON.stringify(siteData, null, 2), "utf-8");

      const res = await sitemapLoader();
      const xml = await res.text();

      // Check dates follow YYYY-MM-DD format
      const lastmodMatches = xml.match(/<lastmod>([^<]+)<\/lastmod>/g);
      expect(lastmodMatches).not.toBeNull();
      if (lastmodMatches) {
        for (const match of lastmodMatches) {
          const val = match.replace(/<\/?lastmod>/g, "");
          expect(val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }

      const base = ENV.PUBLIC_SITE_URL.replace(/\/$/, "");

      // Mentions is published -> present in sitemap
      expect(xml).toContain(`<loc>${base}/fr/mentions-legales</loc>`);
      expect(xml).toContain(`<loc>${base}/en/legal-notice</loc>`);

      // Cookies is unpublished -> absent from sitemap
      expect(xml).not.toContain("/fr/cookies");
      expect(xml).not.toContain("/en/cookies");
    });
  });

  describe("3. Metadata Enrichment across Vitrine, Portfolio, and Legal Pages", () => {
    const siteUrl = "http://127.0.0.1:3000";

    it("renders complete metadata for Home (canonical, hreflang, Open Graph, Twitter)", () => {
      const meta = (homeMeta({
        data: {
          lang: "fr",
          common: { brandName: "Parallax", navigation: {} as unknown, footer: {} as unknown },
          home: {
            seo: { title: { fr: "Accueil | Parallax", en: "Home | Parallax" }, description: { fr: "Desc FR", en: "Desc EN" } },
          } as unknown,
          media: {},
          siteUrl,
        },
      } as unknown as Parameters<typeof homeMeta>[0]) || []) as MetaDescriptor[];

      const titleEntry = meta.find((m) => "title" in m) as { title: string } | undefined;
      expect(titleEntry?.title).toBe("Accueil | Parallax");

      const descEntry = meta.find((m) => m.name === "description") as { content: string } | undefined;
      expect(descEntry?.content).toBe("Desc FR");

      const robotsEntry = meta.find((m) => m.name === "robots") as { content: string } | undefined;
      expect(robotsEntry?.content).toBe("index, follow");

      const canonicalEntry = meta.find((m) => m.rel === "canonical") as { href: string } | undefined;
      expect(canonicalEntry?.href).toBe("http://127.0.0.1:3000/fr");

      expect(meta.find((m) => m.rel === "alternate" && m.hrefLang === "fr")?.href).toBe("http://127.0.0.1:3000/fr");
      expect(meta.find((m) => m.rel === "alternate" && m.hrefLang === "en")?.href).toBe("http://127.0.0.1:3000/en");
      expect(meta.find((m) => m.rel === "alternate" && m.hrefLang === "x-default")?.href).toBe("http://127.0.0.1:3000/fr");

      // Open Graph
      expect(meta.find((m) => m.property === "og:type")?.content).toBe("website");
      expect(meta.find((m) => m.property === "og:site_name")?.content).toBe("Parallax");
      expect(meta.find((m) => m.property === "og:url")?.content).toBe("http://127.0.0.1:3000/fr");
      expect(meta.find((m) => m.property === "og:locale")?.content).toBe("fr_FR");
      expect(meta.find((m) => m.property === "og:locale:alternate")?.content).toBe("en_US");

      // Twitter
      expect(meta.find((m) => m.name === "twitter:card")?.content).toBe("summary_large_image");
    });

    it("renders complete metadata for Studio", () => {
      const meta = (studioMeta({
        data: {
          lang: "en",
          common: { brandName: "Parallax", navigation: {} as unknown, footer: {} as unknown },
          studio: {
            seo: { title: { fr: "Studio | Parallax", en: "Studio | Parallax" }, description: { fr: "Studio FR", en: "Studio EN" } },
          } as unknown,
          media: {},
          siteUrl,
        },
      } as unknown as Parameters<typeof studioMeta>[0]) || []) as MetaDescriptor[];

      const titleEntry = meta.find((m) => "title" in m) as { title: string } | undefined;
      expect(titleEntry?.title).toBe("Studio | Parallax");

      const descEntry = meta.find((m) => m.name === "description") as { content: string } | undefined;
      expect(descEntry?.content).toBe("Studio EN");

      const canonicalEntry = meta.find((m) => m.rel === "canonical") as { href: string } | undefined;
      expect(canonicalEntry?.href).toBe("http://127.0.0.1:3000/en/studio");

      expect(meta.find((m) => m.property === "og:locale")?.content).toBe("en_US");
      expect(meta.find((m) => m.property === "og:locale:alternate")?.content).toBe("fr_FR");
    });

    it("renders complete metadata for Contact without technical query parameters", () => {
      const meta = (contactMeta({
        data: {
          lang: "fr",
          content: {
            common: { brandName: "Parallax", navigation: {} as unknown, footer: {} as unknown },
            contactPage: {
              seo: { title: { fr: "Contact | Parallax", en: "Contact | Parallax" }, description: { fr: "Contact FR", en: "Contact EN" } },
            } as unknown,
            home: { contact: {} as unknown },
          },
          token: "dummy",
          prefillType: "documentary",
          flashSuccess: false,
          smtpAvailable: true,
          isPrivacyPolicyPublished: true,
          siteUrl,
        },
      } as unknown as Parameters<typeof contactMeta>[0]) || []) as MetaDescriptor[];

      const titleEntry = meta.find((m) => "title" in m) as { title: string } | undefined;
      expect(titleEntry?.title).toBe("Contact | Parallax");

      const canonicalEntry = meta.find((m) => m.rel === "canonical") as { href: string } | undefined;
      expect(canonicalEntry?.href).toBe("http://127.0.0.1:3000/fr/contact");
      expect(meta.find((m) => m.property === "og:url")?.content).toBe("http://127.0.0.1:3000/fr/contact");
    });

    it("renders complete metadata for Portfolio", () => {
      const meta = (portfolioMeta({
        data: {
          lang: "fr",
          common: {} as unknown,
          content: {
            overview: {
              title: { fr: "Projets", en: "Projects" },
              intro: { fr: "Intro FR", en: "Intro EN" },
              seo: { title: { fr: "Portfolio | Parallax", en: "Portfolio | Parallax" }, description: { fr: "Desc", en: "Desc" } },
            },
          } as unknown,
          showcaseProjects: [],
          panelState: {
            isOpen: false,
            activeCategory: null,
            activeProject: null,
            direction: "left",
          },
          alternateUrls: { fr: "/fr/projets", en: "/en/projects" },
          siteUrl,
        },
      } as unknown as Parameters<typeof portfolioMeta>[0]) || []) as MetaDescriptor[];

      const titleEntry = meta.find((m) => "title" in m) as { title: string } | undefined;
      expect(titleEntry?.title).toBe("Portfolio | Parallax");

      const canonicalEntry = meta.find((m) => m.rel === "canonical") as { href: string } | undefined;
      expect(canonicalEntry?.href).toBe("http://127.0.0.1:3000/fr/projets");
      expect(meta.find((m) => m.property === "og:type")?.content).toBe("website");
      expect(meta.find((m) => m.name === "twitter:card")?.content).toBe("summary_large_image");
    });

    it("renders complete metadata for Legal Pages with article og:type", () => {
      const meta = (legalMeta({
        data: {
          lang: "fr",
          pageKey: "mentions",
          alternateUrls: { fr: "/fr/mentions-legales", en: "/en/legal-notice" },
          siteUrl,
          document: {
            seoTitle: { fr: "Mentions légales | Parallax", en: "Legal Notice | Parallax" },
            seoDescription: { fr: "Mentions FR", en: "Legal EN" },
          } as unknown,
        },
      } as unknown as Parameters<typeof legalMeta>[0]) || []) as MetaDescriptor[];

      const titleEntry = meta.find((m) => "title" in m) as { title: string } | undefined;
      expect(titleEntry?.title).toBe("Mentions légales | Parallax");

      const canonicalEntry = meta.find((m) => m.rel === "canonical") as { href: string } | undefined;
      expect(canonicalEntry?.href).toBe("http://127.0.0.1:3000/fr/mentions-legales");
      expect(meta.find((m) => m.property === "og:type")?.content).toBe("article");
      expect(meta.find((m) => m.name === "twitter:card")?.content).toBe("summary");
    });
  });

  describe("4. Minimal Health Check Endpoint", () => {
    it("returns status ok and does not leak internal data", async () => {
      const { loader: healthLoader } = await import("../app/routes/api/health");
      const res = await healthLoader();

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Cache-Control")).toContain("no-store");

      const body = (await res.json()) as { status: string; timestamp: string };
      expect(body).toMatchObject({ status: "ok" });
      expect(body.timestamp).toBeDefined();
    });
  });
});
