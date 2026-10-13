import crypto from "node:crypto";
import { createCookieSessionStorage, redirect, type Session } from "react-router";
import { ENV, isLocalPreviewMode } from "./env.server";
import { getClientIp, validateOrigin } from "./security.server";
import { checkRateLimit, resetRateLimit, RateLimitExceededError } from "./rate-limit.server";
import { getGalleryDb } from "./gallery-db.server";
import type { Gallery, GalleryMediaRow } from "./gallery.server";

// Standard private headers for all gallery endpoints
export const GALLERY_PRIVATE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

// Key derivation helpers
function getMasterSecret(): Buffer {
  return Buffer.from(ENV.GALLERY_SECRET, "hex");
}

function getHmacKey(): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", getMasterSecret(), Buffer.alloc(0), "parallax-gallery-code-hmac-v1", 32));
}

function getSessionSecret(): string {
  return Buffer.from(crypto.hkdfSync("sha256", getMasterSecret(), Buffer.alloc(0), "parallax-gallery-session-v1", 32)).toString("base64");
}

function getAesKey(): Buffer {
  return Buffer.from(ENV.GALLERY_CODE_ENCRYPTION_KEY, "hex");
}

/**
 * Single canonical code normalizer used before HMAC and search:
 * uppercased, stripped of spaces, dashes, and underscores.
 */
export function normalizeGalleryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s\-_]/g, "");
}

/**
 * Computes deterministic HMAC-SHA256 hash of a normalized gallery code.
 */
export function hashGalleryCode(code: string): string {
  const normalized = normalizeGalleryCode(code);
  return crypto.createHmac("sha256", getHmacKey()).update(normalized).digest("hex");
}

/**
 * AES-256-GCM encryption of a code preserving original formatting for admin retrieval.
 */
export function encryptGalleryCode(code: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

/**
 * AES-256-GCM decryption of an encrypted gallery code.
 */
export function decryptGalleryCode(encryptedStr: string): string {
  const parts = encryptedStr.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted code format");
  }
  const [ivHex, ciphertextHex, authTagHex] = parts;
  if (!ivHex || !ciphertextHex || !authTagHex) {
    throw new Error("Invalid encrypted code format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error("Invalid IV or auth tag length");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getAesKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Generates an unambiguous, cryptographically secure gallery access code
 * with >= 96 bits of entropy (20 chars from 32-char alphabet = 100 bits).
 */
export function generateGalleryCode(): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 characters, no 0, 1, I, O
  let code = "PARALLAX-";
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      code += chars[crypto.randomInt(0, chars.length)];
    }
    if (i < 3) code += "-";
  }
  return code;
}

/**
 * Parallax Gallery Client Session Storage (Cookie: __parallax_gallery_session)
 */
function isCookieSecure(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  try {
    if (isLocalPreviewMode()) return false;
  } catch {
    // If preview mode validation fails, stick to secure
  }
  return true;
}

export function getGallerySessionStorage() {
  return createCookieSessionStorage({
    cookie: {
      name: "__parallax_gallery_session",
      secure: isCookieSecure(),
      secrets: [getSessionSecret()],
      sameSite: "lax",
      path: "/",
      httpOnly: true,
      maxAge: 8 * 60 * 60, // 8 hours max technical lifespan
    },
  });
}

export async function getGallerySession(request: Request): Promise<Session> {
  const storage = getGallerySessionStorage();
  const cookie = request.headers.get("Cookie");
  return storage.getSession(cookie);
}

export async function commitGallerySession(session: Session): Promise<string> {
  const storage = getGallerySessionStorage();
  return storage.commitSession(session);
}

export async function destroyGallerySession(session: Session): Promise<string> {
  const storage = getGallerySessionStorage();
  return storage.destroySession(session);
}

/**
 * CSRF token helpers for gallery forms
 */
export function createGalleryCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function verifyGalleryCsrfToken(session: Session, token: string | null): boolean {
  if (!token || typeof token !== "string" || token.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(token)) {
    return false;
  }
  const stored = session.get("csrfToken") as string | undefined;
  if (!stored || typeof stored !== "string" || stored.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(stored)) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(stored, "hex"));
}

export interface GalleryAccessResult {
  gallery: Gallery;
  media?: GalleryMediaRow;
}

/**
 * Enforces client access to a gallery and optional media.
 * Throws 401 / redirect on unauthenticated, expired, or rotated access.
 */
