#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { validateSiteContentDocument, validatePortfolioContentDocument } from "@parallax/shared";

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
 * Checks if childPath is strictly a subpath of parentDir (preventing traversal).
 */
export function isSubPath(parentDir, childPath) {
  const rel = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return Boolean(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Verifies and restores a Parallax backup.
 * Enforces strict manifest validation, path confinement, and application schema validation.
 */
export function performSiteRestore(options = {}) {
  const { backupDir, targetDir, dryRun = false, verifyOnly = false, force = false, serviceStopped = false } = options;

  if (!backupDir || !fs.existsSync(backupDir)) {
    throw new Error(`Le dossier de sauvegarde spécifié est introuvable : ${backupDir}`);
  }

  const resolvedBackupDir = path.resolve(backupDir);
  const manifestPath = path.join(resolvedBackupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json absent dans le dossier de sauvegarde : ${resolvedBackupDir}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(`manifest.json invalide (JSON corrompu) : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  // 1. Strict Manifest Structure Validation
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

  // Ensure mandatory core components are present
  const components = new Set(manifest.files.map((f) => f.component));
  if (!components.has("SITE_CONTENT") || !components.has("PORTFOLIO_CONTENT")) {
    throw new Error("Manifeste incomplet : composants indispensables SITE_CONTENT ou PORTFOLIO_CONTENT absents.");
  }

  // Check duplicate paths and validate relative paths
  const relPaths = new Set();
  for (const item of manifest.files) {
    if (!item.backupRelPath || typeof item.backupRelPath !== "string") {
      throw new Error(`Fichier avec backupRelPath manquant ou invalide dans le manifeste.`);
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
    if (!isSubPath(resolvedBackupDir, resolvedInBackup)) {
      throw new Error(`Tentative d'évasion de la sauvegarde détectée : ${item.backupRelPath}`);
    }
  }

  // 2. Verify backup integrity against SHA-256 checksums and sizes
  const integrityErrors = [];
  for (const item of manifest.files) {
    const backupFilePath = path.join(resolvedBackupDir, item.backupRelPath);
    if (!fs.existsSync(backupFilePath)) {
      integrityErrors.push(`Fichier manquant dans la sauvegarde : ${item.backupRelPath}`);
      continue;
    }

    const stat = fs.statSync(backupFilePath);
    if (stat.size !== item.sizeBytes) {
      integrityErrors.push(
        `Taille de fichier divergente pour ${item.backupRelPath} (attendu: ${item.sizeBytes}, constaté: ${stat.size})`
      );
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

  // Helper to validate application schemas on files
  const validateApplicationSchemas = (fileEntries) => {
    const results = [];
    let hasFailure = false;

    for (const entry of fileEntries) {
      const { filePath, component } = entry;

      if (component === "SITE_CONTENT" || filePath.endsWith("site-content.json")) {
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(raw);
          const valResult = validateSiteContentDocument(parsed);
          if (!valResult.success) {
            hasFailure = true;
            results.push({
              path: filePath,
              type: "site_content",
              valid: false,
              error: valResult.error || valResult.reason,
            });
          } else {
            results.push({
              path: filePath,
              type: "site_content",
              valid: true,
              schemaVersion: parsed.schemaVersion,
            });
          }
        } catch (err) {
          hasFailure = true;
          results.push({ path: filePath, type: "site_content", valid: false, error: err.message });
        }
      } else if (component === "PORTFOLIO_CONTENT" || filePath.endsWith("portfolio-content.json")) {
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(raw);
          const valResult = validatePortfolioContentDocument(parsed);
          if (!valResult.success) {
            hasFailure = true;
            results.push({
              path: filePath,
              type: "portfolio_content",
              valid: false,
              error: valResult.error || valResult.reason,
            });
          } else {
            results.push({
              path: filePath,
              type: "portfolio_content",
              valid: true,
              schemaVersion: parsed.schemaVersion,
            });
          }
        } catch (err) {
          hasFailure = true;
          results.push({ path: filePath, type: "portfolio_content", valid: false, error: err.message });
        }
      } else if (filePath.endsWith(".sqlite")) {
        let db;
        try {
          db = new DatabaseSync(filePath, { readOnly: true });
          const integrityCheck = db.prepare("PRAGMA integrity_check").get();
          if (!integrityCheck || integrityCheck.integrity_check !== "ok") {
            hasFailure = true;
            results.push({
              path: filePath,
              type: "sqlite",
              valid: false,
              error: `PRAGMA integrity_check échoué : ${JSON.stringify(integrityCheck)}`,
            });
          } else {
            // Check application tables
            const tables = db
              .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
              .all()
              .map((r) => r.name);

            if (component === "GALLERY_DB" || filePath.includes("galleries.sqlite")) {
              const hasGalleries = tables.includes("galleries");
              const hasSchema = tables.includes("gallery_schema");
              if (!hasGalleries || !hasSchema) {
                hasFailure = true;
                results.push({
                  path: filePath,
                  type: "sqlite",
                  valid: false,
                  error: `Tables requises manquantes dans GALLERY_DB (trouvé : ${tables.join(", ")})`,
                });
                continue;
              }
            } else if (component === "RATE_LIMIT_DB" || filePath.includes("rate-limit.sqlite")) {
              const hasRequests = tables.includes("requests");
              const hasClaims = tables.includes("contact_claims");
              if (!hasRequests || !hasClaims) {
                hasFailure = true;
                results.push({
                  path: filePath,
                  type: "sqlite",
                  valid: false,
                  error: `Tables requises manquantes dans RATE_LIMIT_DB (trouvé : ${tables.join(", ")})`,
                });
                continue;
              }
            }

            results.push({
              path: filePath,
              type: "sqlite",
              valid: true,
              details: { tablesCount: tables.length, tables },
            });
          }
        } catch (err) {
          hasFailure = true;
          results.push({ path: filePath, type: "sqlite", valid: false, error: err.message });
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

    return { results, hasFailure };
  };

  // If verifyOnly, check application schemas directly inside the verified backup files
  if (verifyOnly) {
    const backupEntries = manifest.files.map((item) => ({
      filePath: path.join(resolvedBackupDir, item.backupRelPath),
      component: item.component,
    }));
    const { results, hasFailure } = validateApplicationSchemas(backupEntries);

    if (hasFailure) {
      return {
        success: false,
        reason: "SCHEMA_VERIFICATION_FAILED",
        errors: results.filter((r) => !r.valid).map((r) => `${r.type} (${r.path}) : ${r.error}`),
        verificationResults: results,
      };
    }

    return {
      success: true,
      verified: true,
      totalFiles: manifest.files.length,
      totalBytes: manifest.totalBytes,
      verificationResults: results,
    };
  }

  // 3. Destination Planning & Path Confinement
  const isIsolated = Boolean(targetDir);
  if (!isIsolated && !force && !dryRun) {
    throw new Error(
      "Restauration sur les emplacements d'origine refusée sans confirmation explicite (--force et --service-stopped). Utilisez --target-dir pour une restauration isolée sécurisée."
    );
  }

  if (!isIsolated && !serviceStopped && !dryRun) {
    throw new Error(
      "CRITICAL: La restauration en place exige l'arrêt préalable du serveur Parallax. Confirmez cet arrêt avec --service-stopped."
    );
  }

  let resolvedTargetDir = null;
  if (isIsolated) {
    resolvedTargetDir = path.resolve(targetDir);

    if (isSubPath(resolvedTargetDir, resolvedBackupDir) || resolvedTargetDir === resolvedBackupDir) {
      throw new Error(`La cible de restauration ne peut pas être à l'intérieur du dossier de sauvegarde.`);
    }

    if (fs.existsSync(resolvedTargetDir)) {
      const contents = fs.readdirSync(resolvedTargetDir);
      if (contents.length > 0 && !force && !dryRun) {
        throw new Error(
          `Le dossier cible existe déjà et n'est pas vide : ${resolvedTargetDir}. Utilisez --force pour autoriser l'écrasement.`
        );
      }
    }
  }

  const plan = manifest.files.map((item) => {
    let dest;
    if (isIsolated) {
      dest = path.resolve(resolvedTargetDir, item.backupRelPath);
      // Strictly verify destination confinement within targetDir
      if (!isSubPath(resolvedTargetDir, dest)) {
        throw new Error(`Tentative d'évasion de répertoire détectée pour le fichier : ${item.backupRelPath}`);
      }
    } else {
      // In-place restore: do not trust arbitrary originalPath, check confinement
      dest = path.resolve(item.originalPath);
    }

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

  // 4. Execution of restore
  const restoredPaths = [];
  try {
    for (const item of plan) {
      const destDir = path.dirname(item.destPath);
      fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
      fs.copyFileSync(item.srcBackupPath, item.destPath);
      fs.chmodSync(item.destPath, 0o600);
      restoredPaths.push(item.destPath);
    }
  } catch (err) {
    throw new Error(`Erreur lors de la copie des fichiers de restauration : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  // 5. Post-restoration verification of restored files
  const restoredEntries = plan.map((p) => ({ filePath: p.destPath, component: p.component }));
  const { results: verificationResults, hasFailure } = validateApplicationSchemas(restoredEntries);

  if (hasFailure) {
    return {
      success: false,
      reason: "POST_RESTORE_VERIFICATION_FAILED",
      errors: verificationResults.filter((r) => !r.valid).map((r) => `${r.type} (${r.path}) : ${r.error}`),
      verificationResults,
      restoredCount: restoredPaths.length,
      isIsolated,
    };
  }

  return {
    success: true,
    verified: true,
    restoredCount: restoredPaths.length,
    isIsolated,
    verificationResults,
  };
}

// ESM CLI entrypoint
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verifyOnly = args.includes("--verify-only");
  const force = args.includes("--force");
  const serviceStopped = args.includes("--service-stopped");

  const backupDirIndex = args.indexOf("--backup-dir");
  const backupDir = backupDirIndex !== -1 ? args[backupDirIndex + 1] : undefined;

  const targetDirIndex = args.indexOf("--target-dir");
  const targetDir = targetDirIndex !== -1 ? args[targetDirIndex + 1] : undefined;

  if (!backupDir) {
    console.error(
      `Usage: node scripts/restore.js --backup-dir <chemin> [--target-dir <chemin>] [--dry-run] [--verify-only] [--force] [--service-stopped]`
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
      force,
      serviceStopped,
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
      console.log(`\n[OK] Intégrité de la sauvegarde validée : ${res.totalFiles} fichiers conformes.`);
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
      console.log(`Mode : ${res.isIsolated ? "Restauré sur cible isolée" : "Restauré aux emplacements d'origine"}`);
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
