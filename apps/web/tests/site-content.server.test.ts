import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  getSiteContent,
  saveHomeContent,
  saveStudioContent,
  validateSiteContent,
  validateHomeContent,
  validateStudioContent,
  RevisionConflictError,
  ValidationError,
  type AllowedImageId,
  ensureSiteContentFileInitialized,
} from "../app/lib/site-content.server";

describe("site-content.server", () => {
  let tempDir: string;
  let testContentFile: string;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-site-content-test-"));
    testContentFile = path.join(tempDir, "site-content.json");
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SITE_CONTENT_PATH: testContentFile,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("initializes default file when file does not exist", () => {
    expect(fs.existsSync(testContentFile)).toBe(false);
    const content = getSiteContent();
    expect(content.schemaVersion).toBe(2);
    expect(content.common.brandName).toBe("Parallax");
    expect(fs.existsSync(testContentFile)).toBe(true);
  });

  it("never overwrites existing file content on subsequent calls", () => {
    ensureSiteContentFileInitialized();
    const initialRaw = JSON.parse(fs.readFileSync(testContentFile, "utf-8"));
    initialRaw.common.brandName = "Custom Parallax Name";
    fs.writeFileSync(testContentFile, JSON.stringify(initialRaw));

    const content = getSiteContent();
    expect(content.common.brandName).toBe("Custom Parallax Name");
  });

  it("saves home content and updates revision atomically", () => {
    const initial = getSiteContent();
    const modifiedHome = {
      ...initial.home,
      hero: {
        ...initial.home.hero,
        title: {
          fr: "Photo & vidéo modifiée.",
          en: "Modified photo & video.",
        },
      },
    };

    const newRevision = saveHomeContent(modifiedHome, initial.revision);
    expect(newRevision).toMatch(/^[0-9a-f]{32}$/);
    expect(newRevision).not.toBe(initial.revision);

    const reloaded = getSiteContent();
    expect(reloaded.revision).toBe(newRevision);
    expect(reloaded.home.hero.title.fr).toBe("Photo & vidéo modifiée.");
    expect(reloaded.home.hero.title.en).toBe("Modified photo & video.");
  });

  it("refuses revision conflict when saving home with stale revision (returns RevisionConflictError)", () => {
    const initial = getSiteContent();
    const staleRevision = "11111111111111111111111111111111";

    expect(() => saveHomeContent(initial.home, staleRevision)).toThrow(RevisionConflictError);
  });

  it("saves studio content and updates revision atomically", () => {
    const initial = getSiteContent();
    const modifiedStudio = {
      ...initial.studio,
      hero: {
        ...initial.studio.hero,
        title: {
          fr: "Le Studio Parallax",
          en: "The Parallax Studio",
        },
      },
    };

    const newRevision = saveStudioContent(modifiedStudio, initial.revision);
    expect(newRevision).toMatch(/^[0-9a-f]{32}$/);

    const reloaded = getSiteContent();
    expect(reloaded.revision).toBe(newRevision);
    expect(reloaded.studio.hero.title.fr).toBe("Le Studio Parallax");
  });

  it("refuses revision conflict when saving studio with stale revision", () => {
    const initial = getSiteContent();
    const staleRevision = "00000000000000000000000000000000";

    expect(() => saveStudioContent(initial.studio, staleRevision)).toThrow(RevisionConflictError);
  });

  it("rejects unauthorized image identifiers in home and studio to prevent arbitrary paths", () => {
    const initial = getSiteContent();

    const maliciousHome = {
      ...initial.home,
      duo: {
        ...initial.home.duo,
        imageId: "/etc/passwd" as unknown as AllowedImageId,
      },
    };
    expect(() => validateHomeContent(maliciousHome)).toThrow(ValidationError);

    const maliciousStudio = {
      ...initial.studio,
      team: {
        ...initial.studio.team,
        members: [
          {
            ...initial.studio.team.members[0],
            imageId: "../../../secret.jpg" as unknown as AllowedImageId,
          },
        ],
      },
    };
    expect(() => validateStudioContent(maliciousStudio)).toThrow(ValidationError);
  });

  it("rejects unknown properties in objects", () => {
    const initial = getSiteContent();
    const modified = {
      ...initial,
      unknownProperty: "malicious",
    };
    expect(() => validateSiteContent(modified)).toThrow(ValidationError);
  });

  it("strictly rejects relative SITE_CONTENT_PATH when calling getSiteContentFilePath without creating files", () => {
    const relativeTarget = "data/site-content.json";
    process.env.SITE_CONTENT_PATH = relativeTarget;

    expect(() => getSiteContent()).toThrow(/CRITICAL:.*doit etre un chemin absolu/);
    expect(fs.existsSync(path.resolve(process.cwd(), relativeTarget))).toBe(false);
  });

  it("strictly rejects in-repo SITE_CONTENT_PATH when calling getSiteContentFilePath", () => {
    process.env.NODE_ENV = "production";
    const inRepoPath = path.resolve(__dirname, "../site-content.json");
    process.env.SITE_CONTENT_PATH = inRepoPath;

    expect(() => getSiteContent()).toThrow(/CRITICAL:.*ne doit pas se trouver dans le depot/);
    expect(fs.existsSync(inRepoPath)).toBe(false);
  });
});