export async function requireGalleryAccess(
  request: Request,
  publicId: string,
  mediaId?: string,
  isApiRequest = false
): Promise<GalleryAccessResult> {
  const lang = request.url.includes("/en/") ? "en" : "fr";
  const loginUrl = lang === "fr" ? "/fr/espace-client" : "/en/client-area";

  const session = await getGallerySession(request);
  const sessionGalleryId = session.get("galleryId") as string | undefined;
  const sessionCodeVersion = session.get("codeVersion") as number | undefined;

  const handleUnauthorized = async (message = "Unauthorized"): Promise<never> => {
    const destroyCookie = await destroyGallerySession(session);
    const headers = new Headers(GALLERY_PRIVATE_HEADERS);
    headers.set("Set-Cookie", destroyCookie);

    if (isApiRequest || request.url.includes(".data")) {
      throw new Response(JSON.stringify({ error: message }), { status: 401, headers });
    }
    throw redirect(loginUrl, { headers });
  };

  if (!sessionGalleryId || typeof sessionCodeVersion !== "number") {
    throw await handleUnauthorized("Session requise");
  }

  const db = getGalleryDb();

  // Find gallery by publicId
  const gallery = db.prepare("SELECT * FROM galleries WHERE public_id = ?").get(publicId) as
    | Gallery
    | undefined;

  if (!gallery || gallery.id !== sessionGalleryId) {
    throw await handleUnauthorized("Galerie introuvable ou non autorisee");
  }

  // Verify gallery status
  if (gallery.status !== "published") {
    throw await handleUnauthorized("Galerie non disponible");
  }

  // Verify gallery expiration
  if (gallery.expires_at && Date.now() > gallery.expires_at) {
    throw await handleUnauthorized("Galerie expiree");
  }

  // Verify code version in database (revokes immediately after rotation!)
  const codeRow = db.prepare("SELECT version FROM gallery_codes WHERE gallery_id = ?").get(gallery.id) as
    | { version: number }
    | undefined;

  if (!codeRow || codeRow.version !== sessionCodeVersion) {
    throw await handleUnauthorized("Code d'acces renouvele, veuillez vous reconnecter");
  }

  // Verify media belonging if requested
  let mediaRow: GalleryMediaRow | undefined;
  if (mediaId) {
    mediaRow = db.prepare("SELECT * FROM gallery_media WHERE id = ? AND gallery_id = ?").get(mediaId, gallery.id) as
      | GalleryMediaRow
      | undefined;

    if (!mediaRow || mediaRow.is_ready !== 1) {
      throw new Response("Media not found", { status: 404, headers: GALLERY_PRIVATE_HEADERS });
    }
  }

  return { gallery, media: mediaRow };
}

export type GalleryAuthResult =
  | { success: true; publicId: string; sessionCookie: string }
  | { success: false; status: number; error: string; retryAfter?: number };

/**
 * Handles client code submission and authentication.
 */
export async function authenticateGalleryCode(
  request: Request,
  code: string,
  csrfToken: string,
  session: Session,
  lang: "fr" | "en" = "fr"
): Promise<GalleryAuthResult> {
  const ip = getClientIp(request);
  if (!ip) {
    return {
      success: false,
      status: 403,
      error: lang === "fr" ? "Accès refusé : adresse IP introuvable." : "Access denied: IP address not found.",
    };
  }

  if (!validateOrigin(request)) {
    return {
      success: false,
      status: 403,
      error: lang === "fr" ? "Accès refusé : requête invalide (Origine)." : "Access denied: invalid origin.",
    };
  }

  if (!verifyGalleryCsrfToken(session, csrfToken)) {
    return {
      success: false,
      status: 403,
      error: lang === "fr" ? "Jeton de sécurité CSRF expiré ou invalide. Veuillez recharger la page." : "CSRF security token expired or invalid. Please reload the page.",
    };
  }

  try {
    checkRateLimit(ip, "gallery");
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return {
        success: false,
        status: 429,
        retryAfter: err.retryAfter,
        error:
          lang === "fr"
            ? `Trop de tentatives. Veuillez réessayer dans ${err.retryAfter} secondes.`
            : `Too many attempts. Please try again in ${err.retryAfter} seconds.`,
      };
    }
    return {
      success: false,
      status: 500,
      error: lang === "fr" ? "Erreur de service de sécurité." : "Security service error.",
    };
  }

  const codeHash = hashGalleryCode(code);
  const db = getGalleryDb();

  const codeRow = db.prepare("SELECT gallery_id, version FROM gallery_codes WHERE code_hash = ?").get(codeHash) as
    | { gallery_id: string; version: number }
    | undefined;

  if (!codeRow) {
    return {
      success: false,
      status: 401,
      error: lang === "fr" ? "Code d'accès incorrect." : "Incorrect access code.",
    };
  }

  const gallery = db.prepare("SELECT * FROM galleries WHERE id = ?").get(codeRow.gallery_id) as
    | Gallery
    | undefined;

  if (!gallery || gallery.status !== "published") {
    return {
      success: false,
      status: 401,
      error: lang === "fr" ? "Cette galerie n'est pas disponible actuellement." : "This gallery is not currently available.",
    };
  }

  if (gallery.expires_at && Date.now() > gallery.expires_at) {
    return {
      success: false,
      status: 401,
      error: lang === "fr" ? "L'accès à cette galerie a expiré." : "Access to this gallery has expired.",
    };
  }

  // Reset rate limit on successful authentication
  try {
    resetRateLimit(ip, "gallery");
  } catch {
    // Non-blocking
  }

  // Set session and refresh CSRF
  session.set("galleryId", gallery.id);
  session.set("codeVersion", codeRow.version);
  session.set("csrfToken", createGalleryCsrfToken());
  session.set("authenticatedAt", Date.now());

  const sessionCookie = await commitGallerySession(session);
  return { success: true, publicId: gallery.public_id, sessionCookie };
}
