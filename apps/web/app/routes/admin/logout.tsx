import {
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type HeadersArgs,
} from "react-router";
import { requireAdminSession, constantTimeEqual } from "../../lib/auth.server";
import { destroySession } from "../../lib/session.server";
import { createAdminHeaders } from "../../lib/admin-auth.server";
import {
  validateOrigin,
  readStrictFormUrlEncoded,
  ActionSecurityError,
} from "../../lib/security.server";

export function meta() {
  return [
    { title: "Deconnexion | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers({ loaderHeaders, actionHeaders, errorHeaders }: HeadersArgs): Headers {
  const baseHeaders = new Headers(errorHeaders ?? actionHeaders ?? loaderHeaders);
  return createAdminHeaders(baseHeaders);
}

/**
 * GET /admin/logout is explicitly rejected with 405 Method Not Allowed.
 * No logout is performed on GET requests.
 */
export async function loader(_args: LoaderFunctionArgs) {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: createAdminHeaders(new Headers({ Allow: "POST" })),
  });
}

/**
 * POST /admin/logout processes protected logout:
 * Requires valid Origin, Content-Type, 8KB bounded body, allowed fields (csrfToken only),
 * an active valid authenticated admin session, and matching CSRF token.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: createAdminHeaders(new Headers({ Allow: "POST" })),
    });
  }

  // 1. Validate Origin
  if (!validateOrigin(request)) {
    return new Response("Forbidden: Invalid Origin", {
      status: 403,
      headers: createAdminHeaders(),
    });
  }

  // 2. Read strictly bounded body enforcing only csrfToken field
  let params: URLSearchParams;
  try {
    params = await readStrictFormUrlEncoded(request, 8192, ["csrfToken"]);
  } catch (err: unknown) {
    if (err instanceof ActionSecurityError) {
      const headers = createAdminHeaders(new Headers(err.headers));
      return new Response(err.message, { status: err.status, headers });
    }
    return new Response("Bad Request", { status: 400, headers: createAdminHeaders() });
  }

  // 3. Require valid admin session prior to processing mutation
  const { isValid, session } = await requireAdminSession(request);
  if (!isValid) {
    const headers = createAdminHeaders();
    headers.set("Set-Cookie", await destroySession(session));
    return new Response("Forbidden: Session invalide ou expiree", {
      status: 403,
      headers,
    });
  }

  // 4. Validate CSRF against session
  const sessionCsrf = session.get("csrfToken") || "";
  const formCsrf = params.get("csrfToken") || "";

  if (!formCsrf || !sessionCsrf || !constantTimeEqual(formCsrf, sessionCsrf)) {
    return new Response("Invalid CSRF token", {
      status: 403,
      headers: createAdminHeaders(),
    });
  }

  // 5. Destroy session and return 303 redirect
  const headers = createAdminHeaders();
  headers.set("Set-Cookie", await destroySession(session));

  return redirect("/admin", {
    status: 303,
    headers,
  });
}

export default function LogoutPage() {
  return null;
}
