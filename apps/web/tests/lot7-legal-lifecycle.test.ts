import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getSiteContent,
  saveCompanyContent,
  saveLegalPageDraft,
  publishLegalPage,
  unpublishLegalPage,
  ValidationError,
} from "../app/lib/site-content.server";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { action as legalEditAction } from "../app/routes/admin/legal-edit";
import type { LegalDocument } from "../app/lib/site-content.shared";
import type { ActionFunctionArgs } from "react-router";

const makeActionArgs = (req: Request, params: Record<string, string>): ActionFunctionArgs =>
  ({
    request: req,
    params,
    context: {} as never,
  }) as unknown as ActionFunctionArgs;

async function getAdminSessionCookie(csrfToken = "csrf-legal-test"): Promise<string> {
  const session = await getSession();
  session.set("adminId", "admin-test");
  session.set("credentialVersion", computeCredentialVersion());
  session.set("expiresAt", Date.now() + 3600_000);
  session.set("csrfToken", csrfToken);
  return commitSession(session);
}

describe("Lot 7 - Legal Pages Lifecycle (Draft / Publish / Unpublish)", () => {
  let tempDir: string;
  let testContentFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-lot7-legal-"));
    testContentFile = path.join(tempDir, "site-content.json");
    process.env.SITE_CONTENT_PATH = testContentFile;
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
    process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret-at-least-32-chars-long";
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long";
    process.env.RATE_LIMIT_DB_PATH = path.join(tempDir, "rate-limit.db");
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("saving draft modifies only draft and leaves published document untouched", () => {
    const initial = getSiteContent();

    // First, publish a clean version of privacy
    const cleanPrivacyDraft: LegalDocument = {
      ...initial.legalPages.privacy.draft,
      publicTitle: { fr: "Politique de confidentialité", en: "Privacy Policy" },
      seoTitle: { fr: "Confidentialité — Parallax", en: "Privacy — Parallax" },
      seoDescription: { fr: "Protection des données", en: "Data protection" },
      intro: { fr: "Introduction conforme", en: "Compliant intro" },
      effectiveDate: "2026-10-15",
      sections: [
        {
          id: "general",
          title: { fr: "Général", en: "General" },
          paragraphs: [{ fr: "Paragraphe valide", en: "Valid paragraph" }],
        },
      ],
    };

    const rev1 = saveLegalPageDraft("privacy", cleanPrivacyDraft, initial.revision);
    const pubRev = publishLegalPage("privacy", rev1, "2026-10-15");

    const contentPublished = getSiteContent();
    expect(contentPublished.legalPages.privacy.published).toBeDefined();
    expect(contentPublished.legalPages.privacy.published?.version).toBe(1);
    expect(contentPublished.legalPages.privacy.published?.effectiveDate).toBe("2026-10-15");

    // Now edit the draft with work-in-progress modifications
    const wipDraft: LegalDocument = {
      ...cleanPrivacyDraft,
      publicTitle: { fr: "Brouillon en cours", en: "WIP Draft" },
      sections: [
        {
          id: "general",
          title: { fr: "Général modifié", en: "Modified General" },
          paragraphs: [{ fr: "Nouveau texte brouillon", en: "New draft text" }],
        },
      ],
    };

    const draftRev = saveLegalPageDraft("privacy", wipDraft, pubRev);
    expect(draftRev).toBeDefined();
    const contentAfterDraftSave = getSiteContent();

    // Draft reflects WIP changes
    expect(contentAfterDraftSave.legalPages.privacy.draft.publicTitle.fr).toBe("Brouillon en cours");

    // Published document remains strictly unchanged at version 1!
    expect(contentAfterDraftSave.legalPages.privacy.published?.publicTitle.fr).toBe("Politique de confidentialité");
    expect(contentAfterDraftSave.legalPages.privacy.published?.sections[0].title.fr).toBe("Général");
    expect(contentAfterDraftSave.legalPages.privacy.published?.version).toBe(1);
  });

  it("publishLegalPage strictly rejects documents containing unresolved placeholders", () => {
    const initial = getSiteContent();

    // Draft containing "[à compléter]" placeholder
    const placeholderDraft: LegalDocument = {
      ...initial.legalPages.terms.draft,
      publicTitle: { fr: "Conditions générales", en: "Terms of service" },
      seoTitle: { fr: "CGV — Parallax", en: "Terms — Parallax" },
      seoDescription: { fr: "Conditions de vente", en: "Terms of sale" },
      intro: { fr: "Intro valide", en: "Valid intro" },
      sections: [
        {
          id: "pricing",
          title: { fr: "Prix et modalités", en: "Pricing" },
          paragraphs: [{ fr: "Acompte de [à compléter] à la commande", en: "Deposit of [to complete]" }],
        },
      ],
    };

    const draftRev = saveLegalPageDraft("terms", placeholderDraft, initial.revision);

    // Publishing must fail with ValidationError
    expect(() => {
      publishLegalPage("terms", draftRev, "2026-10-15");
    }).toThrow(ValidationError);
  });

  it("publishLegalPage for mentions requires confirmed company identity with address and BCE", () => {
    const initial = getSiteContent();

    // Company is initially unconfirmed or missing address
    const cleanMentionsDraft: LegalDocument = {
      ...initial.legalPages.mentions.draft,
      publicTitle: { fr: "Mentions légales", en: "Legal notice" },
      seoTitle: { fr: "Mentions légales — Parallax", en: "Legal notice — Parallax" },
      seoDescription: { fr: "Informations éditeur", en: "Publisher info" },
      intro: { fr: "Éditeur du site", en: "Site publisher" },
      sections: [
        {
          id: "editor",
          title: { fr: "Éditeur", en: "Publisher" },
          paragraphs: [{ fr: "Présentation de la société", en: "Company presentation" }],
        },
      ],
    };

    const draftRev = saveLegalPageDraft("mentions", cleanMentionsDraft, initial.revision);

    // Company is not published/confirmed yet
    expect(() => {
      publishLegalPage("mentions", draftRev, "2026-10-15");
    }).toThrow(ValidationError);

    // Confirm and complete company
    const revWithCompany = saveCompanyContent(
      {
        ...initial.company,
        tradeName: "Parallax",
        legalName: "Parallax SRL",
        legalForm: "SRL",
        address: "Rue de Namur 10, 1000 Bruxelles",
        enterpriseNumber: "0123.456.789",
        rpmJurisdiction: "Bruxelles",
        publicationDirector: "Maxime",
        hostingProvider: "Infomaniak SA",
        hostingAddress: "Rue Eugène-Marziano 25, 1227 Genève, Suisse",
        isPublished: true,
      },
      draftRev
    );

    // Now publication succeeds!
    const pubRev = publishLegalPage("mentions", revWithCompany, "2026-10-15");
    const reloaded = getSiteContent();
    expect(reloaded.revision).toBe(pubRev);
    expect(reloaded.legalPages.mentions.published).toBeDefined();
    expect(reloaded.legalPages.mentions.published?.version).toBe(1);
  });

  it("unpublishLegalPage sets published to null while preserving draft", () => {
    const initial = getSiteContent();

    // Setup published privacy page
    const cleanDraft: LegalDocument = {
      ...initial.legalPages.privacy.draft,
      publicTitle: { fr: "Confidentialité", en: "Privacy" },
      seoTitle: { fr: "Confidentialité — Parallax", en: "Privacy — Parallax" },
      seoDescription: { fr: "Protection des données", en: "Data protection" },
      intro: { fr: "Introduction", en: "Introduction" },
      effectiveDate: "2026-10-15",
      sections: [
        {
          id: "data",
          title: { fr: "Données", en: "Data" },
          paragraphs: [{ fr: "Collecte minimale", en: "Minimal collection" }],
        },
      ],
    };

    const rev1 = saveLegalPageDraft("privacy", cleanDraft, initial.revision);
    const pubRev = publishLegalPage("privacy", rev1, "2026-10-15");

    // Unpublish
    const unpubRev = unpublishLegalPage("privacy", pubRev);
    const reloaded = getSiteContent();

    expect(reloaded.revision).toBe(unpubRev);
    expect(reloaded.legalPages.privacy.published).toBeNull();
    expect(reloaded.legalPages.privacy.draft.publicTitle.fr).toBe("Confidentialité");
    expect(reloaded.legalPages.privacy.draft.sections[0].paragraphs[0].fr).toBe("Collecte minimale");
  });

  it("admin legal edit HTTP action handles save_draft, publish, and unpublish", async () => {
    const initial = getSiteContent();
    const sessionCookie = await getAdminSessionCookie("csrf-legal-test");

    const validDraft: LegalDocument = {
      ...initial.legalPages.cookies.draft,
      publicTitle: { fr: "Politique cookies", en: "Cookie Policy" },
      seoTitle: { fr: "Cookies — Parallax", en: "Cookies — Parallax" },
      seoDescription: { fr: "Traceurs et choix", en: "Trackers and choices" },
      intro: { fr: "Informations traceurs", en: "Tracker information" },
      sections: [
        {
          id: "intro-sec",
          title: { fr: "Traceurs stricts", en: "Strict trackers" },
          paragraphs: [{ fr: "Fonctionnels uniquement", en: "Functional only" }],
        },
      ],
    };

    // 1. save_draft
    const saveReq = new Request("http://127.0.0.1:3000/admin/legal/cookies", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrfToken: "csrf-legal-test",
        revision: initial.revision,
        intent: "save_draft",
        draftData: JSON.stringify(validDraft),
      }).toString(),
    });

    const saveRes = await legalEditAction(makeActionArgs(saveReq, { pageKey: "cookies" }));
    expect(saveRes.status).toBe(200);
    const saveJson = await saveRes.json();
    expect(saveJson.success).toBe(true);
    expect(saveJson.action).toBe("save_draft");
    const revAfterSave = saveJson.newRevision;

    // 2. publish
    const pubReq = new Request("http://127.0.0.1:3000/admin/legal/cookies", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrfToken: "csrf-legal-test",
        revision: revAfterSave,
        intent: "publish",
        effectiveDate: "2026-10-15",
      }).toString(),
    });

    const pubRes = await legalEditAction(makeActionArgs(pubReq, { pageKey: "cookies" }));
    expect(pubRes.status).toBe(200);
    const pubJson = await pubRes.json();
    expect(pubJson.success).toBe(true);
    expect(pubJson.action).toBe("publish");
    const revAfterPub = pubJson.newRevision;

    // 3. unpublish
    const unpubReq = new Request("http://127.0.0.1:3000/admin/legal/cookies", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrfToken: "csrf-legal-test",
        revision: revAfterPub,
        intent: "unpublish",
      }).toString(),
    });

    const unpubRes = await legalEditAction(makeActionArgs(unpubReq, { pageKey: "cookies" }));
    expect(unpubRes.status).toBe(200);
    const unpubJson = await unpubRes.json();
    expect(unpubJson.success).toBe(true);
    expect(unpubJson.action).toBe("unpublish");
    expect(unpubJson.pageRecord.published).toBeNull();
  });
});
