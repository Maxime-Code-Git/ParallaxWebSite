import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
  useLocation,
} from "react-router";
import "./app.css";

export const links = () => [
  { rel: "icon", href: "/favicon.ico?v=1", sizes: "any" },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png?v=1" },
  { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png?v=1" },
  { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png?v=1" },
];

function resolveLanguage(pathname?: string): "fr" | "en" {
  if (!pathname) return "fr";
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : "fr";
}

export function Layout({ children }: { children: React.ReactNode }) {
  let lang: "fr" | "en" = "fr";
  try {
    const location = useLocation();
    lang = resolveLanguage(location?.pathname);
  } catch {
    // fallback to default fr
  }

  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  let lang: "fr" | "en" = "fr";
  try {
    const location = useLocation();
    lang = resolveLanguage(location?.pathname);
  } catch {
    // fallback to default fr
  }

  const isEn = lang === "en";

  let title = isEn ? "Error" : "Erreur";
  let message = isEn
    ? "An unexpected error occurred."
    : "Une erreur inattendue est survenue.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = isEn ? "Page Not Found" : "Page non trouvée";
      message = isEn
        ? "The requested page does not exist."
        : "La page demandée n'existe pas.";
    } else {
      title = isEn ? `Error ${error.status}` : `Erreur ${error.status}`;
      message = isEn
        ? "An unexpected error occurred."
        : "Une erreur inattendue est survenue.";
    }
  }

  const homeHref = isEn ? "/en" : "/fr";
  const homeText = isEn ? "Back to home" : "Retour à l'accueil";

  return (
    <div className="errorContainer">
      <div className="errorCard">
        <h1 className="errorTitle">{title}</h1>
        <p className="errorMessage">{message}</p>
        <a href={homeHref} className="errorLink">
          {homeText}
        </a>
      </div>
    </div>
  );
}
