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

function backfillLegacyContactClaims(database: DatabaseSync): void {
  const now = Date.now();
  const selectStmt = database.prepare(
    "SELECT token_hash, claim_id, content_hash, status, created_at, lease_expires_at, retention_expires_at, expires_at FROM contact_claims"
  );
  const rows = selectStmt.all() as Array<{
    token_hash: string;
    claim_id: string;
    content_hash: string;
    status: string;
    created_at: number;
    lease_expires_at: number;
    retention_expires_at: number;
    expires_at: number;
  }>;

  if (rows.length === 0) return;

  const updateStmt = database.prepare(`
    UPDATE contact_claims
    SET claim_id = ?,
        content_hash = ?,
        status = ?,
        lease_expires_at = ?,
        retention_expires_at = ?,
        expires_at = ?
    WHERE token_hash = ?
  `);

  // Max token lifetime is 2 hours + 60s safety margin (7,260,000 ms)
  const tokenValidityMarginMs = 2 * 60 * 60 * 1000 + 60_000;

  for (const row of rows) {
    let changed = false;
    let claimId = row.claim_id;
    let contentHash = row.content_hash;
    let status = row.status;
    let leaseExpiresAt = row.lease_expires_at;
    let retentionExpiresAt = row.retention_expires_at;
    let expiresAt = row.expires_at;

    // 1. Ensure valid non-empty claim_id
    if (!claimId || claimId.trim() === "") {
      claimId = crypto.randomUUID();
      changed = true;
    }

    // 2. Ensure retention_expires_at is populated based on token validity window
    const minRetention = row.created_at + tokenValidityMarginMs;
    const computedRetention = Math.max(row.expires_at || 0, minRetention);

    if (retentionExpiresAt <= 0) {
      retentionExpiresAt = computedRetention;
      changed = true;
    }
    if (expiresAt < retentionExpiresAt) {
      expiresAt = retentionExpiresAt;
      changed = true;
    }

    // 3. Ensure lease_expires_at is populated
    if (leaseExpiresAt <= 0) {
      leaseExpiresAt =
        row.expires_at > 0 && row.expires_at <= row.created_at + 60_000
          ? row.expires_at
          : row.created_at + 60_000;
      changed = true;
    }

    // 4. An expired in_progress lease must become uncertain without SMTP rearm
    if (status === "in_progress" && leaseExpiresAt <= now) {
      status = "uncertain";
      changed = true;
    }

    // 5. Incompatible or missing legacy content_hash
    if (!contentHash || contentHash.trim() === "") {
      contentHash = "legacy:incompatible";
      changed = true;
    }

    if (changed) {
      updateStmt.run(
        claimId,
        contentHash,
        status,
        leaseExpiresAt,
        retentionExpiresAt,
        expiresAt,
        row.token_hash
      );
    }
  }
}

