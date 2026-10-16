// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

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
  PORTFOLIO_MEDIA_SLOTS,
  type PortfolioContent,
} from "../app/lib/portfolio-content.shared";
import { getReferencedPortfolioMediaIds } from "../app/lib/portfolio-content.server";
import { ScrollToTop } from "../app/components/public/ScrollToTop";
import PortfolioPage from "../app/routes/public/portfolio";
import type { CommonContent } from "../app/lib/site-content.shared";

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

const mockPortfolioContent = {
  revision: "rev-test-1",
  overview: {
    seo: {
      title: { fr: "Réalisations — Parallax", en: "Portfolio — Parallax" },
      description: { fr: "Découvrez nos projets", en: "Discover our projects" },
    },
    title: { fr: "RÉALISATIONS", en: "PORTFOLIO" },
    seeMoreButton: { fr: "Voir plus de projets", en: "See more projects" },
  },
  sections: {
    documentary: {
      category: "documentary",
      title: { fr: "Documentaire", en: "Documentary" },
      intro: { fr: "Notre approche documentaire", en: "Our documentary approach" },
      coverImageId: "img-doc-cover",
      coverAlt: { fr: "Couverture Doc", en: "Doc Cover" },
      entryImageId: "img-doc-entry",
      entryAlt: { fr: "Visuel d'entrée Documentaire", en: "Doc Entry Visual" },
      entrySummary: { fr: "Films du réel et récits d'impact", en: "Real stories and impact films" },
      entrySide: "left",
      bannerImageId: "img-doc-banner",
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
      coverImageId: "img-pub-cover",
      coverAlt: { fr: "Couverture Pub", en: "Pub Cover" },
      entryImageId: "img-pub-entry",
      entryAlt: { fr: "Visuel d'entrée Publicité", en: "Pub Entry Visual" },
      entrySummary: { fr: "Campagnes et narrations commerciales", en: "Campaigns and commercial storytelling" },
      entrySide: "right",
      bannerImageId: "img-pub-banner",
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
      id: "proj-photo-1",
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
      coverImageId: "img-proj-photo",
      coverAlt: { fr: "Couverture photo", en: "Photo cover" },
      galleryImageIds: [],
      video: null,
      draftVideoCoverImageId: null,
      presentationMode: "photo",
      aspectRatio: "3:2",
      showcase: false,
      side: "left",
      status: "published",
      archived: false,
      updatedAt: 1000,
    },
    {
      id: "proj-video-1",
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
      coverImageId: "img-proj-video-cover",
      coverAlt: { fr: "Affiche vidéo", en: "Video poster" },
      galleryImageIds: [],
      video: {
        provider: "youtube",
        videoId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        coverImageId: "img-proj-video-poster",
      },
      draftVideoCoverImageId: null,
      presentationMode: "video",
      aspectRatio: "16:9",
      showcase: false,
      side: "auto",
      status: "published",
      archived: false,
      updatedAt: 2000,
    },
  ],
  media: {
    "img-doc-entry": {
      id: "img-doc-entry",
      ownerType: "section",
      ownerId: "documentary",
      mediaSlot: "category_entry",
      mimeType: "image/jpeg",
      width: 1920,
      height: 1080,
      byteSize: 100000,
      variants: {
        thumbnail: { filename: "doc-entry-thumb.webp", width: 400, height: 225, byteSize: 20000 },
        mobile: { filename: "doc-entry-mobile.webp", width: 800, height: 450, byteSize: 40000 },
        desktop: { filename: "doc-entry-desktop.webp", width: 1920, height: 1080, byteSize: 90000 },
      },
      createdAt: 100,
      updatedAt: 100,
    },
    "img-doc-banner": {
      id: "img-doc-banner",
      ownerType: "section",
      ownerId: "documentary",
      mediaSlot: "category_banner",
      mimeType: "image/jpeg",
      width: 1920,
      height: 480,
      byteSize: 100000,
      variants: {
        thumbnail: { filename: "doc-banner-thumb.webp", width: 400, height: 100, byteSize: 20000 },
        mobile: { filename: "doc-banner-mobile.webp", width: 800, height: 200, byteSize: 40000 },
        desktop: { filename: "doc-banner-desktop.webp", width: 1920, height: 480, byteSize: 90000 },
      },
      createdAt: 100,
      updatedAt: 100,
    },
    "img-proj-photo": {
      id: "img-proj-photo",
      ownerType: "project",
      ownerId: "proj-photo-1",
      mediaSlot: "cover",
      mimeType: "image/jpeg",
      width: 1200,
      height: 800,
      byteSize: 80000,
      variants: {
        thumbnail: { filename: "photo-thumb.webp", width: 400, height: 267, byteSize: 20000 },
        mobile: { filename: "photo-mobile.webp", width: 800, height: 533, byteSize: 40000 },
        desktop: { filename: "photo-desktop.webp", width: 1200, height: 800, byteSize: 75000 },
      },
      createdAt: 100,
      updatedAt: 100,
    },
    "img-proj-video-poster": {
      id: "img-proj-video-poster",
      ownerType: "project",
      ownerId: "proj-video-1",
      mediaSlot: "video_cover",
      mimeType: "image/jpeg",
      width: 1920,
      height: 1080,
      byteSize: 95000,
      variants: {
        thumbnail: { filename: "video-thumb.webp", width: 400, height: 225, byteSize: 20000 },
        mobile: { filename: "video-mobile.webp", width: 800, height: 450, byteSize: 40000 },
        desktop: { filename: "video-desktop.webp", width: 1920, height: 1080, byteSize: 85000 },
      },
      createdAt: 100,
      updatedAt: 100,
    },
  },
} as unknown as PortfolioContent;

