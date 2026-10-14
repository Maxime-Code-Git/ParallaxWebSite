// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import {
  detectMimeFromBuffer,
  getAvailableImportFolders,
  analyzeImportFolder,
  startImportJob,
  getImportJobStatus,
  processImportJob,
} from "../app/lib/gallery-import.server";
import {
  getGalleryDb,
  closeGalleryDb,
} from "../app/lib/gallery-db.server";
import { createGallery, getGalleryMediaList } from "../app/lib/gallery.server";

describe("gallery-import.server.ts (Folder Analysis, Magic Bytes, Lease Worker)", () => {
  let tmpDir: string;
  let testDbPath: string;
  let testMediaPath: string;
  let testImportPath: string;
  let testGallery: { id: string; public_id: string };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-import-test-"));
    testDbPath = path.join(tmpDir, "gallery.sqlite");
    testMediaPath = path.join(tmpDir, "gallery-media");
    testImportPath = path.join(tmpDir, "gallery-import");

    fs.mkdirSync(testMediaPath, { recursive: true, mode: 0o700 });
    fs.mkdirSync(testImportPath, { recursive: true, mode: 0o700 });

    process.env.GALLERY_DB_PATH = testDbPath;
    process.env.GALLERY_MEDIA_PATH = testMediaPath;
    process.env.GALLERY_IMPORT_PATH = testImportPath;
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    const { gallery } = createGallery({
      title: "Galerie Import Test",
      clientName: "Client Import",
      projectDate: "2026-06-20",
    });
    testGallery = gallery;
  });

  afterEach(() => {
    closeGalleryDb();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Magic Bytes MIME Detection", () => {
    it("detects JPEG, PNG, WebP, AVIF, MP4, and WebM from magic bytes", () => {
      // JPEG
      expect(detectMimeFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
      // PNG
      expect(detectMimeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe("image/png");
      // WebP
      const webpBuf = Buffer.alloc(16);
      webpBuf.write("RIFF", 0, "ascii");
      webpBuf.write("WEBP", 8, "ascii");
      expect(detectMimeFromBuffer(webpBuf)).toBe("image/webp");
      // WebM
      expect(detectMimeFromBuffer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("video/webm");
      // MP4
      const mp4Buf = Buffer.alloc(16);
      mp4Buf.write("ftyp", 4, "ascii");
      mp4Buf.write("mp42", 8, "ascii");
      expect(detectMimeFromBuffer(mp4Buf)).toBe("video/mp4");
      // AVIF
      const avifBuf = Buffer.alloc(16);
      avifBuf.write("ftyp", 4, "ascii");
      avifBuf.write("avif", 8, "ascii");
      expect(detectMimeFromBuffer(avifBuf)).toBe("image/avif");
    });

    it("rejects fake JPEG (text file masquerading with .jpg name) or unknown formats", () => {
      const textBuf = Buffer.from("This is a plain text file pretending to be an image!");
      expect(detectMimeFromBuffer(textBuf)).toBeNull();

      const shortBuf = Buffer.from([1, 2, 3]);
      expect(detectMimeFromBuffer(shortBuf)).toBeNull();
    });
  });

  describe("Folder Listing and Scanning", () => {
    it("returns available directories and ignores files or symlinks", () => {
      fs.mkdirSync(path.join(testImportPath, "mariage-2026"), { mode: 0o700 });
      fs.mkdirSync(path.join(testImportPath, "shooting-studio"), { mode: 0o700 });
      fs.writeFileSync(path.join(testImportPath, "ignore-me.txt"), "hello");

      // Symlink directory
      const realDir = path.join(tmpDir, "external-dir");
      fs.mkdirSync(realDir, { mode: 0o700 });
      try {
        fs.symlinkSync(realDir, path.join(testImportPath, "symlinked-folder"));
      } catch {
        // Ignored if symlinks not supported
      }

      const folders = getAvailableImportFolders();
      expect(folders).toContain("mariage-2026");
      expect(folders).toContain("shooting-studio");
      expect(folders).not.toContain("ignore-me.txt");
      expect(folders).not.toContain("symlinked-folder");
    });

    it("analyzes folder structure: accepts valid media and rejects corrupted/fake files", async () => {
      const folderName = "client-batch-1";
      const folderPath = path.join(testImportPath, folderName);
      const photosDir = path.join(folderPath, "photos");
      const videosDir = path.join(folderPath, "videos");

      fs.mkdirSync(photosDir, { recursive: true, mode: 0o700 });
      fs.mkdirSync(videosDir, { recursive: true, mode: 0o700 });

      // Create a valid JPEG photo
      await sharp({
        create: {
          width: 400,
          height: 300,
          channels: 3,
          background: { r: 100, g: 150, b: 200 },
        },
      })
        .jpeg()
        .toFile(path.join(photosDir, "photo-01.jpg"));

      // Create a fake JPEG (corrupted / text)
      fs.writeFileSync(path.join(photosDir, "fake-photo.jpg"), "Corrupted fake image content");

      // Create a simulated MP4 video
      const validMp4 = Buffer.alloc(64);
      validMp4.write("ftyp", 4, "ascii");
      validMp4.write("mp42", 8, "ascii");
      fs.writeFileSync(path.join(videosDir, "teaser.mp4"), validMp4);

      const analysis = analyzeImportFolder(folderName);
      expect(analysis.validPhotosCount).toBe(1);
      expect(analysis.validVideosCount).toBe(1);
      expect(analysis.rejectedFiles.length).toBe(1);
      expect(analysis.rejectedFiles[0].file).toBe("photos/fake-photo.jpg");
      expect(analysis.rejectedFiles[0].reason).toContain("Format de fichier non reconnu");
    });
  });

  describe("Job Lifecycle and Atomic Lease Worker", () => {
    it("enforces single active import job per gallery in database", async () => {
      const folderName = "batch-single-job";
      const folderPath = path.join(testImportPath, folderName);
      const photosDir = path.join(folderPath, "photos");
      fs.mkdirSync(photosDir, { recursive: true, mode: 0o700 });

      await sharp({
        create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .jpeg()
        .toFile(path.join(photosDir, "photo-a.jpg"));

      const jobId1 = startImportJob(testGallery.id, folderName);
      expect(jobId1).toBeDefined();

      // Attempting to start a second import job for the same gallery must throw
      expect(() => startImportJob(testGallery.id, folderName)).toThrow("Un import est deja en cours");
    });

    it("processes import job under atomic lease, copies files, deduplicates, and completes", async () => {
      const folderName = "batch-process";
      const folderPath = path.join(testImportPath, folderName);
      const photosDir = path.join(folderPath, "photos");
      fs.mkdirSync(photosDir, { recursive: true, mode: 0o700 });

      // Create two photos: one distinct, and two identical to test deduplication
      const photo1Buf = await sharp({
        create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .jpeg()
        .toBuffer();

      const photo2Buf = await sharp({
        create: { width: 300, height: 200, channels: 3, background: { r: 40, g: 50, b: 60 } },
      })
        .jpeg()
        .toBuffer();

      fs.writeFileSync(path.join(photosDir, "photo-1.jpg"), photo1Buf);
      fs.writeFileSync(path.join(photosDir, "photo-2.jpg"), photo2Buf);
      fs.writeFileSync(path.join(photosDir, "photo-1-duplicate.jpg"), photo1Buf); // duplicate of photo 1

      const jobId = startImportJob(testGallery.id, folderName);

      // Run worker
      await processImportJob(jobId);

      const status = getImportJobStatus(jobId);
      expect(status?.status).toBe("completed");
      expect(status?.progress_current).toBe(status?.progress_total);

      // Verify media imported into database
      const mediaList = getGalleryMediaList(testGallery.id);
      // Duplicate file should be deduplicated: only 2 unique photos in DB!
      expect(mediaList.length).toBe(2);

      // Verify files created on disk in GALLERY_MEDIA_PATH/:galleryId/
      for (const media of mediaList) {
        const filePath = path.join(testMediaPath, testGallery.id, media.id);
        expect(fs.existsSync(filePath)).toBe(true);

        // Verify preview variants created in .previews/:mediaId/
        const previewDir = path.join(testMediaPath, testGallery.id, ".previews", media.id);
        expect(fs.existsSync(path.join(previewDir, "480.webp"))).toBe(true);
        expect(fs.existsSync(path.join(previewDir, "960.webp"))).toBe(true);
        expect(fs.existsSync(path.join(previewDir, "1920.webp"))).toBe(true);
      }
    });

    it("prevents worker from claiming job if active lease belongs to another worker", async () => {
      const folderName = "batch-lease-theft";
      const folderPath = path.join(testImportPath, folderName);
      const photosDir = path.join(folderPath, "photos");
      fs.mkdirSync(photosDir, { recursive: true, mode: 0o700 });

      await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 50, g: 50, b: 50 } },
      })
        .jpeg()
        .toFile(path.join(photosDir, "img.jpg"));

      const jobId = startImportJob(testGallery.id, folderName);
      const db = getGalleryDb();

      // Worker 2 already holds the lease
      const worker1Id = crypto.randomUUID();
      const worker2Id = crypto.randomUUID();

      db.prepare(`
        UPDATE gallery_import_jobs
        SET status = 'importing',
            lease_worker_id = ?,
            lease_token = 'token-2',
            lease_expires_at = ?
        WHERE id = ?
      `).run(worker2Id, Date.now() + 60000, jobId);

      // Worker 1 tries to claim job, but fails to acquire lease and exits without touching worker 2's state
      await processImportJob(jobId, worker1Id);

      const status = db.prepare("SELECT lease_worker_id, lease_token FROM gallery_import_jobs WHERE id = ?").get(jobId) as {
        lease_worker_id: string;
        lease_token: string;
      };
      expect(status.lease_worker_id).toBe(worker2Id);
      expect(status.lease_token).toBe("token-2");
    });

    it("rejects photos exceeding maximum dimension limits (12,000px) and records them in rejection report", async () => {
      const folderName = "batch-oversized";
      const folderPath = path.join(testImportPath, folderName);
      const photosDir = path.join(folderPath, "photos");
      fs.mkdirSync(photosDir, { recursive: true, mode: 0o700 });

      // Valid standard photo
      await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .jpeg()
        .toFile(path.join(photosDir, "valid.jpg"));

      // Oversized dimension photo: 12,500px wide (exceeds 12,000px limit)
      await sharp({
        create: { width: 12500, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .jpeg()
        .toFile(path.join(photosDir, "too-wide.jpg"));

      const jobId = startImportJob(testGallery.id, folderName);
      await processImportJob(jobId);

      const job = getImportJobStatus(jobId);
      expect(job?.status).toBe("completed");
      expect(job?.rejection_report).toContain("Dimensions hors limites");

      // Only valid.jpg is imported into gallery media
      const mediaList = getGalleryMediaList(testGallery.id);
      expect(mediaList.length).toBe(1);
      expect(mediaList[0].original_filename).toBe("valid.jpg");
    });
  });
});
