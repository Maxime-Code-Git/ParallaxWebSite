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
  const importDir = ensurePrivateDirectory(path.join(dataDir, "gallery-import"), dryRun);

  // 2. Read existing .env.local
  let existingContent = "";
  if (fs.existsSync(envPath)) {
    existingContent = fs.readFileSync(envPath, "utf-8");
  }

  const parsed = parseEnvKeys(existingContent);

  const defaultDbPath = path.join(dbDir, "gallery.sqlite");
  const defaultMediaPath = mediaDir;
  const defaultImportPath = importDir;

  const updates = [];
  const configuredKeys = [];

  // Helper to ensure key is set
  function getOrSet(key, generateDefault) {
    const existing = parsed.get(key);
    if (existing && existing.value && existing.value.trim().length > 0) {
      configuredKeys.push({ key, status: "preserve" });
      return existing.value;
    }
    const newVal = generateDefault();
    updates.push({ key, value: newVal });
    configuredKeys.push({ key, status: "created" });
    return newVal;
  }

  getOrSet("GALLERY_DB_PATH", () => defaultDbPath);
  getOrSet("GALLERY_MEDIA_PATH", () => defaultMediaPath);
  getOrSet("GALLERY_IMPORT_PATH", () => defaultImportPath);
  getOrSet("GALLERY_SECRET", () => crypto.randomBytes(32).toString("hex"));
  getOrSet("GALLERY_CODE_ENCRYPTION_KEY", () => crypto.randomBytes(32).toString("hex"));

  // 3. Write updates safely if needed
  if (updates.length > 0 && !dryRun) {
    let newContent = existingContent;
    if (newContent.length > 0 && !newContent.endsWith("\n")) {
      newContent += "\n";
    }

    newContent += "\n# --- Parallax Lot 4 : Espace client & Galeries privées ---\n";
    for (const { key, value } of updates) {
      newContent += `${key}=${value}\n`;
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
    console.log(`Fichier .env    : ${envPath}`);
    if (dryRun) {
      console.log("Mode            : DRY-RUN (aucune modification sur le disque)");
    }
    for (const item of configuredKeys) {
      console.log(`Clé ${item.key.padEnd(28)} : ${item.status === "preserve" ? "Conservee (deja existante)" : "Configuree"}`);
    }
    console.log("==================================================");
  }

  return {
    success: true,
    envPath,
    dataDir,
    configuredKeys,
    updatesCount: updates.length,
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
