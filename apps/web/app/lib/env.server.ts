import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { getMonorepoRoot } from "../../../../scripts/env-loader.js";

export const ARGON2ID_HASH_REGEX = /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

export function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`CRITICAL: La variable d'environnement ${name} est manquante. Veuillez verifier votre fichier .env.local.`);
  }
  return value;
}

function checkNoSymlinksInPath(filePath: string, name: string): void {
  const resolved = path.resolve(filePath);
  const parts = resolved.split(path.sep).filter(Boolean);

  let startIndex = 0;
  if (process.platform === "darwin" && parts.length > 0) {
    if (["var", "tmp", "etc"].includes(parts[0])) {
      startIndex = 1;
    }
  }

  let currentPath = path.isAbsolute(resolved) ? path.sep : "";
  for (let i = 0; i < parts.length; i++) {
    currentPath = path.join(currentPath, parts[i]);
    if (i >= startIndex) {
      try {
        const lstat = fs.lstatSync(currentPath);
        if (lstat.isSymbolicLink()) {
          throw new Error(`CRITICAL: Le composant ${currentPath} de ${name} ne doit pas etre un lien symbolique.`);
        }
      } catch (err: unknown) {
        if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "ENOENT") {
          break;
        }
        if (err instanceof Error && err.message.startsWith("CRITICAL:")) {
          throw err;
        }
        throw new Error(`CRITICAL: Erreur d'acces a ${currentPath} pour ${name}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
    }
  }
}

function validateTestPath(val: string | undefined, name: string): string {
  if (!val) {
    throw new Error(`CRITICAL: ${name} est requise en mode test.`);
  }
  if (!path.isAbsolute(val)) {
    throw new Error(`CRITICAL: ${name} doit etre un chemin absolu.`);
  }

  checkNoSymlinksInPath(val, name);

  const resolved = path.resolve(val);
  const tmp = fs.realpathSync(os.tmpdir());
  let realResolved = resolved;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    const parent = path.dirname(resolved);
    try {
      realResolved = path.join(fs.realpathSync(parent), path.basename(resolved));
    } catch {
      // Use resolved as-is if parent doesn't exist yet
    }
  }

  const relTmp = path.relative(tmp, realResolved);
  if (relTmp.startsWith("..") || path.isAbsolute(relTmp)) {
    throw new Error(`CRITICAL: ${name} doit se trouver sous os.tmpdir() dans les tests.`);
  }

  const repoRoot = getMonorepoRoot();
  let realRepoRoot = repoRoot;
  try {
    realRepoRoot = fs.realpathSync(repoRoot);
  } catch {
    // Ignored
  }

  const relRepo = path.relative(realRepoRoot, realResolved);
  if (!relRepo.startsWith("..") && !path.isAbsolute(relRepo)) {
    throw new Error(`CRITICAL: ${name} ne doit pas se trouver dans le depot du projet.`);
  }

  return resolved;
}

function validateStoragePath(val: string | undefined, name: string): string {
  if (!val) {
    throw new Error(`CRITICAL: La variable d'environnement ${name} est obligatoire.`);
  }
  if (!path.isAbsolute(val)) {
    throw new Error(`CRITICAL: La variable d'environnement ${name} doit etre un chemin absolu.`);
  }

  checkNoSymlinksInPath(val, name);

  const resolved = path.resolve(val);
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
    throw new Error(`CRITICAL: ${name} ne doit pas se trouver dans le depot du projet.`);
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

  const rel = path.relative(realRepoRoot, realPathToCheck);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error(`CRITICAL: ${name} ne doit pas se trouver dans le depot du projet.`);
  }

  return val;
}

function validateStorageDirectoryPath(val: string | undefined, name: string): string {
  if (!val) {
    throw new Error(`CRITICAL: La variable d'environnement ${name} est obligatoire.`);
  }
  if (!path.isAbsolute(val)) {
    throw new Error(`CRITICAL: La variable d'environnement ${name} doit etre un chemin absolu.`);
  }

  checkNoSymlinksInPath(val, name);

  const resolved = path.resolve(val);
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
    throw new Error(`CRITICAL: ${name} ne doit pas se trouver dans le depot du projet.`);
  }

  let realPathToCheck: string;
  let stat: fs.Stats | undefined;

  try {
    const lstat = fs.lstatSync(val);
    if (lstat.isSymbolicLink()) {
      throw new Error(`CRITICAL: ${name} ne doit pas etre un lien symbolique.`);
    }
    stat = fs.statSync(val);
    realPathToCheck = fs.realpathSync(val);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "ENOENT") {
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
        fs.mkdirSync(val, { recursive: true, mode: 0o700 });
        try {
          fs.chmodSync(val, 0o700);
        } catch {
          // best-effort
        }
        stat = fs.statSync(val);
        realPathToCheck = fs.realpathSync(val);
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

  if (stat) {
    if (!stat.isDirectory()) {
      throw new Error(`CRITICAL: ${name} doit etre un repertoire.`);
    }
    try {
      fs.accessSync(val, fs.constants.W_OK);
      try {
        fs.chmodSync(val, 0o700);
      } catch {
        // best-effort
      }
    } catch (accessErr) {
      throw new Error(`CRITICAL: ${name} n'est pas accessible en ecriture.`, { cause: accessErr });
    }
  }

  const rel = path.relative(realRepoRoot, realPathToCheck);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error(`CRITICAL: ${name} ne doit pas se trouver dans le depot du projet.`);
  }

  return realPathToCheck;
}

