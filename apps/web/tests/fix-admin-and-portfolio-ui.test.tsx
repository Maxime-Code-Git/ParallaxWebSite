// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// Mock react-router for component rendering tests
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
import { action as adminHomeAction, loader as adminHomeLoader } from "../app/routes/admin/home";
import { action as adminContactAction } from "../app/routes/admin/contact";
import PortfolioPage, { loader as publicPortfolioLoader } from "../app/routes/public/portfolio";
import {
  getRawSiteContent,
  getSiteContent,
  saveHomeContent,
  type SiteContentV1,
  type SiteContentV2,
  type UploadedMediaMetadata,
} from "../app/lib/site-content.server";
import { getBackups } from "../app/lib/atomic-fs.server";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { ScrollToTop } from "../app/components/public/ScrollToTop";
import { resetClientPrivacyState } from "../app/lib/privacy-client";
import type { PortfolioContent, PortfolioMediaItem, PortfolioProject, PortfolioCategoryItem } from "../app/lib/portfolio-content.shared";

const UUID_DOC_ENTRY = "11111111-1111-4111-8111-111111111111";
const UUID_DOC_BANNER = "22222222-2222-4222-8222-222222222222";
const UUID_SHOWREEL_COVER = "33333333-3333-4333-8333-333333333333";
const UUID_HERO_PROJ_ID = "44444444-4444-4444-8444-444444444444";
const UUID_HERO_VIDEO_COVER = "55555555-5555-4555-8555-555555555555";
const UUID_PHOTO_PROJ_ID = "66666666-6666-4666-8666-666666666666";
const UUID_PHOTO_COVER = "77777777-7777-4777-8777-777777777777";
const UUID_SEC_VIDEO_COVER = "88888888-8888-4888-8888-888888888888";
const UUID_SITE_MEDIA = "99999999-9999-4999-8999-999999999999";

const VIDEO_HERO = {
  provider: "youtube" as const,
  videoId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  coverImageId: UUID_HERO_VIDEO_COVER,
};

const VIDEO_SEC = {
  provider: "youtube" as const,
  videoId: "jNQXAC9IVRw",
  url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  coverImageId: UUID_SEC_VIDEO_COVER,
};

const VIDEO_CAT = {
  provider: "youtube" as const,
  videoId: "L_LUpnjgPso",
  url: "https://www.youtube.com/watch?v=L_LUpnjgPso",
  coverImageId: UUID_SHOWREEL_COVER,
};

function createMockPortfolioMedia(
  imageId: string,
  ownerType: "section" | "project",
  ownerId: string,
  mediaSlot: "category_entry" | "category_banner" | "cover" | "video_cover" | "showreel_cover" | "gallery"
): PortfolioMediaItem {
  return {
    imageId,
    ownerType,
    ownerId,
    mediaSlot,
    originalFormat: "webp",
    originalWidth: 1920,
    originalHeight: 1080,
    variants: [
      {
        name: "640p",
        width: 640,
        height: 360,
        webpSize: 15000,
        avifSize: 12000,
      },
      {
        name: "960p",
        width: 960,
        height: 540,
        webpSize: 25000,
        avifSize: 20000,
      },
    ],
    createdAt: 1700000000000,
  };
}

