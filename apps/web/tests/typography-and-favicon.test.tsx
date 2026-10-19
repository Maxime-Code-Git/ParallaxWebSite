// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [key: string]: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

import {
  cleanTypography,
  resolveCompanyTokens,
  DEFAULT_LEGAL_PAGES_CONTENT,
  type CommonContent,
} from "../app/lib/site-content.shared";
import { createDefaultPortfolioContent, savePortfolioContent } from "../app/lib/portfolio-content.server";
import { links as rootLinks } from "../app/root";
import { LegalPageView } from "../app/components/public/LegalPageView";
import defaultSiteContent from "../app/content/default-site-content.json";
import { adaptPortfolioContent, adaptSiteContentDrafts } from "../../../scripts/adapt-typography.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");

const mockCommon: CommonContent = {
  brandName: "Parallax",
  navigation: {
    portfolio: { fr: "Portfolio", en: "Portfolio" },
    studio: { fr: "Studio", en: "Studio" },
    contact: { fr: "Contact", en: "Contact" },
    sempra: { fr: "SEMPRA", en: "SEMPRA" },
    clientArea: { fr: "Espace client", en: "Client area" },
  },
  footer: {
    copyright: { fr: "© 2026 Parallax", en: "© 2026 Parallax" },
    legalNotice: { fr: "Mentions légales", en: "Legal notice" },
    privacy: { fr: "Confidentialité", en: "Privacy" },
    terms: { fr: "CGV", en: "Terms" },
    cookies: { fr: "Cookies & Préférences", en: "Cookies & Preferences" },
  },
};

