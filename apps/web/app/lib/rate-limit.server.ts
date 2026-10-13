import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ENV } from "./env.server";

export class RateLimitExceededError extends Error {
  retryAfter: number;
  constructor(retryAfterSeconds: number) {
    super("Rate limit exceeded");
    this.name = "RateLimitExceededError";
    this.retryAfter = retryAfterSeconds;
  }
}

export class RateLimitStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RateLimitStorageError";
  }
}

let db: DatabaseSync | undefined;
let currentDbPath: string | undefined;

function ensureSafeDatabaseDirectory(dir: string): void {
  const root = fs.realpathSync("/");
  const realTmp = fs.existsSync("/tmp") ? fs.realpathSync("/tmp") : "";
  const realPrivateTmp = fs.existsSync("/private/tmp") ? fs.realpathSync("/private/tmp") : "";
  const realHome = process.env.HOME && fs.existsSync(process.env.HOME) ? fs.realpathSync(process.env.HOME) : "";

  const existed = fs.existsSync(dir);

  if (!existed) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o700);
    } catch (err) {
      throw new RateLimitStorageError(`Impossible de creer le repertoire de limitation de debit: ${err instanceof Error ? err.message : String(err)}`, err);
    }
  }

  let realDir: string;
  try {
    const lstat = fs.lstatSync(dir);
    if (lstat.isSymbolicLink()) {
      throw new RateLimitStorageError(`Le repertoire parent ${dir} ne doit pas etre un lien symbolique.`);
    }
    realDir = fs.realpathSync(dir);
  } catch (err) {
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError(`Erreur d'acces au repertoire ${dir}`, err);
  }

  if (realDir === root || (realHome && realDir === realHome) || (realTmp && realDir === realTmp) || (realPrivateTmp && realDir === realPrivateTmp)) {
    throw new RateLimitStorageError(`Le repertoire de base rate-limit ne doit pas etre un dossier partage ou personnel direct (${dir}).`);
  }

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new RateLimitStorageError(`${dir} doit etre un repertoire.`);
  }

  const currentMode = stat.mode & 0o777;
  if (currentMode !== 0o700) {
    if (existed) {
      throw new RateLimitStorageError(
        `Le repertoire existant ${dir} possede les permissions 0${currentMode.toString(8)} au lieu de 0700 requises. Par securite, ses permissions ne sont pas modifiees arbitrairement.`
      );
    }
    throw new RateLimitStorageError(`Les permissions 0700 n'ont pas pu etre garanties sur le repertoire dedie ${dir}`);
  }
}

function checkAndEnforceFilePermissions(filePath: string): void {
  try {
    const lstat = fs.lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
      throw new RateLimitStorageError(`Le fichier ${filePath} ne doit pas etre un lien symbolique.`);
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new RateLimitStorageError(`${filePath} doit etre un fichier standard.`);
    }
    if ((stat.mode & 0o777) !== 0o600) {
      try {
        fs.chmodSync(filePath, 0o600);
      } catch (chmodErr) {
        throw new RateLimitStorageError(`Impossible d'appliquer les permissions 0600 sur ${filePath}`, chmodErr);
      }
      const verified = fs.statSync(filePath);
      if ((verified.mode & 0o777) !== 0o600) {
        throw new RateLimitStorageError(`Les permissions 0600 n'ont pas pu etre garanties sur ${filePath}`);
      }
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "ENOENT") {
      return;
    }
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError(`Erreur lors de la verification des permissions de ${filePath}`, err);
  }
}

function checkAuxiliaryFiles(dbPath: string): void {
  for (const ext of ["-wal", "-shm", "-journal"]) {
    const auxPath = dbPath + ext;
    try {
      const lstat = fs.lstatSync(auxPath);
      if (lstat.isSymbolicLink()) {
        throw new RateLimitStorageError(`Le fichier auxiliaire ${auxPath} ne doit pas etre un lien symbolique.`);
      }
      checkAndEnforceFilePermissions(auxPath);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "ENOENT") {
        continue;
      }
      if (err instanceof RateLimitStorageError) throw err;
      throw new RateLimitStorageError(`Erreur d'acces au fichier auxiliaire ${auxPath}`, err);
    }
  }
}

