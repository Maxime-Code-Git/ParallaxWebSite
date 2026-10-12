import {
  type LoaderFunctionArgs,
  Form,
  useLoaderData,
  useNavigation,
} from "react-router";
import * as crypto from "node:crypto";
import { requireValidAdminSession, createAdminHeaders } from "../../lib/admin-auth.server";
import { commitSession } from "../../lib/session.server";
import styles from "./dashboard.module.css";

export function meta() {
  return [
    { title: "Tableau de bord | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
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
}

const MODULES: DashboardModule[] = [
  {
    id: "home",
    title: "Accueil",
    description: "Gestion des accroches, photos de vitrine et bandeaux de presentation.",
    status: "Lot suivant",
  },
  {
    id: "portfolio",
    title: "Projets et portfolio",
    description: "Creation des fiches projets, categorisation, photos et videos associees.",
    status: "Lot suivant",
  },
  {
    id: "studio",
    title: "Studio",
    description: "Presentation de l'equipe, savoir-faire, approche et materiel.",
    status: "Lot suivant",
  },
  {
    id: "contact",
    title: "Contact",
    description: "Coordonnees professionnelles, reseaux sociaux et parametres de messagerie.",
    status: "Lot suivant",
  },
  {
    id: "company",
    title: "Parametres de l'entreprise",
    description: "Denomination, siege social, TVA, BCE et identite de la structure.",
    status: "Lot suivant",
  },
  {
    id: "galleries",
    title: "Galeries clients",
    description: "Creation des galeries privees, codes uniques et gestion des acces clients.",
    status: "Lot suivant",
  },
  {
    id: "retention",
    title: "Conservation et suppression",
    description: "Politique de purge automatique, export de donnees et conformite RGPD.",
    status: "Lot suivant",
  },
  {
    id: "legal",
    title: "Pages legales et cookies",
    description: "Edition des mentions legales, politique de confidentialite, CGV et traceurs.",
    status: "Lot suivant",
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

        <Form method="post" action="/admin/logout">
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
          <h2 className={styles.pageTitle}>Tableau de bord</h2>
          <p className={styles.pageSubtitle}>
            Socle d'administration initialise. Les modules de gestion editoriale et de galeries clients seront deployes au fil des lots suivants.
          </p>
        </div>

        <div className={styles.grid}>
          {MODULES.map((mod) => (
            <div key={mod.id} className={styles.card}>
              <div>
                <span className={styles.cardBadge}>{mod.status}</span>
                <h3 className={styles.cardTitle}>{mod.title}</h3>
                <p className={styles.cardDescription}>{mod.description}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
