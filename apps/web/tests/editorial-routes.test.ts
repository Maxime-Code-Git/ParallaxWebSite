import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { loader as rootRedirectLoader } from "../app/routes/root-redirect";
import HomePage, { loader as homeLoader } from "../app/routes/public/home";
import { loader as studioLoader } from "../app/routes/public/studio";
import AdminHomePage, { action as adminHomeAction, loader as adminHomeLoader } from "../app/routes/admin/home";
import { action as adminStudioAction, loader as adminStudioLoader } from "../app/routes/admin/studio";
import { action as adminServicesAction } from "../app/routes/admin/services";
import { getSession, commitSession } from "../app/lib/session.server";
import { computeCredentialVersion } from "../app/lib/auth.server";
import { getSiteContent } from "../app/lib/site-content.server";
import { createDefaultPortfolioContent } from "../app/lib/portfolio-content.server";
import { SERVICE_AREA_MAX_LENGTH, SERVICE_OFFER_COUNT, SERVICE_OFFER_FIELDS, SERVICE_PAGE_FIELDS, SERVICE_PAGE_IDS } from "@parallax/shared";

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
      PORTFOLIO_CONTENT_PATH: path.join(tempDir, "portfolio.json"),
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
    expect(dataFr.home.hero.title.fr).toBe("Studio photo et vidéo à Bruxelles");

    const reqEn = new Request("http://localhost:3000/en");
    const dataEn = await homeLoader(makeLoaderArgs(reqEn));
    expect(dataEn.lang).toBe("en");
    expect(dataEn.home.hero.title.en).toBe("Photo and video studio in Brussels");
  });

  it("accepts a complete service form at its text limits and preserves existing site content", async () => {
    const csrf = "csrf-service-text-limits";
    const cookie = await createValidAdminCookie(csrf);
    const original = getSiteContent();
    const form = new URLSearchParams({ csrfToken: csrf, revision: original.revision });
    const addText = (field: string, maxLength: number) => {
      form.set(`${field}.fr`, "界".repeat(maxLength));
      form.set(`${field}.en`, "語".repeat(maxLength));
    };

    addText("area", SERVICE_AREA_MAX_LENGTH);
    for (const id of SERVICE_PAGE_IDS) {
      for (const [key, length] of Object.entries(SERVICE_PAGE_FIELDS)) {
        addText(`${id}.${key}`, length);
      }
      for (let index = 0; index < SERVICE_OFFER_COUNT; index++) {
        for (const [key, length] of Object.entries(SERVICE_OFFER_FIELDS)) {
          addText(`${id}.offerings.${index}.${key}`, length);
        }
      }
    }

    const save = () => adminServicesAction(makeActionArgs(new Request("http://localhost:3000/admin/services", {
      method: "POST",
      headers: { Origin: "http://localhost:3000", Cookie: cookie },
      body: form,
    })));

    expect((await save()).data).toEqual({ saved: true });
    const updated = getSiteContent();
    expect(updated.home).toEqual(original.home);
    expect(updated.services?.photo.intro.en).toBe("語".repeat(SERVICE_PAGE_FIELDS.intro));
    expect(updated.services?.area.fr).toBe("界".repeat(SERVICE_AREA_MAX_LENGTH));

    expect((await save()).init).toMatchObject({ status: 409 });
    expect(getSiteContent()).toEqual(updated);
  });

  it("renders old activities as portfolio links and preserves a configured YouTube homepage link", async () => {
    const content = getSiteContent();
    content.home.contact.instagramUrl = "https://www.instagram.com/parallax_studio/";
    content.home.contact.youtubeUrl = "https://youtube.com";
    fs.writeFileSync(testContentFile, JSON.stringify(content));

    const Routes = createRoutesStub([{ path: "/fr", Component: HomePage, loader: homeLoader }]);
    render(createElement(Routes, { initialEntries: ["/fr"] }));

    expect(await screen.findByRole("link", { name: "Portrait" })).toHaveAttribute("href", "/fr/projets");
    const socialLinks = screen.getAllByRole("link", { name: "Instagram" });
    expect(socialLinks).toHaveLength(2);
    for (const link of socialLinks) {
      expect(link).toHaveAttribute("href", content.home.contact.instagramUrl);
      expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Instagram" })).toBeVisible();
    const youtubeLinks = screen.getAllByRole("link", { name: "YouTube" });
    expect(youtubeLinks).toHaveLength(2);
    for (const link of youtubeLinks) {
      expect(link).toHaveAttribute("href", "https://youtube.com/");
      expect(link.querySelector("path")).toHaveAttribute("fill", "currentColor");
    }
  });

  it("persists activity destinations and resolves current localized portfolio pages", async () => {
    const portfolio = createDefaultPortfolioContent();
    const project = portfolio.projects[0];
    const category = portfolio.categories[0];
    const coverId = "12345678-abcd-4321-abcd-123456789012";
    project.title = { fr: "Portrait d’artiste", en: "Artist portrait" };
    project.coverImageId = coverId;
    project.status = "published";
    portfolio.media = {
      [coverId]: {
        imageId: coverId,
        ownerType: "project",
        ownerId: project.id,
        mediaSlot: "cover",
        originalFormat: "webp",
        originalWidth: 1200,
        originalHeight: 800,
        variants: [{ name: "640p", width: 640, height: 427, webpSize: 1000, avifSize: 800 }],
        createdAt: 1000,
      },
    };
    const portfolioPath = path.join(tempDir, "portfolio.json");
    fs.writeFileSync(portfolioPath, JSON.stringify(portfolio));

    const cookie = await createValidAdminCookie("csrf-home-activity");
    const adminUrl = "http://localhost:3000/admin/home";
    const adminReq = new Request(adminUrl, { headers: { Cookie: cookie } });
    const adminData = await (await adminHomeLoader(makeLoaderArgs(adminReq))).json();
    expect(adminData.portfolioOptions.categories).toContainEqual({ id: category.id, title: category.title });
    expect(adminData.portfolioOptions.projects.map(({ id }: { id: string }) => id)).toEqual([project.id]);

    const Routes = createRoutesStub([{ path: "/admin/home", Component: AdminHomePage, loader: () => adminData }]);
    const { container } = render(createElement(Routes, { initialEntries: ["/admin/home"] }));
    const photoDestination = await screen.findByRole("combobox", { name: "Destination de l’élément photo 1" });
    const videoDestination = screen.getByRole("combobox", { name: "Destination de l’élément vidéo 1" });
    fireEvent.change(photoDestination, { target: { value: `category:${category.id}` } });
    fireEvent.change(videoDestination, { target: { value: `project:${project.id}` } });
    fireEvent.click(screen.getByRole("tab", { name: "English (EN)" }));
    expect(photoDestination).toHaveValue(`category:${category.id}`);
    expect(videoDestination).toHaveValue(`project:${project.id}`);
    fireEvent.click(screen.getByRole("button", { name: "Descendre élément photo 1" }));

    const homeData = container.querySelector<HTMLInputElement>('input[name="homeData"]')!.value;
    const home = JSON.parse(homeData);
    const { revision } = getSiteContent();
    expect(home.savoirFaire.photoItems[1].destination).toEqual({ kind: "category", id: category.id });
    expect(home.savoirFaire.videoItems[0].destination).toEqual({ kind: "project", id: project.id });
    const request = new Request(adminUrl, {
      method: "POST",
      headers: { Origin: "http://localhost:3000", Cookie: cookie },
      body: new URLSearchParams({ csrfToken: "csrf-home-activity", revision, homeData }),
    });
    expect((await adminHomeAction(makeActionArgs(request))).status).toBe(200);
    expect(getSiteContent().home.savoirFaire).toEqual(home.savoirFaire);

    const fr = await homeLoader(makeLoaderArgs(new Request("http://localhost:3000/fr")));
    const en = await homeLoader(makeLoaderArgs(new Request("http://localhost:3000/en")));
    expect(fr.home.savoirFaire.photoItems[1]).toEqual({ label: "Portrait", href: `/fr/projets/${category.slugFr}` });
    expect(en.home.savoirFaire.videoItems[0].href).toBe(`/en/projects/${category.slugEn}/${project.slugEn}`);

    category.slugEn = "documentary-films";
    project.slugEn = "renamed-project";
    fs.writeFileSync(portfolioPath, JSON.stringify(portfolio));
    const renamed = await homeLoader(makeLoaderArgs(new Request("http://localhost:3000/en")));
    expect(renamed.home.savoirFaire.videoItems[0].href).toBe("/en/projects/documentary-films/renamed-project");

    project.status = "draft";
    fs.writeFileSync(portfolioPath, JSON.stringify(portfolio));
    const unpublished = await homeLoader(makeLoaderArgs(new Request("http://localhost:3000/en")));
    expect(unpublished.home.savoirFaire.videoItems[0].href).toBe("/en/projects");
  });

  it("rejects an external URL supplied as an activity destination", async () => {
    const cookie = await createValidAdminCookie("csrf-home-invalid-destination");
    const content = getSiteContent();
    content.home.savoirFaire.photoItems[0].destination = { kind: "category", id: "https://example.org" };
    const request = new Request("http://localhost:3000/admin/home", {
      method: "POST",
      headers: { Origin: "http://localhost:3000", Cookie: cookie },
      body: new URLSearchParams({
        csrfToken: "csrf-home-invalid-destination",
        revision: content.revision,
        homeData: JSON.stringify(content.home),
      }),
    });
    expect((await adminHomeAction(makeActionArgs(request))).status).toBe(422);
    expect(getSiteContent().revision).toBe(content.revision);
  });

  it("corrects basé only in the French home subtitle and persists it on the next save", async () => {
    const content = getSiteContent();
    content.home.hero.subtitle = {
      fr: "Studio de création visuelle base en Belgique",
      en: "Visual creation studio based in Belgium",
    };
    fs.writeFileSync(testContentFile, JSON.stringify(content));
    const data = await homeLoader(makeLoaderArgs(new Request("http://localhost:3000/fr")));
    expect(data.home.hero.subtitle.fr).toBe("Studio de création visuelle basé en Belgique");
    expect(data.home.hero.subtitle.en).toBe(content.home.hero.subtitle.en);
    expect(getSiteContent().home.hero.subtitle.fr).toBe(content.home.hero.subtitle.fr);
    const cookie = await createValidAdminCookie("csrf-home-accent");
    const response = await adminHomeAction(makeActionArgs(new Request("http://localhost:3000/admin/home", {
      method: "POST",
      headers: { Origin: "http://localhost:3000", Cookie: cookie },
      body: new URLSearchParams({ csrfToken: "csrf-home-accent", revision: content.revision, homeData: JSON.stringify(content.home) }),
    })));
    expect(response.status).toBe(200);
    expect(getSiteContent().home.hero.subtitle.fr).toBe("Studio de création visuelle basé en Belgique");
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
