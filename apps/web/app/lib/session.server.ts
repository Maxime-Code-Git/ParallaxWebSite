import { createCookieSessionStorage } from "react-router";
import { ENV } from "./env.server";

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours in seconds

export type AdminSessionData = {
  adminId?: string;
  credentialVersion?: string;
  csrfToken?: string;
  createdAt?: number;
  expiresAt?: number;
};

export type AdminSessionFlashData = {
  error?: string;
};

let _sessionStorage: ReturnType<
  typeof createCookieSessionStorage<AdminSessionData, AdminSessionFlashData>
> | null = null;
let _cachedSecret: string | null = null;
let _cachedEnv: string | undefined = undefined;

function getSessionStorage() {
  const secret = ENV.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not configured.");
  }

  // Re-create if secret changed (e.g. rotation) or environment changed
  if (
    _sessionStorage &&
    _cachedSecret === secret &&
    _cachedEnv === process.env.NODE_ENV
  ) {
    return _sessionStorage;
  }

  _cachedSecret = secret;
  _cachedEnv = process.env.NODE_ENV;
  _sessionStorage = createCookieSessionStorage<AdminSessionData, AdminSessionFlashData>({
    cookie: {
      name: "__parallax_admin_session",
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "strict",
      secrets: [secret],
      secure: process.env.NODE_ENV === "production",
    },
  });
  return _sessionStorage;
}

export function getSession(cookie?: string | null) {
  return getSessionStorage().getSession(cookie);
}

export function commitSession(
  session: Awaited<ReturnType<typeof getSession>>
) {
  return getSessionStorage().commitSession(session);
}

export function destroySession(
  session: Awaited<ReturnType<typeof getSession>>
) {
  return getSessionStorage().destroySession(session);
}