describe("UX, Admin, and Portfolio Presentation Refinements", () => {
  beforeEach(() => {
    const tmpPortfolioFile = path.join(os.tmpdir(), `test-portfolio-${Date.now()}.json`);
    fs.writeFileSync(tmpPortfolioFile, JSON.stringify(mockPortfolioContent));
    process.env.PORTFOLIO_CONTENT_PATH = tmpPortfolioFile;
  });

  describe("Workstream 1: Contact Strict Calendar Validation & Date Picker", () => {
    it("validates real calendar dates correctly and rejects impossible calendar dates", () => {
      // Valid dates
      expect(isValidCalendarDate(2026, 11, 20)).toBe(true);
      expect(isValidCalendarDate(2024, 2, 29)).toBe(true); // Leap year 2024

      // Non-existent calendar dates
      expect(isValidCalendarDate(2026, 2, 31)).toBe(false); // Feb 31 does not exist
      expect(isValidCalendarDate(2026, 4, 31)).toBe(false); // April has 30 days
      expect(isValidCalendarDate(2025, 2, 29)).toBe(false); // 2025 is not a leap year
    });

    it("validateContactTimeline validates string formats strictly", () => {
      expect(validateContactTimeline("2026-11-20")).toBe(true);
      expect(validateContactTimeline("2024-02-29")).toBe(true);

      // Invalid dates or malformed formats
      expect(validateContactTimeline("2026-02-31")).toBe(false);
      expect(validateContactTimeline("invalid")).toBe(false);
      expect(validateContactTimeline("20-11-2026")).toBe(false);
      expect(validateContactTimeline("")).toBe(true); // empty is optional
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
        seo: {
          title: { fr: "Accueil", en: "Home" },
          description: { fr: "Desc", en: "Desc" },
        },
        hero: {
          badge: { fr: "B", en: "B" },
          title: { fr: "Titre", en: "Title" },
          subtitle: { fr: "Sub", en: "Sub" },
        },
        showreel: {
          title: { fr: "S", en: "S" },
          videoUrl: "https://youtube.com/watch?v=123",
          coverImageId: null,
          coverImageAlt: { fr: "A", en: "A" },
        },
        duo: {
          title: { fr: "D", en: "D" },
          text: { fr: "T", en: "T" },
          imageId: null,
          imageAlt: { fr: "A", en: "A" },
        },
        savoirFaire: {
          title: { fr: "SF", en: "SF" },
          photoTitle: { fr: "Photo", en: "Photo" },
          photoItems: Array.from({ length: 51 }, (_, i) => ({ fr: `Item ${i}`, en: `Item ${i}` })),
          videoTitle: { fr: "Vid", en: "Vid" },
          videoItems: [{ fr: "Vid 1", en: "Vid 1" }],
        },
        contact: {
          title: { fr: "C", en: "C" },
          emailLabel: { fr: "E", en: "E" },
          email: "test@example.com",
          socialLabel: { fr: "S", en: "S" },
          socialLinks: [],
        },
        sempra: {
          badge: { fr: "B", en: "B" },
          title: { fr: "T", en: "T" },
          description: { fr: "D", en: "D" },
          buttonText: { fr: "BT", en: "BT" },
          buttonUrl: "https://sempra.be/",
        },
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

  describe("Workstream 4: Separate Category Entries vs Project Visuals", () => {
    it("PORTFOLIO_MEDIA_SLOTS includes category_entry and category_banner", () => {
      expect(PORTFOLIO_MEDIA_SLOTS).toContain("category_entry");
      expect(PORTFOLIO_MEDIA_SLOTS).toContain("category_banner");
    });

    it("getReferencedPortfolioMediaIds collects category entry and banner IDs", () => {
      const { referencedIds } = getReferencedPortfolioMediaIds(mockPortfolioContent);
      expect(referencedIds.has("img-doc-entry")).toBe(true);
      expect(referencedIds.has("img-doc-banner")).toBe(true);
      expect(referencedIds.has("img-proj-photo")).toBe(true);
      expect(referencedIds.has("img-proj-video-poster")).toBe(true);
    });
  });

  describe("Workstream 5 & 6: Public Portfolio Presentation & Category Navigation", () => {
    it("renders category entries on portfolio overview without in-category filter tabs", () => {
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

      // Section titles are present on overview
      expect(screen.getByText("Documentaire")).toBeInTheDocument();
      expect(screen.getByText("Publicité")).toBeInTheDocument();
      expect(screen.getByText("Films du réel et récits d'impact")).toBeInTheDocument();

      // No in-category filter tabs on overview
      expect(container.querySelector('[class*="filterTab"]')).toBeNull();
    });

    it("renders category panel with banner header and distinct photo / video project modes without duplicate hero poster", () => {
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

      render(<PortfolioPage />);

      // Category banner title
      expect(screen.getByRole("heading", { name: "Documentaire", level: 2 })).toBeInTheDocument();

      // Photo project title & summary rendered
      expect(screen.getByText("Projet Photo Sauvage")).toBeInTheDocument();
      expect(screen.getByText("Immersion photographique")).toBeInTheDocument();

      // Video project title & play button rendered
      expect(screen.getByText("Projet Vidéo Cinéma")).toBeInTheDocument();
      expect(screen.getByText("Production documentaire 16:9")).toBeInTheDocument();
      expect(screen.getByLabelText("Lire la vidéo : Projet Vidéo Cinéma")).toBeInTheDocument();

      // No in-category tabs present
      expect(screen.queryByText("Documentaire", { selector: ".filterTab" })).not.toBeInTheDocument();
    });
  });

  describe("Workstream 7: Harmonized ScrollToTop Component", () => {
    beforeEach(() => {
      vi.stubGlobal("scrollY", 0);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("remains hidden and non-focusable when page is at top (scrollY = 0)", () => {
      render(<ScrollToTop />);
      const button = screen.getByRole("button", { hidden: true });
      expect(button).toHaveAttribute("tabindex", "-1");
      expect(button).toHaveAttribute("aria-hidden", "true");
    });

    it("becomes visible and focusable when scrolled > 60px", () => {
      render(<ScrollToTop />);
      const button = screen.getByRole("button", { hidden: true });

      act(() => {
        vi.stubGlobal("scrollY", 120);
        window.dispatchEvent(new Event("scroll"));
      });

      expect(button).toHaveAttribute("tabindex", "0");
      expect(button).toHaveAttribute("aria-hidden", "false");
    });

    it("scrolls window to top when clicked", () => {
      const scrollToMock = vi.fn();
      window.scrollTo = scrollToMock;

      render(<ScrollToTop />);
      act(() => {
        vi.stubGlobal("scrollY", 120);
        window.dispatchEvent(new Event("scroll"));
      });

      const button = screen.getByRole("button");
      fireEvent.click(button);

      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    });
  });
});
