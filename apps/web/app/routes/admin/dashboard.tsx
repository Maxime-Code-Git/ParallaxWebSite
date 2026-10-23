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
    status: "Actif",
    isActive: true,
    href: "/admin/portfolio",
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
    description: "Coordonnées professionnelles, formulaire, types de projet et statut SMTP.",
    status: "Actif",
    isActive: true,
    href: "/admin/contact",
  },
  {
    id: "company",
    title: "Paramètres de l'entreprise",
    description: "Dénomination, siège social, TVA, BCE, contacts et hébergement.",
    status: "Actif",
    isActive: true,
    href: "/admin/company",
  },
  {
    id: "galleries",
    title: "Galeries clients",
    description: "Création des galeries privées, codes uniques et gestion des accès clients.",
    status: "Actif",
    isActive: true,
    href: "/admin/galleries",
  },
  {
    id: "retention",
    title: "Conservation et suppression",
    description: "Cycle de conservation, prévision des purges, exports privés et suppression sécurisée des galeries.",
    status: "Actif",
    isActive: true,
    href: "/admin/data-retention",
  },
  {
    id: "legal",
    title: "Pages légales et cookies",
    description: "Édition bilingue FR/EN, mentions légales, confidentialité, CGV et inventaire des traceurs.",
    status: "Actif",
    isActive: true,
    href: "/admin/legal",
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
            Sélectionnez un module pour administrer le contenu, les galeries et les paramètres du site Parallax.
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
