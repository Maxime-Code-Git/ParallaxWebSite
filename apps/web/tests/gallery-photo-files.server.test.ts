import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { ENV } from "../app/lib/env.server";
import { closeGalleryDb, getGalleryDb } from "../app/lib/gallery-db.server";
import { ensureGalleryImportFolder } from "../app/lib/gallery-folder.server";
import { processImportJob, startImportJob } from "../app/lib/gallery-import.server";
import { listGalleryPhotoFiles, permanentlyDeleteGalleryPhoto } from "../app/lib/gallery-photo-files.server";
import { createGallery, deleteGalleryPhoto, getGalleryById, getGalleryMediaList } from "../app/lib/gallery.server";

describe("Gallery photo disk inventory and permanent deletion", () => {
  let root: string;
  let galleryId: string;
  let photos: string;
  let folder: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-photo-files-"));
    for (const name of ["imports", "media"]) fs.mkdirSync(path.join(root, name));
    vi.spyOn(ENV, "GALLERY_DB_PATH", "get").mockReturnValue(path.join(root, "gallery.sqlite"));
    vi.spyOn(ENV, "GALLERY_IMPORT_PATH", "get").mockReturnValue(path.join(root, "imports"));
    vi.spyOn(ENV, "GALLERY_MEDIA_PATH", "get").mockReturnValue(path.join(root, "media"));
    vi.spyOn(ENV, "GALLERY_SECRET", "get").mockReturnValue("01".repeat(32));
    vi.spyOn(ENV, "GALLERY_CODE_ENCRYPTION_KEY", "get").mockReturnValue("02".repeat(32));
    galleryId = createGallery({ title: "Photos", clientName: "Client", projectDate: "2026-11-20" }).gallery.id;
    const directory = ensureGalleryImportFolder(galleryId);
    photos = directory.photosPath;
    folder = directory.folderName;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeGalleryDb();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function writePhoto(name = "photo.jpg", color = "red") {
    const bytes = await sharp({ create: { width: 100, height: 160, channels: 3, background: color } }).jpeg().toBuffer();
    fs.writeFileSync(path.join(photos, name), bytes);
    return crypto.createHash("sha256").update(bytes).digest("hex");
  }

  async function importPhotos() {
    const job = startImportJob(galleryId, folder);
    await processImportJob(job);
    return job;
  }

  async function purge(hash: string) {
    const file = (await listGalleryPhotoFiles(galleryId)).find((item) => item.hash === hash)!;
    return permanentlyDeleteGalleryPhoto(galleryId, hash, file.version, getGalleryById(galleryId)!.revision);
  }

  it("keeps a removed photo hidden across subsequent imports, then allows reupload after permanent deletion", async () => {
    const hash = await writePhoto();
    const originalBytes = fs.readFileSync(path.join(photos, "photo.jpg"));
    await importPhotos();
    const media = getGalleryMediaList(galleryId)[0];
    deleteGalleryPhoto(galleryId, media.id, getGalleryById(galleryId)!.revision);
    expect((await listGalleryPhotoFiles(galleryId))[0].status).toBe("removed");
    closeGalleryDb();
    await importPhotos();
    expect(getGalleryMediaList(galleryId)).toHaveLength(0);
    expect(fs.existsSync(path.join(photos, "photo.jpg"))).toBe(true);

    await purge(hash);
    expect(await listGalleryPhotoFiles(galleryId)).toEqual([]);
    expect(fs.existsSync(path.join(photos, "photo.jpg"))).toBe(false);
    fs.writeFileSync(path.join(photos, "photo.jpg"), originalBytes);
    await importPhotos();
    expect(getGalleryMediaList(galleryId)[0].content_hash).toBe(hash);
  });

  it("deletes every source alias, the imported original and previews, while preserving another gallery", async () => {
    const hash = await writePhoto();
    fs.copyFileSync(path.join(photos, "photo.jpg"), path.join(photos, "duplicate.jpg"));
    await importPhotos();
    const media = getGalleryMediaList(galleryId)[0];
    const other = createGallery({ title: "Other", clientName: "Other", projectDate: "2026-11-20" }).gallery;
    const otherDir = ensureGalleryImportFolder(other.id);
    fs.copyFileSync(path.join(photos, "photo.jpg"), path.join(otherDir.photosPath, "photo.jpg"));
    await processImportJob(startImportJob(other.id, otherDir.folderName));
    getGalleryDb().prepare("UPDATE galleries SET status = 'published', cover_media_id = ? WHERE id = ?").run(media.id, galleryId);
    const item = (await listGalleryPhotoFiles(galleryId))[0];
    expect(item.status).toBe("displayed");
    expect(item.sources).toHaveLength(2);
    expect((await purge(hash)).unpublishNotice).toBe(true);
    expect(fs.readdirSync(photos)).toEqual([]);
    expect(fs.existsSync(path.join(root, "media", galleryId, media.id))).toBe(false);
    expect(fs.existsSync(path.join(root, "media", galleryId, ".previews", media.id))).toBe(false);
    expect(getGalleryById(galleryId)).toMatchObject({ status: "draft", cover_media_id: null });
    expect(getGalleryMediaList(other.id)).toHaveLength(1);
    expect(fs.existsSync(path.join(otherDir.photosPath, "photo.jpg"))).toBe(true);
    expect(() => startImportJob(galleryId, folder)).toThrow("ne contient aucun fichier");
    expect(getGalleryMediaList(galleryId)).toHaveLength(0);
  });

  it("reassigns the cover and handles imported photos whose source was already deleted", async () => {
    const hash = await writePhoto();
    await writePhoto("second.jpg", "blue");
    await importPhotos();
    const media = getGalleryMediaList(galleryId).find((item) => item.content_hash === hash)!;
    getGalleryDb().prepare("UPDATE galleries SET status = 'published', cover_media_id = ? WHERE id = ?").run(media.id, galleryId);
    fs.unlinkSync(path.join(photos, "photo.jpg"));
    expect((await listGalleryPhotoFiles(galleryId)).find((item) => item.hash === hash)?.sources).toHaveLength(0);
    expect((await purge(hash)).unpublishNotice).toBe(false);
    expect(getGalleryMediaList(galleryId)).toHaveLength(1);
    expect(getGalleryById(galleryId)?.cover_media_id).toBe(getGalleryMediaList(galleryId)[0].id);
    expect(getGalleryById(galleryId)?.status).toBe("published");
  });

  it("lists legacy folders and untouched unimported files and refreshes its content cache after replacement", async () => {
    const hash = await writePhoto();
    const legacy = path.join(root, "imports", "legacy", "photos");
    fs.mkdirSync(legacy, { recursive: true });
    fs.renameSync(path.join(photos, "photo.jpg"), path.join(legacy, "photo.jpg"));
    getGalleryDb().prepare(`INSERT INTO gallery_import_jobs (id, gallery_id, import_folder, status, created_at, updated_at)
      VALUES (?, ?, 'legacy', 'completed', ?, ?)`).run(crypto.randomUUID(), galleryId, Date.now(), Date.now());
    const listed = await listGalleryPhotoFiles(galleryId);
    expect(listed[0]).toMatchObject({ hash, status: "unimported", sources: [{ folder: "legacy", name: "photo.jpg" }] });
    const stream = vi.spyOn(fs, "createReadStream");
    await listGalleryPhotoFiles(galleryId);
    expect(stream).not.toHaveBeenCalled();
    fs.writeFileSync(path.join(legacy, "photo.jpg"), "replacement");
    expect((await listGalleryPhotoFiles(galleryId))[0].hash).not.toBe(hash);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale confirmation and a confirmation copied from another gallery", async () => {
    await writePhoto();
    const item = (await listGalleryPhotoFiles(galleryId))[0];
    const revision = getGalleryById(galleryId)!.revision;
    const other = createGallery({ title: "Other", clientName: "Other", projectDate: "2026-11-20" }).gallery;
    fs.copyFileSync(path.join(photos, "photo.jpg"), path.join(ensureGalleryImportFolder(other.id).photosPath, "photo.jpg"));
    await expect(permanentlyDeleteGalleryPhoto(other.id, item.hash, item.version, other.revision)).rejects.toMatchObject({ status: 409 });
    await writePhoto("photo.jpg", "blue");
    await expect(permanentlyDeleteGalleryPhoto(galleryId, item.hash, item.version, revision)).rejects.toMatchObject({ status: 404 });
    expect(fs.existsSync(path.join(photos, "photo.jpg"))).toBe(true);
  });

  it("refuses deletion during an import and in a shared import folder", async () => {
    const hash = await writePhoto();
    const job = startImportJob(galleryId, folder);
    await expect(purge(hash)).rejects.toMatchObject({ status: 409 });
    getGalleryDb().prepare("UPDATE gallery_import_jobs SET status = 'completed' WHERE id = ?").run(job);
    const other = createGallery({ title: "Other", clientName: "Other", projectDate: "2026-11-20" }).gallery;
    getGalleryDb().prepare(`INSERT INTO gallery_import_jobs (id, gallery_id, import_folder, status, created_at, updated_at)
      VALUES (?, ?, ?, 'completed', ?, ?)`).run(crypto.randomUUID(), other.id, folder, Date.now(), Date.now());
    await expect(purge(hash)).rejects.toMatchObject({ status: 409 });
    expect(fs.existsSync(path.join(photos, "photo.jpg"))).toBe(true);
  });

  it("recovers a partially completed disk deletion after a database reopen", async () => {
    const hash = await writePhoto();
    fs.copyFileSync(path.join(photos, "photo.jpg"), path.join(photos, "duplicate.jpg"));
    await importPhotos();
    const unlink = fs.unlinkSync;
    const failure = vi.spyOn(fs, "unlinkSync").mockImplementation((filename) => {
      if (filename === path.join(photos, "photo.jpg")) throw new Error("Disk temporarily unavailable");
      unlink(filename);
    });
    await expect(purge(hash)).rejects.toThrow("Suppression incomplète");
    expect(fs.existsSync(path.join(photos, "duplicate.jpg"))).toBe(false);
    failure.mockRestore();
    closeGalleryDb();
    expect((await listGalleryPhotoFiles(galleryId))[0].status).toBe("deleting");
    expect(() => startImportJob(galleryId, folder)).toThrow("Terminez la suppression définitive");
    await writePhoto("photo.jpg", "blue");
    await purge(hash);
    const remaining = await listGalleryPhotoFiles(galleryId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].hash).not.toBe(hash);
    expect(fs.existsSync(path.join(photos, "photo.jpg"))).toBe(true);
    expect(getGalleryMediaList(galleryId)).toEqual([]);
  });

  it("never follows a symlink substituted for a photos directory", async () => {
    const hash = await writePhoto();
    const outside = path.join(root, "outside");
    fs.renameSync(photos, outside);
    fs.symlinkSync(outside, photos);
    await expect(listGalleryPhotoFiles(galleryId)).rejects.toThrow(/symbolique/);
    await expect(permanentlyDeleteGalleryPhoto(galleryId, hash, "a".repeat(64), 1)).rejects.toThrow(/symbolique/);
    expect(fs.existsSync(path.join(outside, "photo.jpg"))).toBe(true);
  });
});
