// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useLocation: vi.fn(() => ({ pathname: "/fr/projets", search: "" })),
    useNavigate: vi.fn(() => vi.fn()),
    Link: ({
      children,
      to,
      preventScrollReset: _preventScrollReset,
      ...props
    }: {
      children: React.ReactNode;
      to: string;
      preventScrollReset?: boolean;
      [key: string]: unknown;
    }) => (
      <a href={to} {...props}>{children}</a>
    ),
  };
});

import { useLoaderData, useLocation } from "react-router";
import { isValidCalendarDate, validateContactTimeline } from "../app/lib/contact.server";
import { formatTimelineForEmail } from "../app/lib/mailer.server";
import { resolveSempraButtonUrl } from "../app/lib/site-content.shared";
import { validateHomeContent } from "../app/lib/site-content.server";
import {
  type PortfolioContent,
  type PortfolioMediaItem,
  portfolioContentSchema,
  resolveProjectPresentationMode,
} from "../app/lib/portfolio-content.shared";
import {
  getRawPortfolioContent,
  getPublicPortfolioContent,
  prunePortfolioMediaRegistry,
  cleanupUnreferencedPortfolioMedia,
} from "../app/lib/portfolio-content.server";
import { action as adminPortfolioUploadAction } from "../app/routes/api/admin-portfolio-upload";
import { action as adminPortfolioSectionAction } from "../app/routes/admin/portfolio-section";
import { loader as portfolioVariantLoader } from "../app/routes/media/portfolio-variant";
import { ScrollToTop } from "../app/components/public/ScrollToTop";
import PortfolioPage from "../app/routes/public/portfolio";
import type { CommonContent } from "../app/lib/site-content.shared";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";

// Canonical UUIDs for testing fixtures
const UUID_DOC_ENTRY = "11111111-1111-4111-8111-111111111111";
const UUID_DOC_BANNER = "22222222-2222-4222-8222-222222222222";
const UUID_PUB_ENTRY = "33333333-3333-4333-8333-333333333333";
const UUID_PUB_BANNER = "44444444-4444-4444-8444-444444444444";
const UUID_PROJ_PHOTO = "55555555-5555-4555-8555-555555555555";
const UUID_PROJ_PHOTO_ID = "66666666-6666-4666-8666-666666666666";
const UUID_PROJ_VIDEO_POSTER = "77777777-7777-4777-8777-777777777777";
const UUID_PROJ_VIDEO_COVER = "88888888-8888-4888-8888-888888888888";
const UUID_PROJ_VIDEO_ID = "99999999-9999-4999-8999-999999999999";

function createMockMediaItem(
  imageId: string,
  ownerType: "section" | "project",
  ownerId: string,
  mediaSlot: "category_entry" | "category_banner" | "cover" | "video_cover" | "gallery",
  width: number,
  height: number
): PortfolioMediaItem {
  return {
    imageId,
    ownerType,
    ownerId,
    mediaSlot,
    originalFormat: "webp",
    originalWidth: width,
    originalHeight: height,
    variants: [
      {
        name: "640p",
        width: 640,
        height: Math.round((height * 640) / width),
        webpSize: 15000,
        avifSize: 12000,
      },
      {
        name: "960p",
        width: 960,
        height: Math.round((height * 960) / width),
        webpSize: 25000,
        avifSize: 20000,
      },
    ],
    createdAt: 1000,
  };
}

const mockCommonContent = {
  brandName: "Parallax",
  navigation: {
    portfolio: { fr: "Réalisations", en: "Portfolio" },
    studio: { fr: "Studio", en: "Studio" },
    contact: { fr: "Contact", en: "Contact" },
    sempra: { fr: "SEMPRA", en: "SEMPRA" },
    clientArea: { fr: "Espace client", en: "Client area" },
  },
  footer: {
    tagline: { fr: "Production audiovisuelle", en: "Audiovisual production" },
    copyright: { fr: "© 2026 Parallax", en: "© 2026 Parallax" },
    legalNotice: { fr: "Mentions légales", en: "Legal notice" },
    privacy: { fr: "Politique de confidentialité", en: "Privacy policy" },
    terms: { fr: "CGV", en: "Terms" },
    cookies: { fr: "Politique relative aux cookies", en: "Cookie policy" },
    manageCookies: { fr: "Gérer les cookies", en: "Manage cookies" },
  },
} as unknown as CommonContent;

