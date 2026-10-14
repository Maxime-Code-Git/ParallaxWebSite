#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getMonorepoRoot } from "./env-loader.js";

/**
 * Ensures a directory exists with strict 0700 permissions and no symlinks.
 */
function ensurePrivateDirectory(dirPath, dryRun = false) {
  const resolved = path.resolve(dirPath);
  if (fs.existsSync(resolved)) {
    const lstat = fs.lstatSync(resolved);
    if (lstat.isSymbolicLink()) {
      throw new Error(`CRITICAL: Le dossier ${resolved} ne doit pas etre un lien symbolique.`);
    }
    if (!lstat.isDirectory()) {
      throw new Error(`CRITICAL: Le chemin ${resolved} existe mais n'est pas un dossier.`);
    }
    if (!dryRun) {
      try {
        fs.chmodSync(resolved, 0o700);
      } catch {
        // Ignored if permissions cannot be updated on certain filesystems
      }
    }
  } else if (!dryRun) {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(resolved, 0o700);
    } catch {
      // Ignored
    }
  }
  return resolved;
}

/**
 * Parses simple KEY=VALUE pairs from .env content without evaluating expressions.
 */
function parseEnvKeys(content) {
  const keys = new Map();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      keys.set(key, { index: i, value, raw: line });
    }
  }
  return keys;
}

/**
 * Configures gallery environment paths and secrets idempotently.
 */
