import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  type PortfolioContent,
  type PortfolioProject,
  type PortfolioMediaItem,
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

function createValidMediaItem(
  id: string,
  ownerType: "section" | "project",
  ownerId: string,
  slot: "cover" | "showreel_cover" | "video_cover" | "gallery"
): PortfolioMediaItem {
  return {
    imageId: id,
    ownerType,
    ownerId,
    mediaSlot: slot,
    originalFormat: "jpeg",
    originalWidth: 1920,
    originalHeight: 1080,
    createdAt: Date.now(),
    variants: [
      { name: "640p", width: 640, height: 360, avifSize: 500, webpSize: 600 },
      { name: "960p", width: 960, height: 540, avifSize: 800, webpSize: 900 },
      { name: "1440p", width: 1440, height: 810, avifSize: 1200, webpSize: 1300 },
      { name: "1920p", width: 1920, height: 1080, avifSize: 1600, webpSize: 1700 },
    ],
  };
}

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

    it("rejects unrecognized root keys in portfolioContentSchema", () => {
      const content = createDefaultPortfolioContent() as unknown as Record<string, unknown>;
      const corrupted = { ...content, unknownKey: "malicious_payload" };
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

    it("rejects media items with non-UUID keys or invalid dimensions", () => {
      const content = createDefaultPortfolioContent();
      content.media["not-a-uuid"] = createValidMediaItem("not-a-uuid", "section", "documentary", "cover");
      expect(portfolioContentSchema.safeParse(content).success).toBe(false);

      const content2 = createDefaultPortfolioContent();
      const uuid = crypto.randomUUID();
      const invalidMedia = createValidMediaItem(uuid, "section", "documentary", "cover");
      invalidMedia.originalWidth = 99999; // Exceeds 12000 limit
      content2.media[uuid] = invalidMedia;
      expect(portfolioContentSchema.safeParse(content2).success).toBe(false);
    });

    it("rejects project referencing a non-existent UUID in coverImageId", () => {
      const content = createDefaultPortfolioContent();
      const projId = crypto.randomUUID();
      content.projects.push({
        id: projId,
        category: "documentary",
        slugFr: "test-projet",
        slugEn: "test-project",
        title: { fr: "Test", en: "Test" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [],
        seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: crypto.randomUUID(), // Does not exist in content.media
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null,
        showcase: false,
        side: "auto",
        order: 0,
        status: "draft",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const res = portfolioContentSchema.safeParse(content);
      expect(res.success).toBe(false);
    });

    it("rejects project referencing an image owned by another project", () => {
      const content = createDefaultPortfolioContent();
      const projId1 = crypto.randomUUID();
      const projId2 = crypto.randomUUID();
      const imageId = crypto.randomUUID();

      // Image owned by projId2
      content.media[imageId] = createValidMediaItem(imageId, "project", projId2, "cover");

      // Referenced by projId1
      content.projects.push({
        id: projId1,
        category: "documentary",
        slugFr: "test-projet",
        slugEn: "test-project",
        title: { fr: "Test", en: "Test" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [],
        seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: imageId,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null,
        showcase: false,
        side: "auto",
        order: 0,
        status: "draft",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const res = portfolioContentSchema.safeParse(content);
      expect(res.success).toBe(false);
    });

    it("rejects publishing an incomplete project (missing cover or missing description)", () => {
      const content = createDefaultPortfolioContent();
      const projId = crypto.randomUUID();

      // Missing coverImageId
      content.projects.push({
        id: projId,
        category: "documentary",
        slugFr: "test-incomplete",
        slugEn: "test-incomplete",
        title: { fr: "Test Incomplet", en: "Incomplete Test" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [{ type: "paragraph", text: { fr: "Desc", en: "Desc" } }],
        seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: null,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null,
        showcase: false,
        side: "auto",
        order: 0,
        status: "published",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(portfolioContentSchema.safeParse(content).success).toBe(false);

      // Now with coverImageId but empty description
      const coverId = crypto.randomUUID();
      content.media[coverId] = createValidMediaItem(coverId, "project", projId, "cover");
      content.projects[0].coverImageId = coverId;
      content.projects[0].description = [];

      expect(portfolioContentSchema.safeParse(content).success).toBe(false);
    });

    it("allows a gallery image of the same project to serve as its coverImageId", () => {
      const content = createDefaultPortfolioContent();
      const projId = crypto.randomUUID();
      const galleryImgId = crypto.randomUUID();

      // Stored as slot 'gallery' on disk
      content.media[galleryImgId] = createValidMediaItem(galleryImgId, "project", projId, "gallery");

      content.projects.push({
        id: projId,
        category: "documentary",
        slugFr: "projet-galerie-couverture",
        slugEn: "gallery-cover-project",
        title: { fr: "Projet Galerie", en: "Gallery Project" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [{ type: "paragraph", text: { fr: "Contenu valide", en: "Valid content" } }],
        seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: galleryImgId, // Gallery image reused as cover!
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [galleryImgId],
        video: null,
        showcase: false,
        side: "auto",
        order: 0,
        status: "published",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      expect(portfolioContentSchema.safeParse(content).success).toBe(true);
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
    it("filters out drafts and archived projects from public loader and never leaks draft media", async () => {
      const { content } = getRawPortfolioContent(testContentPath);

      const pubId = crypto.randomUUID();
      const pubCoverId = crypto.randomUUID();
      content.media[pubCoverId] = createValidMediaItem(pubCoverId, "project", pubId, "cover");

      const publishedProject: PortfolioProject = {
        id: pubId,
        category: "documentary",
        slugFr: "film-publie",
        slugEn: "published-film",
        title: { fr: "Film Publié", en: "Published Film" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [{ type: "paragraph", text: { fr: "Texte FR", en: "Text EN" } }],
        seo: {
          title: { fr: "SEO", en: "SEO" },
          description: { fr: "Desc", en: "Desc" },
        },
        coverImageId: pubCoverId,
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

      const draftId = crypto.randomUUID();
      const draftCoverId = crypto.randomUUID();
      content.media[draftCoverId] = createValidMediaItem(draftCoverId, "project", draftId, "cover");

      const draftProject: PortfolioProject = {
        id: draftId,
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
        coverImageId: draftCoverId,
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

      const archivedId = crypto.randomUUID();
      const archivedCoverId = crypto.randomUUID();
      content.media[archivedCoverId] = createValidMediaItem(archivedCoverId, "project", archivedId, "cover");

      const archivedProject: PortfolioProject = {
        id: archivedId,
        category: "advertising",
        slugFr: "projet-archive",
        slugEn: "archived-project",
        title: { fr: "Projet Archivé", en: "Archived Project" },
        summary: { fr: "Ancien", en: "Old" },
        description: [{ type: "paragraph", text: { fr: "Texte", en: "Text" } }],
        seo: {
          title: { fr: "SEO", en: "SEO" },
          description: { fr: "Desc", en: "Desc" },
        },
        coverImageId: archivedCoverId,
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

      // Verify draft and archive are nowhere in publicProjects
      expect(publicData.publicProjects.some((p) => p.status === "draft")).toBe(false);
      expect(publicData.publicProjects.some((p) => p.archived)).toBe(false);

      // Verify draft media is strictly EXCLUDED from public DTO media
      expect(draftCoverId in publicData.content.media).toBe(false);
      expect(archivedCoverId in publicData.content.media).toBe(false);
      // Published media IS included
      expect(pubCoverId in publicData.content.media).toBe(true);
    });
  });

  describe("Media References & Active Backup Tracking", () => {
    it("collects media referenced across sections, projects, and active physical backups", async () => {
      const { content } = getRawPortfolioContent(testContentPath);
      const imageId1 = crypto.randomUUID();
      const imageId2 = crypto.randomUUID();

      content.media[imageId1] = createValidMediaItem(imageId1, "section", "documentary", "cover");
      content.sections.documentary.coverImageId = imageId1;

      const projId = crypto.randomUUID();
      content.media[imageId2] = createValidMediaItem(imageId2, "project", projId, "cover");

      content.projects.push({
        id: projId,
        category: "documentary",
        slugFr: "film-avec-galerie",
        slugEn: "film-with-gallery",
        title: { fr: "Titre", en: "Title" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [],
        seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: imageId2,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
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
      expect(imageId1 in pruned).toBe(true);
      expect(imageId2 in pruned).toBe(true);

      const { referencedIds, hasUnreadableBackup } = getReferencedPortfolioMediaIds(
        content,
        testContentPath
      );
      expect(hasUnreadableBackup).toBe(false);
      expect(referencedIds.has(imageId1)).toBe(true);
      expect(referencedIds.has(imageId2)).toBe(true);
    });

    it("protects draftVideoCoverImageId from pruning before video URL is configured", () => {
      const content = createDefaultPortfolioContent();
      const projId = crypto.randomUUID();
      const draftCoverId = crypto.randomUUID();

      content.media[draftCoverId] = createValidMediaItem(draftCoverId, "project", projId, "video_cover");

      content.projects.push({
        id: projId,
        category: "documentary",
        slugFr: "projet-draft-video",
        slugEn: "project-draft-video",
        title: { fr: "Titre", en: "Title" },
        summary: { fr: "Résumé", en: "Summary" },
        description: [],
        seo: { title: { fr: "SEO", en: "SEO" }, description: { fr: "Desc", en: "Desc" } },
        coverImageId: null,
        coverAlt: { fr: "Alt", en: "Alt" },
        galleryImageIds: [],
        video: null, // Video URL not yet configured!
        draftVideoCoverImageId: draftCoverId, // Persisted draft cover
        showcase: false,
        side: "auto",
        order: 0,
        status: "draft",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const pruned = prunePortfolioMediaRegistry(content);
      expect(draftCoverId in pruned).toBe(true);

      const { referencedIds } = getReferencedPortfolioMediaIds(content, testContentPath);
      expect(referencedIds.has(draftCoverId)).toBe(true);
    });
  });
});