const mockPortfolioContent: PortfolioContent = {
  schemaVersion: 1,
  revision: "rev-portfolio-test-123456",
  updatedAt: new Date().toISOString(),
  overview: {
    seo: {
      title: { fr: "Réalisations — Parallax", en: "Portfolio — Parallax" },
      description: { fr: "Découvrez nos projets", en: "Discover our projects" },
    },
    title: { fr: "RÉALISATIONS", en: "PORTFOLIO" },
    intro: { fr: "Nos réalisations audiovisuelles", en: "Our audiovisual work" },
    seeMoreButton: { fr: "Voir plus de projets", en: "See more projects" },
  },
  sections: {
    documentary: {
      category: "documentary",
      title: { fr: "Documentaire", en: "Documentary" },
      intro: { fr: "Notre approche documentaire", en: "Our documentary approach" },
      seo: {
        title: { fr: "Documentaires — Parallax", en: "Documentaries — Parallax" },
        description: { fr: "Films documentaires", en: "Documentary films" },
      },
      coverImageId: null,
      coverAlt: { fr: "Couverture Doc", en: "Doc Cover" },
      entryImageId: UUID_DOC_ENTRY,
      entryAlt: { fr: "Visuel d'entrée Documentaire", en: "Doc Entry Visual" },
      entrySummary: { fr: "Films du réel et récits d'impact", en: "Real stories and impact films" },
      entrySide: "left",
      bannerImageId: UUID_DOC_BANNER,
      bannerAlt: { fr: "Bannière Doc 480px", en: "Doc Banner 480px" },
      backButton: { fr: "Retour aux réalisations", en: "Back to portfolio" },
      showreelVideo: null,
      showreelCoverImageId: null,
      showreelTitle: { fr: "Showreel Documentaire", en: "Documentary Showreel" },
      morePhotosButton: { fr: "Voir plus de photos", en: "See more photos" },
      lessPhotosButton: { fr: "Voir moins de photos", en: "See less photos" },
    },
    advertising: {
      category: "advertising",
      title: { fr: "Publicité", en: "Advertising" },
      intro: { fr: "Films de marque percutants", en: "Punchy brand films" },
      seo: {
        title: { fr: "Publicité — Parallax", en: "Advertising — Parallax" },
        description: { fr: "Films publicitaires", en: "Commercial films" },
      },
      coverImageId: null,
      coverAlt: { fr: "Couverture Pub", en: "Pub Cover" },
      entryImageId: UUID_PUB_ENTRY,
      entryAlt: { fr: "Visuel d'entrée Publicité", en: "Pub Entry Visual" },
      entrySummary: { fr: "Campagnes et narrations commerciales", en: "Campaigns and commercial storytelling" },
      entrySide: "right",
      bannerImageId: UUID_PUB_BANNER,
      bannerAlt: { fr: "Bannière Pub 480px", en: "Pub Banner 480px" },
      backButton: { fr: "Retour aux réalisations", en: "Back to portfolio" },
      showreelVideo: null,
      showreelCoverImageId: null,
      showreelTitle: { fr: "Showreel Publicité", en: "Advertising Showreel" },
      morePhotosButton: { fr: "Voir plus de photos", en: "See more photos" },
      lessPhotosButton: { fr: "Voir moins de photos", en: "See less photos" },
    },
  },
  projects: [
    {
      id: UUID_PROJ_PHOTO_ID,
      title: { fr: "Projet Photo Sauvage", en: "Wild Photo Project" },
      slugFr: "projet-photo-sauvage",
      slugEn: "wild-photo-project",
      category: "documentary",
      summary: { fr: "Immersion photographique", en: "Photographic immersion" },
      description: [{ type: "paragraph", text: { fr: "Texte éditorial photo", en: "Photo editorial text" } }],
      seo: {
        title: { fr: "Projet Photo", en: "Photo Project" },
        description: { fr: "Description", en: "Description" },
      },
      coverImageId: UUID_PROJ_PHOTO,
      coverAlt: { fr: "Couverture photo", en: "Photo cover" },
      galleryImageIds: [],
      video: null,
      draftVideoCoverImageId: null,
      presentationMode: "photo",
      aspectRatio: "3:2",
      showcase: false,
      side: "left",
      order: 0,
      status: "published",
      archived: false,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: UUID_PROJ_VIDEO_ID,
      title: { fr: "Projet Vidéo Cinéma", en: "Cinema Video Project" },
      slugFr: "projet-video-cinema",
      slugEn: "cinema-video-project",
      category: "documentary",
      summary: { fr: "Production documentaire 16:9", en: "16:9 documentary production" },
      description: [{ type: "paragraph", text: { fr: "Texte vidéo", en: "Video text" } }],
      seo: {
        title: { fr: "Projet Vidéo", en: "Video Project" },
        description: { fr: "Description", en: "Description" },
      },
      coverImageId: UUID_PROJ_VIDEO_COVER,
      coverAlt: { fr: "Affiche vidéo", en: "Video poster" },
      galleryImageIds: [],
      video: {
        provider: "youtube",
        videoId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        coverImageId: UUID_PROJ_VIDEO_POSTER,
      },
      draftVideoCoverImageId: null,
      presentationMode: "video",
      aspectRatio: "16:9",
      showcase: false,
      side: "auto",
      order: 1,
      status: "published",
      archived: false,
      createdAt: 2000,
      updatedAt: 2000,
    },
  ],
  media: {
    [UUID_DOC_ENTRY]: createMockMediaItem(UUID_DOC_ENTRY, "section", "documentary", "category_entry", 1920, 1080),
    [UUID_DOC_BANNER]: createMockMediaItem(UUID_DOC_BANNER, "section", "documentary", "category_banner", 1920, 480),
    [UUID_PUB_ENTRY]: createMockMediaItem(UUID_PUB_ENTRY, "section", "advertising", "category_entry", 1920, 1080),
    [UUID_PUB_BANNER]: createMockMediaItem(UUID_PUB_BANNER, "section", "advertising", "category_banner", 1920, 480),
    [UUID_PROJ_PHOTO]: createMockMediaItem(UUID_PROJ_PHOTO, "project", UUID_PROJ_PHOTO_ID, "cover", 1200, 800),
    [UUID_PROJ_VIDEO_COVER]: createMockMediaItem(UUID_PROJ_VIDEO_COVER, "project", UUID_PROJ_VIDEO_ID, "cover", 1920, 1080),
    [UUID_PROJ_VIDEO_POSTER]: createMockMediaItem(UUID_PROJ_VIDEO_POSTER, "project", UUID_PROJ_VIDEO_ID, "video_cover", 1920, 1080),
  },
};

