import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersArgs } from "react-router";
import { data, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import {
  validateOrigin,
  readStrictFormUrlEncoded,
  ActionSecurityError,
} from "../../lib/security.server";
import { constantTimeEqual } from "../../lib/auth.server";
import {
  getRawSiteContent,
  saveCompanyContent,
  RevisionConflictError,
  ValidationError,
} from "../../lib/site-content.server";
import type { CompanyContent } from "../../lib/site-content.shared";
import formStyles from "./adminForms.module.css";

export function meta() {
  return [
    { title: "Administration - Paramètres de l'entreprise | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export interface AdminCompanyLoaderData {
  csrfToken: string;
  company: CompanyContent;
  revision: string;
  isCorrupted: boolean;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const { content, isCorrupted } = getRawSiteContent();
  const csrfToken = session.get("csrfToken") || "";

  return data<AdminCompanyLoaderData>(
    {
      csrfToken,
      company: content.company,
      revision: content.revision,
      isCorrupted,
    },
    { headers: createAdminHeaders() }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const headers = createAdminHeaders();
  if (request.method !== "POST") {
    headers.set("Allow", "POST");
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  const session = await requireValidAdminSession(request);
  if (!validateOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers });
  }

  let formData: URLSearchParams;
  try {
    formData = await readStrictFormUrlEncoded(request, 100 * 1024, [
      "csrfToken",
      "revision",
      "companyData",
    ]);
  } catch (err) {
    if (err instanceof ActionSecurityError) {
      if (err.status === 405) headers.set("Allow", "POST");
      return new Response(err.message, { status: err.status, headers });
    }
    return new Response("Bad Request", { status: 400, headers });
  }

  const csrfToken = String(formData.get("csrfToken") || "");
  const sessionCsrf = session.get("csrfToken") || "";
  if (!csrfToken || !constantTimeEqual(csrfToken, sessionCsrf)) {
    return Response.json({ error: "Jeton CSRF invalide." }, { status: 403, headers });
  }

  const revision = String(formData.get("revision") || "");
  const rawCompany = String(formData.get("companyData") || "");

  let companyData: Partial<CompanyContent>;
  try {
    companyData = JSON.parse(rawCompany);
  } catch {
    return Response.json({ error: "Données entreprise invalides." }, { status: 400, headers });
  }

  try {
    const newRevision = saveCompanyContent(companyData as CompanyContent, revision);
    const updated = getRawSiteContent().content;
    return Response.json(
      {
        success: true,
        newRevision,
        company: updated.company,
      },
      { headers }
    );
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      return Response.json(
        {
          error:
            "Conflit de révision : le contenu a été modifié par un autre administrateur. Vos modifications locales ont été conservées.",
          conflict: true,
          serverRevision: err.serverRevision,
        },
        { status: 409, headers }
      );
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400, headers });
    }
    return Response.json(
      { error: "Une erreur inattendue est survenue lors de l'enregistrement." },
      { status: 500, headers }
    );
  }
}

