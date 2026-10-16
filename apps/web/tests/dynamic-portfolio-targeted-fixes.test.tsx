import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
          },
          advertising: {
            title: { fr: "Pub", en: "Ad" },
            intro: { fr: "Intro", en: "Intro" },
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
    it("closes modal on successful deletion, closes on Escape, and preserves modal on error", async () => {
      const { content } = getRawPortfolioContent(testPortfolioContentPath);

      // Initial render with no actionData
      vi.mocked(useLoaderData).mockReturnValue({ content, csrfToken: "csrf-token-123" });
      vi.mocked(useActionData).mockReturnValue(undefined);

      const { rerender } = render(<AdminPortfolioPage />);

      // Find the first delete button for category
      const deleteButtons = screen.getAllByRole("button", { name: /Supprimer/i });
      const firstCatDeleteBtn = deleteButtons[0];

      // Click Supprimer -> modal opens
      fireEvent.click(firstCatDeleteBtn);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "category-delete-title");

      // Press Escape -> modal closes
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Open again
      fireEvent.click(firstCatDeleteBtn);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Re-render with actionData error (e.g. 409 conflict)
      vi.mocked(useActionData).mockReturnValue({
        error: "Conflit de révision 409 : la page a été modifiée.",
      });
      rerender(<AdminPortfolioPage />);

      // Modal MUST remain open and display the error!
      const openDialog = screen.getByRole("dialog");
      expect(openDialog).toBeInTheDocument();
      expect(within(openDialog).getByRole("alert")).toHaveTextContent("Conflit de révision 409");

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