function migrateContactClaimsSchema(database: DatabaseSync): void {
  const cols = database.prepare("PRAGMA table_info(contact_claims)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));

  const needsClaimId = !colNames.has("claim_id");
  const needsContentHash = !colNames.has("content_hash");
  const needsLeaseExpiresAt = !colNames.has("lease_expires_at");
  const needsRetentionExpiresAt = !colNames.has("retention_expires_at");

  const schemaNeedsAlter = needsClaimId || needsContentHash || needsLeaseExpiresAt || needsRetentionExpiresAt;

  if (schemaNeedsAlter) {
    database.exec("BEGIN EXCLUSIVE TRANSACTION");
    try {
      if (needsClaimId) {
        database.exec("ALTER TABLE contact_claims ADD COLUMN claim_id TEXT NOT NULL DEFAULT ''");
      }
      if (needsContentHash) {
        database.exec("ALTER TABLE contact_claims ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''");
      }
      if (needsLeaseExpiresAt) {
        database.exec("ALTER TABLE contact_claims ADD COLUMN lease_expires_at INTEGER NOT NULL DEFAULT 0");
      }
      if (needsRetentionExpiresAt) {
        database.exec("ALTER TABLE contact_claims ADD COLUMN retention_expires_at INTEGER NOT NULL DEFAULT 0");
      }

      backfillLegacyContactClaims(database);

      database.exec("COMMIT");
    } catch (err) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Ignored
      }
      throw new RateLimitStorageError("Erreur lors de la migration du schema de contact_claims", err);
    }
  } else {
    // Columns already exist. Check if any rows still have unpopulated fields or expired in_progress
    const checkStmt = database.prepare(
      "SELECT 1 FROM contact_claims WHERE retention_expires_at <= 0 OR claim_id = '' OR content_hash = '' OR (status = 'in_progress' AND lease_expires_at <= ?) LIMIT 1"
    );
    const needsBackfill = checkStmt.get(Date.now());
    if (needsBackfill) {
      database.exec("BEGIN EXCLUSIVE TRANSACTION");
      try {
        backfillLegacyContactClaims(database);
        database.exec("COMMIT");
      } catch (err) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Ignored
        }
        throw new RateLimitStorageError("Erreur lors de la mise a niveau des donnees de contact_claims", err);
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

    // 1. Create base tables
    localDb.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_hash ON requests(hash);
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);

      CREATE TABLE IF NOT EXISTS contact_claims (
        token_hash TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        lease_expires_at INTEGER NOT NULL DEFAULT 0,
        retention_expires_at INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL DEFAULT 0
      );
    `);

    // 2. Perform safe, transactional schema migration & row backfill
    migrateContactClaimsSchema(localDb);

    // 3. Create dependent indexes (guaranteed safe now that columns exist)
    localDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_contact_claims_retention ON contact_claims(retention_expires_at);
      CREATE INDEX IF NOT EXISTS idx_contact_claims_expires ON contact_claims(expires_at);
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

export type ContactClaimAcquireResult =
  | { status: "acquired"; claimId: string }
  | { status: "in_progress" }
  | { status: "completed" }
  | { status: "uncertain" }
  | { status: "conflict_content_mismatch" };

export function acquireContactClaim(
  tokenHash: string,
  contentHash: string,
  tokenExpiresAt: number,
  leaseDurationMs = 60_000
): ContactClaimAcquireResult {
  let database: DatabaseSync;
  try {
    database = initDb();
  } catch (err) {
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError("Erreur d'acces a la base de donnees", err);
  }

  const now = Date.now();
  const leaseExpiresAt = now + leaseDurationMs;
  const retentionExpiresAt = Math.max(now + 60_000, tokenExpiresAt + 60_000);

  try {
    database.exec("BEGIN EXCLUSIVE TRANSACTION");
    try {
      // 1. Purge claims whose full retention window is strictly in the past
      const purgeStmt = database.prepare(
        "DELETE FROM contact_claims WHERE (retention_expires_at > 0 AND retention_expires_at < ?) OR (retention_expires_at = 0 AND expires_at < ?)"
      );
      purgeStmt.run(now, now);

      // 2. Check existing claim for this tokenHash
      const selectStmt = database.prepare(
        "SELECT claim_id, content_hash, status, lease_expires_at, retention_expires_at, expires_at FROM contact_claims WHERE token_hash = ?"
      );
      const existing = selectStmt.get(tokenHash) as
        | {
            claim_id: string;
            content_hash: string;
            status: string;
            lease_expires_at: number;
            retention_expires_at: number;
            expires_at: number;
          }
        | undefined;

      if (existing) {
        // If content differs from previous attempt with this token (or if legacy hash is missing/incompatible): reject with 409
        if (!existing.content_hash || existing.content_hash !== contentHash) {
          database.exec("COMMIT");
          return { status: "conflict_content_mismatch" };
        }

        if (existing.status === "completed") {
          database.exec("COMMIT");
          return { status: "completed" };
        }

        if (existing.status === "uncertain") {
          database.exec("COMMIT");
          return { status: "uncertain" };
        }

        if (existing.status === "in_progress") {
          const effectiveLeaseExpires =
            existing.lease_expires_at > 0 ? existing.lease_expires_at : existing.expires_at;
          if (effectiveLeaseExpires > now) {
            database.exec("COMMIT");
            return { status: "in_progress" };
          }
          // The previous lease expired without resolution (transport hung, crash, or persistence failure).
          // Transition to 'uncertain' so no duplicate email is blindly sent.
          const updateStmt = database.prepare(
            "UPDATE contact_claims SET status = 'uncertain' WHERE token_hash = ? AND status = 'in_progress'"
          );
          updateStmt.run(tokenHash);
          database.exec("COMMIT");
          return { status: "uncertain" };
        }

        if (existing.status === "failed") {
          // A previous attempt failed definitely (e.g. SMTP config / auth failure).
          // Allow retry by acquiring a new claim with new claim_id.
          const newClaimId = crypto.randomUUID();
          const updateStmt = database.prepare(
            "UPDATE contact_claims SET claim_id = ?, content_hash = ?, status = 'in_progress', created_at = ?, lease_expires_at = ?, retention_expires_at = ?, expires_at = ? WHERE token_hash = ?"
          );
          updateStmt.run(
            newClaimId,
            contentHash,
            now,
            leaseExpiresAt,
            retentionExpiresAt,
            retentionExpiresAt,
            tokenHash
          );
          database.exec("COMMIT");
          return { status: "acquired", claimId: newClaimId };
        }
      }

      // 3. Insert new claim
      const newClaimId = crypto.randomUUID();
      const insertStmt = database.prepare(
        "INSERT INTO contact_claims (token_hash, claim_id, content_hash, status, created_at, lease_expires_at, retention_expires_at, expires_at) VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?)"
      );
      insertStmt.run(
        tokenHash,
        newClaimId,
        contentHash,
        now,
        leaseExpiresAt,
        retentionExpiresAt,
        retentionExpiresAt
      );

      database.exec("COMMIT");
      return { status: "acquired", claimId: newClaimId };
    } catch (innerErr) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Ignored
      }
      throw innerErr;
    }
  } catch (err: unknown) {
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError("Erreur d'operation SQLite sur le claim anti-rejeu", err);
  }
}

export function completeContactClaim(tokenHash: string, claimId: string, tokenExpiresAt: number): void {
  try {
    const database = initDb();
    const receiptExpiresAt = Math.max(Date.now() + 60_000, tokenExpiresAt + 60_000);
    const stmt = database.prepare(
      "UPDATE contact_claims SET status = 'completed', retention_expires_at = ?, expires_at = ? WHERE token_hash = ? AND claim_id = ?"
    );
    const info = stmt.run(receiptExpiresAt, receiptExpiresAt, tokenHash, claimId);
    if (info.changes === 0) {
      throw new RateLimitStorageError("Perte du bail ou expiration du claim lors de la finalisation");
    }
  } catch (err) {
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError("Erreur lors de la finalisation du claim", err);
  }
}

export function markUncertainContactClaim(tokenHash: string, claimId: string, tokenExpiresAt: number): void {
  try {
    const database = initDb();
    const receiptExpiresAt = Math.max(Date.now() + 60_000, tokenExpiresAt + 60_000);
    const stmt = database.prepare(
      "UPDATE contact_claims SET status = 'uncertain', retention_expires_at = ?, expires_at = ? WHERE token_hash = ? AND claim_id = ?"
    );
    const info = stmt.run(receiptExpiresAt, receiptExpiresAt, tokenHash, claimId);
    if (info.changes === 0) {
      throw new RateLimitStorageError("Perte du bail ou expiration du claim lors de la mise en incertitude");
    }
  } catch (err) {
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError("Erreur lors de la mise en incertitude du claim", err);
  }
}

export function failContactClaim(tokenHash: string, claimId: string): void {
  try {
    const database = initDb();
    const stmt = database.prepare(
      "UPDATE contact_claims SET status = 'failed' WHERE token_hash = ? AND claim_id = ?"
    );
    stmt.run(tokenHash, claimId);
  } catch (err) {
    if (err instanceof RateLimitStorageError) throw err;
    throw new RateLimitStorageError("Erreur lors de la mise en echec du claim", err);
  }
}
