import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersArgs } from "react-router";
import { data, Link, useFetcher, useLoaderData } from "react-router";
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
import type { CompanyContent, LegalPersonalityType, VatRegimeType } from "../../lib/site-content.shared";
import { isRpmApplicable } from "../../lib/site-content.shared";
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
  corruptionError?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const { content, isCorrupted, corruptionError } = getRawSiteContent();
  const csrfToken = session.get("csrfToken") || "";

  return data<AdminCompanyLoaderData>(
    {
      csrfToken,
      company: content.company,
      revision: content.revision,
      isCorrupted,
      corruptionError: isCorrupted ? (corruptionError || "Erreur de format ou de validation") : undefined,
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
  const loaderData = useLoaderData<AdminCompanyLoaderData>();
  const fetcher = useFetcher<{
    success?: boolean;
    error?: string;
    conflict?: boolean;
    newRevision?: string;
    serverRevision?: string;
  }>();
  const isSubmitting = fetcher.state === "submitting" || fetcher.state === "loading";

  const [company, setCompany] = useState<CompanyContent>(loaderData.company);
  const [currentRevision, setCurrentRevision] = useState<string>(loaderData.revision);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.newRevision) {
      setCurrentRevision(fetcher.data.newRevision);
      setFeedback({
        type: "success",
        text: "Paramètres de l'entreprise enregistrés avec succès. Les coordonnées canoniques ont été synchronisées.",
      });
    } else if (fetcher.data?.conflict) {
      setFeedback({
        type: "error",
        text:
          fetcher.data.error ||
          "Conflit de révision : le contenu a été modifié par un autre administrateur. Vos modifications locales ont été conservées.",
      });
    } else if (fetcher.data?.error) {
      setFeedback({
        type: "error",
        text: fetcher.data.error,
      });
    }
  }, [fetcher.data]);

  const handleChange = (field: keyof CompanyContent, value: string | boolean) => {
    setCompany((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAdoptServerRevision = () => {
    if (fetcher.data?.serverRevision) {
      setCurrentRevision(fetcher.data.serverRevision);
      setFeedback({
        type: "error",
        text: "Révision serveur adoptée. Vous pouvez maintenant soumettre vos modifications.",
      });
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = new URLSearchParams();
    body.set("csrfToken", loaderData.csrfToken);
    body.set("revision", currentRevision);
    body.set("companyData", JSON.stringify(company));
    fetcher.submit(body, { method: "POST" });
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
          <span className={`${formStyles.revisionTag} ${loaderData.isCorrupted ? formStyles.revisionTagCorrupted : ""}`}>
            {loaderData.isCorrupted ? "Révision : Indisponible (fichier non valide)" : `Révision : ${currentRevision}`}
          </span>
        </div>

        {loaderData.isCorrupted && (
          <div className={formStyles.alertError} role="alert">
            <p>
              <strong>Attention : contenu de secours actif en mémoire :</strong> Le fichier de configuration présente une anomalie de validation et les modifications sont bloquées pour protéger vos données.
            </p>
            {loaderData.corruptionError && (
              <p className={formStyles.alertSubText}>
                Détail de la validation : <code className={formStyles.alertCode}>{loaderData.corruptionError}</code>
              </p>
            )}
            <p className={formStyles.alertSubText}>
              Aucune restauration automatique n&apos;a été effectuée sur le disque afin de préserver votre fichier existant.
            </p>
          </div>
        )}

        {feedback && (
          <div
            role={feedback.type === "error" ? "alert" : "status"}
            className={
              feedback.type === "error" ? formStyles.statusError : formStyles.statusSuccess
            }
          >
            {feedback.text}
            {fetcher.data?.conflict && (
              <div className={formStyles.conflictActions}>
                <button
                  type="button"
                  onClick={handleAdoptServerRevision}
                  className={formStyles.adoptRevisionButton}
                >
                  Adopter la révision du serveur ({fetcher.data.serverRevision})
                </button>
              </div>
            )}
          </div>
        )}

        <form method="post" onSubmit={handleSubmit}>
          {/* Card 1: Identification & Statut Juridique */}
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>1. Identification & Statut juridique (Belgique)</h2>
            <p className={formStyles.helper}>
              Informations relatives à l'exploitant du site. En Belgique, le nom commercial peut différer de la dénomination légale de l'exploitant (personne physique ou morale).
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
                Marque commerciale affichée sur le site (synchronisée avec common.brandName).
              </span>
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-legalName" className={formStyles.label}>
                Dénomination légale / Nom de l'exploitant
              </label>
              <input
                id="company-legalName"
                type="text"
                className={formStyles.input}
                value={company.legalName}
                onChange={(e) => handleChange("legalName", e.target.value)}
                placeholder="Ex. Maxime Dupont ou Studio Parallax SRL"
              />
              <span className={formStyles.helper}>
                Identité juridique de l'exploitant responsable. Si elle diffère du nom commercial, les deux seront affichés distinctement dans les mentions légales.
              </span>
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
                placeholder="Ex. Entreprise individuelle, Association de fait, SRL, etc."
              />
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-legalPersonality" className={formStyles.label}>
                Situation juridique (applicabilité du RPM)
              </label>
              <select
                id="company-legalPersonality"
                className={formStyles.select}
                value={company.legalPersonality || ""}
                onChange={(e) => {
                  const val = e.target.value as LegalPersonalityType;
                  handleChange("legalPersonality", val);
                }}
              >
                <option value="">À déterminer / Non renseigné</option>
                <option value="natural_person">Personne physique (Entreprise individuelle / Indépendant : RPM non applicable)</option>
                <option value="unincorporated_association">Association sans personnalité juridique (Association de fait : RPM non applicable)</option>
                <option value="legal_entity">Personne morale (SRL, SA, ASBL, SC, etc. : RPM applicable)</option>
              </select>
              <span className={formStyles.helper}>
                En droit belge (art. 2:20 CSA), le Registre des Personnes Morales s&apos;applique exclusivement aux personnes morales.
              </span>
            </div>

            <div className={formStyles.row2}>
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
                <span className={formStyles.helper}>
                  Numéro unique d'identification à la Banque-Carrefour des Entreprises (10 chiffres).
                </span>
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
                <span className={formStyles.helper}>
                  Numéro d'assujettissement TVA (si assujetti).
                </span>
              </div>
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-vatRegimeType" className={formStyles.label}>
                Régime d'assujettissement TVA
              </label>
              <select
                id="company-vatRegimeType"
                className={formStyles.select}
                value={company.vatRegimeType || ""}
                onChange={(e) => {
                  const val = e.target.value as VatRegimeType;
                  handleChange("vatRegimeType", val);
                  if (val === "standard" && !company.vatRegime) {
                    handleChange("vatRegime", "Régime normal de TVA");
                  } else if (val === "small_business_exemption" && !company.vatRegime) {
                    handleChange("vatRegime", "Franchise de taxe pour petites entreprises (art. 56bis du Code de la TVA)");
                  } else if (val === "non_subject" && !company.vatRegime) {
                    handleChange("vatRegime", "Non assujetti à la TVA");
                  }
                }}
              >
                <option value="">À déterminer / Non renseigné</option>
                <option value="standard">Régime normal de TVA (soumis à la TVA)</option>
                <option value="small_business_exemption">Régime de franchise de taxe pour petites entreprises (art. 56bis)</option>
                <option value="non_subject">Non assujetti à la TVA (hors champ ou opérations exemptées)</option>
                <option value="other">Autre situation particulière (à préciser ci-dessous)</option>
              </select>
              <span className={formStyles.helper}>
                Sélectionnez votre situation fiscale réelle. Le numéro de TVA seul ne permet pas de déduire le régime.
              </span>
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-vatRegime" className={formStyles.label}>
                Libellé du régime TVA (mention légale et CGV)
              </label>
              <input
                id="company-vatRegime"
                type="text"
                className={formStyles.input}
                value={company.vatRegime || ""}
                onChange={(e) => handleChange("vatRegime", e.target.value)}
                placeholder="Ex. Régime normal de TVA ou Franchise de taxe pour petites entreprises (art. 56bis du Code de la TVA)"
              />
              <span className={formStyles.helper}>
                Précise les modalités d'application de la TVA sur vos tarifs et factures (notamment dans les CGV).
              </span>
            </div>

            <div className={formStyles.field}>
              <label className={formStyles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(company.isPublished)}
                  onChange={(e) => handleChange("isPublished", e.target.checked)}
                  className={formStyles.checkboxInput}
                />
                <span className={formStyles.checkboxText}>
                  Confirmer et autoriser la publication des coordonnées juridiques sur le site public
                </span>
              </label>
              <span className={formStyles.checkboxHelper}>
                Tant que cette case n'est pas cochée, le siège social, le numéro BCE et les mentions légales complètes restent masqués des visiteurs publics.
              </span>
            </div>
          </div>

          {/* Card 2: Immatriculation & RPM */}
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>2. Immatriculation & Registre (RPM)</h2>
            <p className={formStyles.helper}>
              Pour les personnes morales concernées (art. 2:20 CSA). Ce champ n&apos;attribue pas de compétence judiciaire contractuelle.
            </p>

            {isRpmApplicable(company) === false ? (
              <div className={formStyles.infoNotice}>
                <strong>Non applicable :</strong> En personne physique ou association sans personnalité juridique, vous ne disposez pas d&apos;un Registre des Personnes Morales (RPM). Ce champ peut rester vide sans empêcher la publication des mentions légales et des conditions générales.
              </div>
            ) : isRpmApplicable(company) === true ? (
              <div className={company.rpmJurisdiction ? formStyles.successNotice : formStyles.warningNotice}>
                {company.rpmJurisdiction ? (
                  <span>✓ <strong>Requis et renseigné :</strong> Greffe du tribunal de l&apos;entreprise où le dossier est tenu.</span>
                ) : (
                  <span>⚠️ <strong>Requis pour les personnes morales :</strong> Veuillez indiquer le tribunal de l&apos;entreprise compétent pour votre siège (ex. Tribunal de l&apos;entreprise francophone de Bruxelles).</span>
                )}
              </div>
            ) : (
              <div className={formStyles.warningNotice}>
                ⚠️ <strong>Statut à confirmer :</strong> Veuillez renseigner votre situation juridique dans la section 1 ci-dessus pour déterminer si le RPM s&apos;applique à votre structure.
              </div>
            )}

            <div className={formStyles.field}>
              <label htmlFor="company-rpmJurisdiction" className={formStyles.label}>
                RPM / Registre des Personnes Morales compétent
              </label>
              <input
                id="company-rpmJurisdiction"
                type="text"
                className={formStyles.input}
                value={company.rpmJurisdiction || ""}
                onChange={(e) => handleChange("rpmJurisdiction", e.target.value)}
                placeholder="Ex. Tribunal de l'entreprise francophone de Bruxelles (ou Liège, Mons, etc.)"
              />
              <span className={formStyles.helper}>
                Indique le tribunal de l&apos;entreprise où le dossier de la personne morale est déposé. Ne concerne pas les personnes physiques.
              </span>
            </div>
          </div>

          {/* Card 3: Siège social & Direction */}
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>3. Établissement, Siège social & Direction</h2>

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
                placeholder="Rue et numéro&#10;Code postal Localité&#10;Belgique"
              />
            </div>

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
                placeholder="Ex. Maxime Dupont"
              />
            </div>
          </div>

          {/* Card 4: Vie privée & RGPD */}
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>4. Vie privée & Protection des données (RGPD)</h2>
            <p className={formStyles.helper}>
              Informations relatives à l'exercice des droits d'accès, de rectification et d'effacement prévus par le Règlement Général sur la Protection des Données (RGPD).
            </p>

            <div className={formStyles.row2}>
              <div className={formStyles.field}>
                <label htmlFor="company-privacyContact" className={formStyles.label}>
                  Référent / Contact pour les droits
                </label>
                <input
                  id="company-privacyContact"
                  type="text"
                  className={formStyles.input}
                  value={company.privacyContact}
                  onChange={(e) => handleChange("privacyContact", e.target.value)}
                  placeholder="Ex. Maxime Dupont (Référent vie privée)"
                />
              </div>

              <div className={formStyles.field}>
                <label htmlFor="company-privacyEmail" className={formStyles.label}>
                  E-mail dédié vie privée (optionnel)
                </label>
                <input
                  id="company-privacyEmail"
                  type="email"
                  className={formStyles.input}
                  value={company.privacyEmail || ""}
                  onChange={(e) => handleChange("privacyEmail", e.target.value)}
                  placeholder="Ex. privacy@parallax.be (laisser vide pour utiliser l'e-mail principal)"
                />
              </div>
            </div>

            <div className={formStyles.field}>
              <label className={formStyles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(company.dpoDesignated)}
                  onChange={(e) => handleChange("dpoDesignated", e.target.checked)}
                  className={formStyles.checkboxInput}
                />
                <span className={formStyles.checkboxText}>
                  Un Délégué à la Protection des Données (DPO) a été officiellement désigné
                </span>
              </label>
              <span className={formStyles.checkboxHelper}>
                Ne cochez cette case que si vous avez formellement désigné un DPO auprès de l'Autorité de Protection des Données (APD). En studio photo/vidéo indépendant, la désignation est généralement facultative.
              </span>
            </div>

            {company.dpoDesignated && (
              <div className={formStyles.field}>
                <label htmlFor="company-dpoContact" className={formStyles.label}>
                  Coordonnées du DPO désigné
                </label>
                <input
                  id="company-dpoContact"
                  type="text"
                  className={formStyles.input}
                  value={company.dpoContact || ""}
                  onChange={(e) => handleChange("dpoContact", e.target.value)}
                  placeholder="Ex. dpo@exemple.be"
                />
              </div>
            )}
          </div>

          {/* Card 5: Hébergement & Prestataires */}
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>5. Hébergement & Prestataires tiers</h2>
            <p className={formStyles.helper}>
              Informations légales sur l'hébergeur web et les services d'infrastructure utilisés. Les identifiants techniques et mots de passe SMTP restent strictement confidentiels dans le fichier <code>.env.local</code> et ne sont pas configurés ici.
            </p>

            <div className={formStyles.row2}>
              <div className={formStyles.field}>
                <label htmlFor="company-hostingProvider" className={formStyles.label}>
                  Nom de l'hébergeur web
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
                <label htmlFor="company-hostingCountry" className={formStyles.label}>
                  Pays / Localisation des serveurs
                </label>
                <input
                  id="company-hostingCountry"
                  type="text"
                  className={formStyles.input}
                  value={company.hostingCountry || ""}
                  onChange={(e) => handleChange("hostingCountry", e.target.value)}
                  placeholder="Ex. Suisse (ou Belgique / Union Européenne)"
                />
              </div>
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-hostingAddress" className={formStyles.label}>
                Adresse postale de l'hébergeur
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

            <div className={formStyles.row2}>
              <div className={formStyles.field}>
                <label htmlFor="company-emailService" className={formStyles.label}>
                  Prestataire d'envoi d'e-mails transactionnels
                </label>
                <input
                  id="company-emailService"
                  type="text"
                  className={formStyles.input}
                  value={company.emailService || ""}
                  onChange={(e) => handleChange("emailService", e.target.value)}
                  placeholder="Ex. Brevo (envisagé, activation selon configuration SMTP)"
                />
              </div>

              <div className={formStyles.field}>
                <label htmlFor="company-galleryStorageService" className={formStyles.label}>
                  Stockage des galeries privées
                </label>
                <input
                  id="company-galleryStorageService"
                  type="text"
                  className={formStyles.input}
                  value={company.galleryStorageService || ""}
                  onChange={(e) => handleChange("galleryStorageService", e.target.value)}
                  placeholder="Ex. Serveur dédié hébergé en Suisse / UE"
                />
              </div>
            </div>
          </div>

          {/* Card 6: Conservation des données */}
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>6. Délais de conservation des données</h2>
            <p className={formStyles.helper}>
              Durées déclarées dans la Politique de confidentialité. La purge effective des médias est régie par le module de rétention automatique du serveur sans conflit.
            </p>

            <div className={formStyles.field}>
              <label htmlFor="company-retentionContactRequests" className={formStyles.label}>
                Demandes de contact et devis sans suite
              </label>
              <input
                id="company-retentionContactRequests"
                type="text"
                className={formStyles.input}
                value={company.retentionContactRequests || ""}
                onChange={(e) => handleChange("retentionContactRequests", e.target.value)}
                placeholder="Ex. 12 mois à compter du dernier échange"
              />
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-retentionClientRecords" className={formStyles.label}>
                Dossiers clients, contrats et facturation
              </label>
              <input
                id="company-retentionClientRecords"
                type="text"
                className={formStyles.input}
                value={company.retentionClientRecords || ""}
                onChange={(e) => handleChange("retentionClientRecords", e.target.value)}
                placeholder="Ex. 7 ans (délai légal de conservation des documents comptables en Belgique)"
              />
            </div>

            <div className={formStyles.field}>
              <label htmlFor="company-retentionMediaGalleries" className={formStyles.label}>
                Fichiers médias et galeries privées
              </label>
              <input
                id="company-retentionMediaGalleries"
                type="text"
                className={formStyles.input}
                value={company.retentionMediaGalleries || ""}
                onChange={(e) => handleChange("retentionMediaGalleries", e.target.value)}
                placeholder="Ex. 3 mois minimum à compter de la livraison (selon conditions du devis)"
              />
            </div>
          </div>

          {/* Card 7: Conditions des prestations */}
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>7. Conditions des prestations & Choix commerciaux</h2>
            <p className={formStyles.helper}>
              Informations relatives à la relation commerciale. Les prestations du studio Parallax font l'objet d'un devis préalable personnalisé convenu entre les parties.
            </p>

            <div className={formStyles.field}>
              <label htmlFor="company-clientTypes" className={formStyles.label}>
                Clientèle ciblée
              </label>
              <select
                id="company-clientTypes"
                className={formStyles.select}
                value={company.clientTypes || ""}
                onChange={(e) => handleChange("clientTypes", e.target.value as "b2b" | "b2c" | "both" | "")}
              >
                <option value="">Non renseigné / À confirmer</option>
                <option value="both">Particuliers (B2C) et Professionnels (B2B)</option>
                <option value="b2b">Professionnels uniquement (B2B)</option>
                <option value="b2c">Particuliers uniquement (B2C)</option>
              </select>
              <span className={formStyles.helper}>
                Pour les clients consommateurs (B2C), le droit impératif de la consommation s'applique. Les acomptes, délais et révisions sont fixés au devis accepté.
              </span>
            </div>
          </div>

          {/* Card 8: Coordonnées publiques & Réseaux canoniques */}
          <div className={formStyles.card}>
            <h2 className={formStyles.cardTitle}>8. Coordonnées publiques & Réseaux canoniques</h2>
            <p className={formStyles.helper}>
              Source unique de coordonnées canoniques. Toute mise à jour ici est automatiquement répercutée sur les sections Contact et Accueil.
            </p>

            <div className={formStyles.row2}>
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

            <div className={formStyles.row2}>
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

          <div className={formStyles.submitActionsRow}>
            <button
              type="submit"
              disabled={loaderData.isCorrupted || isSubmitting}
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
