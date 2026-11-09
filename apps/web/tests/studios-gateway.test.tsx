// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import AdminStudiosPage from "../app/routes/admin/studios";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import defaultSiteContent from "../app/content/default-site-content.json";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";
import StudiosGateway, {
  SEMPRA_URL,
  PARALLAX_URL,
  meta,
  headers,
  loader as studiosLoader,
} from "../app/routes/public/studios";
import { applyStudiosSecurityHeaders } from "../app/entry.server";
import { loader as sitemapLoader } from "../app/routes/public/sitemap";
import routes from "../app/routes";

describe("Studios Gateway Route (/studios)", () => {
  let tmpDir: string;
  let testSiteContent: string;
  let testPortfolioContent: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-studios-test-"));
    testSiteContent = path.join(tmpDir, "site-content.json");
    testPortfolioContent = path.join(tmpDir, "portfolio-content.json");

    fs.writeFileSync(
      testSiteContent,
      JSON.stringify(defaultSiteContent, null, 2),
      "utf-8"
    );
    fs.writeFileSync(
      testPortfolioContent,
      JSON.stringify(createDefaultPortfolioContent(), null, 2),
      "utf-8"
    );

    process.env.SITE_CONTENT_PATH = testSiteContent;
    process.env.PORTFOLIO_CONTENT_PATH = testPortfolioContent;
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3003";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long";
  });

  afterEach(() => {
    cleanup();
    process.env = { ...originalEnv };
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("1. Route Registration", () => {
    it("keeps the real admin page free of inline styles, including its conflict state", async () => {
      const Stub = createRoutesStub([
        {
          path: "/admin/studios",
          Component: AdminStudiosPage,
          loader: () => ({
            csrfToken: "test-studios-csrf",
            studios: {
              sempra: { imageId: null, framing: "center" },
              parallax: { imageId: null, framing: "center" },
            },
            revision: "0123456789abcdef0123456789abcdef",
            isCorrupted: false,
            media: {},
          }),
          action: () => Response.json({
            error: "Conflit de révision",
            conflict: true,
            latestRevision: "abcdef0123456789abcdef0123456789",
          }, { status: 409 }),
        },
      ]);
      const { container } = render(<Stub initialEntries={["/admin/studios"]} />);
      const saveButton = await screen.findByRole("button", { name: "Enregistrer les réglages" });
      expect(container.querySelector("[style]")).toBeNull();

      fireEvent.click(saveButton);
      await screen.findByRole("button", { name: /Mettre à jour avec la dernière révision/ });
      await waitFor(() => expect(container.querySelector("[style]")).toBeNull());
      expect(screen.getByRole("alert").textContent).toContain("Conflit de révision");
    });

    it("is registered in route manifest with id studios-gateway and path studios", () => {
      const match = routes.find(
        (r) => "id" in r && r.id === "studios-gateway"
      );
      expect(match).toBeDefined();
      expect((match as { path: string }).path).toBe("studios");
    });
  });

  describe("2. Destinations and Link Structure", () => {
    it("contains exactly two destination links pointing to SEMPRA and Parallax in current tab", () => {
      const { container } = render(<StudiosGateway />);
      const allLinks = container.querySelectorAll("a");

      expect(allLinks).toHaveLength(2);

      const sempraLink = container.querySelector(
        `a[href="${SEMPRA_URL}"]`
      ) as HTMLAnchorElement | null;
      const parallaxLink = container.querySelector(
        `a[href="${PARALLAX_URL}"]`
      ) as HTMLAnchorElement | null;

      expect(sempraLink).not.toBeNull();
      expect(parallaxLink).not.toBeNull();

      expect(sempraLink?.href).toBe(SEMPRA_URL);
      expect(parallaxLink?.href).toBe(PARALLAX_URL);

      // Same-tab navigation (no target="_blank")
      expect(sempraLink?.getAttribute("target")).toBeNull();
      expect(parallaxLink?.getAttribute("target")).toBeNull();
    });

    it("has no nested interactive elements (no buttons, no nested links)", () => {
      const { container } = render(<StudiosGateway />);

      expect(container.querySelectorAll("button")).toHaveLength(0);
      expect(container.querySelectorAll("a a")).toHaveLength(0);
      expect(container.querySelectorAll("a button")).toHaveLength(0);
    });

    it("uses '|' instead of em-dash in accessible labels", () => {
      const { container } = render(<StudiosGateway />);
      const sempraLink = container.querySelector(`a[href="${SEMPRA_URL}"]`);
      const parallaxLink = container.querySelector(`a[href="${PARALLAX_URL}"]`);

      expect(sempraLink?.getAttribute("aria-label")).toBe("SEMPRA | Photographie et vidéo de mariage");
      expect(parallaxLink?.getAttribute("aria-label")).toBe("Parallax | Photographie et création vidéo");
      expect(sempraLink?.getAttribute("aria-label")).not.toContain("—");
      expect(parallaxLink?.getAttribute("aria-label")).not.toContain("—");
    });
  });

  it("places Parallax before SEMPRA and the StudioLM identity below both panels in DOM order", () => {
    const { container } = render(<StudiosGateway />);
    const links = container.querySelectorAll("a");
    expect(links[0]).toHaveAttribute("href", PARALLAX_URL);
    expect(links[1]).toHaveAttribute("href", SEMPRA_URL);
    const heading = screen.getByRole("heading", { level: 1, name: "StudioLM" });
    expect(links[1].compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe("3. StudioLM Identity", () => {
    it("displays the exact text 'StudioLM' in a prominent heading", () => {
      render(<StudiosGateway />);
      const heading = screen.getByRole("heading", { level: 1, name: "StudioLM" });
      expect(heading).not.toBeNull();
      expect(heading.textContent).toBe("StudioLM");
    });

    it("displays the StudioLM logo from /img/logo-studiolm.png without making it clickable", () => {
      const { container } = render(<StudiosGateway />);
      const studioLmImg = container.querySelector(
        'img[src="/img/logo-studiolm.png"]'
      ) as HTMLImageElement | null;

      expect(studioLmImg).not.toBeNull();
      // Ensure the StudioLM logo and title are not inside an anchor
      expect(studioLmImg?.closest("a")).toBeNull();
      const heading = screen.getByRole("heading", { level: 1, name: "StudioLM" });
      expect(heading.closest("a")).toBeNull();
    });
  });

  describe("4. SEMPRA Universe Panel", () => {
    it("displays SEMPRA logo, tagline, and call to action", () => {
      const { container } = render(<StudiosGateway />);
      const sempraLink = container.querySelector(
        `a[href="${SEMPRA_URL}"]`
      ) as HTMLElement;

      expect(sempraLink).not.toBeNull();

      // Logo
      const sempraLogo = sempraLink.querySelector(
        'img[src="/img/img-73c121e112.png"]'
      ) as HTMLImageElement | null;
      expect(sempraLogo).not.toBeNull();
      expect(sempraLogo?.alt).toBe("SEMPRA");

      // Tagline
      expect(sempraLink.textContent).toContain(
        "Photographie et vidéo de mariage"
      );

      // Action button text
      expect(sempraLink.textContent).toContain("Découvrir SEMPRA");
    });
  });

  describe("5. Parallax Universe Panel", () => {
    it("displays Parallax logo, brand name, tagline, and call to action", () => {
      const { container } = render(<StudiosGateway />);
      const parallaxLink = container.querySelector(
        `a[href="${PARALLAX_URL}"]`
      ) as HTMLElement;

      expect(parallaxLink).not.toBeNull();

      // Logo
      const parallaxLogo = parallaxLink.querySelector(
        'img[src="/img/logo-parallax.png"]'
      ) as HTMLImageElement | null;
      expect(parallaxLogo).not.toBeNull();

      // Brand name
      expect(parallaxLink.textContent).toContain("Parallax");

      // Tagline
      expect(parallaxLink.textContent).toContain(
        "Photographie et création vidéo"
      );

      // Action button text
      expect(parallaxLink.textContent).toContain("Découvrir Parallax");
    });
  });

  describe("6. Absence of Standard Vitrine Chrome", () => {
    it("renders without standard Header navigation, Footer, menu, forms, videos or scroll to top", () => {
      const { container } = render(<StudiosGateway />);

      // No standard site navigation or footer
      expect(container.querySelectorAll("nav")).toHaveLength(0);
      expect(container.querySelectorAll("footer")).toHaveLength(0);

      // No forms or dialogs
      expect(container.querySelectorAll("form")).toHaveLength(0);
      expect(container.querySelectorAll("dialog")).toHaveLength(0);

      // No video tags, iframes, or modal players
      expect(container.querySelectorAll("video")).toHaveLength(0);
      expect(container.querySelectorAll("iframe")).toHaveLength(0);

      // No links to internal vitrine routes (projets, contact, studio, mentions, etc.)
      const allHrefs = Array.from(container.querySelectorAll("a")).map((a) =>
        a.getAttribute("href")
      );
      expect(allHrefs.some((h) => h?.includes("/studio"))).toBe(false);
      expect(allHrefs.some((h) => h?.includes("/contact"))).toBe(false);
      expect(allHrefs.some((h) => h?.includes("/projets"))).toBe(false);
      expect(allHrefs.some((h) => h?.includes("/projects"))).toBe(false);
      expect(allHrefs.some((h) => h?.includes("/galerie"))).toBe(false);
      expect(allHrefs.some((h) => h?.includes("/espace-client"))).toBe(false);
    });
  });

  describe("7. Non-Indexation and Technical SEO", () => {
    it("uses '|' in document title and contains no em-dash", () => {
      const metaTags = meta({} as Parameters<typeof meta>[0]);
      const titleTag = metaTags?.find((m) => "title" in m);
      expect(titleTag).toBeDefined();
      expect((titleTag as { title: string }).title).toBe("StudioLM | SEMPRA & Parallax");
      expect((titleTag as { title: string }).title).not.toContain("—");
    });

    it("declares noindex and nofollow in route metadata", () => {
      const metaTags = meta({} as Parameters<typeof meta>[0]);
      expect(metaTags).toBeDefined();
      const robotsMeta = metaTags?.find(
        (m) => "name" in m && m.name === "robots"
      );
      const googlebotMeta = metaTags?.find(
        (m) => "name" in m && m.name === "googlebot"
      );

      expect(robotsMeta).toBeDefined();
      expect((robotsMeta as { content: string }).content).toBe(
        "noindex, nofollow"
      );

      expect(googlebotMeta).toBeDefined();
      expect((googlebotMeta as { content: string }).content).toBe(
        "noindex, nofollow"
      );
    });

    it("declares X-Robots-Tag: noindex, nofollow in route headers", () => {
      const h = headers({} as Parameters<typeof headers>[0]);
      expect(h).toBeDefined();
      expect((h as Record<string, string>)["X-Robots-Tag"]).toBe(
        "noindex, nofollow"
      );
    });

    it("enforces X-Robots-Tag: noindex, nofollow via applyStudiosSecurityHeaders", () => {
      const urls = [
        "http://127.0.0.1:3003/studios",
        "http://127.0.0.1:3003/studios/",
        "http://127.0.0.1:3003/studios.data",
        "https://parallax.example.com/studios",
      ];

      for (const url of urls) {
        const h = new Headers();
        applyStudiosSecurityHeaders(h, url);
        expect(h.get("X-Robots-Tag")).toBe("noindex, nofollow");
      }

      // Non-studios route must remain untouched
      const homeHeaders = new Headers();
      applyStudiosSecurityHeaders(homeHeaders, "https://parallax.example.com/fr");
      expect(homeHeaders.get("X-Robots-Tag")).toBeNull();
    });

    it("is completely absent from sitemap.xml", async () => {
      const res = await sitemapLoader();
      const xml = await res.text();
      expect(xml).not.toContain("/studios");
      expect(xml).not.toContain("studios");
    });
  });

  describe("8. Dynamic Media Configuration & Fallback", () => {
    it("renders NO background <img> when no custom image is configured (pure brand background)", () => {
      const { container } = render(<StudiosGateway />);
      // Neither SEMPRA nor Parallax panel should contain an image with class bgImage
      const bgImages = container.querySelectorAll("img[class*='bgImage']");
      expect(bgImages).toHaveLength(0);
    });

    it("public loader exposes only gateway panel image and framing data", async () => {
      const res = await studiosLoader();
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

      const data = await res.json();
      expect(data).toHaveProperty("sempra");
      expect(data).toHaveProperty("parallax");
      expect(data.sempra).toEqual({ imageId: null, framing: "center" });
      expect(data.parallax).toEqual({ imageId: null, framing: "center" });
    });
  });
});
