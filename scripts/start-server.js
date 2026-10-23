#!/usr/bin/env node
import path from "node:path";
import { getMonorepoRoot, loadEnvLocal } from "./env-loader.js";
import { runStartupValidation } from "../apps/web/scripts/validate-startup.js";

const rootDir = getMonorepoRoot();
const appsWebDir = path.resolve(rootDir, "apps/web");
const serverBuild = path.resolve(appsWebDir, "build/server/index.js");
const serveCli = path.resolve(rootDir, "node_modules/@react-router/serve/dist/cli.js");

// 1. Resolve configuration (.env.local or custom fixture)
const configPathIndex = process.argv.indexOf("--config-path");
const customConfigPath =
  configPathIndex !== -1 ? process.argv[configPathIndex + 1] : process.env.STARTUP_CONFIG_PATH;

loadEnvLocal(customConfigPath);

// 2. Ensure production environment defaults (never override pre-set environment)
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.HOST = process.env.HOST || "127.0.0.1";
process.env.PORT = process.env.PORT || "3000";

// Ensure preview mode is strictly disabled in production server
delete process.env.PARALLAX_LOCAL_PREVIEW;
delete process.env.PREVIEW_MODE;

// 3. Validate configuration before starting server
const isValid = runStartupValidation();
if (!isValid) {
  console.error("[CRITICAL] Échec du contrôle préalable de configuration. Démarrage interrompu.");
  process.exit(1);
}

// 4. Move working directory to apps/web for static public/ asset resolution
process.chdir(appsWebDir);

// 5. Pass build path to @react-router/serve and execute
process.argv = [
  process.argv[0],
  serveCli,
  serverBuild,
];

await import(serveCli);
