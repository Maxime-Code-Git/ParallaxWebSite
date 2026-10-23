#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { getMonorepoRoot, loadEnvLocal } from "./env-loader.js";
import { validateSiteContentDocument, validatePortfolioContentDocument } from "@parallax/shared";
import {
  assertNoUserSymlinks,
  getCanonicalPath,
  isSubPath,
  pathExists,
} from "./path-safety.js";

/**
 * Computes SHA-256 of a file using a bounded-memory buffer (64 KB).
 * Never loads large video/media files entirely into memory.
 */
export function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Backups a SQLite database cleanly using VACUUM INTO.
 * Guarantees connection closure in finally block and throws on failure (no raw fallback).
 */
export function backupSqliteDatabase(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Fichier SQLite source introuvable : ${srcPath}`);
  }

  const stat = fs.lstatSync(srcPath);
  if (stat.isSymbolicLink()) {
    throw new Error(`La base SQLite source ne doit pas être un lien symbolique : ${srcPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Le chemin SQLite source n'est pas un fichier régulier : ${srcPath}`);
  }

  let db;
  try {
    db = new DatabaseSync(srcPath, { readOnly: true });
    const check = db.prepare("PRAGMA integrity_check").get();
    if (!check || check.integrity_check !== "ok") {
      throw new Error(`La base SQLite ${srcPath} a échoué au PRAGMA integrity_check : ${JSON.stringify(check)}`);
    }

    const destDir = path.dirname(destPath);
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }

    const escapedDest = destPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedDest}'`);
    fs.chmodSync(destPath, 0o600);
    return true;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore close error */
      }
    }
  }
}

/**
 * Recursively copies a directory with restricted permissions (0700 dirs, 0600 files).
 * Rejects symlinks in sources to ensure complete, consistent archives without external escapes.
 */
export function copyDirRecursive(srcDir, destDir, fileList = [], baseRel = "") {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcChild = path.join(srcDir, entry.name);
    const destChild = path.join(destDir, entry.name);
    const relChild = path.join(baseRel, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(
        `Lien symbolique source interdit détecté : ${srcChild}. Les sources de sauvegarde ne doivent contenir aucun lien symbolique.`
      );
    }

    if (entry.isDirectory()) {
      copyDirRecursive(srcChild, destChild, fileList, relChild);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcChild, destChild);
      fs.chmodSync(destChild, 0o600);
      const stat = fs.statSync(destChild);
      fileList.push({
        relPath: relChild,
        sizeBytes: stat.size,
        sha256: computeSha256(destChild),
      });
    }
  }
}

/**
 * Executes a full site backup with pre-validation, SQLite VACUUM INTO, and atomic publication.
 */
