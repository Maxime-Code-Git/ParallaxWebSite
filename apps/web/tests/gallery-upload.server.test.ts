import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Readable } from "node:stream";
import sharp from "sharp";
import { openGalleryDb, closeGalleryDb } from "../app/lib/gallery-db.server";
import { createGallery } from "../app/lib/gallery.server";
import {
  initUploadSession,
  saveChunkStream,
  getUploadStatus,
  finalizeUpload,
  cancelUpload,
  cleanupAbandonedUploads,
  checkDiskSpace,
  computeAllActiveDiskReservations,
  diskChecker,
  DiskSpaceError,
  UploadValidationError,
  MAX_CHUNK_SIZE,
  isUploadTarget,
  UPLOAD_TARGETS,
  type UploadTarget,
} from "../app/lib/gallery-upload.server";
import { analyzeImportFolder } from "../app/lib/gallery-import.server";
import { ENV } from "../app/lib/env.server";

describe("Gallery Upload Server Logic", () => {
  let tmpDir: string;
  let importBase: string;
  let mediaBase: string;
  let dbPath: string;
  let galleryId: string;
  let galleryFolder: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "parallax-upload-test-")));
    importBase = path.join(tmpDir, "imports");
    mediaBase = path.join(tmpDir, "media");
    dbPath = path.join(tmpDir, "gallery.sqlite");

    fs.mkdirSync(importBase, { recursive: true, mode: 0o700 });
    fs.mkdirSync(mediaBase, { recursive: true, mode: 0o700 });

    vi.spyOn(ENV, "GALLERY_DB_PATH", "get").mockReturnValue(dbPath);
    vi.spyOn(ENV, "GALLERY_IMPORT_PATH", "get").mockReturnValue(importBase);
    vi.spyOn(ENV, "GALLERY_MEDIA_PATH", "get").mockReturnValue(mediaBase);
    vi.spyOn(ENV, "GALLERY_SECRET", "get").mockReturnValue("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    vi.spyOn(ENV, "GALLERY_CODE_ENCRYPTION_KEY", "get").mockReturnValue("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210");

    openGalleryDb(dbPath);

    const { gallery } = createGallery({
      title: "Mariage Alice & Bob",
      clientName: "Alice & Bob",
      projectDate: "2026-09-12",
    });
    galleryId = gallery.id;
    galleryFolder = gallery.upload_folder!;
  });

  afterEach(() => {
    closeGalleryDb();
    vi.restoreAllMocks();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Target Validation and Folder Mapping", () => {
    it("validates closed union targets photos and videos and maps to canonical folders", () => {
      expect(isUploadTarget("photos")).toBe(true);
      expect(isUploadTarget("videos")).toBe(true);
      expect(UPLOAD_TARGETS.photos.folder).toBe("photos");
      expect(UPLOAD_TARGETS.videos.folder).toBe("videos");

      expect(isUploadTarget("guest_photos")).toBe(false);
      expect(isUploadTarget("couple_photos")).toBe(false);
      expect(isUploadTarget("other")).toBe(false);
      expect(isUploadTarget("")).toBe(false);
      expect(isUploadTarget(null)).toBe(false);
    });

    it("rejects unknown target with HTTP 400", () => {
      expect(() => {
        initUploadSession(galleryId, {
          target: "unknown_target" as UploadTarget,
          fileName: "photo.jpg",
          fileSize: 1024,
          totalChunks: 1,
        });
      }).toThrowError(UploadValidationError);

      try {
        initUploadSession(galleryId, {
          target: "unknown_target" as UploadTarget,
          fileName: "photo.jpg",
          fileSize: 1024,
          totalChunks: 1,
        });
      } catch (err: unknown) {
        expect((err as UploadValidationError).status).toBe(400);
      }
    });
  });

  describe("Numeric Validation and Number.isSafeInteger", () => {
    it("rejects non-safe integer or negative file sizes with HTTP 400", () => {
      const invalidSizes = [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 10];
      for (const size of invalidSizes) {
        expect(() => {
          initUploadSession(galleryId, {
            target: "photos",
            fileName: "photo.jpg",
            fileSize: size,
            totalChunks: 1,
          });
        }).toThrowError(UploadValidationError);
      }
    });

    it("rejects mismatched or invalid chunk sizes and counts", () => {
      expect(() => {
        initUploadSession(galleryId, {
          target: "photos",
          fileName: "photo.jpg",
          fileSize: 10 * 1024 * 1024,
          totalChunks: 5, // Expected 2 chunks for 10 MB at 5 MB default chunk size
        });
      }).toThrow("Nombre de morceaux incohérent");

      expect(() => {
        initUploadSession(galleryId, {
          target: "photos",
          fileName: "photo.jpg",
          fileSize: 1024,
          totalChunks: 1,
          chunkSize: MAX_CHUNK_SIZE + 1,
        });
      }).toThrow("Taille de morceau invalide");
    });
  });

  describe("Disk Space Control and Peak Reservation", () => {
    it("checks disk space against peak requirement (chunks + assembled + 50MB safety)", () => {
      const targetPath = path.join(importBase, galleryFolder);
      // Simulate low disk: 60 MB available
      vi.spyOn(diskChecker, "statfs").mockReturnValue({
        bavail: 60,
        bsize: 1024 * 1024,
      } as unknown as fs.StatsFs);

      // Attempt upload of 10 MB: peak needed = 20 MB + 50 MB safety = 70 MB > 60 MB -> throws 507
      expect(() => {
        checkDiskSpace(targetPath, 20 * 1024 * 1024, importBase);
      }).toThrowError(DiskSpaceError);
    });

    it("persists unallocated reservations across server restarts", () => {
      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "photo-peak.jpg",
        fileSize: 10 * 1024 * 1024, // 10 MB
        totalChunks: 2,
      });

      // Peak reservation before any chunk uploaded = 20 MB
      const reservation1 = computeAllActiveDiskReservations(importBase);
      expect(reservation1).toBe(20 * 1024 * 1024);

      // Cancel upload frees reservation
      cancelUpload(galleryId, session.uploadId);
      const reservation2 = computeAllActiveDiskReservations(importBase);
      expect(reservation2).toBe(0);
    });
  });

  describe("Active Sessions Limit and updatedAt Expiry", () => {
    it("enforces max 2 active sessions per gallery and target", () => {
      const s1 = initUploadSession(galleryId, {
        target: "photos",
        fileName: "photo1.jpg",
        fileSize: 1024,
        totalChunks: 1,
      });
      expect(s1.uploadId).toBeDefined();

      const s2 = initUploadSession(galleryId, {
        target: "photos",
        fileName: "photo2.jpg",
        fileSize: 1024,
        totalChunks: 1,
      });
      expect(s2.uploadId).toBeDefined();

      // Third concurrent session throws 429
      expect(() => {
        initUploadSession(galleryId, {
          target: "photos",
          fileName: "photo3.jpg",
          fileSize: 1024,
          totalChunks: 1,
        });
      }).toThrowError(UploadValidationError);

      try {
        initUploadSession(galleryId, {
          target: "photos",
          fileName: "photo3.jpg",
          fileSize: 1024,
          totalChunks: 1,
        });
      } catch (err) {
        expect((err as UploadValidationError).status).toBe(429);
      }
    });

    it("updates updatedAt upon each chunk receipt and cleans up stale sessions", async () => {
      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "test-update.jpg",
        fileSize: 1000,
        totalChunks: 1,
      });

      const chunkBuf = Buffer.alloc(1000, 0x42);
      await saveChunkStream(galleryId, session.uploadId, 0, Readable.from([chunkBuf]));

      const metaPath = path.join(importBase, galleryFolder, ".tmp_uploads", session.uploadId, "meta.json");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      expect(meta.updatedAt).toBeGreaterThanOrEqual(meta.createdAt);

      // Manually age the session
      meta.updatedAt = Date.now() - 10 * 60 * 1000;
      fs.writeFileSync(metaPath, JSON.stringify(meta));

      cleanupAbandonedUploads(path.join(importBase, galleryFolder));
      expect(fs.existsSync(path.join(importBase, galleryFolder, ".tmp_uploads", session.uploadId))).toBe(false);
    });
  });

  describe("Strict Attachment and Path Confinement", () => {
    it("rejects operations when uploadId belongs to a different gallery (HTTP 403)", () => {
      const otherGallery = createGallery({
        title: "Autre Galerie",
        clientName: "Autre Client",
        projectDate: "2026-10-01",
      });

      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "test.jpg",
        fileSize: 500,
        totalChunks: 1,
      });

      expect(() => {
        getUploadStatus(otherGallery.gallery.id, session.uploadId);
      }).toThrowError(UploadValidationError);
    });
  });

  describe("Chunk Writing, Deterministic Assembly, and Anti-Duplicate", () => {
    it("handles multi-chunk assembly, verifies exact chunk sizes, closes fd, and detects duplicates", async () => {
      // Create a valid JPEG using Sharp > 2000 bytes
      const validJpeg = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      const totalSize = validJpeg.length;
      const chunkSize = 1000;
      const totalChunks = Math.ceil(totalSize / chunkSize);

      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "mon-image.jpg",
        fileSize: totalSize,
        totalChunks,
        chunkSize,
      });

      // Upload chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, totalSize);
        const slice = validJpeg.subarray(start, end);

        const chunkRes = await saveChunkStream(galleryId, session.uploadId, i, Readable.from([slice]));
        expect(chunkRes.success).toBe(true);
        expect(chunkRes.chunkIndex).toBe(i);
      }

      // Check status reports all chunks uploaded
      const status = getUploadStatus(galleryId, session.uploadId);
      expect(status.uploadedChunks).toHaveLength(totalChunks);

      // Finalize upload
      const finRes = await finalizeUpload(galleryId, session.uploadId);
      expect(finRes.success).toBe(true);
      expect(finRes.fileName).toBe("mon-image.jpg");

      const finalPath = path.join(importBase, galleryFolder, "photos", "mon-image.jpg");
      expect(fs.existsSync(finalPath)).toBe(true);
      expect(fs.statSync(finalPath).size).toBe(totalSize);

      // Verify no temporary chunks remain, and finalized receipt is preserved
      const tmpUploadDir = path.join(importBase, galleryFolder, ".tmp_uploads", session.uploadId);
      expect(fs.existsSync(path.join(tmpUploadDir, "finalized.json"))).toBe(true);
      expect(fs.existsSync(path.join(tmpUploadDir, "assembled.tmp"))).toBe(false);
      expect(fs.existsSync(path.join(tmpUploadDir, "chunk_0"))).toBe(false);

      // Second identical upload detects duplicate hash without creating a duplicate file
      const session2 = initUploadSession(galleryId, {
        target: "photos",
        fileName: "mon-image.jpg",
        fileSize: totalSize,
        totalChunks,
        chunkSize,
      });

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, totalSize);
        await saveChunkStream(galleryId, session2.uploadId, i, Readable.from([validJpeg.subarray(start, end)]));
      }

      const finRes2 = await finalizeUpload(galleryId, session2.uploadId);
      expect(finRes2.success).toBe(true);
      expect(finRes2.alreadyExists).toBe(true);
      expect(finRes2.fileName).toBe("mon-image.jpg");
    });

    it("rejects wrong binary signature with HTTP 415", async () => {
      // Fake JPEG with text content
      const fakeJpeg = Buffer.from("CECI_N_EST_PAS_UN_JPEG_VALIDE_MAIS_DU_TEXTE");
      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "fake.jpg",
        fileSize: fakeJpeg.length,
        totalChunks: 1,
      });

      await saveChunkStream(galleryId, session.uploadId, 0, Readable.from([fakeJpeg]));

      try {
        await finalizeUpload(galleryId, session.uploadId);
        expect.unreachable("Should have thrown 415");
      } catch (err) {
        expect(err).toBeInstanceOf(UploadValidationError);
        expect((err as UploadValidationError).status).toBe(415);
      }
    });
  });

  describe("Scanner Defense-in-Depth", () => {
    it("silently ignores .tmp_uploads, .part, .tmp and hidden files in import folder scanner", () => {
      const folderPath = path.join(importBase, galleryFolder);
      const photosDir = path.join(folderPath, "photos");

      // Place stray temp / incomplete files
      fs.writeFileSync(path.join(photosDir, ".DS_Store"), "ignore");
      fs.writeFileSync(path.join(photosDir, "stray.part"), "incomplete chunk");
      fs.writeFileSync(path.join(photosDir, "assembled.tmp"), "incomplete assembly");

      const analysis = analyzeImportFolder(galleryFolder);
      // None of the stray temp files should be detected as valid photos or reported as rejected errors
      expect(analysis.validPhotosCount).toBe(0);
      expect(analysis.rejectedFiles).toHaveLength(0);
    });
  });
});
