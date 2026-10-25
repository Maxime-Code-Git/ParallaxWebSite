#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getMonorepoRoot, loadEnvLocal } from "./env-loader.js";
import {
  cleanHeroSubtitle,
  cleanStudioName,
  validateSiteContentDocument,
} from "@parallax/shared";

/**
 * Validates that no path component in filePath is a symbolic link.
 */
function checkNoSymlinks(filePath, name) {
  const resolved = path.resolve(filePath);
  const parts = resolved.split(path.sep).filter(Boolean);

  let startIndex = 0;
  if (process.platform === "darwin" && parts.length > 0) {
    if (["var", "tmp", "etc", "private"].includes(parts[0])) {
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
 */
function resolveSecurePath(customPath, envVarName = "SITE_CONTENT_PATH") {
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
    `${baseName}.pre-editorial-remediation-${timestamp}-${randomSuffix}.safety.bak`
  );
  fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backupPath, 0o600);
  return path.basename(backupPath);
}

/**
 * Remediates persistent editorial content:
 * 1. Removes test subtitle mentions (e.g. "- Test Vérifié Lot 2" and variants) and clean separators from home.hero.subtitle.
 * 2. Normalizes studio commercial name to "Studio LM" across editorial fields (footer copyright, sempra badge, studio hero text, etc.).
 * 3. Preserves all other data (media, portfolio, company settings, published legal snapshots).
 * 4. Supports simulation mode (--dry-run).
 * 5. Creates out-of-rotation backup and updates revision/timestamp ONLY if modification is needed (idempotent).
 */
export function remediateSiteContentEditorial(options = {}) {
  const targetPath = typeof options === "string" ? options : options.targetPath;
  const dryRun = typeof options === "object" && Boolean(options.dryRun);
  const expectedRevision = typeof options === "object" ? options.expectedRevision : undefined;

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

  const modifiedFields = [];

  // 1. Home hero subtitle: remove test string and normalize studio name
  if (content.home?.hero?.subtitle) {
    const sub = content.home.hero.subtitle;
    if (typeof sub.fr === "string") {
      const cleanedFr = cleanStudioName(cleanHeroSubtitle(sub.fr));
      if (cleanedFr !== sub.fr) {
        sub.fr = cleanedFr;
        modifiedFields.push("home.hero.subtitle.fr");
      }
    }
    if (typeof sub.en === "string") {
      const cleanedEn = cleanStudioName(cleanHeroSubtitle(sub.en));
      if (cleanedEn !== sub.en) {
        sub.en = cleanedEn;
        modifiedFields.push("home.hero.subtitle.en");
      }
    }
  }

  // 2. Common footer copyright: normalize studio name
  if (content.common?.footer?.copyright) {
    const copy = content.common.footer.copyright;
    if (typeof copy.fr === "string") {
      const cleanedFr = cleanStudioName(copy.fr);
      if (cleanedFr !== copy.fr) {
        copy.fr = cleanedFr;
        modifiedFields.push("common.footer.copyright.fr");
      }
    }
    if (typeof copy.en === "string") {
      const cleanedEn = cleanStudioName(copy.en);
      if (cleanedEn !== copy.en) {
        copy.en = cleanedEn;
        modifiedFields.push("common.footer.copyright.en");
      }
    }
  }

  // 3. Home sempra badge: normalize studio name
  if (content.home?.sempra?.badge) {
    const badge = content.home.sempra.badge;
    if (typeof badge.fr === "string") {
      const cleanedFr = cleanStudioName(badge.fr);
      if (cleanedFr !== badge.fr) {
        badge.fr = cleanedFr;
        modifiedFields.push("home.sempra.badge.fr");
      }
    }
    if (typeof badge.en === "string") {
      const cleanedEn = cleanStudioName(badge.en);
      if (cleanedEn !== badge.en) {
        badge.en = cleanedEn;
        modifiedFields.push("home.sempra.badge.en");
      }
    }
  }

  // 4. Studio hero text: normalize studio name
  if (content.studio?.hero?.text) {
    const text = content.studio.hero.text;
    if (typeof text.fr === "string") {
      const cleanedFr = cleanStudioName(text.fr);
      if (cleanedFr !== text.fr) {
        text.fr = cleanedFr;
        modifiedFields.push("studio.hero.text.fr");
      }
    }
    if (typeof text.en === "string") {
      const cleanedEn = cleanStudioName(text.en);
      if (cleanedEn !== text.en) {
        text.en = cleanedEn;
        modifiedFields.push("studio.hero.text.en");
      }
    }
  }

  // 5. Check any drafts in legalPages (strictly leave published snapshots intact!)
  if (content.legalPages && typeof content.legalPages === "object") {
    for (const pageKey of Object.keys(content.legalPages)) {
      const page = content.legalPages[pageKey];
      if (page?.draft) {
        if (page.draft.intro) {
          if (typeof page.draft.intro.fr === "string") {
            const cleaned = cleanStudioName(page.draft.intro.fr);
            if (cleaned !== page.draft.intro.fr) {
              page.draft.intro.fr = cleaned;
              modifiedFields.push(`legalPages.${pageKey}.draft.intro.fr`);
            }
          }
          if (typeof page.draft.intro.en === "string") {
            const cleaned = cleanStudioName(page.draft.intro.en);
            if (cleaned !== page.draft.intro.en) {
              page.draft.intro.en = cleaned;
              modifiedFields.push(`legalPages.${pageKey}.draft.intro.en`);
            }
          }
        }
        if (Array.isArray(page.draft.sections)) {
          for (let sIdx = 0; sIdx < page.draft.sections.length; sIdx++) {
            const section = page.draft.sections[sIdx];
            if (Array.isArray(section.paragraphs)) {
              for (let pIdx = 0; pIdx < section.paragraphs.length; pIdx++) {
                const para = section.paragraphs[pIdx];
                if (typeof para.fr === "string") {
                  const cleaned = cleanStudioName(para.fr);
                  if (cleaned !== para.fr) {
                    para.fr = cleaned;
                    modifiedFields.push(`legalPages.${pageKey}.draft.sections[${sIdx}].paragraphs[${pIdx}].fr`);
                  }
                }
                if (typeof para.en === "string") {
                  const cleaned = cleanStudioName(para.en);
                  if (cleaned !== para.en) {
                    para.en = cleaned;
                    modifiedFields.push(`legalPages.${pageKey}.draft.sections[${sIdx}].paragraphs[${pIdx}].en`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Idempotence check: if nothing was modified
  if (modifiedFields.length === 0) {
    return {
      success: true,
      changed: false,
      dryRun,
      modifiedFields: [],
      currentRevision: content.revision,
    };
  }

  // If dry-run: validate modified document and return without writing
  if (dryRun) {
    const postValidation = validateSiteContentDocument(content);
    if (!postValidation.success) {
      return { success: false, reason: "validation_failed", error: postValidation.error };
    }
    return {
      success: true,
      changed: true,
      dryRun: true,
      modifiedFields,
      currentRevision: content.revision,
    };
  }

  // Real execution: post-validate, update revision & timestamp, create backup and write atomically
  const postValidation = validateSiteContentDocument(content);
  if (!postValidation.success) {
    return { success: false, reason: "validation_failed", error: postValidation.error };
  }

  const newRevision = crypto.randomBytes(16).toString("hex");
  content.revision = newRevision;
  content.updatedAt = new Date().toISOString();

  const backupName = createSafetyBackup(filePath);
  atomicWriteDurable(filePath, content);

  return {
    success: true,
    changed: true,
    dryRun: false,
    backupName,
    newRevision,
    modifiedFields,
  };
}

/**
 * Main CLI runner.
 */
export function runRemediateEditorial() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let targetPath;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run" || arg === "--simulate") {
      dryRun = true;
    } else if (arg === "--target-path" || arg === "--path") {
      targetPath = args[++i];
    } else if (arg === "-h" || arg === "--help") {
      console.log("Usage: node scripts/remediate-editorial-content.js [--dry-run] [--target-path <path>]");
      console.log("Options:");
      console.log("  --dry-run, --simulate  Simulation sans écriture");
      console.log("  --target-path <path>   Chemin explicite vers site-content.json");
      process.exit(0);
    } else if (!arg.startsWith("-") && !targetPath) {
      targetPath = arg;
    }
  }

  const titleMode = dryRun ? " (Simulation sans écriture)" : "";
  console.log(`=== Remédiation éditoriale Parallax${titleMode} ===`);

  const res = remediateSiteContentEditorial({ targetPath, dryRun });

  if (!res.success) {
    console.error(`[ERREUR] ${res.reason || "Échec de l'opération"}${res.error ? ` : ${res.error}` : ""}`);
    process.exit(1);
  }

  if (!res.changed) {
    console.log("[OK] site-content.json : aucun changement requis, le contenu est déjà conforme.");
    return;
  }

  if (res.dryRun) {
    console.log(`[SIMULATION] site-content.json : ${res.modifiedFields.length} champ(s) à modifier :`);
    for (const f of res.modifiedFields) {
      console.log(`  - ${f}`);
    }
    console.log(`Bilan : ${res.modifiedFields.length} champ(s) identifié(s). Aucune écriture effectuée.`);
    return;
  }

  console.log(`[OK] site-content.json : ${res.modifiedFields.length} champ(s) éditoriaux modifiés.`);
  for (const f of res.modifiedFields) {
    console.log(`  - ${f}`);
  }
  console.log(`Sauvegarde privée créée : ${res.backupName}`);
  console.log(`Nouvelle révision : ${res.newRevision}`);
  console.log(`Bilan : ${res.modifiedFields.length} champ(s) mis à jour avec succès.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    loadEnvLocal();
  } catch (err) {
    console.warn(`[WARN] env-loader: ${err instanceof Error ? err.message : String(err)}`);
  }
  runRemediateEditorial();
}
