import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { loader as rootRedirectLoader } from "../app/routes/root-redirect";
import { loader as homeLoader } from "../app/routes/public/home";
import { loader as studioLoader } from "../app/routes/public/studio";
import { action as adminHomeAction, loader as adminHomeLoader } from "../app/routes/admin/home";
import { action as adminStudioAction, loader as adminStudioLoader } from "../app/routes/admin/studio";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { getSiteContent } from "../app/lib/site-content.server";

describe("Editorial Routes and Actions", () => {
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

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-routes-test-"));
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

  async function createValidAdminCookie(csrfToken = "valid-csrf-token"): Promise<string> {
    const session = await getSession();
    session.set("adminId", "admin-1");
    session.set("credentialVersion", computeCredentialVersion());
    session.set("expiresAt", Date.now() + 3600_000);
    session.set("csrfToken", csrfToken);
    return commitSession(session);
  }

  it("root-redirect.tsx redirects to /fr with status 302", async () => {
    const response = await rootRedirectLoader();
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/fr");
  });

  it("public home loader returns French content for /fr and English for /en", async () => {
    const reqFr = new Request("http://localhost:3000/fr");
    const dataFr = await homeLoader(makeLoaderArgs(reqFr));
    expect(dataFr.lang).toBe("fr");
    expect(dataFr.home.hero.title.fr).toBe("Photo & vidéo.");

    const reqEn = new Request("http://localhost:3000/en");
    const dataEn = await homeLoader(makeLoaderArgs(reqEn));
    expect(dataEn.lang).toBe("en");
    expect(dataEn.home.hero.title.en).toBe("Photo & video.");
  });

  it("public studio loader returns French content for /fr/studio and English for /en/studio", async () => {
    const reqFr = new Request("http://localhost:3000/fr/studio");
    const dataFr = await studioLoader(makeLoaderArgs(reqFr));
    expect(dataFr.lang).toBe("fr");
    expect(dataFr.studio.hero.title.fr).toBe("Le studio");

    const reqEn = new Request("http://localhost:3000/en/studio");
    const dataEn = await studioLoader(makeLoaderArgs(reqEn));
    expect(dataEn.lang).toBe("en");
    expect(dataEn.studio.hero.title.en).toBe("The studio");
  });

  describe("admin/home.tsx", () => {
    it("loader throws redirect to /admin when not authenticated", async () => {
      const req = new Request("http://localhost:3000/admin/home");
      await expect(adminHomeLoader(makeLoaderArgs(req))).rejects.toSatisfy(
        (res: Response) => res.status === 303 && res.headers.get("Location") === "/admin"
      );
    });

    it("action handles successful update and returns 200 with newRevision", async () => {
      const cookie = await createValidAdminCookie("csrf-home-1");
      const content = getSiteContent();

      const updatedHome = {
        ...content.home,
        hero: {
          ...content.home.hero,
          title: { fr: "Nouveau titre", en: "New title" },
        },
      };

      const body = new URLSearchParams({
        csrfToken: "csrf-home-1",
        revision: content.revision,
        homeData: JSON.stringify(updatedHome),
      }).toString();

      const req = new Request("http://localhost:3000/admin/home", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
          Cookie: cookie,
        },
        body,
      });

      const response = await adminHomeAction(makeActionArgs(req));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.newRevision).toMatch(/^[0-9a-f]{32}$/);
    });

    it("action returns 409 conflict when revision does not match", async () => {
      const cookie = await createValidAdminCookie("csrf-home-2");
      const content = getSiteContent();
      const staleRevision = "abcdef0123456789abcdef0123456789";

      const body = new URLSearchParams({
        csrfToken: "csrf-home-2",
        revision: staleRevision,
        homeData: JSON.stringify(content.home),
      }).toString();

      const req = new Request("http://localhost:3000/admin/home", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
          Cookie: cookie,
        },
        body,
      });

      const response = await adminHomeAction(makeActionArgs(req));
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.conflict).toBe(true);
      expect(json.error).toContain("Conflit de révision");
    });
  });

  describe("admin/studio.tsx", () => {
    it("loader throws redirect to /admin when not authenticated", async () => {
      const req = new Request("http://localhost:3000/admin/studio");
      await expect(adminStudioLoader(makeLoaderArgs(req))).rejects.toSatisfy(
        (res: Response) => res.status === 303 && res.headers.get("Location") === "/admin"
      );
    });

    it("action handles successful update and returns 200 with newRevision", async () => {
      const cookie = await createValidAdminCookie("csrf-studio-1");
      const content = getSiteContent();

      const updatedStudio = {
        ...content.studio,
        hero: {
          ...content.studio.hero,
          title: { fr: "Nouveau Studio FR", en: "New Studio EN" },
        },
      };

      const body = new URLSearchParams({
        csrfToken: "csrf-studio-1",
        revision: content.revision,
        studioData: JSON.stringify(updatedStudio),
      }).toString();

      const req = new Request("http://localhost:3000/admin/studio", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
          Cookie: cookie,
        },
        body,
      });

      const response = await adminStudioAction(makeActionArgs(req));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.newRevision).toMatch(/^[0-9a-f]{32}$/);
    });

    it("action returns 409 conflict when revision does not match on studio", async () => {
      const cookie = await createValidAdminCookie("csrf-studio-2");
      const content = getSiteContent();
      const staleRevision = "00000000000000000000000000000000";

      const body = new URLSearchParams({
        csrfToken: "csrf-studio-2",
        revision: staleRevision,
        studioData: JSON.stringify(content.studio),
      }).toString();

      const req = new Request("http://localhost:3000/admin/studio", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
          Cookie: cookie,
        },
        body,
      });

      const response = await adminStudioAction(makeActionArgs(req));
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.conflict).toBe(true);
    });

    it("returns 405 with Allow: POST header when GET is received on actions", async () => {
      const cookie = await createValidAdminCookie();
      const reqHome = new Request("http://localhost:3000/admin/home", {
        method: "GET",
        headers: { Cookie: cookie },
      });
      const resHome = await adminHomeAction(makeActionArgs(reqHome));
      expect(resHome.status).toBe(405);
      expect(resHome.headers.get("Allow")).toBe("POST");

      const reqStudio = new Request("http://localhost:3000/admin/studio", {
        method: "GET",
        headers: { Cookie: cookie },
      });
      const resStudio = await adminStudioAction(makeActionArgs(reqStudio));
      expect(resStudio.status).toBe(405);
      expect(resStudio.headers.get("Allow")).toBe("POST");
    });

    it("two-editor scenario: A and B start at r1, B saves r2, A receives 409 and resubmitting without resolving does NOT overwrite B", async () => {
      const cookieA = await createValidAdminCookie("csrf-editor-a");
      const cookieB = await createValidAdminCookie("csrf-editor-b");

      const initialContent = getSiteContent();
      const r1 = initialContent.revision;

      // Editor B changes duo title and saves -> creates r2
      const homeB = {
        ...initialContent.home,
        duo: {
          ...initialContent.home.duo,
          title: { fr: "Modif par B", en: "Edit by B" },
        },
      };
      const reqB = new Request("http://localhost:3000/admin/home", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
          Cookie: cookieB,
        },
        body: new URLSearchParams({
          csrfToken: "csrf-editor-b",
          revision: r1,
          homeData: JSON.stringify(homeB),
        }).toString(),
      });
      const resB = await adminHomeAction(makeActionArgs(reqB));
      expect(resB.status).toBe(200);
      const jsonB = await resB.json();
      const r2 = jsonB.newRevision;
      expect(r2).not.toBe(r1);

      // Editor A was working on hero title with stale revision r1
      const homeA = {
        ...initialContent.home,
        hero: {
          ...initialContent.home.hero,
          title: { fr: "Modif par A", en: "Edit by A" },
        },
      };
      const reqA1 = new Request("http://localhost:3000/admin/home", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
          Cookie: cookieA,
        },
        body: new URLSearchParams({
          csrfToken: "csrf-editor-a",
          revision: r1, // stale!
          homeData: JSON.stringify(homeA),
        }).toString(),
      });
      const resA1 = await adminHomeAction(makeActionArgs(reqA1));
      expect(resA1.status).toBe(409);
      const jsonA1 = await resA1.json();
      expect(jsonA1.conflict).toBe(true);
      expect(jsonA1.latestRevision).toBe(r2);

      // Verify B's modifications are intact in storage
      expect(getSiteContent().home.duo.title.fr).toBe("Modif par B");

      // Clicking save again without updating revision STILL yields 409, does NOT overwrite B
      const reqA2 = new Request("http://localhost:3000/admin/home", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
          Cookie: cookieA,
        },
        body: new URLSearchParams({
          csrfToken: "csrf-editor-a",
          revision: r1, // STILL r1
          homeData: JSON.stringify(homeA),
        }).toString(),
      });
      const resA2 = await adminHomeAction(makeActionArgs(reqA2));
      expect(resA2.status).toBe(409);
      expect(getSiteContent().home.duo.title.fr).toBe("Modif par B");

      // Once resolved explicitly to r2, Editor A can merge / apply and save successfully
      const currentOnServer = getSiteContent();
      const mergedHomeA = {
        ...currentOnServer.home,
        hero: {
          ...currentOnServer.home.hero,
          title: { fr: "Modif par A", en: "Edit by A" },
        },
      };
      const reqA3 = new Request("http://localhost:3000/admin/home", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
          Cookie: cookieA,
        },
        body: new URLSearchParams({
          csrfToken: "csrf-editor-a",
          revision: r2, // updated to server's revision
          homeData: JSON.stringify(mergedHomeA),
        }).toString(),
      });
      const resA3 = await adminHomeAction(makeActionArgs(reqA3));
      expect(resA3.status).toBe(200);
      const finalContent = getSiteContent();
      expect(finalContent.home.duo.title.fr).toBe("Modif par B"); // B's work preserved
      expect(finalContent.home.hero.title.fr).toBe("Modif par A"); // A's work applied
    });
  });
});
