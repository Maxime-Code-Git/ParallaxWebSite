import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { LoaderFunctionArgs } from "react-router";
import {
  getPortfolioOverviewUrl,
  getPortfolioSectionUrl,
  getPortfolioProjectUrl,
  getPortfolioAlternateUrls,
} from "../app/lib/localized-urls";
import { parseVideoUrl } from "../app/lib/video";
import {
  type PortfolioProject,
  calculateEffectiveSide,
} from "../app/lib/portfolio-content.shared";
import { loader as publicPortfolioLoader, meta as publicPortfolioMeta } from "../app/routes/public/portfolio";

describe("Portfolio Localized Routing & Directional Panels (Lot 3)", () => {
  let tempDir: string;
  let testPortfolioContent: string;
  let testSiteContent: string;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-portfolio-routes-test-"));
    testPortfolioContent = path.join(tempDir, "portfolio-content.json");
    testSiteContent = path.join(tempDir, "site-content.json");
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PORTFOLIO_CONTENT_PATH: testPortfolioContent,
      SITE_CONTENT_PATH: testSiteContent,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  const dummyProject: PortfolioProject = {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    category: "documentary",
    slugFr: "forets-vivantes",
    slugEn: "living-forests",
    title: { fr: "Forêts Vivantes", en: "Living Forests" },
    summary: { fr: "Court métrage", en: "Short film" },
    description: [{ type: "paragraph", text: { fr: "Doc", en: "Doc" } }],
    seo: { title: { fr: "SEO Forêts Titre", en: "SEO Living Forests Title" }, description: { fr: "SEO Desc FR", en: "SEO Desc EN" } },
    coverImageId: "cov-1",
    coverAlt: { fr: "Alt", en: "Alt" },
    galleryImageIds: [],
    video: null,
    showcase: true,
    side: "auto",
    order: 0,
    status: "published",
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const adProject: PortfolioProject = {
    ...dummyProject,
    id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    category: "advertising",
    slugFr: "campagne-luxe",
    slugEn: "luxury-campaign",
    seo: { title: { fr: "SEO Pub Titre", en: "SEO Ad Title" }, description: { fr: "SEO Pub Desc", en: "SEO Ad Desc" } },
  };

  const makeLoaderArgs = (req: Request, params: Record<string, string> = {}): LoaderFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as LoaderFunctionArgs;

  describe("Directional Panel Rule & Production Loader Behavior", () => {
    it("determines panel direction from the trigger side using app calculation", () => {
      // Automatic side alternating
      const side0 = calculateEffectiveSide("auto", 0); // "left"
      const side1 = calculateEffectiveSide("auto", 1); // "right"
      const side2 = calculateEffectiveSide("auto", 2); // "left"

      // Trigger rule: panel opens from opposite side of the image
      const direction0 = side0 === "left" ? "right" : "left";
      const direction1 = side1 === "left" ? "right" : "left";
      const direction2 = side2 === "left" ? "right" : "left";

      expect(direction0).toBe("right");
      expect(direction1).toBe("left");
      expect(direction2).toBe("right");
    });

    it("loader preserves direction passed via ?dir= query parameter", async () => {
      // Documentary with ?dir=left
      const reqLeft = new Request("http://localhost:3000/fr/projets/documentaire?dir=left");
      const resLeft = await publicPortfolioLoader(makeLoaderArgs(reqLeft));
      const dataLeft = (await resLeft.json()) as { panelState: { direction: string } };
      expect(dataLeft.panelState.direction).toBe("left");

      // Advertising with ?dir=right
      const reqRight = new Request("http://localhost:3000/en/projects/advertising?dir=right");
      const resRight = await publicPortfolioLoader(makeLoaderArgs(reqRight));
      const dataRight = (await resRight.json()) as { panelState: { direction: string } };
      expect(dataRight.panelState.direction).toBe("right");
    });

    it("strictly enforces localized category allowlist (throws 404 for unknown or incoherent category)", async () => {
      // Unknown category in FR
      const reqUnknown = new Request("http://localhost:3000/fr/projets/nimportequoi/slug-test");
      await expect(
        publicPortfolioLoader(makeLoaderArgs(reqUnknown, { rubrique: "nimportequoi", slugFr: "slug-test" }))
      ).rejects.toSatisfy((res: Response) => res.status === 404);

      // Incoherent language: English category in French route
      const reqIncoherent = new Request("http://localhost:3000/fr/projets/advertising/slug-test");
      await expect(
        publicPortfolioLoader(makeLoaderArgs(reqIncoherent, { rubrique: "advertising", slugFr: "slug-test" }))
      ).rejects.toSatisfy((res: Response) => res.status === 404);

      // Unknown section URL directly
      const reqUnknownSec = new Request("http://localhost:3000/fr/projets/inconnue");
      const resUnknownSec = await publicPortfolioLoader(makeLoaderArgs(reqUnknownSec));
      const dataUnknownSec = (await resUnknownSec.json()) as { panelState: { isOpen: boolean } };
      // Not a recognized section, so panel stays closed (overview)
      expect(dataUnknownSec.panelState.isOpen).toBe(false);
    });
  });

  describe("Real SEO Field Integration in meta Function", () => {
    it("binds meta title and description to project.seo fields when project is active", () => {
      const mockData = {
        lang: "fr" as const,
        siteUrl: "https://parallax.test",
        alternateUrls: { fr: "/fr/projets/documentaire/forets-vivantes", en: "/en/projects/documentary/living-forests" },
        content: {
          schemaVersion: 1 as const,
          revision: "r1",
          updatedAt: "",
          overview: {
            title: { fr: "Portfolio", en: "Portfolio" },
            intro: { fr: "Intro", en: "Intro" },
            seo: { title: { fr: "Overview SEO", en: "Overview SEO" }, description: { fr: "Overview Desc", en: "Overview Desc" } },
            seeMoreButton: { fr: "Voir", en: "See" },
          },
          sections: {
            documentary: {
              category: "documentary" as const,
              title: { fr: "Doc", en: "Doc" },
              intro: { fr: "Intro", en: "Intro" },
              seo: { title: { fr: "Section SEO", en: "Section SEO" }, description: { fr: "Section Desc", en: "Section Desc" } },
              coverImageId: null,
              coverAlt: { fr: "Alt", en: "Alt" },
              showreelTitle: { fr: "Showreel", en: "Showreel" },
              showreelVideo: null,
              showreelCoverImageId: null,
              morePhotosButton: { fr: "Plus", en: "More" },
              lessPhotosButton: { fr: "Moins", en: "Less" },
              backButton: { fr: "Retour", en: "Back" },
            },
            advertising: {
              category: "advertising" as const,
              title: { fr: "Pub", en: "Ad" },
              intro: { fr: "Intro", en: "Intro" },
              seo: { title: { fr: "Pub SEO", en: "Ad SEO" }, description: { fr: "Pub Desc", en: "Ad Desc" } },
              coverImageId: null,
              coverAlt: { fr: "Alt", en: "Alt" },
              showreelTitle: { fr: "Showreel", en: "Showreel" },
              showreelVideo: null,
              showreelCoverImageId: null,
              morePhotosButton: { fr: "Plus", en: "More" },
              lessPhotosButton: { fr: "Moins", en: "Less" },
              backButton: { fr: "Retour", en: "Back" },
            },
          },
          projects: [dummyProject],
          media: {},
        },
        panelState: {
          isOpen: true,
          activeCategory: "documentary" as const,
          activeProject: dummyProject,
          direction: "right" as const,
        },
      };

      const metaTags = publicPortfolioMeta({ data: mockData } as never);
      const titleTag = metaTags.find((t) => "title" in t) as { title?: string } | undefined;
      const descTag = metaTags.find((t) => "name" in t && t.name === "description") as { content?: string } | undefined;

      expect(titleTag?.title).toBe("SEO Forêts Titre");
      expect(descTag?.content).toBe("SEO Desc FR");
    });

    it("binds meta title and description to section.seo fields when section is active", () => {
      const mockData = {
        lang: "en" as const,
        siteUrl: "https://parallax.test",
        alternateUrls: { fr: "/fr/projets/documentaire", en: "/en/projects/documentary" },
        content: {
          schemaVersion: 1 as const,
          revision: "r1",
          updatedAt: "",
          overview: {
            title: { fr: "Portfolio", en: "Portfolio" },
            intro: { fr: "Intro", en: "Intro" },
            seo: { title: { fr: "Overview SEO", en: "Overview SEO" }, description: { fr: "Overview Desc", en: "Overview Desc" } },
            seeMoreButton: { fr: "Voir", en: "See" },
          },
          sections: {
            documentary: {
              category: "documentary" as const,
              title: { fr: "Doc", en: "Doc" },
              intro: { fr: "Intro", en: "Intro" },
              seo: { title: { fr: "Section Doc SEO FR", en: "Section Doc SEO EN" }, description: { fr: "Desc FR", en: "Desc EN" } },
              coverImageId: null,
              coverAlt: { fr: "Alt", en: "Alt" },
              showreelTitle: { fr: "Showreel", en: "Showreel" },
              showreelVideo: null,
              showreelCoverImageId: null,
              morePhotosButton: { fr: "Plus", en: "More" },
              lessPhotosButton: { fr: "Moins", en: "Less" },
              backButton: { fr: "Retour", en: "Back" },
            },
            advertising: {
              category: "advertising" as const,
              title: { fr: "Pub", en: "Ad" },
              intro: { fr: "Intro", en: "Intro" },
              seo: { title: { fr: "Pub SEO", en: "Ad SEO" }, description: { fr: "Pub Desc", en: "Ad Desc" } },
              coverImageId: null,
              coverAlt: { fr: "Alt", en: "Alt" },
              showreelTitle: { fr: "Showreel", en: "Showreel" },
              showreelVideo: null,
              showreelCoverImageId: null,
              morePhotosButton: { fr: "Plus", en: "More" },
              lessPhotosButton: { fr: "Moins", en: "Less" },
              backButton: { fr: "Retour", en: "Back" },
            },
          },
          projects: [],
          media: {},
        },
        panelState: {
          isOpen: true,
          activeCategory: "documentary" as const,
          activeProject: null,
          direction: "right" as const,
        },
      };

      const metaTags = publicPortfolioMeta({ data: mockData } as never);
      const titleTag = metaTags.find((t) => "title" in t) as { title?: string } | undefined;
      const descTag = metaTags.find((t) => "name" in t && t.name === "description") as { content?: string } | undefined;

      expect(titleTag?.title).toBe("Section Doc SEO EN");
      expect(descTag?.content).toBe("Desc EN");
    });
  });

  describe("Localized URLs & Alternate Links", () => {
    it("generates correct overview URLs for FR and EN", () => {
      expect(getPortfolioOverviewUrl("fr")).toBe("/fr/projets");
      expect(getPortfolioOverviewUrl("en")).toBe("/en/projects");
    });

    it("generates correct section URLs for Documentary and Advertising", () => {
      expect(getPortfolioSectionUrl("documentary", "fr")).toBe("/fr/projets/documentaire");
      expect(getPortfolioSectionUrl("documentary", "en")).toBe("/en/projects/documentary");
      expect(getPortfolioSectionUrl("advertising", "fr")).toBe("/fr/projets/publicite");
      expect(getPortfolioSectionUrl("advertising", "en")).toBe("/en/projects/advertising");
    });

    it("generates correct project URLs preserving localized slugs and category", () => {
      expect(getPortfolioProjectUrl(dummyProject, "fr")).toBe(
        "/fr/projets/documentaire/forets-vivantes"
      );
      expect(getPortfolioProjectUrl(dummyProject, "en")).toBe(
        "/en/projects/documentary/living-forests"
      );
      expect(getPortfolioProjectUrl(adProject, "fr")).toBe(
        "/fr/projets/publicite/campagne-luxe"
      );
      expect(getPortfolioProjectUrl(adProject, "en")).toBe(
        "/en/projects/advertising/luxury-campaign"
      );
    });

    it("produces synchronized alternateUrls for language switching", () => {
      // Project level switch
      const projectAlts = getPortfolioAlternateUrls(dummyProject, null);
      expect(projectAlts.fr).toBe("/fr/projets/documentaire/forets-vivantes");
      expect(projectAlts.en).toBe("/en/projects/documentary/living-forests");

      // Section level switch
      const sectionAlts = getPortfolioAlternateUrls(null, "advertising");
      expect(sectionAlts.fr).toBe("/fr/projets/publicite");
      expect(sectionAlts.en).toBe("/en/projects/advertising");

      // Overview level switch
      const overviewAlts = getPortfolioAlternateUrls(null, null);
      expect(overviewAlts.fr).toBe("/fr/projets");
      expect(overviewAlts.en).toBe("/en/projects");
    });
  });

  describe("Video Parser Strictness", () => {
    it("extracts clean YouTube embed and canonical links", () => {
      const parsed = parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(parsed).not.toBeNull();
      expect(parsed?.provider).toBe("youtube");
      expect(parsed?.videoId).toBe("dQw4w9WgXcQ");
    });

    it("extracts clean Vimeo embed and canonical links", () => {
      const parsed = parseVideoUrl("https://vimeo.com/123456789");
      expect(parsed).not.toBeNull();
      expect(parsed?.provider).toBe("vimeo");
      expect(parsed?.videoId).toBe("123456789");
    });

    it("rejects insecure or arbitrary URLs", () => {
      expect(parseVideoUrl("http://youtube.com/watch?v=123")).toBeNull();
      expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
      expect(parseVideoUrl("https://evil.com/video.mp4")).toBeNull();
      expect(parseVideoUrl("<iframe src='...'></iframe>")).toBeNull();
    });
  });
});
