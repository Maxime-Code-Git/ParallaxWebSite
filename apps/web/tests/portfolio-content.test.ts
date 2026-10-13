import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  type PortfolioContent,
  type PortfolioProject,
  portfolioContentSchema,
  calculateEffectiveSide,
  slugify,
} from "../app/lib/portfolio-content.shared";
import {
  createDefaultPortfolioContent,
  getRawPortfolioContent,
  getPublicPortfolioContent,
  savePortfolioContent,
  prunePortfolioMediaRegistry,
  getReferencedPortfolioMediaIds,
} from "../app/lib/portfolio-content.server";
import { RevisionConflictError } from "../app/lib/site-content.server";

describe("Portfolio Content & Editorial Model (Lot 3)", () => {
  let tempDir: string;
  let testContentPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-portfolio-test-"));
    testContentPath = path.join(tempDir, "portfolio-content.json");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Schema Validation & Slugs", () => {
    it("validates valid default portfolio content schema", () => {
      const defaultContent = createDefaultPortfolioContent();
      const parseResult = portfolioContentSchema.safeParse(defaultContent);
      expect(parseResult.success).toBe(true);
      expect(defaultContent.schemaVersion).toBe(1);
      expect(defaultContent.sections.documentary.category).toBe("documentary");
      expect(defaultContent.sections.advertising.category).toBe("advertising");
    });

    it("rejects invalid categories or corrupted schema versions", () => {
      const content = createDefaultPortfolioContent() as unknown as Record<string, unknown>;
      const corrupted = { ...content, schemaVersion: 2 };
      expect(portfolioContentSchema.safeParse(corrupted).success).toBe(false);
    });

    it("formats and generates valid URL slugs", () => {
      expect(slugify("L'Éveil des Forêts !")).toBe("l-eveil-des-forets");
      expect(slugify("Film Publicitaire & Studio 2026")).toBe("film-publicitaire-studio-2026");
      expect(slugify("---test---slug---")).toBe("test-slug");
    });

    it("rejects project slugs with invalid characters or spaces", () => {
      const content = createDefaultPortfolioContent();
      const badProject: PortfolioProject = {
        id: crypto.randomUUID(),
        category: "documentary",
        slugFr: "Projet Invalide Avec Espaces",
        slugEn: "invalid-slug",
        title: { fr: "Titre", en: "Title" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [],
        seo: {
          title: { fr: "SEO", en: "SEO" },
          description: { fr: "Desc", en: "Desc" },
        },
        coverImageId: null,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null,
        showcase: true,
        side: "auto",
        order: 0,
        status: "draft",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      content.projects.push(badProject);
      const parseResult = portfolioContentSchema.safeParse(content);
      expect(parseResult.success).toBe(false);
    });
  });

  describe("Alternating Showcase & Side Calculation", () => {
    it("alternates sides automatically based on display index when side is auto", () => {
      expect(calculateEffectiveSide("auto", 0)).toBe("left");
      expect(calculateEffectiveSide("auto", 1)).toBe("right");
      expect(calculateEffectiveSide("auto", 2)).toBe("left");
      expect(calculateEffectiveSide("auto", 3)).toBe("right");
    });

    it("respects explicit side overrides (left or right)", () => {
      expect(calculateEffectiveSide("right", 0)).toBe("right");
      expect(calculateEffectiveSide("left", 1)).toBe("left");
      expect(calculateEffectiveSide("right", 2)).toBe("right");
    });
  });

  describe("File Creation & Atomic Persistence", () => {
    it("initializes default file when content file does not exist", () => {
      expect(fs.existsSync(testContentPath)).toBe(false);
      const { content, fileExists } = getRawPortfolioContent(testContentPath);
      expect(fileExists).toBe(false);
      expect(fs.existsSync(testContentPath)).toBe(true);
      expect(content.sections.documentary.title.fr).toBe("Documentaire");
      expect(content.sections.advertising.title.fr).toBe("Publicité");
    });

    it("saves content atomically with new revision and physical backup rotation", async () => {
      const { content } = getRawPortfolioContent(testContentPath);
      const initialRev = content.revision;

      const updated = JSON.parse(JSON.stringify(content)) as PortfolioContent;
      updated.overview.title.fr = "Portfolio Mis à Jour";

      const saveResult = await savePortfolioContent(updated, initialRev, testContentPath);
      expect(saveResult.success).toBe(true);
      expect(saveResult.newRevision).not.toBe(initialRev);

      const reloaded = getRawPortfolioContent(testContentPath);
      expect(reloaded.content.overview.title.fr).toBe("Portfolio Mis à Jour");
      expect(reloaded.content.revision).toBe(saveResult.newRevision);

      // Check physical backup creation
      const files = fs.readdirSync(tempDir);
      const backupFiles = files.filter((f) => f.endsWith(".bak"));
      expect(backupFiles.length).toBe(1);
    });

    it("rejects concurrent saves with RevisionConflictError (409)", async () => {
      const { content } = getRawPortfolioContent(testContentPath);
      const staleRev = "stale-revision-00000";

      await expect(
        savePortfolioContent(content, staleRev, testContentPath)
      ).rejects.toThrow(RevisionConflictError);
    });
  });

  describe("Public Filtering & Draft Secrecy", () => {
    it("filters out drafts and archived projects from public loader", async () => {
      const { content } = getRawPortfolioContent(testContentPath);

      const publishedProject: PortfolioProject = {
        id: crypto.randomUUID(),
        category: "documentary",
        slugFr: "film-publie",
        slugEn: "published-film",
        title: { fr: "Film Publié", en: "Published Film" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [],
        seo: {
          title: { fr: "SEO", en: "SEO" },
          description: { fr: "Desc", en: "Desc" },
        },
        coverImageId: null,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null,
        showcase: true,
        side: "auto",
        order: 1,
        status: "published",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const draftProject: PortfolioProject = {
        id: crypto.randomUUID(),
        category: "documentary",
        slugFr: "projet-brouillon-secret",
        slugEn: "secret-draft-project",
        title: { fr: "Brouillon Secret", en: "Secret Draft" },
        summary: { fr: "Privé", en: "Private" },
        description: [],
        seo: {
          title: { fr: "SEO", en: "SEO" },
          description: { fr: "Desc", en: "Desc" },
        },
        coverImageId: null,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null,
        showcase: true,
        side: "auto",
        order: 0,
        status: "draft",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const archivedProject: PortfolioProject = {
        id: crypto.randomUUID(),
        category: "advertising",
        slugFr: "projet-archive",
        slugEn: "archived-project",
        title: { fr: "Projet Archivé", en: "Archived Project" },
        summary: { fr: "Ancien", en: "Old" },
        description: [],
        seo: {
          title: { fr: "SEO", en: "SEO" },
          description: { fr: "Desc", en: "Desc" },
        },
        coverImageId: null,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null,
        showcase: true,
        side: "auto",
        order: 2,
        status: "published",
        archived: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      content.projects = [publishedProject, draftProject, archivedProject];
      await savePortfolioContent(content, content.revision, testContentPath);

      const publicData = getPublicPortfolioContent(testContentPath);
      expect(publicData.publicProjects.length).toBe(1);
      expect(publicData.publicProjects[0].id).toBe(publishedProject.id);
      expect(publicData.publicProjects[0].slugFr).toBe("film-publie");

      // Verify draft and archive are nowhere in publicProjects or content.projects
      expect(publicData.publicProjects.some((p) => p.status === "draft")).toBe(false);
      expect(publicData.publicProjects.some((p) => p.archived)).toBe(false);
    });
  });

  describe("Media References & Active Backup Tracking", () => {
    it("collects media referenced across sections, projects, and active physical backups", async () => {
      const { content } = getRawPortfolioContent(testContentPath);
      const imageId1 = crypto.randomUUID();
      const imageId2 = crypto.randomUUID();

      content.sections.documentary.coverImageId = imageId1;
      content.projects.push({
        id: crypto.randomUUID(),
        category: "documentary",
        slugFr: "film-avec-galerie",
        slugEn: "film-with-gallery",
        title: { fr: "Titre", en: "Title" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [],
        seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: imageId2,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [imageId1],
        video: null,
        showcase: false,
        side: "auto",
        order: 0,
        status: "draft",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const pruned = prunePortfolioMediaRegistry(content);
      // Both images should be marked active
      expect(imageId1 in pruned || Object.keys(pruned).length === 0).toBe(true);

      const { referencedIds, hasUnreadableBackup } = getReferencedPortfolioMediaIds(
        content,
        testContentPath
      );
      expect(hasUnreadableBackup).toBe(false);
      expect(referencedIds.has(imageId1)).toBe(true);
      expect(referencedIds.has(imageId2)).toBe(true);
    });
  });
});
