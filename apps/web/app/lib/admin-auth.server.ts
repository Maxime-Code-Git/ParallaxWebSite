import { redirect } from "react-router";
import { requireAdminSession, constantTimeEqual, getAdminConfig } from "./auth.server";
import { destroySession } from "./session.server";
import {
  validateOrigin,
  readStrictFormUrlEncoded,
  ActionSecurityError,
  getCanonicalLoopbackRedirect,
} from "./security.server";

export function createAdminHeaders(headers = new Headers()): Headers {
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return headers;
}

export interface AdminHeadersArgs {
  loaderHeaders?: Headers;
  actionHeaders?: Headers;
  errorHeaders?: Headers;
  parentHeaders?: Headers;
}

/**
 * Composes admin response headers preserving loader headers (e.g. Allow, Retry-After),
 * action headers (e.g. Location), and distinct cookies without duplication,
 * while systematically applying admin security headers.
 */
export function composeAdminHeaders({
  loaderHeaders,
  actionHeaders,
  errorHeaders,
}: AdminHeadersArgs): Headers {
  const result = new Headers();
  const cookiesByLowerName = new Map<string, string>();

  const sources = [loaderHeaders, actionHeaders, errorHeaders];

  for (const source of sources) {
    if (!source) continue;

    if (typeof source.getSetCookie === "function") {
      for (const cookie of source.getSetCookie()) {
        if (cookie) {
          const cookieName = cookie.split("=")[0].trim().toLowerCase();
          cookiesByLowerName.set(cookieName, cookie);
        }
      }
    } else {
      const setCookie = source.get("set-cookie");
      if (setCookie) {
        const cookieName = setCookie.split("=")[0].trim().toLowerCase();
        cookiesByLowerName.set(cookieName, setCookie);
      }
    }

    source.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") {
        result.set(key, value);
      }
    });
  }

  for (const cookie of cookiesByLowerName.values()) {
    result.append("set-cookie", cookie);
  }

  return createAdminHeaders(result);
}

/**
 * Validates the admin session.
 * Throws a 303 redirect to /admin destroying the cookie if the session is invalid.
 */
export async function requireValidAdminSession(request: Request) {
  // Ensure admin configuration is valid before checking session
  getAdminConfig();

  // In local preview, canonicalize loopback alias before checking or emitting cookies
  const canonicalRedirect = getCanonicalLoopbackRedirect(request);
  if (canonicalRedirect) {
    throw redirect(canonicalRedirect, {
      status: 302,
      headers: createAdminHeaders(),
    });
  }

  const { isValid, session } = await requireAdminSession(request);
  if (!isValid) {
    const headers = createAdminHeaders();
    headers.set("Set-Cookie", await destroySession(session));
    throw redirect("/admin", {
      status: 303,
      headers,
    });
  }
  return session;
}

/**
 * Helper to process secure admin POST requests:
 * Validates Origin, Content-Type, Content-Length, reads 8KB bounded body, and checks CSRF.
 */
export async function validateSecureAdminMutation(
  request: Request,
  expectedCsrfToken: string,
  maxBytes = 8192
): Promise<URLSearchParams> {
  if (request.method !== "POST") {
    throw new ActionSecurityError("Method Not Allowed", 405, { Allow: "POST" });
  }

  if (!validateOrigin(request)) {
    throw new ActionSecurityError("Forbidden: Invalid Origin", 403);
  }

  const params = await readStrictFormUrlEncoded(request, maxBytes);

  const formCsrf = params.get("csrfToken");
  if (!formCsrf) {
    throw new ActionSecurityError("CSRF Token missing", 403);
  }

  if (!expectedCsrfToken || !constantTimeEqual(formCsrf, expectedCsrfToken)) {
    throw new ActionSecurityError("Invalid CSRF token", 403);
  }

  return params;
}
