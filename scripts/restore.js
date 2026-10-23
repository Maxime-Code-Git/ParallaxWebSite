#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { validateSiteContentDocument, validatePortfolioContentDocument } from "@parallax/shared";
import {
  assertNoUserSymlinks,
  assertPathConfined,
  getCanonicalPath,
  isSubPath,
  isSymlink,
  pathExists,
} from "./path-safety.js";

/**
 * Computes SHA-256 of a file using a bounded-memory buffer (64 KB).
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
 * Strict component-to-path association rules.
 * Prevents bypassing schema validation through component renaming or arbitrary placement.
 */
export const COMPONENT_RULES = {
  SITE_CONTENT: { exact: "content/site-content.json" },
  PORTFOLIO_CONTENT: { exact: "content/portfolio-content.json" },
  GALLERY_DB: { exact: "db/galleries.sqlite" },
  RATE_LIMIT_DB: { exact: "db/rate-limit.sqlite" },
  ENV_CONFIG: { exact: "config/env.local" },
  SITE_MEDIA: { prefix: "media/site/" },
  PORTFOLIO_MEDIA: { prefix: "media/portfolio/" },
  GALLERY_MEDIA: { prefix: "media/gallery/" },
  GALLERY_IMPORT: { prefix: "imports/gallery-import/" },
};

/**
 * Verifies and restores a Parallax backup.
 * Restores strictly to a fresh, non-existing isolated target directory.
 * Pre-validates all hashes, sizes, and application schemas before copying any files.
 */
