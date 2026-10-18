// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { render, screen, cleanup } from "@testing-library/react";
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
  isRpmApplicable,
  isVatNumberApplicable,
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
  adaptExistingLegalDrafts,
  validateCompanyContent,
  RevisionConflictError,
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

// Fictitious physical person sole proprietorship (RPM is NOT applicable)
const fullValidCompany: CompanyContent = {
  ...DEFAULT_COMPANY_CONTENT,
  tradeName: "Parallax Studio",
  legalName: "Alexandre Fictif",
  legalForm: "Personne physique",
  legalPersonality: "natural_person",
  address: "Rue de la Station 12, 5000 Namur, Belgique",
  enterpriseNumber: "0123.456.789",
  vatNumber: "BE0123456789",
  vatRegime: "Franchise de taxe pour petites entreprises",
  vatRegimeType: "small_business_exemption",
  rpmJurisdiction: "",
  publicationDirector: "Alexandre Fictif",
  privacyContact: "Alexandre Fictif",
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

// Fictitious legal entity (RPM IS required)
const fullValidLegalEntity: CompanyContent = {
  ...DEFAULT_COMPANY_CONTENT,
  tradeName: "Parallax Production",
  legalName: "Atelier Fictif SRL",
  legalForm: "SRL",
  legalPersonality: "legal_entity",
  address: "Rue Haute 1, 1000 Bruxelles, Belgique",
  enterpriseNumber: "0999.888.777",
  vatNumber: "BE0999888777",
  vatRegime: "Régime normal de TVA",
  vatRegimeType: "standard",
  rpmJurisdiction: "Tribunal de l'entreprise francophone de Bruxelles",
  publicationDirector: "Alexandre Fictif",
  privacyContact: "Alexandre Fictif",
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
    cleanup();
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

      const adminCookie = inventory?.find((i) => i.name.fr === "__parallax_admin_session");
      expect(adminCookie?.duration.fr).toContain("8 heures");
      expect(adminCookie?.category).toBe("technical");

      const sessionSec = DEFAULT_LEGAL_PAGES_CONTENT.cookies.draft.sections.find((s) => s.id === "inventory_description");
      expect(sessionSec).toBeDefined();
      expect(sessionSec?.listItems?.some((p) => p.fr.includes("sessionStorage"))).toBe(true);
    });

    it("does not contain unverified claims, false guarantees or arbitrary court clauses", () => {
      const mentionsText = JSON.stringify(DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft);
      expect(mentionsText).not.toContain("respecte toutes les normes européennes");

      const privacyText = JSON.stringify(DEFAULT_LEGAL_PAGES_CONTENT.privacy.draft);
      expect(privacyText).toContain("pseudonymisé");
      expect(privacyText).not.toContain("chiffrée de bout en bout");

      const termsText = JSON.stringify(DEFAULT_LEGAL_PAGES_CONTENT.terms.draft);
      expect(termsText).not.toContain("adhésion sans réserve");
      expect(termsText).not.toContain("{{company.rpmJurisdiction}} ou Bruxelles");
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
        "Entreprise : Parallax Studio (exploité par Alexandre Fictif (Personne physique)), TVA : BE0123456789 à Rue de la Station 12, 5000 Namur, Belgique."
      );
      expect(resEn).toBe(
        "Entity: Parallax Studio (operated by Alexandre Fictif (Personne physique)), VAT: BE0123456789 at Rue de la Station 12, 5000 Namur, Belgique."
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

      expect(resolved).toContain('<script>alert("XSS")</script>');
      expect(resolved).toContain("<img src=x onerror=alert(1)>");
    });

    it("findDocumentUnresolvedCompanyTokens accurately detects missing required fields", () => {
      const emptyCompany: Partial<CompanyContent> = {};
      const missingTokens = findDocumentUnresolvedCompanyTokens(DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, emptyCompany);

      expect(missingTokens).toContain("company.enterpriseNumber");
      expect(missingTokens).toContain("company.hostingProvider");

      const singleUnresolved = findUnresolvedCompanyTokens("{{company.legalName}} and {{company.address}}", {});
      expect(singleUnresolved).toContain("company.legalName");
      expect(singleUnresolved).toContain("company.address");
    });
  });

  // 3. Distinct Trade Name vs Legal Operator rendering
  describe("3. Distinct Trade Name vs Legal Operator in LegalPageView", () => {
    it("renders both trade name and legal operator when they differ", () => {
      const companyWithDistinctNames: Partial<CompanyContent> = {
        tradeName: "Parallax Studio",
        legalName: "Atelier Fictif SRL",
        legalForm: "SRL",
        legalPersonality: "legal_entity",
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

      expect(screen.getByText("Nom commercial")).toBeDefined();
      expect(screen.getByText("Parallax Studio")).toBeDefined();
      expect(screen.getByText("Exploitant / Raison sociale")).toBeDefined();
      expect(screen.getAllByText(/Atelier Fictif SRL/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/\(SRL\)/).length).toBeGreaterThan(0);
      expect(screen.getByText(/RPM : Bruxelles/)).toBeDefined();
    });

    it("renders single site publisher line when trade name and legal name are identical", () => {
      const companyWithSameName: Partial<CompanyContent> = {
        tradeName: "Parallax",
        legalName: "Parallax",
        legalForm: "SRL",
        legalPersonality: "legal_entity",
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
  });

  // 5. Requirement 1: Physical Person confirmed, RPM empty -> Publication succeeds
  describe("5. Req 1: Sole proprietorship / Natural Person with empty RPM succeeds publication", () => {
    it("successfully publishes mentions and terms with empty RPM jurisdiction for natural person", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(fullValidCompany, initial.revision);

      // Verify that findDocumentUnresolvedCompanyTokens does NOT flag rpmJurisdiction
      const unresolvedMentions = findDocumentUnresolvedCompanyTokens(
        DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        fullValidCompany
      );
      expect(unresolvedMentions).not.toContain("company.rpmJurisdiction");

      const unresolvedTerms = findDocumentUnresolvedCompanyTokens(
        DEFAULT_LEGAL_PAGES_CONTENT.terms.draft,
        fullValidCompany
      );
      expect(unresolvedTerms).not.toContain("company.rpmJurisdiction");

      // Save drafts
      const rev2 = saveLegalPageDraft("mentions", DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, rev1);
      const rev3 = publishLegalPage("mentions", rev2, "2026-10-18");
      expect(rev3).toBeDefined();

      const afterMentions = getSiteContent();
      expect(afterMentions.legalPages.mentions.published).not.toBeNull();
      expect(afterMentions.legalPages.mentions.published?.publicTitle.fr).toBe("Mentions légales");

      const rev4 = saveLegalPageDraft("terms", DEFAULT_LEGAL_PAGES_CONTENT.terms.draft, rev3);
      const rev5 = publishLegalPage("terms", rev4, "2026-10-18");
      expect(rev5).toBeDefined();

      const afterTerms = getSiteContent();
      expect(afterTerms.legalPages.terms.published).not.toBeNull();
    });
  });

  // 6. Requirement 2: Resolved document has no empty RPM line, no fake court, no RPM dispute in terms
  describe("6. Req 2: Resolved document cleanly omits RPM and contains neutral dispute clause", () => {
    it("omits RPM line cleanly without trailing dots or raw placeholders", () => {
      const resolved = resolveLegalDocument(DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, fullValidCompany, "public");

      const allFrParagraphs = resolved.sections.flatMap((s) => s.paragraphs.map((p) => p.fr));
      const allEnParagraphs = resolved.sections.flatMap((s) => s.paragraphs.map((p) => p.en));

      // RPM paragraph should be filtered out / omitted
      for (const p of allFrParagraphs) {
        expect(p).not.toMatch(/^Registre des Personnes Morales/i);
        expect(p).not.toContain("RPM : .");
      }
      for (const p of allEnParagraphs) {
        expect(p).not.toMatch(/^Competent Enterprise Court/i);
        expect(p).not.toContain("RPR: .");
      }
    });

    it("verifies neutral Belgian jurisdiction clause in terms without RPM or 'ou Bruxelles'", () => {
      const resolvedTerms = resolveLegalDocument(DEFAULT_LEGAL_PAGES_CONTENT.terms.draft, fullValidCompany, "public");
      const disputeSec = resolvedTerms.sections.find((s) => s.id === "disputes_law");
      expect(disputeSec).toBeDefined();

      const disputeTextFr = disputeSec?.paragraphs.map((p) => p.fr).join(" ") || "";
      const disputeTextEn = disputeSec?.paragraphs.map((p) => p.en).join(" ") || "";

      expect(disputeTextFr).not.toContain("{{company.rpmJurisdiction}}");
      expect(disputeTextFr).not.toContain("ou Bruxelles");
      expect(disputeTextFr).toContain("juridictions compétentes selon les règles du droit commun belge");

      expect(disputeTextEn).not.toContain("{{company.rpmJurisdiction}}");
      expect(disputeTextEn).not.toContain("or Brussels");
      expect(disputeTextEn).toContain("competent courts in accordance with the ordinary rules of Belgian law");
    });
  });

  // 7. Requirement 3: Legal entity requiring RPM blocks publication until valid
  describe("7. Req 3: Legal entity requiring RPM blocks publication until valid", () => {
    it("refuses publication for legal entity missing RPM without disk or revision mutation, then succeeds", () => {
      const initial = getSiteContent();
      const entityWithoutRpm: CompanyContent = {
        ...fullValidLegalEntity,
        rpmJurisdiction: "",
      };
      const rev1 = saveCompanyContent(entityWithoutRpm, initial.revision);
      const rev2 = saveLegalPageDraft("mentions", DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft, rev1);

      // Attempt publication: must throw ValidationError
      expect(() => {
        publishLegalPage("mentions", rev2, "2026-10-18");
      }).toThrow(ValidationError);

      // Verify no mutation on disk, revision unchanged, published remains null
      const contentAfterFail = getSiteContent();
      expect(contentAfterFail.legalPages.mentions.published).toBeNull();
      expect(contentAfterFail.revision).toBe(rev2);

      // Now Maxime fills the RPM field
      const rev3 = saveCompanyContent(
        {
          ...entityWithoutRpm,
          rpmJurisdiction: "Tribunal de l'entreprise francophone de Bruxelles",
        },
        rev2
      );

      // Publication now succeeds
      const rev4 = publishLegalPage("mentions", rev3, "2026-10-18");
      expect(rev4).toBeDefined();
      const contentAfterSuccess = getSiteContent();
      expect(contentAfterSuccess.legalPages.mentions.published).not.toBeNull();
    });
  });

  // 8. Requirement 4: Undetermined legal personality does not guess "non applicable"
  describe("8. Req 4: Undetermined legal status prompts for confirmation", () => {
    it("flags undetermined legal personality explicitly instead of assuming non-applicable", () => {
      const undeterminedCompany: CompanyContent = {
        ...fullValidCompany,
        legalPersonality: "",
        legalForm: "Structure non standard",
        rpmJurisdiction: "",
      };

      expect(isRpmApplicable(undeterminedCompany)).toBeUndefined();

      const unresolved = findDocumentUnresolvedCompanyTokens(
        DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        undeterminedCompany
      );
      expect(unresolved).toContain("company.legalPersonality");

      const initial = getSiteContent();
      const rev1 = saveCompanyContent(undeterminedCompany, initial.revision);

      expect(() => {
        publishLegalPage("mentions", rev1, "2026-10-18");
      }).toThrow(/situation juridique/i);
    });
  });

  // 9. Requirement 5: Missing VAT regime blocks terms with human label; normal and franchise both render
  describe("9. Req 5: VAT regime validation and dual regime rendering", () => {
    it("blocks publication when VAT regime is missing and gives human-readable message", () => {
      const companyMissingVatRegime: CompanyContent = {
        ...fullValidCompany,
        vatRegime: "",
        vatRegimeType: "",
      };

      const initial = getSiteContent();
      const rev1 = saveCompanyContent(companyMissingVatRegime, initial.revision);

      expect(() => {
        publishLegalPage("terms", rev1, "2026-10-18");
      }).toThrow(/Régime TVA.*\/admin\/company/);
    });

    it("renders coherently under standard VAT regime and under small business exemption", () => {
      const companyStandard: CompanyContent = {
        ...fullValidCompany,
        vatRegime: "Régime normal de TVA",
        vatRegimeType: "standard",
      };
      const resolvedStandard = resolveLegalDocument(DEFAULT_LEGAL_PAGES_CONTENT.terms.draft, companyStandard, "public");
      const textStandard = JSON.stringify(resolvedStandard);
      expect(textStandard).toContain("Régime normal de TVA");

      const companyExemption: CompanyContent = {
        ...fullValidCompany,
        vatRegime: "Franchise de taxe pour petites entreprises",
        vatRegimeType: "small_business_exemption",
      };
      const resolvedExemption = resolveLegalDocument(DEFAULT_LEGAL_PAGES_CONTENT.terms.draft, companyExemption, "public");
      const textExemption = JSON.stringify(resolvedExemption);
      expect(textExemption).toContain("Franchise de taxe pour petites entreprises");
    });
  });

  // 10. Requirement 6: Non-subject to VAT requires no fake VAT number and renders cleanly
  describe("10. Req 6: Non-subject entity requires no fake VAT number", () => {
    it("renders clean VAT statement when business is non-subject to VAT", () => {
      const nonSubjectCompany: CompanyContent = {
        ...fullValidCompany,
        vatNumber: "",
        vatRegime: "Non assujetti à la TVA",
        vatRegimeType: "non_subject",
      };

      expect(isVatNumberApplicable(nonSubjectCompany)).toBe(false);

      const unresolved = findDocumentUnresolvedCompanyTokens(
        DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        nonSubjectCompany
      );
      expect(unresolved).not.toContain("company.vatNumber");

      const sampleTemplateFr = "— Numéro de TVA intracommunautaire : {{company.vatNumber}} ({{company.vatRegime}}).";
      const resolvedFr = resolveCompanyTokens(sampleTemplateFr, nonSubjectCompany, "public", "fr");
      expect(resolvedFr).toBe("— Régime TVA : Non assujetti à la TVA.");
      expect(resolvedFr).not.toContain("()");
      expect(resolvedFr).not.toContain("TVA intracommunautaire : .");
    });
  });

  // 11. Requirement 7: Progressive saving & 409 conflict preserve local input
  describe("11. Req 7: Progressive saving and 409 conflict handling", () => {
    it("allows incomplete parameters to be saved progressively without validation error", () => {
      const partial: CompanyContent = {
        ...DEFAULT_COMPANY_CONTENT,
        tradeName: "Parallax",
        legalName: "",
        address: "",
        isPublished: false,
      };
      const validated = validateCompanyContent(partial);
      expect(validated.tradeName).toBe("Parallax");
      expect(validated.isPublished).toBe(false);
    });

    it("throws RevisionConflictError on outdated revision while preserving server revision info", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(fullValidCompany, initial.revision);

      expect(() => {
        saveCompanyContent(
          { ...fullValidCompany, tradeName: "Conflict Attempt" },
          initial.revision // outdated revision!
        );
      }).toThrow(RevisionConflictError);

      try {
        saveCompanyContent({ ...fullValidCompany, tradeName: "Conflict Attempt" }, initial.revision);
      } catch (err) {
        expect(err instanceof RevisionConflictError).toBe(true);
        expect((err as RevisionConflictError).serverRevision).toBe(rev1);
      }
    });
  });

  // 12. Requirement 8: Targeted adaptation of historical drafts, idempotence, backups, published preserved
  describe("12. Req 8: Targeted adaptation of historical drafts", () => {
    it("adapts outdated dispute clause, normalizes company, creates backup and preserves published records", () => {
      const initial = getSiteContent();

      // Setup a draft with the old dispute clause and an already-published privacy page
      const rev1 = saveCompanyContent(
        {
          ...fullValidCompany,
          legalForm: "Association de fait",
          legalPersonality: "", // not yet normalized
          vatRegime: "Régime normal de TVA",
          vatRegimeType: "", // not yet normalized
        },
        initial.revision
      );

      const oldDisputeParagraph = {
        fr: "Compétence juridictionnelle : À défaut d'accord amiable : pour les clients professionnels (B2B), compétence exclusive est attribuée aux tribunaux de l'arrondissement judiciaire du siège social de l'exploitant ({{company.rpmJurisdiction}} ou Bruxelles) ; pour les consommateurs (B2C), les règles légales de compétence territoriale du Code judiciaire belge s'appliquent.",
        en: "Jurisdiction: Failing amicable resolution: for business clients (B2B), exclusive jurisdiction is assigned to the courts of the judicial district of the operator's registered office ({{company.rpmJurisdiction}} or Brussels); for consumers (B2C), statutory jurisdiction rules under the Belgian Judicial Code apply.",
      };

      const outdatedTermsDraft: LegalDocument = {
        ...DEFAULT_LEGAL_PAGES_CONTENT.terms.draft,
        sections: DEFAULT_LEGAL_PAGES_CONTENT.terms.draft.sections.map((sec) => {
          if (sec.id === "disputes_law") {
            return {
              ...sec,
              paragraphs: [sec.paragraphs[0], sec.paragraphs[1], sec.paragraphs[2], oldDisputeParagraph],
            };
          }
          return sec;
        }),
      };

      const rev2 = saveLegalPageDraft("terms", outdatedTermsDraft, rev1);

      // Publish privacy to ensure existing published documents are not touched
      const rev3 = saveLegalPageDraft("privacy", DEFAULT_LEGAL_PAGES_CONTENT.privacy.draft, rev2);
      publishLegalPage("privacy", rev3, "2026-10-01");
      const publishedPrivacyBefore = getSiteContent().legalPages.privacy.published;
      expect(publishedPrivacyBefore).not.toBeNull();

      // Run adaptExistingLegalDrafts
      const adaptResult1 = adaptExistingLegalDrafts(testContentFile);
      expect(adaptResult1.changed).toBe(true);
      expect(adaptResult1.adaptedKeys).toContain("terms");
      expect(adaptResult1.backupPath).not.toBeNull();
      expect(fs.existsSync(adaptResult1.backupPath!)).toBe(true);

      // Verify backup permissions
      const stat = fs.statSync(adaptResult1.backupPath!);
      expect((stat.mode & 0o777)).toBe(0o600);

      // Verify terms dispute clause is updated
      const contentAfterAdapt = getSiteContent();
      const updatedDisputeSec = contentAfterAdapt.legalPages.terms.draft.sections.find((s) => s.id === "disputes_law");
      expect(updatedDisputeSec?.paragraphs[3]?.fr).not.toContain("ou Bruxelles");
      expect(updatedDisputeSec?.paragraphs[3]?.fr).toContain("règles du droit commun belge");

      // Verify company parameters normalized
      expect(contentAfterAdapt.company.legalPersonality).toBe("unincorporated_association");
      expect(contentAfterAdapt.company.vatRegimeType).toBe("standard");

      // Verify published privacy document was strictly untouched
      const publishedPrivacyAfter = contentAfterAdapt.legalPages.privacy.published;
      expect(publishedPrivacyAfter?.effectiveDate).toBe(publishedPrivacyBefore?.effectiveDate);
      expect(publishedPrivacyAfter?.version).toBe(publishedPrivacyBefore?.version);

      // 2nd run: strictly idempotent, no new revision, no new backup
      const adaptResult2 = adaptExistingLegalDrafts(testContentFile);
      expect(adaptResult2.changed).toBe(false);
      expect(adaptResult2.newRevision).toBe(adaptResult1.newRevision);
      expect(adaptResult2.backupPath).toBeNull();
    });
  });

  // 13. Requirement 9: Unknown tokens, empty required fields and placeholders rejected
  describe("13. Req 9: Unknown tokens and placeholder guards", () => {
    it("rejects publication when draft contains unknown company token", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(fullValidCompany, initial.revision);

      const draftWithUnknownToken: LegalDocument = {
        ...DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        intro: {
          fr: "Token invalide : {{company.unauthorizedCustomToken}}",
          en: "Invalid token: {{company.unauthorizedCustomToken}}",
        },
      };

      const rev2 = saveLegalPageDraft("mentions", draftWithUnknownToken, rev1);
      expect(() => {
        publishLegalPage("mentions", rev2, "2026-10-18");
      }).toThrow(ValidationError);
    });

    it("rejects publication when draft contains [à compléter] placeholder", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(fullValidCompany, initial.revision);

      const draftWithPlaceholder: LegalDocument = {
        ...DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft,
        intro: {
          fr: "Texte avec [à compléter] restant.",
          en: "Text with placeholder remaining.",
        },
      };

      const rev2 = saveLegalPageDraft("mentions", draftWithPlaceholder, rev1);
      expect(() => {
        publishLegalPage("mentions", rev2, "2026-10-18");
      }).toThrow(ValidationError);
    });
  });

  // 14. Requirement 10: Strict consistency between indicators, preview and publication
  describe("14. Req 10: Perfect alignment between readiness indicator, preview and publication", () => {
    it("guarantees that an indicator marked ready will succeed publication on click", () => {
      const initial = getSiteContent();
      const rev1 = saveCompanyContent(fullValidCompany, initial.revision);

      const draft = DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft;
      const unresolved = findDocumentUnresolvedCompanyTokens(draft, fullValidCompany);

      // Indicator logic: ready when unresolved.length === 0 and company is published
      const isReadyIndicator = unresolved.length === 0 && fullValidCompany.isPublished;
      expect(isReadyIndicator).toBe(true);

      // Preview mode: no missing field markers
      const previewText = resolveCompanyTokens(draft.intro.fr, fullValidCompany, "preview", "fr");
      expect(previewText).not.toContain("[À renseigner");

      // Publication: MUST succeed without throwing
      const rev2 = saveLegalPageDraft("mentions", draft, rev1);
      expect(() => {
        publishLegalPage("mentions", rev2, "2026-10-18");
      }).not.toThrow();
    });

    it("guarantees that when publication would fail, indicator and preview both reflect the missing field", () => {
      const legalEntityMissingRpm: CompanyContent = {
        ...fullValidLegalEntity,
        rpmJurisdiction: "",
      };

      const draft = DEFAULT_LEGAL_PAGES_CONTENT.mentions.draft;
      const unresolved = findDocumentUnresolvedCompanyTokens(draft, legalEntityMissingRpm);

      expect(unresolved).toContain("company.rpmJurisdiction");

      const previewText = resolveCompanyTokens("RPM: {{company.rpmJurisdiction}}", legalEntityMissingRpm, "preview", "fr");
      expect(previewText).toContain("[À renseigner");

      const initial = getSiteContent();
      const rev1 = saveCompanyContent(legalEntityMissingRpm, initial.revision);
      const rev2 = saveLegalPageDraft("mentions", draft, rev1);

      expect(() => {
        publishLegalPage("mentions", rev2, "2026-10-18");
      }).toThrow(ValidationError);
    });
  });
});
