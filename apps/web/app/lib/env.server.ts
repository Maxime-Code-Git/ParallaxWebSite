import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import "../../../../scripts/env-loader.js";

export function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`CRITICAL: La variable d'environnement ${name} est manquante. Veuillez verifier votre fichier .env.local.`);
  }
  return value;
}

function validateTestPath(val: string | undefined, name: string): string {
  if (!val) {
    throw new Error(`CRITICAL: ${name} est requise en mode test.`);
  }
  const resolved = path.resolve(val);
  const tmp = fs.realpathSync(os.tmpdir());
  let realResolved = resolved;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    // If resolved does not exist yet, resolve parent
    const parent = path.dirname(resolved);
    try {
      realResolved = path.join(fs.realpathSync(parent), path.basename(resolved));
    } catch {
      // Keep resolved
    }
  }

  const relTmp = path.relative(tmp, realResolved);
  if (relTmp.startsWith("..") || path.isAbsolute(relTmp)) {
    throw new Error(`CRITICAL: ${name} doit se trouver sous os.tmpdir() dans les tests.`);
  }

  const forbiddenDirs = ["public", "build", "app"].map((d) => path.join(process.cwd(), d));
  for (const fDir of forbiddenDirs) {
    let realFDir = fDir;
    try {
      realFDir = fs.realpathSync(fDir);
    } catch {
      // Ignored
    }
    const rel = path.relative(realFDir, realResolved);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      throw new Error(`CRITICAL: ${name} ne doit pas etre sous ${fDir} dans les tests.`);
    }
  }
  return resolved;
}

function validateProductionPath(val: string, name: string): string {
  if (!path.isAbsolute(val)) {
    throw new Error(`CRITICAL: La variable d'environnement ${name} doit etre un chemin absolu.`);
  }

  let realPathToCheck: string;
  let exists = false;
  let stat: fs.Stats | undefined;

  try {
    const lstat = fs.lstatSync(val);
    if (lstat.isSymbolicLink()) {
      throw new Error(`CRITICAL: ${name} ne doit pas etre un lien symbolique.`);
    }
    stat = fs.statSync(val);
    exists = true;
    realPathToCheck = fs.realpathSync(val);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "ENOENT") {
      // Does not exist yet, check parent
      const parentDir = path.dirname(val);
      try {
        const parentLstat = fs.lstatSync(parentDir);
        if (parentLstat.isSymbolicLink()) {
          throw new Error(`CRITICAL: Le dossier parent de ${name} ne doit pas etre un lien symbolique.`, { cause: err });
        }
        const parentStat = fs.statSync(parentDir);
        if (!parentStat.isDirectory()) {
          throw new Error(`CRITICAL: Le parent de ${name} doit etre un dossier.`, { cause: err });
        }
        fs.accessSync(parentDir, fs.constants.W_OK);
        realPathToCheck = fs.realpathSync(parentDir);
      } catch (parentErr) {
        if (parentErr instanceof Error && parentErr.message.startsWith("CRITICAL:")) {
          throw parentErr;
        }
        throw new Error(`CRITICAL: Le dossier parent de ${name} n'existe pas ou n'est pas inscriptible.`, { cause: parentErr });
      }
    } else {
      if (err instanceof Error && err.message.startsWith("CRITICAL:")) {
        throw err;
      }
      throw new Error(`CRITICAL: ${name} ou son dossier parent n'est pas inscriptible ou n'existe pas.`, { cause: err });
    }
  }

  if (exists && stat) {
    if (!stat.isFile()) {
      throw new Error(`CRITICAL: ${name} doit etre un fichier standard.`);
    }
    try {
      fs.accessSync(val, fs.constants.W_OK);
    } catch (accessErr) {
      throw new Error(`CRITICAL: ${name} n'est pas accessible en ecriture.`, { cause: accessErr });
    }
  }

  // Ensure path is not inside public, build, or source directories
  const forbiddenDirs = ["public", "build", "app"].map((d) => path.join(process.cwd(), d));
  for (const fDir of forbiddenDirs) {
    let realFDir = fDir;
    try {
      realFDir = fs.realpathSync(fDir);
    } catch {
      // Ignored
    }
    const rel = path.relative(realFDir, realPathToCheck);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      throw new Error(`CRITICAL: ${name} ne doit pas etre sous les dossiers public ou build.`);
    }
  }

  return val;
}

export const ENV = {
  get PUBLIC_SITE_URL(): string {
    const isProd = process.env.NODE_ENV === "production";
    const url = process.env.PUBLIC_SITE_URL || (isProd ? "" : "http://localhost:3000");
    if (!url) {
      throw new Error("CRITICAL: PUBLIC_SITE_URL est obligatoire.");
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("PROTOCOL_INVALID");
      }
      if (isProd && parsed.protocol !== "https:") {
        throw new Error("HTTPS_REQUIRED");
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "HTTPS_REQUIRED") {
        throw new Error("CRITICAL: PUBLIC_SITE_URL doit obligatoirement utiliser https:// en production.", { cause: e });
      }
      throw new Error("CRITICAL: PUBLIC_SITE_URL n'est pas une URL valide ou n'utilise pas HTTP/HTTPS.", { cause: e });
    }
    return url;
  },

  get ADMIN_PASSWORD_HASH(): string | undefined {
    const val = process.env.ADMIN_PASSWORD_HASH;
    if (val && !val.startsWith("$argon2id$")) {
      throw new Error("CRITICAL: ADMIN_PASSWORD_HASH doit utiliser le format Argon2id ($argon2id$).");
    }
    return val;
  },

  get ADMIN_SESSION_SECRET(): string | undefined {
    const val = process.env.ADMIN_SESSION_SECRET;
    if (val && val.length < 32) {
      throw new Error("CRITICAL: ADMIN_SESSION_SECRET doit comporter au moins 32 caracteres.");
    }
    return val;
  },

  get RATE_LIMIT_SECRET(): string {
    const val = process.env.RATE_LIMIT_SECRET;
    if (!val || val.length < 32) {
      throw new Error("CRITICAL: RATE_LIMIT_SECRET doit comporter au moins 32 caracteres.");
    }
    return val;
  },

  get RATE_LIMIT_DB_PATH(): string {
    const isProd = process.env.NODE_ENV === "production";
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.RATE_LIMIT_DB_PATH;

    if (isProd) {
      if (!val) {
        throw new Error("CRITICAL: RATE_LIMIT_DB_PATH est obligatoire en production.");
      }
      return validateProductionPath(val, "RATE_LIMIT_DB_PATH");
    }

    if (isTest) {
      return validateTestPath(val, "RATE_LIMIT_DB_PATH");
    }

    if (val) {
      return validateProductionPath(val, "RATE_LIMIT_DB_PATH");
    }

    return path.resolve("./data/rate-limit.sqlite");
  },

  get TRUST_PROXY(): boolean {
    return process.env.TRUST_PROXY === "true";
  },
};
