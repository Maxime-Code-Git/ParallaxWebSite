import { useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { Header } from "../../components/public/Header";
import { Footer } from "../../components/public/Footer";
import { getSiteContent } from "../../lib/site-content.server";
import {
  getGallerySession,
  commitGallerySession,
  createGalleryCsrfToken,
  authenticateGalleryCode,
  GALLERY_PRIVATE_HEADERS,
} from "../../lib/gallery-auth.server";
import { readStrictFormUrlEncoded } from "../../lib/security.server";
import styles from "./client-login.module.css";

interface LoaderData {
  lang: "fr" | "en";
  csrfToken: string;
  statusMessage: string | null;
  common: ReturnType<typeof getSiteContent>["common"];
}

interface ActionData {
  error?: string;
}

export function meta({ data }: { data?: LoaderData }) {
  const isEn = data?.lang === "en";
  const title = isEn ? "Client Area | Parallax" : "Espace client | Parallax";
  const description = isEn
    ? "Access your private gallery to view and download your photos and films."
    : "Accédez à votre galerie privée pour retrouver vos photos et votre film.";

  return [
    { title },
    { name: "description", content: description },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers({
  loaderHeaders,
  actionHeaders,
}: {
  loaderHeaders: Headers;
  actionHeaders: Headers;
}): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(GALLERY_PRIVATE_HEADERS)) {
    headers.set(key, value);
  }

  const actionCookie = actionHeaders?.get("Set-Cookie");
  if (actionCookie) {
    headers.set("Set-Cookie", actionCookie);
  } else {
    const loaderCookie = loaderHeaders?.get("Set-Cookie");
    if (loaderCookie) {
      headers.set("Set-Cookie", loaderCookie);
    }
  }

  const retryAfter = actionHeaders?.get("Retry-After");
  if (retryAfter) {
    headers.set("Retry-After", retryAfter);
  }

  return headers;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const lang: "fr" | "en" = url.pathname.startsWith("/en") ? "en" : "fr";
  const session = await getGallerySession(request);

  // Generate anonymous CSRF token with short-lived server expiration (15 minutes)
  const csrfToken = createGalleryCsrfToken();
  session.set("csrfToken", csrfToken);
  session.set("csrfExpiresAt", Date.now() + 15 * 60 * 1000);

  const statusParam = url.searchParams.get("status");
  let statusMessage: string | null = null;
  if (statusParam === "expired") {
    statusMessage =
      lang === "fr"
        ? "Votre session ou votre code d'accès a expiré. Veuillez saisir votre code."
        : "Your session or access code has expired. Please enter your code.";
  } else if (statusParam === "unavailable") {
    statusMessage =
      lang === "fr"
        ? "Cette galerie n'est plus accessible."
        : "This gallery is no longer available.";
  } else if (statusParam === "unauthorized") {
    statusMessage =
      lang === "fr"
        ? "Veuillez saisir votre code d'accès pour accéder à votre galerie."
        : "Please enter your access code to view your gallery.";
  }

  const { common } = getSiteContent();
  const sessionCookie = await commitGallerySession(session, { maxAge: 15 * 60 });

  return Response.json(
    {
      lang,
      csrfToken,
      statusMessage,
      common,
    },
    {
      headers: {
        ...GALLERY_PRIVATE_HEADERS,
        "Set-Cookie": sessionCookie,
      },
    }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...GALLERY_PRIVATE_HEADERS, Allow: "POST" },
    });
  }

  const url = new URL(request.url);
  const lang: "fr" | "en" = url.pathname.startsWith("/en") ? "en" : "fr";

  let params: URLSearchParams;
  try {
    params = await readStrictFormUrlEncoded(request, 1024);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Payload Too Large") {
      return Response.json(
        { error: lang === "fr" ? "Requête trop volumineuse." : "Payload too large." },
        { status: 413, headers: GALLERY_PRIVATE_HEADERS }
      );
    }
    return Response.json(
      { error: lang === "fr" ? "Format de données invalide." : "Unsupported media type." },
      { status: 415, headers: GALLERY_PRIVATE_HEADERS }
    );
  }

  const code = (params.get("code") || "").trim();
  const csrfToken = params.get("csrfToken") || "";
  const session = await getGallerySession(request);

  if (!code) {
    return Response.json(
      { error: lang === "fr" ? "Veuillez entrer votre code d'accès." : "Please enter your access code." },
      { status: 400, headers: GALLERY_PRIVATE_HEADERS }
    );
  }

  const authResult = await authenticateGalleryCode(request, code, csrfToken, session, lang);

  if (!authResult.success) {
    const responseHeaders: Record<string, string> = { ...GALLERY_PRIVATE_HEADERS };
    if (authResult.retryAfter) {
      responseHeaders["Retry-After"] = String(authResult.retryAfter);
    }
    return Response.json({ error: authResult.error }, { status: authResult.status, headers: responseHeaders });
  }

  const targetPath = lang === "fr" ? `/fr/galerie/${authResult.publicId}` : `/en/gallery/${authResult.publicId}`;
  return redirect(targetPath, {
    status: 303,
    headers: {
      ...GALLERY_PRIVATE_HEADERS,
      "Set-Cookie": authResult.sessionCookie,
    },
  });
}

export default function ClientLoginPage() {
  const { lang, csrfToken, statusMessage, common } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [codeValue, setCodeValue] = useState("");

  const isEn = lang === "en";
  const contactHref = `/${lang}#contact`;

  return (
    <div className={styles.container}>
      <Header common={common} lang={lang} currentRoute="client-area" />

      <main id="main-content" className={styles.mainContent}>
        <div className={styles.loginCard}>
          <div className={styles.indicator} aria-hidden="true" />
          <h1 className={styles.title}>
            {isEn ? "Your private gallery" : "Votre galerie privée"}
          </h1>
          <p className={styles.subtitle}>
            {isEn
              ? "Find your photos and videos here, using the access code you were given."
              : "Retrouvez ici vos photos et vidéos, avec le code d'accès qui vous a été transmis."}
          </p>

          {statusMessage && !actionData?.error && (
            <div className={styles.infoAlert} role="status">
              {statusMessage}
            </div>
          )}

          {actionData?.error && (
            <div className={styles.errorAlert} role="alert">
              {actionData.error}
            </div>
          )}

          <Form method="post" className={styles.form}>
            <input type="hidden" name="csrfToken" value={csrfToken} />

            <div className={styles.formGroup}>
              <label htmlFor="ec-code" className={styles.label}>
                {isEn ? "Your access code" : "Votre code d'accès"}
              </label>
              <input
                id="ec-code"
                name="code"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={isEn ? "Ex. PARALLAX-XXXX-XXXX" : "Ex. PARALLAX-XXXX-XXXX"}
                className={styles.input}
                value={codeValue}
                onChange={(e) => setCodeValue(e.target.value.toUpperCase())}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className={styles.submitBtn}
            >
              {isSubmitting
                ? isEn ? "Connecting..." : "Connexion en cours..."
                : isEn ? "Access my gallery" : "Accéder à ma galerie"}
            </button>
          </Form>

          <p className={styles.helpText}>
            {isEn ? "Don't have your code? " : "Vous n'avez pas votre code ? "}
            <Link to={contactHref} className={styles.helpLink}>
              {isEn ? "Contact us" : "Contactez-nous"}
            </Link>
          </p>
        </div>
      </main>

      <Footer common={common} lang={lang} />
    </div>
  );
}
