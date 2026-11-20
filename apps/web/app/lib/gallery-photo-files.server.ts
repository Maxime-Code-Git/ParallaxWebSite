import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "./env.server";
import { getGalleryDb } from "./gallery-db.server";
import { ensureGalleryImportFolder } from "./gallery-folder.server";
import { fileVersion, GalleryImportFileError, isSourceName } from "./gallery-import-files.server";
import { deleteStoredGalleryPhotoFiles, isGalleryPhotoPreviewProcessing } from "./gallery-preview.server";
import { deleteGalleryPhoto, getGalleryById, getGalleryMediaList } from "./gallery.server";
import { countActiveSessionsForTarget, hasOngoingGalleryUploadFinalization } from "./gallery-upload.server";
import { verifySecurePathChain } from "./media-image.server";

interface PhotoSource {
  folder: string;
  name: string;
  version: string;
  size: number;
}

interface RemovedPhoto {
  content_hash: string;
  original_filename: string;
  media_id: string | null;
  removed_at: number;
  purge_sources: string | null;
}

export interface GalleryPhotoFile {
  hash: string;
  name: string;
  size: number;
  status: "displayed" | "removed" | "unimported" | "deleting";
  mediaId: string | null;
  sources: PhotoSource[];
  version: string;
}

function getPhotoFolders(galleryId: string): string[] {
  const own = ensureGalleryImportFolder(galleryId).folderName;
  const rows = getGalleryDb().prepare(`
    SELECT DISTINCT import_folder FROM gallery_import_jobs WHERE gallery_id = ?
  `).all(galleryId) as { import_folder: string }[];
  return [...new Set([own, ...rows.map((row) => row.import_folder)])].sort();
}

function getPhotoDirectory(folder: string): string | null {
  // Validate the existing folder before checking for a missing photos subdirectory.
  if (!isSourceName(folder) || folder === "..") throw new GalleryImportFileError("Dossier d’import invalide.", 400);
  const parent = path.join(ENV.GALLERY_IMPORT_PATH, folder);
  if (!fs.lstatSync(parent, { throwIfNoEntry: false })) return null;
  verifySecurePathChain(ENV.GALLERY_IMPORT_PATH, [folder], "directory");
  if (!fs.lstatSync(path.join(parent, "photos"), { throwIfNoEntry: false })) return null;
  return verifySecurePathChain(ENV.GALLERY_IMPORT_PATH, [folder, "photos"], "directory");
}

async function readSourceHash(galleryId: string, source: PhotoSource, filename: string): Promise<string> {
  const db = getGalleryDb();
  const cached = db.prepare(`
    SELECT content_hash FROM gallery_photo_sources
    WHERE gallery_id = ? AND import_folder = ? AND filename = ? AND version = ?
  `).get(galleryId, source.folder, source.name, source.version) as { content_hash: string } | undefined;
  if (cached) return cached.content_hash;

  const hash = createHash("sha256");
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const stream = fs.createReadStream(filename, { fd: descriptor, autoClose: true });
  for await (const chunk of stream) hash.update(chunk);
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!stat.isFile() || fileVersion(source.folder, source.name, stat) !== source.version) {
    throw new GalleryImportFileError("Un fichier a changé pendant la lecture. Actualisez la liste.", 409);
  }
  const contentHash = hash.digest("hex");
  db.prepare(`
    INSERT INTO gallery_photo_sources (gallery_id, import_folder, filename, version, content_hash)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT (gallery_id, import_folder, filename)
    DO UPDATE SET version = excluded.version, content_hash = excluded.content_hash
  `).run(galleryId, source.folder, source.name, source.version, contentHash);
  return contentHash;
}