function initDb(): DatabaseSync {
  const dbPath = ENV.RATE_LIMIT_DB_PATH;

  if (db && currentDbPath === dbPath) {
    return db;
  }

  if (db) {
    try {
      db.close();
    } catch {
      // Ignored
    }
    db = undefined;
    currentDbPath = undefined;
  }

  let localDb: DatabaseSync | undefined;
  try {
    const dir = path.dirname(dbPath);
    ensureSafeDatabaseDirectory(dir);
    checkAndEnforceFilePermissions(dbPath);
    checkAuxiliaryFiles(dbPath);

    localDb = new DatabaseSync(dbPath);

    checkAndEnforceFilePermissions(dbPath);

    localDb.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_hash ON requests(hash);
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
    `);

    checkAuxiliaryFiles(dbPath);

    db = localDb;
    currentDbPath = dbPath;
    return db;
  } catch (err: unknown) {
    if (localDb) {
      try {
        localDb.close();
      } catch {
        // Ignored
      }
    }
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError(`Erreur d'initialisation de la base SQLite de limitation de debit`, err);
  }
}

export function closeRateLimitDatabase(): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    // Ignored
  }
  db = undefined;
  currentDbPath = undefined;
}

/**
 * Checks and records rate limit for the given IP address and namespace.
 * Throws RateLimitExceededError if limit is reached (5 attempts in 15 min).
 * Throws RateLimitStorageError if the database operation fails.
 */
export function checkRateLimit(ip: string, namespace = "admin"): void {
  let database: DatabaseSync;
  try {
    database = initDb();
  } catch (err: unknown) {
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError("Erreur d'acces a la base de limitation de debit", err);
  }

  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes sliding window
  const maxAttempts = 5;
  const windowStart = now - windowMs;

  const secret = ENV.RATE_LIMIT_SECRET;
  const hash = crypto
    .createHmac("sha256", secret)
    .update(`${namespace}:${ip}`)
    .digest("hex");

  try {
    database.exec("BEGIN EXCLUSIVE TRANSACTION");
    try {
      // 1. Cleanup expired records older than 15 minutes
      const cleanupStmt = database.prepare("DELETE FROM requests WHERE timestamp < ?");
      cleanupStmt.run(windowStart);

      // 2. Count requests for this hash in the window and find oldest timestamp in window
      const countStmt = database.prepare(
        "SELECT COUNT(*) as count, MIN(timestamp) as oldestTimestamp FROM requests WHERE hash = ? AND timestamp >= ?"
      );
      const result = countStmt.get(hash, windowStart) as { count: number; oldestTimestamp: number | null };

      if (result.count >= maxAttempts) {
        const oldest = result.oldestTimestamp ?? now;
        const remainingMs = Math.max(1000, oldest + windowMs - now);
        const retryAfterSeconds = Math.ceil(remainingMs / 1000);
        throw new RateLimitExceededError(retryAfterSeconds);
      }

      // 3. Insert current attempt
      const insertStmt = database.prepare("INSERT INTO requests (hash, timestamp) VALUES (?, ?)");
      insertStmt.run(hash, now);

      database.exec("COMMIT");
    } catch (innerErr) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Ignored
      }
      throw innerErr;
    }
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) {
      throw err;
    }
    throw new RateLimitStorageError("Erreur d'operation SQLite sur la limitation de debit", err);
  }
}

/**
 * Resets the rate limit counter for a specific IP and namespace upon successful authentication.
 */
export function resetRateLimit(ip: string, namespace = "admin"): void {
  try {
    const database = initDb();
    const secret = ENV.RATE_LIMIT_SECRET;
    const hash = crypto
      .createHmac("sha256", secret)
      .update(`${namespace}:${ip}`)
      .digest("hex");

    const stmt = database.prepare("DELETE FROM requests WHERE hash = ?");
    stmt.run(hash);
  } catch (err) {
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError("Erreur lors de la reinitialisation de la limitation de debit", err);
  }
}
