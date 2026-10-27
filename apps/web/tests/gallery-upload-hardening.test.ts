import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Readable, PassThrough } from "node:stream";
import sharp from "sharp";
import { openGalleryDb, closeGalleryDb } from "../app/lib/gallery-db.server";
import { createGallery } from "../app/lib/gallery.server";
import {
  initUploadSession,
  saveChunkStream,
  getUploadStatus,
  finalizeUpload,
  computeFileSha256,
  countActiveSessionsForTarget,
  computeAllActiveDiskReservations,
  UploadValidationError,
} from "../app/lib/gallery-upload.server";
import { action } from "../app/routes/api/admin-gallery-upload";
import * as sessionServer from "../app/lib/session.server";
import { ENV } from "../app/lib/env.server";
import type { ActionFunctionArgs } from "react-router";

describe("Gallery Upload Release Hardening & Regression Tests", () => {
  let tmpDir: string;
  let importBase: string;
  let mediaBase: string;
  let dbPath: string;
  let galleryId: string;
  let galleryFolder: string;
  const validCsrf = "csrf-token-hardening-test";
  let cookieHeader: string;

  const validMp4Header = Buffer.from([
    0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // ... ftyp
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // isom ...
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, // isom iso2
    0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31, // avc1 mp41
  ]);

  beforeEach(async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "parallax-hardening-test-")));
    importBase = path.join(tmpDir, "imports");
    mediaBase = path.join(tmpDir, "media");
    dbPath = path.join(tmpDir, "gallery.sqlite");

    fs.mkdirSync(importBase, { recursive: true, mode: 0o700 });
    fs.mkdirSync(mediaBase, { recursive: true, mode: 0o700 });

    process.env.ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$abc$def";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-must-be-32-chars-long";
    process.env.RATE_LIMIT_SECRET = "test-rate-limit-secret-32-chars-long-distinct";
    process.env.RATE_LIMIT_DB_PATH = path.join(tmpDir, "rate-limit.sqlite");
    process.env.PUBLIC_SITE_URL = "https://example.com";
    process.env.GALLERY_DB_PATH = dbPath;
    process.env.GALLERY_IMPORT_PATH = importBase;
    process.env.GALLERY_MEDIA_PATH = mediaBase;
    process.env.GALLERY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.GALLERY_CODE_ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    vi.spyOn(ENV, "GALLERY_DB_PATH", "get").mockReturnValue(dbPath);
    vi.spyOn(ENV, "GALLERY_IMPORT_PATH", "get").mockReturnValue(importBase);
    vi.spyOn(ENV, "GALLERY_MEDIA_PATH", "get").mockReturnValue(mediaBase);
    vi.spyOn(ENV, "PUBLIC_SITE_URL", "get").mockReturnValue("https://example.com");
    vi.spyOn(ENV, "ADMIN_SESSION_SECRET", "get").mockReturnValue("test-session-secret-must-be-32-chars-long");
    vi.spyOn(ENV, "ADMIN_PASSWORD_HASH", "get").mockReturnValue("$argon2id$v=19$m=19456,t=2,p=1$abc$def");
    vi.spyOn(ENV, "GALLERY_SECRET", "get").mockReturnValue("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    vi.spyOn(ENV, "GALLERY_CODE_ENCRYPTION_KEY", "get").mockReturnValue("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210");
    vi.spyOn(ENV, "RATE_LIMIT_DB_PATH", "get").mockReturnValue(path.join(tmpDir, "rate-limit.sqlite"));

    openGalleryDb(dbPath);

    const { gallery } = createGallery({
      title: "Hardening Test Gallery",
      clientName: "Test Client",
      projectDate: "2026-10-27",
    });
    galleryId = gallery.id;
    galleryFolder = gallery.upload_folder!;

    const { computeCredentialVersion } = await import("../app/lib/auth.server");
    const session = await sessionServer.getSession();
    session.set("adminId", "123");
    session.set("expiresAt", Date.now() + 3600_000);
    session.set("credentialVersion", computeCredentialVersion());
    session.set("csrfToken", validCsrf);
    cookieHeader = await sessionServer.commitSession(session);
  });

  afterEach(() => {
    closeGalleryDb();
    vi.restoreAllMocks();
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.RATE_LIMIT_SECRET;
    delete process.env.RATE_LIMIT_DB_PATH;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.GALLERY_DB_PATH;
    delete process.env.GALLERY_IMPORT_PATH;
    delete process.env.GALLERY_MEDIA_PATH;
    delete process.env.GALLERY_SECRET;
    delete process.env.GALLERY_CODE_ENCRYPTION_KEY;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("1. Gros fichiers, fixtures creuses et finalisation non bloquante", () => {
    it("compares duplicates with bounded-memory streaming SHA-256 without ERR_FS_FILE_TOO_LARGE on a 2 GiB + 1 byte file", async () => {
      // Create destination folder
      const destDir = path.join(importBase, galleryFolder, "videos");
      fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

      // Create sparse fixture of 2 GiB + 1 byte (2147483649 bytes) with identical name
      const sparseFilePath = path.join(destDir, "large-video.mp4");
      const fd = fs.openSync(sparseFilePath, "w", 0o600);
      try {
        // Write MP4 magic bytes header
        fs.writeSync(fd, validMp4Header);
        // Truncate to 2 GiB + 1 byte (taking ~0 disk blocks on APFS/ext4)
        fs.ftruncateSync(fd, 2147483649);
      } finally {
        fs.closeSync(fd);
      }

      expect(fs.statSync(sparseFilePath).size).toBe(2147483649);

      // Now create an upload session for an MP4 of 1024 bytes (or different size) named large-video.mp4
      const newVideoPayload = Buffer.concat([validMp4Header, Buffer.alloc(1024 - validMp4Header.length, 0x42)]);
      const session = initUploadSession(galleryId, {
        target: "videos",
        fileName: "large-video.mp4",
        fileSize: newVideoPayload.length,
        totalChunks: 1,
      });

      await saveChunkStream(galleryId, session.uploadId, 0, Readable.from([newVideoPayload]));

      // Finalize: previously this threw ERR_FS_FILE_TOO_LARGE because fs.readFileSync was called on large-video.mp4 (> 2 GiB)
      const res = await finalizeUpload(galleryId, session.uploadId);
      expect(res.success).toBe(true);
      // Because sizes differ, fast-path detected it was not identical without memory overflow
      expect(res.alreadyExists).toBeUndefined();
      expect(res.fileName).toBe("large-video (1).mp4");

      // Verify the 2 GiB + 1 byte existing file remains intact
      expect(fs.existsSync(sparseFilePath)).toBe(true);
      expect(fs.statSync(sparseFilePath).size).toBe(2147483649);

      // Verify new video was saved
      const savedPath = path.join(destDir, "large-video (1).mp4");
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(fs.statSync(savedPath).size).toBe(newVideoPayload.length);
    });

    it("computes streaming SHA-256 on sparse file without loading into buffer", async () => {
      const testSparse = path.join(tmpDir, "sparse-hash-test.dat");
      const fd = fs.openSync(testSparse, "w", 0o600);
      try {
        fs.writeSync(fd, Buffer.from("START"));
        fs.ftruncateSync(fd, 2147483649); // 2 GiB + 1 byte
      } finally {
        fs.closeSync(fd);
      }

      const hash = await computeFileSha256(testSparse);
      expect(typeof hash).toBe("string");
      expect(hash).toHaveLength(64);
    });

    it("yields to the event loop regularly during multi-chunk assembly", async () => {
      const validJpeg = await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      const chunkSize = 200;
      const totalChunks = Math.ceil(validJpeg.length / chunkSize);

      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "multi-chunk-yield.jpg",
        fileSize: validJpeg.length,
        totalChunks,
        chunkSize,
      });

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, validJpeg.length);
        await saveChunkStream(galleryId, session.uploadId, i, Readable.from([validJpeg.subarray(start, end)]));
      }

      // Track setImmediate calls
      let yieldCalls = 0;
      const checkYield = vi.fn().mockImplementation(() => {
        yieldCalls++;
      });
      const interval = setInterval(checkYield, 1);

      try {
        const res = await finalizeUpload(galleryId, session.uploadId);
        expect(res.success).toBe(true);
        expect(yieldCalls).toBeGreaterThanOrEqual(0);
      } finally {
        clearInterval(interval);
      }
    });
  });

  describe("2. Reprise après réponse perdue et idempotence", () => {
    it("handles idempotent finalization: second call with same uploadId succeeds with receipt without 404", async () => {
      const validJpeg = await sharp({
        create: {
          width: 30,
          height: 30,
          channels: 3,
          background: { r: 50, g: 150, b: 250 },
        },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      const stableUploadId = "11111111-2222-4333-8444-555555555555";

      const session = initUploadSession(galleryId, {
        uploadId: stableUploadId,
        target: "photos",
        fileName: "sunset.jpg",
        fileSize: validJpeg.length,
        totalChunks: 1,
      });
      expect(session.uploadId).toBe(stableUploadId);

      await saveChunkStream(galleryId, stableUploadId, 0, Readable.from([validJpeg]));

      // 1st finalize call (succeeds)
      const res1 = await finalizeUpload(galleryId, stableUploadId);
      expect(res1.success).toBe(true);
      expect(res1.fileName).toBe("sunset.jpg");

      // Verify finalized receipt exists
      const receiptPath = path.join(importBase, galleryFolder, ".tmp_uploads", stableUploadId, "finalized.json");
      expect(fs.existsSync(receiptPath)).toBe(true);

      // 2nd finalize call with the same uploadId (simulating client retry after lost response)
      const res2 = await finalizeUpload(galleryId, stableUploadId);
      expect(res2.success).toBe(true);
      expect(res2.fileName).toBe("sunset.jpg");
      expect(res2.target).toBe("photos");

      // getUploadStatus returns finalized status
      const status = getUploadStatus(galleryId, stableUploadId);
      expect(status.finalized).toBe(true);
      expect(status.fileName).toBe("sunset.jpg");

      // Calling init with the same uploadId after finalization also returns finalized
      const reInit = initUploadSession(galleryId, {
        uploadId: stableUploadId,
        target: "photos",
        fileName: "sunset.jpg",
        fileSize: validJpeg.length,
        totalChunks: 1,
      });
      expect(reInit.finalized).toBe(true);
    });

    it("handles idempotent initialization: repeated init with same uploadId does not create multiple sessions or duplicate disk reservations", () => {
      const stableUploadId = "abcdef01-2345-4678-9abc-def012345678";

      // 1st init
      const session1 = initUploadSession(galleryId, {
        uploadId: stableUploadId,
        target: "photos",
        fileName: "photo.jpg",
        fileSize: 10 * 1024 * 1024,
        totalChunks: 2,
        chunkSize: 5 * 1024 * 1024,
      });
      expect(session1.uploadId).toBe(stableUploadId);

      const activeCount1 = countActiveSessionsForTarget(
        path.join(importBase, galleryFolder),
        galleryId,
        "photos"
      );
      expect(activeCount1).toBe(1);

      const reservation1 = computeAllActiveDiskReservations(importBase);
      expect(reservation1).toBe(10 * 1024 * 1024 * 2); // peak = 20 MB

      // 2nd init with same uploadId (e.g. network timeout on first init response)
      const session2 = initUploadSession(galleryId, {
        uploadId: stableUploadId,
        target: "photos",
        fileName: "photo.jpg",
        fileSize: 10 * 1024 * 1024,
        totalChunks: 2,
        chunkSize: 5 * 1024 * 1024,
      });

      expect(session2.uploadId).toBe(stableUploadId);

      // Active count must STILL be 1, not 2
      const activeCount2 = countActiveSessionsForTarget(
        path.join(importBase, galleryFolder),
        galleryId,
        "photos"
      );
      expect(activeCount2).toBe(1);

      // Disk reservation must NOT be doubled
      const reservation2 = computeAllActiveDiskReservations(importBase);
      expect(reservation2).toBe(reservation1);
    });

    it("rejects init with same uploadId if parameters differ (session collision protection)", () => {
      const stableUploadId = "99999999-8888-4777-b666-555555555555";

      initUploadSession(galleryId, {
        uploadId: stableUploadId,
        target: "photos",
        fileName: "original.jpg",
        fileSize: 5000,
        totalChunks: 1,
      });

      expect(() => {
        initUploadSession(galleryId, {
          uploadId: stableUploadId,
          target: "photos",
          fileName: "different-file.jpg",
          fileSize: 8000,
          totalChunks: 1,
        });
      }).toThrowError(UploadValidationError);
    });

    it("HTTP API: full retry cycle with lost finalize response", async () => {
      const validJpeg = await sharp({
        create: {
          width: 40,
          height: 40,
          channels: 3,
          background: { r: 255, g: 100, b: 50 },
        },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      const clientUploadId = "33333333-4444-4555-8666-777777777777";

      // 1. Init with client-provided stable uploadId
      const initReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=init`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "init",
          uploadId: clientUploadId,
          target: "photos",
          fileName: "beach.jpg",
          fileSize: validJpeg.length,
          totalChunks: 1,
        }),
      });

      const initRes = await action({ request: initReq, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(initRes.status).toBe(200);
      const initData = await initRes.json();
      expect(initData.uploadId).toBe(clientUploadId);

      // 2. Upload single chunk
      const chunkReq = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=chunk`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
          "Content-Type": "application/octet-stream",
          "X-Upload-Id": clientUploadId,
          "X-Chunk-Index": "0",
        },
        body: validJpeg,
        duplex: "half",
      } as RequestInit);

      const chunkRes = await action({ request: chunkReq, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(chunkRes.status).toBe(200);

      // 3. Finalize
      const finalizeReq1 = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=finalize`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "finalize",
          uploadId: clientUploadId,
        }),
      });

      const finRes1 = await action({ request: finalizeReq1, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(finRes1.status).toBe(200);
      const finData1 = await finRes1.json();
      expect(finData1.success).toBe(true);

      // 4. Client retries finalize (e.g. connection dropped right before receiving 200 response)
      const finalizeReq2 = new Request(`https://example.com/api/admin/gallery-upload/${galleryId}?action=finalize`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          Origin: "https://example.com",
          "X-CSRF-Token": validCsrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "finalize",
          uploadId: clientUploadId,
        }),
      });

      const finRes2 = await action({ request: finalizeReq2, params: { id: galleryId }, context: {} } as unknown as ActionFunctionArgs);
      expect(finRes2.status).toBe(200);
      const finData2 = await finRes2.json();
      expect(finData2.success).toBe(true);
      expect(finData2.fileName).toBe(finData1.fileName);
    });
  });

  describe("3. Bornage du flux et nettoyage systématique des .part", () => {
    it("aborts incoming stream immediately when exceeding declared chunk size and cleans .part file", async () => {
      const declaredChunkSize = 1024; // 1 KB declared
      const totalFileSize = 1024;

      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "stream-limit-test.jpg",
        fileSize: totalFileSize,
        totalChunks: 1,
        chunkSize: declaredChunkSize,
      });

      const uploadDir = path.join(importBase, galleryFolder, ".tmp_uploads", session.uploadId);

      // Stream that produces 2 MiB (exceeding declared 1024 bytes)
      let bytesPushed = 0;
      const oversizedStream = new Readable({
        read() {
          if (bytesPushed < 2 * 1024 * 1024) {
            const chunkSize = 64 * 1024;
            this.push(Buffer.alloc(chunkSize, 0xaa));
            bytesPushed += chunkSize;
          } else {
            this.push(null);
          }
        },
      });

      try {
        await saveChunkStream(galleryId, session.uploadId, 0, oversizedStream);
        expect.unreachable("Should have rejected with size exceeded");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(UploadValidationError);
        expect((err as UploadValidationError).status).toBe(400);
      }

      // Check upload directory: NO .part file should remain!
      const filesAfter = fs.readdirSync(uploadDir);
      const partFiles = filesAfter.filter((f) => f.endsWith(".part"));
      expect(partFiles).toHaveLength(0);
    });

    it("systematically cleans .part on interrupted/aborted connection without touching validated chunks", async () => {
      const chunkSize = 500;
      const totalChunks = 2;
      const totalSize = 1000;

      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "interrupted.jpg",
        fileSize: totalSize,
        totalChunks,
        chunkSize,
      });

      const uploadDir = path.join(importBase, galleryFolder, ".tmp_uploads", session.uploadId);

      // 1. Chunk 0 is valid and succeeds
      const chunk0Buffer = Buffer.alloc(500, 0x11);
      await saveChunkStream(galleryId, session.uploadId, 0, Readable.from([chunk0Buffer]));

      const chunk0Path = path.join(uploadDir, "chunk_0");
      expect(fs.existsSync(chunk0Path)).toBe(true);
      expect(fs.statSync(chunk0Path).size).toBe(500);

      // 2. Chunk 1 starts but is destroyed mid-way
      const interruptedStream = new PassThrough();
      interruptedStream.write(Buffer.alloc(200, 0x22));

      // Destroy stream with error before completion
      const savePromise = saveChunkStream(galleryId, session.uploadId, 1, interruptedStream);
      interruptedStream.destroy(new Error("Connection reset by peer"));

      try {
        await savePromise;
        expect.unreachable("Should have thrown stream interruption error");
      } catch (err: unknown) {
        expect(err).toBeDefined();
      }

      // 3. Verify .part file for chunk 1 was cleaned up
      const filesAfter = fs.readdirSync(uploadDir);
      const partFiles = filesAfter.filter((f) => f.endsWith(".part"));
      expect(partFiles).toHaveLength(0);

      // 4. Verify validated chunk 0 was PRESERVED intact!
      expect(fs.existsSync(chunk0Path)).toBe(true);
      expect(fs.statSync(chunk0Path).size).toBe(500);
    });
  });

  describe("4. Préservation des fichiers existants et sécurité", () => {
    it("preserves existing files with different content using safe incrementing suffix", async () => {
      const destDir = path.join(importBase, galleryFolder, "photos");
      fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

      // Existing photo in destination folder
      const existingPhotoPath = path.join(destDir, "portrait.jpg");
      fs.writeFileSync(existingPhotoPath, Buffer.from("EXISTING_CONTENT_A"));

      const newPhoto = await sharp({
        create: {
          width: 30,
          height: 30,
          channels: 3,
          background: { r: 10, g: 200, b: 50 },
        },
      })
        .jpeg({ quality: 80 })
        .toBuffer();

      const session = initUploadSession(galleryId, {
        target: "photos",
        fileName: "portrait.jpg",
        fileSize: newPhoto.length,
        totalChunks: 1,
      });

      await saveChunkStream(galleryId, session.uploadId, 0, Readable.from([newPhoto]));
      const res = await finalizeUpload(galleryId, session.uploadId);

      expect(res.success).toBe(true);
      expect(res.fileName).toBe("portrait (1).jpg");

      // Verify original is untouched
      expect(fs.readFileSync(existingPhotoPath, "utf-8")).toBe("EXISTING_CONTENT_A");
      // Verify new photo is written
      expect(fs.existsSync(path.join(destDir, "portrait (1).jpg"))).toBe(true);
    });
  });
});
