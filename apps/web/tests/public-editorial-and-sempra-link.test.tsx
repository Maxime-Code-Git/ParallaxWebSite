// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    Link: ({ children, to, onClick, ...props }: { children: React.ReactNode; to: string; onClick?: () => void; [key: string]: unknown }) => (
      <a href={to} onClick={onClick} {...props}>{children}</a>
    ),
  };
});

import { Header } from "../app/components/public/Header";
import {
  cleanHeroSubtitle,
  cleanStudioName,
  validateSiteContentDocument,
  type CommonContent,
  type SiteContent,
} from "@parallax/shared";
import defaultSiteContent from "../app/content/default-site-content.json";
import { remediateSiteContentEditorial } from "../../../scripts/remediate-editorial-content.js";

const mockCommon: CommonContent = {
  brandName: "Parallax",
  navigation: {
    portfolio: { fr: "Projets", en: "Projects" },
    studio: { fr: "Le studio", en: "The studio" },
    contact: { fr: "Contact", en: "Contact" },
    sempra: { fr: "SEMPRA", en: "SEMPRA" },
    clientArea: { fr: "Espace client", en: "Client area" },
  },
  footer: {
    copyright: { fr: "© 2026 Studio LM - Parallax", en: "© 2026 Studio LM - Parallax" },
    legalNotice: { fr: "Mentions légales", en: "Legal notice" },
    privacy: { fr: "Politique de confidentialité", en: "Privacy policy" },
    terms: { fr: "CGV", en: "Terms" },
    cookies: { fr: "Cookies", en: "Cookies" },
  },
};

describe("1. Header SEMPRA Link (Mission 2)", () => {
  afterEach(() => {
    cleanup();
  });

  const routes: Array<"home" | "studio" | "portfolio" | "contact" | "client-area" | "gallery" | "legal"> = [
    "home",
    "studio",
    "portfolio",
    "contact",
    "client-area",
    "gallery",
    "legal",
  ];

  for (const route of routes) {
    it(`renders desktop SEMPRA link pointing to https://sempra.be/ in same tab on route "${route}" (FR)`, () => {
      const { container } = render(
        <Header common={mockCommon} lang="fr" currentRoute={route} />
      );

      const desktopLinks = Array.from(container.querySelectorAll("a")).filter(
        (a) => a.textContent?.trim() === "SEMPRA"
      );
      expect(desktopLinks.length).toBeGreaterThanOrEqual(1);

      const sempraLink = desktopLinks[0];
      expect(sempraLink.getAttribute("href")).toBe("https://sempra.be/");
      // Must open in same tab: no target="_blank"
      expect(sempraLink.getAttribute("target")).toBeNull();
    });

    it(`renders desktop SEMPRA link pointing to https://sempra.be/ in same tab on route "${route}" (EN)`, () => {
      const { container } = render(
        <Header common={mockCommon} lang="en" currentRoute={route} />
      );

      const desktopLinks = Array.from(container.querySelectorAll("a")).filter(
        (a) => a.textContent?.trim() === "SEMPRA"
      );
      expect(desktopLinks.length).toBeGreaterThanOrEqual(1);

      const sempraLink = desktopLinks[0];
      expect(sempraLink.getAttribute("href")).toBe("https://sempra.be/");
      expect(sempraLink.getAttribute("target")).toBeNull();
    });
  }

  it("renders mobile SEMPRA link pointing to https://sempra.be/ and closes mobile menu on click", () => {
    render(<Header common={mockCommon} lang="fr" currentRoute="home" />);

    // Open mobile menu by clicking burger button
    const burgerButton = screen.getByLabelText("Ouvrir le menu");
    fireEvent.click(burgerButton);

    // Burger button is now toggled to close
    expect(screen.getByLabelText("Fermer le menu")).toBeDefined();

    // Mobile SEMPRA link is rendered
    const sempraLinks = screen.getAllByText("SEMPRA");
    expect(sempraLinks.length).toBe(2); // desktop + mobile

    const mobileSempraLink = sempraLinks[1];
    expect(mobileSempraLink.getAttribute("href")).toBe("https://sempra.be/");
    expect(mobileSempraLink.getAttribute("target")).toBeNull();

    // Clicking the mobile SEMPRA link closes the menu
    fireEvent.click(mobileSempraLink);
    expect(screen.getByLabelText("Ouvrir le menu")).toBeDefined();
    expect(screen.queryByLabelText("Fermer le menu")).toBeNull();
  });
});