export const ENV = {
  get PUBLIC_SITE_URL(): string {
    const isProd = process.env.NODE_ENV === "production";
    const isLocalPreview = process.env.PARALLAX_LOCAL_PREVIEW === "true";
    const url = process.env.PUBLIC_SITE_URL || (isProd && !isLocalPreview ? "" : "http://localhost:3000");
    if (!url) {
      throw new Error("CRITICAL: PUBLIC_SITE_URL est obligatoire.");
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("PROTOCOL_INVALID");
      }
      if (isLocalPreview) {
        isLocalPreviewMode();
      } else if (isProd && parsed.protocol !== "https:") {
        throw new Error("HTTPS_REQUIRED");
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        if (e.message === "PREVIEW_PROXY_FORBIDDEN") {
          throw new Error("CRITICAL: PARALLAX_LOCAL_PREVIEW est incompatible avec TRUST_PROXY=true.", { cause: e });
        }
        if (e.message === "PREVIEW_HOST_INVALID") {
          throw new Error("CRITICAL: PARALLAX_LOCAL_PREVIEW n'est autorise qu'avec une URL HTTP sur 127.0.0.1 ou localhost.", { cause: e });
        }
        if (e.message === "HTTPS_REQUIRED") {
          throw new Error("CRITICAL: PUBLIC_SITE_URL doit obligatoirement utiliser https:// en production.", { cause: e });
        }
      }
      throw new Error("CRITICAL: PUBLIC_SITE_URL n'est pas une URL valide ou n'utilise pas HTTP/HTTPS.", { cause: e });
    }
    return url;
  },

  get ADMIN_PASSWORD_HASH(): string | undefined {
    const val = process.env.ADMIN_PASSWORD_HASH;
    if (val && !ARGON2ID_HASH_REGEX.test(val)) {
      throw new Error("CRITICAL: ADMIN_PASSWORD_HASH doit utiliser le format standard Argon2id ($argon2id$v=...$m=...,t=...,p=...$salt$hash).");
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
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.RATE_LIMIT_DB_PATH;

    if (isTest) {
      return validateTestPath(val, "RATE_LIMIT_DB_PATH");
    }

    return validateStoragePath(val, "RATE_LIMIT_DB_PATH");
  },

  get SITE_CONTENT_PATH(): string {
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.SITE_CONTENT_PATH;

    if (isTest) {
      return validateTestPath(val, "SITE_CONTENT_PATH");
    }

    return validateStoragePath(val, "SITE_CONTENT_PATH");
  },

  get SITE_MEDIA_PATH(): string {
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.SITE_MEDIA_PATH;

    if (isTest) {
      const p = validateTestPath(val, "SITE_MEDIA_PATH");
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true, mode: 0o700 });
      }
      return p;
    }

    return validateStorageDirectoryPath(val, "SITE_MEDIA_PATH");
  },

  get PORTFOLIO_CONTENT_PATH(): string {
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.PORTFOLIO_CONTENT_PATH;

    if (isTest) {
      return validateTestPath(val, "PORTFOLIO_CONTENT_PATH");
    }

    return validateStoragePath(val, "PORTFOLIO_CONTENT_PATH");
  },

  get PORTFOLIO_MEDIA_PATH(): string {
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.PORTFOLIO_MEDIA_PATH;

    if (isTest) {
      const p = validateTestPath(val, "PORTFOLIO_MEDIA_PATH");
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true, mode: 0o700 });
      }
      return p;
    }

    return validateStorageDirectoryPath(val, "PORTFOLIO_MEDIA_PATH");
  },

  get GALLERY_DB_PATH(): string {
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.GALLERY_DB_PATH;

    if (isTest) {
      return validateTestPath(val, "GALLERY_DB_PATH");
    }

    return validateStoragePath(val, "GALLERY_DB_PATH");
  },

  get GALLERY_MEDIA_PATH(): string {
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.GALLERY_MEDIA_PATH;

    if (isTest) {
      const p = validateTestPath(val, "GALLERY_MEDIA_PATH");
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true, mode: 0o700 });
      }
      return p;
    }

    return validateStorageDirectoryPath(val, "GALLERY_MEDIA_PATH");
  },

  get GALLERY_IMPORT_PATH(): string {
    const isTest = process.env.NODE_ENV === "test";
    const val = process.env.GALLERY_IMPORT_PATH;

    if (isTest) {
      const p = validateTestPath(val, "GALLERY_IMPORT_PATH");
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true, mode: 0o700 });
      }
      return p;
    }

    return validateStorageDirectoryPath(val, "GALLERY_IMPORT_PATH");
  },

  get GALLERY_SECRET(): string {
    const val = process.env.GALLERY_SECRET;
    if (!val || val.length !== 64 || !HEX_64_REGEX.test(val)) {
      throw new Error("CRITICAL: GALLERY_SECRET doit etre une chaine hexadecimale de 32 octets (64 caracteres).");
    }
    return val;
  },

  get GALLERY_CODE_ENCRYPTION_KEY(): string {
    const val = process.env.GALLERY_CODE_ENCRYPTION_KEY;
    if (!val || val.length !== 64 || !HEX_64_REGEX.test(val)) {
      throw new Error("CRITICAL: GALLERY_CODE_ENCRYPTION_KEY doit etre une chaine hexadecimale de 32 octets (64 caracteres).");
    }
    return val;
  },

  get TRUST_PROXY(): boolean {
    return process.env.TRUST_PROXY === "true";
  },

  get PARALLAX_LOCAL_PREVIEW(): boolean {
    return process.env.PARALLAX_LOCAL_PREVIEW === "true";
  },
};