/** Includes legacy import folders and imported originals whose source has already gone. */
export async function listGalleryPhotoFiles(galleryId: string): Promise<GalleryPhotoFile[]> {
  const folders = getPhotoFolders(galleryId);
  const files = new Map<string, GalleryPhotoFile>();
  for (const media of getGalleryMediaList(galleryId, "photo")) {
    files.set(media.content_hash, {
      hash: media.content_hash, name: media.original_filename, size: media.file_size,
      status: "displayed", mediaId: media.id, sources: [], version: "",
    });
  }
  // Hash by streaming, one file at a time. Unchanged files use the persisted fingerprint cache.
  for (const folder of folders) {
    const directory = getPhotoDirectory(folder);
    if (!directory) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !isSourceName(entry.name)) continue;
      const filename = verifySecurePathChain(ENV.GALLERY_IMPORT_PATH, [folder, "photos", entry.name], "file");
      const stat = fs.lstatSync(filename, { bigint: true });
      const source = { folder, name: entry.name, size: Number(stat.size), version: fileVersion(folder, entry.name, stat) };
      const hash = await readSourceHash(galleryId, source, filename);
      let item = files.get(hash);
      if (!item) {
        item = { hash, name: source.name, size: source.size, status: "unimported", mediaId: null, sources: [], version: "" };
        files.set(hash, item);
      }
      item.sources.push(source);
    }
  }
  const removed = getGalleryDb().prepare(`SELECT * FROM gallery_removed_photos WHERE gallery_id = ?`).all(galleryId) as unknown as RemovedPhoto[];
  for (const row of removed) {
    let item = files.get(row.content_hash);
    if (!item && row.purge_sources) {
      item = { hash: row.content_hash, name: row.original_filename, size: 0, status: "deleting", mediaId: null, sources: [], version: "" };
      files.set(row.content_hash, item);
    }
    if (item) {
      item.status = row.purge_sources ? "deleting" : "removed";
      item.mediaId ||= row.media_id;
    }
  }
  for (const item of files.values()) {
    item.sources.sort((a, b) => `${a.folder}/${a.name}`.localeCompare(`${b.folder}/${b.name}`));
    item.version = createHash("sha256").update(JSON.stringify([
      galleryId, item.hash, item.status, item.mediaId, item.sources,
    ])).digest("hex");
  }
  return [...files.values()].sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
}

function assertPhotoFilesIdle(galleryId: string, folders: string[]): void {
  const db = getGalleryDb();
  const activeGallery = db.prepare(`
    SELECT 1 FROM gallery_import_jobs WHERE gallery_id = ? AND status IN ('pending', 'scanning', 'importing')
    UNION ALL SELECT 1 FROM gallery_deletion_jobs WHERE gallery_id = ? AND status IN ('pending', 'processing')
  `).get(galleryId, galleryId);
  if (activeGallery || hasOngoingGalleryUploadFinalization(galleryId)) {
    throw new GalleryImportFileError("Une opération est en cours pour cette galerie. Réessayez une fois terminée.", 409);
  }
  for (const folder of folders) {
    const active = db.prepare(`
      SELECT 1 FROM gallery_import_jobs WHERE import_folder = ? AND status IN ('pending', 'scanning', 'importing')
    `).get(folder);
    if (active || countActiveSessionsForTarget(path.join(ENV.GALLERY_IMPORT_PATH, folder), galleryId, "photos")) {
      throw new GalleryImportFileError("Un transfert ou un import utilise ce dossier. Réessayez une fois terminé.", 409);
    }
    const shared = db.prepare(`
      SELECT 1 FROM gallery_import_jobs WHERE import_folder = ? AND gallery_id != ?
      UNION ALL SELECT 1 FROM galleries WHERE upload_folder = ? AND id != ?
    `).get(folder, galleryId, folder, galleryId);
    if (shared) {
      throw new GalleryImportFileError("Ce dossier d’import est partagé avec une autre galerie. Déplacez les sources de cette galerie dans son dossier dédié avant la suppression définitive.", 409);
    }
  }
}

function sourcePath(source: PhotoSource, resuming: boolean): string | null {
  const directory = getPhotoDirectory(source.folder);
  if (!directory) return null;
  if (!fs.lstatSync(path.join(directory, source.name), { throwIfNoEntry: false })) return null;
  const filename = verifySecurePathChain(ENV.GALLERY_IMPORT_PATH, [source.folder, "photos", source.name], "file");
  const stat = fs.lstatSync(filename, { bigint: true });
  if (fileVersion(source.folder, source.name, stat) !== source.version) {
    // A different file uploaded since an interrupted deletion belongs to a later operation.
    if (resuming) return null;
    throw new GalleryImportFileError("Le fichier a été remplacé. Actualisez la liste avant de réessayer.", 409);
  }
  return filename;
}

