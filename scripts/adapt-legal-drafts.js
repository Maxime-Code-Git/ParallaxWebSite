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

export function runAdaptLegalDrafts(targetPath) {
  const siteContentPath = targetPath || resolveSiteContentPath();

  if (!fs.existsSync(siteContentPath)) {
    console.error(`[ERREUR] Fichier de configuration introuvable : ${siteContentPath}`);
    return { success: false, reason: "file_not_found" };
  }

  let currentContent;
  try {
    currentContent = JSON.parse(fs.readFileSync(siteContentPath, "utf-8"));
  } catch (err) {
    console.error(`[ERREUR] Le fichier ${siteContentPath} est corrompu ou illisible.`, err);
    return { success: false, reason: "corrupted" };
  }

  if (!currentContent.legalPages) {
    console.error("[ERREUR] Le fichier ne contient pas de section legalPages.");
    return { success: false, reason: "missing_legal_pages" };
  }

  let needsUpdate = false;
  const updatedLegalPages = structuredClone(currentContent.legalPages);
  const adaptedKeys = [];

  // 1. Check and adapt terms draft dispute clause
  const termsRecord = updatedLegalPages.terms;
  if (termsRecord?.draft?.sections) {
    const disputesSec = termsRecord.draft.sections.find((s) => s.id === "disputes_law");
    if (disputesSec) {
      let sectionUpdated = false;
      const neutralDisputeFr =
        "Compétence juridictionnelle : À défaut de résolution amiable, tout litige relatif à la formation, l'exécution ou l'interprétation des présentes conditions générales sera soumis aux juridictions compétentes selon les règles du droit commun belge, sous réserve des dispositions légales impératives protectrices des consommateurs.";
      const neutralDisputeEn =
        "Jurisdiction: Failing amicable settlement, any dispute concerning the formation, performance, or interpretation of these terms and conditions shall be brought before the competent courts in accordance with the ordinary rules of Belgian law, subject to mandatory statutory consumer protection provisions.";

      const updatedParagraphs = disputesSec.paragraphs.map((p) => {
        if (
          p.fr.includes("{{company.rpmJurisdiction}}") ||
          p.fr.includes("ou Bruxelles") ||
          p.fr.includes("compétence exclusive est attribuée aux tribunaux")
        ) {
          sectionUpdated = true;
          return {
            fr: neutralDisputeFr,
            en: neutralDisputeEn,
          };
        }
        return p;
      });

      if (sectionUpdated) {
        disputesSec.paragraphs = updatedParagraphs;
        needsUpdate = true;
        adaptedKeys.push("terms");
      }
    }
  }

  // 2. Check company legalPersonality and vatRegimeType normalization
  let companyUpdated = false;
  const updatedCompany = structuredClone(currentContent.company || {});

  if (!updatedCompany.legalPersonality) {
    const form = (updatedCompany.legalForm || "").trim().toLowerCase();
    if (
      form === "personne physique" ||
      form === "indépendant" ||
      form === "entreprise individuelle"
    ) {
      updatedCompany.legalPersonality = "natural_person";
      companyUpdated = true;
      needsUpdate = true;
    } else if (
      form === "association de fait" ||
      form === "association sans personnalité juridique" ||
      form === "indivision"
    ) {
      updatedCompany.legalPersonality = "unincorporated_association";
      companyUpdated = true;
      needsUpdate = true;
    } else if (
      form === "srl" ||
      form === "sa" ||
      form === "asbl" ||
      form === "sc" ||
      form.startsWith("société")
    ) {
      updatedCompany.legalPersonality = "legal_entity";
      companyUpdated = true;
      needsUpdate = true;
    }
  }

  if (!updatedCompany.vatRegimeType) {
    const regime = (updatedCompany.vatRegime || "").trim().toLowerCase();
    if (regime.includes("non assujetti") || regime.includes("hors champ")) {
      updatedCompany.vatRegimeType = "non_subject";
      companyUpdated = true;
      needsUpdate = true;
    } else if (regime.includes("franchise") || regime.includes("56bis")) {
      updatedCompany.vatRegimeType = "small_business_exemption";
      companyUpdated = true;
      needsUpdate = true;
    } else if (regime.includes("normal") || regime.includes("assujetti")) {
      updatedCompany.vatRegimeType = "standard";
      companyUpdated = true;
      needsUpdate = true;
    }
  }

  if (!needsUpdate) {
    console.log("[OK] Aucune adaptation requise, les brouillons et paramètres sont déjà à jour.");
    console.log("Aucune modification nécessaire. Aucun nouveau fichier ni backup n'a été créé.");
    return { success: true, changed: false, newRevision: currentContent.revision };
  }

  // Create an explicit private safety backup out of rotation (0o600 permissions)
  const dir = path.dirname(siteContentPath);
  const baseName = path.basename(siteContentPath, ".json");
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const safetyBackupPath = path.join(
    dir,
    `${baseName}.pre-legal-adaptation-${timestamp}-${randomSuffix}.safety.bak`
  );
  fs.copyFileSync(siteContentPath, safetyBackupPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(safetyBackupPath, 0o600);

  const nextRevision = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();

  const nextContent = {
    ...currentContent,
    revision: nextRevision,
    updatedAt: now,
    company: companyUpdated ? updatedCompany : currentContent.company,
    legalPages: updatedLegalPages,
  };

  atomicWrite(siteContentPath, nextContent);

  console.log("[SUCCÈS] Adaptation ciblée des brouillons et paramètres effectuée avec succès.");
  if (adaptedKeys.length > 0) {
    console.log(`Brouillons adaptés : ${adaptedKeys.join(", ")}`);
  }
  if (companyUpdated) {
    console.log("Paramètres d'entreprise complétés : situation juridique / régime TVA.");
  }
  console.log(`Sauvegarde de sécurité créée : ${path.basename(safetyBackupPath)}`);
  console.log(`Nouvelle révision : ${nextRevision}`);
  console.log("Important : Tous les documents publiés existants sont restés intacts.");
  console.log("Les mentions légales et CGV restent à l'état de brouillon non publié pour relecture par Maxime.");

  return {
    success: true,
    changed: true,
    adaptedKeys,
    backupPath: safetyBackupPath,
    newRevision: nextRevision,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const result = runAdaptLegalDrafts();
  if (!result.success) {
    process.exit(1);
  }
}