describe("2. Editorial Cleaners (Mission 1 & Mission 3)", () => {
  describe("cleanHeroSubtitle", () => {
    it("removes '- Test Verifie Lot 2' and leading separator in FR", () => {
      const input = "Studio de creation visuelle base en Belgique - Test Verifie Lot 2";
      expect(cleanHeroSubtitle(input)).toBe("Studio de creation visuelle base en Belgique");
    });

    it("removes accented variant '- Test Vérifié Lot 2' and preserves accents in user text", () => {
      const input = "Studio de création visuelle basé en Belgique - Test Vérifié Lot 2";
      expect(cleanHeroSubtitle(input)).toBe("Studio de création visuelle basé en Belgique");
    });

    it("removes English variant '- Lot 2 Verified Test' and leading separator", () => {
      const input = "Visual creation studio based in Belgium - Lot 2 Verified Test";
      expect(cleanHeroSubtitle(input)).toBe("Visual creation studio based in Belgium");
    });

    it("removes em-dash and en-dash separators with test text", () => {
      const input1 = "Clips · Publicité · Portraits · Documentaire — Test Vérifié Lot 2";
      expect(cleanHeroSubtitle(input1)).toBe("Clips · Publicité · Portraits · Documentaire");

      const input2 = "Clips · Publicité · Portraits · Documentaire – Test Verifie Lot 2";
      expect(cleanHeroSubtitle(input2)).toBe("Clips · Publicité · Portraits · Documentaire");
    });

    it("preserves authentic subtitles that do not contain test text", () => {
      const input = "Clips · Publicité · Portraits · Documentaire";
      expect(cleanHeroSubtitle(input)).toBe("Clips · Publicité · Portraits · Documentaire");
    });

    it("handles empty or falsy inputs gracefully", () => {
      expect(cleanHeroSubtitle("")).toBe("");
      expect(cleanHeroSubtitle(null as unknown as string)).toBe("");
      expect(cleanHeroSubtitle(undefined as unknown as string)).toBe("");
    });
  });

  describe("cleanStudioName", () => {
    it("normalizes 'LS studio' to 'Studio LM'", () => {
      expect(cleanStudioName("© 2026 LS studio - Parallax")).toBe("© 2026 Studio LM - Parallax");
      expect(cleanStudioName("L'autre studio de LS studio")).toBe("L'autre studio de Studio LM");
      expect(cleanStudioName("The other LS studio brand")).toBe("The other Studio LM brand");
    });

    it("handles casing variants 'LS Studio', 'ls studio', 'LS STUDIO'", () => {
      expect(cleanStudioName("pôle création de LS Studio")).toBe("pôle création de Studio LM");
      expect(cleanStudioName("pôle création de ls studio")).toBe("pôle création de Studio LM");
      expect(cleanStudioName("pôle création de LS STUDIO")).toBe("pôle création de Studio LM");
    });

    it("preserves 'Parallax' and other proper names without modification", () => {
      expect(cleanStudioName("Parallax est le pôle de Studio LM")).toBe("Parallax est le pôle de Studio LM");
      expect(cleanStudioName("Maxime & Ludovic")).toBe("Maxime & Ludovic");
    });

    it("handles empty or falsy inputs gracefully", () => {
      expect(cleanStudioName("")).toBe("");
      expect(cleanStudioName(null as unknown as string)).toBe("");
      expect(cleanStudioName(undefined as unknown as string)).toBe("");
    });
  });

  describe("default-site-content.json checks", () => {
    it("has Studio LM in footer copyright, sempra badge, and studio hero text", () => {
      expect(defaultSiteContent.common.footer.copyright.fr).toBe("© 2026 Studio LM - Parallax");
      expect(defaultSiteContent.common.footer.copyright.en).toBe("© 2026 Studio LM - Parallax");
      expect(defaultSiteContent.home.sempra.badge.fr).toBe("L'autre studio de Studio LM");
      expect(defaultSiteContent.home.sempra.badge.en).toBe("The other Studio LM brand");
      expect(defaultSiteContent.studio.hero.text.fr).toContain("Studio LM");
      expect(defaultSiteContent.studio.hero.text.en).toContain("Studio LM");
    });

    it("contains zero occurrences of 'LS studio' across the entire default content", () => {
      const jsonStr = JSON.stringify(defaultSiteContent);
      expect(jsonStr).not.toMatch(/\bLS\s+studio\b/i);
    });
  });
});

