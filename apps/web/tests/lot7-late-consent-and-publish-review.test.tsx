// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action as legalEditAction } from "../app/routes/admin/legal-edit";
import { action as preferencesAction, loader as preferencesLoader } from "../app/routes/api/privacy-preferences";
import {
  getSiteContent,
  publishLegalPage,
  validateEffectiveDate,
  ValidationError,
} from "../app/lib/site-content.server";
import {
  hasProviderConsent,
  fetchValidatedPreferences,
  persistProviderPreferences,
  revokeAllProviderConsent,
  resetClientPrivacyState,
  getClientValidatedPreferences,
  setClientValidatedPreferences,
} from "../app/lib/privacy-client";
import { VideoModal } from "../app/components/public/VideoModal";
import type { LegalDocument } from "../app/lib/site-content.shared";
import { commitSession, getSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";

async function getAdminSessionCookie(csrfToken = "test-csrf-token-12345"): Promise<string> {
  const session = await getSession();
  session.set("adminId", "admin-1");
  session.set("credentialVersion", computeCredentialVersion());
  session.set("expiresAt", Date.now() + 3600_000);
  session.set("csrfToken", csrfToken);
  return commitSession(session);
}

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

// Helper to create a deferred promise for controlled async resolutions
function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Lot 7 - Late Consent Responses & Atomic Publication Quality Verification", () => {
  let tempDir: string;
  let testContentFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-lot7-late-consent-"));
    testContentFile = path.join(tempDir, "site-content.json");
    process.env.SITE_CONTENT_PATH = testContentFile;
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    process.env.RATE_LIMIT_SECRET = "super-secret-rate-limit-and-cookie-key-32b!";
    process.env.ADMIN_SESSION_SECRET = "admin-session-secret-at-least-32-chars!!";
    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g";
    process.env.RATE_LIMIT_DB_PATH = path.join(tempDir, "rate-limit.db");
    process.env.SESSION_SECRET = "session-secret-key-32-chars-long!!";

    resetClientPrivacyState();
    document.cookie = "__parallax_privacy_prefs=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Consentement : Le dernier choix doit toujours primer (Cas A, B, C, D)
  // =========================================================================
  describe("1. Late consent responses & context-aware authorization", () => {
    it("Cas A : late GET resolved after successful revocation does NOT restore consent nor re-create iframe", async () => {
      const getDeferred = createDeferred<{ ok: boolean; preferences: { youtube: boolean; vimeo: boolean } }>();

      // Mock fetch: GET /api/privacy/preferences is deferred; POST /api/privacy/preferences succeeds immediately
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method || "GET";
        if (method === "GET" && url.includes("/api/privacy/preferences")) {
          const res = await getDeferred.promise;
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "POST" && url.includes("/api/privacy/preferences")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      });

      const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
      const { container } = render(
        <VideoModal isOpen={true} onClose={vi.fn()} videoUrl={videoUrl} lang="fr" />
      );

      // Initially, iframe is not present (awaiting consent evaluation)
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText(/Lecture externe \(YouTube\)/i)).toBeInTheDocument();

      // User revokes all consent
      await act(async () => {
        const revoked = await revokeAllProviderConsent();
        expect(revoked).toBe(true);
      });

      expect(hasProviderConsent("youtube", videoUrl)).toBe(false);
      expect(container.querySelector("iframe")).toBeNull();

      // Now resolve the late GET with stale positive consent (youtube: true)
      await act(async () => {
        getDeferred.resolve({ ok: true, preferences: { youtube: true, vimeo: false } });
        await Promise.resolve();
      });

      // The late GET must NOT overwrite validated preferences nor resurrect the iframe!
      expect(hasProviderConsent("youtube", videoUrl)).toBe(false);
      expect(getClientValidatedPreferences()?.youtube).toBe(false);
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText(/Lecture externe \(YouTube\)/i)).toBeInTheDocument();

      fetchSpy.mockRestore();
    });

    it("Cas B : YouTube response received after user switches to Vimeo NEVER authorizes Vimeo iframe", async () => {
      const youtubeGetDeferred = createDeferred<{ ok: boolean; preferences: { youtube: boolean; vimeo: boolean } }>();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method || "GET";
        if (method === "GET" && url.includes("/api/privacy/preferences")) {
          // If first request (YouTube), defer it
          if (fetchSpy.mock.calls.length === 1) {
            const res = await youtubeGetDeferred.promise;
            return new Response(JSON.stringify(res), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          // Subsequent request (Vimeo): returns false for both
          return new Response(JSON.stringify({ ok: true, preferences: { youtube: false, vimeo: false } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      });

      const youtubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
      const vimeoUrl = "https://vimeo.com/123456789";

      // 1. Open YouTube video modal
      const { container, rerender } = render(
        <VideoModal isOpen={true} onClose={vi.fn()} videoUrl={youtubeUrl} lang="fr" />
      );

      // YouTube evaluation is pending...
      expect(container.querySelector("iframe")).toBeNull();

      // 2. User switches to Vimeo video
      rerender(
        <VideoModal isOpen={true} onClose={vi.fn()} videoUrl={vimeoUrl} lang="fr" />
      );

      // 3. Resolve old YouTube GET with youtube: true, vimeo: false
      await act(async () => {
        youtubeGetDeferred.resolve({ ok: true, preferences: { youtube: true, vimeo: false } });
        await Promise.resolve();
      });

      // Vimeo iframe MUST NOT be rendered!
      expect(hasProviderConsent("vimeo", vimeoUrl)).toBe(false);
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText(/Lecture externe \(Vimeo\)/i)).toBeInTheDocument();

      fetchSpy.mockRestore();
    });

    it("Cas C : unpersisted revocation (failed network POST) keeps tab-local refusal lock active", async () => {
      // Initially, user had saved YouTube consent in server cookie
      setClientValidatedPreferences({ youtube: true, vimeo: false });
      const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
      expect(hasProviderConsent("youtube", videoUrl)).toBe(true);

      // Mock fetch: revocation POST fails with network error
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const method = init?.method || "GET";
        if (method === "POST") {
          throw new Error("Network error during revocation");
        }
        if (method === "GET") {
          // Server cookie still holds youtube: true because POST failed
          return new Response(
            JSON.stringify({ ok: true, preferences: { youtube: true, vimeo: false } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not Found", { status: 404 });
      });

      // User clicks Revoke All -> POST fails
      const revokeSuccess = await revokeAllProviderConsent();
      expect(revokeSuccess).toBe(false); // Network error simulated

      // Tab-local refusal MUST remain enforced in this tab session
      expect(hasProviderConsent("youtube", videoUrl)).toBe(false);
      expect(getClientValidatedPreferences()?.youtube).toBe(false);

      // Reopening a video in this tab: fetchValidatedPreferences re-reads the server cookie
      const reReadPrefs = await fetchValidatedPreferences();
      // Server returned youtube: true, but tab refusal overrides it!
      expect(reReadPrefs.youtube).toBe(false);
      expect(hasProviderConsent("youtube", videoUrl)).toBe(false);

      // Rendering VideoModal must show consent notice, NOT an active iframe
      const { container } = render(
        <VideoModal isOpen={true} onClose={vi.fn()} videoUrl={videoUrl} lang="fr" />
      );
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText(/Lecture externe \(YouTube\)/i)).toBeInTheDocument();

      fetchSpy.mockRestore();
    });

    it("Cas D : late acceptance POST resolved after revocation does NOT resurrect consent", async () => {
      const acceptDeferred = createDeferred<{ ok: boolean; preferences: { youtube: boolean; vimeo: boolean } }>();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const method = init?.method || "GET";
        const bodyStr = String(init?.body || "");
        if (method === "POST" && bodyStr.includes("revoke_all")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "POST" && bodyStr.includes("youtube")) {
          const res = await acceptDeferred.promise;
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      });

      // 1. User starts saving YouTube consent (in flight)
      const savePromise = persistProviderPreferences({ youtube: true, vimeo: false });

      // 2. Before save completes, user clicks Revoke All
      const revokeSuccess = await revokeAllProviderConsent();
      expect(revokeSuccess).toBe(true);
      expect(hasProviderConsent("youtube")).toBe(false);

      // 3. The stale acceptance POST resolves late
      acceptDeferred.resolve({ ok: true, preferences: { youtube: true, vimeo: false } });
      const saveResult = await savePromise;
      expect(saveResult).toBe(false); // Obsolete response discarded

      // 4. Consent must remain strictly false
      expect(hasProviderConsent("youtube")).toBe(false);
      expect(getClientValidatedPreferences()?.youtube).toBe(false);

      fetchSpy.mockRestore();
    });

    it("1. Real accept button with late response after modal close & revocation does NOT restore consent nor re-create iframe upon reopening", async () => {
      const acceptDeferred = createDeferred<{ ok: boolean; preferences: { youtube: boolean; vimeo: boolean } }>();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const method = init?.method || "GET";
        const bodyStr = String(init?.body || "");
        if (method === "POST" && bodyStr.includes("revoke_all")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "POST" && bodyStr.includes("youtube")) {
          const res = await acceptDeferred.promise;
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      });

      const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

      // 1. Open YouTube video modal without prior consent
      const { container, rerender } = render(
        <VideoModal isOpen={true} onClose={vi.fn()} videoUrl={videoUrl} lang="fr" />
      );

      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText(/Lecture externe \(YouTube\)/i)).toBeInTheDocument();

      // 2. Check "Mémoriser mon accord" and click "Accepter et lire"
      const rememberCheckbox = screen.getByRole("checkbox");
      fireEvent.click(rememberCheckbox);
      const acceptButton = screen.getByRole("button", { name: /Accepter et lire/i });

      // Click accept -> POST starts and remains pending
      fireEvent.click(acceptButton);

      // 3. Close the modal, then revoke all consents
      rerender(<VideoModal isOpen={false} onClose={vi.fn()} videoUrl={videoUrl} lang="fr" />);

      await act(async () => {
        const revoked = await revokeAllProviderConsent();
        expect(revoked).toBe(true);
      });
      expect(hasProviderConsent("youtube", videoUrl)).toBe(false);

      // 4. Resolve the stale accept POST
      await act(async () => {
        acceptDeferred.resolve({ ok: true, preferences: { youtube: true, vimeo: false } });
        await Promise.resolve();
      });

      // Verification: one-time consent must NOT have been granted
      expect(hasProviderConsent("youtube", videoUrl)).toBe(false);

      // 5. Reopen the same video modal
      rerender(<VideoModal isOpen={true} onClose={vi.fn()} videoUrl={videoUrl} lang="fr" />);

      // Must NOT render an iframe! Consent prompt must be shown!
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText(/Lecture externe \(YouTube\)/i)).toBeInTheDocument();
      expect(hasProviderConsent("youtube", videoUrl)).toBe(false);

      fetchSpy.mockRestore();
    });

    it("2. Generation guard after res.json() prevents stale JSON body from overwriting newer choices", async () => {
      const jsonDeferred = createDeferred<{ ok: boolean; preferences: { youtube: boolean; vimeo: boolean } }>();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const bodyStr = String(init?.body || "");
        if (bodyStr.includes('"youtube":true')) {
          // Response A: fetch resolves immediately, but res.json() is delayed
          return {
            ok: true,
            status: 200,
            json: () => jsonDeferred.promise,
          } as unknown as Response;
        }
        if (bodyStr.includes('"youtube":false')) {
          // Response B: completes immediately
          return new Response(JSON.stringify({ ok: true, preferences: { youtube: false, vimeo: false } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      });

      // 1. Start save A: YouTube allowed (in flight)
      const savePromiseA = persistProviderPreferences({ youtube: true, vimeo: false });

      // Yield event loop so fetch is resolved and json() is called & pending
      await new Promise((r) => setTimeout(r, 10));

      // 2. Start save B: YouTube and Vimeo refused
      const savePromiseB = persistProviderPreferences({ youtube: false, vimeo: false });
      const resultB = await savePromiseB;
      expect(resultB).toBe(true);
      expect(hasProviderConsent("youtube")).toBe(false);
      expect(getClientValidatedPreferences()?.youtube).toBe(false);

      // 3. Now resolve A's json() with stale positive preference
      jsonDeferred.resolve({ ok: true, preferences: { youtube: true, vimeo: false } });
      const resultA = await savePromiseA;

      // A must be detected as stale after its res.json()
      expect(resultA).toBe(false);

      // 4. Consent must remain strictly false
      expect(hasProviderConsent("youtube")).toBe(false);
      expect(getClientValidatedPreferences()?.youtube).toBe(false);

      fetchSpy.mockRestore();
    });

    it("3. Bounded mutation serialization guarantees chronological Set-Cookie order with real handler", async () => {
      let cookieJar = "";
      const acceptFetchDeferred = createDeferred<void>();

      // Mock fetch: routes to real privacyPreferencesAction, but allows deferring the accept response
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method || "GET";
        const bodyStr = String(init?.body || "");

        if (url.includes("/api/privacy/preferences") && method === "POST") {
          const req = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
            method: "POST",
            headers: {
              Origin: "http://127.0.0.1:3000",
              "Content-Type": "application/json",
              Cookie: cookieJar,
            },
            body: bodyStr,
          });

          if (bodyStr.includes('"youtube":true')) {
            // Wait for test to release A
            await acceptFetchDeferred.promise;
          }

          const res = await preferencesAction(makeActionArgs(req));
          const setCookie = res.headers.get("Set-Cookie");
          if (setCookie) {
            cookieJar = setCookie.split(";")[0];
          }
          return res;
        }

        return new Response("Not Found", { status: 404 });
      });

      // 1. User starts accept A: YouTube authorized (held in flight)
      const savePromiseA = persistProviderPreferences({ youtube: true, vimeo: false });

      // 2. While A is in flight, user triggers revocation B
      // Revocation updates local state immediately:
      const revokePromiseB = revokeAllProviderConsent();
      expect(hasProviderConsent("youtube")).toBe(false);

      // 3. Release A's response so A finishes first on the network
      acceptFetchDeferred.resolve();

      // Wait for both mutations to finish in sequential order
      const [resA, resB] = await Promise.all([savePromiseA, revokePromiseB]);
      expect(resA).toBe(false); // A was superseded by B
      expect(resB).toBe(true);  // B succeeded as the final mutation

      // 4. Simulate a page reload: clear all in-memory state
      resetClientPrivacyState();

      // Read preferences via the real loader using the cookieJar produced by the browser
      const loaderReq = new Request("http://127.0.0.1:3000/api/privacy/preferences", {
        headers: { Cookie: cookieJar },
      });
      const loaderRes = await preferencesLoader(makeLoaderArgs(loaderReq));
      const json = (await loaderRes.json()) as { ok: boolean; preferences: { youtube: boolean; vimeo: boolean } };

      // The final cookie must reflect revocation B! YouTube must be false!
      expect(json.preferences.youtube).toBe(false);
      expect(json.preferences.vimeo).toBe(false);

      fetchSpy.mockRestore();
    });
  });

  // =========================================================================
  // 2. Refus de publication : Atomicité, zéro écriture cachée, aucun faux 409
  // =========================================================================
  describe("2. Atomic legal document publication without hidden draft writes", () => {
    it("rejects publish with 400 when draft contains placeholders without mutating disk revision, then succeeds without 409", async () => {
      const initial = getSiteContent();
      const initialRev = initial.revision;
      const initialDiskFileContent = fs.readFileSync(testContentFile, "utf-8");

      // Setup authenticated session with CSRF token
      const cookieHeader = await getAdminSessionCookie("test-csrf-token-12345");

      const invalidCandidateDraft: LegalDocument = {
        ...initial.legalPages.privacy.draft,
        publicTitle: { fr: "[à compléter]", en: "Privacy" },
        seoTitle: { fr: "Titre SEO", en: "SEO Title" },
        seoDescription: { fr: "Description SEO", en: "SEO Description" },
        intro: { fr: "Intro FR", en: "Intro EN" },
        effectiveDate: "2026-10-15",
        sections: [
          {
            id: "s1",
            title: { fr: "Section 1", en: "Section 1" },
            paragraphs: [{ fr: "Contenu FR", en: "Content EN" }],
          },
        ],
      };

      // 1. Send publish with placeholder in draftData
      const form1 = new URLSearchParams();
      form1.set("csrfToken", "test-csrf-token-12345");
      form1.set("revision", initialRev);
      form1.set("intent", "publish");
      form1.set("draftData", JSON.stringify(invalidCandidateDraft));
      form1.set("effectiveDate", "2026-10-15");

      const req1 = new Request("http://127.0.0.1:3000/admin/legal/privacy", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form1.toString(),
      });

      const res1 = await legalEditAction(makeActionArgs(req1, { pageKey: "privacy" }));

      // Publication rejected
      expect(res1.status).toBe(400);
      const json1 = (await res1.json()) as { error: string };
      expect(json1.error).toMatch(/placeholders/i);

      // Verify ZERO disk mutations: the revision and file content are identical to before the call!
      const afterRejectContent = getSiteContent();
      expect(afterRejectContent.revision).toBe(initialRev);
      expect(afterRejectContent.legalPages.privacy.published).toBeNull();
      expect(fs.readFileSync(testContentFile, "utf-8")).toBe(initialDiskFileContent);

      // 2. User fixes the placeholder and resubmits with the SAME initialRev (what the client still knows)
      const validCandidateDraft: LegalDocument = {
        ...invalidCandidateDraft,
        publicTitle: { fr: "Politique de confidentialité", en: "Privacy Policy" },
      };

      const form2 = new URLSearchParams();
      form2.set("csrfToken", "test-csrf-token-12345");
      form2.set("revision", initialRev); // Same revision! No artificial 409!
      form2.set("intent", "publish");
      form2.set("draftData", JSON.stringify(validCandidateDraft));
      form2.set("effectiveDate", "2026-10-15");

      const req2 = new Request("http://127.0.0.1:3000/admin/legal/privacy", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form2.toString(),
      });

      const res2 = await legalEditAction(makeActionArgs(req2, { pageKey: "privacy" }));

      expect(res2.status).toBe(200);
      const json2 = (await res2.json()) as { success: boolean; newRevision: string };
      expect(json2.success).toBe(true);
      expect(json2.newRevision).not.toBe(initialRev);

      const afterPublishContent = getSiteContent();
      expect(afterPublishContent.legalPages.privacy.published?.publicTitle.fr).toBe(
        "Politique de confidentialité"
      );
      expect(afterPublishContent.legalPages.privacy.published?.version).toBe(1);
    });

    it("returns genuine 409 conflict when a concurrent modification really occurred on the server", async () => {
      const initial = getSiteContent();

      const cookieHeader = await getAdminSessionCookie("test-csrf-token-12345");

      const form = new URLSearchParams();
      form.set("csrfToken", "test-csrf-token-12345");
      form.set("revision", "stale_outdated_revision_999");
      form.set("intent", "publish");
      form.set("effectiveDate", "2026-10-15");

      const req = new Request("http://127.0.0.1:3000/admin/legal/privacy", {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });

      const res = await legalEditAction(makeActionArgs(req, { pageKey: "privacy" }));

      expect(res.status).toBe(409);
      const json = (await res.json()) as { conflict: boolean; serverRevision: string };
      expect(json.conflict).toBe(true);
      expect(json.serverRevision).toBe(initial.revision);
    });
  });

  // =========================================================================
  // 3. Validation stricte du calendrier pour la date d'effet réelle
  // =========================================================================
  describe("3. Strict calendar date validation for legal effective date", () => {
    it("accepts valid ISO and textual calendar dates", () => {
      expect(validateEffectiveDate("2026-10-15")).toBe("2026-10-15");
      expect(validateEffectiveDate("15 octobre 2026")).toBe("15 octobre 2026");
      expect(validateEffectiveDate("1er octobre 2026")).toBe("1er octobre 2026");
      expect(validateEffectiveDate("October 15, 2026")).toBe("October 15, 2026");
    });

    it("rejects nonexistent or impossible calendar dates", () => {
      // February 31 does not exist
      expect(() => validateEffectiveDate("2026-02-31")).toThrow(ValidationError);
      expect(() => validateEffectiveDate("31 février 2026")).toThrow(ValidationError);

      // April 31 does not exist (April has 30 days)
      expect(() => validateEffectiveDate("2026-04-31")).toThrow(ValidationError);

      // February 29 in a non-leap year (2026 is not a leap year)
      expect(() => validateEffectiveDate("2026-02-29")).toThrow(ValidationError);
      expect(() => validateEffectiveDate("29 février 2026")).toThrow(ValidationError);

      // Month 13
      expect(() => validateEffectiveDate("2026-13-01")).toThrow(ValidationError);

      // Arbitrary text containing year 2026
      expect(() => validateEffectiveDate("texte arbitraire 2026")).toThrow(ValidationError);
      expect(() => validateEffectiveDate("2026")).toThrow(ValidationError);
    });

    it("rejects publication with an impossible calendar date", () => {
      const initial = getSiteContent();
      expect(() => {
        publishLegalPage("privacy", initial.revision, "2026-02-31");
      }).toThrow(/n'est pas une date de calendrier valide/i);
    });
  });
});
