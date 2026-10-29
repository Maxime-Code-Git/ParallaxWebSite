// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { render, fireEvent, act } from "@testing-library/react";
import type { LoaderFunctionArgs } from "react-router";

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
import PortfolioPage, { loader as publicPortfolioLoader } from "../app/routes/public/portfolio";
import { ScrollToTop } from "../app/components/public/ScrollToTop";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";
import type { PortfolioMediaItem } from "../app/lib/portfolio-content.shared";
import defaultSiteContent from "../app/content/default-site-content.json";

function createScrollPortfolioFixture() {
  const content = createDefaultPortfolioContent();
  const category = content.categories.find((c) => c.id === "documentary")!;
  const project = content.projects.find((p) => p.category === category.id)!;
  const coverId = "44444444-4444-4444-8444-444444444444";
  const showreelCoverId = "55555555-5555-4555-8555-555555555555";
  const media = (
    imageId: string,
    ownerType: "project" | "section",
    ownerId: string,
    mediaSlot: "cover" | "showreel_cover"
  ): PortfolioMediaItem => ({
    imageId,
    ownerType,
    ownerId,
    mediaSlot,
    originalFormat: "webp",
    originalWidth: 1920,
    originalHeight: 1080,
    variants: [{ name: "640p", width: 640, height: 360, webpSize: 1000, avifSize: 800 }],
    createdAt: 1700000000000,
  });

  project.status = "published";
  project.slugFr = "projet-test";
  project.slugEn = "test-project";
  project.title = { fr: "Projet de test", en: "Test project" };
  project.coverImageId = coverId;
  project.coverAlt = { fr: "Portrait de test", en: "Test portrait" };
  project.presentationMode = "photo";
  content.media[coverId] = media(coverId, "project", project.id, "cover");
  category.status = "published";
  category.showreelCoverImageId = showreelCoverId;
  category.showreelVideo = {
    provider: "youtube",
    videoId: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    coverImageId: showreelCoverId,
  };
  content.media[showreelCoverId] = media(showreelCoverId, "section", category.id, "showreel_cover");
  return content;
}

