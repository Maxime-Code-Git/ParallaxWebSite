// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import {
  ensurePreview,
  generateAllPreviews,
  removePreviews,
  getPreviewPath,
} from "../app/lib/gallery-preview.server";
import {
  parseRangeHeader,
  parseWidth,
  parseFormat,
  buildContentDisposition,
} from "../app/lib/media-utils.server";

describe("gallery-media.server.ts & gallery-preview.server.ts (Previews, Range Streaming, Headers)", () => {
  let tmpDir: string;
  let testMediaPath: string;
  let testGalleryId: string;
  let testMediaId: string;
  let originalFilePath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-media-test-"));
    testMediaPath = path.join(tmpDir, "gallery-media");
    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_MEDIA_PATH = testMediaPath;

    testGalleryId = "gal-media-test-1234";
    testMediaId = "med-media-test-5678";

    const galDir = path.join(testMediaPath, testGalleryId);
    fs.mkdirSync(galDir, { recursive: true, mode: 0o700 });

    // Generate a real 800x600 test JPEG with Sharp
    originalFilePath = path.join(galDir, testMediaId);
    await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 50, g: 100, b: 150 },
      },
    })
      .jpeg()
      .toFile(originalFilePath);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("media-utils.server.ts parsing and headers", () => {
    it("validates allowed preview widths strictly (480, 960, 1920) and rejects others", () => {
      expect(parseWidth("480")).toBe(480);
      expect(parseWidth("960")).toBe(960);
      expect(parseWidth("1920")).toBe(1920);
      expect(parseWidth("800")).toBeNull();
      expect(parseWidth("100")).toBeNull();
      expect(parseWidth("invalid")).toBeNull();
      expect(parseWidth(null)).toBeNull();
    });

    it("validates webp preview format strictly and rejects all other formats", () => {
      expect(parseFormat("webp")).toBe("webp");
      expect(parseFormat("WEBP")).toBe("webp");
      expect(parseFormat("jpeg")).toBeNull();
      expect(parseFormat("png")).toBeNull();
      expect(parseFormat(null)).toBeNull();
    });

    it("parses HTTP Range headers according to RFC 7233", () => {
      const totalSize = 1000;

      // Exact range
      expect(parseRangeHeader("bytes=0-499", totalSize)).toEqual({ start: 0, end: 499 });
      expect(parseRangeHeader("bytes=500-999", totalSize)).toEqual({ start: 500, end: 999 });

      // Open ended range
      expect(parseRangeHeader("bytes=500-", totalSize)).toEqual({ start: 500, end: 999 });

      // Suffix range
      expect(parseRangeHeader("bytes=-200", totalSize)).toEqual({ start: 800, end: 999 });

      // Out of bounds / invalid syntax
      expect(parseRangeHeader("bytes=1000-2000", totalSize)).toBeNull();
      expect(parseRangeHeader("bytes=500-200", totalSize)).toBeNull();
      expect(parseRangeHeader("bytes=abc-def", totalSize)).toBeNull();
      expect(parseRangeHeader("bytes=0-100, 200-300", totalSize)).toBeNull(); // multipart rejected
      expect(parseRangeHeader(null, totalSize)).toBeNull();
    });

    it("constructs RFC 6266 / RFC 5987 Content-Disposition header with safe ASCII fallback", () => {
      const header = buildContentDisposition("attachment", "Événement_Mariage 2026.jpg");
      expect(header.startsWith("attachment; filename=")).toBe(true);
      expect(header).toContain("filename*=UTF-8''");
      expect(header).toContain("2026.jpg");

      // Strips directory traversal markers
      const traversalHeader = buildContentDisposition("inline", "../../../etc/passwd");
      expect(traversalHeader).not.toContain("../");
    });
  });

  describe("gallery-preview.server.ts variant generation", () => {
    it("generates 480 WebP preview variant and respects withoutEnlargement", async () => {
      const result480 = await ensurePreview(testGalleryId, testMediaId, originalFilePath, 480);
      expect(result480.path).toBeDefined();
      expect(fs.existsSync(result480.path)).toBe(true);
      expect(result480.width).toBe(480);

      // Verify file is a valid WebP
      const meta480 = await sharp(result480.path).metadata();
      expect(meta480.format).toBe("webp");
      expect(meta480.width).toBe(480);

      // Verify withoutEnlargement: source is 800px wide, requesting 1920px should NOT enlarge to 1920
      const result1920 = await ensurePreview(testGalleryId, testMediaId, originalFilePath, 1920);
      expect(result1920.width).toBe(800);
      const meta1920 = await sharp(result1920.path).metadata();
      expect(meta1920.width).toBe(800);
    });

    it("deduplicates concurrent preview generation requests for the same variant", async () => {
      const [res1, res2] = await Promise.all([
        ensurePreview(testGalleryId, testMediaId, originalFilePath, 960),
        ensurePreview(testGalleryId, testMediaId, originalFilePath, 960),
      ]);

      expect(res1.path).toBe(res2.path);
      expect(res1.width).toBe(res2.width);
      expect(fs.existsSync(res1.path)).toBe(true);
    });

    it("generates all 3 variants and cleans up preview folder", async () => {
      const allVariants = await generateAllPreviews(testGalleryId, testMediaId, originalFilePath);
      expect(allVariants[480]).toBeDefined();
      expect(allVariants[960]).toBeDefined();
      expect(allVariants[1920]).toBeDefined();

      const p480 = getPreviewPath(testGalleryId, testMediaId, 480);
      const p960 = getPreviewPath(testGalleryId, testMediaId, 960);
      const p1920 = getPreviewPath(testGalleryId, testMediaId, 1920);

      expect(fs.existsSync(p480)).toBe(true);
      expect(fs.existsSync(p960)).toBe(true);
      expect(fs.existsSync(p1920)).toBe(true);

      removePreviews(testGalleryId, testMediaId);

      expect(fs.existsSync(p480)).toBe(false);
      expect(fs.existsSync(p960)).toBe(false);
      expect(fs.existsSync(p1920)).toBe(false);
    });
  });
});
