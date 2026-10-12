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

function ensureSafeDatabasePath(dbPath: string): void {
  // Reject symlink on the db file itself
  try {
    const lstat = fs.lstatSync(dbPath);
    if (lstat.isSymbolicLink()) {
      throw new RateLimitStorageError(`CRITICAL: Le fichier de base rate-limit ne doit pas etre un lien symbolique.`);
    }
  } catch (err: unknown) {
    if (err instanceof RateLimitStorageError) throw err;
    // File doesn't exist yet, which is fine
  }

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Check parent directory is not a symlink
  const dirLstat = fs.lstatSync(dir);
  if (dirLstat.isSymbolicLink()) {
    throw new RateLimitStorageError(`CRITICAL: Le dossier parent ${dir} ne doit pas etre un lien symbolique.`);
  }

  // Ensure 0700 on dedicated parent directory, but do NOT chmod shared root dirs like /tmp
  const realDir = fs.realpathSync(dir);
  const realTmp = fs.realpathSync("/tmp");
  if (realDir !== realTmp && realDir !== "/private/tmp" && realDir !== fs.realpathSync(process.env.HOME || "/")) {
    const dirStat = fs.statSync(dir);
    if ((dirStat.mode & 0o777) !== 0o700) {
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        // Ignored if not permitted
      }
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
  }

  try {
    ensureSafeDatabasePath(dbPath);
    db = new DatabaseSync(dbPath);
    currentDbPath = dbPath;

    // Enforce 0600 on the database file
    if (fs.existsSync(dbPath)) {
      const fileStat = fs.statSync(dbPath);
      if ((fileStat.mode & 0o777) !== 0o600) {
        try {
          fs.chmodSync(dbPath, 0o600);
        } catch {
          // Ignored if restricted
        }
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_hash ON requests(hash);
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
    `);
    return db;
  } catch (err: unknown) {
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
      database.exec("ROLLBACK");
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
    throw new RateLimitStorageError("Erreur lors de la reinitialisation de la limitation de debit", err);
  }
}
