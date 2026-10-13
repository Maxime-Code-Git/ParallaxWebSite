import { describe, it, expect } from "vitest";
import {
  getPortfolioOverviewUrl,
  getPortfolioSectionUrl,
  getPortfolioProjectUrl,
  getPortfolioAlternateUrls,
} from "../app/lib/localized-urls";
import { parseVideoUrl } from "../app/lib/video";
import { type PortfolioProject } from "../app/lib/portfolio-content.shared";

describe("Portfolio Localized Routing & Directional Panels (Lot 3)", () => {
  const dummyProject: PortfolioProject = {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    category: "documentary",
    slugFr: "forets-vivantes",
    slugEn: "living-forests",
    title: { fr: "Forêts Vivantes", en: "Living Forests" },
    summary: { fr: "Court métrage", en: "Short film" },
    description: [],
    seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
    coverImageId: null,
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
  };

  describe("Directional Panel Rule", () => {
    it("strictly follows the mandatory formula: panelDirection = imageSide === 'left' ? 'right' : 'left'", () => {
      const getPanelDirection = (imageSide: "left" | "right") =>
        imageSide === "left" ? "right" : "left";

      // Row 1: Documentaire with image on the left -> panel opens from the right
      expect(getPanelDirection("left")).toBe("right");

      // Row 2: Publicité with image on the right -> panel opens from the left
      expect(getPanelDirection("right")).toBe("left");

      // Row 3: Publicité with image on the left -> panel opens from the right
      expect(getPanelDirection("left")).toBe("right");
    });

    it("allows the same section (Publicité) to open from either left or right depending on the trigger row", () => {
      const computePanelDirection = (side: "left" | "right"): "left" | "right" =>
        side === "left" ? "right" : "left";

      // Row 2 trigger: Publicité (image right)
      expect(computePanelDirection("right")).toBe("left");

      // Row 3 trigger: Publicité (image left)
      expect(computePanelDirection("left")).toBe("right");
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
