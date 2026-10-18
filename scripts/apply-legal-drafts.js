#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const monorepoRoot = path.resolve(__dirname, "..");

function resolveSiteContentPath() {
  if (process.env.SITE_CONTENT_PATH) {
    return path.resolve(process.env.SITE_CONTENT_PATH);
  }
  const envLocalPath = path.join(monorepoRoot, ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("SITE_CONTENT_PATH=")) {
        const val = trimmed.slice("SITE_CONTENT_PATH=".length).replace(/^["']|["']$/g, "").trim();
        if (val) return path.resolve(val);
      }
    }
  }
  return path.join(os.homedir(), ".parallax-data", "site-content.json");
}

function atomicWrite(targetPath, data) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempPath, targetPath);
}

export function runApplyLegalDrafts(targetPath) {
  const siteContentPath = targetPath || resolveSiteContentPath();

  if (!fs.existsSync(siteContentPath)) {
    console.error(`[ERREUR] Fichier de configuration introuvable : ${siteContentPath}`);
    return { success: false, reason: "file_not_found" };
  }

  const defaultContentPath = path.join(monorepoRoot, "apps", "web", "app", "content", "default-site-content.json");
  if (!fs.existsSync(defaultContentPath)) {
    console.error(`[ERREUR] Fichier de référence introuvable : ${defaultContentPath}`);
    return { success: false, reason: "reference_not_found" };
  }

  let currentContent;
  try {
    currentContent = JSON.parse(fs.readFileSync(siteContentPath, "utf-8"));
  } catch (err) {
    console.error(`[ERREUR] Le fichier ${siteContentPath} est corrompu ou illisible.`, err);
    return { success: false, reason: "corrupted" };
  }

  const defaultContent = JSON.parse(fs.readFileSync(defaultContentPath, "utf-8"));
  const targetKeys = ["mentions", "privacy", "terms", "cookies"];

  // Idempotency check: compare existing draft sections & intro
  let needsUpdate = false;
  for (const key of targetKeys) {
    const existingDraft = currentContent.legalPages?.[key]?.draft;
    const refDraft = defaultContent.legalPages?.[key]?.draft;
    if (!existingDraft || !refDraft) {
      needsUpdate = true;
      break;
    }
    if (existingDraft.sections.length !== refDraft.sections.length) {
      needsUpdate = true;
      break;
    }
    if (existingDraft.intro?.fr !== refDraft.intro?.fr) {
      needsUpdate = true;
      break;
    }
    if (key === "cookies") {
      if ((existingDraft.inventory?.length ?? 0) !== (refDraft.inventory?.length ?? 0)) {
        needsUpdate = true;
        break;
      }
    }
  }

  if (!needsUpdate) {
    console.log("[OK] Les 4 brouillons légaux sont déjà à jour avec la rédaction de référence.");
    console.log("Aucune modification nécessaire. Aucun nouveau fichier ni backup n'a été créé.");
    return { success: true, changed: false, newRevision: currentContent.revision };
  }

  // Create an explicit private safety backup out of rotation
  const dir = path.dirname(siteContentPath);
  const baseName = path.basename(siteContentPath, ".json");
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const safetyBackupPath = path.join(dir, `${baseName}.pre-legal-drafts-${timestamp}-${randomSuffix}.safety.bak`);
  fs.copyFileSync(siteContentPath, safetyBackupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(safetyBackupPath, 0o600);

  // Update drafts, preserving published docs, version counters, other content sections, and media registry
  const updatedLegalPages = structuredClone(currentContent.legalPages || {});
  const now = new Date().toISOString();
  const appliedKeys = [];

  for (const key of targetKeys) {
    const existingRecord = updatedLegalPages[key];
    const refDraft = structuredClone(defaultContent.legalPages[key].draft);
    const existingVersion = existingRecord?.draft?.version ?? 0;
    const existingEffective = existingRecord?.draft?.effectiveDate || "";

    updatedLegalPages[key] = {
      draft: {
        ...refDraft,
        version: existingVersion,
        effectiveDate: existingEffective,
      },
      published: existingRecord?.published ?? null,
      lastUpdated: now,
    };
    appliedKeys.push(key);
  }

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const nextContent = {
    ...currentContent,
    schemaVersion: 3,
    revision: nextRevision,
    updatedAt: now,
    legalPages: updatedLegalPages,
  };

  atomicWrite(siteContentPath, nextContent);

  console.log("[SUCCÈS] Les 4 brouillons légaux ont été appliqués avec succès.");
  console.log(`Documents mis à jour en brouillon : ${appliedKeys.join(", ")}`);
  console.log(`Sauvegarde de sécurité créée : ${path.basename(safetyBackupPath)}`);
  console.log(`Nouvelle révision : ${nextRevision}`);
  console.log("Important : Tous les documents restent à l'état de brouillon non publié.");
  console.log("Maxime pourra compléter ses paramètres dans /admin/company, relire les textes dans /admin/legal, puis procéder à la publication manuelle.");

  return {
    success: true,
    changed: true,
    appliedKeys,
    backupPath: safetyBackupPath,
    newRevision: nextRevision,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const result = runApplyLegalDrafts();
  if (!result.success) {
    process.exit(1);
  }
}
