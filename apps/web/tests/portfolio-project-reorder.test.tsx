import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

// Mock react-router hooks for component testing
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useActionData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    useLocation: vi.fn(() => ({ pathname: "/admin/portfolio", search: "" })),
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
import AdminPortfolioPage, { action as adminPortfolioAction } from "../app/routes/admin/portfolio";
import { action as adminPortfolioEditAction } from "../app/routes/admin/portfolio-edit";
import { loader as publicPortfolioLoader } from "../app/routes/public/portfolio";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import {
  getRawPortfolioContent,
} from "../app/lib/portfolio-content.server";
import {
  type PortfolioCategoryItem,
  type PortfolioProject,
  type PortfolioMediaItem,
  type PortfolioContent,
  comparePortfolioProjects,
} from "../app/lib/portfolio-content.shared";

describe("Portfolio Project Reordering — Regression & Integrity Suite", () => {
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

  async function createAdminRequest(
    method = "POST",
    formData?: URLSearchParams
  ): Promise<{ request: Request; csrfToken: string }> {
    const session = await getSession();
    session.set("adminId", "admin-tester");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    const csrfToken = "csrf-test-token-portfolio-reorder";
    session.set("csrfToken", csrfToken);
    const sessionCookie = await commitSession(session);

    const headers = new Headers({
      Cookie: sessionCookie,
      Origin: "http://localhost:3000",
    });

    let body: string | undefined;
    if (formData) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      body = formData.toString();
    }

    const request = new Request("http://localhost:3000/admin/portfolio", {
      method,
      headers,
      body,
    });

    return { request, csrfToken };
  }

  function createProjectWithMedia(
    projectId: string,
    category: string,
    order: number,
    options: {
      status?: "published" | "draft";
      archived?: boolean;
      createdAt?: number;
      titleFr?: string;
      titleEn?: string;
      mode?: "photo" | "video";
      videoId?: string;
    } = {}
  ): { project: PortfolioProject; mediaItem: PortfolioMediaItem } {
    const isVideo = options.mode === "video";
    const mediaId = crypto.randomUUID();
    const vId = options.videoId || "123456789";

    const mediaItem: PortfolioMediaItem = {
      imageId: mediaId,
      ownerType: "project",
      ownerId: projectId,
      mediaSlot: "cover",
      originalFormat: "webp",
      originalWidth: 1200,
      originalHeight: 800,
      variants: [{ name: "640p", width: 640, height: 427, webpSize: 1000, avifSize: 800 }],
      createdAt: 1000,
    };

    const project: PortfolioProject = {
      id: projectId,
      category,
      slugFr: `projet-${projectId.substring(0, 8)}`,
      slugEn: `project-${projectId.substring(0, 8)}`,
      title: {
        fr: options.titleFr || `Projet ${projectId.substring(0, 4)}`,
        en: options.titleEn || `Project ${projectId.substring(0, 4)}`,
      },
      summary: {
        fr: "Résumé en français",
        en: "Summary in English",
      },
      description: [
        {
          type: "paragraph",
          text: { fr: "Description FR", en: "Description EN" },
        },
      ],
      seo: {
        title: { fr: "SEO FR", en: "SEO EN" },
        description: { fr: "SEO Desc FR", en: "SEO Desc EN" },
      },
      coverImageId: mediaId,
      coverAlt: { fr: "Alt FR", en: "Alt EN" },
      galleryImageIds: [],
      video: isVideo
        ? {
            provider: "vimeo",
            videoId: vId,
            url: `https://vimeo.com/${vId}`,
          }
        : null,
      presentationMode: isVideo ? "video" : "photo",
      showcase: false,
      side: "auto",
      order,
      status: options.status || "published",
      archived: options.archived || false,
      createdAt: options.createdAt ?? 1000,
      updatedAt: options.createdAt ?? 1000,
    };

    return { project, mediaItem };
  }

  function seedInitialPortfolio(
    items: { project: PortfolioProject; mediaItem: PortfolioMediaItem }[]
  ): PortfolioContent {
    const categories: PortfolioCategoryItem[] = [
      {
        id: "documentary",
        slugFr: "documentaire",
        slugEn: "documentary",
        order: 0,
        status: "published",
        title: { fr: "Documentaire", en: "Documentary" },
        intro: { fr: "Intro doc", en: "Intro doc EN" },
        entrySummary: { fr: "Summary doc", en: "Summary doc EN" },
        entrySide: "left",
        seo: {
          title: { fr: "Documentaire | Parallax", en: "Documentary | Parallax" },
          description: { fr: "Desc doc", en: "Desc doc EN" },
        },
        coverImageId: null,
        coverAlt: { fr: "", en: "" },
        entryImageId: null,
        entryAlt: { fr: "", en: "" },
        bannerImageId: null,
        bannerAlt: { fr: "", en: "" },
        showreelTitle: { fr: "Showreel", en: "Showreel" },
        showreelVideo: null,
        showreelCoverImageId: null,
        morePhotosButton: { fr: "Plus", en: "More" },
        lessPhotosButton: { fr: "Moins", en: "Less" },
        backButton: { fr: "Retour", en: "Back" },
      },
      {
        id: "advertising",
        slugFr: "publicite",
        slugEn: "advertising",
        order: 1,
        status: "published",
        title: { fr: "Publicité", en: "Advertising" },
        intro: { fr: "Intro pub", en: "Intro pub EN" },
        entrySummary: { fr: "Summary pub", en: "Summary pub EN" },
        entrySide: "right",
        seo: {
          title: { fr: "Publicité | Parallax", en: "Advertising | Parallax" },
          description: { fr: "Desc pub", en: "Desc pub EN" },
        },
        coverImageId: null,
        coverAlt: { fr: "", en: "" },
        entryImageId: null,
        entryAlt: { fr: "", en: "" },
        bannerImageId: null,
        bannerAlt: { fr: "", en: "" },
        showreelTitle: { fr: "Showreel", en: "Showreel" },
        showreelVideo: null,
        showreelCoverImageId: null,
        morePhotosButton: { fr: "Plus", en: "More" },
        lessPhotosButton: { fr: "Moins", en: "Less" },
        backButton: { fr: "Retour", en: "Back" },
      },
      {
        id: "corporate",
        slugFr: "entreprise",
        slugEn: "corporate",
        order: 2,
        status: "published",
        title: { fr: "Entreprise", en: "Corporate" },
        intro: { fr: "Intro corp", en: "Intro corp EN" },
        entrySummary: { fr: "Summary corp", en: "Summary corp EN" },
        entrySide: "left",
        seo: {
          title: { fr: "Entreprise | Parallax", en: "Corporate | Parallax" },
          description: { fr: "Desc corp", en: "Desc corp EN" },
        },
        coverImageId: null,
        coverAlt: { fr: "", en: "" },
        entryImageId: null,
        entryAlt: { fr: "", en: "" },
        bannerImageId: null,
        bannerAlt: { fr: "", en: "" },
        showreelTitle: { fr: "Showreel", en: "Showreel" },
        showreelVideo: null,
        showreelCoverImageId: null,
        morePhotosButton: { fr: "Plus", en: "More" },
        lessPhotosButton: { fr: "Moins", en: "Less" },
        backButton: { fr: "Retour", en: "Back" },
      },
    ];

    const mediaRegistry: Record<string, PortfolioMediaItem> = {};
    const projects: PortfolioProject[] = [];

    for (const item of items) {
      projects.push(item.project);
      mediaRegistry[item.mediaItem.imageId] = item.mediaItem;
    }

    const sections: Record<string, PortfolioCategoryItem> = {};
    for (const c of categories) {
      sections[c.id] = c;
    }

    const content: PortfolioContent = {
      schemaVersion: 2,
      revision: "rev-seed-1111222233334444",
      updatedAt: new Date().toISOString(),
      overview: {
        title: { fr: "Portfolio", en: "Portfolio" },
        intro: { fr: "Intro portfolio", en: "Portfolio intro" },
        seo: {
          title: { fr: "Portfolio | Parallax", en: "Portfolio | Parallax" },
          description: { fr: "Découvrez nos travaux", en: "Discover our work" },
        },
        seeMoreButton: { fr: "Découvrir", en: "Discover" },
      },
      categories,
      sections,
      projects,
      media: mediaRegistry,
    };

    fs.writeFileSync(testPortfolioContentPath, JSON.stringify(content, null, 2), "utf-8");
    return content;
  }

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-reorder-test-"));
    testPortfolioContentPath = path.join(tempDir, "portfolio-content.json");
    testPortfolioMediaPath = path.join(tempDir, "portfolio-media");
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
      // ignore
    }
  });

  // ==========================================================================
  // Test 1: Two projects in the same category moved in both directions
  // ==========================================================================
  it("1. moves two projects in the same category in both directions and persists exact order", async () => {
    const item1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0, {
      titleFr: "Projet Un",
      createdAt: 100,
    });
    const item2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 1, {
      titleFr: "Projet Deux",
      createdAt: 200,
    });

    const initial = seedInitialPortfolio([item1, item2]);

    // Step A: Move item1 "down"
    const fd1 = new URLSearchParams({
      intent: "reorder",
      projectId: item1.project.id,
      direction: "down",
      revision: initial.revision,
    });
    const { csrfToken } = await createAdminRequest("POST");
    fd1.set("csrfToken", csrfToken);
    const { request: req1 } = await createAdminRequest("POST", fd1);

    const res1 = await adminPortfolioAction(makeActionArgs(req1));
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as { success: string; newRevision: string };
    expect(data1.success).toBe("Ordre mis à jour.");
    expect(data1.newRevision).not.toBe(initial.revision);

    // Verify raw file on disk
    const onDisk1 = getRawPortfolioContent(testPortfolioContentPath).content;
    const p1After = onDisk1.projects.find((p) => p.id === item1.project.id)!;
    const p2After = onDisk1.projects.find((p) => p.id === item2.project.id)!;
    expect(p2After.order).toBe(0);
    expect(p1After.order).toBe(1);

    // Step B: Move item1 back "up"
    const fd2 = new URLSearchParams({
      intent: "reorder",
      projectId: item1.project.id,
      direction: "up",
      csrfToken,
      revision: data1.newRevision,
    });
    const { request: req2 } = await createAdminRequest("POST", fd2);
    const res2 = await adminPortfolioAction(makeActionArgs(req2));
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { success: string; newRevision: string };
    expect(data2.success).toBe("Ordre mis à jour.");

    // Verify raw file on disk again
    const onDisk2 = getRawPortfolioContent(testPortfolioContentPath).content;
    const p1Final = onDisk2.projects.find((p) => p.id === item1.project.id)!;
    const p2Final = onDisk2.projects.find((p) => p.id === item2.project.id)!;
    expect(p1Final.order).toBe(0);
    expect(p2Final.order).toBe(1);
  });

  // ==========================================================================
  // Test 2: Identical orders and non-consecutive orders (historical cleanup)
  // ==========================================================================
  it("2. resolves identical orders and gaps into unique consecutive orders on reorder mutation", async () => {
    // Anomalous historical state: P1 and P2 both have order 0; P3 has order 10 (gap)
    const item1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0, {
      titleFr: "Projet A",
      createdAt: 100,
    });
    const item2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 0, {
      titleFr: "Projet B",
      createdAt: 200,
    });
    const item3 = createProjectWithMedia("33333333-3333-4333-8333-333333333333", "documentary", 10, {
      titleFr: "Projet C",
      createdAt: 300,
    });

    const initial = seedInitialPortfolio([item1, item2, item3]);

    // Initial deterministic ordering should sort by comparePortfolioProjects:
    // P1 (order 0, created 100) < P2 (order 0, created 200) < P3 (order 10, created 300)
    const sortedInitial = [item1.project, item2.project, item3.project].sort(comparePortfolioProjects);
    expect(sortedInitial.map((p) => p.id)).toEqual([item1.project.id, item2.project.id, item3.project.id]);

    // Move P2 down (it should jump after P3)
    const fd = new URLSearchParams({
      intent: "reorder",
      projectId: item2.project.id,
      direction: "down",
      revision: initial.revision,
    });
    const { csrfToken } = await createAdminRequest("POST");
    fd.set("csrfToken", csrfToken);
    const { request } = await createAdminRequest("POST", fd);

    const res = await adminPortfolioAction(makeActionArgs(request));
    expect(res.status).toBe(200);

    const onDisk = getRawPortfolioContent(testPortfolioContentPath).content;
    const docProjects = onDisk.projects
      .filter((p) => p.category === "documentary")
      .sort(comparePortfolioProjects);

    // New order: P1 was 0, P3 was next, P2 moved below P3
    expect(docProjects.map((p) => p.id)).toEqual([item1.project.id, item3.project.id, item2.project.id]);
    // Orders must now be strictly normalized to [0, 1, 2]
    expect(docProjects.map((p) => p.order)).toEqual([0, 1, 2]);
  });

  // ==========================================================================
  // Test 3: Multiple categories mixed in the table, preserving other categories
  // ==========================================================================
  it("3. reorders within category without affecting projects of other categories", async () => {
    const d1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0, {
      titleFr: "Doc 1",
    });
    const d2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 1, {
      titleFr: "Doc 2",
    });
    const a1 = createProjectWithMedia("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "advertising", 0, {
      titleFr: "Pub 1",
    });
    const a2 = createProjectWithMedia("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "advertising", 1, {
      titleFr: "Pub 2",
    });
    const c1 = createProjectWithMedia("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "corporate", 0, {
      titleFr: "Corp 1",
    });

    const initial = seedInitialPortfolio([d1, d2, a1, a2, c1]);

    // Move d2 UP in documentary
    const fd = new URLSearchParams({
      intent: "reorder",
      projectId: d2.project.id,
      direction: "up",
      revision: initial.revision,
    });
    const { csrfToken } = await createAdminRequest("POST");
    fd.set("csrfToken", csrfToken);
    const { request } = await createAdminRequest("POST", fd);

    const res = await adminPortfolioAction(makeActionArgs(request));
    expect(res.status).toBe(200);

    const onDisk = getRawPortfolioContent(testPortfolioContentPath).content;

    // Documentary projects swapped
    const d2After = onDisk.projects.find((p) => p.id === d2.project.id)!;
    const d1After = onDisk.projects.find((p) => p.id === d1.project.id)!;
    expect(d2After.order).toBe(0);
    expect(d1After.order).toBe(1);

    // Advertising and Corporate projects MUST be completely unchanged
    const a1After = onDisk.projects.find((p) => p.id === a1.project.id)!;
    const a2After = onDisk.projects.find((p) => p.id === a2.project.id)!;
    const c1After = onDisk.projects.find((p) => p.id === c1.project.id)!;
    expect(a1After.order).toBe(0);
    expect(a1After.category).toBe("advertising");
    expect(a2After.order).toBe(1);
    expect(a2After.category).toBe("advertising");
    expect(c1After.order).toBe(0);
    expect(c1After.category).toBe("corporate");
  });

  // ==========================================================================
  // Test 4: Single-project category and boundary limits (first/last)
  // ==========================================================================
  it("4. rejects moves on single-project category and boundary first/last without mutating", async () => {
    const d1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0);
    const d2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 1);
    const c1 = createProjectWithMedia("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "corporate", 0);

    const initial = seedInitialPortfolio([d1, d2, c1]);

    const { csrfToken } = await createAdminRequest("POST");

    // Case A: Corporate has only 1 project -> Up must fail
    const fdCorpUp = new URLSearchParams({
      intent: "reorder",
      projectId: c1.project.id,
      direction: "up",
      csrfToken,
      revision: initial.revision,
    });
    const { request: reqCorpUp } = await createAdminRequest("POST", fdCorpUp);
    const resCorpUp = await adminPortfolioAction(makeActionArgs(reqCorpUp));
    expect(resCorpUp.status).toBe(400);
    const dataCorpUp = (await resCorpUp.json()) as { error: string };
    expect(dataCorpUp.error).toContain("Impossible de monter le premier projet");

    // Case B: Corporate has only 1 project -> Down must fail
    const fdCorpDown = new URLSearchParams({
      intent: "reorder",
      projectId: c1.project.id,
      direction: "down",
      csrfToken,
      revision: initial.revision,
    });
    const { request: reqCorpDown } = await createAdminRequest("POST", fdCorpDown);
    const resCorpDown = await adminPortfolioAction(makeActionArgs(reqCorpDown));
    expect(resCorpDown.status).toBe(400);
    const dataCorpDown = (await resCorpDown.json()) as { error: string };
    expect(dataCorpDown.error).toContain("Impossible de descendre le dernier projet");

    // Case C: First project in Documentary (d1) -> Up must fail
    const fdD1Up = new URLSearchParams({
      intent: "reorder",
      projectId: d1.project.id,
      direction: "up",
      csrfToken,
      revision: initial.revision,
    });
    const { request: reqD1Up } = await createAdminRequest("POST", fdD1Up);
    const resD1Up = await adminPortfolioAction(makeActionArgs(reqD1Up));
    expect(resD1Up.status).toBe(400);

    // Case D: Last project in Documentary (d2) -> Down must fail
    const fdD2Down = new URLSearchParams({
      intent: "reorder",
      projectId: d2.project.id,
      direction: "down",
      csrfToken,
      revision: initial.revision,
    });
    const { request: reqD2Down } = await createAdminRequest("POST", fdD2Down);
    const resD2Down = await adminPortfolioAction(makeActionArgs(reqD2Down));
    expect(resD2Down.status).toBe(400);

    // Verify file on disk is completely untouched
    const onDisk = getRawPortfolioContent(testPortfolioContentPath).content;
    expect(onDisk.revision).toBe(initial.revision);
  });

  // ==========================================================================
  // Test 5: Category and status filters (moving relative to visible projects)
  // ==========================================================================
  it("5. reorders relative to visible projects when statusFilter is active, preserving hidden relative order", async () => {
    // 4 projects in documentary:
    // D1: published (0)
    // D2: draft (1)
    // D3: published (2)
    // D4: draft (3)
    const d1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0, {
      status: "published",
      titleFr: "Pub 1",
    });
    const d2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 1, {
      status: "draft",
      titleFr: "Draft 2",
    });
    const d3 = createProjectWithMedia("33333333-3333-4333-8333-333333333333", "documentary", 2, {
      status: "published",
      titleFr: "Pub 3",
    });
    const d4 = createProjectWithMedia("44444444-4444-4444-8444-444444444444", "documentary", 3, {
      status: "draft",
      titleFr: "Draft 4",
    });

    const initial = seedInitialPortfolio([d1, d2, d3, d4]);
    const { csrfToken } = await createAdminRequest("POST");

    // With statusFilter = "published", visible projects are [D1, D3].
    // Moving D3 UP jumps over visible predecessor D1.
    const fd = new URLSearchParams({
      intent: "reorder",
      projectId: d3.project.id,
      direction: "up",
      statusFilter: "published",
      csrfToken,
      revision: initial.revision,
    });
    const { request } = await createAdminRequest("POST", fd);
    const res = await adminPortfolioAction(makeActionArgs(request));
    expect(res.status).toBe(200);

    const onDisk = getRawPortfolioContent(testPortfolioContentPath).content;
    const docProjects = onDisk.projects
      .filter((p) => p.category === "documentary")
      .sort(comparePortfolioProjects);

    // D3 should now be before D1 among published:
    // Order in sequence: D3, D1, D2, D4
    expect(docProjects.map((p) => p.id)).toEqual([d3.project.id, d1.project.id, d2.project.id, d4.project.id]);
    expect(docProjects.map((p) => p.order)).toEqual([0, 1, 2, 3]);

    // Crucial check: Drafts D2 and D4 preserved their relative order (D2 is still before D4)!
    const d2Index = docProjects.findIndex((p) => p.id === d2.project.id);
    const d4Index = docProjects.findIndex((p) => p.id === d4.project.id);
    expect(d2Index).toBeLessThan(d4Index);
  });

  // ==========================================================================
  // Test 6: Project creation after deletion avoids duplicate order
  // ==========================================================================
  it("6. adds new project at the end of its category without creating duplicate orders after deletion", async () => {
    const d1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0);
    const d2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 1);
    const d3 = createProjectWithMedia("33333333-3333-4333-8333-333333333333", "documentary", 2);

    const initial = seedInitialPortfolio([d1, d2, d3]);
    const { csrfToken } = await createAdminRequest("POST");

    // Delete project d2 (order 1)
    const fdDelete = new URLSearchParams({
      intent: "delete",
      projectId: d2.project.id,
      csrfToken,
      revision: initial.revision,
    });
    const { request: reqDel } = await createAdminRequest("POST", fdDelete);
    const resDel = await adminPortfolioAction(makeActionArgs(reqDel));
    expect(resDel.status).toBe(200);
    const delData = (await resDel.json()) as { newRevision: string };

    // Remaining in documentary: d1 (0) and d3 (2). Total length = 2.
    // Our fix uses max(order) + 1 = 3!
    const fdCreate = new URLSearchParams({
      intent: "create",
      category: "documentary",
      csrfToken,
      revision: delData.newRevision,
    });
    const { request: reqCreate } = await createAdminRequest("POST", fdCreate);
    const resCreate = await adminPortfolioAction(makeActionArgs(reqCreate));
    expect(resCreate.status).toBe(200);
    const createData = (await resCreate.json()) as { createdId: string };

    const onDisk = getRawPortfolioContent(testPortfolioContentPath).content;
    const newProj = onDisk.projects.find((p) => p.id === createData.createdId)!;
    expect(newProj.order).toBe(3); // Strictly greater than d3's order (2)!

    // Verify all orders in documentary are distinct
    const docOrders = onDisk.projects.filter((p) => p.category === "documentary").map((p) => p.order);
    expect(new Set(docOrders).size).toBe(docOrders.length);
  });

  // ==========================================================================
  // Test 7: Project category change in portfolio-edit reassigns order cleanly
  // ==========================================================================
  it("7. appends project to the end of new category when category is changed in portfolio edit", async () => {
    const d1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0);
    const a1 = createProjectWithMedia("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "advertising", 0);
    const a2 = createProjectWithMedia("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "advertising", 1);

    const initial = seedInitialPortfolio([d1, a1, a2]);
    const { csrfToken } = await createAdminRequest("POST");

    // Move d1 to advertising in portfolio-edit
    const fdEdit = new URLSearchParams({
      csrfToken,
      revision: initial.revision,
      titleFr: "Doc renommé",
      titleEn: "Doc renamed",
      slugFr: "doc-renomme",
      slugEn: "doc-renamed",
      category: "advertising", // moved from documentary
      summaryFr: "Résumé",
      summaryEn: "Summary",
      presentationMode: "photo",
      aspectRatio: "3:2",
      side: "auto",
      showcase: "false",
      coverImageId: d1.project.coverImageId!,
      coverAltFr: "Alt FR",
      coverAltEn: "Alt EN",
      galleryImageIds: JSON.stringify([]),
    });

    const { request: reqEdit } = await createAdminRequest("POST", fdEdit);
    const resEdit = await adminPortfolioEditAction(makeActionArgs(reqEdit, { id: d1.project.id }));
    expect(resEdit.status).toBe(200);

    const onDisk = getRawPortfolioContent(testPortfolioContentPath).content;
    const moved = onDisk.projects.find((p) => p.id === d1.project.id)!;
    expect(moved.category).toBe("advertising");
    // advertising had a1 (0) and a2 (1). Max order was 1. Moved project should be order 2!
    expect(moved.order).toBe(2);
  });

  // ==========================================================================
  // Test 8: Rejection of invalid direction or parameters without mutation
  // ==========================================================================
  it("8. rejects invalid direction or missing project with 400/404 without mutating content", async () => {
    const d1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0);
    const initial = seedInitialPortfolio([d1]);
    const { csrfToken } = await createAdminRequest("POST");

    // Case A: invalid direction
    const fdBadDir = new URLSearchParams({
      intent: "reorder",
      projectId: d1.project.id,
      direction: "sideways",
      csrfToken,
      revision: initial.revision,
    });
    const { request: reqBadDir } = await createAdminRequest("POST", fdBadDir);
    const resBadDir = await adminPortfolioAction(makeActionArgs(reqBadDir));
    expect(resBadDir.status).toBe(400);

    // Case B: project not found
    const fdNotFound = new URLSearchParams({
      intent: "reorder",
      projectId: "99999999-9999-4999-8999-999999999999",
      direction: "up",
      csrfToken,
      revision: initial.revision,
    });
    const { request: reqNotFound } = await createAdminRequest("POST", fdNotFound);
    const resNotFound = await adminPortfolioAction(makeActionArgs(reqNotFound));
    expect(resNotFound.status).toBe(404);

    // Content revision on disk must be unchanged
    const onDisk = getRawPortfolioContent(testPortfolioContentPath).content;
    expect(onDisk.revision).toBe(initial.revision);
  });

  // ==========================================================================
  // Test 9: Optimistic concurrency revision conflict (409)
  // ==========================================================================
  it("9. returns 409 conflict when revision is stale and does not modify data", async () => {
    const d1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0);
    const d2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 1);
    const initial = seedInitialPortfolio([d1, d2]);
    const { csrfToken } = await createAdminRequest("POST");

    const fdStale = new URLSearchParams({
      intent: "reorder",
      projectId: d1.project.id,
      direction: "down",
      csrfToken,
      revision: "stale-revision-9999999999999999",
    });
    const { request } = await createAdminRequest("POST", fdStale);
    const res = await adminPortfolioAction(makeActionArgs(request));
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Conflit de révision");

    // Raw content unchanged
    const onDisk = getRawPortfolioContent(testPortfolioContentPath).content;
    expect(onDisk.revision).toBe(initial.revision);
    expect(onDisk.projects[0].order).toBe(0);
  });

  // ==========================================================================
  // Test 10: Deterministic sort consistency across public FR and EN routes
  // ==========================================================================
  it("10. delivers identical deterministic ordering on public FR and EN routes for photo and video projects", async () => {
    const p1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0, {
      titleFr: "Docu Photo",
      titleEn: "Doc Photo",
      mode: "photo",
      createdAt: 100,
    });
    const p2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 1, {
      titleFr: "Docu Vidéo",
      titleEn: "Doc Video",
      mode: "video",
      videoId: "999888777",
      createdAt: 200,
    });

    seedInitialPortfolio([p1, p2]);

    // Public FR request
    const reqFr = new Request("http://localhost:3000/fr/projets/documentaire");
    const resFr = await publicPortfolioLoader(makeLoaderArgs(reqFr, { rubrique: "documentaire" }));
    const dataFr = await resFr.json();

    // Public EN request
    const reqEn = new Request("http://localhost:3000/en/projects/documentary");
    const resEn = await publicPortfolioLoader(makeLoaderArgs(reqEn, { category: "documentary" }));
    const dataEn = await resEn.json();

    // Verify projects order in both FR and EN
    const frProjects = dataFr.content.projects.filter((p: PortfolioProject) => p.category === "documentary");
    const enProjects = dataEn.content.projects.filter((p: PortfolioProject) => p.category === "documentary");

    expect(frProjects.map((p: PortfolioProject) => p.id)).toEqual([p1.project.id, p2.project.id]);
    expect(enProjects.map((p: PortfolioProject) => p.id)).toEqual([p1.project.id, p2.project.id]);
  });

  // ==========================================================================
  // Test 11: UI arrow disabled states in AdminPortfolioPage
  // ==========================================================================
  it("11. correctly disables Up and Down buttons according to category position in admin UI", async () => {
    const d1 = createProjectWithMedia("11111111-1111-4111-8111-111111111111", "documentary", 0, {
      titleFr: "Projet D1",
    });
    const d2 = createProjectWithMedia("22222222-2222-4222-8222-222222222222", "documentary", 1, {
      titleFr: "Projet D2",
    });
    const c1 = createProjectWithMedia("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "corporate", 0, {
      titleFr: "Projet C1",
    });

    const content = seedInitialPortfolio([d1, d2, c1]);

    vi.mocked(useLoaderData).mockReturnValue({ content, csrfToken: "csrf-token-ui" });
    vi.mocked(useActionData).mockReturnValue(undefined);

    render(<AdminPortfolioPage />);

    // Documentary D1: first in category -> Up disabled, Down enabled
    const upD1 = screen.getByRole("button", { name: "Monter le projet Projet D1" });
    const downD1 = screen.getByRole("button", { name: "Descendre le projet Projet D1" });
    expect(upD1).toBeDisabled();
    expect(downD1).not.toBeDisabled();

    // Documentary D2: last in category -> Up enabled, Down disabled
    const upD2 = screen.getByRole("button", { name: "Monter le projet Projet D2" });
    const downD2 = screen.getByRole("button", { name: "Descendre le projet Projet D2" });
    expect(upD2).not.toBeDisabled();
    expect(downD2).toBeDisabled();

    // Corporate C1: sole project in category -> BOTH Up and Down disabled!
    const upC1 = screen.getByRole("button", { name: "Monter le projet Projet C1" });
    const downC1 = screen.getByRole("button", { name: "Descendre le projet Projet C1" });
    expect(upC1).toBeDisabled();
    expect(downC1).toBeDisabled();
  });
});
