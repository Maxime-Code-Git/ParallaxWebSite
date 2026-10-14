#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import "../../../scripts/env-loader.js";

const isESM = typeof import.meta !== "undefined" && Boolean(import.meta.url);
const currentFile = isESM ? fileURLToPath(import.meta.url) : __filename;
const currentDir = resolve(currentFile, "..");
const appDir = resolve(currentDir, "..");

// 1. Verify that build exists
const buildServerPath = resolve(appDir, "build/server/index.js");
if (!existsSync(buildServerPath)) {
  console.error("CRITICAL: Le build de production est manquant ou incomplet.");
  console.error("Veuillez exécuter explicitement 'npm run build' avant 'npm run preview:local'.");
  process.exit(1);
}

// 2. Validate port strictly
const rawPort = (process.env.PORT || "3000").trim();
if (!/^\d+$/.test(rawPort)) {
  console.error(`CRITICAL: Port '${rawPort}' invalide. Le port doit etre compose exclusivement de chiffres.`);
  process.exit(1);
}
const numericPort = Number.parseInt(rawPort, 10);
if (numericPort < 1 || numericPort > 65535) {
  console.error(`CRITICAL: Port '${rawPort}' hors limites. Le port doit etre compris entre 1 et 65535.`);
  process.exit(1);
}
const port = String(numericPort);
process.env.PORT = port;

// 3. Validate HOST and TRUST_PROXY strictly for local preview
const rawHost = (process.env.HOST || "127.0.0.1").trim();
if (rawHost !== "127.0.0.1" && rawHost !== "localhost") {
  console.error(`CRITICAL: HOST '${rawHost}' invalide. PARALLAX_LOCAL_PREVIEW exige un bind loopback local (127.0.0.1 ou localhost).`);
  process.exit(1);
}
process.env.HOST = rawHost;

if (process.env.TRUST_PROXY === "true") {
  console.error("CRITICAL: PARALLAX_LOCAL_PREVIEW est incompatible avec TRUST_PROXY=true.");
  process.exit(1);
}
process.env.TRUST_PROXY = "false";

process.env.NODE_ENV = "production";
process.env.PARALLAX_LOCAL_PREVIEW = "true";
const canonicalSiteUrl = `http://127.0.0.1:${port}`;
process.env.PUBLIC_SITE_URL = canonicalSiteUrl;

// 4. Validate startup and content configuration
try {
  const { validateAdminConfig, validateContentConfig, validateMediaConfig, validatePortfolioConfig, validateGalleryConfig } = await import("../app/lib/env.server.ts");
  validateAdminConfig();
  validateContentConfig();
  validateMediaConfig();
  validatePortfolioConfig();
  validateGalleryConfig();
} catch (err) {
  console.error("CRITICAL: Configuration invalide au démarrage :");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// 5. User-facing informative message without any secrets
console.log("==================================================");
console.log(" Parallax - Prévisualisation locale du build ");
console.log("==================================================");
console.log(`Dossier courant : ${process.cwd()}`);
console.log(`Mode            : Prévisualisation locale (PARALLAX_LOCAL_PREVIEW=true, NODE_ENV=production)`);
console.log(`URL à ouvrir    : ${canonicalSiteUrl}`);
console.log("==================================================");

// 6. Spawn react-router-serve with canonical overrides
const child = spawn(
  "npx",
  ["react-router-serve", "./build/server/index.js"],
  {
    cwd: appDir,
    stdio: "inherit",
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: port,
      PUBLIC_SITE_URL: canonicalSiteUrl,
    },
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