const makeActionArgs = (req: Request, params: Record<string, string> = {}): ActionFunctionArgs =>
  ({
    request: req,
    params,
    context: {} as never,
  }) as unknown as ActionFunctionArgs;

const makeLoaderArgs = (req: Request, params: Record<string, string> = {}): LoaderFunctionArgs =>
  ({
    request: req,
    params,
    context: {} as never,
  }) as unknown as LoaderFunctionArgs;

async function createTestImageBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 30, g: 158, b: 255 },
    },
  })
    .jpeg()
    .toBuffer();
}

function createMultipartBody(
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer
): { body: BodyInit; boundary: string } {
  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const total = Buffer.concat([head, fileBuffer, tail]);
  return { body: total as BodyInit, boundary };
}

async function createAuthenticatedAdminRequest(): Promise<{ sessionCookie: string; csrfToken: string }> {
  const session = await getSession();
  session.set("adminId", "admin-test-1");
  session.set("credentialVersion", computeCredentialVersion());
  session.set("expiresAt", Date.now() + 3600_000);
  const csrfToken = "test-csrf-token-1234567890abcdef";
  session.set("csrfToken", csrfToken);
  const sessionCookie = await commitSession(session);
  return { sessionCookie, csrfToken };
}

describe("UX, Admin, and Portfolio Presentation Refinements", () => {
  let tempDir: string;
  let testPortfolioContent: string;
  let testPortfolioMedia: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-portfolio-test-"));
    testPortfolioContent = path.join(tempDir, "portfolio-content.json");
    testPortfolioMedia = path.join(tempDir, "portfolio-media");

    fs.mkdirSync(testPortfolioMedia, { mode: 0o700, recursive: true });
    fs.writeFileSync(testPortfolioContent, JSON.stringify(mockPortfolioContent, null, 2), "utf8");

    const testDbFile = path.join(tempDir, "rate-limit.sqlite");

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      RATE_LIMIT_SECRET: "rate-limit-secret-min-32-chars-long-2!",
      RATE_LIMIT_DB_PATH: testDbFile,
      PORTFOLIO_CONTENT_PATH: testPortfolioContent,
      PORTFOLIO_MEDIA_PATH: testPortfolioMedia,
      TRUST_PROXY: "false",
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

  describe("Fixture & Schema Integrity", () => {
    it("validates base fixture against portfolioContentSchema strictly", () => {
      const parsed = portfolioContentSchema.safeParse(mockPortfolioContent);
      expect(parsed.success).toBe(true);
    });
  });

  describe("Workstream 1: Contact Strict Calendar Validation & Date Picker", () => {
    it("validates real calendar dates correctly and rejects impossible calendar dates", () => {
      expect(isValidCalendarDate(2026, 11, 20)).toBe(true);
      expect(isValidCalendarDate(2024, 2, 29)).toBe(true);
      expect(isValidCalendarDate(2026, 2, 31)).toBe(false);
      expect(isValidCalendarDate(2026, 4, 31)).toBe(false);
      expect(isValidCalendarDate(2025, 2, 29)).toBe(false);
    });

    it("validateContactTimeline validates string formats strictly", () => {
      expect(validateContactTimeline("2026-11-20")).toBe(true);
      expect(validateContactTimeline("2024-02-29")).toBe(true);
      expect(validateContactTimeline("2026-02-31")).toBe(false);
      expect(validateContactTimeline("invalid")).toBe(false);
      expect(validateContactTimeline("20-11-2026")).toBe(false);
      expect(validateContactTimeline("")).toBe(true);
    });

    it("formatTimelineForEmail formats date without timezone shifting", () => {
      expect(formatTimelineForEmail("2026-11-20", "fr")).toBe("20 novembre 2026 (2026-11-20)");
      expect(formatTimelineForEmail("2026-11-20", "en")).toBe("November 20, 2026 (2026-11-20)");
      expect(formatTimelineForEmail("", "fr")).toBe("Non précisée");
      expect(formatTimelineForEmail("", "en")).toBe("Not specified");
    });
  });

  describe("Workstream 2: Home SEMPRA External Link", () => {
    it("resolves empty, hash, or legacy empty buttonUrl to https://sempra.be/", () => {
      expect(resolveSempraButtonUrl("")).toBe("https://sempra.be/");
      expect(resolveSempraButtonUrl("#")).toBe("https://sempra.be/");
      expect(resolveSempraButtonUrl("   ")).toBe("https://sempra.be/");
      expect(resolveSempraButtonUrl(undefined)).toBe("https://sempra.be/");
    });

    it("preserves valid external URLs and sanitizes dangerous schemes", () => {
      expect(resolveSempraButtonUrl("https://sempra.be/contact")).toBe("https://sempra.be/contact");
      expect(resolveSempraButtonUrl("http://sempra.be/")).toBe("http://sempra.be/");
      expect(resolveSempraButtonUrl("javascript:alert(1)")).toBe("https://sempra.be/");
    });
  });

  describe("Workstream 3: Admin Home Savoir-Faire Lists Bounds", () => {
    it("enforces max 50 items and max 300 characters per item", () => {
      const validHome = {
        seo: { title: { fr: "Accueil", en: "Home" }, description: { fr: "Desc", en: "Desc" } },
        hero: { badge: { fr: "B", en: "B" }, title: { fr: "Titre", en: "Title" }, subtitle: { fr: "Sub", en: "Sub" } },
        showreel: { title: { fr: "S", en: "S" }, videoUrl: "https://youtube.com/watch?v=123", coverImageId: null, coverImageAlt: { fr: "A", en: "A" } },
        duo: { title: { fr: "D", en: "D" }, text: { fr: "T", en: "T" }, imageId: null, imageAlt: { fr: "A", en: "A" } },
        savoirFaire: {
          title: { fr: "SF", en: "SF" },
          photoTitle: { fr: "Photo", en: "Photo" },
          photoItems: Array.from({ length: 51 }, (_, i) => ({ fr: `Item ${i}`, en: `Item ${i}` })),
          videoTitle: { fr: "Vid", en: "Vid" },
          videoItems: [{ fr: "Vid 1", en: "Vid 1" }],
        },
        contact: { title: { fr: "C", en: "C" }, emailLabel: { fr: "E", en: "E" }, email: "test@example.com", socialLabel: { fr: "S", en: "S" }, socialLinks: [] },
        sempra: { badge: { fr: "B", en: "B" }, title: { fr: "T", en: "T" }, description: { fr: "D", en: "D" }, buttonText: { fr: "BT", en: "BT" }, buttonUrl: "https://sempra.be/" },
      };

      expect(() => validateHomeContent(validHome)).toThrow(
        "home.savoirFaire.photoItems ne peut pas contenir plus de 50 éléments."
      );

      validHome.savoirFaire.photoItems = [{ fr: "a".repeat(301), en: "test" }];
      expect(() => validateHomeContent(validHome)).toThrow(
        "L'élément photo 1 ne doit pas dépasser 300 caractères."
      );
    });
  });

  describe("Workstream 4, 5, 6: Public Portfolio Presentation, Media Rendering & Navigation", () => {
    it("renders category entries on portfolio overview with real picture, img, srcset, and diagonal clip-path", () => {
      const loaderData = {
        lang: "fr" as const,
        common: mockCommonContent,
        content: mockPortfolioContent,
        showcaseProjects: [],
        panelState: {
          isOpen: false,
          activeCategory: null,
          activeProject: null,
          direction: "right" as const,
        },
      };

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets",
        search: "",
        hash: "",
        state: null,
        key: "default",
      });

      const { container } = render(<PortfolioPage />);

      // Section titles & summaries are present on overview
      expect(screen.getByText("Documentaire")).toBeInTheDocument();
      expect(screen.getByText("Publicité")).toBeInTheDocument();
      expect(screen.getByText("Films du réel et récits d'impact")).toBeInTheDocument();

      // Check real images rendered with pictures and srcset
      const pictures = container.querySelectorAll("picture");
      expect(pictures.length).toBeGreaterThanOrEqual(2);

      const docEntryImg = screen.getByAltText("Visuel d'entrée Documentaire");
      expect(docEntryImg).toBeInTheDocument();
      expect(docEntryImg.getAttribute("src")).toContain(`/media/portfolio/section/documentary/category_entry/${UUID_DOC_ENTRY}`);

      // Verify diagonal clip wrapper
      const clipLeft = container.querySelector('[class*="imageWrapperDiagonalLeft"]');
      expect(clipLeft).not.toBeNull();

      // No in-category filter tabs on overview
      expect(container.querySelector('[class*="filterTab"]')).toBeNull();
    });

    it("renders category panel with banner header, real img, and distinct photo / video modes", () => {
      const loaderData = {
        lang: "fr" as const,
        common: mockCommonContent,
        content: mockPortfolioContent,
        showcaseProjects: [],
        panelState: {
          isOpen: true,
          activeCategory: "documentary" as const,
          activeProject: null,
          direction: "right" as const,
        },
      };

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets/documentaire",
        search: "?dir=right",
        hash: "",
        state: null,
        key: "panel-open",
      });

      const { container } = render(<PortfolioPage />);

      // Category banner title & banner image
      expect(screen.getByRole("heading", { name: "Documentaire", level: 2 })).toBeInTheDocument();
      const bannerImg = screen.getByAltText("Bannière Doc 480px");
      expect(bannerImg).toBeInTheDocument();
      expect(bannerImg.getAttribute("src")).toContain(`/media/portfolio/section/documentary/category_banner/${UUID_DOC_BANNER}`);

      // Photo project rendered with photo box and real cover image
      expect(screen.getByText("Projet Photo Sauvage")).toBeInTheDocument();
      const photoCoverImg = screen.getByAltText("Couverture photo");
      expect(photoCoverImg).toBeInTheDocument();
      expect(photoCoverImg.getAttribute("src")).toContain(`/media/portfolio/project/${UUID_PROJ_PHOTO_ID}/cover/${UUID_PROJ_PHOTO}`);

      // Check format-based photo box class (photoBoxLandscape for 3:2)
      const photoBox = container.querySelector('[class*="photoBoxLandscape"]');
      expect(photoBox).not.toBeNull();

      // Video project rendered with 16:9 card and play button
      expect(screen.getByText("Projet Vidéo Cinéma")).toBeInTheDocument();
      expect(screen.getByText("Production documentaire 16:9")).toBeInTheDocument();
      expect(screen.getByLabelText("Lire la vidéo : Projet Vidéo Cinéma")).toBeInTheDocument();
      const videoPosterImg = screen.getByAltText("Affiche vidéo");
      expect(videoPosterImg).toBeInTheDocument();
      expect(videoPosterImg.getAttribute("src")).toContain(`/media/portfolio/project/${UUID_PROJ_VIDEO_ID}/video_cover/${UUID_PROJ_VIDEO_POSTER}`);

      // No in-category tabs present
      expect(screen.queryByText("Documentaire", { selector: ".filterTab" })).not.toBeInTheDocument();
    });
  });

  describe("Regression Suite: End-to-End Handlers, Segregation & Safety", () => {
    it("1. Real upload of category_entry and category_banner via adminPortfolioUploadAction", async () => {
      const { sessionCookie, csrfToken } = await createAuthenticatedAdminRequest();
      const imgBuf = await createTestImageBuffer();

      // Upload category_entry
      const { body: body1, boundary: boundary1 } = createMultipartBody("entry.jpg", "image/jpeg", imgBuf);
      const req1 = new Request("http://localhost:3000/api/admin/portfolio-upload", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: "http://localhost:3000",
          "Content-Type": `multipart/form-data; boundary=${boundary1}`,
          "x-csrf-token": csrfToken,
          "x-portfolio-owner-type": "section",
          "x-portfolio-owner-id": "documentary",
          "x-portfolio-media-slot": "category_entry",
          "x-portfolio-revision": mockPortfolioContent.revision,
        },
        body: body1,
      });

      const res1 = await adminPortfolioUploadAction(makeActionArgs(req1));
      expect(res1.status).toBe(200);
      const data1 = (await res1.json()) as { success: boolean; imageId: string; newRevision: string };
      expect(data1.success).toBe(true);
      const entryId = data1.imageId;

      // Upload category_banner
      const { body: body2, boundary: boundary2 } = createMultipartBody("banner.jpg", "image/jpeg", imgBuf);
      const req2 = new Request("http://localhost:3000/api/admin/portfolio-upload", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: "http://localhost:3000",
          "Content-Type": `multipart/form-data; boundary=${boundary2}`,
          "x-csrf-token": csrfToken,
          "x-portfolio-owner-type": "section",
          "x-portfolio-owner-id": "documentary",
          "x-portfolio-media-slot": "category_banner",
          "x-portfolio-revision": data1.newRevision,
        },
        body: body2,
      });

      const res2 = await adminPortfolioUploadAction(makeActionArgs(req2));
      expect(res2.status).toBe(200);
      const data2 = (await res2.json()) as { success: boolean; imageId: string; newRevision: string };
      expect(data2.success).toBe(true);
      const bannerId = data2.imageId;

      // Re-read content from disk and verify
      const { content } = getRawPortfolioContent();
      expect(content.sections.documentary.entryImageId).toBe(entryId);
      expect(content.sections.documentary.bannerImageId).toBe(bannerId);
      expect(content.media[entryId]).toBeDefined();
      expect(content.media[bannerId]).toBeDefined();
      expect(Array.isArray(content.media[entryId].variants)).toBe(true);
      expect(Array.isArray(content.media[bannerId].variants)).toBe(true);
    });

    it("2. Coexistence of both media after text edit, simulated reload, and replacing one of them", async () => {
      const { sessionCookie, csrfToken } = await createAuthenticatedAdminRequest();
      const imgBuf = await createTestImageBuffer();

      // Upload entry & banner
      const { body: b1, boundary: bd1 } = createMultipartBody("e.jpg", "image/jpeg", imgBuf);
      const r1 = new Request("http://localhost:3000/api/admin/portfolio-upload", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: "http://localhost:3000",
          "Content-Type": `multipart/form-data; boundary=${bd1}`,
          "x-csrf-token": csrfToken,
          "x-portfolio-owner-type": "section",
          "x-portfolio-owner-id": "documentary",
          "x-portfolio-media-slot": "category_entry",
          "x-portfolio-revision": mockPortfolioContent.revision,
        },
        body: b1,
      });
      const d1 = (await (await adminPortfolioUploadAction(makeActionArgs(r1))).json()) as { imageId: string; newRevision: string };

      const { body: b2, boundary: bd2 } = createMultipartBody("b.jpg", "image/jpeg", imgBuf);
      const r2 = new Request("http://localhost:3000/api/admin/portfolio-upload", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: "http://localhost:3000",
          "Content-Type": `multipart/form-data; boundary=${bd2}`,
          "x-csrf-token": csrfToken,
          "x-portfolio-owner-type": "section",
          "x-portfolio-owner-id": "documentary",
          "x-portfolio-media-slot": "category_banner",
          "x-portfolio-revision": d1.newRevision,
        },
        body: b2,
      });
      const d2 = (await (await adminPortfolioUploadAction(makeActionArgs(r2))).json()) as { imageId: string; newRevision: string };

      // Update text using adminPortfolioSectionAction
      const usp = new URLSearchParams();
      usp.set("csrfToken", csrfToken);
      usp.set("revision", d2.newRevision);
      usp.set("title_fr", "Documentaire Modifié");
      usp.set("title_en", "Modified Documentary");
      usp.set("intro_fr", "Nouvelle intro");
      usp.set("intro_en", "New intro");
      usp.set("entrySummary_fr", "Résumé entrée");
      usp.set("entrySummary_en", "Entry summary");
      usp.set("entrySide", "left");
      usp.set("seo_title_fr", "Titre SEO");
      usp.set("seo_title_en", "SEO Title");
      usp.set("seo_desc_fr", "Desc SEO");
      usp.set("seo_desc_en", "SEO Desc");
      usp.set("entryImageId", d1.imageId);
      usp.set("entryAlt_fr", "Alt entrée");
      usp.set("entryAlt_en", "Entry alt");
      usp.set("bannerImageId", d2.imageId);
      usp.set("bannerAlt_fr", "Alt bannière");
      usp.set("bannerAlt_en", "Banner alt");
      usp.set("coverImageId", "");
      usp.set("coverAlt_fr", "Alt couverture");
      usp.set("coverAlt_en", "Cover alt");
      usp.set("showreelTitle_fr", "Showreel");
      usp.set("showreelTitle_en", "Showreel");
      usp.set("showreelUrl", "");
      usp.set("showreelCoverImageId", "");
      usp.set("morePhotosButton_fr", "Voir plus");
      usp.set("morePhotosButton_en", "See more");
      usp.set("lessPhotosButton_fr", "Voir moins");
      usp.set("lessPhotosButton_en", "See less");
      usp.set("backButton_fr", "Retour");
      usp.set("backButton_en", "Back");

      const secReq = new Request("http://localhost:3000/admin/portfolio/section/documentary", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: "http://localhost:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: usp.toString(),
      });
      const secRes = await adminPortfolioSectionAction(makeActionArgs(secReq, { category: "documentary" }));
      const secData = (await secRes.json()) as { success: string; newRevision: string };
      expect(secData.success).toBeDefined();

      // Simulated reload
      const { content: reloaded } = getRawPortfolioContent();
      expect(reloaded.sections.documentary.title.fr).toBe("Documentaire Modifié");
      expect(reloaded.sections.documentary.entryImageId).toBe(d1.imageId);
      expect(reloaded.sections.documentary.bannerImageId).toBe(d2.imageId);

      // Now replace category_entry
      const { body: b3, boundary: bd3 } = createMultipartBody("e3.jpg", "image/jpeg", imgBuf);
      const r3 = new Request("http://localhost:3000/api/admin/portfolio-upload", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: "http://localhost:3000",
          "Content-Type": `multipart/form-data; boundary=${bd3}`,
          "x-csrf-token": csrfToken,
          "x-portfolio-owner-type": "section",
          "x-portfolio-owner-id": "documentary",
          "x-portfolio-media-slot": "category_entry",
          "x-portfolio-revision": secData.newRevision,
        },
        body: b3,
      });
      const d3 = (await (await adminPortfolioUploadAction(makeActionArgs(r3))).json()) as { imageId: string; newRevision: string };

      const { content: replacedContent } = getRawPortfolioContent();
      expect(replacedContent.sections.documentary.entryImageId).toBe(d3.imageId);
      // Banner remained completely intact!
      expect(replacedContent.sections.documentary.bannerImageId).toBe(d2.imageId);
    });

    it("3. Public DTO via getPublicPortfolioContent contains metadata of active entry and banner, excluding private media", () => {
      const privateOrphanId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const contentWithPrivate = {
        ...mockPortfolioContent,
        media: {
          ...mockPortfolioContent.media,
          [privateOrphanId]: createMockMediaItem(privateOrphanId, "section", "documentary", "category_entry", 1920, 1080),
        },
      };
      fs.writeFileSync(testPortfolioContent, JSON.stringify(contentWithPrivate, null, 2), "utf8");

      const { content: publicDto } = getPublicPortfolioContent();
      expect(publicDto.media[UUID_DOC_ENTRY]).toBeDefined();
      expect(publicDto.media[UUID_DOC_BANNER]).toBeDefined();
      expect(publicDto.media[UUID_PROJ_PHOTO]).toBeDefined();
      // Private orphan is strictly omitted
      expect(publicDto.media[privateOrphanId]).toBeUndefined();
    });

    it("4. Real public variants served with 200, 404 for unreferenced or wrong owner/slot", async () => {
      const { sessionCookie, csrfToken } = await createAuthenticatedAdminRequest();
      const imgBuf = await createTestImageBuffer();

      // Real upload to generate physical files on disk
      const { body, boundary } = createMultipartBody("var.jpg", "image/jpeg", imgBuf);
      const req = new Request("http://localhost:3000/api/admin/portfolio-upload", {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: "http://localhost:3000",
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-csrf-token": csrfToken,
          "x-portfolio-owner-type": "section",
          "x-portfolio-owner-id": "documentary",
          "x-portfolio-media-slot": "category_entry",
          "x-portfolio-revision": mockPortfolioContent.revision,
        },
        body,
      });
      const data = (await (await adminPortfolioUploadAction(makeActionArgs(req))).json()) as { imageId: string };
      const imgId = data.imageId;

      // 1. Valid request to category_entry variant
      const validReq = new Request(`http://localhost:3000/media/portfolio/section/documentary/category_entry/${imgId}/640p/webp`);
      const validRes = await portfolioVariantLoader(makeLoaderArgs(validReq, {
        ownerType: "section",
        ownerId: "documentary",
        slot: "category_entry",
        imageId: imgId,
        variant: "640p",
        ext: "webp",
      }));
      expect(validRes.status).toBe(200);
      expect(validRes.headers.get("Content-Type")).toBe("image/webp");
      const validBuf = await validRes.arrayBuffer();
      expect(validBuf.byteLength).toBeGreaterThan(0);

      // 2. Request with wrong slot -> 404
      const wrongSlotReq = new Request(`http://localhost:3000/media/portfolio/section/documentary/cover/${imgId}/640p/webp`);
      const wrongSlotRes = await portfolioVariantLoader(makeLoaderArgs(wrongSlotReq, {
        ownerType: "section",
        ownerId: "documentary",
        slot: "cover",
        imageId: imgId,
        variant: "640p",
        ext: "webp",
      }));
      expect(wrongSlotRes.status).toBe(404);

      // 3. Request with wrong owner -> 404
      const wrongOwnerReq = new Request(`http://localhost:3000/media/portfolio/section/advertising/category_entry/${imgId}/640p/webp`);
      const wrongOwnerRes = await portfolioVariantLoader(makeLoaderArgs(wrongOwnerReq, {
        ownerType: "section",
        ownerId: "advertising",
        slot: "category_entry",
        imageId: imgId,
        variant: "640p",
        ext: "webp",
      }));
      expect(wrongOwnerRes.status).toBe(404);

      // 4. Request with unreferenced image -> 404
      const unrefReq = new Request(`http://localhost:3000/media/portfolio/section/documentary/category_entry/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/640p/webp`);
      const unrefRes = await portfolioVariantLoader(makeLoaderArgs(unrefReq, {
        ownerType: "section",
        ownerId: "documentary",
        slot: "category_entry",
        imageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        variant: "640p",
        ext: "webp",
      }));
      expect(unrefRes.status).toBe(404);
    });

    it("5. prunePortfolioMediaRegistry and cleanupUnreferencedPortfolioMedia preserve active entry/banner and clean orphans", async () => {
      const orphanId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const content = {
        ...mockPortfolioContent,
        media: {
          ...mockPortfolioContent.media,
          [orphanId]: createMockMediaItem(orphanId, "section", "documentary", "category_entry", 1920, 1080),
        },
      };

      const pruned = prunePortfolioMediaRegistry(content);
      expect(pruned[UUID_DOC_ENTRY]).toBeDefined();
      expect(pruned[UUID_DOC_BANNER]).toBeDefined();
      expect(pruned[orphanId]).toBeUndefined();

      // Create an orphan directory on disk
      const orphanDir = path.join(testPortfolioMedia, "sections", "documentary", "category_entry", orphanId);
      fs.mkdirSync(orphanDir, { recursive: true });
      fs.writeFileSync(path.join(orphanDir, "test.txt"), "orphan data");

      const { cleanedCount } = await cleanupUnreferencedPortfolioMedia();
      expect(cleanedCount).toBe(1);
      expect(fs.existsSync(orphanDir)).toBe(false);
    });

    it("6. Rejects video publication without video URL or poster; tolerates drafts; resolves legacy mode consistently", () => {
      // 1. Published project in video mode without video is rejected
      const invalidVideoProject = {
        ...mockPortfolioContent.projects[1],
        presentationMode: "video" as const,
        video: null,
      };
      const invalidContent = {
        ...mockPortfolioContent,
        projects: [invalidVideoProject],
      };
      const parseInvalid = portfolioContentSchema.safeParse(invalidContent);
      expect(parseInvalid.success).toBe(false);
      if (!parseInvalid.success) {
        expect(parseInvalid.error.errors.some((e) => e.message.includes("mode Vidéo"))).toBe(true);
      }

      // 2. Draft project with incomplete fields is tolerated
      const draftProject = {
        ...mockPortfolioContent.projects[0],
        status: "draft" as const,
        video: null,
        coverImageId: null,
        summary: { fr: "", en: "" },
      };
      const draftContent = {
        ...mockPortfolioContent,
        projects: [draftProject],
      };
      const parseDraft = portfolioContentSchema.safeParse(draftContent);
      expect(parseDraft.success).toBe(true);

      // 3. Legacy project resolution:
      const legacyVideoProject = {
        video: { url: "https://www.youtube.com/watch?v=123" },
      };
      expect(resolveProjectPresentationMode(legacyVideoProject)).toBe("video");

      const legacyPhotoProject = {
        video: null,
      };
      expect(resolveProjectPresentationMode(legacyPhotoProject)).toBe("photo");
    });

    it("7. ScrollToTop with targetRef: scrolling panel triggers visibility, clicking scrolls panel, not window", () => {
      const panelEl = document.createElement("div");
      panelEl.scrollTo = vi.fn();
      panelEl.scrollTop = 0;
      const targetRef = { current: panelEl };

      const windowScrollToMock = vi.fn();
      window.scrollTo = windowScrollToMock;

      render(<ScrollToTop targetRef={targetRef} />);
      const button = screen.getByRole("button", { hidden: true });
      expect(button).toHaveAttribute("tabindex", "-1");
      expect(button).toHaveAttribute("aria-hidden", "true");

      // Scroll the panel element
      act(() => {
        panelEl.scrollTop = 120;
        panelEl.dispatchEvent(new Event("scroll"));
      });

      expect(button).toHaveAttribute("tabindex", "0");
      expect(button).toHaveAttribute("aria-hidden", "false");

      // Click the button
      fireEvent.click(button);

      // Confirms panel was scrolled to top and window was NOT touched
      expect(panelEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      expect(windowScrollToMock).not.toHaveBeenCalled();
    });
  });
});