export function performSiteBackup(options = {}) {
  const root = getMonorepoRoot();

  // Environment isolation: if options.env is provided (tests), use it exclusively
  let env;
  if (options.env) {
    env = { ...options.env };
  } else {
    loadEnvLocal();
    env = { ...process.env };
  }

  const isDryRun = Boolean(options.dryRun);
  const includeImports = options.includeImports !== false;
  const serviceStopped = Boolean(options.serviceStopped);

  // 1. Validate required core components and schemas before doing anything
  if (!env.SITE_CONTENT_PATH) {
    throw new Error("Composant indispensable manquant : SITE_CONTENT_PATH non configuré.");
  }
  const siteContentPath = path.resolve(env.SITE_CONTENT_PATH);
  if (!fs.existsSync(siteContentPath)) {
    throw new Error(`Fichier indispensable introuvable : SITE_CONTENT_PATH=${siteContentPath}`);
  }
  assertNoUserSymlinks(siteContentPath, "SITE_CONTENT_PATH");
  if (!fs.statSync(siteContentPath).isFile()) {
    throw new Error(`Fichier indispensable non régulier : SITE_CONTENT_PATH=${siteContentPath}`);
  }

  let siteContentJson;
  try {
    siteContentJson = JSON.parse(fs.readFileSync(siteContentPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Fichier indispensable SITE_CONTENT corrompu (JSON invalide) : ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
  const siteContentValidation = validateSiteContentDocument(siteContentJson);
  if (!siteContentValidation.success) {
    throw new Error(`Composant indispensable SITE_CONTENT invalide selon le schéma : ${siteContentValidation.error}`);
  }

  if (!env.PORTFOLIO_CONTENT_PATH) {
    throw new Error("Composant indispensable manquant : PORTFOLIO_CONTENT_PATH non configuré.");
  }
  const portfolioContentPath = path.resolve(env.PORTFOLIO_CONTENT_PATH);
  if (!fs.existsSync(portfolioContentPath)) {
    throw new Error(`Fichier indispensable introuvable : PORTFOLIO_CONTENT_PATH=${portfolioContentPath}`);
  }
  assertNoUserSymlinks(portfolioContentPath, "PORTFOLIO_CONTENT_PATH");
  if (!fs.statSync(portfolioContentPath).isFile()) {
    throw new Error(`Fichier indispensable non régulier : PORTFOLIO_CONTENT_PATH=${portfolioContentPath}`);
  }

  let portfolioContentJson;
  try {
    portfolioContentJson = JSON.parse(fs.readFileSync(portfolioContentPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Fichier indispensable PORTFOLIO_CONTENT corrompu (JSON invalide) : ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
  const portfolioContentValidation = validatePortfolioContentDocument(portfolioContentJson);
  if (!portfolioContentValidation.success) {
    throw new Error(`Composant indispensable PORTFOLIO_CONTENT invalide selon le schéma : ${portfolioContentValidation.error}`);
  }

  // 2. Precondition: Operator confirmation that services and workers are stopped
  if (!isDryRun && !serviceStopped) {
    throw new Error(
      "CRITICAL: La cohérence globale de la sauvegarde exige l'arrêt préalable du serveur et des workers Parallax. Confirmez cet arrêt avec l'option 'serviceStopped: true' (ou le drapeau CLI '--service-stopped')."
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupId = `parallax-backup-${timestamp}`;

  const defaultBackupRoot = path.join(process.env.HOME || "/tmp", ".parallax-backups");
  const backupDir = options.outDir ? path.resolve(options.outDir) : path.join(defaultBackupRoot, backupId);

  // Validate backupDir against symlinks in its hierarchy
  assertNoUserSymlinks(backupDir, "Dossier de destination");

  // 3. Inventory components
  const inventory = [
    {
      component: "SITE_CONTENT",
      type: "file",
      srcPath: siteContentPath,
      destRel: "content/site-content.json",
      required: true,
    },
    {
      component: "SITE_MEDIA",
      type: "dir",
      srcPath: env.SITE_MEDIA_PATH ? path.resolve(env.SITE_MEDIA_PATH) : null,
      destRel: "media/site",
      required: false,
    },
    {
      component: "PORTFOLIO_CONTENT",
      type: "file",
      srcPath: portfolioContentPath,
      destRel: "content/portfolio-content.json",
      required: true,
    },
    {
      component: "PORTFOLIO_MEDIA",
      type: "dir",
      srcPath: env.PORTFOLIO_MEDIA_PATH ? path.resolve(env.PORTFOLIO_MEDIA_PATH) : null,
      destRel: "media/portfolio",
      required: false,
    },
    {
      component: "GALLERY_DB",
      type: "sqlite",
      srcPath: env.GALLERY_DB_PATH ? path.resolve(env.GALLERY_DB_PATH) : null,
      destRel: "db/galleries.sqlite",
      required: false,
    },
    {
      component: "GALLERY_MEDIA",
      type: "dir",
      srcPath: env.GALLERY_MEDIA_PATH ? path.resolve(env.GALLERY_MEDIA_PATH) : null,
      destRel: "media/gallery",
      required: false,
    },
    {
      component: "RATE_LIMIT_DB",
      type: "sqlite",
      srcPath: env.RATE_LIMIT_DB_PATH ? path.resolve(env.RATE_LIMIT_DB_PATH) : null,
      destRel: "db/rate-limit.sqlite",
      required: false,
    },
  ];

  if (includeImports) {
    const importPath = env.GALLERY_IMPORT_PATH
      ? path.resolve(env.GALLERY_IMPORT_PATH)
      : path.join(root, "gallery-import");
    inventory.push({
      component: "GALLERY_IMPORT",
      type: "dir",
      srcPath: importPath,
      destRel: "imports/gallery-import",
      required: false,
    });
  }

  // Private config (.env.local or custom fixture)
  if (options.configPath) {
    const customConfig = path.resolve(options.configPath);
    if (fs.existsSync(customConfig)) {
      assertNoUserSymlinks(customConfig, "Fichier config");
      inventory.push({
        component: "ENV_CONFIG",
        type: "file",
        srcPath: customConfig,
        destRel: "config/env.local",
        required: false,
        isSecret: true,
      });
    }
  } else if (!options.env) {
    // Normal CLI run: backup monorepo root .env.local if present
    const envLocalPath = path.join(root, ".env.local");
    if (fs.existsSync(envLocalPath)) {
      assertNoUserSymlinks(envLocalPath, "Fichier .env.local");
      inventory.push({
        component: "ENV_CONFIG",
        type: "file",
        srcPath: envLocalPath,
        destRel: "config/env.local",
        required: false,
        isSecret: true,
      });
    }
  }

  // 4. Validate output path against sources and existing backups
  if (pathExists(backupDir)) {
    throw new Error(`Le dossier de destination existe déjà : ${backupDir}. Spécifiez une destination neuve.`);
  }

  const canonBackupDir = getCanonicalPath(backupDir);

  for (const item of inventory) {
    if (item.srcPath && fs.existsSync(item.srcPath)) {
      assertNoUserSymlinks(item.srcPath, `Source ${item.component}`);
      const canonSrc = getCanonicalPath(item.srcPath);

      if (isSubPath(canonSrc, canonBackupDir) || canonSrc === canonBackupDir) {
        throw new Error(
          `Destination invalide : le dossier de sortie (${backupDir}) se trouve à l'intérieur d'une source (${item.component} -> ${item.srcPath}).`
        );
      }
      if (isSubPath(canonBackupDir, canonSrc)) {
        throw new Error(
          `Destination invalide : le dossier de sortie (${backupDir}) recouvre une source (${item.component} -> ${item.srcPath}).`
        );
      }
    }
  }

  // Inventory summary calculation
  const summary = [];
  let totalEstimatedBytes = 0;

  for (const item of inventory) {
    if (!item.srcPath || !fs.existsSync(item.srcPath)) {
      summary.push({
        component: item.component,
        type: item.type,
        srcPath: item.srcPath,
        status: item.required ? "MISSING_REQUIRED" : "NOT_PRESENT",
        sizeBytes: 0,
      });
      continue;
    }

    const stat = fs.statSync(item.srcPath);
    let size = stat.size;
    if (stat.isDirectory()) {
      const countDirSize = (d) => {
        let s = 0;
        try {
          const files = fs.readdirSync(d, { withFileTypes: true });
          for (const f of files) {
            if (f.isSymbolicLink()) {
              throw new Error(`Lien symbolique source interdit : ${path.join(d, f.name)}`);
            }
            const p = path.join(d, f.name);
            if (f.isDirectory()) s += countDirSize(p);
            else if (f.isFile()) s += fs.statSync(p).size;
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes("Lien symbolique")) throw err;
        }
        return s;
      };
      size = countDirSize(item.srcPath);
    }

    totalEstimatedBytes += size;
    summary.push({
      component: item.component,
      type: item.type,
      srcPath: item.srcPath,
      destRel: item.destRel,
      status: "READY",
      sizeBytes: size,
    });
  }

  if (isDryRun) {
    return {
      success: true,
      dryRun: true,
      backupDir,
      totalEstimatedBytes,
      items: summary,
    };
  }

  // 5. Execution: Create private staging directory, then atomically publish
  const stagingDir = `${backupDir}.staging-${crypto.randomUUID()}`;
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

  const manifestFiles = [];

  try {
    for (const item of inventory) {
      if (!item.srcPath || !fs.existsSync(item.srcPath)) {
        continue;
      }

      const destPath = path.join(stagingDir, item.destRel);
      fs.mkdirSync(path.dirname(destPath), { recursive: true, mode: 0o700 });

      if (item.type === "file") {
        fs.copyFileSync(item.srcPath, destPath);
        fs.chmodSync(destPath, 0o600);
        const stat = fs.statSync(destPath);
        manifestFiles.push({
          component: item.component,
          type: "file",
          originalPath: item.srcPath,
          backupRelPath: item.destRel,
          sizeBytes: stat.size,
          sha256: computeSha256(destPath),
          isSecret: Boolean(item.isSecret),
        });
      } else if (item.type === "sqlite") {
        backupSqliteDatabase(item.srcPath, destPath);
        if (fs.existsSync(destPath)) {
          const stat = fs.statSync(destPath);
          manifestFiles.push({
            component: item.component,
            type: "sqlite",
            originalPath: item.srcPath,
            backupRelPath: item.destRel,
            sizeBytes: stat.size,
            sha256: computeSha256(destPath),
          });
        }
      } else if (item.type === "dir") {
        const fileList = [];
        copyDirRecursive(item.srcPath, destPath, fileList);
        for (const f of fileList) {
          manifestFiles.push({
            component: item.component,
            type: "dir_item",
            originalPath: path.join(item.srcPath, f.relPath),
            backupRelPath: path.join(item.destRel, f.relPath),
            sizeBytes: f.sizeBytes,
            sha256: f.sha256,
          });
        }
      }
    }

    // Build and write manifest.json
    const manifest = {
      manifestVersion: 1,
      backupId,
      createdAt: new Date().toISOString(),
      nodeVersion: process.version,
      serviceStopped: true,
      includeImports,
      totalFiles: manifestFiles.length,
      totalBytes: manifestFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
      files: manifestFiles,
    };

    const manifestPath = path.join(stagingDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

    // Atomically rename staging directory to final backup destination
    fs.renameSync(stagingDir, backupDir);

    return {
      success: true,
      dryRun: false,
      backupDir,
      manifest,
    };
  } catch (err) {
    // Clean up staging directory on failure to avoid leaving partial artifacts
    if (pathExists(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

// ESM CLI entrypoint
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const serviceStopped = args.includes("--service-stopped");
  const noImports = args.includes("--no-imports");
  const outDirIndex = args.indexOf("--out-dir");
  const outDir = outDirIndex !== -1 ? args[outDirIndex + 1] : undefined;
  const configIndex = args.indexOf("--config-path");
  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;

  console.log(`[Parallax Backup] Démarrage de la sauvegarde complète...`);
  if (dryRun) console.log(`[Mode Simulation (--dry-run)] Aucun fichier ne sera écrit.`);

  try {
    const res = performSiteBackup({
      dryRun,
      serviceStopped,
      includeImports: !noImports,
      outDir,
      configPath,
    });

    if (dryRun) {
      console.log(`\n--- Inventaire des composants ---`);
      for (const it of res.items) {
        const sizeKb = (it.sizeBytes / 1024).toFixed(1);
        console.log(`- ${it.component} (${it.type}): ${it.status} [${sizeKb} KB] -> ${it.srcPath || "N/A"}`);
      }
      console.log(`\nDestination prévue : ${res.backupDir}`);
      console.log(`Taille totale estimée : ${(res.totalEstimatedBytes / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`[OK] Simulation de sauvegarde réussie.`);
    } else {
      console.log(`\n[SUCCÈS] Sauvegarde créée dans : ${res.backupDir}`);
      console.log(`Fichiers archivés : ${res.manifest.totalFiles}`);
      console.log(`Volume total : ${(res.manifest.totalBytes / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`Permissions : 0700 répertoire, 0600 fichiers.`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`[ERREUR] Échec de la sauvegarde :`, err.message || err);
    process.exit(1);
  }
}
