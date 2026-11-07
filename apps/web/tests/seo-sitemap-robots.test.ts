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
import { meta as clientLoginMeta } from "../app/routes/public/client-login";
import { meta as galleryMeta } from "../app/routes/public/gallery";
import { ENV } from "../app/lib/env.server";
import type { SiteContent } from "../app/lib/site-content.shared";
import type { PortfolioProject, PortfolioCategoryItem } from "../app/lib/portfolio-content.shared";
import { getPortfolioAlternateUrls } from "../app/lib/localized-urls";

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
    process.env.GALLERY_SECRET = "0a5da5c23aa9d559a92afffe8631159d28a42b83ad81eb216629d5a6f8f5d222";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "1ee78c7b52ef56a0d5085119633a326bc3d45994fbbf69c9ccb2d8e0dc966332";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("1. robots.txt Route", () => {
    it("starts with User-agent: * before Disallow directives", async () => {
      const res = await robotsLoader();

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      expect(res.headers.get("Cache-Control")).toContain("public, max-age=3600");

      const text = await res.text();
      expect(text.startsWith("User-agent: *\n")).toBe(true);

      const userAgentIdx = text.indexOf("User-agent: *");
      const firstDisallowIdx = text.indexOf("Disallow: /admin");
      expect(userAgentIdx).toBeGreaterThanOrEqual(0);
      expect(firstDisallowIdx).toBeGreaterThan(userAgentIdx);

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

  describe("3. Metadata Enrichment across Vitrine, Portfolio, Legal and Private Pages (RR8 loaderData contract)", () => {
    const siteUrl = "http://127.0.0.1:3000";

    // ------------------------------------------------------------------------
    // Vitrine: Home FR / EN
    // ------------------------------------------------------------------------
    it("renders complete metadata for Home FR via loaderData", () => {
      const meta = (homeMeta({
        loaderData: {
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

    it("renders complete metadata for Home EN via loaderData", () => {
      const meta = (homeMeta({
        loaderData: {
          lang: "en",
          common: { brandName: "Parallax", navigation: {} as unknown, footer: {} as unknown },
          home: {
            seo: { title: { fr: "Accueil | Parallax", en: "Home | Parallax" }, description: { fr: "Desc FR", en: "Desc EN" } },
          } as unknown,
          media: {},
          siteUrl,
        },
      } as unknown as Parameters<typeof homeMeta>[0]) || []) as MetaDescriptor[];

      expect(meta.find((m) => "title" in m)?.title).toBe("Home | Parallax");
      expect(meta.find((m) => m.name === "description")?.content).toBe("Desc EN");
      expect(meta.find((m) => m.rel === "canonical")?.href).toBe("http://127.0.0.1:3000/en");
      expect(meta.find((m) => m.property === "og:locale")?.content).toBe("en_US");
      expect(meta.find((m) => m.property === "og:locale:alternate")?.content).toBe("fr_FR");
    });

    // ------------------------------------------------------------------------
    // Vitrine: Studio FR / EN
    // ------------------------------------------------------------------------
    it("renders complete metadata for Studio FR and EN via loaderData", () => {
      const metaFr = (studioMeta({
        loaderData: {
          lang: "fr",
          common: { brandName: "Parallax", navigation: {} as unknown, footer: {} as unknown },
          studio: {
            seo: { title: { fr: "Studio FR | Parallax", en: "Studio EN | Parallax" }, description: { fr: "Desc Studio FR", en: "Desc Studio EN" } },
          } as unknown,
          media: {},
          siteUrl,
        },
      } as unknown as Parameters<typeof studioMeta>[0]) || []) as MetaDescriptor[];

      expect(metaFr.find((m) => "title" in m)?.title).toBe("Studio FR | Parallax");
      expect(metaFr.find((m) => m.name === "description")?.content).toBe("Desc Studio FR");
      expect(metaFr.find((m) => m.rel === "canonical")?.href).toBe("http://127.0.0.1:3000/fr/studio");

      const metaEn = (studioMeta({
        loaderData: {
          lang: "en",
          common: { brandName: "Parallax", navigation: {} as unknown, footer: {} as unknown },
          studio: {
            seo: { title: { fr: "Studio FR | Parallax", en: "Studio EN | Parallax" }, description: { fr: "Desc Studio FR", en: "Desc Studio EN" } },
          } as unknown,
          media: {},
          siteUrl,
        },
      } as unknown as Parameters<typeof studioMeta>[0]) || []) as MetaDescriptor[];

      expect(metaEn.find((m) => "title" in m)?.title).toBe("Studio EN | Parallax");
      expect(metaEn.find((m) => m.name === "description")?.content).toBe("Desc Studio EN");
      expect(metaEn.find((m) => m.rel === "canonical")?.href).toBe("http://127.0.0.1:3000/en/studio");
    });

    // ------------------------------------------------------------------------
    // Vitrine: Contact FR / EN
    // ------------------------------------------------------------------------
    it("renders complete metadata for Contact FR and EN via loaderData", () => {
      const metaFr = (contactMeta({
        loaderData: {
          lang: "fr",
          content: {
            common: { brandName: "Parallax", navigation: {} as unknown, footer: {} as unknown },
            contactPage: {
              seo: { title: { fr: "Contact FR | Parallax", en: "Contact EN | Parallax" }, description: { fr: "Desc Contact FR", en: "Desc Contact EN" } },
            } as unknown,
            home: { contact: {} as unknown },
          },
          token: "dummy",
          prefillType: "",
          flashSuccess: false,
          smtpAvailable: true,
          isPrivacyPolicyPublished: true,
          siteUrl,
        },
      } as unknown as Parameters<typeof contactMeta>[0]) || []) as MetaDescriptor[];

      expect(metaFr.find((m) => "title" in m)?.title).toBe("Contact FR | Parallax");
      expect(metaFr.find((m) => m.name === "description")?.content).toBe("Desc Contact FR");
      expect(metaFr.find((m) => m.rel === "canonical")?.href).toBe("http://127.0.0.1:3000/fr/contact");

      const metaEn = (contactMeta({
        loaderData: {
          lang: "en",
          content: {
            common: { brandName: "Parallax", navigation: {} as unknown, footer: {} as unknown },
            contactPage: {
              seo: { title: { fr: "Contact FR | Parallax", en: "Contact EN | Parallax" }, description: { fr: "Desc Contact FR", en: "Desc Contact EN" } },
            } as unknown,
            home: { contact: {} as unknown },
          },
          token: "dummy",
          prefillType: "",
          flashSuccess: false,
          smtpAvailable: true,
          isPrivacyPolicyPublished: true,
          siteUrl,
        },
      } as unknown as Parameters<typeof contactMeta>[0]) || []) as MetaDescriptor[];

      expect(metaEn.find((m) => "title" in m)?.title).toBe("Contact EN | Parallax");
      expect(metaEn.find((m) => m.name === "description")?.content).toBe("Desc Contact EN");
      expect(metaEn.find((m) => m.rel === "canonical")?.href).toBe("http://127.0.0.1:3000/en/contact");
    });

    // ------------------------------------------------------------------------
    // Portfolio: Overview, Category, and Project (Barat Fixture) FR / EN
    // ------------------------------------------------------------------------
    const categoriesFixture: PortfolioCategoryItem[] = [
      {
        id: "advertising",
        slugFr: "publicite",
        slugEn: "advertising",
        order: 0,
        status: "published",
        title: { fr: "Publicité", en: "Advertising" },
        intro: { fr: "Films et photos de marque", en: "Brand films and photos" },
        seo: {
          title: { fr: "Publicité & Brand Content | Parallax", en: "Advertising & Brand Content | Parallax" },
          description: {
            fr: "Découvrez nos productions publicitaires et créations de marque.",
            en: "Explore our advertising and branded content productions.",
          },
        },
        coverImageId: null,
        coverAlt: { fr: "Pub", en: "Ad" },
        entryImageId: null,
        entryAlt: { fr: "Pub", en: "Ad" },
        entrySummary: { fr: "Pub", en: "Ad" },
        entrySide: "left",
        bannerImageId: null,
        bannerAlt: { fr: "Pub", en: "Ad" },
        showreelTitle: { fr: "Showreel", en: "Showreel" },
        showreelVideo: null,
        showreelCoverImageId: null,
        morePhotosButton: { fr: "Plus", en: "More" },
        lessPhotosButton: { fr: "Moins", en: "Less" },
        backButton: { fr: "Retour", en: "Back" },
      },
      {
        id: "sports",
        slugFr: "sports",
        slugEn: "sports",
        order: 1,
        status: "published",
        title: { fr: "Sports", en: "Sports" },
        intro: { fr: "Action et performance", en: "Action and performance" },
        seo: {
          title: { fr: "Photographie & vidéo de sport | Parallax", en: "Sports Photography & Video | Parallax" },
          description: {
            fr: "Découvrez les réalisations photo et vidéo de sport de Parallax : cyclisme sur route, rallye et images d’action.",
            en: "Explore sports photography and video by Parallax, from road cycling to rallying.",
          },
        },
        coverImageId: null,
        coverAlt: { fr: "Sport", en: "Sport" },
        entryImageId: null,
        entryAlt: { fr: "Sport", en: "Sport" },
        entrySummary: { fr: "Sport", en: "Sport" },
        entrySide: "right",
        bannerImageId: null,
        bannerAlt: { fr: "Sport", en: "Sport" },
        showreelTitle: { fr: "Showreel", en: "Showreel" },
        showreelVideo: null,
        showreelCoverImageId: null,
        morePhotosButton: { fr: "Plus", en: "More" },
        lessPhotosButton: { fr: "Moins", en: "Less" },
        backButton: { fr: "Retour", en: "Back" },
      },
    ];

    const baratProjectFixture: PortfolioProject = {
      id: "barat-fixture-id",
      category: "advertising",
      slugFr: "boulangerie-barat",
      slugEn: "bakery-barat",
      title: {
        fr: "Barat Boulangerie - Fromagerie",
        en: "Barat Bakery - Cheese",
      },
      summary: {
        fr: "Production photo et vidéo artisanale",
        en: "Artisanal photo and video production",
      },
      description: [],
      seo: {
        title: {
          fr: "Barat - Photographie & Vidéo | Parallax",
          en: "Barat - Photography & Video | Parallax",
        },
        description: {
          fr: "Découvrez notre production photo et vidéo pour Barat Boulangerie - Fromagerie, réalisée pour valoriser ses produits sur le web et les réseaux sociaux.",
          en: "Discover our photo and video production for Barat Bakery - Fromagerie, created to showcase products across web and social channels.",
        },
      },
      video: null,
      coverImageId: null,
      coverAlt: { fr: "Barat", en: "Barat" },
      galleryImageIds: [],
      showcase: true,
      side: "left",
      order: 1,
      status: "published",
      archived: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      presentationMode: "photo",
      aspectRatio: "3:2",
      galleryAlt: {},
    };

    it("renders complete metadata for Portfolio Overview FR", () => {
      const meta = (portfolioMeta({
        loaderData: {
          lang: "fr",
          common: {} as unknown,
          content: {
            overview: {
              title: { fr: "Projets", en: "Projects" },
              intro: { fr: "Intro FR", en: "Intro EN" },
              seo: {
                title: { fr: "Portfolio | Parallax | Réalisations", en: "Portfolio | Parallax | Works" },
                description: { fr: "Découvrez nos projets photo et vidéo.", en: "Discover our photo and video works." },
              },
            },
            categories: categoriesFixture,
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

      expect(meta.find((m) => "title" in m)?.title).toBe("Portfolio | Parallax | Réalisations");
      expect(meta.find((m) => m.name === "description")?.content).toBe("Découvrez nos projets photo et vidéo.");
      expect(meta.find((m) => m.rel === "canonical")?.href).toBe("http://127.0.0.1:3000/fr/projets");
      expect(meta.find((m) => m.rel === "alternate" && m.hrefLang === "fr")?.href).toBe("http://127.0.0.1:3000/fr/projets");
      expect(meta.find((m) => m.rel === "alternate" && m.hrefLang === "en")?.href).toBe("http://127.0.0.1:3000/en/projects");
      expect(meta.find((m) => m.rel === "alternate" && m.hrefLang === "x-default")?.href).toBe("http://127.0.0.1:3000/fr/projets");
    });

    it("renders complete metadata for Category Section FR (Sports) without technical query parameters", () => {
      const cleanUrls = getPortfolioAlternateUrls(null, "sports", null, categoriesFixture);
      const navUrlsWithDir = getPortfolioAlternateUrls(null, "sports", "right", categoriesFixture);

      const meta = (portfolioMeta({
        loaderData: {
          lang: "fr",
          common: {} as unknown,
          content: {
            overview: {
              title: { fr: "Projets", en: "Projects" },
              intro: { fr: "Intro FR", en: "Intro EN" },
              seo: { title: { fr: "Overview SEO", en: "Overview SEO" }, description: { fr: "Desc", en: "Desc" } },
            },
            categories: categoriesFixture,
          } as unknown,
          showcaseProjects: [],
          panelState: {
            isOpen: true,
            activeCategory: "sports",
            activeProject: null,
            direction: "right",
          },
          alternateUrls: navUrlsWithDir, // e.g. /fr/projets/sports?dir=right
          seoUrls: cleanUrls,            // clean /fr/projets/sports
          siteUrl,
        },
      } as unknown as Parameters<typeof portfolioMeta>[0]) || []) as MetaDescriptor[];

      expect(meta.find((m) => "title" in m)?.title).toBe("Photographie & vidéo de sport | Parallax");
      expect(meta.find((m) => m.name === "description")?.content).toBe(
        "Découvrez les réalisations photo et vidéo de sport de Parallax : cyclisme sur route, rallye et images d’action."
      );
      // Canonical and alternates MUST NOT have ?dir=
      expect(meta.find((m) => m.rel === "canonical")?.href).toBe("http://127.0.0.1:3000/fr/projets/sports");
      expect(meta.find((m) => m.rel === "alternate" && m.hrefLang === "fr")?.href).toBe("http://127.0.0.1:3000/fr/projets/sports");
      expect(meta.find((m) => m.rel === "alternate" && m.hrefLang === "en")?.href).toBe("http://127.0.0.1:3000/en/projects/sports");
      expect(meta.find((m) => m.property === "og:url")?.content).toBe("http://127.0.0.1:3000/fr/projets/sports");
    });

    it("renders distinct custom SEO for Barat Project FR and strips ?dir= from canonical, hreflang, and og:url", () => {
      const cleanUrls = getPortfolioAlternateUrls(baratProjectFixture, "advertising", null, categoriesFixture);
      const navUrlsWithDir = getPortfolioAlternateUrls(baratProjectFixture, "advertising", "left", categoriesFixture);

      // Verify helper generates ?dir= on navigation URLs and clean paths without direction
      expect(navUrlsWithDir.fr).toBe("/fr/projets/publicite/boulangerie-barat?dir=left");
      expect(cleanUrls.fr).toBe("/fr/projets/publicite/boulangerie-barat");
      expect(cleanUrls.en).toBe("/en/projects/advertising/bakery-barat");

      const meta = (portfolioMeta({
        loaderData: {
          lang: "fr",
          common: {} as unknown,
          content: {
            overview: { title: { fr: "P", en: "P" }, intro: { fr: "I", en: "I" }, seo: { title: { fr: "", en: "" }, description: { fr: "", en: "" } } },
            categories: categoriesFixture,
          } as unknown,
          showcaseProjects: [],
          panelState: {
            isOpen: true,
            activeCategory: "advertising",
            activeProject: baratProjectFixture,
            direction: "left",
          },
          alternateUrls: navUrlsWithDir, // Navigation URL with dir
          seoUrls: cleanUrls,            // Clean SEO URL
          siteUrl,
        },
      } as unknown as Parameters<typeof portfolioMeta>[0]) || []) as MetaDescriptor[];

      const title = meta.find((m) => "title" in m)?.title;
      const desc = meta.find((m) => m.name === "description")?.content;
      const canonical = meta.find((m) => m.rel === "canonical")?.href;
      const altFr = meta.find((m) => m.rel === "alternate" && m.hrefLang === "fr")?.href;
      const altEn = meta.find((m) => m.rel === "alternate" && m.hrefLang === "en")?.href;
      const ogUrl = meta.find((m) => m.property === "og:url")?.content;

      // Exact values matching audit findings
      expect(title).toBe("Barat - Photographie & Vidéo | Parallax");
      expect(desc).toBe(
        "Découvrez notre production photo et vidéo pour Barat Boulangerie - Fromagerie, réalisée pour valoriser ses produits sur le web et les réseaux sociaux."
      );
      expect(canonical).toBe("http://127.0.0.1:3000/fr/projets/publicite/boulangerie-barat");
      expect(altFr).toBe("http://127.0.0.1:3000/fr/projets/publicite/boulangerie-barat");
      expect(altEn).toBe("http://127.0.0.1:3000/en/projects/advertising/bakery-barat");
      expect(ogUrl).toBe("http://127.0.0.1:3000/fr/projets/publicite/boulangerie-barat");

      // Verify absence of ?dir= anywhere in SEO metadata
      expect(canonical).not.toContain("?dir=");
      expect(altFr).not.toContain("?dir=");
      expect(altEn).not.toContain("?dir=");
      expect(ogUrl).not.toContain("?dir=");
    });

    it("renders distinct custom SEO for Barat Project EN and handles trailing slash cleanly", () => {
      const cleanUrls = getPortfolioAlternateUrls(baratProjectFixture, "advertising", null, categoriesFixture);

      const meta = (portfolioMeta({
        loaderData: {
          lang: "en",
          common: {} as unknown,
          content: {
            overview: { title: { fr: "P", en: "P" }, intro: { fr: "I", en: "I" }, seo: { title: { fr: "", en: "" }, description: { fr: "", en: "" } } },
            categories: categoriesFixture,
          } as unknown,
          showcaseProjects: [],
          panelState: {
            isOpen: true,
            activeCategory: "advertising",
            activeProject: baratProjectFixture,
            direction: "right",
          },
          // Simulate alternate URLs with trailing slash and query params to verify sanitation
          alternateUrls: {
            fr: `${cleanUrls.fr}/?dir=right`,
            en: `${cleanUrls.en}/?dir=right`,
          },
          seoUrls: {
            fr: `${cleanUrls.fr}/`,
            en: `${cleanUrls.en}/`,
          },
          siteUrl,
        },
      } as unknown as Parameters<typeof portfolioMeta>[0]) || []) as MetaDescriptor[];

      expect(meta.find((m) => "title" in m)?.title).toBe("Barat - Photography & Video | Parallax");
      expect(meta.find((m) => m.name === "description")?.content).toBe(
        "Discover our photo and video production for Barat Bakery - Fromagerie, created to showcase products across web and social channels."
      );
      // Clean canonical without trailing slash and without ?dir=
      expect(meta.find((m) => m.rel === "canonical")?.href).toBe(
        "http://127.0.0.1:3000/en/projects/advertising/bakery-barat"
      );
      expect(meta.find((m) => m.property === "og:locale")?.content).toBe("en_US");
      expect(meta.find((m) => m.property === "og:locale:alternate")?.content).toBe("fr_FR");
    });

    // ------------------------------------------------------------------------
    // Legal Pages: Published, Unpublished (Draft), and Fallback Handling
    // ------------------------------------------------------------------------
    it("renders index, follow and complete metadata for published Legal Pages", () => {
      const meta = (legalMeta({
        loaderData: {
          lang: "fr",
          pageKey: "mentions",
          alternateUrls: { fr: "/fr/mentions-legales", en: "/en/legal-notice" },
          siteUrl,
          common: {} as unknown,
          company: {},
          initialPreferences: { youtube: false, vimeo: false },
          document: {
            seoTitle: { fr: "Mentions légales | Parallax", en: "Legal Notice | Parallax" },
            seoDescription: { fr: "Mentions FR", en: "Legal EN" },
          } as unknown,
        },
      } as unknown as Parameters<typeof legalMeta>[0]) || []) as MetaDescriptor[];

      const titleEntry = meta.find((m) => "title" in m) as { title: string } | undefined;
      expect(titleEntry?.title).toBe("Mentions légales | Parallax");

      const robots = meta.find((m) => m.name === "robots");
      expect(robots?.content).toBe("index, follow");

      const canonicalEntry = meta.find((m) => m.rel === "canonical") as { href: string } | undefined;
      expect(canonicalEntry?.href).toBe("http://127.0.0.1:3000/fr/mentions-legales");
      expect(meta.find((m) => m.property === "og:type")?.content).toBe("article");
      expect(meta.find((m) => m.name === "twitter:card")?.content).toBe("summary");
    });

    it("renders noindex, nofollow for unpublished legal document (document: null)", () => {
      const meta = (legalMeta({
        loaderData: {
          lang: "fr",
          pageKey: "terms",
          alternateUrls: { fr: "/fr/cgv", en: "/en/terms" },
          siteUrl,
          common: {} as unknown,
          company: {},
          initialPreferences: { youtube: false, vimeo: false },
          document: null,
        },
      } as unknown as Parameters<typeof legalMeta>[0]) || []) as MetaDescriptor[];

      const titleEntry = meta.find((m) => "title" in m);
      expect(titleEntry?.title).toBe("Document en préparation | Parallax");

      const robots = meta.find((m) => m.name === "robots");
      expect(robots?.content).toBe("noindex, nofollow");
    });

    it("renders safe noindex, nofollow fallback when legal loaderData is undefined", () => {
      const meta = (legalMeta({
        loaderData: undefined,
      } as unknown as Parameters<typeof legalMeta>[0]) || []) as MetaDescriptor[];

      const titleEntry = meta.find((m) => "title" in m);
      expect(titleEntry?.title).toBe("Parallax");

      const robots = meta.find((m) => m.name === "robots");
      expect(robots?.content).toBe("noindex, nofollow");
    });

    // ------------------------------------------------------------------------
    // Private Areas: Client Login and Client Gallery
    // ------------------------------------------------------------------------
    it("renders noindex, nofollow for Client Login FR and EN with localized titles", () => {
      const metaFr = (clientLoginMeta({
        loaderData: { lang: "fr", csrfToken: "t", statusMessage: null, common: {} as unknown },
      } as unknown as Parameters<typeof clientLoginMeta>[0]) || []) as MetaDescriptor[];

      expect(metaFr.find((m) => "title" in m)?.title).toBe("Espace client | Parallax");
      expect(metaFr.find((m) => m.name === "robots")?.content).toBe("noindex, nofollow");

      const metaEn = (clientLoginMeta({
        loaderData: { lang: "en", csrfToken: "t", statusMessage: null, common: {} as unknown },
      } as unknown as Parameters<typeof clientLoginMeta>[0]) || []) as MetaDescriptor[];

      expect(metaEn.find((m) => "title" in m)?.title).toBe("Client Area | Parallax");
      expect(metaEn.find((m) => m.name === "robots")?.content).toBe("noindex, nofollow");
    });

    it("renders noindex, nofollow for Client Gallery with gallery client details", () => {
      const meta = (galleryMeta({
        loaderData: {
          lang: "fr",
          gallery: { id: "g1", title: "Mariage Alice & Bob", clientName: "Alice & Bob" },
        } as unknown,
      } as unknown as Parameters<typeof galleryMeta>[0]) || []) as MetaDescriptor[];

      expect(meta.find((m) => "title" in m)?.title).toBe("Mariage Alice & Bob | Parallax");
      expect(meta.find((m) => m.name === "description")?.content).toContain("Alice & Bob");
      expect(meta.find((m) => m.name === "robots")?.content).toBe("noindex, nofollow");
    });

    // ------------------------------------------------------------------------
    // Explicit Regression Test: RR8 loaderData contract vs legacy data parameter
    // ------------------------------------------------------------------------
    it("regression: produces full metadata when called with only loaderData and falls back if data is passed instead", () => {
      // 1. homeMeta: called with ONLY loaderData (RR8 contract) -> returns full title and tags
      const rr8Meta = (homeMeta({
        loaderData: {
          lang: "fr",
          common: { brandName: "Parallax" },
          home: { seo: { title: { fr: "Titre Réel" }, description: { fr: "Desc Réelle" } } },
          siteUrl,
        },
      } as unknown as Parameters<typeof homeMeta>[0]) || []) as MetaDescriptor[];
      expect(rr8Meta.find((m) => "title" in m)?.title).toBe("Titre Réel");
      expect(rr8Meta.find((m) => m.name === "description")?.content).toBe("Desc Réelle");

      // 2. homeMeta: called with legacy data (RR6/7 contract without loaderData) -> takes fallback
      const legacyMeta = (homeMeta({
        data: {
          lang: "fr",
          home: { seo: { title: { fr: "Ancien Titre" }, description: { fr: "Ancienne Desc" } } },
          siteUrl,
        },
      } as unknown as Parameters<typeof homeMeta>[0]) || []) as MetaDescriptor[];
      expect(legacyMeta.find((m) => "title" in m)?.title).toBe("Parallax");
      expect(legacyMeta.find((m) => m.name === "description")).toBeUndefined();
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

  describe("5. SSR HTML Integration with real Router contract", () => {
    it("renders full SSR metadata in HTML (title, description, canonical, hreflang, robots) via server handler", async () => {
      const serverBuildPath = path.resolve(__dirname, "../build/server/index.js");
      if (!fs.existsSync(serverBuildPath)) {
        return;
      }
      const { createRequestHandler } = await import("react-router");
      const build = await import(serverBuildPath);
      const handler = createRequestHandler(build, "production");

      // A. Home FR
      const homeReq = new Request("http://127.0.0.1:3000/fr");
      const homeRes = await handler(homeReq);
      expect(homeRes.status).toBe(200);
      const homeHtml = await homeRes.text();

      // Must have actual title and not bare fallback "Parallax"
      expect(homeHtml).toMatch(/<title>[^<]+<\/title>/);
      expect(homeHtml).not.toContain("<title>Parallax</title>");
      expect(homeHtml).toContain('<meta name="description"');
      expect(homeHtml).toContain('<link rel="canonical" href="http://127.0.0.1:3000/fr"');
      expect(homeHtml).toMatch(/<link\s+rel="alternate"\s+(?:hreflang|hrefLang)="fr"\s+href="http:\/\/127\.0\.0\.1:3000\/fr"/i);
      expect(homeHtml).toMatch(/<link\s+rel="alternate"\s+(?:hreflang|hrefLang)="en"\s+href="http:\/\/127\.0\.0\.1:3000\/en"/i);
      expect(homeHtml).toMatch(/<link\s+rel="alternate"\s+(?:hreflang|hrefLang)="x-default"\s+href="http:\/\/127\.0\.0\.1:3000\/fr"/i);
      expect(homeHtml).toContain('<meta name="robots" content="index, follow"');

      // B. Published Legal Document (mentions légales)
      const legalReq = new Request("http://127.0.0.1:3000/fr/mentions-legales");
      const legalRes = await handler(legalReq);
      expect(legalRes.status).toBe(200);
      const legalHtml = await legalRes.text();
      expect(legalHtml).toContain('<meta name="robots" content="index, follow"');
      expect(legalHtml).not.toContain('<meta name="robots" content="noindex, nofollow"');
      expect(legalHtml).toContain('<link rel="canonical" href="http://127.0.0.1:3000/fr/mentions-legales"');

      // C. Private Client Area
      const loginReq = new Request("http://127.0.0.1:3000/fr/espace-client");
      const loginRes = await handler(loginReq);
      expect(loginRes.status).toBe(200);
      const loginHtml = await loginRes.text();
      expect(loginHtml).toContain('<meta name="robots" content="noindex, nofollow"');
      expect(loginHtml).toContain("<title>Espace client | Parallax</title>");

      // D. Portfolio URL with ?dir= query param: canonical and alternates must NOT have ?dir=
      const { publicCategories, publicProjects } = getPublicPortfolioContent();
      if (publicProjects.length > 0) {
        const proj = publicProjects[0];
        const cat = publicCategories.find((c) => c.id === proj.category);
        if (cat) {
          const projReq = new Request(`http://127.0.0.1:3000/fr/projets/${cat.slugFr}/${proj.slugFr}?dir=right`);
          const projRes = await handler(projReq);
          expect(projRes.status).toBe(200);
          const projHtml = await projRes.text();

          // Title & Description present
          expect(projHtml).toContain('<meta name="description"');

          // Clean canonical without ?dir=
          const canonMatch = projHtml.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i);
          expect(canonMatch).toBeTruthy();
          expect(canonMatch![1]).not.toContain("?dir=");
          expect(canonMatch![1]).toBe(`http://127.0.0.1:3000/fr/projets/${cat.slugFr}/${proj.slugFr}`);

          // Clean og:url without ?dir=
          const ogUrlMatch = projHtml.match(/<meta\s+property="og:url"\s+content="([^"]*)"/i);
          expect(ogUrlMatch).toBeTruthy();
          expect(ogUrlMatch![1]).not.toContain("?dir=");
          expect(ogUrlMatch![1]).toBe(`http://127.0.0.1:3000/fr/projets/${cat.slugFr}/${proj.slugFr}`);
        }
      }
    });
  });
});
