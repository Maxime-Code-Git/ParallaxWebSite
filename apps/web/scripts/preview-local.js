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

// 2. Set environment explicitly for local preview
process.env.NODE_ENV = "production";
process.env.PARALLAX_LOCAL_PREVIEW = "true";
process.env.HOST = "127.0.0.1";

const port = process.env.PORT || "3000";
process.env.PORT = port;

if (!process.env.PUBLIC_SITE_URL) {
  process.env.PUBLIC_SITE_URL = `http://127.0.0.1:${port}`;
}

// 3. Strict verification of local preview constraints
try {
  const parsed = new URL(process.env.PUBLIC_SITE_URL);
  if (parsed.protocol !== "http:") {
    throw new Error("PUBLIC_SITE_URL doit obligatoirement utiliser http:// en prévisualisation locale.");
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`Hostname '${parsed.hostname}' interdit. La prévisualisation locale est strictement bornée à 127.0.0.1 ou localhost.`);
  }
  if (process.env.TRUST_PROXY === "true") {
    throw new Error("TRUST_PROXY=true est interdit en prévisualisation locale.");
  }
} catch (err) {
  console.error("CRITICAL: Échec de validation du mode prévisualisation locale :");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// 4. Validate startup configuration
try {
  const { validateAdminConfig } = await import("../app/lib/env.server.ts");
  validateAdminConfig();
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
console.log(`URL à ouvrir    : http://127.0.0.1:${port}`);
console.log("==================================================");

// 6. Spawn react-router-serve
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
    },
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
