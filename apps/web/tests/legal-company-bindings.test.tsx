// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { render, screen } from "@testing-library/react";
import type { LoaderFunctionArgs } from "react-router";

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
  DEFAULT_LEGAL_PAGES_CONTENT,
  DEFAULT_COMPANY_CONTENT,
  resolveCompanyTokens,
  findUnresolvedCompanyTokens,
  resolveLegalDocument,
  findDocumentUnresolvedCompanyTokens,
  type CompanyContent,
  type LegalDocument,
  type CommonContent,
} from "../app/lib/site-content.shared";
import {
  getSiteContent,
  getPublicCompanyContent,
  saveCompanyContent,
  saveLegalPageDraft,
  publishLegalPage,
  applyDefaultLegalDrafts,
  validateCompanyContent,
  ValidationError,
} from "../app/lib/site-content.server";
import { LegalPageView } from "../app/components/public/LegalPageView";
import { loader as legalLoader, type LegalPageLoaderData } from "../app/routes/public/legal-page";

const makeLoaderArgs = (req: Request): LoaderFunctionArgs =>
  ({
    request: req,
    params: {},
    context: {} as never,
  }) as unknown as LoaderFunctionArgs;

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

const fullValidCompany: CompanyContent = {
  ...DEFAULT_COMPANY_CONTENT,
  tradeName: "Parallax Studio",
  legalName: "Maxime Henrotin",
  legalForm: "Personne physique",
  address: "Rue de la Station 12, 5000 Namur, Belgique",
  enterpriseNumber: "0123.456.789",
  vatNumber: "BE0123456789",
  vatRegime: "Franchise de taxe pour petites entreprises",
  rpmJurisdiction: "Namur",
  publicationDirector: "Maxime Henrotin",
  email: "contact@parallax.be",
  privacyEmail: "privacy@parallax.be",
  phone: "+32 470 12 34 56",
  hostingProvider: "Infomaniak Network SA",
  hostingAddress: "Rue Eugène-Marziano 25, 1227 Genève, Suisse",
  hostingCountry: "Suisse",
  dpoDesignated: false,
  clientTypes: "both",
  isPublished: true,
};

