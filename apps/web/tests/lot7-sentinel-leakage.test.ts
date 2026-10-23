import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getSiteContent,
  getPublicCompanyContent,
  saveCompanyContent,
  saveLegalPageDraft,
} from "../app/lib/site-content.server";
import { handleContactLoader } from "../app/lib/contact.server";
import { loader as legalRouteLoader, meta as legalRouteMeta, type LegalPageLoaderData } from "../app/routes/public/legal-page";
import type { LegalDocument } from "../app/lib/site-content.shared";
import type { LoaderFunctionArgs } from "react-router";

type MetaTag = {
  name?: string;
  content?: string;
};

const makeLoaderArgs = (req: Request): LoaderFunctionArgs =>
  ({
    request: req,
    params: {},
    context: {} as never,
  }) as unknown as LoaderFunctionArgs;

describe("Lot 7 - Private Draft & Identity Sentinel Leakage Prevention", () => {
  let tempDir: string;
  let testContentFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  const PRIVATE_ADDRESS_SENTINEL = "SENTINEL_PRIVATE_ADDRESS_PARALLAX_CONFIDENTIAL_12345";
  const PRIVATE_BCE_SENTINEL = "SENTINEL_BCE_0999_888_777_SECRET";
  const PRIVATE_DRAFT_SENTINEL = "SENTINEL_DRAFT_UNPUBLISHED_LEGAL_TEXT_PRIVATE_98765";

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-lot7-sentinel-"));
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

  it("never leaks unpublished drafts or unconfirmed company identity into Contact loader payloads", async () => {
    const initial = getSiteContent();

    // 1. Inject private sentinels into company draft (unconfirmed)
    const rev1 = saveCompanyContent(
      {
        ...initial.company,
        address: PRIVATE_ADDRESS_SENTINEL,
        enterpriseNumber: PRIVATE_BCE_SENTINEL,
        isPublished: false, // NOT published!
      },
      initial.revision
    );

    // 2. Inject draft sentinel into legal pages drafts
    const draftWithSentinel: LegalDocument = {
      ...initial.legalPages.privacy.draft,
      intro: {
        fr: PRIVATE_DRAFT_SENTINEL,
        en: "Private EN Draft",
      },
      sections: [
        {
          id: "sec1",
          title: { fr: "Secret Section", en: "Secret Section" },
          paragraphs: [{ fr: PRIVATE_DRAFT_SENTINEL, en: "Paragraph secret" }],
        },
      ],
    };
    saveLegalPageDraft("privacy", draftWithSentinel, rev1);

    // 3. Call public Contact loader
    const contactReq = new Request("http://127.0.0.1:3000/fr/contact", {
      method: "GET",
    });
    const contactResponse = await handleContactLoader(makeLoaderArgs(contactReq));
    const contactLoaderResult = contactResponse as unknown as {
      data: {
        content: {
          common?: unknown;
          contactPage?: unknown;
          company?: unknown;
          legalPages?: unknown;
        };
      };
    };
    const contactData = contactLoaderResult.data;
    const serializedContactPayload = JSON.stringify(contactData);

    // 4. Assert NONE of the sentinel strings exist in the Contact loader output
    expect(serializedContactPayload).not.toContain(PRIVATE_ADDRESS_SENTINEL);
    expect(serializedContactPayload).not.toContain(PRIVATE_BCE_SENTINEL);
    expect(serializedContactPayload).not.toContain(PRIVATE_DRAFT_SENTINEL);

    // Verify contact only has public coordinates
    expect(contactData.content.common).toBeDefined();
    expect(contactData.content.contactPage).toBeDefined();
    expect(contactData.content.company).toBeUndefined();
    expect(contactData.content.legalPages).toBeUndefined();
  });

  it("never leaks unpublished draft text in public legal route loader, returning null and noindex", async () => {
    const initial = getSiteContent();

    // Inject sentinel in unpublished privacy draft
    const draftWithSentinel: LegalDocument = {
      ...initial.legalPages.privacy.draft,
      intro: { fr: PRIVATE_DRAFT_SENTINEL, en: "EN Sentinel" },
    };
    saveLegalPageDraft("privacy", draftWithSentinel, initial.revision);

    // Request public /fr/confidentialite
    const req = new Request("http://127.0.0.1:3000/fr/confidentialite", {
      method: "GET",
    });
    const response = await legalRouteLoader(makeLoaderArgs(req));
    const loaderResult = response as unknown as { data: LegalPageLoaderData; init?: { headers?: HeadersInit } };
    const data = loaderResult.data;
    const serializedPayload = JSON.stringify(data);

    // Sentinel must NOT be in public payload
    expect(serializedPayload).not.toContain(PRIVATE_DRAFT_SENTINEL);
    expect(data.document).toBeNull();

    // Headers must prevent shared caching of unpublished state
    const headers = new Headers(loaderResult.init?.headers);
    expect(headers.get("Cache-Control")).toContain("private");

    // Meta tags must enforce noindex, nofollow
    const metaTags = legalRouteMeta({ data }) as MetaTag[];
    const robotsTag = metaTags.find((tag) => tag.name === "robots");
    expect(robotsTag).toBeDefined();
    expect(robotsTag?.content).toBe("noindex, nofollow");
  });

  it("getPublicCompanyContent strips private registered address and enterprise number when unconfirmed", () => {
    const initial = getSiteContent();

    saveCompanyContent(
      {
        ...initial.company,
        address: PRIVATE_ADDRESS_SENTINEL,
        enterpriseNumber: PRIVATE_BCE_SENTINEL,
        tradeName: "Parallax Public Brand",
        email: "contact@parallax.be",
        phone: "+32 470 00 11 22",
        isPublished: false,
      },
      initial.revision
    );

    const publicCompany = getPublicCompanyContent();
    const serialized = JSON.stringify(publicCompany);

    expect(serialized).not.toContain(PRIVATE_ADDRESS_SENTINEL);
    expect(serialized).not.toContain(PRIVATE_BCE_SENTINEL);
    expect(publicCompany.address).toBeUndefined();
    expect(publicCompany.enterpriseNumber).toBeUndefined();

    // Public coordinates remain available
    expect(publicCompany.tradeName).toBe("Parallax Public Brand");
    expect(publicCompany.email).toBe("contact@parallax.be");
    expect(publicCompany.phone).toBe("+32 470 00 11 22");
    expect(publicCompany.isPublished).toBe(false);
  });
});
