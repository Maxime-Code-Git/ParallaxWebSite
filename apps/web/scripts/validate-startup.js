#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateAdminConfig, validateContentConfig, validateMediaConfig } from "../app/lib/env.server.ts";

export function runStartupValidation() {
  try {
    validateAdminConfig();
    validateContentConfig();
    validateMediaConfig();
    console.log("Configuration de demarrage valide avec succes.");
    return true;
  } catch (err) {
    console.error("Erreur critique de configuration au demarrage :");
    console.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

// Auto-run when executed directly as CLI script
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const success = runStartupValidation();
  process.exit(success ? 0 : 1);
}
