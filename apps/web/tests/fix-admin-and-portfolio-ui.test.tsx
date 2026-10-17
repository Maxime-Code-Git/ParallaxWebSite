import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action as adminHomeAction, loader as adminHomeLoader } from "../app/routes/admin/home";
import { action as adminContactAction } from "../app/routes/admin/contact";
import {
  getRawSiteContent,
  getSiteContent,
  validateSiteContent,
  migrateSiteContentV2ToV3,
  type SiteContentV2,
} from "../app/lib/site-content.server";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { ScrollToTop } from "../app/components/public/ScrollToTop";
import { VideoModal } from "../app/components/public/VideoModal";

describe("Fix Admin Content & Public UI Suite", () => {
  let tempDir: string;
  let testContentFile: string;
  let testDbFile: string;
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-fix-tests-"));
    testContentFile = path.join(tempDir, "site-content.json");
    testDbFile = path.join(tempDir, "rate-limit.sqlite");
    const testMediaDir = path.join(tempDir, "site-media");
    fs.mkdirSync(testMediaDir, { mode: 0o700, recursive: true });

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
      TRUST_PROXY: "false",
    };
  });

  afterEach(() => {
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

    it("sanitizes legacy V2 documents with placeholder '#' or invalid phone during migration so V3 is valid", () => {
      const initial = getSiteContent();
      const v2Sample: SiteContentV2 = {
        schemaVersion: 2,
        revision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        updatedAt: "2026-01-01T00:00:00.000Z",
        common: {
          ...initial.common,
          brandName: "Parallax Test",
        },
        home: {
          ...initial.home,
          contact: {
            ...initial.home.contact,
            email: "invalid-email-format",
            instagramUrl: "#",
            youtubeUrl: "#",
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
      };

      const migrated = migrateSiteContentV2ToV3(v2Sample);
      // Ensure phone and URLs are sanitized and do not throw in validateSiteContent
      const validated = validateSiteContent(migrated);
      expect(validated.schemaVersion).toBe(3);
      expect(validated.company.phone).toBe("");
      expect(validated.company.instagramUrl).toBe("");
      expect(validated.company.youtubeUrl).toBe("");
      expect(validated.company.email).toBe("");
    });

    it("admin loader returns corruption details honestly when file is unreadable/corrupted", async () => {
      const cookie = await createValidAdminCookie();
      // Corrupt file on disk deliberately
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
  // 2. ScrollToTop Component Stability & Target Handling
  // =========================================================================
  describe("2. ScrollToTop Component & Target Handling", () => {
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

      // Clicking scrolls panel, not window
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

      // Rerender with hidden=true (modal open)
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
  // 3. Mobile Portfolio Category Entry Layout & CTA
  // =========================================================================
  describe("3. Mobile Portfolio Category Entry Layout & CTA", () => {
    it("renders both desktop and mobile CTA labels with accessible aria-label", () => {
      const mockCategoryRow = {
        title: "Documentaire",
        buttonTextFr: "Voir plus de projets de ce genre",
        buttonTextEn: "See more projects like this",
        mobileLabelFr: "Voir les projets",
        mobileLabelEn: "View projects",
      };

      const { container } = render(
        <div className="showcaseRow">
          <div className="textCard">
            <div className="categoryTag">{mockCategoryRow.title}</div>
            <a
              href="/portfolio/documentaire"
              className="seeMoreBtn"
              aria-label={`${mockCategoryRow.mobileLabelFr} - ${mockCategoryRow.title}`}
            >
              <span className="btnLabelDesktop">{mockCategoryRow.buttonTextFr}</span>
              <span className="btnLabelMobile">{mockCategoryRow.mobileLabelFr}</span>
              <span className="circleIcon">
                <svg viewBox="0 0 24 24" />
              </span>
            </a>
          </div>
        </div>
      );

      const link = container.querySelector("a");
      expect(link).toBeTruthy();
      expect(link?.getAttribute("aria-label")).toBe("Voir les projets - Documentaire");
      expect(container.querySelector(".btnLabelDesktop")?.textContent).toBe("Voir plus de projets de ce genre");
      expect(container.querySelector(".btnLabelMobile")?.textContent).toBe("Voir les projets");
    });
  });

  // =========================================================================
  // 4. Video Poster Centered Play Button & Consent Notice
  // =========================================================================
  describe("4. Video Poster Centered Play Button & Consent Notice", () => {
    it("renders dedicated overlay wrapper for Play button inside .showreelCard", () => {
      const onPlayMock = vi.fn();
      const { container } = render(
        <div className="showreelCard">
          <img src="/sample.jpg" alt="Affiche" className="showreelImg" />
          <div className="showreelOverlay">
            <button
              type="button"
              className="playBtn"
              onClick={onPlayMock}
              aria-label="Lire la vidéo"
            >
              <svg viewBox="0 0 26 28" />
            </button>
          </div>
        </div>
      );

      const card = container.querySelector(".showreelCard");
      expect(card).toBeTruthy();
      const overlay = card?.querySelector(".showreelOverlay");
      expect(overlay).toBeTruthy();
      const playBtn = overlay?.querySelector("button.playBtn");
      expect(playBtn).toBeTruthy();

      // Trigger click on play button
      fireEvent.click(playBtn!);
      expect(onPlayMock).toHaveBeenCalledTimes(1);
    });

    it("opens VideoModal notice without iframe, and displays iframe only after user consent", () => {
      const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
      const onCloseMock = vi.fn();

      const { container } = render(
        <VideoModal isOpen={true} onClose={onCloseMock} videoUrl={videoUrl} lang="fr" />
      );

      // 1. Consent notice is displayed, NO iframe exists before consent
      expect(screen.getByText(/lecture externe/i)).toBeTruthy();
      expect(container.querySelector("iframe")).toBeNull();

      // 2. Click confirm consent button
      const confirmBtn = screen.getByRole("button", { name: /accepter et lire/i });
      fireEvent.click(confirmBtn);

      // 3. Iframe is now rendered with youtube-nocookie
      const iframe = container.querySelector("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.getAttribute("src")).toContain("youtube-nocookie.com/embed/");
    });
  });
});