export const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;

function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function ensureDisjoint(pathA: string, pathB: string, nameA: string, nameB: string): void {
  const resA = path.resolve(pathA);
  const resB = path.resolve(pathB);
  if (resA === resB) {
    throw new Error(`CRITICAL: ${nameA} et ${nameB} ne doivent pas pointer vers le meme chemin.`);
  }
  const relA = path.relative(resA, resB);
  const relB = path.relative(resB, resA);
  if (!relA.startsWith("..") && !path.isAbsolute(relA)) {
    throw new Error(`CRITICAL: ${nameB} ne doit pas etre a l'interieur de ${nameA}.`);
  }
  if (!relB.startsWith("..") && !path.isAbsolute(relB)) {
    throw new Error(`CRITICAL: ${nameA} ne doit pas etre a l'interieur de ${nameB}.`);
  }
}

export function isLocalPreviewMode(): boolean {
  if (process.env.PARALLAX_LOCAL_PREVIEW !== "true") return false;
  if (process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY !== "false") {
    throw new Error("CRITICAL: PARALLAX_LOCAL_PREVIEW est incompatible avec TRUST_PROXY=true (exige explicitement TRUST_PROXY=false).");
  }
  const host = process.env.HOST;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`CRITICAL: PARALLAX_LOCAL_PREVIEW exige un bind loopback local explicite (HOST=127.0.0.1 ou localhost). Bind '${host}' interdit.`);
  }
  const url = process.env.PUBLIC_SITE_URL || "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")) {
      throw new Error("CRITICAL: PARALLAX_LOCAL_PREVIEW n'est autorise qu'avec une URL HTTP sur 127.0.0.1 ou localhost.");
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("CRITICAL:")) throw e;
    throw new Error("CRITICAL: PARALLAX_LOCAL_PREVIEW n'est autorise qu'avec une URL HTTP sur 127.0.0.1 ou localhost.", { cause: e });
  }
  return true;
}