export default function AdminCompanyPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<{
    success?: boolean;
    error?: string;
    conflict?: boolean;
    newRevision?: string;
    serverRevision?: string;
  }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [company, setCompany] = useState<CompanyContent>(loaderData.company);
  const [currentRevision, setCurrentRevision] = useState<string>(loaderData.revision);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  useEffect(() => {
    if (actionData?.success && actionData.newRevision) {
      setCurrentRevision(actionData.newRevision);
      setFeedback({
        type: "success",
        text: "Paramètres de l'entreprise enregistrés avec succès. Les coordonnées canoniques ont été synchronisées.",
      });
    } else if (actionData?.error) {
      setFeedback({
        type: "error",
        text: actionData.error,
      });
    }
  }, [actionData]);

  const handleChange = (field: keyof CompanyContent, value: string | boolean) => {
    setCompany((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAdoptServerRevision = () => {
    if (actionData?.serverRevision) {
      setCurrentRevision(actionData.serverRevision);
      setFeedback({
        type: "error",
        text: "Révision serveur adoptée. Vous pouvez maintenant soumettre vos modifications.",
      });
    }
  };

  return (
    <div className={formStyles.container}>
      <header className={formStyles.header}>
        <div className={formStyles.headerLeft}>
          <Link to="/admin/dashboard" className={formStyles.backLink}>
            ← Retour au tableau de bord
          </Link>
          <h1 className={formStyles.pageHeading}>Paramètres de l'entreprise</h1>
        </div>
      </header>

      <main className={formStyles.mainContent}>
        <div className={formStyles.topBar}>
          <span className={formStyles.revisionTag}>Révision : {currentRevision}</span>
        </div>

        {feedback && (
          <div
            role={feedback.type === "error" ? "alert" : "status"}
            className={
              feedback.type === "error" ? formStyles.statusError : formStyles.statusSuccess
            }
            style={{ marginBottom: "24px" }}
          >
            {feedback.text}
            {actionData?.conflict && (
              <div style={{ marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={handleAdoptServerRevision}
                  className={formStyles.langTab}
                  style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
                >
                  Adopter la révision du serveur ({actionData.serverRevision})
                </button>
              </div>
            )}
          </div>
        )}

        <form method="post" onSubmit={(e) => {
          // Native submission with strict URL encoded body
          e.preventDefault();
          const form = e.currentTarget;
          const formData = new FormData();
          formData.set("csrfToken", loaderData.csrfToken);
          formData.set("revision", currentRevision);
          formData.set("companyData", JSON.stringify(company));

          // Use fetch for exact parity with other admin screens
          const body = new URLSearchParams();
          body.set("csrfToken", loaderData.csrfToken);
          body.set("revision", currentRevision);
          body.set("companyData", JSON.stringify(company));

          const submitBtn = form.querySelector("button[type=submit]") as HTMLButtonElement;
          if (submitBtn) submitBtn.disabled = true;

          fetch("/admin/company", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
          })
            .then(async (res) => {
              const data = await res.json();
              if (res.ok && data.success) {
                setCurrentRevision(data.newRevision);
                setFeedback({
                  type: "success",
                  text: "Paramètres de l'entreprise enregistrés avec succès. Les coordonnées canoniques ont été synchronisées.",
                });
              } else {
                setFeedback({
                  type: "error",
                  text: data.error || "Erreur lors de l'enregistrement.",
                });
              }
            })
            .catch(() => {
              setFeedback({
                type: "error",
                text: "Erreur réseau lors de l'enregistrement.",
              });
            })
            .finally(() => {
              if (submitBtn) submitBtn.disabled = false;
            });
        }}>
          {/* Card 1: Identification & Statut Juridique */}
          <div className={formStyles.card} style={{ marginBottom: "28px" }}>
            <h2 className={formStyles.cardTitle}>Identification & Forme juridique</h2>
            <p className={formStyles.helper}>
              Informations relatives à l'exploitant du site. Si ces informations ne sont pas encore confirmées, laissez la case « Confirmation de publication » décochée pour préserver leur confidentialité.
            </p>

            <div className={formStyles.field}>
              <label htmlFor="company-tradeName" className={formStyles.label}>
                Nom commercial / Marque
              </label>
              <input
                id="company-tradeName"
                type="text"
                className={formStyles.input}
                value={company.tradeName}
                onChange={(e) => handleChange("tradeName", e.target.value)}
                placeholder="Parallax"
              />
              <span className={formStyles.helper}>
                Synchronisé avec le nom de marque global (common.brandName).
              </span>
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-legalName" className={formStyles.label}>
                Dénomination de l'exploitant / Raison sociale
              </label>
              <input
                id="company-legalName"
                type="text"
                className={formStyles.input}
                value={company.legalName}
                onChange={(e) => handleChange("legalName", e.target.value)}
                placeholder="Ex. Maxime & associés"
              />
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-legalForm" className={formStyles.label}>
                Forme juridique
              </label>
              <input
                id="company-legalForm"
                type="text"
                className={formStyles.input}
                value={company.legalForm}
                onChange={(e) => handleChange("legalForm", e.target.value)}
                placeholder="Ex. SRL, Entreprise individuelle, etc."
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div className={formStyles.field}>
                <label htmlFor="company-enterpriseNumber" className={formStyles.label}>
                  N° d'entreprise (BCE)
                </label>
                <input
                  id="company-enterpriseNumber"
                  type="text"
                  className={formStyles.input}
                  value={company.enterpriseNumber}
                  onChange={(e) => handleChange("enterpriseNumber", e.target.value)}
                  placeholder="Ex. 0123.456.789"
                />
              </div>

              <div className={formStyles.field}>
                <label htmlFor="company-vatNumber" className={formStyles.label}>
                  N° de TVA
                </label>
                <input
                  id="company-vatNumber"
                  type="text"
                  className={formStyles.input}
                  value={company.vatNumber}
                  onChange={(e) => handleChange("vatNumber", e.target.value)}
                  placeholder="Ex. BE 0123.456.789"
                />
              </div>
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-vatRegime" className={formStyles.label}>
                Note de régime TVA (optionnel)
              </label>
              <input
                id="company-vatRegime"
                type="text"
                className={formStyles.input}
                value={company.vatRegime || ""}
                onChange={(e) => handleChange("vatRegime", e.target.value)}
                placeholder="Ex. Régime de la franchise de taxe pour petites entreprises"
              />
            </div>

            <div className={formStyles.field} style={{ marginTop: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(company.isPublished)}
                  onChange={(e) => handleChange("isPublished", e.target.checked)}
                  style={{ width: "18px", height: "18px", accentColor: "var(--px-accent)" }}
                />
                <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--px-text)" }}>
                  Confirmer et autoriser la publication des coordonnées juridiques sur le site public
                </span>
              </label>
              <span className={formStyles.helper} style={{ marginLeft: "28px" }}>
                Tant que cette case n'est pas cochée, le siège social, le numéro BCE et les mentions légales restent masqués des visiteurs publics.
              </span>
            </div>
          </div>

          {/* Card 2: Siège social & Responsables */}
          <div className={formStyles.card} style={{ marginBottom: "28px" }}>
            <h2 className={formStyles.cardTitle}>Siège social & Direction</h2>

            <div className={formStyles.field}>
              <label htmlFor="company-address" className={formStyles.label}>
                Adresse du siège social / Adresse professionnelle
              </label>
              <textarea
                id="company-address"
                className={formStyles.textarea}
                rows={3}
                value={company.address}
                onChange={(e) => handleChange("address", e.target.value)}
                placeholder="Rue, Numéro&#10;Code postal Localité&#10;Belgique"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div className={formStyles.field}>
                <label htmlFor="company-publicationDirector" className={formStyles.label}>
                  Responsable(s) de la publication
                </label>
                <input
                  id="company-publicationDirector"
                  type="text"
                  className={formStyles.input}
                  value={company.publicationDirector}
                  onChange={(e) => handleChange("publicationDirector", e.target.value)}
                  placeholder="Ex. Maxime"
                />
              </div>

              <div className={formStyles.field}>
                <label htmlFor="company-privacyContact" className={formStyles.label}>
                  Contact pour la confidentialité / RGPD
                </label>
                <input
                  id="company-privacyContact"
                  type="text"
                  className={formStyles.input}
                  value={company.privacyContact}
                  onChange={(e) => handleChange("privacyContact", e.target.value)}
                  placeholder="Ex. privacy@parallax.be ou Maxime"
                />
              </div>
            </div>
          </div>

          {/* Card 3: Hébergeur */}
          <div className={formStyles.card} style={{ marginBottom: "28px" }}>
            <h2 className={formStyles.cardTitle}>Hébergement du site</h2>
            <p className={formStyles.helper}>
              Informations légales obligatoires concernant le prestataire d'hébergement web.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div className={formStyles.field}>
                <label htmlFor="company-hostingProvider" className={formStyles.label}>
                  Nom de l'hébergeur
                </label>
                <input
                  id="company-hostingProvider"
                  type="text"
                  className={formStyles.input}
                  value={company.hostingProvider}
                  onChange={(e) => handleChange("hostingProvider", e.target.value)}
                  placeholder="Ex. Infomaniak Network SA"
                />
              </div>

              <div className={formStyles.field}>
                <label htmlFor="company-hostingAddress" className={formStyles.label}>
                  Adresse de l'hébergeur
                </label>
                <input
                  id="company-hostingAddress"
                  type="text"
                  className={formStyles.input}
                  value={company.hostingAddress}
                  onChange={(e) => handleChange("hostingAddress", e.target.value)}
                  placeholder="Ex. Rue Eugène-Marziano 25, 1227 Genève, Suisse"
                />
              </div>
            </div>
          </div>

          {/* Card 4: Coordonnées publiques & Réseaux canoniques */}
          <div className={formStyles.card} style={{ marginBottom: "28px" }}>
            <h2 className={formStyles.cardTitle}>Coordonnées publiques & Réseaux</h2>
            <p className={formStyles.helper}>
              Source unique de coordonnées canoniques. Toute mise à jour ici est automatiquement répercutée sur les sections Contact et Accueil.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div className={formStyles.field}>
                <label htmlFor="company-email" className={formStyles.label}>
                  E-mail public affiché
                </label>
                <input
                  id="company-email"
                  type="email"
                  className={formStyles.input}
                  value={company.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  placeholder="hello@parallax.be"
                />
              </div>

              <div className={formStyles.field}>
                <label htmlFor="company-phone" className={formStyles.label}>
                  Téléphone public affiché
                </label>
                <input
                  id="company-phone"
                  type="text"
                  className={formStyles.input}
                  value={company.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  placeholder="+32 470 00 00 00"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <div className={formStyles.field}>
                <label htmlFor="company-instagramUrl" className={formStyles.label}>
                  Lien Instagram
                </label>
                <input
                  id="company-instagramUrl"
                  type="url"
                  className={formStyles.input}
                  value={company.instagramUrl}
                  onChange={(e) => handleChange("instagramUrl", e.target.value)}
                  placeholder="https://instagram.com/parallax"
                />
              </div>

              <div className={formStyles.field}>
                <label htmlFor="company-youtubeUrl" className={formStyles.label}>
                  Lien YouTube
                </label>
                <input
                  id="company-youtubeUrl"
                  type="url"
                  className={formStyles.input}
                  value={company.youtubeUrl}
                  onChange={(e) => handleChange("youtubeUrl", e.target.value)}
                  placeholder="https://youtube.com/@parallax"
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "16px", marginTop: "32px" }}>
            <button
              type="submit"
              disabled={isSubmitting}
              className={formStyles.submitButton}
            >
              {isSubmitting ? "Enregistrement..." : "Enregistrer les paramètres"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