describe("3. Remediation Tool for Persistent Data (Mission 4)", () => {
  let tempDir: string;
  let testContentFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-remediation-test-"));
    testContentFile = path.join(tempDir, "site-content.json");

    // Create a realistic content document mirroring production persistent state
    const fixture: SiteContent = structuredClone(defaultSiteContent as unknown as SiteContent);
    fixture.revision = "0123456789abcdef0123456789abcdef";
    fixture.updatedAt = "2026-10-24T12:00:00.000Z";

    // Inject the production test subtitle
    fixture.home.hero.subtitle = {
      fr: "Studio de creation visuelle base en Belgique - Test Verifie Lot 2",
      en: "Visual creation studio based in Belgium - Lot 2 Verified Test",
    };

    // Inject the production LS studio occurrences
    fixture.common.footer.copyright = {
      fr: "© 2026 LS studio - Parallax",
      en: "© 2026 LS studio - Parallax",
    };
    fixture.home.sempra.badge = {
      fr: "L'autre studio de LS studio",
      en: "The other LS studio brand",
    };
    fixture.studio.hero.text = {
      fr: "Parallax est le pôle création d'images de LS studio, basé en Belgique. Nous concevons et réalisons photo et vidéo...",
      en: "Parallax is the image-making arm of LS studio, based in Belgium. We design and produce photo and video...",
    };

    // Add company legal info that MUST be preserved
    fixture.company = {
      ...fixture.company,
      legalName: "Association de fait",
      legalForm: "Association de fait",
      enterpriseNumber: "1044.156.597",
      vatNumber: "BE1044.156.597",
      publicationDirector: "Maxime Schneider",
      address: "Chaussée d’Alsemberg 721, 1180 Uccle, Belgique",
    };

    fs.writeFileSync(testContentFile, JSON.stringify(fixture, null, 2), "utf-8");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it("performs simulation (--dry-run) without writing to disk or creating backups", () => {
    const rawBefore = fs.readFileSync(testContentFile, "utf-8");
    const hashBefore = crypto.createHash("sha256").update(rawBefore).digest("hex");

    const result = remediateSiteContentEditorial({

      targetPath: testContentFile,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.modifiedFields).toEqual([
      "home.hero.subtitle.fr",
      "home.hero.subtitle.en",
      "common.footer.copyright.fr",
      "common.footer.copyright.en",
      "home.sempra.badge.fr",
      "home.sempra.badge.en",
      "studio.hero.text.fr",
      "studio.hero.text.en",
    ]);

    // Check no backup was created
    const dirFiles = fs.readdirSync(tempDir);
    expect(dirFiles).toEqual(["site-content.json"]);

    // Check file content hash is completely identical
    const rawAfter = fs.readFileSync(testContentFile, "utf-8");
    const hashAfter = crypto.createHash("sha256").update(rawAfter).digest("hex");
    expect(hashAfter).toBe(hashBefore);
  });

  it("applies modifications atomically, creates a 0600 backup, and preserves company data", () => {
    const result = remediateSiteContentEditorial({
      targetPath: testContentFile,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.backupName).toBeDefined();
    expect(result.newRevision).toBeDefined();
    expect(result.newRevision).not.toBe("0123456789abcdef0123456789abcdef");

    // Verify private safety backup permissions (0600)
    const backupFullPath = path.join(tempDir, result.backupName!);
    expect(fs.existsSync(backupFullPath)).toBe(true);
    const backupStat = fs.statSync(backupFullPath);
    expect(backupStat.mode & 0o777).toBe(0o600);

    // Verify modified file on disk
    const updatedRaw = fs.readFileSync(testContentFile, "utf-8");
    const updatedContent = JSON.parse(updatedRaw) as SiteContent;

    // 1. Subtitle cleaned
    expect(updatedContent.home.hero.subtitle.fr).toBe("Studio de creation visuelle base en Belgique");
    expect(updatedContent.home.hero.subtitle.en).toBe("Visual creation studio based in Belgium");

    // 2. Copyright updated
    expect(updatedContent.common.footer.copyright.fr).toBe("© 2026 Studio LM - Parallax");
    expect(updatedContent.common.footer.copyright.en).toBe("© 2026 Studio LM - Parallax");

    // 3. Sempra badge updated
    expect(updatedContent.home.sempra.badge.fr).toBe("L'autre studio de Studio LM");
    expect(updatedContent.home.sempra.badge.en).toBe("The other Studio LM brand");

    // 4. Studio hero text updated
    expect(updatedContent.studio.hero.text.fr).toContain("Studio LM");
    expect(updatedContent.studio.hero.text.en).toContain("Studio LM");
    expect(updatedContent.studio.hero.text.fr).not.toContain("LS studio");

    // 5. Preserved legal company data
    expect(updatedContent.company.legalName).toBe("Association de fait");
    expect(updatedContent.company.enterpriseNumber).toBe("1044.156.597");
    expect(updatedContent.company.vatNumber).toBe("BE1044.156.597");
    expect(updatedContent.company.publicationDirector).toBe("Maxime Schneider");

    // 6. Schema validation passes
    const validation = validateSiteContentDocument(updatedContent);
    expect(validation.success).toBe(true);
  });

  it("is strictly idempotent: second run makes zero changes and creates no new backup", () => {
    // First run (modifies content)
    const firstResult = remediateSiteContentEditorial({
      targetPath: testContentFile,
      dryRun: false,
    });
    expect(firstResult.changed).toBe(true);

    const dirFilesAfterFirst = fs.readdirSync(tempDir);
    expect(dirFilesAfterFirst.length).toBe(2); // site-content.json + 1 backup

    const rawAfterFirst = fs.readFileSync(testContentFile, "utf-8");

    // Second run
    const secondResult = remediateSiteContentEditorial({
      targetPath: testContentFile,
      dryRun: false,
    });

    expect(secondResult.success).toBe(true);
    expect(secondResult.changed).toBe(false);
    expect(secondResult.modifiedFields).toEqual([]);
    expect(secondResult.backupName).toBeUndefined();

    // Directory still only has the 1 backup from the first run
    const dirFilesAfterSecond = fs.readdirSync(tempDir);
    expect(dirFilesAfterSecond.length).toBe(2);

    // File was not modified in second run
    const rawAfterSecond = fs.readFileSync(testContentFile, "utf-8");
    expect(rawAfterSecond).toBe(rawAfterFirst);
  });

  it("refuses corrupted JSON without modifying file or creating backups", () => {
    fs.writeFileSync(testContentFile, "INVALID JSON {{{", "utf-8");

    const result = remediateSiteContentEditorial({
      targetPath: testContentFile,
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("corrupted");

    // Check no backup created
    const dirFiles = fs.readdirSync(tempDir);
    expect(dirFiles).toEqual(["site-content.json"]);
  });

  it("fails if target path does not exist", () => {
    const nonexistent = path.join(tempDir, "nonexistent.json");
    const result = remediateSiteContentEditorial({
      targetPath: nonexistent,
      dryRun: false,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toBe("file_not_found");
  });
});
