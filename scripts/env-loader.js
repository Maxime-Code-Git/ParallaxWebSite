import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const isESM = typeof import.meta !== "undefined" && Boolean(import.meta.url);
const currentFile = isESM ? fileURLToPath(import.meta.url) : __filename;
const currentDir = dirname(currentFile);

/**
 * Traverses upwards to find the root directory of the Parallax monorepo.
 */
export function getMonorepoRoot() {
  let rootDir = currentDir;
  while (rootDir !== "/" && rootDir !== ".") {
    const pkgPath = resolve(rootDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name === "parallax") {
          return rootDir;
        }
      } catch {
        // ignore JSON parse errors in unrelated intermediate directories
      }
    }
    const parentDir = dirname(rootDir);
    if (parentDir === rootDir) break;
    rootDir = parentDir;
  }
  return process.cwd(); // Fallback
}

/**
 * Loads .env.local into process.env without overriding existing variables.
 * Errors in reading or parsing an existing .env.local file are not ignored silently.
 */
export function loadEnvLocal(customPath) {
  const rootDir = getMonorepoRoot();
  const envPath = customPath || resolve(rootDir, ".env.local");

  if (!existsSync(envPath)) {
    return;
  }

  let content;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch (err) {
    throw new Error(`CRITICAL: Impossible de lire le fichier ${envPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  let parsed = {};
  try {
    if (typeof parseEnv === "function") {
      parsed = parseEnv(content);
    } else {
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          parsed[key] = value;
        }
      }
    }
  } catch (err) {
    throw new Error(`CRITICAL: Erreur de syntaxe dans ${envPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Automatically load when imported, except during tests.
// In test mode, process.env must be fully controlled by the test harness
// to prevent real secrets from leaking into test output.
if (process.env.NODE_ENV !== "test") {
  loadEnvLocal();
}
