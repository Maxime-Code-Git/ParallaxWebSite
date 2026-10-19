#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getMonorepoRoot, loadEnvLocal } from "./env-loader.js";
import {
  cleanTypography,
  cleanCommonContent,
  cleanHomeContent,
  cleanStudioContent,
  cleanContactContent,
  cleanLegalDocument,
  cleanPortfolioContent,
  validatePortfolioContentDocument,
  validateSiteContentDocument,
} from "@parallax/shared";

// Re-export cleanTypography for any external consumers
export { cleanTypography };

/**
 * Validates that no path component in filePath is a symbolic link.
 */
function checkNoSymlinks(filePath, name) {
  const resolved = path.resolve(filePath);
  const parts = resolved.split(path.sep).filter(Boolean);

  let startIndex = 0;
  if (process.platform === "darwin" && parts.length > 0) {
    if (["var", "tmp", "etc"].includes(parts[0])) {
      startIndex = 1;
    }
  }

  let currentPath = path.isAbsolute(resolved) ? path.sep : "";
  for (let i = 0; i < parts.length; i++) {
    currentPath = path.join(currentPath, parts[i]);
    if (i >= startIndex) {
      if (fs.existsSync(currentPath)) {
        const lstat = fs.lstatSync(currentPath);
        if (lstat.isSymbolicLink()) {
          throw new Error(`CRITICAL: Le composant ${currentPath} de ${name} ne doit pas être un lien symbolique.`);
        }
      }
    }
  }
}

/**
 * Resolves and validates a secure target file path according to project confinement rules.
 * Does not fall back implicitly into the repository and forbids relative paths.
 */
function resolveSecurePath(customPath, envVarName) {
  const target = customPath ? String(customPath).trim() : process.env[envVarName]?.trim();
  if (!target) {
    throw new Error(`CRITICAL: Chemin non spécifié et variable d'environnement ${envVarName} absente.`);
  }

  if (!path.isAbsolute(target)) {
    throw new Error(`CRITICAL: Le chemin ${target} pour ${envVarName} doit être un chemin absolu.`);
  }

  checkNoSymlinks(target, envVarName);

  const resolved = path.resolve(target);
  const repoRoot = getMonorepoRoot();
  let realRepoRoot = repoRoot;
  try {
    realRepoRoot = fs.realpathSync(repoRoot);
  } catch {
    // Ignored
  }

  const relResolved = path.relative(repoRoot, resolved);
  const relReal = path.relative(realRepoRoot, resolved);
  if (
    (!relResolved.startsWith("..") && !path.isAbsolute(relResolved)) ||
    (!relReal.startsWith("..") && !path.isAbsolute(relReal))
  ) {
    throw new Error(`CRITICAL: ${envVarName} ne doit pas se trouver dans le dépôt du projet.`);
  }

  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    const tmp = fs.realpathSync(os.tmpdir());
    let realResolved = resolved;
    try {
      realResolved = fs.realpathSync(resolved);
    } catch {
      const parent = path.dirname(resolved);
      try {
        realResolved = path.join(fs.realpathSync(parent), path.basename(resolved));
      } catch {
        // Ignored
      }
    }
    const relTmp = path.relative(tmp, realResolved);
    if (relTmp.startsWith("..") || path.isAbsolute(relTmp)) {
      throw new Error(`CRITICAL: En mode test, ${envVarName} doit se trouver sous os.tmpdir().`);
    }
  }

  return resolved;
}

/**
 * Durable atomic write with fsync and directory sync, setting strict 0600 permissions.
 */
function atomicWriteDurable(targetPath, data) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  const content = JSON.stringify(data, null, 2) + "\n";
  const fd = fs.openSync(tempPath, "w", 0o600);
  try {
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tempPath, targetPath);

  try {
    const dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Ignore directory fsync error if unsupported on platform/filesystem
  }
}

/**
 * Creates a private safety backup out-of-rotation (mode 0600) before any actual mutation.
 */
function createSafetyBackup(filePath) {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, ".json");
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const backupPath = path.join(
    dir,
    `${baseName}.pre-typography-adaptation-${timestamp}-${randomSuffix}.safety.bak`
  );
  fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backupPath, 0o600);
  return path.basename(backupPath);
}

/**
 * Adapts portfolio content by removing em-dashes across all editorial fields.
 * Validates full schema before adaptation, checks revision, updates revision upon useful change,
 * preserves media registries, and never creates backups or writes on invalid schema.
 */
export function adaptPortfolioContent(targetPath, expectedRevision) {
  let filePath;
  try {
    filePath = resolveSecurePath(targetPath, "PORTFOLIO_CONTENT_PATH");
  } catch (err) {
    return { success: false, reason: "invalid_path", error: err instanceof Error ? err.message : String(err) };
  }

  if (!fs.existsSync(filePath)) {
    return { success: false, reason: "file_not_found" };
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { success: false, reason: "unreadable", error: err instanceof Error ? err.message : String(err) };
  }

  let content;
  try {
    content = JSON.parse(raw);
  } catch (err) {
    return { success: false, reason: "corrupted", error: err instanceof Error ? err.message : String(err) };
  }

  // Check version and full domain schema strictly BEFORE any cleaning
  if (typeof content?.schemaVersion !== "number" || content.schemaVersion !== 2) {
    return { success: false, reason: "unsupported_version" };
  }

  const preValidation = validatePortfolioContentDocument(content);
  if (!preValidation.success) {
    return { success: false, reason: preValidation.reason, error: preValidation.error };
  }

  if (expectedRevision && content.revision !== expectedRevision) {
    return { success: false, reason: "revision_conflict", serverRevision: content.revision };
  }

  // Deep clean all real editorial fields (overview with seeMoreButton, categories, projects with coverAlt and galleryAlt)
  const adaptedContent = cleanPortfolioContent(content);

  // Compare serialized representations of editorial data to determine if useful change occurred
  const isChanged = JSON.stringify(adaptedContent) !== JSON.stringify(content);

  if (!isChanged) {
    return { success: true, changed: false };
  }

  // Validate the adapted document structure with full schema
  const postValidation = validatePortfolioContentDocument(adaptedContent);
  if (!postValidation.success) {
    return { success: false, reason: "validation_failed", error: postValidation.error };
  }

  // Generate new revision and timestamp for domain mutation consistency
  const newRevision = crypto.randomBytes(16).toString("hex");
  adaptedContent.revision = newRevision;
  adaptedContent.updatedAt = new Date().toISOString();

  // Create private safety backup out-of-rotation (0600) only now
  const backupName = createSafetyBackup(filePath);

  // Durable atomic write without modifying media registries
  atomicWriteDurable(filePath, adaptedContent);

  return { success: true, changed: true, backupName, newRevision };
}

