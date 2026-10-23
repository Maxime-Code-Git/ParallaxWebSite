// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

// Mock react-router for component rendering tests
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useLocation: vi.fn(() => ({ pathname: "/fr/projets", search: "", hash: "", state: null, key: "default" })),
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

import { useLoaderData, useLocation, type Location } from "react-router";
import PortfolioPage from "../app/routes/public/portfolio";
import { resetClientPrivacyState } from "../app/lib/privacy-client";
import type {
  PortfolioContent,
  PortfolioMediaItem,
  PortfolioProject,
  PortfolioCategoryItem,
} from "../app/lib/portfolio-content.shared";

function mockLocation(pathname: string, search = ""): Location {
  return {
    pathname,
    search,
    hash: "",
    state: null,
    key: "test-location-key",
  };
}

const UUID_DOC_CAT = "11111111-1111-4111-8111-111111111111";
const UUID_EMPTY_CAT = "22222222-2222-4222-8222-222222222222";
const UUID_PROJ_PHOTO = "33333333-3333-4333-8333-333333333333";
const UUID_PROJ_VIDEO = "44444444-4444-4444-8444-444444444444";
const UUID_PROJ_PHOTO_2 = "55555555-5555-4555-8555-555555555555";

const UUID_IMG_COVER_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_IMG_GALLERY_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_IMG_GALLERY_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UUID_IMG_VIDEO_POSTER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UUID_IMG_SEC_POSTER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function createMockMedia(
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
      { name: "640p", width: 640, height: 360, avifSize: 1000, webpSize: 2000 },
      { name: "960p", width: 960, height: 540, avifSize: 3000, webpSize: 4000 },
      { name: "1440p", width: 1440, height: 810, avifSize: 5000, webpSize: 6000 },
      { name: "1920p", width: 1920, height: 1080, avifSize: 7000, webpSize: 8000 },
    ],
    createdAt: 1767225600000,
  };
}