function createPublishedPortfolioFixture(): PortfolioContent {
  const documentaryCategory: PortfolioCategoryItem = {
    id: "documentary",
    slugFr: "documentaire",
    slugEn: "documentary",
    order: 0,
    status: "published",
    title: { fr: "Documentaire", en: "Documentary" },
    intro: { fr: "Films documentaires", en: "Documentary films" },
    seo: {
      title: { fr: "Documentaire — Parallax", en: "Documentary — Parallax" },
      description: { fr: "Récits du réel", en: "Real stories" },
    },
    coverImageId: UUID_DOC_BANNER,
    coverAlt: { fr: "Bannière docu", en: "Docu banner" },
    entryImageId: UUID_DOC_ENTRY,
    entryAlt: { fr: "Visuel d'entrée", en: "Entry visual" },
    entrySummary: { fr: "Films d'impact", en: "Impact films" },
    entrySide: "left",
    bannerImageId: UUID_DOC_BANNER,
    bannerAlt: { fr: "Bannière docu", en: "Docu banner" },
    showreelTitle: { fr: "Showreel Documentaire", en: "Documentary Showreel" },
    showreelVideo: VIDEO_CAT,
    showreelCoverImageId: UUID_SHOWREEL_COVER,
    morePhotosButton: { fr: "Voir plus", en: "See more" },
    lessPhotosButton: { fr: "Voir moins", en: "See less" },
    backButton: { fr: "Retour aux projets", en: "Back to projects" },
  };

  const heroProject: PortfolioProject = {
    id: UUID_HERO_PROJ_ID,
    slugFr: "film-hero",
    slugEn: "hero-film",
    category: "documentary",
    order: 0,
    status: "published",
    archived: false,
    showcase: true,
    side: "auto",
    aspectRatio: "16:9",
    presentationMode: "video",
    title: { fr: "Grand Film Documentaire", en: "Major Documentary Film" },
    summary: { fr: "Un film immersif", en: "An immersive film" },
    description: [
      { type: "paragraph", text: { fr: "Histoire du projet.", en: "Story of the project." } },
    ],
    coverImageId: UUID_HERO_VIDEO_COVER,
    coverAlt: { fr: "Affiche hero", en: "Hero poster" },
    video: VIDEO_HERO,
    galleryImageIds: [],
    seo: {
      title: { fr: "Grand Film Documentaire", en: "Major Documentary Film" },
      description: { fr: "Description du film", en: "Film description" },
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  const photoProject: PortfolioProject = {
    id: UUID_PHOTO_PROJ_ID,
    slugFr: "photo-et-video",
    slugEn: "photo-and-video",
    category: "documentary",
    order: 1,
    status: "published",
    archived: false,
    showcase: false,
    side: "auto",
    aspectRatio: "3:2",
    presentationMode: "photo",
    title: { fr: "Reportage Terroir", en: "Local Craft Story" },
    summary: { fr: "Photos et vidéo secondaire", en: "Photos and secondary video" },
    description: [
      { type: "paragraph", text: { fr: "Texte reportage.", en: "Story text." } },
    ],
    coverImageId: UUID_PHOTO_COVER,
    coverAlt: { fr: "Photo terroir", en: "Local photo" },
    video: VIDEO_SEC,
    galleryImageIds: [],
    seo: {
      title: { fr: "Reportage Terroir", en: "Local Craft Story" },
      description: { fr: "Description reportage", en: "Report description" },
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  return {
    schemaVersion: 2,
    revision: "b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6",
    updatedAt: "2026-03-01T10:00:00.000Z",
    overview: {
      title: { fr: "Portfolio", en: "Portfolio" },
      intro: { fr: "Nos réalisations", en: "Our works" },
      seo: {
        title: { fr: "Portfolio — Studio", en: "Portfolio — Studio" },
        description: { fr: "Découvrez nos projets", en: "Discover our projects" },
      },
      seeMoreButton: {
        fr: "Voir plus de projets de ce genre",
        en: "See more projects like this",
      },
    },
    categories: [documentaryCategory],
    sections: {
      documentary: documentaryCategory,
    },
    projects: [heroProject, photoProject],
    media: {
      [UUID_DOC_ENTRY]: createMockPortfolioMedia(UUID_DOC_ENTRY, "section", "documentary", "category_entry"),
      [UUID_DOC_BANNER]: createMockPortfolioMedia(UUID_DOC_BANNER, "section", "documentary", "category_banner"),
      [UUID_SHOWREEL_COVER]: createMockPortfolioMedia(UUID_SHOWREEL_COVER, "section", "documentary", "showreel_cover"),
      [UUID_HERO_VIDEO_COVER]: createMockPortfolioMedia(UUID_HERO_VIDEO_COVER, "project", UUID_HERO_PROJ_ID, "video_cover"),
      [UUID_PHOTO_COVER]: createMockPortfolioMedia(UUID_PHOTO_COVER, "project", UUID_PHOTO_PROJ_ID, "cover"),
      [UUID_SEC_VIDEO_COVER]: createMockPortfolioMedia(UUID_SEC_VIDEO_COVER, "project", UUID_PHOTO_PROJ_ID, "video_cover"),
    },
  };
}

describe("Fix Admin Content & Public UI Suite", () => {
  let tempDir: string;
  let testContentFile: string;
  let testDbFile: string;
  let testPortfolioContentFile: string;
  const originalEnv = process.env;

  const makeLoaderArgs = (req: Request): LoaderFunctionArgs =>
    ({
      request: req,
      params: {},
      context: {} as never,
    }) as unknown as LoaderFunctionArgs;

  const makeActionArgs = (req: Request): ActionFunctionArgs =>
    ({
      request: req,
      params: {},
      context: {} as never,
    }) as unknown as ActionFunctionArgs;

  async function createValidAdminCookie(csrfToken = "test-valid-csrf-token-12345678"): Promise<string> {
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    session.set("csrfToken", csrfToken);
    return commitSession(session);
  }

  beforeEach(() => {
    vi.resetModules();
    resetClientPrivacyState();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-fix-tests-"));
    testContentFile = path.join(tempDir, "site-content.json");
    testDbFile = path.join(tempDir, "rate-limit.sqlite");
    testPortfolioContentFile = path.join(tempDir, "portfolio-content.json");
    const testMediaDir = path.join(tempDir, "site-media");
    const testPortfolioMediaDir = path.join(tempDir, "portfolio-media");
    fs.mkdirSync(testMediaDir, { mode: 0o700, recursive: true });
    fs.mkdirSync(testPortfolioMediaDir, { mode: 0o700, recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      PUBLIC_SITE_URL: "http://localhost:3000",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g",
      ADMIN_SESSION_SECRET: "session-secret-min-32-chars-long-1!",
      RATE_LIMIT_SECRET: "rate-limit-secret-min-32-chars-long-2!",
      RATE_LIMIT_DB_PATH: testDbFile,
      SITE_CONTENT_PATH: testContentFile,
      SITE_MEDIA_PATH: testMediaDir,
      PORTFOLIO_CONTENT_PATH: testPortfolioContentFile,
      PORTFOLIO_MEDIA_PATH: testPortfolioMediaDir,
      TRUST_PROXY: "false",
    };

    // Initialize published portfolio fixture on disk
    fs.writeFileSync(testPortfolioContentFile, JSON.stringify(createPublishedPortfolioFixture(), null, 2), "utf-8");
  });

  afterEach(() => {
    resetClientPrivacyState();
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Administration Accueil & Contact Validations, Coherence & Sync
  // =========================================================================
  describe("1. Admin Home & Contact Validations and Coherence", () => {
    it("rejects Home POST with invalid instagramUrl (e.g. mailto: or #) with 422 and does NOT alter disk or rotate backups", async () => {
      const cookie = await createValidAdminCookie();
      const { content: initial } = getRawSiteContent();
      const initialRev = initial.revision;

      const modifiedHome = structuredClone(initial.home);
      modifiedHome.contact.instagramUrl = "mailto:synthetic@example.test";

      const body = new URLSearchParams({
        csrfToken: "test-valid-csrf-token-12345678",
        revision: initialRev,
        homeData: JSON.stringify(modifiedHome),
      });

      const req = new Request("http://localhost:3000/admin/home", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const res = await adminHomeAction(makeActionArgs(req));
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toMatch(/instagram/i);

      // Verify disk was NOT modified and revision is unchanged
      const { content: after, isCorrupted } = getRawSiteContent();
      expect(isCorrupted).toBe(false);
      expect(after.revision).toBe(initialRev);
      expect(after.home.contact.instagramUrl).toBe(initial.home.contact.instagramUrl);
    });

    it("rejects Contact POST with invalid phone format (e.g. 0477 too short) with 422 and does NOT corrupt site-content", async () => {
      const cookie = await createValidAdminCookie();
      const { content: initial } = getRawSiteContent();
      const initialRev = initial.revision;

      const modifiedContact = structuredClone(initial.contactPage);
      modifiedContact.card.phone = "0477";

      const body = new URLSearchParams({
        csrfToken: "test-valid-csrf-token-12345678",
        revision: initialRev,
        contactPageData: JSON.stringify(modifiedContact),
        canonicalCoordinates: JSON.stringify({
          phone: "0477",
          email: "valid@example.com",
          instagramUrl: "https://instagram.com/parallax",
          youtubeUrl: "https://youtube.com/@parallax",
        }),
      });

      const req = new Request("http://localhost:3000/admin/contact", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const res = await adminContactAction(makeActionArgs(req));
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toMatch(/téléphone/i);

      // Verify document on disk is intact and not corrupted
      const { content: after, isCorrupted } = getRawSiteContent();
      expect(isCorrupted).toBe(false);
      expect(after.revision).toBe(initialRev);
    });

    it("completes full cycle: Read -> Edit Home -> 200 -> Read -> Edit Contact -> 200 -> Read (without SMTP configured)", async () => {
      const cookie = await createValidAdminCookie();

      // Step 1: Read Home
      const { content: step1Content } = getRawSiteContent();
      const rev1 = step1Content.revision;

      // Step 2: Edit Home with valid data
      const newHome = structuredClone(step1Content.home);
      newHome.hero.title.fr = "Titre Accueil Modifié";
      newHome.contact.email = "contact@parallax.studio";
      newHome.contact.instagramUrl = "https://instagram.com/parallax_studio";

      const bodyHome = new URLSearchParams({
        csrfToken: "test-valid-csrf-token-12345678",
        revision: rev1,
        homeData: JSON.stringify(newHome),
      });

      const reqHome = new Request("http://localhost:3000/admin/home", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyHome.toString(),
      });

      const resHome = await adminHomeAction(makeActionArgs(reqHome));
      expect(resHome.status).toBe(200);
      const jsonHome = await resHome.json();
      expect(jsonHome.success).toBe(true);
      const rev2 = jsonHome.newRevision;
      expect(rev2).toBeDefined();

      // Step 3: Read after Home edit
      const { content: step2Content, isCorrupted: corruptedAfterHome } = getRawSiteContent();
      expect(corruptedAfterHome).toBe(false);
      expect(step2Content.revision).toBe(rev2);
      expect(step2Content.home.hero.title.fr).toBe("Titre Accueil Modifié");
      expect(step2Content.company.email).toBe("contact@parallax.studio");
      expect(step2Content.company.instagramUrl).toBe("https://instagram.com/parallax_studio");

      // Step 4: Edit Contact with valid data
      const newContact = structuredClone(step2Content.contactPage);
      newContact.hero.title.fr = "Contactez Notre Équipe";
      newContact.card.phone = "+33 4 77 00 00 00";

      const bodyContact = new URLSearchParams({
        csrfToken: "test-valid-csrf-token-12345678",
        revision: rev2,
        contactPageData: JSON.stringify(newContact),
        canonicalCoordinates: JSON.stringify({
          phone: "+33 4 77 00 00 00",
          email: "contact@parallax.studio",
          instagramUrl: "https://instagram.com/parallax_studio",
          youtubeUrl: "https://youtube.com/@parallax_studio",
        }),
      });

      const reqContact = new Request("http://localhost:3000/admin/contact", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyContact.toString(),
      });

      const resContact = await adminContactAction(makeActionArgs(reqContact));
      expect(resContact.status).toBe(200);
      const jsonContact = await resContact.json();
      expect(jsonContact.success).toBe(true);
      const rev3 = jsonContact.newRevision;
      expect(rev3).toBeDefined();

      // Step 5: Read after Contact edit
      const { content: step3Content, isCorrupted: corruptedAfterContact } = getRawSiteContent();
      expect(corruptedAfterContact).toBe(false);
      expect(step3Content.revision).toBe(rev3);
      expect(step3Content.contactPage.hero.title.fr).toBe("Contactez Notre Équipe");
      expect(step3Content.company.phone).toBe("+33 4 77 00 00 00");
    });

    it("admin loader returns corruption details honestly when file is unreadable/corrupted", async () => {
      const cookie = await createValidAdminCookie();
      fs.writeFileSync(testContentFile, "{ invalid json content ...", "utf-8");

      const req = new Request("http://localhost:3000/admin/home", {
        headers: { Cookie: cookie },
      });

      const res = await adminHomeLoader(makeLoaderArgs(req));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isCorrupted).toBe(true);
      expect(json.corruptionError).toBeDefined();
      expect(typeof json.corruptionError).toBe("string");
      expect(json.corruptionError.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 2. Real Migration Reader Pipeline via getRawSiteContent() on Disk Fixtures
  // =========================================================================
  describe("2. Real Migration Reader Pipeline via getRawSiteContent()", () => {
    it("migrates real disk V2 document with '#' placeholder URLs and '0477' phone into valid V3 on first read, and remains stable on second read", () => {
      const initial = getSiteContent();
      const mockMedia: UploadedMediaMetadata = {
        imageId: UUID_SITE_MEDIA,
        location: "duo",
        originalWidth: 1920,
        originalHeight: 1080,
        variants: [
          {
            name: "640p",
            width: 640,
            height: 360,
            sizeBytesWebp: 12000,
            sizeBytesAvif: 10000,
            fileId: "duo-640p.webp",
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
      };

      const v2DiskDocument: SiteContentV2 = {
        schemaVersion: 2,
        revision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        updatedAt: "2026-02-01T10:00:00.000Z",
        common: {
          ...initial.common,
          brandName: "Parallax Legacy Studio",
        },
        home: {
          ...initial.home,
          hero: {
            ...initial.home.hero,
            title: { fr: "Titre Historique V2", en: "Historical V2 Title" },
          },
          contact: {
            ...initial.home.contact,
            email: "contact@legacy.be",
            instagramUrl: "#",
            youtubeUrl: "#",
          },
          duo: {
            ...initial.home.duo,
            imageId: UUID_SITE_MEDIA,
          },
        },
        studio: initial.studio,
        contactPage: {
          ...initial.contactPage,
          card: {
            ...initial.contactPage.card,
            phone: "0477",
          },
        },
        media: {
          [UUID_SITE_MEDIA]: mockMedia,
        },
      };

      // Write real legacy V2 file to disk
      fs.writeFileSync(testContentFile, JSON.stringify(v2DiskDocument, null, 2), "utf-8");
      expect(getBackups(testContentFile)).toHaveLength(0);

      // FIRST READ: Real getRawSiteContent() pipeline
      const firstRead = getRawSiteContent();
      expect(firstRead.isCorrupted).toBe(false);
      expect(firstRead.corruptionError).toBeUndefined();
      expect(firstRead.content.schemaVersion).toBe(3);
      expect(firstRead.content.revision).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
      expect(firstRead.content.updatedAt).toBe("2026-02-01T10:00:00.000Z");
      expect(firstRead.content.home.hero.title.fr).toBe("Titre Historique V2");
      expect(firstRead.content.home.contact.email).toBe("contact@legacy.be");
      expect(firstRead.content.home.contact.instagramUrl).toBe("");
      expect(firstRead.content.home.contact.youtubeUrl).toBe("");
      expect(firstRead.content.contactPage.card.phone).toBe("");
      expect(firstRead.content.company.tradeName).toBe("Parallax Legacy Studio");
      expect(firstRead.content.company.email).toBe("contact@legacy.be");
      expect(firstRead.content.company.instagramUrl).toBe("");
      expect(firstRead.content.company.youtubeUrl).toBe("");
      expect(firstRead.content.company.phone).toBe("");
      expect(firstRead.content.media?.[UUID_SITE_MEDIA]).toBeDefined();

      // Verify file on disk was upgraded to valid V3 and original was backed up
      const diskContentAfterFirst = JSON.parse(fs.readFileSync(testContentFile, "utf-8"));
      expect(diskContentAfterFirst.schemaVersion).toBe(3);
      expect(diskContentAfterFirst.company).toBeDefined();
      expect(diskContentAfterFirst.legalPages).toBeDefined();

      const backupsAfterFirst = getBackups(testContentFile);
      expect(backupsAfterFirst).toHaveLength(1);
      const backupRaw = JSON.parse(fs.readFileSync(path.join(tempDir, backupsAfterFirst[0]), "utf-8"));
      expect(backupRaw.schemaVersion).toBe(2);
      expect(backupRaw.home.contact.instagramUrl).toBe("#");
      expect(backupRaw.contactPage.card.phone).toBe("0477");

      // SECOND READ / REOPENING: Must remain valid and not generate duplicate writes/backups
      const secondRead = getRawSiteContent();
      expect(secondRead.isCorrupted).toBe(false);
      expect(secondRead.content.schemaVersion).toBe(3);
      expect(secondRead.content.revision).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
      expect(secondRead.content.home.hero.title.fr).toBe("Titre Historique V2");
      expect(getBackups(testContentFile)).toHaveLength(1);
    });

    it("migrates real disk V1 document with custom media registry and localized texts into valid V3", () => {
      const initial = getSiteContent();
      const mockMedia: UploadedMediaMetadata = {
        imageId: UUID_SITE_MEDIA,
        location: "duo",
        originalWidth: 1920,
        originalHeight: 1080,
        variants: [
          {
            name: "640p",
            width: 640,
            height: 360,
            sizeBytesWebp: 12000,
            sizeBytesAvif: 10000,
            fileId: "duo-640p.webp",
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
      };

      const v1DiskDocument: SiteContentV1 = {
        schemaVersion: 1,
        revision: "c1c2c3c4c5c6c7c8c9c0c1c2c3c4c5c6",
        updatedAt: "2026-01-15T08:00:00.000Z",
        common: {
          ...initial.common,
          brandName: "Parallax V1 Brand",
        },
        home: {
          ...initial.home,
          contact: {
            ...initial.home.contact,
            email: "v1@parallax.test",
            instagramUrl: "#",
            youtubeUrl: "https://youtube.com/@parallax_v1",
          },
          duo: {
            ...initial.home.duo,
            imageId: UUID_SITE_MEDIA,
          },
        },
        studio: initial.studio,
        media: {
          [UUID_SITE_MEDIA]: mockMedia,
        },
      };

      fs.writeFileSync(testContentFile, JSON.stringify(v1DiskDocument, null, 2), "utf-8");

      // First read: V1 -> V2 -> V3 migration
      const firstRead = getRawSiteContent();
      expect(firstRead.isCorrupted).toBe(false);
      expect(firstRead.content.schemaVersion).toBe(3);
      expect(firstRead.content.revision).toBe("c1c2c3c4c5c6c7c8c9c0c1c2c3c4c5c6");
      expect(firstRead.content.company.tradeName).toBe("Parallax V1 Brand");
      expect(firstRead.content.company.email).toBe("v1@parallax.test");
      expect(firstRead.content.company.instagramUrl).toBe("");
      expect(firstRead.content.company.youtubeUrl).toBe("https://youtube.com/@parallax_v1");
      expect(firstRead.content.home.contact.instagramUrl).toBe("");
      expect(firstRead.content.home.contact.youtubeUrl).toBe("https://youtube.com/@parallax_v1");
      expect(firstRead.content.contactPage).toBeDefined();
      expect(firstRead.content.media?.[UUID_SITE_MEDIA]).toBeDefined();

      // Second read
      const secondRead = getRawSiteContent();
      expect(secondRead.isCorrupted).toBe(false);
      expect(secondRead.content.revision).toBe("c1c2c3c4c5c6c7c8c9c0c1c2c3c4c5c6");
    });

    it("rejects legacy document with unconvertible coordinates without altering disk or creating backups", () => {
      const initial = getSiteContent();

      // Case A: Unconvertible instagramUrl (e.g. mailto: or non-url random string)
      const corruptedV2A = {
        schemaVersion: 2,
        revision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        updatedAt: "2026-02-01T10:00:00.000Z",
        common: initial.common,
        home: {
          ...initial.home,
          contact: {
            ...initial.home.contact,
            instagramUrl: "mailto:bad-address@example.com",
          },
        },
        studio: initial.studio,
        contactPage: initial.contactPage,
      };

      const rawJsonA = JSON.stringify(corruptedV2A, null, 2);
      fs.writeFileSync(testContentFile, rawJsonA, "utf-8");
      const statBeforeA = fs.statSync(testContentFile);

      const readA = getRawSiteContent();
      expect(readA.isCorrupted).toBe(true);
      expect(readA.corruptionError).toMatch(/instagram/i);

      // Verify file on disk is UNTOUCHED and no backups were created
      expect(fs.readFileSync(testContentFile, "utf-8")).toBe(rawJsonA);
      expect(fs.statSync(testContentFile).mtimeMs).toBe(statBeforeA.mtimeMs);
      expect(getBackups(testContentFile)).toHaveLength(0);

      // Case B: Unconvertible phone (letters / non-phone symbols)
      const corruptedV2B = {
        schemaVersion: 2,
        revision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        updatedAt: "2026-02-01T10:00:00.000Z",
        common: initial.common,
        home: initial.home,
        studio: initial.studio,
        contactPage: {
          ...initial.contactPage,
          card: {
            ...initial.contactPage.card,
            phone: "appeler-maxime-au-studio",
          },
        },
      };

      const rawJsonB = JSON.stringify(corruptedV2B, null, 2);
      fs.writeFileSync(testContentFile, rawJsonB, "utf-8");
      const readB = getRawSiteContent();
      expect(readB.isCorrupted).toBe(true);
      expect(readB.corruptionError).toMatch(/téléphone/i);
      expect(fs.readFileSync(testContentFile, "utf-8")).toBe(rawJsonB);
      expect(getBackups(testContentFile)).toHaveLength(0);

      // Case C: Structural corruption (missing required object)
      const corruptedV2C = {
        schemaVersion: 2,
        revision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        updatedAt: "2026-02-01T10:00:00.000Z",
        common: null,
      };

      fs.writeFileSync(testContentFile, JSON.stringify(corruptedV2C), "utf-8");
      const readC = getRawSiteContent();
      expect(readC.isCorrupted).toBe(true);
      expect(getBackups(testContentFile)).toHaveLength(0);
    });

    it("maintains bounded rotation of backups (maximum 5 backups)", () => {
      const { content: initial } = getRawSiteContent();
      let currentRev = initial.revision;

      // Perform 7 successive valid edits to trigger 7 atomic writes
      for (let i = 1; i <= 7; i++) {
        const nextHome = structuredClone(initial.home);
        nextHome.hero.title.fr = `Titre Sauvegarde Successive ${i}`;
        currentRev = saveHomeContent(nextHome, currentRev);
      }

      const backups = getBackups(testContentFile);
      expect(backups.length).toBeLessThanOrEqual(5);
      expect(backups.length).toBe(5);
    });
  });

  // =========================================================================
  // 3. ScrollToTop Component Stability & Target Handling
  // =========================================================================
  describe("3. ScrollToTop Component & Target Handling", () => {
    it("renders as hidden and tabIndex -1 when scrollTop <= 60", () => {
      const { container } = render(<ScrollToTop />);
      const btn = container.querySelector("button");
      expect(btn).toBeTruthy();
      expect(btn?.getAttribute("tabindex")).toBe("-1");
      expect(btn?.getAttribute("aria-hidden")).toBe("true");
    });

    it("becomes visible and tabIndex 0 when scrolling panel targetRef past 60", () => {
      const panel = document.createElement("div");
      panel.scrollTop = 0;
      panel.scrollTo = vi.fn();
      const targetRef = { current: panel };

      const { container } = render(<ScrollToTop targetRef={targetRef} />);
      const btn = container.querySelector("button");

      act(() => {
        panel.scrollTop = 150;
        panel.dispatchEvent(new Event("scroll"));
      });

      expect(btn?.getAttribute("tabindex")).toBe("0");
      expect(btn?.getAttribute("aria-hidden")).toBe("false");

      const windowScrollToMock = vi.fn();
      window.scrollTo = windowScrollToMock;

      fireEvent.click(btn!);
      expect(panel.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      expect(windowScrollToMock).not.toHaveBeenCalled();
    });

    it("remains hidden and non-focusable when hidden prop is true (e.g. video modal open)", () => {
      const panel = document.createElement("div");
      panel.scrollTop = 200;
      const targetRef = { current: panel };

      const { container, rerender } = render(<ScrollToTop targetRef={targetRef} hidden={false} />);
      const btn = container.querySelector("button");

      act(() => {
        panel.scrollTop = 200;
        panel.dispatchEvent(new Event("scroll"));
      });
      expect(btn?.getAttribute("tabindex")).toBe("0");

      rerender(<ScrollToTop targetRef={targetRef} hidden={true} />);
      expect(btn?.getAttribute("tabindex")).toBe("-1");
      expect(btn?.getAttribute("aria-hidden")).toBe("true");
    });

    it("cleans up event listeners properly on unmount", () => {
      const panel = document.createElement("div");
      const removeSpy = vi.spyOn(panel, "removeEventListener");
      const targetRef = { current: panel };

      const { unmount } = render(<ScrollToTop targetRef={targetRef} />);
      unmount();
      expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    });
  });

  // =========================================================================
  // 4. Mobile Portfolio Category Entry Layout & CTA (Real Component & Loader)
  // =========================================================================
  describe("4. Mobile Portfolio Category Entry Layout & CTA (Real PortfolioPage & Loader)", () => {
    it("renders real category CTA links with responsive labels and localized slugs in French (/fr/projets)", async () => {
      const req = new Request("http://localhost:3000/fr/projets");
      const res = await publicPortfolioLoader({ request: req, params: {} } as unknown as LoaderFunctionArgs);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets",
        search: "",
        hash: "",
        state: null,
        key: "fr-overview",
      });

      const { container } = render(<PortfolioPage />);

      const seeMoreLinks = container.querySelectorAll("a[class*='seeMoreBtn']");
      expect(seeMoreLinks.length).toBeGreaterThanOrEqual(1);

      const docLink = Array.from(seeMoreLinks).find((el) =>
        el.getAttribute("href")?.includes("/fr/projets/documentaire")
      );
      expect(docLink).toBeTruthy();
      expect(docLink?.getAttribute("href")).toMatch(/\/fr\/projets\/documentaire\?dir=(left|right)/);
      expect(docLink?.getAttribute("aria-label")).toBe("Voir les projets - Documentaire");

      const mobileLabel = docLink?.querySelector("[class*='btnLabelMobile']");
      expect(mobileLabel).toBeTruthy();
      expect(mobileLabel?.textContent?.trim()).toBe("Voir les projets");

      const desktopLabel = docLink?.querySelector("[class*='btnLabelDesktop']");
      expect(desktopLabel).toBeTruthy();
      expect(desktopLabel?.textContent?.trim()).toBe("Voir plus de projets de ce genre");
    });

    it("renders real category CTA links with responsive labels and localized slugs in English (/en/projects)", async () => {
      const req = new Request("http://localhost:3000/en/projects");
      const res = await publicPortfolioLoader({ request: req, params: {} } as unknown as LoaderFunctionArgs);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/en/projects",
        search: "",
        hash: "",
        state: null,
        key: "en-overview",
      });

      const { container } = render(<PortfolioPage />);

      const seeMoreLinks = container.querySelectorAll("a[class*='seeMoreBtn']");
      expect(seeMoreLinks.length).toBeGreaterThanOrEqual(1);

      const docLink = Array.from(seeMoreLinks).find((el) =>
        el.getAttribute("href")?.includes("/en/projects/documentary")
      );
      expect(docLink).toBeTruthy();
      expect(docLink?.getAttribute("href")).toMatch(/\/en\/projects\/documentary\?dir=(left|right)/);
      expect(docLink?.getAttribute("aria-label")).toBe("View projects - Documentary");

      const mobileLabel = docLink?.querySelector("[class*='btnLabelMobile']");
      expect(mobileLabel).toBeTruthy();
      expect(mobileLabel?.textContent?.trim()).toBe("View projects");

      const desktopLabel = docLink?.querySelector("[class*='btnLabelDesktop']");
      expect(desktopLabel).toBeTruthy();
      expect(desktopLabel?.textContent?.trim()).toBe("See more projects like this");
    });
  });

  // =========================================================================
  // 5. Video Poster Centered Play Button & Modal Consent in 4 Real Contexts
  // =========================================================================
  describe("5. Video Poster Centered Play Button & Modal Consent in 4 Real Contexts", () => {
    it("Context 1: Hero project video renders real picture, overlay, play button, and opens modal with consent gate", async () => {
      const req = new Request("http://localhost:3000/fr/projets/documentaire/film-hero?dir=right");
      const res = await publicPortfolioLoader({
        request: req,
        params: { rubrique: "documentaire", slugFr: "film-hero" },
      } as unknown as LoaderFunctionArgs);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets/documentaire/film-hero",
        search: "?dir=right",
        hash: "",
        state: null,
        key: "hero-proj",
      });

      const { container } = render(<PortfolioPage />);

      // Find hero video card in project detail
      const heroCoverWrap = container.querySelector("[class*='detailCoverWrap']");
      expect(heroCoverWrap).toBeTruthy();

      const card = heroCoverWrap?.querySelector("[class*='showreelCard']");
      expect(card).toBeTruthy();

      // Real ResponsivePortfolioImage produces <picture> with <source> elements
      const picture = card?.querySelector("picture");
      expect(picture).toBeTruthy();
      expect(picture?.querySelectorAll("source").length).toBeGreaterThanOrEqual(1);

      // Centered overlay wrapper and Play button
      const overlay = card?.querySelector("[class*='showreelOverlay']");
      expect(overlay).toBeTruthy();
      const playBtn = overlay?.querySelector("button[class*='playBtn']");
      expect(playBtn).toBeTruthy();

      // Click Play Button -> opens VideoModal
      fireEvent.click(playBtn!);

      // Consent notice is displayed, NO iframe before user consent
      expect(screen.getByText(/lecture externe/i)).toBeTruthy();
      expect(container.querySelector("iframe")).toBeNull();

      // Accept consent -> iframe is rendered with correct embed URL
      const confirmBtn = screen.getByRole("button", { name: /accepter et lire/i });
      fireEvent.click(confirmBtn);

      const iframe = container.querySelector("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    });

    it("Context 2: Secondary photo project video renders real picture, overlay, play button, and mounts iframe upon consent", async () => {
      const req = new Request("http://localhost:3000/fr/projets/documentaire/photo-et-video?dir=right");
      const res = await publicPortfolioLoader({
        request: req,
        params: { rubrique: "documentaire", slugFr: "photo-et-video" },
      } as unknown as LoaderFunctionArgs);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets/documentaire/photo-et-video",
        search: "?dir=right",
        hash: "",
        state: null,
        key: "photo-proj",
      });

      const { container } = render(<PortfolioPage />);

      // Secondary video section inside photo presentation mode
      const videoSection = container.querySelector("[class*='detailVideoSection']");
      expect(videoSection).toBeTruthy();

      const card = videoSection?.querySelector("[class*='showreelCard']");
      expect(card).toBeTruthy();

      const picture = card?.querySelector("picture");
      expect(picture).toBeTruthy();

      const overlay = card?.querySelector("[class*='showreelOverlay']");
      expect(overlay).toBeTruthy();

      const playBtn = overlay?.querySelector("button[class*='playBtn']");
      expect(playBtn).toBeTruthy();

      // Click play and accept consent
      fireEvent.click(playBtn!);
      expect(container.querySelector("iframe")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /accepter et lire/i }));
      const iframe = container.querySelector("iframe");
      expect(iframe?.getAttribute("src")).toContain("youtube-nocookie.com/embed/jNQXAC9IVRw");
    });

    it("Context 3: Category showreel renders real picture, overlay, play button, and opens modal with showreel video URL", async () => {
      const req = new Request("http://localhost:3000/fr/projets/documentaire?dir=right");
      const res = await publicPortfolioLoader({
        request: req,
        params: { rubrique: "documentaire" },
      } as unknown as LoaderFunctionArgs);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets/documentaire",
        search: "?dir=right",
        hash: "",
        state: null,
        key: "category-view",
      });

      const { container } = render(<PortfolioPage />);

      const showreelSection = container.querySelector("[class*='showreelSection']");
      expect(showreelSection).toBeTruthy();

      const card = showreelSection?.querySelector("[class*='showreelCard']");
      expect(card).toBeTruthy();

      const picture = card?.querySelector("picture");
      expect(picture).toBeTruthy();

      const overlay = card?.querySelector("[class*='showreelOverlay']");
      expect(overlay).toBeTruthy();

      const playBtn = overlay?.querySelector("button[class*='playBtn']");
      expect(playBtn).toBeTruthy();
      expect(playBtn?.getAttribute("aria-label")).toMatch(/lire le showreel/i);

      fireEvent.click(playBtn!);
      expect(container.querySelector("iframe")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /accepter et lire/i }));
      const iframe = container.querySelector("iframe");
      expect(iframe?.getAttribute("src")).toContain("youtube-nocookie.com/embed/L_LUpnjgPso");
    });

    it("Context 4: Video list card in category view renders real picture, overlay, play button, and opens modal", async () => {
      const req = new Request("http://localhost:3000/fr/projets/documentaire?dir=right");
      const res = await publicPortfolioLoader({
        request: req,
        params: { rubrique: "documentaire" },
      } as unknown as LoaderFunctionArgs);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets/documentaire",
        search: "?dir=right",
        hash: "",
        state: null,
        key: "category-view-cards",
      });

      const { container } = render(<PortfolioPage />);

      // Find the 16:9 video project card in the projects list
      const videoCard = container.querySelector("[class*='videoCard169']");
      expect(videoCard).toBeTruthy();

      const picture = videoCard?.querySelector("picture");
      expect(picture).toBeTruthy();

      const overlay = videoCard?.querySelector("[class*='videoOverlay']");
      expect(overlay).toBeTruthy();

      const playBtn = overlay?.querySelector("button[class*='videoPlayBtn']");
      expect(playBtn).toBeTruthy();
      expect(playBtn?.getAttribute("aria-label")).toMatch(/lire la vidéo/i);

      fireEvent.click(playBtn!);
      expect(container.querySelector("iframe")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /accepter et lire/i }));
      const iframe = container.querySelector("iframe");
      expect(iframe?.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    });
  });

  // =========================================================================
  // 6. Delivered PortfolioPage: Single Root ScrollToTop & Modal State
  // =========================================================================
  describe("6. Delivered PortfolioPage: Single Root ScrollToTop & Modal State", () => {
    it("renders exactly one root ScrollToTop button, targets panel when open, and hides when modal opens", async () => {
      const req = new Request("http://localhost:3000/fr/projets/documentaire?dir=right");
      const res = await publicPortfolioLoader({
        request: req,
        params: { rubrique: "documentaire" },
      } as unknown as LoaderFunctionArgs);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets/documentaire",
        search: "?dir=right",
        hash: "",
        state: null,
        key: "category-scroll-test",
      });

      const { container } = render(<PortfolioPage />);

      // Verify only ONE ScrollToTop component exists at root level
      const scrollBtns = container.querySelectorAll("button[class*='portfolioScrollToTop']");
      expect(scrollBtns).toHaveLength(1);

      const btn = scrollBtns[0];
      expect(btn).toBeTruthy();

      // Initially scrollTop is 0 -> hidden & tabIndex -1
      expect(btn.getAttribute("tabindex")).toBe("-1");
      expect(btn.getAttribute("aria-hidden")).toBe("true");

      // Open Video Modal by clicking showreel play button
      const playBtn = container.querySelector("button[class*='playBtn']");
      expect(playBtn).toBeTruthy();
      fireEvent.click(playBtn!);

      // ScrollToTop remains hidden while modal is open
      expect(btn.getAttribute("tabindex")).toBe("-1");
      expect(btn.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
