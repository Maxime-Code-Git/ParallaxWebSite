import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getSiteContent,
  saveCompanyContent,
  saveContactPageContent,
  RevisionConflictError,
  ValidationError,
} from "../app/lib/site-content.server";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { action as companyAction } from "../app/routes/admin/company";
import type { CompanyContent } from "../app/lib/site-content.shared";
import type { ActionFunctionArgs } from "react-router";

const makeActionArgs = (req: Request): ActionFunctionArgs =>
  ({
    request: req,
    params: {},
    context: {} as never,
  }) as unknown as ActionFunctionArgs;

async function getAdminSessionCookie(csrfToken = "csrf-token-company-test"): Promise<string> {
  const session = await getSession();
  session.set("adminId", "admin-test");
  session.set("credentialVersion", computeCredentialVersion());
  session.set("expiresAt", Date.now() + 3600_000);
  session.set("csrfToken", csrfToken);
  return commitSession(session);
}

describe("Lot 7 - Company Administration & Coordinate Synchronization", () => {
  let tempDir: string;
  let testContentFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-lot7-company-"));
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

  it("synchronizes company coordinates with common.brandName, home.contact and contactPage.card canonically", () => {
    const initial = getSiteContent();

    const companyUpdate: CompanyContent = {
      ...initial.company,
      tradeName: "Parallax Creative Lab",
      email: "hello@parallax-lab.be",
      phone: "+32 470 99 88 77",
      instagramUrl: "https://instagram.com/parallax_lab",
      youtubeUrl: "https://youtube.com/@parallax_lab",
      legalName: "Parallax SPRL en liquidation",
      legalForm: "SPRL",
      address: "Avenue Louise 100, 1050 Bruxelles",
      enterpriseNumber: "0888.999.111",
      vatNumber: "BE 0888.999.111",
      publicationDirector: "Maxime",
      hostingProvider: "Infomaniak SA",
      hostingAddress: "Rue Eugène-Marziano 25, 1227 Genève, Suisse",
      isPublished: true,
    };

    const newRev = saveCompanyContent(companyUpdate, initial.revision);
    expect(newRev).not.toBe(initial.revision);

    const reloaded = getSiteContent();
    expect(reloaded.company.tradeName).toBe("Parallax Creative Lab");
    expect(reloaded.common.brandName).toBe("Parallax Creative Lab");
    expect(reloaded.home.contact.email).toBe("hello@parallax-lab.be");
    expect(reloaded.company.email).toBe("hello@parallax-lab.be");
    expect(reloaded.home.contact.instagramUrl).toBe("https://instagram.com/parallax_lab");
    expect(reloaded.home.contact.youtubeUrl).toBe("https://youtube.com/@parallax_lab");
    expect(reloaded.contactPage.card.phone).toBe("+32 470 99 88 77");
    expect(reloaded.company.phone).toBe("+32 470 99 88 77");
  });

  it("saving contactPage content syncs public phone and coordinates to company within the same revision", () => {
    const initial = getSiteContent();

    const contactUpdate = {
      ...initial.contactPage,
      card: {
        ...initial.contactPage.card,
        phone: "+32 2 555 44 33",
      },
    };

    const newRev = saveContactPageContent(contactUpdate, initial.revision, {
      email: "synced-from-contact@parallax.be",
      instagramUrl: "https://instagram.com/synced_ig",
      youtubeUrl: "https://youtube.com/@synced_yt",
    });

    const reloaded = getSiteContent();
    expect(reloaded.revision).toBe(newRev);
    expect(reloaded.company.phone).toBe("+32 2 555 44 33");
    expect(reloaded.company.email).toBe("synced-from-contact@parallax.be");
    expect(reloaded.home.contact.email).toBe("synced-from-contact@parallax.be");
    expect(reloaded.company.instagramUrl).toBe("https://instagram.com/synced_ig");
    expect(reloaded.company.youtubeUrl).toBe("https://youtube.com/@synced_yt");
  });

  it("does not mutate or alter SMTP environment variables during company updates", () => {
    process.env.CONTACT_TO_EMAIL = "target@parallax.be";
    process.env.CONTACT_FROM_EMAIL = "sender@parallax.be";

    const initial = getSiteContent();
    const companyUpdate: CompanyContent = {
      ...initial.company,
      email: "displayed-only@parallax.be",
    };

    saveCompanyContent(companyUpdate, initial.revision);

    expect(process.env.CONTACT_TO_EMAIL).toBe("target@parallax.be");
    expect(process.env.CONTACT_FROM_EMAIL).toBe("sender@parallax.be");
  });

  it("validates Belgian phone formats accepting 0 or +32 prefixes", () => {
    // Valid Belgian formats
    const validPhones = [
      "+32 470 12 34 56",
      "0470 12 34 56",
      "0470/12.34.56",
      "+32 (0) 2 123 45 67",
      "02 123 45 67",
    ];

    for (const phone of validPhones) {
      const current = getSiteContent();
      expect(() => {
        saveCompanyContent({ ...current.company, phone }, current.revision);
      }).not.toThrow();
    }

    // Invalid phone format
    const current = getSiteContent();
    expect(() => {
      saveCompanyContent({ ...current.company, phone: "invalid-phone" }, current.revision);
    }).toThrow(ValidationError);
  });

  it("enforces revision conflict protection (409) with serverRevision on concurrent save", () => {
    const initial = getSiteContent();

    // First save advances revision
    const rev1 = saveCompanyContent(
      { ...initial.company, tradeName: "Rev 1" },
      initial.revision
    );

    // Second save with stale revision fails with RevisionConflictError
    try {
      saveCompanyContent(
        { ...initial.company, tradeName: "Rev 2 Concurrent" },
        initial.revision
      );
      expect.unreachable("Should have thrown RevisionConflictError");
    } catch (err) {
      expect(err).toBeInstanceOf(RevisionConflictError);
      expect((err as RevisionConflictError).serverRevision).toBe(rev1);
    }
  });

  it("admin company HTTP action validates Method, Origin, CSRF, and handles 409 conflict", async () => {
    const initial = getSiteContent();
    const sessionCookie = await getAdminSessionCookie("csrf-token-company-test");

    // 1. Method Not Allowed (GET)
    const getReq = new Request("http://127.0.0.1:3000/admin/company", {
      method: "GET",
      headers: { Cookie: sessionCookie },
    });
    const getRes = await companyAction(makeActionArgs(getReq));
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get("Allow")).toBe("POST");

    // 2. Invalid Origin (403)
    const badOriginReq = new Request("http://127.0.0.1:3000/admin/company", {
      method: "POST",
      headers: {
        Origin: "https://malicious-site.com",
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "csrfToken=csrf-token-company-test",
    });
    const badOriginRes = await companyAction(makeActionArgs(badOriginReq));
    expect(badOriginRes.status).toBe(403);

    // 3. Invalid CSRF (403)
    const badCsrfReq = new Request("http://127.0.0.1:3000/admin/company", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrfToken: "wrong-csrf-token",
        revision: initial.revision,
        companyData: JSON.stringify(initial.company),
      }).toString(),
    });
    const badCsrfRes = await companyAction(makeActionArgs(badCsrfReq));
    expect(badCsrfRes.status).toBe(403);

    // 4. Valid save (200)
    const validReq = new Request("http://127.0.0.1:3000/admin/company", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrfToken: "csrf-token-company-test",
        revision: initial.revision,
        companyData: JSON.stringify({
          ...initial.company,
          tradeName: "Parallax Action Test",
        }),
      }).toString(),
    });
    const validRes = await companyAction(makeActionArgs(validReq));
    expect(validRes.status).toBe(200);
    const validJson = await validRes.json();
    expect(validJson.success).toBe(true);
    expect(validJson.newRevision).toBeDefined();

    // 5. Concurrent edit returns 409
    const concurrentReq = new Request("http://127.0.0.1:3000/admin/company", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3000",
        Cookie: sessionCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrfToken: "csrf-token-company-test",
        revision: initial.revision, // Stale!
        companyData: JSON.stringify({
          ...initial.company,
          tradeName: "Parallax Concurrent",
        }),
      }).toString(),
    });
    const conflictRes = await companyAction(makeActionArgs(concurrentReq));
    expect(conflictRes.status).toBe(409);
    const conflictJson = await conflictRes.json();
    expect(conflictJson.conflict).toBe(true);
    expect(conflictJson.serverRevision).toBe(validJson.newRevision);
  });
});