export function validateContentConfig(): string {
  return ENV.SITE_CONTENT_PATH;
}

export function validateMediaConfig(): string {
  return ENV.SITE_MEDIA_PATH;
}

export function validatePortfolioContentConfig(): string {
  return ENV.PORTFOLIO_CONTENT_PATH;
}

export function validatePortfolioMediaConfig(): string {
  return ENV.PORTFOLIO_MEDIA_PATH;
}

export function validatePortfolioConfig(): { contentPath: string; mediaPath: string } {
  return {
    contentPath: ENV.PORTFOLIO_CONTENT_PATH,
    mediaPath: ENV.PORTFOLIO_MEDIA_PATH,
  };
}

export interface GalleryConfig {
  dbPath: string;
  mediaPath: string;
  importPath: string;
  secret: string;
  codeEncryptionKey: string;
}

export function validateGalleryConfig(): GalleryConfig {
  const isTest = process.env.NODE_ENV === "test";
  const dbPath = ENV.GALLERY_DB_PATH;
  const mediaPath = ENV.GALLERY_MEDIA_PATH;
  const importPath = ENV.GALLERY_IMPORT_PATH;
  const secret = ENV.GALLERY_SECRET;
  const codeEncryptionKey = ENV.GALLERY_CODE_ENCRYPTION_KEY;

  if (secret.toLowerCase() === codeEncryptionKey.toLowerCase()) {
    throw new Error("CRITICAL: GALLERY_SECRET et GALLERY_CODE_ENCRYPTION_KEY doivent obligatoirement etre distincts.");
  }
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  if (adminSecret && (secret === adminSecret || codeEncryptionKey === adminSecret)) {
    throw new Error("CRITICAL: Les secrets de galerie ne doivent pas reutiliser ADMIN_SESSION_SECRET.");
  }
  const rateLimitSecret = process.env.RATE_LIMIT_SECRET;
  if (rateLimitSecret && (secret === rateLimitSecret || codeEncryptionKey === rateLimitSecret)) {
    throw new Error("CRITICAL: Les secrets de galerie ne doivent pas reutiliser RATE_LIMIT_SECRET.");
  }

  ensureDisjoint(mediaPath, importPath, "GALLERY_MEDIA_PATH", "GALLERY_IMPORT_PATH");
  if (isPathInside(mediaPath, dbPath)) {
    throw new Error("CRITICAL: GALLERY_DB_PATH ne doit pas etre a l'interieur de GALLERY_MEDIA_PATH.");
  }
  if (isPathInside(importPath, dbPath)) {
    throw new Error("CRITICAL: GALLERY_DB_PATH ne doit pas etre a l'interieur de GALLERY_IMPORT_PATH.");
  }

  if (!isTest) {
    if (process.env.SITE_MEDIA_PATH) {
      ensureDisjoint(mediaPath, ENV.SITE_MEDIA_PATH, "GALLERY_MEDIA_PATH", "SITE_MEDIA_PATH");
      ensureDisjoint(importPath, ENV.SITE_MEDIA_PATH, "GALLERY_IMPORT_PATH", "SITE_MEDIA_PATH");
    }
    if (process.env.PORTFOLIO_MEDIA_PATH) {
      ensureDisjoint(mediaPath, ENV.PORTFOLIO_MEDIA_PATH, "GALLERY_MEDIA_PATH", "PORTFOLIO_MEDIA_PATH");
      ensureDisjoint(importPath, ENV.PORTFOLIO_MEDIA_PATH, "GALLERY_IMPORT_PATH", "PORTFOLIO_MEDIA_PATH");
    }
    if (process.env.RATE_LIMIT_DB_PATH) {
      if (path.resolve(dbPath) === path.resolve(ENV.RATE_LIMIT_DB_PATH)) {
        throw new Error("CRITICAL: GALLERY_DB_PATH et RATE_LIMIT_DB_PATH doivent etre distincts.");
      }
    }
  }

  return {
    dbPath,
    mediaPath,
    importPath,
    secret,
    codeEncryptionKey,
  };
}