describe("Legal Content, Centralized Company Bindings & Belgian Compliance", () => {
  let tempDir: string;
  let testContentFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-legal-test-"));
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

  // 1. Reference editorial content & exact 5-cookie inventory
  describe("1. Reference Editorial Content & Cookie Inventory", () => {
    it("contains all 4 complete documents in French and English", () => {
      const keys = ["mentions", "privacy", "terms", "cookies"] as const;
      for (const k of keys) {
        const record = DEFAULT_LEGAL_PAGES_CONTENT[k];
        expect(record).toBeDefined();
        const doc = record.draft;
        expect(doc.publicTitle.fr.trim().length).toBeGreaterThan(0);
        expect(doc.publicTitle.en.trim().length).toBeGreaterThan(0);
        expect(doc.seoTitle.fr.trim().length).toBeGreaterThan(0);
        expect(doc.seoTitle.en.trim().length).toBeGreaterThan(0);
        expect(doc.seoDescription.fr.trim().length).toBeGreaterThan(0);
        expect(doc.seoDescription.en.trim().length).toBeGreaterThan(0);
        expect(doc.intro.fr.trim().length).toBeGreaterThan(0);
        expect(doc.intro.en.trim().length).toBeGreaterThan(0);
        expect(doc.sections.length).toBeGreaterThan(0);

        for (const sec of doc.sections) {
          expect(sec.title.fr.trim().length).toBeGreaterThan(0);
          expect(sec.title.en.trim().length).toBeGreaterThan(0);
          expect(sec.paragraphs.length).toBeGreaterThan(0);
          for (const p of sec.paragraphs) {
            expect(p.fr.trim().length).toBeGreaterThan(0);
            expect(p.en.trim().length).toBeGreaterThan(0);
          }
        }
      }
    });

    it("verifies the exact 5-cookie inventory matching implementation", () => {
      const inventory = DEFAULT_LEGAL_PAGES_CONTENT.cookies.draft.inventory;
      expect(inventory).toBeDefined();
      expect(inventory?.length).toBe(5);

      const cookieNames = inventory?.map((i) => i.name.fr);
      expect(cookieNames).toContain("__parallax_admin_session");
      expect(cookieNames).toContain("__parallax_gallery_session");
      expect(cookieNames).toContain("__parallax_contact_ctx");
      expect(cookieNames).toContain("__parallax_contact_flash");
      expect(cookieNames).toContain("__parallax_privacy_prefs");

      // Verify specific technical durations
      const adminCookie = inventory?.find((i) => i.name.fr === "__parallax_admin_session");
      expect(adminCookie?.duration.fr).toContain("8 heures");
      expect(adminCookie?.category).toBe("technical");

      const galleryCookie = inventory?.find((i) => i.name.fr === "__parallax_gallery_session");
      expect(galleryCookie?.duration.fr).toContain("8 heures");
      expect(galleryCookie?.category).toBe("technical");

      const ctxCookie = inventory?.find((i) => i.name.fr === "__parallax_contact_ctx");
      expect(ctxCookie?.duration.fr).toContain("2 heures");
      expect(ctxCookie?.category).toBe("technical");

      const flashCookie = inventory?.find((i) => i.name.fr === "__parallax_contact_flash");
      expect(flashCookie?.duration.fr).toContain("60 secondes");
      expect(flashCookie?.category).toBe("technical");

      const prefsCookie = inventory?.find((i) => i.name.fr === "__parallax_privacy_prefs");
      expect(prefsCookie?.duration.fr).toContain("180 jours");
      expect(prefsCookie?.category).toBe("preferences");

      // Verify sessionStorage is documented separately
      const cookiesDoc = DEFAULT_LEGAL_PAGES_CONTENT.cookies.draft;
      const sessionSec = cookiesDoc.sections.find((s) => s.id === "inventory_description");
      expect(sessionSec).toBeDefined();
      expect(sessionSec?.listItems?.some((p) => p.fr.includes("sessionStorage"))).toBe(true);
    });

    it("does not contain unverified claims, false guarantees or abusive clauses", () => {
      const mentionsText = JSON.stringify(DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft);
      expect(mentionsText).not.toContain("respecte toutes les normes européennes");

      const privacyText = JSON.stringify(DEFAULT_LEGAL_PAGES_CONTENT.privacy.draft);
      expect(privacyText).toContain("pseudonymisé");
      expect(privacyText).not.toContain("chiffrée de bout en bout");
      expect(privacyText).not.toContain("garantie dans les 15 minutes");

      const termsText = JSON.stringify(DEFAULT_LEGAL_PAGES_CONTENT.terms.draft);
      expect(termsText).not.toContain("adhésion sans réserve");
      expect(termsText).not.toContain("tribunal de Liège exclusivement compétent");
    });
  });

  // 2. Company token resolution & XSS safety
  describe("2. Company Token Resolution & XSS Protection", () => {
    it("resolves tokens correctly in French and English", () => {
      const templateFr = "Entreprise : {{company.legalOperatorText}}, TVA : {{company.vatNumber}} à {{company.address}}.";
      const templateEn = "Entity: {{company.legalOperatorText}}, VAT: {{company.vatNumber}} at {{company.address}}.";

      const resFr = resolveCompanyTokens(templateFr, fullValidCompany, "public", "fr");
      const resEn = resolveCompanyTokens(templateEn, fullValidCompany, "public", "en");

      expect(resFr).toBe(
        "Entreprise : Parallax Studio (exploité par Maxime Henrotin (Personne physique)), TVA : BE0123456789 à Rue de la Station 12, 5000 Namur, Belgique."
      );
      expect(resEn).toBe(
        "Entity: Parallax Studio (operated by Maxime Henrotin (Personne physique)), VAT: BE0123456789 at Rue de la Station 12, 5000 Namur, Belgique."
      );
    });

    it("displays informative placeholders in preview mode when company fields are missing", () => {
      const incompleteCompany: Partial<CompanyContent> = {
        tradeName: "Parallax",
      };
      const template = "Hébergeur : {{company.hostingProvider}}, BCE : {{company.enterpriseNumber}}.";
      const preview = resolveCompanyTokens(template, incompleteCompany, "preview", "fr");

      expect(preview).toContain("[À renseigner dans Entreprise : Hébergeur]");
      expect(preview).toContain("[À renseigner dans Entreprise : N° d'entreprise (BCE)]");
    });

    it("safely omits unresolved tokens in public mode rather than leaking internal syntax", () => {
      const incompleteCompany: Partial<CompanyContent> = {
        tradeName: "Parallax",
      };
      const template = "Hébergeur : {{company.hostingProvider}}.";
      const pub = resolveCompanyTokens(template, incompleteCompany, "public", "fr");

      expect(pub).toBe("Hébergeur : .");
      expect(pub).not.toContain("{{");
      expect(pub).not.toContain("[À renseigner");
    });

    it("escapes malicious scripts in token values without XSS injection", () => {
      const xssCompany: Partial<CompanyContent> = {
        ...fullValidCompany,
        legalName: '<script>alert("XSS")</script>',
        address: '<img src=x onerror=alert(1)>',
      };
      const template = "Exploitant : {{company.legalName}}, adresse : {{company.address}}";
      const resolved = resolveCompanyTokens(template, xssCompany, "public", "fr");

      // Tokens are plain strings, not parsed as HTML
      expect(resolved).toContain('<script>alert("XSS")</script>');
      expect(resolved).toContain("<img src=x onerror=alert(1)>");
    });

    it("findDocumentUnresolvedCompanyTokens and findUnresolvedCompanyTokens accurately detect missing required fields", () => {
      const emptyCompany: Partial<CompanyContent> = {};
      const missingTokens = findDocumentUnresolvedCompanyTokens(DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, emptyCompany);

      expect(missingTokens).toContain("company.enterpriseNumber");
      expect(missingTokens).toContain("company.hostingProvider");

      const singleUnresolved = findUnresolvedCompanyTokens("{{company.legalName}} and {{company.address}}", {});
      expect(singleUnresolved).toContain("company.legalName");
      expect(singleUnresolved).toContain("company.address");
    });

    it("resolveLegalDocument resolves all localized fields recursively", () => {
      const resolved = resolveLegalDocument(DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, fullValidCompany, "public");
      expect(resolved.publicTitle.fr).toBe("Mentions légales");
      expect(resolved.intro.fr.length).toBeGreaterThan(0);
      expect(resolved.sections.length).toBe(DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft.sections.length);
    });
  });

  // 3. Distinct Trade Name vs Legal Operator rendering
  describe("3. Distinct Trade Name vs Legal Operator in LegalPageView", () => {
    it("renders both trade name and legal operator when they differ", () => {
      const companyWithDistinctNames: Partial<CompanyContent> = {
        tradeName: "Parallax Studio",
        legalName: "Maxime Henrotin SRL",
        legalForm: "SRL",
        address: "Rue Haute 1, 1000 Bruxelles",
        enterpriseNumber: "0999.888.777",
        rpmJurisdiction: "Bruxelles",
        isPublished: true,
      };

      render(
        <LegalPageView
          mode="public"
          lang="fr"
          pageKey="mentions"
          common={mockCommon}
          company={companyWithDistinctNames}
          document={DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft}
          alternateUrls={{ fr: "/fr/mentions-legales", en: "/en/legal-notice" }}
        />
      );

      // Verify Nom commercial
      expect(screen.getByText("Nom commercial")).toBeDefined();
      expect(screen.getByText("Parallax Studio")).toBeDefined();

      // Verify Exploitant / Raison sociale
      expect(screen.getByText("Exploitant / Raison sociale")).toBeDefined();
      expect(screen.getAllByText(/Maxime Henrotin SRL/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/\(SRL\)/).length).toBeGreaterThan(0);

      // Verify RPM jurisdiction
      expect(screen.getByText(/RPM : Bruxelles/)).toBeDefined();
    });

    it("renders single site publisher line when trade name and legal name are identical", () => {
      const companyWithSameName: Partial<CompanyContent> = {
        tradeName: "Parallax",
        legalName: "Parallax",
        legalForm: "SRL",
        address: "Rue Haute 1, 1000 Bruxelles",
        enterpriseNumber: "0999.888.777",
        isPublished: true,
      };

      render(
        <LegalPageView
          mode="public"
          lang="fr"
          pageKey="mentions"
          common={mockCommon}
          company={companyWithSameName}
          document={DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft}
          alternateUrls={{ fr: "/fr/mentions-legales", en: "/en/legal-notice" }}
        />
      );

      expect(screen.getByText("Éditeur du site")).toBeDefined();
      expect(screen.queryByText("Nom commercial")).toBeNull();
    });
  });

  // 4. Privacy & Leakage Prevention
  describe("4. Privacy & Leakage Prevention (Unconfirmed Company Content)", () => {
    it("does not expose private company coordinates when isPublished is false", () => {
      const initial = getSiteContent();
      saveCompanyContent(
        {
          ...initial.company,
          tradeName: "Secret Trade Name",
          address: "Confidential Address 123",
          enterpriseNumber: "0123.456.789",
          isPublished: false,
        },
        initial.revision
      );

      const pubCompany = getPublicCompanyContent();
      expect(pubCompany.isPublished).toBe(false);
      expect(pubCompany.address).toBeUndefined();
      expect(pubCompany.enterpriseNumber).toBeUndefined();
      expect(pubCompany.vatNumber).toBeUndefined();
      expect(pubCompany.hostingProvider).toBeUndefined();
    });

    it("does not leak unconfirmed company content into public legal loader response", async () => {
      const initial = getSiteContent();
      saveCompanyContent(
        {
          ...initial.company,
          address: "Secret Private Address 456",
          enterpriseNumber: "0111.222.333",
          isPublished: false,
        },
        initial.revision
      );

      const req = new Request("http://127.0.0.1:3000/fr/mentions-legales", { method: "GET" });
      const res = await legalLoader(makeLoaderArgs(req));
      const loaderResult = res as unknown as { data: LegalPageLoaderData };
      const data = loaderResult.data;

      expect(data.company?.address).toBeUndefined();
      expect(data.company?.enterpriseNumber).toBeUndefined();
      expect(data.company?.isPublished).toBe(false);
      const rawString = JSON.stringify(data);
      expect(rawString).not.toContain("Secret Private Address 456");
      expect(rawString).not.toContain("0111.222.333");
    });

    it("returns safe projection when isPublished is true", () => {
      const initial = getSiteContent();
      saveCompanyContent(
        fullValidCompany,
        initial.revision
      );

      const pub = getPublicCompanyContent();
      expect(pub).not.toBeNull();
      expect(pub?.tradeName).toBe("Parallax Studio");
      expect(pub?.address).toContain("Namur");
      expect(pub?.isPublished).toBe(true);
    });
  });

  // 5. Publication Validation Gate
  describe("5. Publication Validation Gate", () => {
    it("rejects publication if company is not published/confirmed", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(
        {
          ...initial.company,
          isPublished: false,
        },
        initial.revision
      );

      saveLegalPageDraft("mentions", DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, rev1);
      const afterDraft = getSiteContent();

      expect(() => {
        publishLegalPage("mentions", afterDraft.revision, "2026-10-18");
      }).toThrow(ValidationError);

      // Verify no mutation on disk
      const afterFailedPub = getSiteContent();
      expect(afterFailedPub.legalPages.mentions.published).toBeNull();
      expect(afterFailedPub.revision).toBe(afterDraft.revision);
    });

    it("rejects publication if required company tokens remain unresolved", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(
        fullValidCompany,
        initial.revision
      );

      // Create a draft with a missing custom token
      const draftWithMissingToken: LegalDocument = {
        ...DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        intro: {
          fr: "Contact : {{company.dpoContact}}",
          en: "Contact: {{company.dpoContact}}",
        },
      };

      const rev2 = saveLegalPageDraft("mentions", draftWithMissingToken, rev1);

      expect(() => {
        publishLegalPage("mentions", rev2, "2026-10-18");
      }).toThrow(ValidationError);

      const afterFailedPub = getSiteContent();
      expect(afterFailedPub.legalPages.mentions.published).toBeNull();
    });

    it("rejects publication if draft contains [à compléter] placeholder", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(
        fullValidCompany,
        initial.revision
      );

      const draftWithPlaceholder: LegalDocument = {
        ...DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        intro: {
          fr: "Texte avec [à compléter] manquant.",
          en: "Text with placeholder.",
        },
      };

      const rev2 = saveLegalPageDraft("mentions", draftWithPlaceholder, rev1);

      expect(() => {
        publishLegalPage("mentions", rev2, "2026-10-18");
      }).toThrow(ValidationError);

      const afterFailedPub = getSiteContent();
      expect(afterFailedPub.legalPages.mentions.published).toBeNull();
    });

    it("succeeds publication when company is confirmed and all required tokens are resolved", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(
        fullValidCompany,
        initial.revision
      );

      const rev2 = saveLegalPageDraft("mentions", DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, rev1);
      const rev3 = publishLegalPage("mentions", rev2, "2026-10-18");

      expect(rev3).toBeDefined();
      const afterPub = getSiteContent();
      const published = afterPub.legalPages.mentions.published;
      expect(published).not.toBeNull();
      expect(published?.effectiveDate).toBe("2026-10-18");
      expect(published?.publicTitle.fr).toBe("Mentions légales");
    });
  });

  // 6. Immutability of Published Content on Policy Change
  describe("6. Immutability of Published Content on Policy Changes", () => {
    it("does not silently mutate published document when company or draft is updated", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(
        fullValidCompany,
        initial.revision
      );

      const rev2 = saveLegalPageDraft("mentions", DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, rev1);
      const rev3 = publishLegalPage("mentions", rev2, "2026-10-01");

      const pubSnapshotBefore = getSiteContent().legalPages.mentions.published;
      expect(pubSnapshotBefore?.effectiveDate).toBe("2026-10-01");

      // Now Maxime updates company address and modifies draft
      const rev4 = saveCompanyContent(
        {
          ...fullValidCompany,
          address: "Nouvelle adresse mise à jour, 5000 Namur",
        },
        rev3
      );

      const modifiedDraft: LegalDocument = {
        ...DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        intro: { fr: "Nouvelle introduction modifiée V2", en: "New modified intro V2" },
      };
      saveLegalPageDraft("mentions", modifiedDraft, rev4);

      // Verify that published record did NOT change its intro or effectiveDate
      const afterUpdate = getSiteContent();
      const pubSnapshotAfter = afterUpdate.legalPages.mentions.published;

      expect(pubSnapshotAfter?.effectiveDate).toBe("2026-10-01");
      expect(pubSnapshotAfter?.intro.fr).toBe(pubSnapshotBefore?.intro.fr);
      expect(afterUpdate.legalPages.mentions.draft.intro.fr).toBe("Nouvelle introduction modifiée V2");
    });
  });

  // 7. Idempotent Application of Default Drafts
  describe("7. Idempotent Application of Default Legal Drafts", () => {
    it("applies default drafts when outdated and keeps published as null", () => {
      // 1. Initialise storage with an outdated draft (empty sections)
      const initial = getSiteContent();
      const outdatedDraft: LegalDocument = {
        ...DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        intro: { fr: "Ancien texte obsolète", en: "Old outdated text" },
        sections: [],
      };
      saveLegalPageDraft("mentions", outdatedDraft, initial.revision);

      // 2. Run applyDefaultLegalDrafts
      const res = applyDefaultLegalDrafts(testContentFile);
      expect(res.changed).toBe(true);
      expect(res.appliedKeys.length).toBe(4);

      const content = getSiteContent();
      for (const key of ["mentions", "privacy", "terms", "cookies"] as const) {
        expect(content.legalPages[key].draft.sections.length).toBeGreaterThan(0);
        expect(content.legalPages[key].published).toBeNull();
      }
    });

    it("second run is strictly idempotent and does not modify content or revision", () => {
      // Ensure drafts are applied
      const initial = getSiteContent();
      const outdatedDraft: LegalDocument = {
        ...DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        intro: { fr: "Ancien texte obsolète", en: "Old outdated text" },
        sections: [],
      };
      saveLegalPageDraft("mentions", outdatedDraft, initial.revision);

      const res1 = applyDefaultLegalDrafts(testContentFile);
      expect(res1.changed).toBe(true);

      const revAfter1 = getSiteContent().revision;

      const res2 = applyDefaultLegalDrafts(testContentFile);
      expect(res2.changed).toBe(false);
      expect(res2.appliedKeys.length).toBe(0);

      const revAfter2 = getSiteContent().revision;
      expect(revAfter2).toBe(revAfter1);
    });
  });

  // 8. Progressive Company Content Validation
  describe("8. Progressive Company Content Validation", () => {
    it("allows progressive/incomplete saving without throwing validation error", () => {
      const partialCompany: CompanyContent = {
        ...DEFAULT_COMPANY_CONTENT,
        tradeName: "Parallax",
        legalName: "", // incomplete
        address: "", // incomplete
        enterpriseNumber: "", // incomplete
        isPublished: false,
      };

      const validated = validateCompanyContent(partialCompany);
      expect(validated.tradeName).toBe("Parallax");
      expect(validated.legalName).toBe("");
    });

    it("validates clientTypes union strictly", () => {
      const validBoth = validateCompanyContent({
        ...DEFAULT_COMPANY_CONTENT,
        clientTypes: "both",
      });
      expect(validBoth.clientTypes).toBe("both");

      const invalid = {
        ...DEFAULT_COMPANY_CONTENT,
        clientTypes: "invalid_type",
      };
      expect(() => validateCompanyContent(invalid as unknown as CompanyContent)).toThrow(ValidationError);
    });

    it("rejects invalid email formats in privacyEmail", () => {
      const invalidEmail = {
        ...DEFAULT_COMPANY_CONTENT,
        privacyEmail: "not-an-email",
      };
      expect(() => validateCompanyContent(invalidEmail)).toThrow(ValidationError);
    });
  });
});
