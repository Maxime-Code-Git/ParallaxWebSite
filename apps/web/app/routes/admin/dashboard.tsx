import {
  type LoaderFunctionArgs,
  type HeadersArgs,
  Form,
  Link,
  useLoaderData,
  useNavigation,
} from "react-router";
import * as crypto from "node:crypto";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import { commitSession } from "../../lib/session.server";
import styles from "./dashboard.module.css";

export function meta() {
  return [
    { title: "Tableau de bord | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const headers = createAdminHeaders();

  let csrfToken = session.get("csrfToken");
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    session.set("csrfToken", csrfToken);
    headers.set("Set-Cookie", await commitSession(session));
  }

  return Response.json({ csrfToken }, { headers });
}

interface DashboardModule {
  id: string;
  title: string;
  description: string;
  status: string;
  isActive: boolean;
  href?: string;
}

const MODULES: DashboardModule[] = [
  {
    id: "home",
    title: "Accueil",
    description: "Gestion des accroches, showreel, duo, savoir-faire, contact et bloc SEMPRA.",
    status: "Actif",
    isActive: true,
    href: "/admin/home",
  },
  {
    id: "portfolio",
    title: "Projets et portfolio",
    description: "Création des fiches projets, catégorisation, photos et vidéos associées.",
    status: "Lot suivant",
    isActive: false,
  },
  {
    id: "studio",
    title: "Studio",
    description: "Présentation de l'équipe, portraits Ludovic & Maxime, rôles et approche.",
    status: "Actif",
    isActive: true,
    href: "/admin/studio",
  },
  {
    id: "contact",
    title: "Contact",
    description: "Coordonnées professionnelles, réseaux sociaux et paramètres de messagerie.",
    status: "Lot suivant",
    isActive: false,
  },
  {
    id: "company",
    title: "Parametres de l'entreprise",
    description: "Denomination, siege social, TVA, BCE et identite de la structure.",
    status: "Lot suivant",
    isActive: false,
  },
  {
    id: "galleries",
    title: "Galeries clients",
    description: "Creation des galeries privees, codes uniques et gestion des acces clients.",
    status: "Lot suivant",
    isActive: false,
  },
  {
    id: "retention",
    title: "Conservation et suppression",
    description: "Politique de purge automatique, export de donnees et conformite RGPD.",
    status: "Lot suivant",
    isActive: false,
  },
  {
    id: "legal",
    title: "Pages legales et cookies",
    description: "Edition des mentions legales, politique de confidentialite, CGV et traceurs.",
    status: "Lot suivant",
    isActive: false,
  },
];

export default function AdminDashboardPage() {
  const { csrfToken } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoggingOut = navigation.state === "submitting";

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.brandTitle}>Administration Parallax</h1>
          <span className={styles.statusBadge}>Session active</span>
        </div>
        <Form method="post" action="/admin/logout" className={styles.logoutForm}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <button
            type="submit"
            disabled={isLoggingOut}
            className={styles.logoutButton}
          >
            {isLoggingOut ? "Deconnexion..." : "Se deconnecter"}
          </button>
        </Form>
      </header>

      <main className={styles.mainContent}>
        <div className={styles.leadSection}>
          <h2 className={styles.pageTitle}>Modules d'administration</h2>
          <p className={styles.pageSubtitle}>
            Sélectionnez un module pour administrer le contenu du site. Les modules Accueil et Studio sont actifs pour ce lot.
          </p>
        </div>

        <div className={styles.grid}>
          {MODULES.map((mod) => {
            if (mod.isActive && mod.href) {
              return (
                <Link
                  key={mod.id}
                  to={mod.href}
                  className={`${styles.card} ${styles.cardActive}`}
                >
                  <div>
                    <span className={`${styles.cardBadge} ${styles.cardBadgeActive}`}>
                      {mod.status}
                    </span>
                    <h3 className={styles.cardTitle}>{mod.title}</h3>
                    <p className={styles.cardDescription}>{mod.description}</p>
                  </div>
                  <div className={styles.cardFooter}>
                    <span className={styles.cardActionActive}>
                      Administrer →
                    </span>
                  </div>
                </Link>
              );
            }

            return (
              <article key={mod.id} className={styles.card}>
                <div>
                  <span className={styles.cardBadge}>{mod.status}</span>
                  <h3 className={styles.cardTitle}>{mod.title}</h3>
                  <p className={styles.cardDescription}>{mod.description}</p>
                </div>
                <div className={styles.cardFooter}>
                  <button
                    type="button"
                    disabled
                    className={styles.cardActionDisabled}
                  >
                    Indisponible dans ce lot
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
