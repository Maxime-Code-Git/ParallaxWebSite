import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import React from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

// Mock react-router for component rendering tests
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useActionData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    useLocation: vi.fn(() => ({ pathname: "/fr/projets", search: "" })),
    useNavigate: vi.fn(() => vi.fn()),
    Form: ({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => (
      <form {...props}>{children}</form>
    ),
    Link: ({ children, to, ...props }: { children: React.ReactNode; to: string; [key: string]: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

import { useLoaderData, useActionData } from "react-router";
import PortfolioPage, { loader as publicPortfolioLoader } from "../app/routes/public/portfolio";
import AdminPortfolioPage, { action as adminPortfolioAction } from "../app/routes/admin/portfolio";
import { action as adminPortfolioSectionAction } from "../app/routes/admin/portfolio-section";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import {
  getRawPortfolioContent,
  savePortfolioContent,
} from "../app/lib/portfolio-content.server";
import {
  type PortfolioCategoryItem,
  type PortfolioProject,
  type PortfolioContent,
} from "../app/lib/portfolio-content.shared";
import { ValidationError } from "../app/lib/site-content.server";
import { getBackups } from "../app/lib/atomic-fs.server";

describe("Dynamic Portfolio Categories — Targeted Fixes Verification", () => {
  let tempDir: string;
  let testPortfolioContentPath: string;
  let testPortfolioMediaPath: string;
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
    method: string,
    url: string,
    body?: URLSearchParams | FormData | string | Buffer,
    headers: Record<string, string> = {}
  ): Promise<{ request: Request; sessionCookie: string }> {
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    session.set("csrfToken", "test-csrf-token-targeted-fixes");
    const cookie = await commitSession(session);

    const reqHeaders = new Headers({
      Cookie: cookie,
      Origin: "http://localhost:3000",
      ...headers,
    });

    let reqBody: BodyInit | undefined = undefined;
    if (body instanceof URLSearchParams) {
      reqHeaders.set("Content-Type", "application/x-www-form-urlencoded");
      reqBody = body.toString();
    } else if (typeof body === "string") {
      reqBody = body;
    } else if (Buffer.isBuffer(body)) {
      reqBody = new Uint8Array(body);
    }

    const request = new Request(url, {
      method,
      headers: reqHeaders,
      body: reqBody,
    });

    return { request, sessionCookie: cookie };
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-targeted-fixes-"));
    testPortfolioContentPath = path.join(tempDir, "portfolio-content.json");
    testPortfolioMediaPath = path.join(tempDir, "media", "portfolio");
    fs.mkdirSync(testPortfolioMediaPath, { recursive: true });

    const testSiteContent = path.join(tempDir, "site-content.json");
    const testSiteMedia = path.join(tempDir, "site-media");
    const testDbFile = path.join(tempDir, "rate-limit.sqlite");
    fs.mkdirSync(testSiteMedia, { recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      APP_URL: "http://localhost:3000",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      RATE_LIMIT_SECRET: "rate-limit-secret-min-32-chars-long-2!",
      RATE_LIMIT_DB_PATH: testDbFile,
      SITE_CONTENT_PATH: testSiteContent,
      SITE_MEDIA_PATH: testSiteMedia,
      PORTFOLIO_CONTENT_PATH: testPortfolioContentPath,
      PORTFOLIO_MEDIA_PATH: testPortfolioMediaPath,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 1. Project links in a new category: no UUID in href & canonical 200
  // ==========================================================================
  describe("1. Project links in a new category", () => {
    it("renders project links using localized category slugs instead of UUIDs, and resolves via public loader", async () => {
      const { content: current } = getRawPortfolioContent(testPortfolioContentPath);

      const sportCatId = "c1111111-1111-4111-8111-111111111111";
      const photoProjId = "b2222222-2222-4222-8222-222222222222";
      const videoProjId = "b3333333-3333-4333-8333-333333333333";
      const photoCoverId = "a2222222-2222-4222-8222-222222222222";
      const videoCoverId = "a3333333-3333-4333-8333-333333333333";

      current.media[photoCoverId] = {
        imageId: photoCoverId,
        ownerType: "project",
        ownerId: photoProjId,
        mediaSlot: "cover",
        originalFormat: "webp",
        originalWidth: 1200,
        originalHeight: 800,
        variants: [{ name: "640p", width: 640, height: 427, webpSize: 1000, avifSize: 800 }],
        createdAt: 1000,
      };
      current.media[videoCoverId] = {
        imageId: videoCoverId,
        ownerType: "project",
        ownerId: videoProjId,
        mediaSlot: "video_cover",
        originalFormat: "webp",
        originalWidth: 1920,
        originalHeight: 1080,
        variants: [{ name: "960p", width: 960, height: 540, webpSize: 1500, avifSize: 1200 }],
        createdAt: 1000,
      };

      const sportCategory: PortfolioCategoryItem = {
        id: sportCatId,
        slugFr: "sport",
        slugEn: "sports",
        slugAliases: { fr: [], en: [] },
        order: 2,
        status: "published",
        title: { fr: "Sport", en: "Sports" },
        intro: { fr: "Intro sport", en: "Sport intro" },
        entrySummary: { fr: "Résumé sport", en: "Sport summary" },
        entrySide: "left",
        seo: { title: { fr: "Sport", en: "Sports" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: null,
        coverAlt: { fr: "Alt", en: "Alt" },
        entryImageId: null,
        entryAlt: { fr: "Alt", en: "Alt" },
        bannerImageId: null,
        bannerAlt: { fr: "Alt", en: "Alt" },
        showreelTitle: { fr: "Showreel", en: "Showreel" },
        showreelVideo: null,
        showreelCoverImageId: null,
        morePhotosButton: { fr: "Voir plus", en: "See more" },
        lessPhotosButton: { fr: "Voir moins", en: "See less" },
        backButton: { fr: "Retour", en: "Back" },
      };

      const photoProj: PortfolioProject = {
        id: photoProjId,
        title: { fr: "Course Alpinisme", en: "Alpine Climb" },
        slugFr: "course-alpinisme",
        slugEn: "alpine-climb",
        category: sportCatId,
        summary: { fr: "Course en haute montagne", en: "High mountain climb" },
        description: [{ type: "paragraph", text: { fr: "Desc", en: "Desc" } }],
        seo: { title: { fr: "Alpinisme", en: "Climbing" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: photoCoverId,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null,
        draftVideoCoverImageId: null,
        presentationMode: "photo",
        aspectRatio: "3:2",
        showcase: false,
        side: "left",
        status: "published",
        order: 0,
        archived: false,
        createdAt: 1000,
        updatedAt: 1000,
      };

      const videoProj: PortfolioProject = {
        id: videoProjId,
        title: { fr: "Descente VTT", en: "Downhill MTB" },
        slugFr: "descente-vtt",
        slugEn: "downhill-mtb",
        category: sportCatId,
        summary: { fr: "VTT extrême", en: "Extreme MTB" },
        description: [{ type: "paragraph", text: { fr: "Desc", en: "Desc" } }],
        seo: { title: { fr: "VTT", en: "MTB" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: videoCoverId,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: {
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          coverImageId: videoCoverId,
        },
        draftVideoCoverImageId: null,
        presentationMode: "video",
        aspectRatio: "16:9",
        showcase: false,
        side: "right",
        status: "published",
        order: 1,
        archived: false,
        createdAt: 1000,
        updatedAt: 1000,
      };

      current.categories.push(sportCategory);
      current.sections[sportCatId] = sportCategory;
      current.projects.push(photoProj, videoProj);
      await savePortfolioContent(current, current.revision);

      // Call public loader for category section
      const frReq = new Request("http://localhost:3000/fr/projets/sport");
      const frRes = await publicPortfolioLoader(makeLoaderArgs(frReq, { rubrique: "sport" }));
      expect(frRes.status).toBe(200);
      const frData = (await frRes.json()) as {
        content: PortfolioContent;
        canonicalUrl: string;
        canonicalCategorySlug?: string;
        panelState: { activeProject?: PortfolioProject };
      };

      // Mock loader data for PortfolioPage render
      vi.mocked(useLoaderData).mockReturnValue(frData);

      const { container } = render(<PortfolioPage />);

      // Find all project links in the rendered page
      const allLinks = Array.from(container.querySelectorAll("a"));
      const projectLinks = allLinks.filter((a) => {
        const href = a.getAttribute("href") || "";
        return href.includes("course-alpinisme") || href.includes("descente-vtt");
      });

      expect(projectLinks.length).toBeGreaterThan(0);

      for (const link of projectLinks) {
        const href = link.getAttribute("href")!;
        // MUST NOT contain the internal UUID!
        expect(href).not.toContain(sportCatId);
        // MUST contain the localized category slug /fr/projets/sport/
        expect(href).toMatch(/\/fr\/projets\/sport\/(course-alpinisme|descente-vtt)/);
      }

      // Verify that calling the real loader with those parameters returns 200
      const photoDetailReq = new Request("http://localhost:3000/fr/projets/sport/course-alpinisme");
      const photoDetailRes = await publicPortfolioLoader(
        makeLoaderArgs(photoDetailReq, { rubrique: "sport", slugFr: "course-alpinisme" })
      );
      expect(photoDetailRes.status).toBe(200);
      const photoDetailJson = (await photoDetailRes.json()) as {
        panelState: { activeProject: { id: string } };
      };
      expect(photoDetailJson.panelState.activeProject.id).toBe(photoProjId);

      // Test EN category and project resolution including .data query
      const enReq = new Request("http://localhost:3000/en/projects/sports/alpine-climb.data", {
        headers: { Accept: "application/json" },
      });
      const enRes = await publicPortfolioLoader(
        makeLoaderArgs(enReq, { category: "sports", slugEn: "alpine-climb" })
      );
      expect(enRes.status).toBe(200);
      const enJson = (await enRes.json()) as {
        panelState: { activeProject: { id: string } };
      };
      expect(enJson.panelState.activeProject.id).toBe(photoProjId);
    });
  });

  // ==========================================================================
  // 2. Returning to an old slug: A -> B -> C -> A cycle with 301 redirects
  // ==========================================================================
  describe("2. Returning to an old slug", () => {
    it("supports renaming cycle A -> B -> C -> A without 422 error, normalizes aliases, and 301-redirects old URLs", async () => {
      const { content: current } = getRawPortfolioContent(testPortfolioContentPath);
      const cat = current.categories[0]; // documentary
      let revision = current.revision;

      // 1. Rename A (documentaire/documentary) -> B (films-du-reel/real-films)
      const formB = new URLSearchParams();
      formB.set("revision", revision);
      formB.set("csrfToken", "test-csrf-token-targeted-fixes");
      formB.set("title_fr", cat.title.fr);
      formB.set("title_en", cat.title.en);
      formB.set("slugFr", "films-du-reel");
      formB.set("slugEn", "real-films");

      const { request: reqB } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/section/${cat.id}`,
        formB
      );
      const resB = await adminPortfolioSectionAction(makeActionArgs(reqB, { category: cat.id }));
      expect(resB.status).toBe(200);
      const jsonB = (await resB.json()) as { newRevision: string };
      revision = jsonB.newRevision;

      // 2. Rename B -> C (cinema-verite/true-cinema)
      const formC = new URLSearchParams();
      formC.set("revision", revision);
      formC.set("csrfToken", "test-csrf-token-targeted-fixes");
      formC.set("title_fr", cat.title.fr);
      formC.set("title_en", cat.title.en);
      formC.set("slugFr", "cinema-verite");
      formC.set("slugEn", "true-cinema");

      const { request: reqC } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/section/${cat.id}`,
        formC
      );
      const resC = await adminPortfolioSectionAction(makeActionArgs(reqC, { category: cat.id }));
      expect(resC.status).toBe(200);
      const jsonC = (await resC.json()) as { newRevision: string };
      revision = jsonC.newRevision;

      // 3. Rename C BACK to A (documentaire/documentary) — MUST SUCCEED with 200, not 422!
      const formA = new URLSearchParams();
      formA.set("revision", revision);
      formA.set("csrfToken", "test-csrf-token-targeted-fixes");
      formA.set("title_fr", cat.title.fr);
      formA.set("title_en", cat.title.en);
      formA.set("slugFr", "documentaire");
      formA.set("slugEn", "documentary");

      const { request: reqA } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/section/${cat.id}`,
        formA
      );
      const resA = await adminPortfolioSectionAction(makeActionArgs(reqA, { category: cat.id }));
      expect(resA.status).toBe(200);

      // Verify stored content
      const { content: updated } = getRawPortfolioContent(testPortfolioContentPath);
      const updatedCat = updated.categories.find((c) => c.id === cat.id)!;
      expect(updatedCat.slugFr).toBe("documentaire");
      expect(updatedCat.slugEn).toBe("documentary");

      // Aliases must contain the old slugs ("films-du-reel", "cinema-verite") and NOT the active slug ("documentaire")
      expect(updatedCat.slugAliases?.fr).toContain("films-du-reel");
      expect(updatedCat.slugAliases?.fr).toContain("cinema-verite");
      expect(updatedCat.slugAliases?.fr).not.toContain("documentaire");

      expect(updatedCat.slugAliases?.en).toContain("real-films");
      expect(updatedCat.slugAliases?.en).toContain("true-cinema");
      expect(updatedCat.slugAliases?.en).not.toContain("documentary");

      // Verify that old URLs return 301 redirects to the canonical URL
      const reqOldB = new Request("http://localhost:3000/fr/projets/films-du-reel");
      const resOldB = await publicPortfolioLoader(makeLoaderArgs(reqOldB, { rubrique: "films-du-reel" }));
      expect(resOldB.status).toBe(301);
      expect(resOldB.headers.get("Location")).toBe("/fr/projets/documentaire");

      const reqOldC = new Request("http://localhost:3000/fr/projets/cinema-verite");
      const resOldC = await publicPortfolioLoader(makeLoaderArgs(reqOldC, { rubrique: "cinema-verite" }));
      expect(resOldC.status).toBe(301);
      expect(resOldC.headers.get("Location")).toBe("/fr/projets/documentaire");

      // Active slug returns 200
      const reqCanonical = new Request("http://localhost:3000/fr/projets/documentaire");
      const resCanonical = await publicPortfolioLoader(makeLoaderArgs(reqCanonical, { rubrique: "documentaire" }));
      expect(resCanonical.status).toBe(200);

      // Verify collision with another category's slug is rejected with 422
      const formCollide = new URLSearchParams();
      formCollide.set("revision", updated.revision);
      formCollide.set("csrfToken", "test-csrf-token-targeted-fixes");
      formCollide.set("title_fr", cat.title.fr);
      formCollide.set("title_en", cat.title.en);
      formCollide.set("slugFr", "publicite"); // used by advertising
      formCollide.set("slugEn", "documentary");

      const { request: reqCollide } = await createAuthenticatedAdminRequest(
        "POST",
        `http://localhost:3000/admin/portfolio/section/${cat.id}`,
        formCollide
      );
      const resCollide = await adminPortfolioSectionAction(makeActionArgs(reqCollide, { category: cat.id }));
      expect(resCollide.status).toBe(422);
    });
  });

  // ==========================================================================
  // 3. Project creation with unknown category: explicit 422 rejection
  // ==========================================================================
  describe("3. Project creation with unknown or missing category", () => {
    it("rejects project creation with 422 when category is unknown, missing, or when no categories exist", async () => {
      const { content: initial } = getRawPortfolioContent(testPortfolioContentPath);
      const initialRawBytes = fs.readFileSync(testPortfolioContentPath);

      // 1. Unknown category
      const formUnknown = new URLSearchParams();
      formUnknown.set("intent", "create");
      formUnknown.set("category", "deleted-category-999");
      formUnknown.set("revision", initial.revision);
      formUnknown.set("csrfToken", "test-csrf-token-targeted-fixes");

      const { request: reqUnknown } = await createAuthenticatedAdminRequest(
        "POST",
        "http://localhost:3000/admin/portfolio",
        formUnknown
      );
      const resUnknown = await adminPortfolioAction(makeActionArgs(reqUnknown));
      expect(resUnknown.status).toBe(422);
      const jsonUnknown = (await resUnknown.json()) as { error: string };
      expect(jsonUnknown.error).toContain("introuvable");

      // Verify zero disk mutations
      expect(fs.readFileSync(testPortfolioContentPath)).toEqual(initialRawBytes);

      // 2. Missing/empty category
      const formEmpty = new URLSearchParams();
      formEmpty.set("intent", "create");
      formEmpty.set("category", "");
      formEmpty.set("revision", initial.revision);
      formEmpty.set("csrfToken", "test-csrf-token-targeted-fixes");

      const { request: reqEmpty } = await createAuthenticatedAdminRequest(
        "POST",
        "http://localhost:3000/admin/portfolio",
        formEmpty
      );
      const resEmpty = await adminPortfolioAction(makeActionArgs(reqEmpty));
      expect(resEmpty.status).toBe(422);
      expect(fs.readFileSync(testPortfolioContentPath)).toEqual(initialRawBytes);

      // 3. Valid creation in existing category returns 200
      const formValid = new URLSearchParams();
      formValid.set("intent", "create");
      formValid.set("category", initial.categories[0].id);
      formValid.set("revision", initial.revision);
      formValid.set("csrfToken", "test-csrf-token-targeted-fixes");

      const { request: reqValid } = await createAuthenticatedAdminRequest(
        "POST",
        "http://localhost:3000/admin/portfolio",
        formValid
      );
      const resValid = await adminPortfolioAction(makeActionArgs(reqValid));
      expect(resValid.status).toBe(200);
      const jsonValid = (await resValid.json()) as { createdId: string };
      expect(jsonValid.createdId).toBeDefined();

      const { content: afterCreate } = getRawPortfolioContent(testPortfolioContentPath);
      const createdProj = afterCreate.projects.find((p) => p.id === jsonValid.createdId);
      expect(createdProj).toBeDefined();
      expect(createdProj?.category).toBe(initial.categories[0].id);
    });
  });

  // ==========================================================================
  // 4. Migration: strictly rejects malformed source and preserves bytes
  // ==========================================================================
  describe("4. Migration safety", () => {
    function makeBaseV1Fixture() {
      return {
        schemaVersion: 1,
        revision: "rev-v1-rich-12345",
        updatedAt: "2026-10-16T12:00:00.000Z",
        overview: {
          title: { fr: "Portfolio Réalisations", en: "Portfolio Work" },
          intro: { fr: "Introduction globale FR", en: "Global introduction EN" },
          seo: {
            title: { fr: "SEO Global FR", en: "SEO Global EN" },
            description: { fr: "SEO Desc FR", en: "SEO Desc EN" },
          },
          seeMoreButton: { fr: "Voir plus", en: "See more" },
        },
        sections: {
          documentary: {
            title: { fr: "Documentaire", en: "Documentary" },
            intro: { fr: "Films du réel", en: "Real films" },
            seo: {
              title: { fr: "Docu SEO", en: "Docu SEO" },
              description: { fr: "Docu SEO Desc", en: "Docu SEO Desc" },
            },
            coverImageId: "11111111-1111-4111-8111-111111111111",
            coverAlt: { fr: "Cover alt", en: "Cover alt" },
            showreelTitle: { fr: "Showreel Doc", en: "Showreel Doc" },
            morePhotosButton: { fr: "Plus de photos", en: "More photos" },
            lessPhotosButton: { fr: "Moins de photos", en: "Less photos" },
            backButton: { fr: "Retour", en: "Back" },
          },
          advertising: {
            title: { fr: "Publicité", en: "Advertising" },
            intro: { fr: "Films de marque", en: "Brand films" },
            seo: {
              title: { fr: "Pub SEO", en: "Pub SEO" },
              description: { fr: "Pub SEO Desc", en: "Pub SEO Desc" },
            },
            coverImageId: null,
            coverAlt: { fr: "Cover pub", en: "Cover pub" },
            backButton: { fr: "Retour", en: "Back" },
          },
        },
        projects: [],
        media: {
          "11111111-1111-4111-8111-111111111111": {
            imageId: "11111111-1111-4111-8111-111111111111",
            ownerType: "section" as const,
            ownerId: "documentary",
            mediaSlot: "cover" as const,
            originalFormat: "webp",
            originalWidth: 1200,
            originalHeight: 800,
            variants: [{ name: "640p", width: 640, height: 427, webpSize: 1000, avifSize: 800 }],
            createdAt: 1000,
          },
        },
      };
    }

    it("migrates valid rich V1 fixture without modifying existing texts and media", () => {
      const v1 = makeBaseV1Fixture();
      fs.writeFileSync(testPortfolioContentPath, JSON.stringify(v1, null, 2), "utf-8");

      const { content: migrated } = getRawPortfolioContent(testPortfolioContentPath);
      expect(migrated.schemaVersion).toBe(2);
      expect(migrated.categories.length).toBe(2);
      expect(migrated.categories[0].title.fr).toBe("Documentaire");
      expect(migrated.categories[0].coverImageId).toBe("11111111-1111-4111-8111-111111111111");
      expect(migrated.categories[0].backButton.fr).toBe("Retour");
      expect(migrated.categories[1].title.fr).toBe("Publicité");
      expect(migrated.media["11111111-1111-4111-8111-111111111111"]).toBeDefined();
    });

    it("rejects corrupted V1 fields (title: 0, intro: false, seo: \"\", backButton: null) without altering disk bytes or rotating backups", () => {
      const corruptions: Array<{ name: string; mutate: (fixture: ReturnType<typeof makeBaseV1Fixture>) => void }> = [
        {
          name: "title=0",
          mutate: (f) => {
            (f.sections.documentary as Record<string, unknown>).title = 0;
          },
        },
        {
          name: "intro=false",
          mutate: (f) => {
            (f.sections.documentary as Record<string, unknown>).intro = false;
          },
        },
        {
          name: "seo=\"\"",
          mutate: (f) => {
            (f.sections.documentary as Record<string, unknown>).seo = "";
          },
        },
        {
          name: "backButton=null",
          mutate: (f) => {
            (f.sections.documentary as Record<string, unknown>).backButton = null;
          },
        },
      ];

      for (const { name, mutate } of corruptions) {
        const fixture = makeBaseV1Fixture();
        mutate(fixture);
        fs.writeFileSync(testPortfolioContentPath, JSON.stringify(fixture, null, 2), "utf-8");
        const initialBytes = fs.readFileSync(testPortfolioContentPath);
        const initialBackups = getBackups(testPortfolioContentPath);

        expect(() => getRawPortfolioContent(testPortfolioContentPath), `corruption ${name} should throw`).toThrow(
          ValidationError
        );
        expect(fs.readFileSync(testPortfolioContentPath)).toEqual(initialBytes);
        expect(getBackups(testPortfolioContentPath).length).toBe(initialBackups.length);
      }
    });

    it("rejects non-object section entry (e.g. sections.documentary = null) without modifying file", () => {
      const fixture = makeBaseV1Fixture();
      (fixture.sections as Record<string, unknown>).documentary = null;
      fs.writeFileSync(testPortfolioContentPath, JSON.stringify(fixture, null, 2), "utf-8");
      const initialBytes = fs.readFileSync(testPortfolioContentPath);
      const initialBackups = getBackups(testPortfolioContentPath);

      expect(() => getRawPortfolioContent(testPortfolioContentPath)).toThrow(ValidationError);
      expect(fs.readFileSync(testPortfolioContentPath)).toEqual(initialBytes);
      expect(getBackups(testPortfolioContentPath).length).toBe(initialBackups.length);
    });

    it("rejects incomplete bilingual structures (missing en) without modifying file", () => {
      const fixture = makeBaseV1Fixture();
      (fixture.sections.documentary as Record<string, unknown>).title = { fr: "Seulement FR" };
      fs.writeFileSync(testPortfolioContentPath, JSON.stringify(fixture, null, 2), "utf-8");
      const initialBytes = fs.readFileSync(testPortfolioContentPath);

      expect(() => getRawPortfolioContent(testPortfolioContentPath)).toThrow(ValidationError);
      expect(fs.readFileSync(testPortfolioContentPath)).toEqual(initialBytes);
    });

    it("migrates cleanly when V2-only fields are absent from V1 sections", () => {
      const fixture = makeBaseV1Fixture();
      delete (fixture.sections.documentary as Record<string, unknown>).entryImageId;
      delete (fixture.sections.documentary as Record<string, unknown>).bannerImageId;
      delete (fixture.sections.documentary as Record<string, unknown>).slugAliases;
      delete (fixture.sections.documentary as Record<string, unknown>).order;
      delete (fixture.sections.documentary as Record<string, unknown>).status;
      delete (fixture.sections.documentary as Record<string, unknown>).entrySummary;

      fs.writeFileSync(testPortfolioContentPath, JSON.stringify(fixture, null, 2), "utf-8");
      const { content: migrated } = getRawPortfolioContent(testPortfolioContentPath);

      expect(migrated.categories[0].entryImageId).toBeNull();
      expect(migrated.categories[0].slugAliases?.fr).toEqual([]);
      expect(migrated.categories[0].status).toBe("published");
      expect(migrated.categories[0].entrySummary?.fr).toBe(fixture.sections.documentary.intro.fr);
    });

    it("rejects malformed V1 source (e.g. non-array projects) without rewriting the file or rotating backups", () => {
      const v1Fixture = {
        schemaVersion: 1,
        revision: "rev-v1-initial-12345",
        updatedAt: "2026-10-16T12:00:00.000Z",
        overview: {
          title: { fr: "Portfolio", en: "Portfolio" },
          intro: { fr: "Intro", en: "Intro" },
          seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
          seeMoreButton: { fr: "Voir", en: "See" },
        },
        sections: {
          documentary: {
            title: { fr: "Doc", en: "Doc" },
            intro: { fr: "Intro", en: "Intro" },
            seo: { title: { fr: "Doc SEO", en: "Doc SEO" }, description: { fr: "Doc Desc", en: "Doc Desc" } },
          },
          advertising: {
            title: { fr: "Pub", en: "Ad" },
            intro: { fr: "Intro", en: "Intro" },
            seo: { title: { fr: "Pub SEO", en: "Pub SEO" }, description: { fr: "Pub Desc", en: "Pub Desc" } },
          },
        },
        projects: { invalid: "object instead of array" }, // CORRUPTED PROJECTS SHAPE!
        media: {},
      };

      const rawJson = JSON.stringify(v1Fixture, null, 2);
      fs.writeFileSync(testPortfolioContentPath, rawJson, "utf-8");
      const initialBytes = fs.readFileSync(testPortfolioContentPath);
      const initialBackups = getBackups(testPortfolioContentPath);

      // Must throw ValidationError!
      expect(() => getRawPortfolioContent(testPortfolioContentPath)).toThrow(ValidationError);

      // File on disk must remain 100% UNCHANGED octet for octet!
      const afterBytes = fs.readFileSync(testPortfolioContentPath);
      expect(afterBytes).toEqual(initialBytes);

      // No backups must have been rotated or created
      const afterBackups = getBackups(testPortfolioContentPath);
      expect(afterBackups.length).toBe(initialBackups.length);
    });

    it("rejects unsupported schemaVersion (e.g. 3) without rewriting the file", () => {
      const v3Fixture = {
        schemaVersion: 3,
        revision: "rev-v3-12345",
        updatedAt: "2026-10-16T12:00:00.000Z",
        categories: [],
        projects: [],
      };

      const rawJson = JSON.stringify(v3Fixture, null, 2);
      fs.writeFileSync(testPortfolioContentPath, rawJson, "utf-8");
      const initialBytes = fs.readFileSync(testPortfolioContentPath);

      expect(() => getRawPortfolioContent(testPortfolioContentPath)).toThrow(ValidationError);
      expect(fs.readFileSync(testPortfolioContentPath)).toEqual(initialBytes);
    });
  });

  // ==========================================================================
  // 5. Accessible modal lifecycle & closing on mutation success
  // ==========================================================================
  describe("5. Delete modal accessible lifecycle", () => {
    it("manages initial focus on destination select, excludes hidden inputs, applies inert to background, loops Tab and Shift+Tab, and restores focus after inert removal", async () => {
      vi.useFakeTimers();
      const { content } = getRawPortfolioContent(testPortfolioContentPath);

      // Ensure documentary category has at least 1 project, so reassignment modal is triggered
      vi.mocked(useLoaderData).mockReturnValue({ content, csrfToken: "csrf-token-123" });
      vi.mocked(useActionData).mockReturnValue(undefined);

      const { container } = render(<AdminPortfolioPage />);

      // Find main container and verify it is not inert initially
      const mainContainer = container.querySelector('div[class*="_container_"]') as HTMLElement;
      expect(mainContainer).toBeInTheDocument();
      expect(mainContainer.hasAttribute("inert")).toBe(false);

      // Find delete button for documentary category (which has projects)
      const deleteButtons = screen.getAllByRole("button", { name: /Supprimer/i });
      const firstCatDeleteBtn = deleteButtons[0];
      firstCatDeleteBtn.focus();
      expect(document.activeElement).toBe(firstCatDeleteBtn);

      // Open modal
      fireEvent.click(firstCatDeleteBtn);

      // Main container MUST now be inert!
      expect(mainContainer.hasAttribute("inert")).toBe(true);

      // Modal dialog itself MUST NOT be inert!
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog.closest("[inert]")).toBeNull();

      // Advance timers by 50ms for initial focus
      act(() => {
        vi.advanceTimersByTime(50);
      });

      // Preferred control in reassignment modal is the destination select!
      const select = screen.getByLabelText(/Déplacer les/i);
      expect(document.activeElement).toBe(select);

      // Hidden inputs MUST NOT be focused
      const hiddenInputs = dialog.querySelectorAll('input[type="hidden"]');
      for (const hiddenInput of hiddenInputs) {
        expect(document.activeElement).not.toBe(hiddenInput);
      }

      // Test Shift+Tab from select (first focusable control): loops to submit button!
      const submitBtn = screen.getByRole("button", { name: /Déplacer les projets et supprimer/i });
      const shiftTabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(shiftTabEvent);
      expect(shiftTabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(submitBtn);

      // Test Tab from submit button (last focusable control): loops back to select!
      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: false,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(tabEvent);
      expect(tabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(select);

      // Test event originating outside dialog: brings focus into dialog
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const outsideTabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: false,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(outsideTabEvent);
      expect(outsideTabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(select);

      // Escape key closes modal
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Main container is no longer inert!
      expect(mainContainer.hasAttribute("inert")).toBe(false);

      // Focus restored to the trigger button!
      expect(document.activeElement).toBe(firstCatDeleteBtn);

      vi.useRealTimers();
    });

    it("cancels pending focus timer if modal is closed before 50ms", () => {
      vi.useFakeTimers();
      const { content } = getRawPortfolioContent(testPortfolioContentPath);

      vi.mocked(useLoaderData).mockReturnValue({ content, csrfToken: "csrf-token-123" });
      vi.mocked(useActionData).mockReturnValue(undefined);

      render(<AdminPortfolioPage />);

      const deleteButtons = screen.getAllByRole("button", { name: /Supprimer/i });
      const firstCatDeleteBtn = deleteButtons[0];
      firstCatDeleteBtn.focus();

      // Open modal
      fireEvent.click(firstCatDeleteBtn);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Advance only 20ms (< 50ms)
      act(() => {
        vi.advanceTimersByTime(20);
      });

      // Press Escape to close modal
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Advance timers by remaining 100ms
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Focus remains on the restored trigger and is NOT stolen by any stale callback
      expect(document.activeElement).toBe(firstCatDeleteBtn);

      vi.useRealTimers();
    });

    it("preserves modal and selection on 409/422 error, closes on success", async () => {
      const { content } = getRawPortfolioContent(testPortfolioContentPath);

      vi.mocked(useLoaderData).mockReturnValue({ content, csrfToken: "csrf-token-123" });
      vi.mocked(useActionData).mockReturnValue(undefined);

      const { rerender } = render(<AdminPortfolioPage />);

      const deleteButtons = screen.getAllByRole("button", { name: /Supprimer/i });
      fireEvent.click(deleteButtons[0]);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();

      // Select another category
      const select = screen.getByLabelText(/Déplacer les/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: content.categories[1].id } });
      expect(select.value).toBe(content.categories[1].id);

      // Re-render with actionData error (e.g. 409 conflict)
      vi.mocked(useActionData).mockReturnValue({
        error: "Conflit de révision 409 : la page a été modifiée.",
      });
      rerender(<AdminPortfolioPage />);

      // Modal MUST remain open and display the error!
      const openDialog = screen.getByRole("dialog");
      expect(openDialog).toBeInTheDocument();
      expect(within(openDialog).getByRole("alert")).toHaveTextContent("Conflit de révision 409");
      // Selection MUST be preserved!
      expect((screen.getByLabelText(/Déplacer les/i) as HTMLSelectElement).value).toBe(content.categories[1].id);

      // Re-render with actionData success for this category
      const deletingCat = content.categories[0];
      vi.mocked(useActionData).mockReturnValue({
        success: "Rubrique supprimée définitivement.",
        deletedCategoryId: deletingCat.id,
      });
      rerender(<AdminPortfolioPage />);

      // Modal MUST close!
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("restores focus to + Ajouter une rubrique when deleted category trigger is unmounted upon revalidation", () => {
      const { content } = getRawPortfolioContent(testPortfolioContentPath);

      vi.mocked(useLoaderData).mockReturnValue({ content, csrfToken: "csrf-token-123" });
      vi.mocked(useActionData).mockReturnValue(undefined);

      const { rerender } = render(<AdminPortfolioPage />);

      const deleteButtons = screen.getAllByRole("button", { name: /Supprimer/i });
      const deletingCat = content.categories[0];
      fireEvent.click(deleteButtons[0]);

      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Revalidation: content now has category 0 removed
      const updatedContent: PortfolioContent = {
        ...content,
        categories: content.categories.filter((c) => c.id !== deletingCat.id),
      };

      vi.mocked(useLoaderData).mockReturnValue({ content: updatedContent, csrfToken: "csrf-token-123" });
      vi.mocked(useActionData).mockReturnValue({
        success: "Rubrique supprimée définitivement.",
        deletedCategoryId: deletingCat.id,
      });

      rerender(<AdminPortfolioPage />);

      // Modal closes
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Focus is restored to the persistent add category button
      const addCategoryBtn = screen.getByRole("button", { name: /\+ Ajouter une rubrique/i });
      expect(document.activeElement).toBe(addCategoryBtn);
    });
  });

  // ==========================================================================
  // 6. Zero inline styles in admin portfolio
  // ==========================================================================
  describe("6. Zero inline styles in admin portfolio", () => {
    it("renders empty state without style attribute and uses CSS module class emptyTableText", () => {
      const { content } = getRawPortfolioContent(testPortfolioContentPath);
      const emptyContent: PortfolioContent = {
        ...content,
        categories: [],
        sections: {},
      };

      vi.mocked(useLoaderData).mockReturnValue({ content: emptyContent, csrfToken: "csrf-123" });
      vi.mocked(useActionData).mockReturnValue(undefined);

      render(<AdminPortfolioPage />);

      const emptyPara = screen.getByText(/Le portfolio ne contient aucune rubrique actuellement/i);
      expect(emptyPara).toBeInTheDocument();
      // MUST NOT have style attribute with marginBottom
      expect(emptyPara.getAttribute("style")).toBeNull();
      expect(emptyPara.className).toMatch(/emptyTableText/);
    });

    it("renders category reassignment container without inline style attribute and uses reassignFieldGroup", () => {
      const { content } = getRawPortfolioContent(testPortfolioContentPath);

      vi.mocked(useLoaderData).mockReturnValue({ content, csrfToken: "csrf-123" });
      vi.mocked(useActionData).mockReturnValue(undefined);

      render(<AdminPortfolioPage />);

      // Open modal on first category (which has projects)
      const deleteButtons = screen.getAllByRole("button", { name: /Supprimer/i });
      fireEvent.click(deleteButtons[0]);

      const select = screen.getByLabelText(/Déplacer les/i);
      const fieldGroup = select.closest("div");
      expect(fieldGroup).toBeInTheDocument();

      // MUST NOT have inline style!
      expect(fieldGroup?.getAttribute("style")).toBeNull();
      expect(fieldGroup?.className).toMatch(/reassignFieldGroup/);
    });
  });
});
