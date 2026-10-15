import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getRawSiteContent,
  getSiteContent,
  migrateSiteContentV2ToV3,
} from "../app/lib/site-content.server";
import type { SiteContentV1, SiteContentV2 } from "../app/lib/site-content.shared";

describe("Lot 7 - Schema V3 Migration & Content Integrity", () => {
  let tempDir: string;
  let testContentFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-lot7-migration-"));
    testContentFile = path.join(tempDir, "site-content.json");
    process.env.SITE_CONTENT_PATH = testContentFile;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("pure migration V2 -> V3 preserves all V2 data and initial values without mutating input", () => {
    const initial = getSiteContent();
    const v2Mock: SiteContentV2 = {
      schemaVersion: 2,
      revision: "rev-v2-test",
      updatedAt: "2026-03-01T12:00:00Z",
      common: {
        ...initial.common,
        brandName: "Parallax Test Studio",
      },
      home: {
        ...initial.home,
        contact: {
          ...initial.home.contact,
          email: "custom-v2@parallax.be",
          instagramUrl: "https://instagram.com/parallax_v2",
          youtubeUrl: "https://youtube.com/@parallax_v2",
        },
      },
      studio: initial.studio,
      contactPage: {
        ...initial.contactPage,
        card: {
          ...initial.contactPage.card,
          phone: "+32 470 11 22 33",
        },
      },
      media: {
        "index-showreel": {
          imageId: "index-showreel",
          location: "showreel_cover",
          originalWidth: 1920,
          originalHeight: 1080,
          variants: [],
          createdAt: "2026-03-01T12:00:00Z",
        },
      },
    };

    const cloneBefore = structuredClone(v2Mock);
    const v3 = migrateSiteContentV2ToV3(v2Mock);

    // Ensure input fixture was NOT mutated
    expect(v2Mock).toEqual(cloneBefore);

    // Verify V3 structure
    expect(v3.schemaVersion).toBe(3);
    expect(v3.revision).toBe(v2Mock.revision);
    expect(v3.common.brandName).toBe("Parallax Test Studio");
    expect(v3.home.contact.email).toBe("custom-v2@parallax.be");
    expect(v3.contactPage.card.phone).toBe("+32 470 11 22 33");
    expect(v3.media!["index-showreel"]).toBeDefined();

    // Verify new company structure is initialized with synced canonical coordinates
    expect(v3.company).toBeDefined();
    expect(v3.company.tradeName).toBe("Parallax Test Studio");
    expect(v3.company.email).toBe("custom-v2@parallax.be");
    expect(v3.company.phone).toBe("+32 470 11 22 33");
    expect(v3.company.instagramUrl).toBe("https://instagram.com/parallax_v2");
    expect(v3.company.youtubeUrl).toBe("https://youtube.com/@parallax_v2");

    // Verify legal pages drafts are initialized
    expect(v3.legalPages).toBeDefined();
    expect(v3.legalPages.mentions.draft).toBeDefined();
    expect(v3.legalPages.privacy.draft).toBeDefined();
    expect(v3.legalPages.terms.draft).toBeDefined();
    expect(v3.legalPages.cookies.draft).toBeDefined();
    expect(v3.legalPages.cookies.draft.inventory?.length).toBeGreaterThan(0);
  });

  it("migrates V1 -> V2 -> V3 sequentially and persists automatically on disk", () => {
    const initial = getSiteContent();
    const v1Content: SiteContentV1 = {
      schemaVersion: 1,
      revision: "0123456789abcdef0123456789abcdef",
      updatedAt: "2026-02-01T10:00:00Z",
      common: {
        ...initial.common,
        brandName: "Parallax Original",
      },
      home: {
        ...initial.home,
        contact: {
          ...initial.home.contact,
          email: "v1@parallax.be",
        },
      },
      studio: initial.studio,
      media: initial.media || {},
    };

    fs.writeFileSync(testContentFile, JSON.stringify(v1Content), "utf-8");

    const { content, isCorrupted } = getRawSiteContent();
    expect(isCorrupted).toBe(false);
    expect(content.schemaVersion).toBe(3);
    expect(content.common.brandName).toBe("Parallax Original");
    expect(content.contactPage).toBeDefined();
    expect(content.company.email).toBe("v1@parallax.be");
    expect(content.legalPages.mentions.draft).toBeDefined();

    // Verify file on disk was upgraded to V3
    const diskContent = JSON.parse(fs.readFileSync(testContentFile, "utf-8"));
    expect(diskContent.schemaVersion).toBe(3);
    expect(diskContent.company).toBeDefined();
    expect(diskContent.legalPages).toBeDefined();
  });

  it("reopening an already migrated V3 file is idempotent and does not mutate it", () => {
    const initialContent = getSiteContent();
    expect(initialContent.schemaVersion).toBe(3);

    const fileContent1 = fs.readFileSync(testContentFile, "utf-8");
    const contentReopened = getSiteContent();
    const fileContent2 = fs.readFileSync(testContentFile, "utf-8");

    expect(contentReopened.revision).toBe(initialContent.revision);
    expect(fileContent1).toBe(fileContent2);
  });
});
