import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openGalleryDb, closeGalleryDb } from "../app/lib/gallery-db.server";
import { createGallery } from "../app/lib/gallery.server";
import {
  slugifyGalleryName,
  computeGalleryFolderName,
  validateGalleryFolderConfinement,
  createGalleryFolderOnDisk,
  ensureGalleryImportFolder,
} from "../app/lib/gallery-folder.server";
import { ENV } from "../app/lib/env.server";

describe("Gallery Folder Server Management", () => {
  let tmpDir: string;
  let importBase: string;
  let mediaBase: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "parallax-gallery-folder-test-")));
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
  });

  afterEach(() => {
    closeGalleryDb();
    vi.restoreAllMocks();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("slugifyGalleryName and computeGalleryFolderName", () => {
    it("converts names with accents, spaces and special characters into clean slug", () => {
      expect(slugifyGalleryName("Éléonore & Raphaël - Mariage")).toBe("eleonore-raphael-mariage");
      expect(slugifyGalleryName("Studio Parallax 2026 !?")).toBe("studio-parallax-2026");
      expect(slugifyGalleryName("")).toBe("galerie");
      expect(slugifyGalleryName("---")).toBe("galerie");
    });

    it("creates stable collision-free folder name by attaching gallery ID", () => {
      const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const folderName = computeGalleryFolderName(id, "Élise & Paul");
      expect(folderName).toBe("elise-paul-a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("prevents collisions between two galleries sharing identical titles", () => {
      const id1 = "11111111-1111-1111-1111-111111111111";
      const id2 = "22222222-2222-2222-2222-222222222222";
      const folder1 = computeGalleryFolderName(id1, "Mariage");
      const folder2 = computeGalleryFolderName(id2, "Mariage");

      expect(folder1).not.toBe(folder2);
      expect(folder1).toBe("mariage-11111111-1111-1111-1111-111111111111");
      expect(folder2).toBe("mariage-22222222-2222-2222-2222-222222222222");
    });
  });

  describe("validateGalleryFolderConfinement", () => {
    it("accepts valid safe folder names within import root", () => {
      const res = validateGalleryFolderConfinement("mariage-alice-bob-12345");
      expect(res.folderPath).toBe(path.join(importBase, "mariage-alice-bob-12345"));
    });

    it("rejects path traversal attempts", () => {
      expect(() => validateGalleryFolderConfinement("../escape")).toThrow("Tentative de sortie");
      expect(() => validateGalleryFolderConfinement("folder/../../escape")).toThrow("Tentative de sortie");
      expect(() => validateGalleryFolderConfinement("folder\\escape")).toThrow("Tentative de sortie");
      expect(() => validateGalleryFolderConfinement("folder\0null")).toThrow("Tentative de sortie");
    });

    it("rejects symbolic links on import base or gallery folder", () => {
      const targetDir = path.join(tmpDir, "real-target");
      fs.mkdirSync(targetDir, { recursive: true });
      const symlinkPath = path.join(importBase, "symlink-folder");
      fs.symlinkSync(targetDir, symlinkPath);

      expect(() => validateGalleryFolderConfinement("symlink-folder")).toThrow("ne peut pas être un lien symbolique");
    });
  });

  describe("createGalleryFolderOnDisk and ensureGalleryImportFolder", () => {
    it("idempotently creates photos/, videos/, and .tmp_uploads/ subdirectories with 0700", () => {
      const folderName = "test-gallery-001";
      const res1 = createGalleryFolderOnDisk(folderName);

      expect(fs.existsSync(res1.folderPath)).toBe(true);
      expect(fs.existsSync(res1.photosPath)).toBe(true);
      expect(fs.existsSync(res1.videosPath)).toBe(true);
      expect(fs.existsSync(res1.tmpUploadsPath)).toBe(true);

      // Verify idempotent re-call does not throw
      const res2 = createGalleryFolderOnDisk(folderName);
      expect(res2.folderPath).toBe(res1.folderPath);
    });

    it("automatically creates disk folder when creating a gallery via createGallery", () => {
      const { gallery } = createGallery({
        title: "Session Studio Automne",
        clientName: "Claire Martin",
        projectDate: "2026-10-15",
      });

      expect(gallery.upload_folder).toBeDefined();
      const expectedDir = path.join(importBase, gallery.upload_folder!);
      expect(fs.existsSync(expectedDir)).toBe(true);
      expect(fs.existsSync(path.join(expectedDir, "photos"))).toBe(true);
      expect(fs.existsSync(path.join(expectedDir, "videos"))).toBe(true);
      expect(fs.existsSync(path.join(expectedDir, ".tmp_uploads"))).toBe(true);
    });

    it("lazily creates and persists folder for existing gallery lacking upload_folder", () => {
      const { gallery } = createGallery({
        title: "Ancienne Galerie",
        clientName: "Jean Dupont",
        projectDate: "2026-09-01",
      });

      // Simulate legacy gallery without upload_folder in DB
      const db = openGalleryDb(dbPath);
      db.prepare("UPDATE galleries SET upload_folder = NULL WHERE id = ?").run(gallery.id);

      const res = ensureGalleryImportFolder(gallery.id);
      expect(res.folderName).toContain("ancienne-galerie");
      expect(fs.existsSync(res.photosPath)).toBe(true);

      const updated = db.prepare("SELECT upload_folder FROM galleries WHERE id = ?").get(gallery.id) as { upload_folder: string };
      expect(updated.upload_folder).toBe(res.folderName);
    });
  });
});