export async function permanentlyDeleteGalleryPhoto(
  galleryId: string, hash: string, expectedVersion: string, expectedRevision: number,
): Promise<{ name: string; unpublishNotice: boolean }> {
  if (!/^[0-9a-f]{64}$/.test(hash) || !/^[0-9a-f]{64}$/.test(expectedVersion)) {
    throw new GalleryImportFileError("Photo ou confirmation invalide.", 400);
  }
  const files = await listGalleryPhotoFiles(galleryId);
  const item = files.find((file) => file.hash === hash);
  if (!item) throw new GalleryImportFileError("Photo introuvable dans cette galerie.", 404);
  const gallery = getGalleryById(galleryId);
  if (item.version !== expectedVersion || gallery?.revision !== expectedRevision) {
    throw new GalleryImportFileError("La galerie ou le fichier a changé. Actualisez la liste avant de réessayer.", 409);
  }
  const db = getGalleryDb();
  const pending = db.prepare(`
    SELECT purge_sources FROM gallery_removed_photos WHERE gallery_id = ? AND content_hash = ?
  `).get(galleryId, hash) as { purge_sources: string | null } | undefined;
  const resuming = Boolean(pending?.purge_sources);
  const previousSources: PhotoSource[] = pending?.purge_sources ? JSON.parse(pending.purge_sources) : [];
  const sourceMap = new Map(previousSources.map((source) => [`${source.folder}/${source.name}`, source]));
  for (const source of item.sources) sourceMap.set(`${source.folder}/${source.name}`, source);
  const sources = [...sourceMap.values()];
  const ownFolder = ensureGalleryImportFolder(galleryId).folderName;
  if (item.mediaId && isGalleryPhotoPreviewProcessing(galleryId, item.mediaId)) {
    throw new GalleryImportFileError("Un aperçu de cette photo est en cours de génération. Réessayez une fois terminé.", 409);
  }
  // Validate every target before deleting any file. There are no asynchronous gaps after this point.
  let targets: (string | null)[];
  db.exec("BEGIN IMMEDIATE;");
  try {
    assertPhotoFilesIdle(galleryId, [...new Set([ownFolder, ...sources.map((source) => source.folder)])]);
    targets = sources.map((source) => sourcePath(source, resuming));
    db.prepare(`
      INSERT INTO gallery_removed_photos (gallery_id, content_hash, original_filename, media_id, removed_at, purge_sources)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (gallery_id, content_hash)
      DO UPDATE SET purge_sources = excluded.purge_sources
    `).run(galleryId, hash, item.name, item.mediaId, Date.now(), JSON.stringify(sources));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  let unpublishNotice = false;
  try {
    for (const target of targets) if (target) fs.unlinkSync(target);
    if (item.mediaId) {
      deleteStoredGalleryPhotoFiles(galleryId, item.mediaId);
      const media = db.prepare("SELECT id FROM gallery_media WHERE gallery_id = ? AND id = ? AND media_type = 'photo'").get(galleryId, item.mediaId);
      if (media) unpublishNotice = deleteGalleryPhoto(galleryId, item.mediaId, expectedRevision).unpublishNotice;
    }
    // The marker stays until every disk operation and gallery update has succeeded.
    // A failed request or a process restart leaves a retryable deletion in the inventory.
    db.prepare("DELETE FROM gallery_removed_photos WHERE gallery_id = ? AND content_hash = ?").run(galleryId, hash);
    db.prepare("DELETE FROM gallery_photo_sources WHERE gallery_id = ? AND content_hash = ?").run(galleryId, hash);
  } catch (error) {
    throw new GalleryImportFileError(`Suppression incomplète. Réessayez la suppression de « ${item.name} ». ${error instanceof Error ? error.message : "Erreur disque."}`, 409);
  }
  return { name: item.name, unpublishNotice };
}