describe("Public ScrollToTop Component & Integration Tests", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "parallax-scroll-tests-")));
    const testSiteContent = path.join(tempDir, "site-content.json");
    const testPortfolioContent = path.join(tempDir, "portfolio-content.json");
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    window.scrollY = 0;

    const testMediaDir = path.join(tempDir, "media");
    fs.mkdirSync(testMediaDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(testPortfolioContent, JSON.stringify(createScrollPortfolioFixture(), null, 2), { mode: 0o600 });
    fs.writeFileSync(testSiteContent, JSON.stringify(defaultSiteContent, null, 2), { mode: 0o600 });

    process.env.PORTFOLIO_CONTENT_PATH = testPortfolioContent;
    process.env.PORTFOLIO_MEDIA_PATH = testMediaDir;
    process.env.SITE_CONTENT_PATH = testSiteContent;
    process.env.SITE_MEDIA_PATH = testMediaDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 1. Défilement et remontée de window
  // =========================================================================
  describe("1. Window scrolling and scroll to top", () => {
    it("renders hidden and non-interactive initially when window.scrollY <= 60", () => {
      window.scrollY = 0;
      const { container } = render(<ScrollToTop />);
      const btn = container.querySelector("button");

      expect(btn).toBeTruthy();
      expect(btn).toHaveAttribute("tabindex", "-1");
      expect(btn).toHaveAttribute("aria-hidden", "true");
      expect(btn).toBeDisabled();
      expect(btn?.getAttribute("aria-label")).toBe("Remonter en haut de la page");
    });

    it("becomes visible, interactive, and focusable when window.scrollY > 60", () => {
      window.scrollY = 0;
      const { container } = render(<ScrollToTop />);
      const btn = container.querySelector("button");

      act(() => {
        window.scrollY = 150;
        window.dispatchEvent(new Event("scroll"));
      });

      expect(btn).toHaveAttribute("tabindex", "0");
      expect(btn).toHaveAttribute("aria-hidden", "false");
      expect(btn).not.toBeDisabled();
    });

    it("clicking button calls window.scrollTo with top: 0 and smooth behavior", () => {
      window.scrollY = 200;
      const scrollToMock = vi.fn();
      window.scrollTo = scrollToMock;

      const { container } = render(<ScrollToTop />);
      const btn = container.querySelector("button");

      act(() => {
        window.scrollY = 200;
        window.dispatchEvent(new Event("scroll"));
      });

      fireEvent.click(btn!);
      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    });

    it("hides again when window scrolls back to <= 60", () => {
      window.scrollY = 120;
      const { container } = render(<ScrollToTop />);
      const btn = container.querySelector("button");

      act(() => {
        window.scrollY = 120;
        window.dispatchEvent(new Event("scroll"));
      });
      expect(btn).toHaveAttribute("tabindex", "0");

      act(() => {
        window.scrollY = 30;
        window.dispatchEvent(new Event("scroll"));
      });
      expect(btn).toHaveAttribute("tabindex", "-1");
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("aria-hidden", "true");
    });
  });

  // =========================================================================
  // 2. Localized label and reduced motion
  // =========================================================================
  describe("2. Localization, accessible label and reduced motion", () => {
    it("uses English label when lang='en'", () => {
      const { container } = render(<ScrollToTop lang="en" />);
      const btn = container.querySelector("button");
      expect(btn?.getAttribute("aria-label")).toBe("Back to top");
    });

    it("custom ariaLabel takes precedence over default localization", () => {
      const { container } = render(<ScrollToTop lang="en" ariaLabel="Custom scroll label" />);
      const btn = container.querySelector("button");
      expect(btn?.getAttribute("aria-label")).toBe("Custom scroll label");
    });

    it("uses behavior 'auto' when prefers-reduced-motion is reduce", () => {
      const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      window.matchMedia = matchMediaMock;

      const scrollToMock = vi.fn();
      window.scrollTo = scrollToMock;

      const { container } = render(<ScrollToTop />);
      const btn = container.querySelector("button");

      act(() => {
        window.scrollY = 100;
        window.dispatchEvent(new Event("scroll"));
      });

      fireEvent.click(btn!);
      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    });
  });

  // =========================================================================
  // 3. Défilement et remontée du panneau avec targetRef
  // =========================================================================
  describe("3. Panel scrolling and targetRef handling", () => {
    it("scrolling panel targetRef triggers visibility and clicking scrolls panel, not window", () => {
      const panelEl = document.createElement("div");
      panelEl.scrollTop = 0;
      panelEl.scrollTo = vi.fn();
      const targetRef = { current: panelEl };

      const windowScrollToMock = vi.fn();
      window.scrollTo = windowScrollToMock;

      const { container } = render(<ScrollToTop targetRef={targetRef} />);
      const btn = container.querySelector("button");

      expect(btn).toHaveAttribute("tabindex", "-1");
      expect(btn).toBeDisabled();

      act(() => {
        panelEl.scrollTop = 250;
        panelEl.dispatchEvent(new Event("scroll"));
      });

      expect(btn).toHaveAttribute("tabindex", "0");
      expect(btn).not.toBeDisabled();

      fireEvent.click(btn!);
      expect(panelEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      expect(windowScrollToMock).not.toHaveBeenCalled();
    });

    it("attaches listener when targetRef is mounted and rerendered", () => {
      const panelEl = document.createElement("div");
      panelEl.scrollTop = 120;
      panelEl.scrollTo = vi.fn();
      const targetRef: { current: HTMLElement | null } = { current: null };

      const { container, rerender } = render(<ScrollToTop targetRef={targetRef} />);
      const btn = container.querySelector("button");

      expect(btn).toBeDisabled();

      // Simulate ref attachment and rerender
      targetRef.current = panelEl;
      rerender(<ScrollToTop targetRef={targetRef} />);

      act(() => {
        panelEl.dispatchEvent(new Event("scroll"));
      });

      expect(btn).not.toBeDisabled();
      expect(btn).toHaveAttribute("tabindex", "0");

      fireEvent.click(btn!);
      expect(panelEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    });

    it("recalculates visibility immediately when hidden prop flips from true to false", () => {
      const panelEl = document.createElement("div");
      panelEl.scrollTop = 200;
      const targetRef = { current: panelEl };

      const { container, rerender } = render(<ScrollToTop targetRef={targetRef} hidden={true} />);
      const btn = container.querySelector("button");

      // Hidden while modal is open, even though panel is scrolled
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("tabindex", "-1");

      // Modal closes (hidden flips to false) -> recalculates immediately without scroll event
      rerender(<ScrollToTop targetRef={targetRef} hidden={false} />);
      expect(btn).not.toBeDisabled();
      expect(btn).toHaveAttribute("tabindex", "0");
      expect(btn).toHaveAttribute("aria-hidden", "false");
    });

    it("recalculates visibility immediately on viewKey change without requiring scroll event", () => {
      const panelEl = document.createElement("div");
      panelEl.scrollTop = 0;
      const targetRef = { current: panelEl };

      const { container, rerender } = render(
        <ScrollToTop targetRef={targetRef} viewKey="/fr/projets/mariage" />
      );
      const btn = container.querySelector("button");
      expect(btn).toBeDisabled();

      // Scroll panel
      act(() => {
        panelEl.scrollTop = 150;
        panelEl.dispatchEvent(new Event("scroll"));
      });
      expect(btn).not.toBeDisabled();

      // Navigate to another project (scrollTop reset to 0)
      panelEl.scrollTop = 0;
      rerender(
        <ScrollToTop targetRef={targetRef} viewKey="/fr/projets/mariage/julie-et-romain" />
      );

      // Re-evaluated on viewKey change without new scroll event
      expect(btn).toBeDisabled();
    });

    it("cleans up event listeners cleanly on unmount", () => {
      const panelEl = document.createElement("div");
      const removeSpy = vi.spyOn(panelEl, "removeEventListener");
      const targetRef = { current: panelEl };

      const { unmount } = render(<ScrollToTop targetRef={targetRef} />);
      unmount();
      expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    });
  });

  // =========================================================================
  // 4. PortfolioPage: Overview, Category, Project Sheet, Modal Hiding & Focus Trap
  // =========================================================================
  describe("4. PortfolioPage Integration: Overview, Category, Project & Modal Hiding", () => {
    it("renders exactly one ScrollToTop button targeting window on Overview page (/fr/projets)", async () => {
      const req = new Request("http://localhost:3000/fr/projets");
      const res = await publicPortfolioLoader({
        request: req,
        params: {},
      } as unknown as LoaderFunctionArgs);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname: "/fr/projets",
        search: "",
        hash: "",
        state: null,
        key: "overview-test",
      });

      const { container } = render(<PortfolioPage />);
      const scrollBtns = container.querySelectorAll("button[class*='portfolioScrollToTop']");

      expect(scrollBtns).toHaveLength(1);
      const btn = scrollBtns[0];
      expect(btn).toBeDisabled();

      const scrollToMock = vi.fn();
      window.scrollTo = scrollToMock;

      act(() => {
        window.scrollY = 250;
        window.dispatchEvent(new Event("scroll"));
      });

      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    });

    it("renders exactly one ScrollToTop button inside panel dialog on category view (/fr/projets/documentaire)", async () => {
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
        key: "cat-doc-test",
      });

      const { container } = render(<PortfolioPage />);
      const scrollBtns = container.querySelectorAll("button[class*='portfolioScrollToTop']");

      expect(scrollBtns).toHaveLength(1);
      const btn = scrollBtns[0];

      // Verify the button is INSIDE the modal dialog (role="dialog")
      const dialog = container.querySelector("div[role='dialog'][class*='panelOverlay']");
      expect(dialog).toBeTruthy();
      expect(dialog?.contains(btn)).toBe(true);

      const panelScrollToMock = vi.fn();
      (dialog as HTMLElement).scrollTo = panelScrollToMock;

      // Scroll the panel dialog
      act(() => {
        (dialog as HTMLElement).scrollTop = 300;
        dialog?.dispatchEvent(new Event("scroll"));
      });

      expect(btn).not.toBeDisabled();
      expect(btn).toHaveAttribute("tabindex", "0");

      fireEvent.click(btn);
      expect(panelScrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    });

    it.each([
      {
        pathname: "/fr/projets/documentaire/projet-test",
        params: { rubrique: "documentaire", slugFr: "projet-test" },
        label: "Remonter en haut de la page",
      },
      {
        pathname: "/en/projects/documentary/test-project",
        params: { category: "documentary", slugEn: "test-project" },
        label: "Back to top",
      },
    ])("renders one working arrow in the project dialog and restores it after the lightbox ($pathname)", async ({ pathname, params, label }) => {
      const req = new Request(`http://localhost:3000${pathname}?dir=right`);
      const res = await publicPortfolioLoader({
        request: req,
        params,
      } as unknown as LoaderFunctionArgs);
      expect(res.status).toBe(200);
      const loaderData = await res.json();

      vi.mocked(useLoaderData).mockReturnValue(loaderData);
      vi.mocked(useLocation).mockReturnValue({
        pathname,
        search: "?dir=right",
        hash: "",
        state: null,
        key: "proj-sheet-test",
      });

      const { container } = render(<PortfolioPage />);
      const scrollBtns = container.querySelectorAll("button[class*='portfolioScrollToTop']");

      expect(scrollBtns).toHaveLength(1);
      const btn = scrollBtns[0];
      expect(btn).toHaveAttribute("aria-label", label);

      const dialog = container.querySelector("div[role='dialog'][class*='panelOverlay']");
      expect(dialog).toBeTruthy();
      expect(dialog?.contains(btn)).toBe(true);

      const panelScrollToMock = vi.fn();
      (dialog as HTMLElement).scrollTo = panelScrollToMock;

      // Scroll project sheet
      act(() => {
        (dialog as HTMLElement).scrollTop = 450;
        dialog?.dispatchEvent(new Event("scroll"));
      });

      expect(btn).not.toBeDisabled();
      expect(btn).toHaveAttribute("tabindex", "0");

      fireEvent.click(btn);
      expect(panelScrollToMock).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

      const enlargePhoto = container.querySelector(
        'button[aria-label^="Agrandir la photo"], button[aria-label^="Enlarge photo"]'
      );
      expect(enlargePhoto).toBeTruthy();
      fireEvent.click(enlargePhoto!);
      expect(btn).toBeDisabled();
      const closeLightbox = container.querySelector(
        'button[aria-label="Fermer la visionneuse"], button[aria-label="Close photo viewer"]'
      );
      expect(closeLightbox).toBeTruthy();
      fireEvent.click(closeLightbox!);
      expect(btn).not.toBeDisabled();
    });

    it("keyboard focus trap includes ScrollToTop when visible and excludes it when hidden", async () => {
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
        key: "focus-trap-test",
      });

      const { container } = render(<PortfolioPage />);
      const dialog = container.querySelector("div[role='dialog'][class*='panelOverlay']") as HTMLElement;
      const btn = container.querySelector("button[class*='portfolioScrollToTop']") as HTMLButtonElement;

      // When scrollTop is 0: btn is disabled and tabindex=-1
      expect(btn).toBeDisabled();

      // Tab navigation within dialog
      const backBtn = dialog.querySelector("button[class*='backBtn']") as HTMLElement;
      expect(backBtn).toBeTruthy();

      backBtn.focus();
      expect(document.activeElement).toBe(backBtn);

      // Now scroll the panel past 60px: btn becomes active
      act(() => {
        dialog.scrollTop = 200;
        dialog.dispatchEvent(new Event("scroll"));
      });

      expect(btn).not.toBeDisabled();
      expect(btn).toHaveAttribute("tabindex", "0");

      // Verify user can focus the ScrollToTop button inside dialog
      btn.focus();
      expect(document.activeElement).toBe(btn);
      fireEvent.keyDown(window, { key: "Tab" });
      expect(document.activeElement).toBe(backBtn);
      fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(btn);
    });

    it("hides during VideoModal and recalculates immediately upon closing", async () => {
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
        key: "video-modal-test",
      });

      const { container } = render(<PortfolioPage />);
      const dialog = container.querySelector("div[role='dialog'][class*='panelOverlay']") as HTMLElement;
      const btn = container.querySelector("button[class*='portfolioScrollToTop']") as HTMLButtonElement;

      // Scroll dialog
      act(() => {
        dialog.scrollTop = 200;
        dialog.dispatchEvent(new Event("scroll"));
      });
      expect(btn).not.toBeDisabled();

      // The isolated fixture always supplies a showreel: this interaction must run.
      const playBtn = container.querySelector("button[class*='playBtn']") as HTMLElement;
      expect(playBtn).toBeTruthy();
      fireEvent.click(playBtn);
      // Verify arrow hides while modal is open
      expect(btn).toBeDisabled();

      // Close Video Modal
      fireEvent.keyDown(window, { key: "Escape" });

      // Re-evaluated immediately on modal close: reappears because scrollTop is still 200
      expect(btn).not.toBeDisabled();
      expect(btn).toHaveAttribute("tabindex", "0");
    });
  });
});