export function performSiteRestore(options = {}) {
  const { backupDir, targetDir, dryRun = false, verifyOnly = false, force } = options;

  // 1. Refuse in-place restore and --force explicitly
  if (force) {
    throw new Error(
      "L'option --force est interdite : la restauration automatisée refuse l'écrasement ou le mélange d'un dossier existant. La cible doit être un dossier neuf non existant."
    );
  }

  if (!verifyOnly) {
    if (!targetDir || typeof targetDir !== "string" || !targetDir.trim()) {
      throw new Error(
        "Restauration automatisée refusée : le paramètre targetDir est obligatoire. La restauration s'effectue exclusivement vers un répertoire cible isolé neuf pour prévenir tout écrasement accidentel."
      );
    }
  }

  if (!backupDir || !fs.existsSync(backupDir)) {
    throw new Error(`Le dossier de sauvegarde spécifié est introuvable : ${backupDir}`);
  }

  const resolvedBackupDir = path.resolve(backupDir);
  assertNoUserSymlinks(resolvedBackupDir, "Dossier de sauvegarde");

  const manifestPath = path.join(resolvedBackupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json absent dans le dossier de sauvegarde : ${resolvedBackupDir}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(`manifest.json invalide (JSON corrompu) : ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }

  // 2. Strict Manifest Structure & Version Validation
  if (
    !manifest ||
    typeof manifest !== "object" ||
    typeof manifest.backupId !== "string" ||
    !manifest.backupId ||
    typeof manifest.totalFiles !== "number" ||
    manifest.totalFiles <= 0 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== manifest.totalFiles
  ) {
    throw new Error(`Structure de manifeste invalide ou sauvegarde vide (totalFiles: ${manifest?.totalFiles})`);
  }

  if (manifest.manifestVersion !== 1) {
    throw new Error(`Version de manifeste non supportée ou inconnue : ${manifest.manifestVersion}`);
  }

  // Check mandatory components
  const presentComponents = new Set(manifest.files.map((f) => f.component));
  if (!presentComponents.has("SITE_CONTENT") || !presentComponents.has("PORTFOLIO_CONTENT")) {
    throw new Error("Manifeste incomplet : composants indispensables SITE_CONTENT ou PORTFOLIO_CONTENT absents.");
  }

  // Validate component rules, paths, checksums, and duplicate detection
  const relPaths = new Set();
  for (const item of manifest.files) {
    if (!item.component || typeof item.component !== "string" || !(item.component in COMPONENT_RULES)) {
      throw new Error(`Composant inconnu ou non autorisé dans le manifeste : ${item.component}`);
    }

    if (!item.backupRelPath || typeof item.backupRelPath !== "string") {
      throw new Error(`Fichier avec backupRelPath manquant dans le manifeste pour ${item.component}`);
    }

    const rule = COMPONENT_RULES[item.component];
    if (rule.exact && item.backupRelPath !== rule.exact) {
      throw new Error(
        `Association composant/chemin incohérente pour ${item.component} : attendu ${rule.exact}, obtenu ${item.backupRelPath}`
      );
    }
    if (rule.prefix && !item.backupRelPath.startsWith(rule.prefix)) {
      throw new Error(
        `Association composant/chemin incohérente pour ${item.component} : attendu préfixe ${rule.prefix}, obtenu ${item.backupRelPath}`
      );
    }

    const normalizedRel = path.normalize(item.backupRelPath);
    if (
      normalizedRel.startsWith("..") ||
      path.isAbsolute(normalizedRel) ||
      normalizedRel.includes(".." + path.sep) ||
      normalizedRel.startsWith("/") ||
      normalizedRel.startsWith("\\")
    ) {
      throw new Error(`Chemin non sécurisé détecté dans le manifeste : ${item.backupRelPath}`);
    }

    if (relPaths.has(normalizedRel)) {
      throw new Error(`Doublon de fichier détecté dans le manifeste : ${normalizedRel}`);
    }
    relPaths.add(normalizedRel);

    if (typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256)) {
      throw new Error(`Checksum SHA-256 invalide dans le manifeste pour ${item.backupRelPath}`);
    }

    if (typeof item.sizeBytes !== "number" || item.sizeBytes < 0) {
      throw new Error(`Taille de fichier invalide dans le manifeste pour ${item.backupRelPath}`);
    }

    const resolvedInBackup = path.resolve(resolvedBackupDir, normalizedRel);
    assertPathConfined(resolvedBackupDir, resolvedInBackup, `Fichier de sauvegarde (${item.backupRelPath})`);
  }

  // 3. Pre-Restore Validation: Check integrity and deep application schemas on backup files BEFORE any copy
  const integrityErrors = [];
  const verificationResults = [];

  for (const item of manifest.files) {
    const backupFilePath = path.join(resolvedBackupDir, item.backupRelPath);

    if (!fs.existsSync(backupFilePath)) {
      integrityErrors.push(`Fichier manquant dans la sauvegarde : ${item.backupRelPath}`);
      continue;
    }

    if (isSymlink(backupFilePath)) {
      integrityErrors.push(`Lien symbolique interdit détecté dans la sauvegarde : ${item.backupRelPath}`);
      continue;
    }

    const stat = fs.statSync(backupFilePath);
    if (stat.size !== item.sizeBytes) {
      integrityErrors.push(
        `Taille de fichier divergente pour ${item.backupRelPath} (attendu: ${item.sizeBytes}, constaté: ${stat.size})`
      );
      continue;
    }

    const currentSha = computeSha256(backupFilePath);
    if (currentSha !== item.sha256) {
      integrityErrors.push(
        `Checksum SHA-256 invalide pour ${item.backupRelPath} (attendu: ${item.sha256}, obtenu: ${currentSha})`
      );
      continue;
    }

    // Deep Schema and Content Verification
    if (item.component === "SITE_CONTENT") {
      try {
        const raw = fs.readFileSync(backupFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        const valResult = validateSiteContentDocument(parsed);
        if (!valResult.success) {
          integrityErrors.push(`Schéma SITE_CONTENT invalide : ${valResult.error || valResult.reason}`);
          verificationResults.push({ path: backupFilePath, type: "site_content", valid: false, error: valResult.error });
        } else {
          verificationResults.push({ path: backupFilePath, type: "site_content", valid: true, schemaVersion: parsed.schemaVersion });
        }
      } catch (err) {
        integrityErrors.push(`Fichier SITE_CONTENT JSON corrompu : ${err.message}`);
        verificationResults.push({ path: backupFilePath, type: "site_content", valid: false, error: err.message });
      }
    } else if (item.component === "PORTFOLIO_CONTENT") {
      try {
        const raw = fs.readFileSync(backupFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        const valResult = validatePortfolioContentDocument(parsed);
        if (!valResult.success) {
          integrityErrors.push(`Schéma PORTFOLIO_CONTENT invalide : ${valResult.error || valResult.reason}`);
          verificationResults.push({ path: backupFilePath, type: "portfolio_content", valid: false, error: valResult.error });
        } else {
          verificationResults.push({ path: backupFilePath, type: "portfolio_content", valid: true, schemaVersion: parsed.schemaVersion });
        }
      } catch (err) {
        integrityErrors.push(`Fichier PORTFOLIO_CONTENT JSON corrompu : ${err.message}`);
        verificationResults.push({ path: backupFilePath, type: "portfolio_content", valid: false, error: err.message });
      }
    } else if (item.component === "GALLERY_DB") {
      let db;
      try {
        db = new DatabaseSync(backupFilePath, { readOnly: true });
        const check = db.prepare("PRAGMA integrity_check").get();
        if (!check || check.integrity_check !== "ok") {
          integrityErrors.push(`GALLERY_DB a échoué au PRAGMA integrity_check`);
          verificationResults.push({ path: backupFilePath, type: "sqlite", valid: false, error: "integrity_check failed" });
        } else {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
          if (!tables.includes("galleries") || !tables.includes("gallery_schema")) {
            integrityErrors.push(`GALLERY_DB tables requises manquantes (trouvé : ${tables.join(", ")})`);
            verificationResults.push({ path: backupFilePath, type: "sqlite", valid: false, error: "missing tables" });
          } else {
            verificationResults.push({ path: backupFilePath, type: "sqlite", valid: true, details: { tables } });
          }
        }
      } catch (err) {
        integrityErrors.push(`GALLERY_DB inaccessible ou corrompue : ${err.message}`);
        verificationResults.push({ path: backupFilePath, type: "sqlite", valid: false, error: err.message });
      } finally {
        if (db) {
          try {
            db.close();
          } catch {
            /* ignore */
          }
        }
      }
    } else if (item.component === "RATE_LIMIT_DB") {
      let db;
      try {
        db = new DatabaseSync(backupFilePath, { readOnly: true });
        const check = db.prepare("PRAGMA integrity_check").get();
        if (!check || check.integrity_check !== "ok") {
          integrityErrors.push(`RATE_LIMIT_DB a échoué au PRAGMA integrity_check`);
          verificationResults.push({ path: backupFilePath, type: "sqlite", valid: false, error: "integrity_check failed" });
        } else {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
          if (!tables.includes("requests") || !tables.includes("contact_claims")) {
            integrityErrors.push(`RATE_LIMIT_DB tables requises manquantes (trouvé : ${tables.join(", ")})`);
            verificationResults.push({ path: backupFilePath, type: "sqlite", valid: false, error: "missing tables" });
          } else {
            verificationResults.push({ path: backupFilePath, type: "sqlite", valid: true, details: { tables } });
          }
        }
      } catch (err) {
        integrityErrors.push(`RATE_LIMIT_DB inaccessible ou corrompue : ${err.message}`);
        verificationResults.push({ path: backupFilePath, type: "sqlite", valid: false, error: err.message });
      } finally {
        if (db) {
          try {
            db.close();
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  // If any integrity or schema error occurred, stop immediately without touching destinations
  if (integrityErrors.length > 0) {
    return {
      success: false,
      reason: "VALIDATION_FAILED",
      errors: integrityErrors,
      verificationResults,
    };
  }

  if (verifyOnly) {
    return {
      success: true,
      verified: true,
      totalFiles: manifest.files.length,
      totalBytes: manifest.totalBytes,
      verificationResults,
    };
  }

  // 4. Target Directory Confinement & Preparation
  const resolvedTargetDir = path.resolve(targetDir);

  // Refuse if target exists (even if empty, or a symlink)
  if (pathExists(resolvedTargetDir)) {
    throw new Error(
      `La cible de restauration existe déjà (${resolvedTargetDir}). Pour garantir la sécurité, la cible doit être un dossier neuf non existant.`
    );
  }

  // Refuse if any ancestor contains user symlinks
  assertNoUserSymlinks(resolvedTargetDir, "Cible de restauration");

  // Ensure target doesn't overlap backup directory
  const canonBackup = getCanonicalPath(resolvedBackupDir);
  const canonTarget = getCanonicalPath(resolvedTargetDir);
  if (isSubPath(canonBackup, canonTarget) || isSubPath(canonTarget, canonBackup) || canonBackup === canonTarget) {
    throw new Error("La cible de restauration ne peut pas chevaucher le dossier de sauvegarde.");
  }

  const plan = manifest.files.map((item) => {
    const dest = path.resolve(resolvedTargetDir, item.backupRelPath);
    assertPathConfined(resolvedTargetDir, dest, item.backupRelPath);
    return {
      component: item.component,
      srcBackupPath: path.join(resolvedBackupDir, item.backupRelPath),
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

  // 5. Staging Copy & Atomic Publication
  const stagingDir = `${resolvedTargetDir}.staging-${crypto.randomUUID()}`;
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

  const restoredPaths = [];
  try {
    for (const item of plan) {
      const stagingDest = path.resolve(stagingDir, path.relative(resolvedTargetDir, item.destPath));
      assertPathConfined(stagingDir, stagingDest, item.component);

      const destDir = path.dirname(stagingDest);
      fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });

      fs.copyFileSync(item.srcBackupPath, stagingDest);
      fs.chmodSync(stagingDest, 0o600);
      restoredPaths.push(item.destPath);
    }

    // Atomically publish staging directory as target directory
    fs.renameSync(stagingDir, resolvedTargetDir);

    return {
      success: true,
      verified: true,
      restoredCount: restoredPaths.length,
      targetDir: resolvedTargetDir,
      verificationResults,
    };
  } catch (err) {
    if (pathExists(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    throw new Error(
      `Erreur lors de la copie ou publication de la restauration : ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

// ESM CLI entrypoint
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verifyOnly = args.includes("--verify-only");

  if (args.includes("--force")) {
    console.error(
      `[ERREUR] L'option --force est interdite : la restauration automatisée refuse l'écrasement ou le mélange d'un dossier existant. Spécifiez une cible neuve non existante.`
    );
    process.exit(1);
  }

  const backupDirIndex = args.indexOf("--backup-dir");
  const backupDir = backupDirIndex !== -1 ? args[backupDirIndex + 1] : undefined;

  const targetDirIndex = args.indexOf("--target-dir");
  const targetDir = targetDirIndex !== -1 ? args[targetDirIndex + 1] : undefined;

  if (!backupDir) {
    console.error(`Usage: node scripts/restore.js --backup-dir <chemin> [--target-dir <chemin>] [--dry-run] [--verify-only]`);
    process.exit(1);
  }

  if (!verifyOnly && !targetDir) {
    console.error(
      `[ERREUR] Le paramètre --target-dir est obligatoire. La restauration s'effectue exclusivement vers un répertoire cible isolé neuf.`
    );
    process.exit(1);
  }

  console.log(`[Parallax Restore] Démarrage de la vérification et restauration...`);
  try {
    const res = performSiteRestore({
      backupDir,
      targetDir,
      dryRun,
      verifyOnly,
    });

    if (!res.success) {
      console.error(`\n[ERREUR] Échec de l'opération : ${res.reason || "Vérification échouée"}`);
      if (res.errors) {
        for (const e of res.errors) {
          console.error(` - ${e}`);
        }
      }
      process.exit(1);
    }

    if (verifyOnly) {
      console.log(`\n[OK] Intégrité et conformité des schémas validées : ${res.totalFiles} fichiers conformes.`);
      if (res.verificationResults) {
        for (const v of res.verificationResults) {
          console.log(` - ${v.type} (${v.path}) : ${v.valid ? "VALIDE" : "ERREUR"}`);
        }
      }
    } else if (dryRun) {
      console.log(`\n[Mode Simulation (--dry-run)] Plan de restauration (${res.totalFiles} éléments) :`);
      for (const p of res.plan) {
        console.log(`- ${p.component} -> ${p.destPath}`);
      }
      console.log(`[OK] Simulation de restauration réussie.`);
    } else {
      console.log(`\n[SUCCÈS] ${res.restoredCount} fichiers restaurés avec succès.`);
      console.log(`Destination isolée : ${res.targetDir}`);
      for (const v of res.verificationResults) {
        console.log(`- Vérification ${v.type}: ${v.path} [${v.valid ? "VALIDE" : "ERREUR"}]`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(`\n[ERREUR] Échec de la restauration :`, err.message || err);
    process.exit(1);
  }
}
