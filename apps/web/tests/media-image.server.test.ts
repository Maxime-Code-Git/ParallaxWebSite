import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import {
  validateImageFile,
  processSiteMediaImage,
  ConcurrencyLimiter,
  SafeImageError,
  cleanupMediaDirectory,
  getReferencedMediaIds,
} from "../app/lib/media-image.server";
import { getSiteContent } from "../app/lib/site-content.server";
import type { SiteContent } from "../app/lib/site-content.shared";

describe("media-image.server", () => {
  let tempDir: string;
  let mediaDir: string;
  let workDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-media-test-"));
    mediaDir = path.join(tempDir, "site-media");
    workDir = path.join(tempDir, "work");
    fs.mkdirSync(mediaDir, { mode: 0o700, recursive: true });
    fs.mkdirSync(workDir, { mode: 0o700, recursive: true });

    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SITE_CONTENT_PATH: path.join(tempDir, "site-content.json"),
      SITE_MEDIA_PATH: mediaDir,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function createTestImage(
    format: "jpeg" | "png" | "webp",
    width: number,
    height: number,
    filePath: string
  ): Promise<void> {
    const pipeline = sharp({
      create: { width, height, channels: 3, background: { r: 120, g: 140, b: 160 } },
    });
    let buffer: Buffer;
    if (format === "jpeg") {
      buffer = await pipeline.jpeg({ quality: 80 }).toBuffer();
    } else if (format === "png") {
      buffer = await pipeline.png().toBuffer();
    } else {
      buffer = await pipeline.webp().toBuffer();
    }
    fs.writeFileSync(filePath, buffer, { mode: 0o600 });
  }

  describe("validateImageFile", () => {
    it("accepts a valid JPEG file", async () => {
      const filePath = path.join(workDir, "sample.jpg");
      await createTestImage("jpeg", 800, 600, filePath);

      const result = await validateImageFile(filePath, workDir);
      expect(result.format).toBe("jpeg");
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it("accepts a valid PNG file", async () => {
      const filePath = path.join(workDir, "sample.png");
      await createTestImage("png", 400, 300, filePath);

      const result = await validateImageFile(filePath, workDir);
      expect(result.format).toBe("png");
      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
    });

    it("accepts a valid WebP file", async () => {
      const filePath = path.join(workDir, "sample.webp");
      await createTestImage("webp", 1200, 800, filePath);

      const result = await validateImageFile(filePath, workDir);
      expect(result.format).toBe("webp");
      expect(result.width).toBe(1200);
      expect(result.height).toBe(800);
    });

    it("rejects fake image with mismatching magic bytes", async () => {
      const filePath = path.join(workDir, "fake.jpg");
      fs.writeFileSync(filePath, "Not a real JPEG, just ascii text content");

      await expect(validateImageFile(filePath, workDir)).rejects.toThrow(
        /Format d'image non supporté/
      );
    });

    it("rejects path traversal outside allowed temp dir", async () => {
      const outsidePath = path.join(tempDir, "outside.jpg");
      await createTestImage("jpeg", 100, 100, outsidePath);

      await expect(validateImageFile(outsidePath, workDir)).rejects.toThrow(
        /Validation du chemin de fichier échouée/
      );
    });

    it("rejects image exceeding maximum dimensions (> 12000px)", async () => {
      const filePath = path.join(workDir, "huge-dim.jpg");
      await createTestImage("jpeg", 100, 100, filePath);

      vi.spyOn(sharp.prototype, "metadata").mockResolvedValueOnce({
        format: "jpeg",
        width: 12500,
        height: 1000,
      } as never);

      await expect(validateImageFile(filePath, workDir)).rejects.toThrow(
        /Les dimensions de l'image dépassent la limite de 12 000 pixels/
      );
    });

    it("rejects image exceeding 80 megapixels", async () => {
      const filePath = path.join(workDir, "huge-mp.jpg");
      await createTestImage("jpeg", 100, 100, filePath);

      vi.spyOn(sharp.prototype, "metadata").mockResolvedValueOnce({
        format: "jpeg",
        width: 10000,
        height: 9000, // 90 MP
      } as never);

      await expect(validateImageFile(filePath, workDir)).rejects.toThrow(
        /La résolution de l'image dépasse la limite de 80 millions de pixels/
      );
    });

    it("rejects animated or multipage image", async () => {
      const filePath = path.join(workDir, "animated.webp");
      await createTestImage("webp", 100, 100, filePath);

      vi.spyOn(sharp.prototype, "metadata").mockResolvedValueOnce({
        format: "webp",
        width: 100,
        height: 100,
        pages: 5,
      } as never);

      await expect(validateImageFile(filePath, workDir)).rejects.toThrow(
        /Les images animées ou multi-pages ne sont pas autorisées/
      );
    });
  });

  describe("ConcurrencyLimiter", () => {
    it("allows up to 2 concurrent tasks and rejects the 3rd with 503", async () => {
      const limiter = new ConcurrencyLimiter(2);
      let resolveTask1: () => void;
      let resolveTask2: () => void;

      const p1 = limiter.run(
        () =>
          new Promise<string>((resolve) => {
            resolveTask1 = () => resolve("task1");
          })
      );
      const p2 = limiter.run(
        () =>
          new Promise<string>((resolve) => {
            resolveTask2 = () => resolve("task2");
          })
      );

      // 3rd concurrent task should be rejected immediately
      await expect(limiter.run(async () => "task3")).rejects.toThrow(SafeImageError);

      resolveTask1!();
      resolveTask2!();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("task1");
      expect(r2).toBe("task2");

      // Now a new task can run
      const r3 = await limiter.run(async () => "task3-after");
      expect(r3).toBe("task3-after");
    });
  });

  describe("processSiteMediaImage", () => {
    it("generates WebP and AVIF variants with strict permissions and atomic write", async () => {
      const sourcePath = path.join(workDir, "portrait.jpg");
      await createTestImage("jpeg", 2000, 1200, sourcePath);

      const meta = await processSiteMediaImage(
        sourcePath,
        workDir,
        "portrait_ludovic",
        mediaDir
      );

      expect(meta.location).toBe("portrait_ludovic");
      expect(meta.originalWidth).toBe(2000);
      expect(meta.originalHeight).toBe(1200);
      expect(meta.imageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Variants check: 4 breakpoints (640p, 960p, 1440p, 1920p)
      expect(meta.variants).toHaveLength(4);
      const v640 = meta.variants.find((v) => v.name === "640p")!;
      const v960 = meta.variants.find((v) => v.name === "960p")!;
      const v1440 = meta.variants.find((v) => v.name === "1440p")!;
      const v1920 = meta.variants.find((v) => v.name === "1920p")!;

      expect(v640).toBeDefined();
      expect(v960).toBeDefined();
      expect(v1440).toBeDefined();
      expect(v1920).toBeDefined();

      expect(v640.width).toBe(640);
      expect(v960.width).toBe(960);
      expect(v1440.width).toBe(1440);
      expect(v1920.width).toBe(1920);

      // Verify files exist in mediaDir/site/portrait_ludovic/<imageId>/<variant>
      const destDir = path.join(mediaDir, "site", "portrait_ludovic", meta.imageId);
      expect(fs.existsSync(destDir)).toBe(true);

      const webp640 = path.join(destDir, "640p", `${meta.imageId}-640p.webp`);
      const avif640 = path.join(destDir, "640p", `${meta.imageId}-640p.avif`);
      expect(fs.existsSync(webp640)).toBe(true);
      expect(fs.existsSync(avif640)).toBe(true);

      // Verify permissions: files 0600
      const stat640 = fs.statSync(webp640);
      expect(stat640.mode & 0o777).toBe(0o600);
    });
  });

  describe("media cleanup and reference tracking", () => {
    it("correctly identifies referenced media IDs from content", () => {
      const baseContent = getSiteContent();
      const mockContent: SiteContent = {
        ...baseContent,
        home: {
          ...baseContent.home,
          showreel: {
            ...baseContent.home.showreel,
            coverImageId: "11111111-1111-4111-8111-111111111111",
          },
          duo: {
            ...baseContent.home.duo,
            imageId: "22222222-2222-4222-8222-222222222222",
          },
        },
        studio: {
          ...baseContent.studio,
          team: {
            ...baseContent.studio.team,
            members: [
              {
                ...baseContent.studio.team.members[0],
                imageId: "33333333-3333-4333-8333-333333333333",
              },
              {
                ...baseContent.studio.team.members[1],
                imageId: "44444444-4444-4444-8444-444444444444",
              },
            ],
          },
        },
      };

      const ids = getReferencedMediaIds(mockContent);
      expect(ids.has("11111111-1111-4111-8111-111111111111")).toBe(true);
      expect(ids.has("22222222-2222-4222-8222-222222222222")).toBe(true);
      expect(ids.has("33333333-3333-4333-8333-333333333333")).toBe(true);
      expect(ids.has("44444444-4444-4444-8444-444444444444")).toBe(true);
      expect(ids.size).toBe(4);
    });

    it("cleans up media directory", () => {
      const dummyId = "55555555-5555-4555-8555-555555555555";
      const targetDir = path.join(mediaDir, dummyId);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, "file.webp"), "content");

      expect(fs.existsSync(targetDir)).toBe(true);
      cleanupMediaDirectory(targetDir);
      expect(fs.existsSync(targetDir)).toBe(false);
    });
  });
});
