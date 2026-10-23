import crypto from "node:crypto";
import { ENV } from "./env.server";
import {
  PRIVACY_COOKIE_NAME,
  PRIVACY_COOKIE_MAX_AGE_SECONDS,
  PRIVACY_POLICY_VERSION,
  DEFAULT_PRIVACY_PREFERENCES,
  type PrivacyPreferences,
} from "./privacy-preferences.shared";

function isProductionHttps(): boolean {
  return process.env.NODE_ENV === "production" && process.env.PARALLAX_LOCAL_PREVIEW !== "true";
}

export function createSignedPrivacyCookie(
  prefs: { youtube: boolean; vimeo: boolean },
  secret = ENV.RATE_LIMIT_SECRET
): string {
  const version = PRIVACY_POLICY_VERSION;
  const now = Date.now();
  const ytVal = prefs.youtube ? "1" : "0";
  const vimVal = prefs.vimeo ? "1" : "0";
  const payload = `${version}.${ytVal}.${vimVal}.${now}`;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`privacy-prefs:${payload}`)
    .digest("hex");
  const cookieVal = `${payload}.${sig}`;
  const isSecure = isProductionHttps();

  return `${PRIVACY_COOKIE_NAME}=${cookieVal}; Path=/; SameSite=Lax; Max-Age=${PRIVACY_COOKIE_MAX_AGE_SECONDS}; HttpOnly${isSecure ? "; Secure" : ""}`;
}

export function createClearPrivacyCookie(): string {
  const isSecure = isProductionHttps();
  return `${PRIVACY_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0; HttpOnly${isSecure ? "; Secure" : ""}`;
}

export function parsePrivacyCookie(
  requestOrCookieHeader: Request | string | null | undefined,
  secret = ENV.RATE_LIMIT_SECRET
): PrivacyPreferences {
  let cookieHeader: string | null = null;
  if (typeof requestOrCookieHeader === "string") {
    cookieHeader = requestOrCookieHeader;
  } else if (
    requestOrCookieHeader &&
    typeof requestOrCookieHeader === "object" &&
    "headers" in requestOrCookieHeader
  ) {
    cookieHeader = requestOrCookieHeader.headers.get("Cookie");
  }

  if (!cookieHeader) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCES);
  }

  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PRIVACY_COOKIE_NAME}=([^;]+)`));
  if (!match) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCES);
  }

  const rawVal = match[1].trim();
  const parts = rawVal.split(".");
  if (parts.length !== 5) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCES);
  }

  const [vStr, ytStr, vimStr, tsStr, receivedSig] = parts;
  const version = parseInt(vStr, 10);
  const ts = parseInt(tsStr, 10);

  if (version !== PRIVACY_POLICY_VERSION) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCES);
  }

  if ((ytStr !== "0" && ytStr !== "1") || (vimStr !== "0" && vimStr !== "1")) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCES);
  }

  if (!/^\d+$/.test(tsStr) || !/^[0-9a-f]{64}$/i.test(receivedSig)) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCES);
  }

  const now = Date.now();
  // Max age 180 days with 60s clock skew tolerance
  if (now - ts > PRIVACY_COOKIE_MAX_AGE_SECONDS * 1000 || ts > now + 60_000) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCES);
  }

  const payload = `${vStr}.${ytStr}.${vimStr}.${tsStr}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`privacy-prefs:${payload}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSig, "hex");
  const receivedBuf = Buffer.from(receivedSig, "hex");
  if (
    expectedBuf.length !== receivedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return structuredClone(DEFAULT_PRIVACY_PREFERENCES);
  }

  return {
    youtube: ytStr === "1",
    vimeo: vimStr === "1",
    version,
    updatedAt: ts,
  };
}