export function setupGalleryEnvironment(options = {}) {
  const monorepoRoot = options.monorepoRoot || getMonorepoRoot();
  const envPath = options.envPath || path.resolve(monorepoRoot, ".env.local");
  const dataDir = options.dataDir || path.resolve(options.homeDir || os.homedir(), ".parallax-data");
  const dryRun = Boolean(options.dryRun);
  const log = options.log !== false;

  if (fs.existsSync(envPath)) {
    const stat = fs.lstatSync(envPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`CRITICAL: Le fichier d'environnement ${envPath} ne doit pas etre un lien symbolique.`);
    }
  }

  // 1. Prepare data directories
  const dbDir = ensurePrivateDirectory(dataDir, dryRun);
  const mediaDir = ensurePrivateDirectory(path.join(dataDir, "gallery-media"), dryRun);

  // Visible gallery-import directory at monorepo root (or options.importDir if overridden)
  const defaultImportPath = options.importDir
    ? path.resolve(options.importDir)
    : path.join(monorepoRoot, "gallery-import");

  const importDir = ensurePrivateDirectory(defaultImportPath, dryRun);
  if (!dryRun) {
    const starterGallery = path.join(importDir, "ma-galerie");
    ensurePrivateDirectory(starterGallery, dryRun);
    ensurePrivateDirectory(path.join(starterGallery, "photos"), dryRun);
    ensurePrivateDirectory(path.join(starterGallery, "videos"), dryRun);
  }

  // Preserve historical hidden directory if it exists, without deleting it
  const historicalHiddenImport = path.join(dataDir, "gallery-import");
  if (fs.existsSync(historicalHiddenImport) && !dryRun) {
    try {
      const entries = fs.readdirSync(historicalHiddenImport, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(historicalHiddenImport, entry.name);
        const destPath = path.join(importDir, entry.name);
        if (!fs.existsSync(destPath)) {
          fs.cpSync(srcPath, destPath, { recursive: true, errorOnExist: false });
        }
      }
    } catch {
      // Best-effort migration of existing files
    }
  }

  // 2. Read existing .env.local
  let existingContent = "";
  if (fs.existsSync(envPath)) {
    existingContent = fs.readFileSync(envPath, "utf-8");
  }

  const parsed = parseEnvKeys(existingContent);

  const defaultDbPath = path.join(dbDir, "gallery.sqlite");
  const defaultMediaPath = mediaDir;

  const replacements = new Map();
  const additions = [];
  const configuredKeys = [];

  // Helper to ensure key is set
  function checkOrSet(key, generateDefault) {
    const existing = parsed.get(key);
    if (existing && existing.value && existing.value.trim().length > 0) {
      configuredKeys.push({ key, status: "preserve" });
      return existing.value;
    }
    const newVal = generateDefault();
    additions.push({ key, value: newVal });
    configuredKeys.push({ key, status: "created" });
    return newVal;
  }

  checkOrSet("GALLERY_DB_PATH", () => defaultDbPath);
  checkOrSet("GALLERY_MEDIA_PATH", () => defaultMediaPath);

  // Targeted migration for GALLERY_IMPORT_PATH
  const existingImportKey = parsed.get("GALLERY_IMPORT_PATH");
  if (existingImportKey && existingImportKey.value && existingImportKey.value.trim().length > 0) {
    const existingVal = path.resolve(existingImportKey.value.trim());
    const historicalVal = path.resolve(historicalHiddenImport);
    if (existingVal === historicalVal) {
      replacements.set("GALLERY_IMPORT_PATH", defaultImportPath);
      configuredKeys.push({ key: "GALLERY_IMPORT_PATH", status: "migrated" });
    } else {
      configuredKeys.push({ key: "GALLERY_IMPORT_PATH", status: "preserve" });
    }
  } else {
    additions.push({ key: "GALLERY_IMPORT_PATH", value: defaultImportPath });
    configuredKeys.push({ key: "GALLERY_IMPORT_PATH", status: "created" });
  }

  checkOrSet("GALLERY_SECRET", () => crypto.randomBytes(32).toString("hex"));
  checkOrSet("GALLERY_CODE_ENCRYPTION_KEY", () => crypto.randomBytes(32).toString("hex"));

  // 3. Write updates safely without duplicating keys
  const totalUpdates = replacements.size + additions.length;
  if (totalUpdates > 0 && !dryRun) {
    const lines = existingContent ? existingContent.split("\n") : [];
    for (const [key, newVal] of replacements.entries()) {
      const info = parsed.get(key);
      if (info && info.index !== undefined && info.index < lines.length) {
        lines[info.index] = `${key}="${newVal}"`;
      }
    }
    let newContent = lines.join("\n");
    if (additions.length > 0) {
      if (newContent.length > 0 && !newContent.endsWith("\n")) {
        newContent += "\n";
      }
      newContent += "\n# --- Parallax Lot 4 : Espace client & Galeries privées ---\n";
      for (const { key, value } of additions) {
        newContent += `${key}="${value}"\n`;
      }
    }

    const tmpPath = path.join(path.dirname(envPath), `.env.local.tmp.${crypto.randomUUID()}`);
    fs.writeFileSync(tmpPath, newContent, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmpPath, envPath);
    try {
      fs.chmodSync(envPath, 0o600);
    } catch {
      // Ignored
    }
  }

  if (log) {
    console.log("==================================================");
    console.log(" Parallax - Configuration Espace Client & Galeries ");
    console.log("==================================================");
    console.log(`Dossier données : ${dataDir}`);
    console.log(`Dossier import  : ${importDir}`);
    console.log(`Fichier .env    : ${envPath}`);
    if (dryRun) {
      console.log("Mode            : DRY-RUN (aucune modification sur le disque)");
    }
    for (const item of configuredKeys) {
      const statusText =
        item.status === "preserve"
          ? "Conservee (deja existante)"
          : item.status === "migrated"
            ? "Migree vers dossier visible"
            : "Configuree";
      console.log(`Clé ${item.key.padEnd(28)} : ${statusText}`);
    }
    console.log("==================================================");
  }

  return {
    success: true,
    envPath,
    dataDir,
    importDir,
    configuredKeys,
    updatesCount: totalUpdates,
  };
}

// Auto-run when executed as CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const isDryRun = process.argv.includes("--dry-run");
  try {
    setupGalleryEnvironment({ dryRun: isDryRun });
    process.exit(0);
  } catch (err) {
    console.error("CRITICAL: Erreur lors de la configuration gallery :");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