function buildMockPortfolioContent(): PortfolioContent {
  const categories: PortfolioCategoryItem[] = [
    {
      id: UUID_DOC_CAT,
      slugFr: "documentaire",
      slugEn: "documentary",
      title: { fr: "Documentaire", en: "Documentary" },
      intro: { fr: "Films et récits du réel.", en: "Real stories and documentary films." },
      entrySummary: { fr: "Visions documentaires.", en: "Documentary visions." },
      order: 0,
      status: "published",
      seo: {
        title: { fr: "Documentaire | Parallax", en: "Documentary | Parallax" },
        description: { fr: "Rubrique Documentaire", en: "Documentary section" },
      },
      showreelVideo: null,
      showreelCoverImageId: null,
      backButton: { fr: "Retour aux rubriques", en: "Back to categories" },
      morePhotosButton: { fr: "Voir plus de photos", en: "See more photos" },
      lessPhotosButton: { fr: "Voir moins de photos", en: "See fewer photos" },
      moreVideosButton: { fr: "Voir plus de vidéos", en: "See more videos" },
      lessVideosButton: { fr: "Voir moins de vidéos", en: "See fewer videos" },
      showreelTitle: { fr: "Showreel Documentaire", en: "Documentary Showreel" },
    },
    {
      id: UUID_EMPTY_CAT,
      slugFr: "archive",
      slugEn: "archive",
      title: { fr: "Archives", en: "Archives" },
      intro: { fr: "Rubrique sans médias.", en: "Category with no media." },
      entrySummary: { fr: "Résumé archive.", en: "Archive summary." },
      order: 1,
      status: "published",
      seo: {
        title: { fr: "Archives | Parallax", en: "Archives | Parallax" },
        description: { fr: "Rubrique Archives", en: "Archives section" },
      },
      showreelVideo: null,
      showreelCoverImageId: null,
      backButton: { fr: "Retour aux projets", en: "Back to projects" },
      morePhotosButton: { fr: "Voir plus de photos", en: "See more photos" },
      lessPhotosButton: { fr: "Voir moins de photos", en: "See fewer photos" },
      moreVideosButton: { fr: "Voir plus de vidéos", en: "See more videos" },
      lessVideosButton: { fr: "Voir moins de vidéos", en: "See fewer videos" },
      showreelTitle: { fr: "Showreel Archive", en: "Archive Showreel" },
    },
  ];

  const projects: PortfolioProject[] = [
    // Project 1: Photo mode with cover, 2 gallery photos, and a secondary video
    {
      id: UUID_PROJ_PHOTO,
      category: UUID_DOC_CAT,
      slugFr: "alpes-sauvages",
      slugEn: "wild-alps",
      title: { fr: "Alpes Sauvages", en: "Wild Alps" },
      summary: { fr: "Immersion photographique en haute altitude.", en: "High-altitude photographic immersion." },
      description: [
        { type: "paragraph", text: { fr: "Exploration des crêtes alpines.", en: "Exploring Alpine ridges." } },
      ],
      seo: {
        title: { fr: "Alpes Sauvages | Parallax", en: "Wild Alps | Parallax" },
        description: { fr: "Photos des Alpes", en: "Alps photography" },
      },
      showcase: true,
      coverImageId: UUID_IMG_COVER_1,
      coverAlt: { fr: "Sommet enneigé", en: "Snowy peak" },
      galleryImageIds: [UUID_IMG_COVER_1, UUID_IMG_GALLERY_1, UUID_IMG_GALLERY_2], // UUID_IMG_COVER_1 also in gallery to verify deduplication
      galleryAlt: {
        [UUID_IMG_GALLERY_1]: { fr: "Bouquetin au lever du soleil", en: "Ibex at sunrise" },
        [UUID_IMG_GALLERY_2]: { fr: "Glacier miroitant", en: "Shimmering glacier" },
      },
      aspectRatio: "3:2",
      side: "left",
      status: "published",
      archived: false,
      presentationMode: "photo",
      video: {
        provider: "youtube",
        videoId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        coverImageId: UUID_IMG_SEC_POSTER,
      },
      order: 0,
      createdAt: 1767225600000,
      updatedAt: 1767225600000,
    },
    // Project 2: Video mode
    {
      id: UUID_PROJ_VIDEO,
      category: UUID_DOC_CAT,
      slugFr: "ocean-secret",
      slugEn: "secret-ocean",
      title: { fr: "Océan Secret", en: "Secret Ocean" },
      summary: { fr: "Court-métrage sous-marin primé.", en: "Award-winning underwater short film." },
      description: [
        { type: "paragraph", text: { fr: "Plongée dans les abysses.", en: "Diving into the abyss." } },
      ],
      seo: {
        title: { fr: "Océan Secret | Parallax", en: "Secret Ocean | Parallax" },
        description: { fr: "Vidéo des abysses", en: "Abyss video" },
      },
      showcase: false,
      coverImageId: null,
      coverAlt: { fr: "Affiche océan", en: "Ocean poster" },
      galleryImageIds: [],
      aspectRatio: "16:9",
      side: "auto",
      status: "published",
      archived: false,
      presentationMode: "video",
      video: {
        provider: "vimeo",
        videoId: "123456789",
        url: "https://vimeo.com/123456789",
        coverImageId: UUID_IMG_VIDEO_POSTER,
      },
      order: 1,
      createdAt: 1767225601000,
      updatedAt: 1767225601000,
    },
    // Project 3: Another project with DUPLICATE video to test deduplication in category collection
    {
      id: UUID_PROJ_PHOTO_2,
      category: UUID_DOC_CAT,
      slugFr: "alpes-bonus",
      slugEn: "alps-bonus",
      title: { fr: "Alpes Bonus", en: "Alps Bonus" },
      summary: { fr: "Projet réutilisant la même vidéo que le projet 1.", en: "Bonus project sharing video." },
      description: [],
      seo: {
        title: { fr: "Alpes Bonus | Parallax", en: "Alps Bonus | Parallax" },
        description: { fr: "Bonus", en: "Bonus" },
      },
      showcase: false,
      side: "auto",
      coverImageId: null,
      coverAlt: { fr: "", en: "" },
      galleryImageIds: [],
      status: "published",
      archived: false,
      presentationMode: "photo",
      video: {
        provider: "youtube",
        videoId: "dQw4w9WgXcQ", // duplicate provider:videoId
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      order: 2,
      createdAt: 1767225602000,
      updatedAt: 1767225602000,
    },
  ];

  const media: Record<string, PortfolioMediaItem> = {
    [UUID_IMG_COVER_1]: createMockMedia(UUID_IMG_COVER_1, "project", UUID_PROJ_PHOTO, "cover"),
    [UUID_IMG_GALLERY_1]: createMockMedia(UUID_IMG_GALLERY_1, "project", UUID_PROJ_PHOTO, "gallery"),
    [UUID_IMG_GALLERY_2]: createMockMedia(UUID_IMG_GALLERY_2, "project", UUID_PROJ_PHOTO, "gallery"),
    [UUID_IMG_VIDEO_POSTER]: createMockMedia(UUID_IMG_VIDEO_POSTER, "project", UUID_PROJ_VIDEO, "video_cover"),
    [UUID_IMG_SEC_POSTER]: createMockMedia(UUID_IMG_SEC_POSTER, "project", UUID_PROJ_PHOTO, "video_cover"),
  };

  return {
    schemaVersion: 2,
    revision: "rev-test-1",
    updatedAt: new Date().toISOString(),
    overview: {
      title: { fr: "RÉALISATIONS", en: "PORTFOLIO" },
      intro: { fr: "Découvrez nos projets", en: "Discover our work" },
      seo: {
        title: { fr: "Portfolio | Parallax", en: "Portfolio | Parallax" },
        description: { fr: "Nos réalisations", en: "Our work" },
      },
      seeMoreButton: { fr: "Découvrir la rubrique", en: "Explore category" },
    },
    sections: {
      documentaire: categories[0],
    },
    categories,
    projects,
    media,
  };
}

const mockCommon = {
  brandName: "Parallax",
  navigation: {
    portfolio: { fr: "Portfolio", en: "Portfolio" },
    studio: { fr: "Studio", en: "Studio" },
    contact: { fr: "Contact", en: "Contact" },
    sempra: { fr: "Sempra", en: "Sempra" },
    clientArea: { fr: "Espace Client", en: "Client Area" },
  },
  footer: {
    copyright: { fr: "© 2026 Parallax", en: "© 2026 Parallax" },
    legalNotice: { fr: "Mentions légales", en: "Legal Notice" },
    privacy: { fr: "Confidentialité", en: "Privacy" },
    terms: { fr: "CGV", en: "Terms" },
    cookies: { fr: "Cookies", en: "Cookies" },
  },
};

describe("Portfolio Media Navigation & Enhancements Suite", () => {
  let tempDir: string;
  let mockContent: PortfolioContent;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-test-nav-"));
    mockContent = buildMockPortfolioContent();
    resetClientPrivacyState();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  describe("1. Category Complementary Folds: Photos & Videos", () => {
    it("renders both 'Voir plus de photos' and 'Voir plus de vidéos' buttons side by side", () => {
      vi.mocked(useLocation).mockReturnValue(mockLocation("/fr/projets/documentaire", "?dir=right"));

      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        alternateUrls: { fr: "/fr/projets/documentaire", en: "/en/projects/documentary" },
        content: mockContent,
        common: mockCommon,
        panelState: {
          isOpen: true,
          activeCategory: UUID_DOC_CAT,
          activeProject: null,
          direction: "right",
        },
      });

      render(<PortfolioPage />);

      // Find the toggle buttons
      const morePhotosBtn = screen.getByRole("button", { name: /Voir plus de photos/i });
      const moreVideosBtn = screen.getByRole("button", { name: /Voir plus de vidéos/i });

      expect(morePhotosBtn).toBeTruthy();
      expect(moreVideosBtn).toBeTruthy();
      expect(morePhotosBtn.getAttribute("aria-expanded")).toBe("false");
      expect(moreVideosBtn.getAttribute("aria-expanded")).toBe("false");
      expect(morePhotosBtn.getAttribute("aria-controls")).toBe("category-photos-panel");
      expect(moreVideosBtn.getAttribute("aria-controls")).toBe("category-videos-panel");
    });

    it("expands videos panel independently, deduplicates videos, and opens VideoModal upon play", async () => {
      vi.mocked(useLocation).mockReturnValue(mockLocation("/fr/projets/documentaire", "?dir=right"));

      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        alternateUrls: { fr: "/fr/projets/documentaire", en: "/en/projects/documentary" },
        content: mockContent,
        common: mockCommon,
        panelState: {
          isOpen: true,
          activeCategory: UUID_DOC_CAT,
          activeProject: null,
          direction: "right",
        },
      });

      const { container } = render(<PortfolioPage />);

      const moreVideosBtn = screen.getByRole("button", { name: /Voir plus de vidéos/i });

      // Click to expand videos
      fireEvent.click(moreVideosBtn);

      expect(moreVideosBtn.getAttribute("aria-expanded")).toBe("true");
      expect(moreVideosBtn.textContent).toContain("Voir moins de vidéos");

      // Verify videos panel exists
      const videosPanel = container.querySelector("#category-videos-panel");
      expect(videosPanel).toBeTruthy();

      // Photos panel should remain collapsed
      const photosPanel = container.querySelector("#category-photos-panel");
      expect(photosPanel).toBeNull();

      // Check deduplication: Alps video-1 appears only once even though referenced by Project 1 and Project 3
      // Total distinct videos in this category: Alps video-1 (from photo project) + Ocean video-2 (from video project) = 2
      const videoItems = videosPanel!.querySelectorAll("[class*='videoGridItem']");
      expect(videoItems.length).toBe(2);

      // Verify play button triggers VideoModal without iframe before consent
      const playBtn = within(videosPanel as HTMLElement).getByRole("button", { name: /Lire la vidéo : Océan Secret/i });
      fireEvent.click(playBtn);

      // VideoModal should now be open
      const closeVideoBtn = screen.getByRole("button", { name: /Fermer la vidéo/i });
      expect(closeVideoBtn).toBeTruthy();
      const modal = closeVideoBtn.closest("[role='dialog']")!;
      expect(modal).toBeTruthy();
      // No iframe before consent
      expect(modal.querySelector("iframe")).toBeNull();
      // Consent banner is present
      expect(await screen.findByText(/Accepter et lire/i)).toBeTruthy();
    });

    it("does NOT display 'Voir plus de vidéos' or 'Voir plus de photos' if category has no media", () => {
      vi.mocked(useLocation).mockReturnValue(mockLocation("/fr/projets/archive", "?dir=left"));

      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        alternateUrls: { fr: "/fr/projets/archive", en: "/en/projects/archive" },
        content: mockContent,
        common: mockCommon,
        panelState: {
          isOpen: true,
          activeCategory: UUID_EMPTY_CAT,
          activeProject: null,
          direction: "left",
        },
      });

      render(<PortfolioPage />);

      expect(screen.queryByRole("button", { name: /Voir plus de photos/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Voir plus de vidéos/i })).toBeNull();
    });
  });

  describe("2. Explicit Project CTA Button ('Découvrir le projet')", () => {
    it("renders a pill CTA link under summaries in both Video and Photo project cards with localized slugs", () => {
      vi.mocked(useLocation).mockReturnValue(mockLocation("/fr/projets/documentaire", "?dir=right"));

      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        alternateUrls: { fr: "/fr/projets/documentaire", en: "/en/projects/documentary" },
        content: mockContent,
        common: mockCommon,
        panelState: {
          isOpen: true,
          activeCategory: UUID_DOC_CAT,
          activeProject: null,
          direction: "right",
        },
      });

      render(<PortfolioPage />);

      // Find all "Découvrir le projet" links
      const ctaLinks = screen.getAllByRole("link", { name: /Découvrir le projet/i });
      expect(ctaLinks.length).toBeGreaterThanOrEqual(2);

      // Verify photo project link preserves dir parameter
      expect(ctaLinks[0].getAttribute("href")).toBe("/fr/projets/documentaire/alpes-sauvages?dir=right");

      // Verify video project link preserves dir parameter and is distinct from play button
      expect(ctaLinks[1].getAttribute("href")).toBe("/fr/projets/documentaire/ocean-secret?dir=right");
    });

    it("renders English CTA labels on /en/projects", () => {
      vi.mocked(useLocation).mockReturnValue(mockLocation("/en/projects/documentary", "?dir=left"));

      vi.mocked(useLoaderData).mockReturnValue({
        lang: "en",
        alternateUrls: { fr: "/fr/projets/documentaire", en: "/en/projects/documentary" },
        content: mockContent,
        common: mockCommon,
        panelState: {
          isOpen: true,
          activeCategory: UUID_DOC_CAT,
          activeProject: null,
          direction: "left",
        },
      });

      render(<PortfolioPage />);

      const ctaLinks = screen.getAllByRole("link", { name: /Discover the project/i });
      expect(ctaLinks.length).toBeGreaterThanOrEqual(2);
      expect(ctaLinks[0].getAttribute("href")).toBe("/en/projects/documentary/wild-alps?dir=left");
    });
  });

  describe("3. Photo Lightbox / Viewer in Project Detail View", () => {
    it("opens photo lightbox on cover or gallery image click, supports navigation and keyboard Esc", () => {
      const photoProject = mockContent.projects.find((p) => p.id === UUID_PROJ_PHOTO)!;

      vi.mocked(useLocation).mockReturnValue(mockLocation("/fr/projets/documentaire/alpes-sauvages", "?dir=right"));

      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        alternateUrls: {
          fr: "/fr/projets/documentaire/alpes-sauvages",
          en: "/en/projects/documentary/wild-alps",
        },
        content: mockContent,
        common: mockCommon,
        panelState: {
          isOpen: true,
          activeCategory: UUID_DOC_CAT,
          activeProject: photoProject,
          direction: "right",
        },
      });

      const { container } = render(<PortfolioPage />);

      // Cover image enlargement trigger
      const coverExpandBtn = screen.getByRole("button", {
        name: /Agrandir la photo : Sommet enneigé/i,
      });
      expect(coverExpandBtn).toBeTruthy();

      // Click to open lightbox
      fireEvent.click(coverExpandBtn);

      // Lightbox dialog should now be visible
      const lightbox = screen.getByRole("dialog", { name: /Photo 1 sur 3/i });
      expect(lightbox).toBeTruthy();

      // Counter should show "1 / 3" (cover + 2 gallery images, deduplicated)
      expect(screen.getByText("1 / 3")).toBeTruthy();

      // Background panelContent must be inert
      const panelContent = container.querySelector("[class*='panelContent']");
      expect(panelContent?.hasAttribute("inert")).toBe(true);

      // Test next button
      const nextBtn = screen.getByRole("button", { name: /Photo suivante/i });
      fireEvent.click(nextBtn);

      // Counter should now show "2 / 3"
      expect(screen.getByText("2 / 3")).toBeTruthy();

      // Test keyboard ArrowLeft navigation
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(screen.getByText("1 / 3")).toBeTruthy();

      // Test keyboard Escape closes lightbox without closing the panel
      fireEvent.keyDown(window, { key: "Escape" });

      // Lightbox is closed
      expect(screen.queryByRole("dialog", { name: /Photo/i })).toBeNull();
      // Background panel is no longer inert
      expect(panelContent?.hasAttribute("inert")).toBe(false);
    });
  });

  describe("4. Category View Top-Right Close Cross Removal", () => {
    it("does NOT render top-right close cross in category view; top-left back button is sole exit", () => {
      vi.mocked(useLocation).mockReturnValue(mockLocation("/fr/projets/documentaire", "?dir=right"));

      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        alternateUrls: { fr: "/fr/projets/documentaire", en: "/en/projects/documentary" },
        content: mockContent,
        common: mockCommon,
        panelState: {
          isOpen: true,
          activeCategory: UUID_DOC_CAT,
          activeProject: null,
          direction: "right",
        },
      });

      render(<PortfolioPage />);

      // In category view, close cross must NOT exist
      const closeBtn = screen.queryByLabelText(/Fermer le panneau/i);
      expect(closeBtn).toBeNull();

      // Top-left back button must exist
      const backBtn = screen.getByRole("button", { name: /Retour aux rubriques/i });
      expect(backBtn).toBeTruthy();
    });

    it("renders close cross in project detail view to allow closing to overview", () => {
      const photoProject = mockContent.projects.find((p) => p.id === UUID_PROJ_PHOTO)!;

      vi.mocked(useLocation).mockReturnValue(mockLocation("/fr/projets/documentaire/alpes-sauvages", "?dir=right"));

      vi.mocked(useLoaderData).mockReturnValue({
        lang: "fr",
        alternateUrls: {
          fr: "/fr/projets/documentaire/alpes-sauvages",
          en: "/en/projects/documentary/wild-alps",
        },
        content: mockContent,
        common: mockCommon,
        panelState: {
          isOpen: true,
          activeCategory: UUID_DOC_CAT,
          activeProject: photoProject,
          direction: "right",
        },
      });

      render(<PortfolioPage />);

      // In project detail view, close cross exists
      const closeBtn = screen.getByLabelText(/Fermer le panneau/i);
      expect(closeBtn).toBeTruthy();

      // And top-left returns to category
      const backLink = screen.getByRole("link", { name: /Retour à Documentaire/i });
      expect(backLink).toBeTruthy();
      expect(backLink.getAttribute("href")).toBe("/fr/projets/documentaire?dir=right");
    });
  });
});
