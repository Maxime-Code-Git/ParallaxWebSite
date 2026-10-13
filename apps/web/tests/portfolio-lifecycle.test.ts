import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { loader as portfolioPublicLoader } from "../app/routes/public/portfolio";
import { loader as adminPortfolioLoader, action as adminPortfolioAction } from "../app/routes/admin/portfolio";
import { action as adminPortfolioEditAction } from "../app/routes/admin/portfolio-edit";
import { action as adminPortfolioSectionAction } from "../app/routes/admin/portfolio-section";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { cleanupUnreferencedPortfolioMedia } from "../app/lib/portfolio-content.server";
import { getRawSiteContent } from "../app/lib/site-content.server";
import {
  type PortfolioContent,
  calculateEffectiveSide,
} from "../app/lib/portfolio-content.shared";

describe("Portfolio Lifecycle & Cross-Storage Segregation (Lot 3)", () => {
  let tempDir: string;
  let testPortfolioContent: string;
  let testPortfolioMedia: string;
  let testSiteContent: string;
  let testSiteMedia: string;
  let testDbFile: string;
  const originalEnv = process.env;

  const makeLoaderArgs = (req: Request, params: Record<string, string> = {}): LoaderFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as LoaderFunctionArgs;

  const makeActionArgs = (req: Request, params: Record<string, string> = {}): ActionFunctionArgs =>
    ({
      request: req,
      params,
      context: {} as never,
    }) as unknown as ActionFunctionArgs;

  async function createAuthenticatedAdminRequest(
    method = "GET",
    url = "http://localhost:3000/admin/portfolio",
    body?: BodyInit,
    headers: Record<string, string> = {}
  ): Promise<{ request: Request; sessionCookie: string; csrfToken: string }> {
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    const csrfToken = "test-csrf-token-1234567890abcdef";
    session.set("csrfToken", csrfToken);
    const sessionCookie = await commitSession(session);

    const reqHeaders = new Headers({
      Cookie: sessionCookie,
      Origin: "http://localhost:3000",
      ...headers,
    });

    const request = new Request(url, {
      method,
      headers: reqHeaders,
      body,
    });

    return { request, sessionCookie, csrfToken };
  }

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-portfolio-lifecycle-"));
    testPortfolioContent = path.join(tempDir, "portfolio-content.json");
    testPortfolioMedia = path.join(tempDir, "portfolio-media");
    testSiteContent = path.join(tempDir, "site-content.json");
    testSiteMedia = path.join(tempDir, "site-media");
    testDbFile = path.join(tempDir, "rate-limit.sqlite");

    fs.mkdirSync(testPortfolioMedia, { mode: 0o700, recursive: true });
    fs.mkdirSync(testSiteMedia, { mode: 0o700, recursive: true });

    // Seed dummy site media to test isolation
    const siteDummyDir = path.join(testSiteMedia, "site/duo/site-duo-uuid/640p");
    fs.mkdirSync(siteDummyDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(siteDummyDir, "webp"), "site-media-data", { mode: 0o600 });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      RATE_LIMIT_SECRET: "rate-limit-secret-min-32-chars-long-2!",
      RATE_LIMIT_DB_PATH: testDbFile,
      SITE_CONTENT_PATH: testSiteContent,
      SITE_MEDIA_PATH: testSiteMedia,
      PORTFOLIO_CONTENT_PATH: testPortfolioContent,
      PORTFOLIO_MEDIA_PATH: testPortfolioMedia,
      TRUST_PROXY: "false",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("Step 1 & 2: creates projects in admin, publishes some, keeps a draft, and verifies draft secrecy", async () => {
    // 1. Loader initializes default content
    const { request: adminReq } = await createAuthenticatedAdminRequest();
    const adminLoaderRes = await adminPortfolioLoader(makeLoaderArgs(adminReq));
    const adminData = (await adminLoaderRes.json()) as { content: PortfolioContent };
    expect(adminData.content.sections.documentary).toBeDefined();

    // 2. Create Documentary project
    const fdDoc = new FormData();
    fdDoc.set("intent", "create");
    fdDoc.set("category", "documentary");
    fdDoc.set("revision", adminData.content.revision);
    fdDoc.set("csrfToken", "test-csrf-token-1234567890abcdef");

    const { request: createDocReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      fdDoc
    );
    const createDocRes = await adminPortfolioAction(makeActionArgs(createDocReq));
    const createDocData = (await createDocRes.json()) as { success: string; createdId: string; newRevision: string };
    expect(createDocData.createdId).toBeDefined();

    // 3. Create Advertising project
    const fdPub = new FormData();
    fdPub.set("intent", "create");
    fdPub.set("category", "advertising");
    fdPub.set("revision", createDocData.newRevision);
    fdPub.set("csrfToken", "test-csrf-token-1234567890abcdef");

    const { request: createPubReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio",
      fdPub
    );
    const createPubRes = await adminPortfolioAction(makeActionArgs(createPubReq));
    const createPubData = (await createPubRes.json()) as { createdId: string; newRevision: string };

    // 4. Edit and publish Documentary project
    const docId = createDocData.createdId;
    const fdEditDoc = new FormData();
    fdEditDoc.set("revision", createPubData.newRevision);
    fdEditDoc.set("csrfToken", "test-csrf-token-1234567890abcdef");
    fdEditDoc.set("category", "documentary");
    fdEditDoc.set("status", "published");
    fdEditDoc.set("slugFr", "foret-ancestrale");
    fdEditDoc.set("slugEn", "ancient-forest");
    fdEditDoc.set("titleFr", "Forêt Ancestrale");
    fdEditDoc.set("titleEn", "Ancient Forest");
    fdEditDoc.set("summaryFr", "Un documentaire sur la nature.");
    fdEditDoc.set("summaryEn", "A documentary about nature.");
    fdEditDoc.set("descriptionFr", "Premier paragraphe.");
    fdEditDoc.set("descriptionEn", "First paragraph.");
    fdEditDoc.set("seoTitleFr", "Forêt Ancestrale — Film");
    fdEditDoc.set("seoTitleEn", "Ancient Forest — Film");
    fdEditDoc.set("seoDescFr", "Découvrez notre documentaire.");
    fdEditDoc.set("seoDescEn", "Discover our documentary.");
    fdEditDoc.set("coverImageId", "");
    fdEditDoc.set("coverAltFr", "Forêt");
    fdEditDoc.set("coverAltEn", "Forest");
    fdEditDoc.set("videoUrl", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    fdEditDoc.set("videoCoverImageId", "");
    fdEditDoc.set("galleryImageIds", "[]");
    fdEditDoc.set("showcase", "true");
    fdEditDoc.set("side", "left");
    fdEditDoc.set("order", "0");

    const { request: editDocReq } = await createAuthenticatedAdminRequest(
      "POST",
      `http://localhost:3000/admin/portfolio/${docId}`,
      fdEditDoc
    );
    const editDocRes = await adminPortfolioEditAction(makeActionArgs(editDocReq, { id: docId }));
    const editDocData = (await editDocRes.json()) as { success: string; newRevision: string };
    expect(editDocData.success).toBeDefined();

    // The advertising project remains draft!
    // Verify public loader shows ONLY published project
    const pubReq = new Request("http://localhost:3000/fr/projets");
    const pubRes = await portfolioPublicLoader(makeLoaderArgs(pubReq));
    const pubData = (await pubRes.json()) as {
      showcaseProjects: Array<{ id: string; slugFr: string }>;
      content: PortfolioContent;
    };

    expect(pubData.showcaseProjects.length).toBe(1);
    expect(pubData.showcaseProjects[0].id).toBe(docId);
    expect(pubData.showcaseProjects[0].slugFr).toBe("foret-ancestrale");
    // Ensure draft project ID is not in public showcase or public projects
    expect(pubData.content.projects.some((p) => p.status === "draft")).toBe(false);

    // Direct access to draft project URL returns 404
    const draftDirectReq = new Request("http://localhost:3000/fr/projets/publicite/projet-sans-titre");
    await expect(
      portfolioPublicLoader(
        makeLoaderArgs(draftDirectReq, { rubrique: "publicite", slugFr: "projet-sans-titre" })
      )
    ).rejects.toThrow();
  });

  it("Step 3: verifies alternating showcase and directional panel formula", () => {
    // Mandatory formula: const panelDirection = imageSide === "left" ? "right" : "left";
    const getDirection = (side: "left" | "right") => (side === "left" ? "right" : "left");

    // Row 1: Documentaire (image left) -> open panel from right
    expect(getDirection("left")).toBe("right");

    // Row 2: Publicité (image right) -> open panel from left
    expect(getDirection("right")).toBe("left");

    // Row 3: Publicité (image left) -> open panel from right
    expect(getDirection("left")).toBe("right");

    // Showcase side auto calculation
    expect(calculateEffectiveSide("auto", 0)).toBe("left");
    expect(calculateEffectiveSide("auto", 1)).toBe("right");
    expect(calculateEffectiveSide("auto", 2)).toBe("left");
  });

  it("Step 4 & 5: tests direct section URL access, SSR consistency and FR/EN alternates", async () => {
    // Documentary section route
    const docReq = new Request("http://localhost:3000/fr/projets/documentaire");
    const docRes = await portfolioPublicLoader(makeLoaderArgs(docReq));
    const docData = (await docRes.json()) as {
      lang: string;
      panelState: { isOpen: boolean; activeCategory: string; direction: string };
      alternateUrls: { fr: string; en: string };
    };

    expect(docData.lang).toBe("fr");
    expect(docData.panelState.isOpen).toBe(true);
    expect(docData.panelState.activeCategory).toBe("documentary");
    expect(docData.panelState.direction).toBe("right");
    expect(docData.alternateUrls.fr).toBe("/fr/projets/documentaire");
    expect(docData.alternateUrls.en).toBe("/en/projects/documentary");

    // Advertising section route
    const pubReq = new Request("http://localhost:3000/en/projects/advertising");
    const pubRes = await portfolioPublicLoader(makeLoaderArgs(pubReq));
    const pubData = (await pubRes.json()) as {
      lang: string;
      panelState: { isOpen: boolean; activeCategory: string; direction: string };
      alternateUrls: { fr: string; en: string };
    };

    expect(pubData.lang).toBe("en");
    expect(pubData.panelState.isOpen).toBe(true);
    expect(pubData.panelState.activeCategory).toBe("advertising");
    expect(pubData.panelState.direction).toBe("left");
    expect(pubData.alternateUrls.fr).toBe("/fr/projets/publicite");
    expect(pubData.alternateUrls.en).toBe("/en/projects/advertising");
  });

  it("Step 6: handles 409 revision conflict gracefully without overwriting state", async () => {
    const { request: adminReq } = await createAuthenticatedAdminRequest();
    const adminLoaderRes = await adminPortfolioLoader(makeLoaderArgs(adminReq));
    const adminData = (await adminLoaderRes.json()) as { content: PortfolioContent };
    expect(adminData.content.revision).toBeDefined();

    // Section edit with stale revision
    const fdSection = new FormData();
    fdSection.set("revision", "stale-revision-conflict");
    fdSection.set("csrfToken", "test-csrf-token-1234567890abcdef");
    fdSection.set("title_fr", "Documentaire Modifié");
    fdSection.set("title_en", "Modified Documentary");
    fdSection.set("intro_fr", "Nouvelle intro");
    fdSection.set("intro_en", "New intro");
    fdSection.set("seo_title_fr", "SEO FR");
    fdSection.set("seo_title_en", "SEO EN");
    fdSection.set("seo_desc_fr", "Desc FR");
    fdSection.set("seo_desc_en", "Desc EN");
    fdSection.set("coverImageId", "");
    fdSection.set("coverAlt_fr", "");
    fdSection.set("coverAlt_en", "");
    fdSection.set("showreelTitle_fr", "");
    fdSection.set("showreelTitle_en", "");
    fdSection.set("showreelUrl", "");
    fdSection.set("showreelCoverImageId", "");
    fdSection.set("morePhotosButton_fr", "Plus");
    fdSection.set("morePhotosButton_en", "More");
    fdSection.set("lessPhotosButton_fr", "Moins");
    fdSection.set("lessPhotosButton_en", "Less");
    fdSection.set("backButton_fr", "Retour");
    fdSection.set("backButton_en", "Back");

    const { request: secEditReq } = await createAuthenticatedAdminRequest(
      "POST",
      "http://localhost:3000/admin/portfolio/section/documentary",
      fdSection
    );
    const secRes = await adminPortfolioSectionAction(
      makeActionArgs(secEditReq, { category: "documentary" })
    );

    expect(secRes.status).toBe(409);
    const secData = (await secRes.json()) as { error: string };
    expect(secData.error).toContain("modifie");
  });

  it("Step 7: verifies strict storage separation between Portfolio and Site (Accueil/Studio)", async () => {
    // 1. Verify Site Media directory contains our pre-seeded dummy
    const siteDummyFile = path.join(testSiteMedia, "site/duo/site-duo-uuid/640p/webp");
    expect(fs.existsSync(siteDummyFile)).toBe(true);

    // 2. Trigger portfolio media cleanup
    const cleanupResult = await cleanupUnreferencedPortfolioMedia(
      testPortfolioContent,
      testPortfolioMedia
    );
    expect(cleanupResult.cleanedCount).toBe(0);

    // 3. Verify Site Media was NOT touched or deleted
    expect(fs.existsSync(siteDummyFile)).toBe(true);
    expect(fs.readFileSync(siteDummyFile, "utf-8")).toBe("site-media-data");

    // 4. Verify Site Content remains intact
    const siteContent = getRawSiteContent();
    expect(siteContent.content.home.hero.title.fr).toBeDefined();
  });
});
