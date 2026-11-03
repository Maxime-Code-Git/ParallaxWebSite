import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "./env.server";
import { getGalleryDb } from "./gallery-db.server";
import { ensureGalleryImportFolder } from "./gallery-folder.server";
import { countActiveSessionsForTarget, hasOngoingGalleryUploadFinalization } from "./gallery-upload.server";
import { verifySecurePathChain } from "./media-image.server";

export interface GalleryVideoSource {
  name: string;
  size: number;
  version: string;
}

export class GalleryImportFileError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
    this.name = "GalleryImportFileError";
  }
}

function isSourceName(name: string) {
  return name.length > 0 && Buffer.byteLength(name) <= 255 && !name.startsWith(".") &&
    !/[/\\\0\r\n]/.test(name) && !name.endsWith(".part") && !name.endsWith(".tmp");
}

function fileVersion(folderName: string, name: string, stat: fs.BigIntStats): string {
  return createHash("sha256").update([
    folderName, name, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs,
  ].join("\0")).digest("hex");
}

export function listGalleryVideoSources(folderName: string): GalleryVideoSource[] {
  const directory = verifySecurePathChain(ENV.GALLERY_IMPORT_PATH, [folderName, "videos"], "directory");
  const files: GalleryVideoSource[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !isSourceName(entry.name)) continue;
    const stat = fs.lstatSync(path.join(directory, entry.name), { bigint: true, throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    files.push({
      name: entry.name,
      size: Number(stat.size),
      version: fileVersion(folderName, entry.name, stat),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
}

export function deleteGalleryVideoSource(galleryId: string, name: string, expectedVersion: string): void {
  if (!isSourceName(name) || !/^[0-9a-f]{64}$/.test(expectedVersion)) {
    throw new GalleryImportFileError("Fichier source ou confirmation invalide.", 400);
  }

  // Resolve the folder from the gallery. The request cannot choose another folder.
  const folder = ensureGalleryImportFolder(galleryId);
  const db = getGalleryDb();
  const activeImport = db.prepare(`
    SELECT 1 FROM gallery_import_jobs
    WHERE (gallery_id = ? OR import_folder = ?) AND status IN ('pending', 'scanning', 'importing')
    LIMIT 1
  `).get(galleryId, folder.folderName);
  if (activeImport || countActiveSessionsForTarget(folder.folderPath, galleryId, "videos") ||
    hasOngoingGalleryUploadFinalization(galleryId)) {
    throw new GalleryImportFileError("Un transfert ou un import est en cours. Réessayez une fois terminé.", 409);
  }

  let filePath: string;
  try {
    filePath = verifySecurePathChain(ENV.GALLERY_IMPORT_PATH, [folder.folderName, "videos", name], "file");
  } catch {
    throw new GalleryImportFileError("Fichier introuvable dans le dossier vidéo de cette galerie.", 404);
  }
  const stat = fs.lstatSync(filePath, { bigint: true, throwIfNoEntry: false });
  if (!stat?.isFile() || fileVersion(folder.folderName, name, stat) !== expectedVersion) {
    throw new GalleryImportFileError("Le fichier a changé depuis l’affichage. Rechargez la liste avant de réessayer.", 409);
  }
  fs.unlinkSync(filePath);
}