export interface AdminConfig {
  hash: string;
  sessionSecret: string;
  rateLimitSecret: string;
  rateLimitDbPath: string;
  siteUrl: string;
  trustProxy: boolean;
}

export function validateAdminConfig(): AdminConfig {
  if (process.env.PARALLAX_LOCAL_PREVIEW === "true") {
    isLocalPreviewMode();
  }
  const siteUrl = ENV.PUBLIC_SITE_URL;

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash || !ARGON2ID_HASH_REGEX.test(hash)) {
    throw new Error("CRITICAL: ADMIN_PASSWORD_HASH est manquant ou ne respecte pas le format Argon2id standard.");
  }

  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("CRITICAL: ADMIN_SESSION_SECRET est manquant ou comporte moins de 32 caracteres.");
  }

  const rateLimitSecret = process.env.RATE_LIMIT_SECRET;
  if (!rateLimitSecret || rateLimitSecret.length < 32) {
    throw new Error("CRITICAL: RATE_LIMIT_SECRET est manquant ou comporte moins de 32 caracteres.");
  }

  if (sessionSecret === rateLimitSecret) {
    throw new Error("CRITICAL: ADMIN_SESSION_SECRET et RATE_LIMIT_SECRET doivent obligatoirement etre distincts.");
  }

  const rateLimitDbPath = ENV.RATE_LIMIT_DB_PATH;

  const trustProxyRaw = process.env.TRUST_PROXY;
  if (trustProxyRaw !== undefined && trustProxyRaw !== "true" && trustProxyRaw !== "false") {
    throw new Error("CRITICAL: TRUST_PROXY doit valoir explicitement 'true' ou 'false' s'il est defini.");
  }

  return {
    hash,
    sessionSecret,
    rateLimitSecret,
    rateLimitDbPath,
    siteUrl,
    trustProxy: trustProxyRaw === "true",
  };
}

let hasValidatedStartup = false;
export function validateServerStartup(): void {
  if (hasValidatedStartup) {
    return;
  }
  if (!process.env.VITEST) {
    if (process.env.PARALLAX_LOCAL_PREVIEW === "true") {
      isLocalPreviewMode();
    }
    validateContentConfig();
    validateMediaConfig();
    validatePortfolioConfig();
    validateGalleryConfig();
    if (process.env.NODE_ENV === "production") {
      validateAdminConfig();
    }
    hasValidatedStartup = true;
  }
}