/**
 * Adapts site content editable drafts and sections by removing em-dashes across all editorial fields.
 * Strictly preserves published legal snapshots and history on disk.
 * Validates full schema before adaptation and never creates backups or writes on invalid schema.
 */
export function adaptSiteContentDrafts(targetPath, expectedRevision) {
  let filePath;
  try {
    filePath = resolveSecurePath(targetPath, "SITE_CONTENT_PATH");
  } catch (err) {
    return { success: false, reason: "invalid_path", error: err instanceof Error ? err.message : String(err) };
  }

  if (!fs.existsSync(filePath)) {
    return { success: false, reason: "file_not_found" };
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { success: false, reason: "unreadable", error: err instanceof Error ? err.message : String(err) };
  }

  let content;
  try {
    content = JSON.parse(raw);
  } catch (err) {
    return { success: false, reason: "corrupted", error: err instanceof Error ? err.message : String(err) };
  }

  // Check version and full domain schema strictly BEFORE any cleaning
  if (typeof content?.schemaVersion !== "number" || content.schemaVersion !== 3) {
    return { success: false, reason: "unsupported_version" };
  }

  const preValidation = validateSiteContentDocument(content);
  if (!preValidation.success) {
    return { success: false, reason: preValidation.reason, error: preValidation.error };
  }

  if (expectedRevision && content.revision !== expectedRevision) {
    return { success: false, reason: "revision_conflict", serverRevision: content.revision };
  }

  const initialCopy = structuredClone(content);

  // Adapt editable sections
  content.common = cleanCommonContent(content.common);
  content.home = cleanHomeContent(content.home);
  content.studio = cleanStudioContent(content.studio);
  content.contactPage = cleanContactContent(content.contactPage);

  // Adapt ONLY editable drafts; strictly leave published snapshots and history intact on disk!
  if (content.legalPages && typeof content.legalPages === "object") {
    for (const pageKey of Object.keys(content.legalPages)) {
      const page = content.legalPages[pageKey];
      if (page?.draft) {
        page.draft = cleanLegalDocument(page.draft);
      }
    }
  }

  // Check if anything actually changed
  const isChanged = JSON.stringify(content) !== JSON.stringify(initialCopy);

  if (!isChanged) {
    return { success: true, changed: false };
  }

  // Validate the adapted document structure
  const postValidation = validateSiteContentDocument(content);
  if (!postValidation.success) {
    return { success: false, reason: "validation_failed", error: postValidation.error };
  }

  // Generate new revision and timestamp for domain mutation consistency
  const newRevision = crypto.randomBytes(16).toString("hex");
  content.revision = newRevision;
  content.updatedAt = new Date().toISOString();

  // Create private safety backup out-of-rotation (0600) only now
  const backupName = createSafetyBackup(filePath);

  // Durable atomic write
  atomicWriteDurable(filePath, content);

  return { success: true, changed: true, backupName, newRevision };
}

/**
 * Main CLI runner. Exits with non-zero code on any failure without emitting misleading [OK] messages.
 */
export function runAdaptTypography() {
  console.log("=== Adaptation typographique ciblée des contenus Parallax ===");
  let hasError = false;

  const pRes = adaptPortfolioContent();
  if (!pRes.success) {
    hasError = true;
    console.error(`[ERREUR] portfolio-content.json : ${pRes.reason || "échec de l'adaptation"}`);
  } else if (pRes.changed) {
    console.log(`[OK] portfolio-content.json adapté (backup: ${pRes.backupName}, révision: ${pRes.newRevision})`);
  } else {
    console.log("[OK] portfolio-content.json : aucun changement requis.");
  }

  const sRes = adaptSiteContentDrafts();
  if (!sRes.success) {
    hasError = true;
    console.error(`[ERREUR] site-content.json : ${sRes.reason || "échec de l'adaptation"}`);
  } else if (sRes.changed) {
    console.log(`[OK] site-content.json textes éditables adaptés (backup: ${sRes.backupName}, révision: ${sRes.newRevision})`);
  } else {
    console.log("[OK] site-content.json : aucun changement requis sur les textes éditables.");
  }

  console.log("Important : Tous les snapshots légaux publiés sont restés strictement préservés sur le disque.");
  console.log("La normalisation s'applique en temps réel à l'affichage pour garantir zéro cadratin.");

  if (hasError) {
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    loadEnvLocal();
  } catch (err) {
    console.warn(`[WARN] env-loader: ${err instanceof Error ? err.message : String(err)}`);
  }
  runAdaptTypography();
}
