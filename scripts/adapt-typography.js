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
} from "@parallax/shared";

// Re-export cleanTypography for any external consumers
export { cleanTypography };

getMonorepoRoot();

// Ensure .env.local is loaded without overriding existing environment variables
try {
  loadEnvLocal();
} catch (err) {
  // If .env.local fails to load, log warning but allow explicit paths in test runners
  console.warn(`[WARN] env-loader: ${err instanceof Error ? err.message : String(err)}`);
}

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
 * Resolves configuration file path from environment or default data directory.
 */
function resolveConfiguredPath(varName, defaultFilename) {
  const envVal = process.env[varName]?.trim();
  if (envVal) {
    checkNoSymlinks(envVal, varName);
    return path.resolve(envVal);
  }
  const defaultPath = path.join(os.homedir(), ".parallax-data", defaultFilename);
  checkNoSymlinks(path.dirname(defaultPath), varName);
  return defaultPath;
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
 * Validates basic schema structure for portfolio content.
 */
function validatePortfolioSchema(content) {
  if (!content || typeof content !== "object") return false;
  if (typeof content.schemaVersion !== "number" || content.schemaVersion < 1) return false;
  if (!content.overview || typeof content.overview !== "object") return false;
  if (!Array.isArray(content.categories)) return false;
  if (!Array.isArray(content.projects)) return false;
  return true;
}

/**
 * Validates basic schema structure for site content.
 */
function validateSiteSchema(content) {
  if (!content || typeof content !== "object") return false;
  if (typeof content.schemaVersion !== "number" || content.schemaVersion < 2) return false;
  if (!content.common || typeof content.common !== "object") return false;
  if (!content.home || typeof content.home !== "object") return false;
  if (!content.studio || typeof content.studio !== "object") return false;
  if (!content.contactPage || typeof content.contactPage !== "object") return false;
  if (!content.legalPages || typeof content.legalPages !== "object") return false;
  return true;
}

/**
 * Adapts portfolio content by removing em-dashes across all editorial fields.
 * Validates schema, checks revision, updates revision upon useful change, and preserves media registries.
 */
export function adaptPortfolioContent(targetPath, expectedRevision) {
  let filePath;
  try {
    filePath = targetPath ? path.resolve(targetPath) : resolveConfiguredPath("PORTFOLIO_CONTENT_PATH", "portfolio-content.json");
    checkNoSymlinks(filePath, "PORTFOLIO_CONTENT_PATH");
  } catch (err) {
    return { success: false, reason: "invalid_path", error: err };
  }

  if (!fs.existsSync(filePath)) {
    return { success: false, reason: "file_not_found" };
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { success: false, reason: "unreadable", error: err };
  }

  let content;
  try {
    content = JSON.parse(raw);
  } catch (err) {
    return { success: false, reason: "corrupted", error: err };
  }

  if (!validatePortfolioSchema(content)) {
    return { success: false, reason: "invalid_schema" };
  }

  if (content.schemaVersion !== 2) {
    return { success: false, reason: "unsupported_version" };
  }

  if (expectedRevision && content.revision !== expectedRevision) {
    return { success: false, reason: "revision_conflict", serverRevision: content.revision };
  }

  // Deep clean all editorial fields (overview, categories, sections, projects, alts, alts, alts, seo)
  const adaptedContent = cleanPortfolioContent(content);

  // Compare serialized representations of editorial data to determine if useful change occurred
  const isChanged = JSON.stringify(adaptedContent) !== JSON.stringify(content);

  if (!isChanged) {
    return { success: true, changed: false };
  }

  // Validate the adapted document structure
  if (!validatePortfolioSchema(adaptedContent)) {
    return { success: false, reason: "validation_failed" };
  }

  // Generate new revision and timestamp for domain mutation consistency
  const newRevision = crypto.randomBytes(16).toString("hex");
  adaptedContent.revision = newRevision;
  adaptedContent.updatedAt = new Date().toISOString();

  // Create private safety backup out-of-rotation (0600)
  const backupName = createSafetyBackup(filePath);

  // Durable atomic write without modifying media registries
  atomicWriteDurable(filePath, adaptedContent);

  return { success: true, changed: true, backupName, newRevision };
}

/**
 * Adapts site content editable drafts and sections by removing em-dashes across all editorial fields.
 * Strictly preserves published legal snapshots and history on disk.
 */
export function adaptSiteContentDrafts(targetPath, expectedRevision) {
  let filePath;
  try {
    filePath = targetPath ? path.resolve(targetPath) : resolveConfiguredPath("SITE_CONTENT_PATH", "site-content.json");
    checkNoSymlinks(filePath, "SITE_CONTENT_PATH");
  } catch (err) {
    return { success: false, reason: "invalid_path", error: err };
  }

  if (!fs.existsSync(filePath)) {
    return { success: false, reason: "file_not_found" };
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { success: false, reason: "unreadable", error: err };
  }

  let content;
  try {
    content = JSON.parse(raw);
  } catch (err) {
    return { success: false, reason: "corrupted", error: err };
  }

  if (!validateSiteSchema(content)) {
    return { success: false, reason: "invalid_schema" };
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
  if (!validateSiteSchema(content)) {
    return { success: false, reason: "validation_failed" };
  }

  // Generate new revision and timestamp for domain mutation consistency
  const newRevision = crypto.randomBytes(16).toString("hex");
  content.revision = newRevision;
  content.updatedAt = new Date().toISOString();

  // Create private safety backup out-of-rotation (0600)
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
  runAdaptTypography();
}
