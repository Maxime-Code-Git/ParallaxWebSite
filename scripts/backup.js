#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getMonorepoRoot, loadEnvLocal } from "./env-loader.js";

export function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest("hex");
}

export function copyDirRecursive(srcDir, destDir, fileList = [], baseRel = "") {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcChild = path.join(srcDir, entry.name);
    const destChild = path.join(destDir, entry.name);
    const relChild = path.join(baseRel, entry.name);

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

export function backupSqliteDatabase(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) return false;

  const destDir = path.dirname(destPath);
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

  // Use SQLite VACUUM INTO for clean, checkpointed snapshot
  try {
    const db = new DatabaseSync(srcPath, { readOnly: true });
    // Single quotes are mandatory in SQL syntax for string literals
    const escapedDest = destPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedDest}'`);
    db.close();
    fs.chmodSync(destPath, 0o600);
    return true;
  } catch {
    // If VACUUM INTO fails (e.g. empty uninitialized file), fallback to direct copy
    fs.copyFileSync(srcPath, destPath);
    fs.chmodSync(destPath, 0o600);
    return true;
  }
}

export function performSiteBackup(options = {}) {
  const root = getMonorepoRoot();
  const env = options.env || { ...process.env, ...loadEnvLocal(root) };

  const isDryRun = Boolean(options.dryRun);
  const includeImports = options.includeImports !== false;
  const allowLive = Boolean(options.allowLive);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupId = `parallax-backup-${timestamp}`;

  const defaultBackupRoot = path.join(process.env.HOME || "/tmp", ".parallax-backups");
  const backupDir = options.outDir ? path.resolve(options.outDir) : path.join(defaultBackupRoot, backupId);

  // Inventory required storage paths
  const inventory = [
    {
      component: "SITE_CONTENT",
      type: "file",
      srcPath: env.SITE_CONTENT_PATH ? path.resolve(env.SITE_CONTENT_PATH) : null,
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
      srcPath: env.PORTFOLIO_CONTENT_PATH ? path.resolve(env.PORTFOLIO_CONTENT_PATH) : null,
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
    const defaultImport = path.join(root, "gallery-import");
    const importPath = env.GALLERY_IMPORT_PATH ? path.resolve(env.GALLERY_IMPORT_PATH) : defaultImport;
    inventory.push({
      component: "GALLERY_IMPORT",
      type: "dir",
      srcPath: importPath,
      destRel: "imports/gallery-import",
      required: false,
    });
  }

  // Private config (.env.local)
  const envLocalPath = path.join(root, ".env.local");
  if (fs.existsSync(envLocalPath)) {
    inventory.push({
      component: "ENV_CONFIG",
      type: "file",
      srcPath: envLocalPath,
      destRel: "config/env.local",
      required: false,
      isSecret: true,
    });
  }

  // Precondition and plan summary
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
      // rough directory size
      const countDirSize = (d) => {
        let s = 0;
        try {
          const files = fs.readdirSync(d, { withFileTypes: true });
          for (const f of files) {
            const p = path.join(d, f.name);
            if (f.isDirectory()) s += countDirSize(p);
            else if (f.isFile()) s += fs.statSync(p).size;
          }
        } catch {
          /* ignore */
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

  // Execution: Create backup directory with private 0700 permissions
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const manifestFiles = [];

  for (const item of inventory) {
    if (!item.srcPath || !fs.existsSync(item.srcPath)) {
      continue;
    }

    const destPath = path.join(backupDir, item.destRel);
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

  // Create manifest.json
  const manifest = {
    backupId,
    createdAt: new Date().toISOString(),
    nodeVersion: process.version,
    allowLive,
    includeImports,
    totalFiles: manifestFiles.length,
    totalBytes: manifestFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
    files: manifestFiles,
  };

  const manifestPath = path.join(backupDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

  return {
    success: true,
    dryRun: false,
    backupDir,
    manifest,
  };
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allowLive = args.includes("--allow-live");
  const noImports = args.includes("--no-imports");
  const outDirIndex = args.indexOf("--out-dir");
  const outDir = outDirIndex !== -1 ? args[outDirIndex + 1] : undefined;

  console.log(`[Parallax Backup] Démarrage de la sauvegarde complète...`);
  if (dryRun) console.log(`[Mode Simulation (--dry-run)] Aucun fichier ne sera écrit.`);

  try {
    const res = performSiteBackup({
      dryRun,
      allowLive,
      includeImports: !noImports,
      outDir,
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
    console.error(`[ERREUR] Échec de la sauvegarde :`, err);
    process.exit(1);
  }
}
