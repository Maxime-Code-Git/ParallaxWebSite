#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const monorepoRoot = path.resolve(__dirname, "..");

export function cleanTypography(str) {
  if (!str || typeof str !== "string") return "";
  let s = str.replace(/&mdash;|&#8212;|&#x2014;/gi, "\u2014");

  if (!s.includes("\u2014")) return s;

  // 1. Legal incise: " — incluant de manière non limitative ... — " -> " (incluant de manière non limitative ...) "
  s = s.replace(
    /\s*\u2014\s*(incluant de manière non limitative [^\u2014]+?)\s*\u2014\s*/gi,
    " ($1) "
  );
  s = s.replace(
    /\s*\u2014\s*(including without limitation [^\u2014]+?)\s*\u2014\s*/gi,
    " ($1) "
  );

  // 2. Juxtaposed postal addresses and contact details (APD, Consumer Mediation)
  s = s.replace(
    /(\d{4}\s+(?:Bruxelles|Brussels))\s*\u2014\s*(Téléphone|Phone)\s*:\s*([^\u2014]+?)\s*\u2014\s*(E-mail|Email)\s*:\s*([^\u2014]+?)\s*\u2014\s*(Site officiel|Official website|Site)\s*:\s*(\S+)/gi,
    "$1 | $2 : $3 | $4 : $5 | $6 : $7"
  );

  // 3. BCE and VAT mentions
  s = s.replace(
    /\s*\u2014\s*(Numéro de TVA intracommunautaire)/gi,
    ", numéro de TVA intracommunautaire"
  );
  s = s.replace(
    /\s*\u2014\s*(Intra-community VAT number)/gi,
    ", intra-community VAT number"
  );
  s = s.replace(/\s*\u2014\s*(Régime TVA)/gi, ", régime TVA");
  s = s.replace(/\s*\u2014\s*(VAT regime)/gi, ", VAT regime");

  // 4. B2B / B2C mentions in parentheses
  s = s.replace(/\s*\u2014\s*(B2[BC]\))/g, ", $1");

  // 5. Explicit editorial descriptions requested by Maxime
  s = s.replace(
    /Des films qui racontent le réel\s*\u2014\s*portraits de métiers/g,
    "Des films qui racontent le réel : portraits de métiers"
  );
  s = s.replace(
    /Films that tell real stories\s*\u2014\s*portraits of trades/g,
    "Films that tell real stories: portraits of trades"
  );
  s = s.replace(
    /Des films de marque et de produit\s*\u2014\s*studio/g,
    "Des films de marque et de produit : studio"
  );
  s = s.replace(
    /Brand and product films\s*\u2014\s*studio/g,
    "Brand and product films: studio"
  );
  s = s.replace(
    /Ce que ce projet raconte\s*\u2014\s*son émotion/g,
    "Ce que ce projet raconte : son émotion"
  );
  s = s.replace(
    /What this project carries\s*\u2014\s*its emotion/g,
    "What this project carries: its emotion"
  );

  // 6. Title brand suffix: " — Parallax" -> " | Parallax"
  s = s.replace(/\s*\u2014\s*(Parallax)/g, " | $1");

  // 7. General fallback for any remaining em-dashes
  s = s.replace(/\s*\u2014\s*/g, " | ");
  s = s.replace(/\u2014/g, " - ");

  // Clean double spaces and spacing before closing parenthesis
  s = s.replace(/\s+\)/g, ")").replace(/[ ]{2,}/g, " ").trim();
  return s;
}

