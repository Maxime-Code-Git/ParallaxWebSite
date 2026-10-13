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
import {
  requireValidAdminSession,
  createAdminHeaders,
} from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin, readStrictFormUrlEncoded } from "../../lib/security.server";
import { createGallery, GalleryValidationError } from "../../lib/gallery.server";
import { getAvailableImportFolders, startImportJob, processImportJob } from "../../lib/gallery-import.server";
import styles from "./galleries.module.css";

interface LoaderData {
  folders: string[];
  csrfToken: string;
}

interface ActionData {
  error?: string;
}

export function meta() {
  return [
    { title: "Nouvelle galerie client | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const folders = getAvailableImportFolders();
  const csrfToken = session.get("csrfToken") || "";

  return Response.json({ folders, csrfToken }, { headers: createAdminHeaders() });
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const expectedCsrfToken = session.get("csrfToken") || "";

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...createAdminHeaders(), Allow: "POST" },
    });
  }

  if (!validateOrigin(request)) {
    return Response.json(
      { error: "Origine invalide." },
      { status: 403, headers: createAdminHeaders() }
    );
  }

  let params: URLSearchParams;
  try {
    params = await readStrictFormUrlEncoded(request, 8192);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Payload Too Large") {
      return Response.json({ error: "Requête trop volumineuse." }, { status: 413, headers: createAdminHeaders() });
    }
    return Response.json({ error: "Format invalide." }, { status: 415, headers: createAdminHeaders() });
  }

  const formCsrf = params.get("csrfToken") || "";
  if (!formCsrf || !constantTimeEqual(formCsrf, expectedCsrfToken)) {
    return Response.json(
      { error: "Jeton de sécurité CSRF invalide." },
      { status: 403, headers: createAdminHeaders() }
    );
  }

  const title = (params.get("title") || "").trim();
  const clientName = (params.get("clientName") || "").trim();
  const projectDate = (params.get("projectDate") || "").trim();
  const location = (params.get("location") || "").trim() || undefined;
  const introFr = (params.get("introFr") || "").trim() || undefined;
  const introEn = (params.get("introEn") || "").trim() || undefined;
  const signatureFr = (params.get("signatureFr") || "").trim() || undefined;
  const signatureEn = (params.get("signatureEn") || "").trim() || undefined;

  const expiresStr = (params.get("expiresAt") || "").trim();
  let expiresAt: number | null = null;
  if (expiresStr) {
    const d = new Date(expiresStr);
    if (!isNaN(d.getTime())) {
      expiresAt = d.getTime();
    }
  }

  const importFolder = (params.get("importFolder") || "").trim();

  try {
    const { gallery } = createGallery({
      title,
      clientName,
      projectDate,
      location,
      introFr,
      introEn,
      signatureFr,
      signatureEn,
      expiresAt,
    });

    if (importFolder) {
      try {
        const jobId = startImportJob(gallery.id, importFolder);
        // Trigger asynchronous processing
        void processImportJob(jobId).catch((err) => {
          console.error("Failed to process background import job:", err);
        });
      } catch (importErr) {
        console.error("Initial import setup error:", importErr);
      }
    }

    return redirect(`/admin/galleries/${gallery.id}`, {
      status: 303,
      headers: createAdminHeaders(),
    });
  } catch (err) {
    if (err instanceof GalleryValidationError) {
      return Response.json({ error: err.message }, { status: 400, headers: createAdminHeaders() });
    }
    return Response.json(
      { error: `Erreur inattendue: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500, headers: createAdminHeaders() }
    );
  }
}

export default function AdminGalleryNewPage() {
  const { folders, csrfToken } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin/galleries" className={styles.backLink}>
            ← Galeries
          </Link>
          <h1 className={styles.pageTitle}>Créer une nouvelle galerie</h1>
        </div>
      </header>

      <main className={styles.content}>
        {actionData?.error && (
          <div className={styles.alertError} role="alert">
            {actionData.error}
          </div>
        )}

        <Form method="post" className={styles.sectionCard}>
          <input type="hidden" name="csrfToken" value={csrfToken} />

          <h2 className={styles.sectionTitle}>Informations principales</h2>

          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label htmlFor="title" className={styles.label}>
                Titre du projet *
              </label>
              <input
                id="title"
                name="title"
                type="text"
                required
                maxLength={100}
                placeholder="Ex. Clip Vidéo Horizon"
                className={styles.input}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="clientName" className={styles.label}>
                Nom du client ou de l'artiste *
              </label>
              <input
                id="clientName"
                name="clientName"
                type="text"
                required
                maxLength={100}
                placeholder="Ex. Maison Horizon"
                className={styles.input}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="projectDate" className={styles.label}>
                Date du projet *
              </label>
              <input
                id="projectDate"
                name="projectDate"
                type="date"
                required
                defaultValue={today}
                className={styles.input}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="location" className={styles.label}>
                Lieu (facultatif)
              </label>
              <input
                id="location"
                name="location"
                type="text"
                maxLength={100}
                placeholder="Ex. Bruxelles, Belgique"
                className={styles.input}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="expiresAt" className={styles.label}>
                Date d'expiration d'accès (facultatif en brouillon)
              </label>
              <input
                id="expiresAt"
                name="expiresAt"
                type="date"
                min={today}
                className={styles.input}
              />
            </div>

            {folders.length > 0 && (
              <div className={styles.formGroup}>
                <label htmlFor="importFolder" className={styles.label}>
                  Dossier d'import initial (facultatif)
                </label>
                <select id="importFolder" name="importFolder" className={styles.select}>
                  <option value="">-- Aucun dossier d'import --</option>
                  {folders.map((f) => (
                    <option key={f} value={f}>
                      📁 {f}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={`${styles.formGroup} ${styles.formFullWidth}`}>
              <label htmlFor="introFr" className={styles.label}>
                Texte d'accueil (FR)
              </label>
              <textarea
                id="introFr"
                name="introFr"
                rows={3}
                defaultValue="Merci pour votre confiance. Voici vos photos et vidéos : téléchargez-les à volonté, elles sont à vous."
                className={styles.textarea}
              />
            </div>

            <div className={`${styles.formGroup} ${styles.formFullWidth}`}>
              <label htmlFor="introEn" className={styles.label}>
                Texte d'accueil (EN)
              </label>
              <textarea
                id="introEn"
                name="introEn"
                rows={3}
                defaultValue="Thank you for your trust. Here are your photos and videos: feel free to download them, they are yours."
                className={styles.textarea}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="signatureFr" className={styles.label}>
                Signature (FR)
              </label>
              <input
                id="signatureFr"
                name="signatureFr"
                type="text"
                defaultValue="Maxime & Ludovic"
                className={styles.input}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="signatureEn" className={styles.label}>
                Signature (EN)
              </label>
              <input
                id="signatureEn"
                name="signatureEn"
                type="text"
                defaultValue="Maxime & Ludovic"
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.actionsRow}>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`${styles.btn} ${styles.btnPrimary}`}
            >
              {isSubmitting ? "Création en cours..." : "Créer la galerie et générer le code"}
            </button>
            <Link to="/admin/galleries" className={`${styles.btn} ${styles.btnSecondary}`}>
              Annuler
            </Link>
          </div>
        </Form>
      </main>
    </div>
  );
}
