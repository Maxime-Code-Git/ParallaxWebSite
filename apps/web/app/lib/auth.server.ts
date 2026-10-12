import { verify } from "@node-rs/argon2";
import * as crypto from "node:crypto";
import { ENV } from "./env.server";
import { getSession } from "./session.server";

export const MAX_ADMIN_PASSWORD_LENGTH = 256;

/**
 * Validates and retrieves the admin configuration safely.
 * Intended to be called ONLY on /admin routes.
 * Throws a 503 Response if configuration is missing or invalid.
 */
export function getAdminConfig() {
  const hash = ENV.ADMIN_PASSWORD_HASH;
  const secret = ENV.ADMIN_SESSION_SECRET;

  if (!hash || !hash.startsWith("$argon2id$") || !secret || secret.length < 32) {
    throw new Response(
      "Administration temporairement indisponible.\nLa configuration administrateur est incomplete.",
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Robots-Tag": "noindex, nofollow",
        },
      }
    );
  }

  return { hash, secret };
}

/**
 * Computes an opaque deterministic string identifying the current configuration state.
 * If ADMIN_PASSWORD_HASH or ADMIN_SESSION_SECRET changes, this version changes.
 */
export function computeCredentialVersion(): string {
  const { hash, secret } = getAdminConfig();
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(hash);
  return hmac.digest("base64url").slice(0, 32);
}

/**
 * Verifies if the provided password matches the Argon2id hash securely.
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || !password) return false;
  if (password.length > MAX_ADMIN_PASSWORD_LENGTH) return false;

  try {
    const { hash } = getAdminConfig();
    return await verify(hash, password);
  } catch {
    return false; // Fail securely without leaking errors
  }
}

/**
 * Helper to perform a constant-time string comparison to prevent timing attacks.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf-8");
    const bufB = Buffer.from(b, "utf-8");
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Validates an existing session.
 * Checks presence of adminId, credentialVersion, and server-side signed expiration.
 */
export async function requireAdminSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  const session = await getSession(cookie);

  if (!session.has("adminId")) {
    return { isValid: false, session };
  }

  // Server-side expiration check
  const expiresAt = session.get("expiresAt");
  if (typeof expiresAt !== "number" || Date.now() > expiresAt) {
    return { isValid: false, session };
  }

  const currentVersion = session.get("credentialVersion");
  if (!currentVersion) {
    return { isValid: false, session };
  }

  try {
    const expectedVersion = computeCredentialVersion();
    if (!constantTimeEqual(currentVersion, expectedVersion)) {
      return { isValid: false, session };
    }
  } catch {
    // If computeCredentialVersion throws (e.g. config went invalid mid-session)
    return { isValid: false, session };
  }

  return { isValid: true, session };
}
