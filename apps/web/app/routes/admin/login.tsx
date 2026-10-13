import {
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type HeadersArgs,
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import * as crypto from "node:crypto";
import {
  verifyAdminPassword,
  getAdminConfig,
  requireAdminSession,
  computeCredentialVersion,
  constantTimeEqual,
} from "../../lib/auth.server";
import { createAdminHeaders, composeAdminHeaders } from "../../lib/admin-auth.server";
import {
  checkRateLimit,
  resetRateLimit,
  RateLimitExceededError,
  RateLimitStorageError,
} from "../../lib/rate-limit.server";
import {
  getSession,
  commitSession,
  SESSION_MAX_AGE_SECONDS,
} from "../../lib/session.server";
import {
  getClientIp,
  validateOrigin,
  readStrictFormUrlEncoded,
  ActionSecurityError,
} from "../../lib/security.server";
import styles from "./login.module.css";

export function meta() {
  return [
    { title: "Connexion administration | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export async function loader({ request }: LoaderFunctionArgs) {
  // 1. Verify admin configuration (throws 503 if missing or invalid)
  getAdminConfig();

  // 2. Check if already authenticated
  const { isValid, session } = await requireAdminSession(request);
  if (isValid) {
    return redirect("/admin/dashboard", {
      status: 303,
      headers: createAdminHeaders(),
    });
  }

  const headers = createAdminHeaders();
  const cookieHeader = request.headers.get("Cookie");

  let activeSession = session;

  // If previous session was expired, rotated, or invalid with admin fields,
  // do not reuse its old fields or token; initialize a clean anonymous session.
  if (cookieHeader && cookieHeader.includes("__parallax_admin_session") && (session.has("adminId") || session.has("expiresAt"))) {
    activeSession = await getSession(null);
  }

  // Ensure anonymous session with fresh CSRF token for pre-login form
  let csrfToken = activeSession.get("csrfToken");
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    activeSession.set("csrfToken", csrfToken);
    headers.set("Set-Cookie", await commitSession(activeSession));
  }

  return Response.json({ csrfToken }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  // 1. Verify configuration
  getAdminConfig();

  // 2. Only POST is accepted
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: createAdminHeaders(new Headers({ Allow: "POST" })),
    });
  }

  // 3. Strict Origin check
  if (!validateOrigin(request)) {
    return new Response("Forbidden: Invalid Origin", {
      status: 403,
      headers: createAdminHeaders(),
    });
  }

  // 4. Read body strictly bounded to 8 KiB with only allowed fields
  let params: URLSearchParams;
  try {
    params = await readStrictFormUrlEncoded(request, 8192, ["password", "csrfToken"]);
  } catch (err: unknown) {
    if (err instanceof ActionSecurityError) {
      const headers = createAdminHeaders(new Headers(err.headers));
      return new Response(err.message, { status: err.status, headers });
    }
    return new Response("Bad Request", { status: 400, headers: createAdminHeaders() });
  }

  // 5. Rate limiting check prior to any Argon2 computation
  const ip = getClientIp(request);
  if (!ip) {
    return new Response("Forbidden: Invalid IP", { status: 403, headers: createAdminHeaders() });
  }

  try {
    checkRateLimit(ip, "admin");
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) {
      const headers = createAdminHeaders();
      headers.set("Retry-After", String(err.retryAfter));
      return Response.json(
        { error: "Trop de tentatives de connexion. Veuillez reessayer dans 15 minutes." },
        { status: 429, headers }
      );
    }
    if (err instanceof RateLimitStorageError) {
      return new Response("Service temporairement indisponible.", {
        status: 503,
        headers: createAdminHeaders(),
      });
    }
    return new Response("Erreur interne", { status: 500, headers: createAdminHeaders() });
  }

  // 6. CSRF validation against current session
  const cookie = request.headers.get("Cookie");
  const session = await getSession(cookie);
  const sessionCsrf = session.get("csrfToken") || "";
  const formCsrf = params.get("csrfToken") || "";

  if (!formCsrf || !sessionCsrf || !constantTimeEqual(formCsrf, sessionCsrf)) {
    return new Response("Invalid CSRF token", { status: 403, headers: createAdminHeaders() });
  }

  // 7. Verify password
  const password = params.get("password");
  if (!password || typeof password !== "string") {
    return Response.json(
      { error: "Le mot de passe est obligatoire." },
      { status: 400, headers: createAdminHeaders() }
    );
  }

  let isPasswordValid: boolean;
  try {
    isPasswordValid = await verifyAdminPassword(password);
  } catch {
    return new Response("Service temporairement indisponible.", {
      status: 503,
      headers: createAdminHeaders(),
    });
  }

  if (!isPasswordValid) {
    return Response.json(
      { error: "Identifiants invalides." },
      { status: 401, headers: createAdminHeaders() }
    );
  }

  // 8. Authentication successful: reset rate limit inside try/catch
  try {
    resetRateLimit(ip, "admin");
  } catch {
    return new Response("Service temporairement indisponible.", {
      status: 503,
      headers: createAdminHeaders(),
    });
  }

  // 9. Construct fresh authenticated session from empty storage
  const freshSession = await getSession(null);
  const now = Date.now();
  freshSession.set("adminId", crypto.randomUUID());
  freshSession.set("credentialVersion", computeCredentialVersion());
  freshSession.set("csrfToken", crypto.randomUUID());
  freshSession.set("createdAt", now);
  freshSession.set("expiresAt", now + SESSION_MAX_AGE_SECONDS * 1000);

  const cookieHeader = await commitSession(freshSession);
  const redirectHeaders = createAdminHeaders();
  redirectHeaders.set("Set-Cookie", cookieHeader);

  return redirect("/admin/dashboard", {
    status: 303,
    headers: redirectHeaders,
  });
}

export default function AdminLoginPage() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className={styles.container}>
      <main className={styles.loginCard}>
        <div className={styles.indicator} />
        <h1 className={styles.title}>Administration</h1>
        <p className={styles.subtitle}>
          Connectez-vous pour acceder a l'espace de gestion Parallax.
        </p>

        <Form method="post" className={styles.form}>
          <input type="hidden" name="csrfToken" value={csrfToken} />

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>
              Mot de passe administrateur
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={styles.input}
              placeholder="••••••••••••"
            />
          </div>

          {actionData?.error && (
            <p className={styles.error} role="alert">
              {actionData.error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={styles.submitButton}
          >
            {isSubmitting ? "Connexion en cours..." : "Se connecter"}
          </button>
        </Form>
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 503) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorBox}>
          <div className={styles.indicator} />
          <h1 className={styles.errorTitle}>Administration indisponible</h1>
          <p className={styles.errorText}>
            Le service d'administration est temporairement indisponible.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.errorContainer}>
      <div className={styles.errorBox}>
        <div className={styles.indicator} />
        <h1 className={styles.errorTitle}>Une erreur est survenue</h1>
        <p className={styles.errorText}>
          Impossible d'afficher la page d'administration.
        </p>
      </div>
    </div>
  );
}
