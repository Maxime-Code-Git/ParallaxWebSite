#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest("hex");
}

export function performSiteRestore(options = {}) {
  const { backupDir, targetDir, dryRun = false, verifyOnly = false, force = false } = options;

  if (!backupDir || !fs.existsSync(backupDir)) {
    throw new Error(`Le dossier de sauvegarde spécifié est introuvable: ${backupDir}`);
  }

  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json absent dans le dossier de sauvegarde: ${backupDir}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (!Array.isArray(manifest.files)) {
    throw new Error(`Format de manifest invalide (tableau files manquant)`);
  }

  // 1. Verify backup integrity against SHA-256 checksums
  const integrityErrors = [];
  for (const item of manifest.files) {
    const backupFilePath = path.join(backupDir, item.backupRelPath);
    if (!fs.existsSync(backupFilePath)) {
      integrityErrors.push(`Fichier manquant dans la sauvegarde: ${item.backupRelPath}`);
      continue;
    }
    const currentSha = computeSha256(backupFilePath);
    if (currentSha !== item.sha256) {
      integrityErrors.push(
        `Checksum SHA-256 invalide pour ${item.backupRelPath} (attendu: ${item.sha256}, obtenu: ${currentSha})`
      );
    }
  }

  if (integrityErrors.length > 0) {
    return {
      success: false,
      reason: "INTEGRITY_CHECK_FAILED",
      errors: integrityErrors,
    };
  }

  if (verifyOnly) {
    return {
      success: true,
      verified: true,
      totalFiles: manifest.files.length,
      totalBytes: manifest.totalBytes,
    };
  }

  // Target restoration mode: isolated directory or in-place
  const isIsolated = Boolean(targetDir);
  if (!isIsolated && !force && !dryRun) {
    throw new Error(
      "Restauration sur les emplacements d'origine refusée sans l'option explicite --force. Utilisez --target-dir pour une restauration isolée."
    );
  }

  const plan = manifest.files.map((item) => {
    const dest = isIsolated
      ? path.join(path.resolve(targetDir), item.backupRelPath)
      : item.originalPath;
    return {
      component: item.component,
      srcBackupPath: path.join(backupDir, item.backupRelPath),
      destPath: dest,
      sizeBytes: item.sizeBytes,
    };
  });

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      totalFiles: plan.length,
      plan,
    };
  }

  // Execute restore
  const restoredPaths = [];
  for (const item of plan) {
    const destDir = path.dirname(item.destPath);
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(item.srcBackupPath, item.destPath);
    fs.chmodSync(item.destPath, 0o600);
    restoredPaths.push(item.destPath);
  }

  // Post-restoration verification
  const verificationResults = [];

  for (const item of plan) {
    if (item.destPath.endsWith(".sqlite")) {
      try {
        const db = new DatabaseSync(item.destPath, { readOnly: true });
        const tables = db.prepare("SELECT count(*) as count FROM sqlite_master").all();
        db.close();
        verificationResults.push({ path: item.destPath, type: "sqlite", valid: true, details: tables });
      } catch (err) {
        verificationResults.push({ path: item.destPath, type: "sqlite", valid: false, error: err.message });
      }
    } else if (item.destPath.endsWith(".json") && !item.destPath.endsWith("manifest.json")) {
      try {
        const raw = fs.readFileSync(item.destPath, "utf-8");
        const parsed = JSON.parse(raw);
        verificationResults.push({ path: item.destPath, type: "json", valid: true, schemaVersion: parsed.schemaVersion });
      } catch (err) {
        verificationResults.push({ path: item.destPath, type: "json", valid: false, error: err.message });
      }
    }
  }

  return {
    success: true,
    restoredCount: restoredPaths.length,
    isIsolated,
    verificationResults,
  };
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verifyOnly = args.includes("--verify-only");
  const force = args.includes("--force");

  const backupDirIndex = args.indexOf("--backup-dir");
  const backupDir = backupDirIndex !== -1 ? args[backupDirIndex + 1] : undefined;

  const targetDirIndex = args.indexOf("--target-dir");
  const targetDir = targetDirIndex !== -1 ? args[targetDirIndex + 1] : undefined;

  if (!backupDir) {
    console.error(`Usage: node scripts/restore.js --backup-dir <chemin> [--target-dir <chemin>] [--dry-run] [--verify-only] [--force]`);
    process.exit(1);
  }

  console.log(`[Parallax Restore] Démarrage de la vérification et restauration...`);
  try {
    const res = performSiteRestore({
      backupDir,
      targetDir,
      dryRun,
      verifyOnly,
      force,
    });

    if (verifyOnly) {
      console.log(`[OK] Intégrité de la sauvegarde validée : ${res.totalFiles} fichiers conformes aux checksums SHA-256.`);
    } else if (dryRun) {
      console.log(`[Mode Simulation (--dry-run)] Plan de restauration (${res.totalFiles} éléments) :`);
      for (const p of res.plan) {
        console.log(`- ${p.component} -> ${p.destPath}`);
      }
      console.log(`[OK] Simulation de restauration réussie.`);
    } else {
      console.log(`[SUCCÈS] ${res.restoredCount} fichiers restaurés avec succès.`);
      console.log(`Mode : ${res.isIsolated ? "Restauré sur cible isolée" : "Restauré aux emplacements d'origine"}`);
      for (const v of res.verificationResults) {
        console.log(`- Vérification ${v.type}: ${v.path} [${v.valid ? "VALIDE" : "ERREUR"}]`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(`[ERREUR] Échec de la restauration :`, err.message);
    process.exit(1);
  }
}
