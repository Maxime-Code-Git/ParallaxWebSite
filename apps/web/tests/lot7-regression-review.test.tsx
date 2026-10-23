// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { loader as legalLoader } from "../app/routes/public/legal-page";
import { loader as redirectLoader } from "../app/routes/public/legal-redirect";
import { action as preferencesAction } from "../app/routes/api/privacy-preferences";
import {
  getSiteContent,
  saveCompanyContent,
  saveLegalPageDraft,
  publishLegalPage,
  unpublishLegalPage,
  getPublicCompanyContent,
} from "../app/lib/site-content.server";
import {
  parsePrivacyCookie,
} from "../app/lib/privacy-preferences.server";
import {
  hasProviderConsent,
  setClientOneTimeConsent,
  resetClientPrivacyState,
} from "../app/lib/privacy-client";
import { LegalPageView } from "../app/components/public/LegalPageView";
import { VideoModal } from "../app/components/public/VideoModal";
import type {
  LegalDocument,
} from "../app/lib/site-content.shared";

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

describe("Lot 7 - Review Corrections & Complete Regression Verification", () => {
  let tempDir: string;
  let testContentFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-lot7-regression-"));
    testContentFile = path.join(tempDir, "site-content.json");
    process.env.SITE_CONTENT_PATH = testContentFile;
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    process.env.RATE_LIMIT_SECRET = "super-secret-rate-limit-and-cookie-key-32b!";
    process.env.SESSION_SECRET = "session-secret-key-32-chars-long!!";

    resetClientPrivacyState();
    document.cookie = "__parallax_privacy_prefs=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // 1. Navigation légale .data et requêtes SSR
  describe("1. Legal routes with .data and legacy alias handling", () => {
    it("handles .data client transitions without 404 for direct routes", async () => {
      const initial = getSiteContent();
      const draft: LegalDocument = {
        ...initial.legalPages.privacy.draft,
        publicTitle: { fr: "Confidentialité", en: "Privacy Policy" },
        seoTitle: { fr: "Titre SEO", en: "SEO Title" },
        seoDescription: { fr: "Description SEO", en: "SEO Description" },
        intro: { fr: "Intro FR", en: "Intro EN" },
        effectiveDate: "2026-10-15",
        sections: [
          {
            id: "s1",
            title: { fr: "Titre 1", en: "Title 1" },
            paragraphs: [{ fr: "Para 1 FR", en: "Para 1 EN" }],
          },
        ],
      };
      const rev = saveLegalPageDraft("privacy", draft, initial.revision);
      publishLegalPage("privacy", rev, "2026-10-15");

      // GET /fr/confidentialite.data
      const reqFr = new Request("http://127.0.0.1:3000/fr/confidentialite.data", { method: "GET" });
      const resFr = await legalLoader(makeLoaderArgs(reqFr));
      const jsonFr = (resFr as unknown as { data: { lang: string; pageKey: string } }).data;
      expect(jsonFr.lang).toBe("fr");
      expect(jsonFr.pageKey).toBe("privacy");

      // GET /en/privacy-policy.data
      const reqEn = new Request("http://127.0.0.1:3000/en/privacy-policy.data", { method: "GET" });
      const resEn = await legalLoader(makeLoaderArgs(reqEn));
      const jsonEn = (resEn as unknown as { data: { lang: string; pageKey: string } }).data;
      expect(jsonEn.lang).toBe("en");
      expect(jsonEn.pageKey).toBe("privacy");

      // GET /fr/cookies.data
      const reqCookies = new Request("http://127.0.0.1:3000/fr/cookies.data", { method: "GET" });
      const resCookies = await legalLoader(makeLoaderArgs(reqCookies));
      const jsonCookies = (resCookies as unknown as { data: { lang: string; pageKey: string } }).data;
      expect(jsonCookies.lang).toBe("fr");
      expect(jsonCookies.pageKey).toBe("cookies");
    });

    it("legacy aliases with .data redirect properly without falling back to /fr", async () => {
      // /en/confidentialite.data -> redirect to /en/privacy-policy
      const reqEnAlias = new Request("http://127.0.0.1:3000/en/confidentialite.data", { method: "GET" });
      const resEnAlias = await redirectLoader(makeLoaderArgs(reqEnAlias));
      expect(resEnAlias.status).toBe(301);
      expect(resEnAlias.headers.get("Location")).toBe("/en/privacy-policy");

      // /fr/politique-de-confidentialite.data -> redirect to /fr/confidentialite
      const reqFrAlias = new Request(
        "http://127.0.0.1:3000/fr/politique-de-confidentialite.data",
        { method: "GET" }
      );
      const resFrAlias = await redirectLoader(makeLoaderArgs(reqFrAlias));
      expect(resFrAlias.status).toBe(301);
      expect(resFrAlias.headers.get("Location")).toBe("/fr/confidentialite");

      // /en/mentions-legales.data -> redirect to /en/legal-notice
      const reqMentionsAlias = new Request("http://127.0.0.1:3000/en/mentions-legales.data", {
        method: "GET",
      });
      const resMentionsAlias = await redirectLoader(makeLoaderArgs(reqMentionsAlias));
      expect(resMentionsAlias.status).toBe(301);
      expect(resMentionsAlias.headers.get("Location")).toBe("/en/legal-notice");
    });
  });

  // 2. Préférences accessibles avant publication et sans JavaScript
  describe("2. Preferences panel accessible without publication and without JavaScript", () => {
    it("renders #preferences panel even when document is null (unreleased document)", () => {
      const initial = getSiteContent();

      render(
        <MemoryRouter>
          <LegalPageView
            mode="public"
            lang="fr"
            pageKey="cookies"
            common={initial.common}
            company={initial.company}
            document={null} // Unpublished!
            alternateUrls={{ fr: "/fr/cookies", en: "/en/cookies" }}
            initialPreferences={{ youtube: false, vimeo: false }}
          />
        </MemoryRouter>
      );

      // Panel must be rendered and accessible
      expect(screen.getByRole("heading", { name: /Gestion de vos préférences/i })).toBeInTheDocument();
      // Form must include returnTo input
      const returnToInput = document.querySelector('input[name="returnTo"]') as HTMLInputElement;
      expect(returnToInput).not.toBeNull();
      expect(returnToInput.value).toBe("/fr/cookies#preferences");

      // Save and Revoke buttons are present
      expect(screen.getByRole("button", { name: /Enregistrer mes choix/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Révoquer/i })).toBeInTheDocument();
    });

    it("native HTML form submission with returnTo redirects with safe 303 to localized cookies page", async () => {
      const formBody = new URLSearchParams();
      formBody.set("intent", "save");
      formBody.set("youtube", "true");
      formBody.set("vimeo", "false");
      formBody.set("returnTo", "/fr/cookies#preferences");

      const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody.toString(),
      });

      const res = await preferencesAction(makeActionArgs(req));
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/fr/cookies#preferences");
      const cookieHeader = res.headers.get("Set-Cookie");
      expect(cookieHeader).toContain("__parallax_privacy_prefs=");
      expect(cookieHeader).toContain("HttpOnly");
    });

    it("native HTML form submission with revoke_all intent clears preferences without JS", async () => {
      const formBody = new URLSearchParams();
      formBody.set("intent", "revoke_all");
      formBody.set("returnTo", "/en/cookies#preferences");

      const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody.toString(),
      });

      const res = await preferencesAction(makeActionArgs(req));
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/en/cookies#preferences");
      const cookieHeader = res.headers.get("Set-Cookie");
      expect(cookieHeader).toContain("Max-Age=0");
    });
  });

  // 3. Vidéo & cookie falsifié / expirations
  describe("3. Video authorization & server-validated projection", () => {
    it("tampered cookie (dummy signature) is rejected both on server and in client player", () => {
      // Tampered cookie with fake flags and 64 zeroes
      const fakeCookie = "1.1.1760555555.1.1.0000000000000000000000000000000000000000000000000000000000000000";
      const serverCheck = parsePrivacyCookie(fakeCookie, process.env.RATE_LIMIT_SECRET!);
      expect(serverCheck.youtube).toBe(false);
      expect(serverCheck.vimeo).toBe(false);

      // Setting it in document.cookie should NOT be accepted by hasProviderConsent
      document.cookie = `__parallax_privacy_prefs=${fakeCookie}; Path=/`;
      expect(hasProviderConsent("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
      expect(hasProviderConsent("vimeo", "https://vimeo.com/123456789")).toBe(false);
    });

    it("one-time consent is strictly media-scoped: another video is NOT authorized", () => {
      const media1 = "https://www.youtube.com/watch?v=video111";
      const media2 = "https://www.youtube.com/watch?v=video222";

      // Authorize media 1 for this context
      setClientOneTimeConsent(media1, true);
      expect(hasProviderConsent("youtube", media1)).toBe(true);

      // Media 2 has NOT been granted consent
      expect(hasProviderConsent("youtube", media2)).toBe(false);
    });
  });

  // 4. API de préférences : types stricts, bornes et redirections
  describe("4. Privacy Preferences API strict validations and stream bounds", () => {
    it("rejects string booleans 'false' or 'true' without coercion", async () => {
      const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ youtube: "false", vimeo: "false" }),
      });

      const res = await preferencesAction(makeActionArgs(req));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/booléen strict/i);
    });

    it("rejects protocol-relative and external redirectTo destinations", async () => {
      const formBody = new URLSearchParams();
      formBody.set("intent", "save");
      formBody.set("youtube", "true");
      formBody.set("vimeo", "false");
      formBody.set("returnTo", "//example.invalid/phishing");

      const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody.toString(),
      });

      const res = await preferencesAction(makeActionArgs(req));
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toMatch(/Destination de retour non autorisée/i);
    });

    it("aborts stream reading and rejects payloads exceeding 8 KiB with 413", async () => {
      const largePadding = "a".repeat(10 * 1024);
      const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ padding: largePadding }),
      });

      const res = await preferencesAction(makeActionArgs(req));
      expect(res.status).toBe(413);
      const text = await res.text();
      expect(text).toMatch(/Payload Too Large/i);
    });
  });

  // 5. Sentinelles privées et filtrage public
  describe("5. Identity sentinel isolation and coordinate synchronization", () => {
    it("never leaks publicationDirector or private address when company.isPublished is false", () => {
      const initial = getSiteContent();

      // Set sentinel private values in unconfirmed company
      saveCompanyContent(
        {
          ...initial.company,
          tradeName: "Parallax Public Name",
          publicationDirector: "SECRET_DIRECTOR_SENTINEL_XYZ",
          address: "SECRET_PRIVATE_ADDRESS_123",
          enterpriseNumber: "0999.888.777",
          isPublished: false,
        },
        initial.revision
      );

      const publicCompany = getPublicCompanyContent();
      expect(publicCompany.isPublished).toBe(false);
      expect(publicCompany.tradeName).toBe("Parallax Public Name");
      expect((publicCompany as Record<string, unknown>).publicationDirector).toBeUndefined();
      expect((publicCompany as Record<string, unknown>).address).toBeUndefined();
      expect((publicCompany as Record<string, unknown>).enterpriseNumber).toBeUndefined();
    });

    it("clearing a social URL (Instagram) deletes the coordinate everywhere without leaving an orphan link", () => {
      const initial = getSiteContent();

      // First set Instagram
      const rev1 = saveCompanyContent(
        {
          ...initial.company,
          instagramUrl: "https://instagram.com/parallax_test",
        },
        initial.revision
      );
      let content = getSiteContent();
      expect(content.company.instagramUrl).toBe("https://instagram.com/parallax_test");
      expect(content.home.contact.instagramUrl).toBe("https://instagram.com/parallax_test");

      // Now clear Instagram (empty string)
      saveCompanyContent(
        {
          ...content.company,
          instagramUrl: "",
        },
        rev1
      );
      content = getSiteContent();
      expect(content.company.instagramUrl).toBe("");
      expect(content.home.contact.instagramUrl).toBe(""); // Cleared in home.contact too!
    });
  });

  // 6. Publication anti-placeholders et version monotone
  describe("6. Anti-placeholder checks and monotonic version numbering", () => {
    it("rejects publication if publicTitle contains unresolved placeholders", () => {
      const initial = getSiteContent();
      const draft: LegalDocument = {
        ...initial.legalPages.privacy.draft,
        publicTitle: { fr: "[à compléter]", en: "Privacy" },
        seoTitle: { fr: "Titre SEO", en: "SEO Title" },
        seoDescription: { fr: "Description SEO", en: "SEO Description" },
        intro: { fr: "Intro", en: "Intro" },
        effectiveDate: "2026-10-15",
        sections: [
          {
            id: "s1",
            title: { fr: "Titre", en: "Title" },
            paragraphs: [{ fr: "Contenu", en: "Content" }],
          },
        ],
      };

      const rev = saveLegalPageDraft("privacy", draft, initial.revision);
      expect(() => {
        publishLegalPage("privacy", rev, "2026-10-15");
      }).toThrow(/placeholders/i);
    });

    it("increments version monotonically after publication, unpublishing, and republication", () => {
      const initial = getSiteContent();
      const cleanDraft: LegalDocument = {
        ...initial.legalPages.privacy.draft,
        publicTitle: { fr: "Confidentialité v1", en: "Privacy v1" },
        seoTitle: { fr: "Titre", en: "Title" },
        seoDescription: { fr: "Description", en: "Description" },
        intro: { fr: "Intro", en: "Intro" },
        effectiveDate: "2026-10-15",
        sections: [
          {
            id: "s1",
            title: { fr: "Titre", en: "Title" },
            paragraphs: [{ fr: "Contenu", en: "Content" }],
          },
        ],
      };

      // 1. First publish -> v1
      const rev1 = saveLegalPageDraft("privacy", cleanDraft, initial.revision);
      const pubRev1 = publishLegalPage("privacy", rev1, "2026-10-15");
      let content = getSiteContent();
      expect(content.legalPages.privacy.published?.version).toBe(1);

      // 2. Second publish -> v2
      const pubRev2 = publishLegalPage("privacy", pubRev1, "2026-10-16");
      content = getSiteContent();
      expect(content.legalPages.privacy.published?.version).toBe(2);

      // 3. Unpublish
      const unpubRev = unpublishLegalPage("privacy", pubRev2);
      content = getSiteContent();
      expect(content.legalPages.privacy.published).toBeNull();
      expect(content.legalPages.privacy.draft.version).toBe(2); // Preserves version 2

      // 4. Republish -> MUST continue monotonically to v3!
      publishLegalPage("privacy", unpubRev, "2026-10-17");
      content = getSiteContent();
      expect(content.legalPages.privacy.published?.version).toBe(3);
    });
  });

  // 7. Zéro attribut style inline (CSP strict)
  describe("7. Zero inline styles across all new screens", () => {
    it("LegalPageView has zero inline styles", () => {
      const initial = getSiteContent();
      const { container } = render(
        <MemoryRouter>
          <LegalPageView
            mode="public"
            lang="fr"
            pageKey="mentions"
            common={initial.common}
            company={initial.company}
            document={initial.legalPages.mentions.draft}
            alternateUrls={{ fr: "/fr/mentions-legales", en: "/en/legal-notice" }}
            initialPreferences={{ youtube: false, vimeo: false }}
          />
        </MemoryRouter>
      );
      const elementsWithStyle = container.querySelectorAll("[style]");
      expect(elementsWithStyle.length).toBe(0);
    });

    it("VideoModal has zero inline styles", () => {
      const { container } = render(
        <VideoModal
          isOpen={true}
          onClose={vi.fn()}
          videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
          lang="fr"
        />
      );
      const elementsWithStyle = container.querySelectorAll("[style]");
      expect(elementsWithStyle.length).toBe(0);
    });
  });
});
