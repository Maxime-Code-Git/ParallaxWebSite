import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
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
  let message = "Une erreur inattendue est survenue.";
  let title = "Erreur";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page non trouvée";
      message = "La page demandée n'existe pas.";
    } else {
      title = `Erreur ${error.status}`;
      message = error.statusText || message;
    }
  }

  return (
    <div className="errorContainer">
      <div className="errorCard">
        <h1 className="errorTitle">{title}</h1>
        <p className="errorMessage">{message}</p>
        <a href="/fr" className="errorLink">
          Retour à l'accueil
        </a>
      </div>
    </div>
  );
}
