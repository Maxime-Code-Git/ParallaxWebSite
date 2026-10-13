import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  saveHomeContent,
  saveSiteMediaUpdate,
  saveSiteMediaRevert,
  getRawSiteContent,
  ValidationError,
} from "../app/lib/site-content.server";
import {
  cleanupUnreferencedMedia,
  getReferencedMediaIds,
} from "../app/lib/media-image.server";
import { getBackups, atomicWriteJson } from "../app/lib/atomic-fs.server";
import type { UploadedMediaMetadata, SiteContent } from "../app/lib/site-content.shared";

describe("Bounded Retention & Real Backups (atomic-fs)", () => {
  let tempDir: string;
  let contentFile: string;
  let mediaDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-retention-test-"));
    contentFile = path.join(tempDir, "site-content.json");
    mediaDir = path.join(tempDir, "site-media");
    fs.mkdirSync(mediaDir, { mode: 0o700, recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SITE_CONTENT_PATH: contentFile,
      SITE_MEDIA_PATH: mediaDir,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function createMockMedia(
    imageId: string,
    location: "showreel_cover" | "duo" | "portrait_ludovic" | "portrait_maxime"
  ): UploadedMediaMetadata {
    return {
      imageId,
      location,
      originalWidth: 1920,
      originalHeight: 1080,
      variants: [
        {
          name: "640p",
          width: 640,
          height: 360,
          sizeBytesWebp: 100,
          sizeBytesAvif: 90,
          fileId: `${imageId}-640p`,
        },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  function createVariantFilesOnDisk(imageId: string, location: string): void {
    const variantDir = path.join(mediaDir, "site", location, imageId, "640p");
    fs.mkdirSync(variantDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(variantDir, `${imageId}-640p.webp`), "sample-webp-bytes", { mode: 0o600 });
    fs.writeFileSync(path.join(variantDir, `${imageId}-640p.avif`), "sample-avif-bytes", { mode: 0o600 });
  }

  describe("Form submission consistency validation", () => {
    it("rejects an invented UUID that does not exist in content.media registry", () => {
      const { content } = getRawSiteContent();
      const fakeUuid = "99999999-9999-4999-8999-999999999999";

      const modifiedHome = {
        ...content.home,
        showreel: {
          ...content.home.showreel,
          coverImageId: fakeUuid,
        },
      };

      expect(() => {
        saveHomeContent(modifiedHome, content.revision);
      }).toThrow(ValidationError);
    });

    it("rejects an image UUID with inconsistent location (e.g. duo image on showreel)", () => {
      const { content } = getRawSiteContent();
      const duoUuid = "11111111-1111-4111-8111-111111111111";
      const duoMedia = createMockMedia(duoUuid, "duo");

      saveSiteMediaUpdate("duo", duoMedia, content.revision);
      const { content: updatedContent } = getRawSiteContent();

      // Attempt to assign the duo UUID to showreel_cover in home form
      const maliciousHome = {
        ...updatedContent.home,
        showreel: {
          ...updatedContent.home.showreel,
          coverImageId: duoUuid,
        },
      };

      expect(() => {
        saveHomeContent(maliciousHome, updatedContent.revision);
      }).toThrow(ValidationError);
    });

    it("accepts known UUID with consistent location and valid variants", () => {
      const { content } = getRawSiteContent();
      const showreelUuid = "22222222-2222-4222-8222-222222222222";
      const showreelMedia = createMockMedia(showreelUuid, "showreel_cover");

      saveSiteMediaUpdate("showreel_cover", showreelMedia, content.revision);
      const { content: afterUpload } = getRawSiteContent();

      const validHome = {
        ...afterUpload.home,
        showreel: {
          ...afterUpload.home.showreel,
          title: { fr: "Nouveau titre", en: "New title" },
          coverImageId: showreelUuid,
        },
      };

      const newRev = saveHomeContent(validHome, afterUpload.revision);
      expect(newRev).toMatch(/^[0-9a-f]{32}$/);

      const saved = getRawSiteContent().content;
      expect(saved.home.showreel.coverImageId).toBe(showreelUuid);
      expect(saved.media?.[showreelUuid]).toBeDefined();
    });
  });

  describe("Registry pruning and bounded retention with real backups", () => {
    it("prunes obsolete media metadata on replacement and revert", () => {
      const { content: initial } = getRawSiteContent();
      const img1 = "aaaaaaaa-1111-4111-8111-111111111111";
      const img2 = "bbbbbbbb-2222-4222-8222-222222222222";

      saveSiteMediaUpdate("showreel_cover", createMockMedia(img1, "showreel_cover"), initial.revision);
      const { content: withImg1 } = getRawSiteContent();
      expect(withImg1.media?.[img1]).toBeDefined();

      saveSiteMediaUpdate("showreel_cover", createMockMedia(img2, "showreel_cover"), withImg1.revision);
      const { content: withImg2 } = getRawSiteContent();

      // Current registry should ONLY retain img2, not img1
      expect(withImg2.home.showreel.coverImageId).toBe(img2);
      expect(withImg2.media?.[img2]).toBeDefined();
      expect(withImg2.media?.[img1]).toBeUndefined();

      // Revert to reference image
      saveSiteMediaRevert("showreel_cover", withImg2.revision);
      const { content: reverted } = getRawSiteContent();
      expect(reverted.home.showreel.coverImageId).toBe("index-showreel");
      expect(reverted.media?.[img2]).toBeUndefined();
    });

    it("preserves images in the 5 real backups and purges images beyond the 5 backups", () => {
      const { content: initial } = getRawSiteContent();
      let currentRev = initial.revision;
      const images: string[] = [];

      // Create 7 successive image updates.
      // Each atomic write creates a real .bak file, and rotateBackups retains 5.
      for (let i = 0; i < 7; i++) {
        const id = `${i}0000000-0000-4000-8000-000000000000`;
        images.push(id);
        createVariantFilesOnDisk(id, "showreel_cover");

        const updateResult = saveSiteMediaUpdate(
          "showreel_cover",
          createMockMedia(id, "showreel_cover"),
          currentRev
        );
        currentRev = updateResult.newRevision;
      }

      // Check real backups generated by atomic-fs
      const backups = getBackups(contentFile);
      expect(backups.length).toBeLessThanOrEqual(5);

      const { content: latestContent } = getRawSiteContent();
      expect(latestContent.home.showreel.coverImageId).toBe(images[6]); // Active is img[6]

      // Run cleanup
      cleanupUnreferencedMedia(latestContent, mediaDir, contentFile);

      // images[6] is active -> preserved
      expect(fs.existsSync(path.join(mediaDir, "site", "showreel_cover", images[6]))).toBe(true);

      // images in the top 5 backups must be preserved
      const referencedIds = getReferencedMediaIds(latestContent, contentFile);
      for (let i = 0; i < 7; i++) {
        const imgPath = path.join(mediaDir, "site", "showreel_cover", images[i]);
        if (referencedIds.has(images[i])) {
          expect(fs.existsSync(imgPath)).toBe(true);
        } else {
          // The oldest image(s) rotated out of the top 5 backups must be purged!
          expect(fs.existsSync(imgPath)).toBe(false);
        }
      }

      // The earliest images (images[0], images[1]) rotated out must be purged
      expect(fs.existsSync(path.join(mediaDir, "site", "showreel_cover", images[0]))).toBe(false);
    });

    it("defers cleanup without purging any files if a retained backup is corrupted", () => {
      const { content: initial } = getRawSiteContent();
      const img1 = "12121212-1212-4212-8212-121212121212";
      const img2 = "34343434-3434-4434-8434-343434343434";

      createVariantFilesOnDisk(img1, "duo");
      createVariantFilesOnDisk(img2, "duo");

      const res1 = saveSiteMediaUpdate("duo", createMockMedia(img1, "duo"), initial.revision);
      saveSiteMediaUpdate("duo", createMockMedia(img2, "duo"), res1.newRevision);

      // Corrupt the newest backup file
      const backups = getBackups(contentFile);
      expect(backups.length).toBeGreaterThan(0);
      const newestBak = path.join(tempDir, backups[0]);
      fs.writeFileSync(newestBak, "MALFORMED_JSON_CORRUPTED{{{");

      const { content: currentContent } = getRawSiteContent();
      const cleanupResult = cleanupUnreferencedMedia(currentContent, mediaDir, contentFile);

      // Cleanup should be deferred
      expect(cleanupResult.deferred).toBe(true);
      expect(cleanupResult.cleaned).toHaveLength(0);

      // img1 was replaced by img2, but because the backup was corrupted,
      // img1 MUST NOT be purged!
      expect(fs.existsSync(path.join(mediaDir, "site", "duo", img1))).toBe(true);
    });

    it("allows restoring an old backup and retains its variant availability", () => {
      const { content: initial } = getRawSiteContent();
      const oldImg = "77777777-7777-4777-8777-777777777777";
      const newImg = "88888888-8888-4888-8888-888888888888";

      createVariantFilesOnDisk(oldImg, "duo");
      createVariantFilesOnDisk(newImg, "duo");

      const res1 = saveSiteMediaUpdate("duo", createMockMedia(oldImg, "duo"), initial.revision);
      saveSiteMediaUpdate("duo", createMockMedia(newImg, "duo"), res1.newRevision);

      // Clean up after newImg upload
      const { content: withNewImg } = getRawSiteContent();
      cleanupUnreferencedMedia(withNewImg, mediaDir, contentFile);

      // oldImg is in backup -> still preserved
      expect(fs.existsSync(path.join(mediaDir, "site", "duo", oldImg))).toBe(true);

      // Restore old backup by loading its content snapshot
      const backups = getBackups(contentFile);
      const oldBackupPath = path.join(tempDir, backups[0]);
      const oldSnapshot = JSON.parse(fs.readFileSync(oldBackupPath, "utf-8")) as SiteContent;

      // Overwrite active content with restored snapshot
      atomicWriteJson(contentFile, oldSnapshot);

      const restored = getRawSiteContent().content;
      expect(restored.home.duo.imageId).toBe(oldImg);

      // The restored image variants are fully available on disk
      const webpFile = path.join(mediaDir, "site", "duo", oldImg, "640p", `${oldImg}-640p.webp`);
      expect(fs.existsSync(webpFile)).toBe(true);
    });
  });
});
