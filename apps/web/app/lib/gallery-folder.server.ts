import * as fs from "node:fs";
import * as path from "node:path";
import { ENV } from "./env.server";
import { getGalleryDb } from "./gallery-db.server";

/**
 * Converts a gallery name or title into a clean, safe, readable ASCII slug.
 */
export function slugifyGalleryName(name: string): string {
  if (!name || typeof name !== "string") return "galerie";
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric with hyphen
    .replace(/^-+|-+$/g, ""); // trim hyphens
  return normalized.slice(0, 50) || "galerie";
}

/**
 * Computes a stable, collision-free folder name for a gallery.
 * Always includes the gallery ID to prevent collisions between galleries with the same name.
 */
export function computeGalleryFolderName(galleryId: string, name: string): string {
  const slug = slugifyGalleryName(name);
  return `${slug}-${galleryId}`;
}

export interface GalleryFolderInfo {
  baseDir: string;
  folderPath: string;
}

/**
 * Strictly verifies that a folder name is confined inside ENV.GALLERY_IMPORT_PATH
 * and is not a symlink.
 */
export function validateGalleryFolderConfinement(folderName: string): GalleryFolderInfo {
  if (!folderName || typeof folderName !== "string") {
    throw new Error("Nom de dossier invalide.");
  }

  // Reject path traversal tokens
  if (
    folderName.includes("..") ||
    folderName.includes("/") ||
    folderName.includes("\\") ||
    folderName.includes("\0")
  ) {
    throw new Error("Tentative de sortie de répertoire interdite.");
  }

  // Strictly enforce safe characters (slug + UUID or alphanumeric/hyphens/underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(folderName)) {
    throw new Error("Caractères interdits dans le nom de dossier.");
  }

  const importBase = ENV.GALLERY_IMPORT_PATH;
  if (!fs.existsSync(importBase)) {
    fs.mkdirSync(importBase, { recursive: true, mode: 0o700 });
  }

  const baseStat = fs.lstatSync(importBase);
  if (baseStat.isSymbolicLink()) {
    throw new Error("Le répertoire de base d'import ne peut pas être un lien symbolique.");
  }

  const baseReal = fs.realpathSync(importBase);
  const candidatePath = path.resolve(baseReal, folderName);

  // Strict path confinement check
  if (!candidatePath.startsWith(baseReal + path.sep)) {
    throw new Error("Sortie du répertoire contrôlé interdite.");
  }

  if (fs.existsSync(candidatePath)) {
    const stat = fs.lstatSync(candidatePath);
    if (stat.isSymbolicLink()) {
      throw new Error("Le dossier de la galerie ne peut pas être un lien symbolique.");
    }
  }

  return { baseDir: baseReal, folderPath: candidatePath };
}

export interface GalleryImportDirectory {
  folderName: string;
  folderPath: string;
  photosPath: string;
  videosPath: string;
  tmpUploadsPath: string;
}

/**
 * Idempotently creates the gallery folder and its photos/, videos/, and .tmp_uploads/ subdirectories
 * with private permissions (0700).
 */
export function createGalleryFolderOnDisk(folderName: string): GalleryImportDirectory {
  const { folderPath } = validateGalleryFolderConfinement(folderName);

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true, mode: 0o700 });
  }
  const folderStat = fs.lstatSync(folderPath);
  if (folderStat.isSymbolicLink()) {
    throw new Error("Le dossier de la galerie ne peut pas être un lien symbolique.");
  }
  if ((folderStat.mode & 0o777) !== 0o700) {
    try {
      fs.chmodSync(folderPath, 0o700);
    } catch {
      // Ignored on restricted filesystems
    }
  }

  const photosPath = path.join(folderPath, "photos");
  if (!fs.existsSync(photosPath)) {
    fs.mkdirSync(photosPath, { recursive: true, mode: 0o700 });
  }
  const photosStat = fs.lstatSync(photosPath);
  if (photosStat.isSymbolicLink()) {
    throw new Error("Le sous-dossier photos ne peut pas être un lien symbolique.");
  }
  if ((photosStat.mode & 0o777) !== 0o700) {
    try {
      fs.chmodSync(photosPath, 0o700);
    } catch {
      // Ignored on restricted filesystems
    }
  }

  const videosPath = path.join(folderPath, "videos");
  if (!fs.existsSync(videosPath)) {
    fs.mkdirSync(videosPath, { recursive: true, mode: 0o700 });
  }
  const videosStat = fs.lstatSync(videosPath);
  if (videosStat.isSymbolicLink()) {
    throw new Error("Le sous-dossier videos ne peut pas être un lien symbolique.");
  }
  if ((videosStat.mode & 0o777) !== 0o700) {
    try {
      fs.chmodSync(videosPath, 0o700);
    } catch {
      // Ignored on restricted filesystems
    }
  }

  const tmpUploadsPath = path.join(folderPath, ".tmp_uploads");
  if (!fs.existsSync(tmpUploadsPath)) {
    fs.mkdirSync(tmpUploadsPath, { recursive: true, mode: 0o700 });
  }
  const tmpStat = fs.lstatSync(tmpUploadsPath);
  if (tmpStat.isSymbolicLink()) {
    throw new Error("Le dossier .tmp_uploads ne peut pas être un lien symbolique.");
  }
  if ((tmpStat.mode & 0o777) !== 0o700) {
    try {
      fs.chmodSync(tmpUploadsPath, 0o700);
    } catch {
      // Ignored on restricted filesystems
    }
  }

  return { folderName, folderPath, photosPath, videosPath, tmpUploadsPath };
}

/**
 * Idempotently ensures the dedicated import folder exists for a gallery.
 * If the gallery has an upload_folder recorded, it uses it.
 * If not, it computes it, creates it on disk, and records it in SQLite.
 * Handles existing galleries gracefully (lazy creation on first use).
 */
export function ensureGalleryImportFolder(galleryId: string): GalleryImportDirectory {
  if (!galleryId || typeof galleryId !== "string" || !/^[0-9a-zA-Z_-]+$/.test(galleryId)) {
    throw new Error("Identifiant de galerie invalide.");
  }

  const db = getGalleryDb();
  const gallery = db.prepare("SELECT id, title, client_name, upload_folder FROM galleries WHERE id = ?").get(galleryId) as {
    id: string;
    title: string;
    client_name: string;
    upload_folder?: string | null;
  } | undefined;

  if (!gallery) {
    throw new Error("Galerie introuvable.");
  }

  const folderName = gallery.upload_folder || computeGalleryFolderName(gallery.id, gallery.title || gallery.client_name);
  const result = createGalleryFolderOnDisk(folderName);

  if (gallery.upload_folder !== folderName) {
    db.prepare("UPDATE galleries SET upload_folder = ? WHERE id = ?").run(folderName, galleryId);
  }

  return result;
}