describe("Typography (No Em-Dashes) and Favicon Validation Suite", () => {
  afterEach(() => {
    cleanup();
  });

  describe("1. Favicon Assets and Declarations", () => {
    it("generates and verifies physical favicon assets in apps/web/public", () => {
      const icoPath = path.join(publicDir, "favicon.ico");
      const png16Path = path.join(publicDir, "favicon-16x16.png");
      const png32Path = path.join(publicDir, "favicon-32x32.png");
      const png48Path = path.join(publicDir, "favicon-48x48.png");
      const appleTouchPath = path.join(publicDir, "apple-touch-icon.png");

      expect(fs.existsSync(icoPath)).toBe(true);
      expect(fs.existsSync(png16Path)).toBe(true);
      expect(fs.existsSync(png32Path)).toBe(true);
      expect(fs.existsSync(png48Path)).toBe(true);
      expect(fs.existsSync(appleTouchPath)).toBe(true);

      // Verify ICO magic header
      const icoBuf = fs.readFileSync(icoPath);
      expect(icoBuf.readUInt16LE(0)).toBe(0); // reserved
      expect(icoBuf.readUInt16LE(2)).toBe(1); // 1 = ICO
      expect(icoBuf.readUInt16LE(4)).toBe(3); // 3 embedded images (16, 32, 48)

      // Verify PNG headers
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(fs.readFileSync(png16Path).subarray(0, 8).equals(pngHeader)).toBe(true);
      expect(fs.readFileSync(png32Path).subarray(0, 8).equals(pngHeader)).toBe(true);
      expect(fs.readFileSync(png48Path).subarray(0, 8).equals(pngHeader)).toBe(true);
      expect(fs.readFileSync(appleTouchPath).subarray(0, 8).equals(pngHeader)).toBe(true);

      // Verify master logo is preserved and not overwritten
      const masterLogoPath = path.join(publicDir, "img", "logo-parallax.png");
      expect(fs.existsSync(masterLogoPath)).toBe(true);
    });

    it("root.tsx exports valid versioned links for browser tabs and iOS", () => {
      const declaredLinks = rootLinks();
      expect(declaredLinks).toEqual([
        { rel: "icon", href: "/favicon.ico?v=1", sizes: "any" },
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png?v=1" },
        { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png?v=1" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png?v=1" },
      ]);
    });
  });

  describe("2. Editorial Typography Normalization (cleanTypography)", () => {
    it("normalizes specific editorial phrases requested by Maxime", () => {
      // Documentary description
      const rawDocFr = "Des films qui racontent le réel — portraits de métiers, de lieux et de savoir-faire, du repérage au montage.";
      expect(cleanTypography(rawDocFr)).toBe(
        "Des films qui racontent le réel : portraits de métiers, de lieux et de savoir-faire, du repérage au montage."
      );

      const rawDocEn = "Films that tell real stories — portraits of trades, places and craft, from scouting to the edit.";
      expect(cleanTypography(rawDocEn)).toBe(
        "Films that tell real stories: portraits of trades, places and craft, from scouting to the edit."
      );

      // Advertising description
      const rawPubFr = "Des films de marque et de produit — studio, extérieur, rythme et lumière au service du message.";
      expect(cleanTypography(rawPubFr)).toBe(
        "Des films de marque et de produit : studio, extérieur, rythme et lumière au service du message."
      );

      const rawPubEn = "Brand and product films — studio, outdoor, rhythm and light serving the message.";
      expect(cleanTypography(rawPubEn)).toBe(
        "Brand and product films: studio, outdoor, rhythm and light serving the message."
      );

      // Project description
      const rawProjFr = "Ce que ce projet raconte — son émotion, son intention.";
      expect(cleanTypography(rawProjFr)).toBe(
        "Ce que ce projet raconte : son émotion, son intention."
      );

      const rawProjEn = "What this project carries — its emotion, its intent.";
      expect(cleanTypography(rawProjEn)).toBe(
        "What this project carries: its emotion, its intent."
      );
    });

    it("normalizes titles and metadata with pipe separator rather than em-dash", () => {
      expect(cleanTypography("Portfolio — Parallax | Réalisations photo et vidéo")).toBe(
        "Portfolio | Parallax | Réalisations photo et vidéo"
      );
      expect(cleanTypography("Documentaire — Parallax | Films documentaires")).toBe(
        "Documentaire | Parallax | Films documentaires"
      );
      expect(cleanTypography("Documentaire boulangerie — Parallax")).toBe(
        "Documentaire boulangerie | Parallax"
      );
      expect(cleanTypography("Publicité vélo — Parallax")).toBe(
        "Publicité vélo | Parallax"
      );
    });

    it("normalizes legal incises using standard parentheses without trailing spaces", () => {
      const rawInciseFr =
        "L'intégralité des éléments composant le site Parallax — incluant de manière non limitative les photographies, vidéos, masters audiovisuels, bandes-annonces, textes, éléments graphiques, logos, mises en page, code source et typographies locales — est protégée par les dispositions du Livre XI.";
      const cleanedFr = cleanTypography(rawInciseFr);
      expect(cleanedFr).toContain(
        "site Parallax (incluant de manière non limitative les photographies, vidéos, masters audiovisuels, bandes-annonces, textes, éléments graphiques, logos, mises en page, code source et typographies locales) est protégée"
      );
      expect(cleanedFr).not.toContain("—");

      const rawInciseEn =
        "All components of the Parallax website — including without limitation photographs, videos, audiovisual masters, trailers, texts, graphic assets, logos, layouts, source code, and local typography — are protected by Book XI.";
      const cleanedEn = cleanTypography(rawInciseEn);
      expect(cleanedEn).toContain(
        "Parallax website (including without limitation photographs, videos, audiovisual masters, trailers, texts, graphic assets, logos, layouts, source code, and local typography) are protected"
      );
      expect(cleanedEn).not.toContain("—");
    });

    it("normalizes juxtaposed contact information for APD and consumer mediation", () => {
      const rawApdFr =
        "Autorité de Protection des Données belge (APD) : Rue de la Presse 35, 1000 Bruxelles — Téléphone : +32 (0)2 274 48 00 — E-mail : contact@apd-gba.be — Site officiel : www.autoriteprotectiondonnees.be.";
      const cleanedApd = cleanTypography(rawApdFr);
      expect(cleanedApd).toBe(
        "Autorité de Protection des Données belge (APD) : Rue de la Presse 35, 1000 Bruxelles | Téléphone : +32 (0)2 274 48 00 | E-mail : contact@apd-gba.be | Site officiel : www.autoriteprotectiondonnees.be."
      );
      expect(cleanedApd).not.toContain("—");
    });

    it("normalizes B2B / B2C mentions in contract scope", () => {
      const rawTermsFr =
        "tant par des clients professionnels (entreprises, artistes, labels, agences, institutions — B2B) que, le cas échéant, par des consommateurs (personnes physiques agissant à des fins non professionnelles — B2C).";
      const cleanedTerms = cleanTypography(rawTermsFr);
      expect(cleanedTerms).toContain("institutions, B2B)");
      expect(cleanedTerms).toContain("non professionnelles, B2C)");
      expect(cleanedTerms).not.toContain("—");
    });

    it("is strictly idempotent", () => {
      const testSample = "Des films qui racontent le réel — portraits de métiers, de lieux et de savoir-faire, du repérage au montage.";
      const firstPass = cleanTypography(testSample);
      const secondPass = cleanTypography(firstPass);
      expect(secondPass).toBe(firstPass);
      expect(secondPass).not.toContain("—");
    });
  });

  describe("3. Presentation-time Legal Normalization", () => {
    it("resolveCompanyTokens cleans em-dashes in templates and resolved output", () => {
      const company = {
        tradeName: "Parallax",
        legalName: "Atelier Fictif",
        legalForm: "Personne physique",
        legalPersonality: "natural_person" as const,
        address: "Rue Fictive 10, 1000 Bruxelles",
        enterpriseNumber: "0123.456.789",
        vatNumber: "BE0123.456.789",
        vatRegime: "Régime normal de TVA",
        vatRegimeType: "standard" as const,
      };

      const rawTemplate =
        "Numéro d'entreprise (BCE / Banque-Carrefour des Entreprises) : {{company.enterpriseNumber}} — Numéro de TVA intracommunautaire : {{company.vatNumber}} ({{company.vatRegime}}).";

      const resolved = resolveCompanyTokens(rawTemplate, company, "public", "fr");
      expect(resolved).toContain("Numéro d'entreprise (BCE / Banque-Carrefour des Entreprises) : 0123.456.789, numéro de TVA intracommunautaire : BE0123.456.789 (Régime normal de TVA).");
      expect(resolved).not.toContain("—");
    });

    it("renders LegalPageView without em-dash in preview banner, identity grid, or sections", () => {
      const company = {
        tradeName: "Parallax",
        legalName: "Studio Fictif",
        legalForm: "Personne physique",
        legalPersonality: "natural_person" as const,
        address: "Avenue Fictive 5, 1050 Bruxelles",
        enterpriseNumber: "0999.888.777",
        vatNumber: "BE0999.888.777",
        vatRegime: "Régime normal",
        vatRegimeType: "standard" as const,
        hostingProvider: "Hébergeur Privé",
        hostingAddress: "Rue du Serveur 1, 1000 Bruxelles",
        hostingCountry: "Belgique",
      };

      const doc = DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft;

      const { container } = render(
        <LegalPageView
          mode="preview"
          lang="fr"
          pageKey="mentions"
          common={mockCommon}
          company={company}
          document={doc}
          alternateUrls={{ fr: "/fr/mentions-legales", en: "/en/legal-notice" }}
        />
      );

      // Verify preview banner does not use em-dash
      expect(screen.getByText(/Mode prévisualisation administrateur : ce document n'est pas public\./i)).toBeDefined();

      // Check entire rendered text inside container
      const fullRenderedText = container.textContent || "";
      expect(fullRenderedText).not.toContain("—");
      expect(fullRenderedText).not.toContain("&mdash;");
    });
  });

  describe("4. Default Content Validation", () => {
    it("createDefaultPortfolioContent has zero em-dashes", () => {
      const content = createDefaultPortfolioContent();
      const str = JSON.stringify(content);
      expect(str).not.toContain("—");
      expect(str).not.toContain("&mdash;");
      expect(str).not.toContain("&#8212;");
    });

    it("DEFAULT_LEGAL_PAGES_CONTENT templates have zero em-dashes", () => {
      const str = JSON.stringify(DEFAULT_LEGAL_PAGES_CONTENT);
      expect(str).not.toContain("—");
      expect(str).not.toContain("&mdash;");
      expect(str).not.toContain("&#8212;");
    });
  });

  describe("5. Targeted Adaptation Script (adapt-typography)", () => {
    let tmpDir: string;
    let tmpPortfolioPath: string;
    let tmpSitePath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-typo-test-"));
      tmpPortfolioPath = path.join(tmpDir, "portfolio-content.json");
      tmpSitePath = path.join(tmpDir, "site-content.json");
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("adapts custom editorial fields across Home, Studio, Contact and drafts", () => {
      const siteData = structuredClone(defaultSiteContent);
      siteData.home.hero.title.fr = "Un titre — personnalisé";
      siteData.home.hero.subtitle.en = "A subtitle — customized";
      siteData.studio.hero.title.fr = "Studio — présentation";
      siteData.contactPage.hero.title.fr = "Contact — écrivez-nous";
      siteData.legalPages.mentions.draft.sections[0].paragraphs[0].fr = "Texte — mentions personnalisées";

      fs.writeFileSync(tmpSitePath, JSON.stringify(siteData, null, 2), "utf-8");

      const res = adaptSiteContentDrafts(tmpSitePath);
      expect(res.success).toBe(true);
      expect(res.changed).toBe(true);
      expect(res.newRevision).toBeDefined();

      const updated = JSON.parse(fs.readFileSync(tmpSitePath, "utf-8"));
      expect(updated.home.hero.title.fr).toBe("Un titre | personnalisé");
      expect(updated.home.hero.subtitle.en).toBe("A subtitle | customized");
      expect(updated.studio.hero.title.fr).toBe("Studio | présentation");
      expect(updated.contactPage.hero.title.fr).toBe("Contact | écrivez-nous");
      expect(updated.legalPages.mentions.draft.sections[0].paragraphs[0].fr).toBe("Texte | mentions personnalisées");

      // Verify second pass is strictly idempotent
      const pass2 = adaptSiteContentDrafts(tmpSitePath);
      expect(pass2.success).toBe(true);
      expect(pass2.changed).toBe(false);
      expect(pass2.newRevision).toBeUndefined();
    });

    it("adapts custom portfolio overview, categories, projects, alts, and summaries", () => {
      const portfolioData = createDefaultPortfolioContent();
      portfolioData.overview.intro.fr = "Introduction — personnalisée";
      portfolioData.categories[0].intro.fr = "Des films qui racontent le réel — portraits de métiers, de lieux et de savoir-faire, du repérage au montage.";
      portfolioData.projects[0].summary.fr = "Résumé — personnalisé";
      portfolioData.projects[0].seo.title.fr = "Projet — Parallax";

      fs.writeFileSync(tmpPortfolioPath, JSON.stringify(portfolioData, null, 2), "utf-8");

      const res = adaptPortfolioContent(tmpPortfolioPath);
      expect(res.success).toBe(true);
      expect(res.changed).toBe(true);
      expect(res.newRevision).toBeDefined();

      const updated = JSON.parse(fs.readFileSync(tmpPortfolioPath, "utf-8"));
      expect(updated.overview.intro.fr).toBe("Introduction | personnalisée");
      expect(updated.categories[0].intro.fr).toBe("Des films qui racontent le réel : portraits de métiers, de lieux et de savoir-faire, du repérage au montage.");
      expect(updated.projects[0].summary.fr).toBe("Résumé | personnalisé");
      expect(updated.projects[0].seo.title.fr).toBe("Projet | Parallax");

      // Verify second pass is strictly idempotent
      const pass2 = adaptPortfolioContent(tmpPortfolioPath);
      expect(pass2.success).toBe(true);
      expect(pass2.changed).toBe(false);
    });

    it("handles JSON encoded \\u2014, &mdash;, and entities", () => {
      const portfolioData = createDefaultPortfolioContent();
      portfolioData.overview.intro.fr = "Introduction &mdash; test entité";
      portfolioData.projects[0].summary.fr = "Résumé \\u2014 test échappé";

      fs.writeFileSync(tmpPortfolioPath, JSON.stringify(portfolioData, null, 2), "utf-8");

      const res = adaptPortfolioContent(tmpPortfolioPath);
      expect(res.success).toBe(true);
      expect(res.changed).toBe(true);

      const updated = JSON.parse(fs.readFileSync(tmpPortfolioPath, "utf-8"));
      expect(updated.overview.intro.fr).toBe("Introduction | test entité");
      expect(updated.projects[0].summary.fr).toBe("Résumé | test échappé");
    });

    it("rejects corrupted JSON, invalid schema, or unsupported versions without rewrite", () => {
      // 1. Corrupted JSON
      fs.writeFileSync(tmpPortfolioPath, "{ corrupted json: ", "utf-8");
      const resCorrupt = adaptPortfolioContent(tmpPortfolioPath);
      expect(resCorrupt.success).toBe(false);
      expect(resCorrupt.reason).toBe("corrupted");

      // 2. Unsupported version
      const badVersion = { ...createDefaultPortfolioContent(), schemaVersion: 99 };
      fs.writeFileSync(tmpPortfolioPath, JSON.stringify(badVersion), "utf-8");
      const resVersion = adaptPortfolioContent(tmpPortfolioPath);
      expect(resVersion.success).toBe(false);
      expect(resVersion.reason).toBe("unsupported_version");

      // 3. Invalid schema
      const invalidSchema = { schemaVersion: 2, revision: "abc" };
      fs.writeFileSync(tmpPortfolioPath, JSON.stringify(invalidSchema), "utf-8");
      const resInvalid = adaptPortfolioContent(tmpPortfolioPath);
      expect(resInvalid.success).toBe(false);
      expect(resInvalid.reason).toBe("invalid_schema");

      // Verify no backup was created
      const files = fs.readdirSync(tmpDir);
      expect(files.filter((f) => f.includes(".safety.bak")).length).toBe(0);
    });
  });

  describe("6. Stale Revision Conflict & Admin Save Safety", () => {
    let tmpDir: string;
    let tmpPortfolioPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-conflict-test-"));
      tmpPortfolioPath = path.join(tmpDir, "portfolio-content.json");
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("updates revision upon adaptation, causing savePortfolioContent with stale revision to throw RevisionConflictError", async () => {
      const initialPortfolio = createDefaultPortfolioContent();
      initialPortfolio.overview.seo.title.fr = "Portfolio — Parallax";
      const initialRevision = initialPortfolio.revision;

      fs.writeFileSync(tmpPortfolioPath, JSON.stringify(initialPortfolio, null, 2), "utf-8");

      // Admin tab has read initial content and retains initialRevision
      const staleContent = structuredClone(initialPortfolio);

      // Run adaptation
      const adaptRes = adaptPortfolioContent(tmpPortfolioPath);
      expect(adaptRes.success).toBe(true);
      expect(adaptRes.changed).toBe(true);
      expect(adaptRes.newRevision).toBeDefined();
      expect(adaptRes.newRevision).not.toBe(initialRevision);

      // Admin tab tries to save with stale revision: must be rejected with RevisionConflictError
      await expect(
        savePortfolioContent(staleContent, initialRevision, tmpPortfolioPath)
      ).rejects.toThrow();

      // Verify the adapted file on disk was preserved and not overwritten with old cadratin
      const onDisk = JSON.parse(fs.readFileSync(tmpPortfolioPath, "utf-8"));
      expect(onDisk.overview.seo.title.fr).toBe("Portfolio | Parallax");
      expect(onDisk.revision).toBe(adaptRes.newRevision);
    });
  });

  describe("7. VAT non_subject and Historical Template Compatibility", () => {
    const nonSubjectCompany = {
      tradeName: "Parallax",
      enterpriseNumber: "0123.456.789",
      vatNumber: "",
      vatRegime: "Non assujetti à la TVA",
      vatRegimeType: "non_subject" as const,
      legalPersonality: "natural_person" as const,
    };

    it("resolves DEFAULT mentions draft with non_subject without empty VAT number in FR", () => {
      const templateFr = DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft.sections[0].paragraphs[2].fr;
      const resolved = resolveCompanyTokens(templateFr, nonSubjectCompany, "public", "fr");

      expect(resolved).toContain("Numéro d'entreprise (BCE / Banque-Carrefour des Entreprises) : 0123.456.789, régime TVA : Non assujetti à la TVA.");
      expect(resolved).not.toContain("numéro de TVA intracommunautaire :");
      expect(resolved).not.toContain("—");
    });

    it("resolves DEFAULT mentions draft with non_subject without empty VAT number in EN", () => {
      const templateEn = DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft.sections[0].paragraphs[2].en;
      const resolved = resolveCompanyTokens(templateEn, nonSubjectCompany, "public", "en");

      expect(resolved).toContain("Enterprise number (BCE / Crossroads Bank for Enterprises): 0123.456.789, VAT regime: Non-subject to VAT.");
      expect(resolved).not.toContain("intra-community VAT number:");
      expect(resolved).not.toContain("—");
    });

    it("is compatible with historical capitalized and hyphenated templates", () => {
      const historicalFr = "Numéro d'entreprise : {{company.enterpriseNumber}} — Numéro de TVA intracommunautaire : {{company.vatNumber}} ({{company.vatRegime}}).";
      const resolved = resolveCompanyTokens(historicalFr, nonSubjectCompany, "public", "fr");
      expect(resolved).toBe("Numéro d'entreprise : 0123.456.789, régime TVA : Non assujetti à la TVA.");

      const historicalEn = "Enterprise number: {{company.enterpriseNumber}} — Intra-community VAT number: {{company.vatNumber}} ({{company.vatRegime}}).";
      const resolvedEn = resolveCompanyTokens(historicalEn, nonSubjectCompany, "public", "en");
      expect(resolvedEn).toBe("Enterprise number: 0123.456.789, VAT regime: Non-subject to VAT.");
    });
  });
});