function resolvePathFromEnv(varName, defaultFilename) {
  if (process.env[varName]) {
    return path.resolve(process.env[varName]);
  }
  const envLocalPath = path.join(monorepoRoot, ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${varName}=`)) {
        const val = trimmed.slice(`${varName}=`.length).replace(/^["']|["']$/g, "").trim();
        if (val) return path.resolve(val);
      }
    }
  }
  return path.join(os.homedir(), ".parallax-data", defaultFilename);
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

export function adaptPortfolioContent(targetPath) {
  const filePath = targetPath || resolvePathFromEnv("PORTFOLIO_CONTENT_PATH", "portfolio-content.json");
  if (!fs.existsSync(filePath)) {
    return { success: false, reason: "file_not_found" };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.includes("\u2014")) {
    return { success: true, changed: false };
  }

  let content;
  try {
    content = JSON.parse(raw);
  } catch (err) {
    return { success: false, reason: "corrupted", error: err };
  }

  let changed = false;

  // Clean overview SEO
  if (content.overview?.seo?.title) {
    for (const l of ["fr", "en"]) {
      if (content.overview.seo.title[l]) {
        const cleaned = cleanTypography(content.overview.seo.title[l]);
        if (cleaned !== content.overview.seo.title[l]) {
          content.overview.seo.title[l] = cleaned;
          changed = true;
        }
      }
    }
  }

  // Clean categories and sections
  function cleanCategory(cat) {
    if (!cat) return;
    for (const field of ["intro", "entrySummary"]) {
      if (cat[field]) {
        for (const l of ["fr", "en"]) {
          if (cat[field][l]) {
            const cleaned = cleanTypography(cat[field][l]);
            if (cleaned !== cat[field][l]) {
              cat[field][l] = cleaned;
              changed = true;
            }
          }
        }
      }
    }
    if (cat.seo) {
      for (const field of ["title", "description"]) {
        if (cat.seo[field]) {
          for (const l of ["fr", "en"]) {
            if (cat.seo[field][l]) {
              const cleaned = cleanTypography(cat.seo[field][l]);
              if (cleaned !== cat.seo[field][l]) {
                cat.seo[field][l] = cleaned;
                changed = true;
              }
            }
          }
        }
      }
    }
  }

  if (Array.isArray(content.categories)) {
    content.categories.forEach(cleanCategory);
  }
  if (content.sections && typeof content.sections === "object") {
    Object.values(content.sections).forEach(cleanCategory);
  }

  // Clean projects
  if (Array.isArray(content.projects)) {
    content.projects.forEach((proj) => {
      if (Array.isArray(proj.description)) {
        proj.description.forEach((block) => {
          if (block.text) {
            for (const l of ["fr", "en"]) {
              if (block.text[l]) {
                const cleaned = cleanTypography(block.text[l]);
                if (cleaned !== block.text[l]) {
                  block.text[l] = cleaned;
                  changed = true;
                }
              }
            }
          }
        });
      }
      if (proj.seo) {
        for (const field of ["title", "description"]) {
          if (proj.seo[field]) {
            for (const l of ["fr", "en"]) {
              if (proj.seo[field][l]) {
                const cleaned = cleanTypography(proj.seo[field][l]);
                if (cleaned !== proj.seo[field][l]) {
                  proj.seo[field][l] = cleaned;
                  changed = true;
                }
              }
            }
          }
        }
      }
    });
  }

  if (!changed) {
    return { success: true, changed: false };
  }

  const backupName = createSafetyBackup(filePath);
  content.updatedAt = new Date().toISOString();
  atomicWrite(filePath, content);

  return { success: true, changed: true, backupName };
}

export function adaptSiteContentDrafts(targetPath) {
  const filePath = targetPath || resolvePathFromEnv("SITE_CONTENT_PATH", "site-content.json");
  if (!fs.existsSync(filePath)) {
    return { success: false, reason: "file_not_found" };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  let content;
  try {
    content = JSON.parse(raw);
  } catch (err) {
    return { success: false, reason: "corrupted", error: err };
  }

  if (!content.legalPages) {
    return { success: false, reason: "missing_legal_pages" };
  }

  let changed = false;

  // Adapt ONLY editable drafts; strictly leave published snapshots intact on disk!
  for (const pageKey of Object.keys(content.legalPages)) {
    const page = content.legalPages[pageKey];
    if (page?.draft?.sections && Array.isArray(page.draft.sections)) {
      page.draft.sections.forEach((sec) => {
        if (Array.isArray(sec.paragraphs)) {
          sec.paragraphs.forEach((p) => {
            for (const l of ["fr", "en"]) {
              if (p[l] && p[l].includes("\u2014")) {
                const cleaned = cleanTypography(p[l]);
                if (cleaned !== p[l]) {
                  p[l] = cleaned;
                  changed = true;
                }
              }
            }
          });
        }
      });
    }
  }

  if (!changed) {
    return { success: true, changed: false };
  }

  const backupName = createSafetyBackup(filePath);
  content.revision = crypto.randomBytes(16).toString("hex");
  content.updatedAt = new Date().toISOString();
  atomicWrite(filePath, content);

  return { success: true, changed: true, backupName, newRevision: content.revision };
}

export function runAdaptTypography() {
  console.log("=== Adaptation typographique ciblée des contenus Parallax ===");

  const pRes = adaptPortfolioContent();
  if (pRes.changed) {
    console.log(`[OK] portfolio-content.json adapté (backup: ${pRes.backupName})`);
  } else {
    console.log("[OK] portfolio-content.json : aucun changement requis.");
  }

  const sRes = adaptSiteContentDrafts();
  if (sRes.changed) {
    console.log(`[OK] site-content.json brouillons adaptés (backup: ${sRes.backupName}, révision: ${sRes.newRevision})`);
  } else {
    console.log("[OK] site-content.json : aucun changement requis sur les brouillons.");
  }

  console.log("Important : Tous les snapshots légaux publiés sont restés strictement préservés sur le disque.");
  console.log("La normalisation s'applique en temps réel à l'affichage pour garantir zéro cadratin.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAdaptTypography();
}
