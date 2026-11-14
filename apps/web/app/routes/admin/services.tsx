import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  SERVICE_AREA_MAX_LENGTH,
  SERVICE_OFFER_COUNT,
  SERVICE_OFFER_FIELDS,
  SERVICE_PAGE_FIELDS,
  SERVICE_PAGE_IDS,
  type LocalizedString,
} from "@parallax/shared";
import { composeAdminHeaders, createAdminHeaders, requireValidAdminSession } from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { ActionSecurityError, readStrictFormUrlEncoded, validateOrigin } from "../../lib/security.server";
import { getServicesContent, services } from "../../lib/service-content";
import { getRawSiteContent, RevisionConflictError, saveServicesContent, ValidationError } from "../../lib/site-content.server";
import styles from "./adminForms.module.css";

const languages = ["fr", "en"] as const;
const pageFields = [
  { key: "title", label: "Titre sur la page" },
  { key: "seoTitle", label: "Titre SEO" },
  { key: "description", label: "Description SEO", multiline: true },
  { key: "intro", label: "Introduction", multiline: true },
  { key: "linkLabel", label: "Libellé du lien vers la page" },
  { key: "quoteLabel", label: "Libellé du bouton de devis" },
] as const;
const offerFields = [
  { key: "title", label: "Titre" },
  { key: "text", label: "Description", multiline: true },
] as const;
const pageNames = { photo: "Photographie", video: "Production vidéo" };
// Percent-encoded UTF-8 can use up to nine bytes per UTF-16 code unit.
const maxFormBytes = 192 * 1024;

const fieldPrefixes = [
  "area",
  ...SERVICE_PAGE_IDS.flatMap((id) => [
    ...pageFields.map(({ key }) => `${id}.${key}`),
    ...Array.from({ length: SERVICE_OFFER_COUNT }, (_, index) =>
      offerFields.map(({ key }) => `${id}.offerings.${index}.${key}`)
    ).flat(),
  ]),
];

export function meta() {
  return [
    { title: "Administration - Services photo et vidéo | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export const headers = composeAdminHeaders;

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const { content, isCorrupted } = getRawSiteContent();
  return data({
    csrfToken: session.get("csrfToken") || "",
    revision: content.revision,
    services: getServicesContent(content),
    isCorrupted,
  }, { headers: createAdminHeaders() });
}

export async function action({ request }: ActionFunctionArgs) {
  const headers = createAdminHeaders();
  const session = await requireValidAdminSession(request);

  try {
    if (request.method === "POST" && !validateOrigin(request)) {
      throw new ActionSecurityError("Origine de la requête invalide.", 403);
    }
    const form = await readStrictFormUrlEncoded(request, maxFormBytes, [
      "csrfToken", "revision", ...fieldPrefixes.flatMap((prefix) => languages.map((lang) => `${prefix}.${lang}`)),
    ]);
    const csrf = form.get("csrfToken");
    const expected = session.get("csrfToken");
    if (!csrf || !expected || !constantTimeEqual(csrf, expected)) {
      throw new ActionSecurityError("Jeton de sécurité invalide.", 403);
    }
    const revision = form.get("revision");
    if (!revision || !/^[0-9a-f]{32}$/i.test(revision)) {
      throw new ActionSecurityError("Révision invalide.", 400);
    }

    const readText = (prefix: string) => ({ fr: form.get(`${prefix}.fr`), en: form.get(`${prefix}.en`) });
    const readPage = (id: (typeof SERVICE_PAGE_IDS)[number]) => ({
      ...Object.fromEntries(pageFields.map(({ key }) => [key, readText(`${id}.${key}`)])),
      offerings: Array.from({ length: SERVICE_OFFER_COUNT }, (_, index) => ({
        title: readText(`${id}.offerings.${index}.title`),
        text: readText(`${id}.offerings.${index}.text`),
      })),
    });

    saveServicesContent({ area: readText("area"), photo: readPage("photo"), video: readPage("video") }, revision);
    return data({ saved: true }, { headers });
  } catch (error) {
    if (error instanceof ActionSecurityError) {
      if (error.status === 405) headers.set("Allow", "POST");
      return data({ error: error.message }, { status: error.status, headers });
    }
    if (error instanceof RevisionConflictError) {
      return data(
        { error: "Le contenu a changé dans un autre onglet. Copiez vos modifications avant de recharger cette page." },
        { status: 409, headers }
      );
    }
    if (error instanceof ValidationError) {
      return data({ error: error.message }, { status: 422, headers });
    }
    return data({ error: "Impossible d’enregistrer les textes." }, { status: 500, headers });
  }
}

type TextFieldProps = {
  name: string;
  label: string;
  value: string;
  maxLength: number;
  multiline?: boolean;
};

function TextField({ name, label, value, maxLength, multiline }: TextFieldProps) {
  const props = { id: name, name, defaultValue: value, maxLength, required: true };
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={name}>{label}</label>
      {multiline
        ? <textarea {...props} rows={3} className={styles.textarea} />
        : <input {...props} type="text" className={styles.input} />}
    </div>
  );
}

function AreaFields({ area }: { area: LocalizedString }) {
  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>Zone d’intervention</h2>
      <p className={styles.sectionSubtitle}>Ce texte figure sur l’accueil, la page Contact et les deux pages de service.</p>
      <div className={styles.row2}>
        {languages.map((lang) => (
          <TextField key={lang} name={`area.${lang}`} label={lang.toUpperCase()} value={area[lang]}
            maxLength={SERVICE_AREA_MAX_LENGTH} multiline />
        ))}
      </div>
    </section>
  );
}

export default function AdminServicesPage() {
  const { csrfToken, revision, services: content, isCorrupted } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state !== "idle";

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin/dashboard" className={styles.backLink}>← Retour au tableau de bord</Link>
          <h1 className={styles.pageHeading}>Services photo et vidéo</h1>
        </div>
      </header>

      <main className={styles.mainContent}>
        {isCorrupted && <p role="alert" className={styles.alertError}>Le fichier de contenu est illisible. L’enregistrement est désactivé.</p>}
        {result && "error" in result && <p role="alert" className={styles.alertError}>{result.error}</p>}
        {result && "saved" in result && <p role="status" className={styles.alertSuccess}>Textes enregistrés.</p>}

        <Form method="post" key={revision}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="revision" value={revision} />
          <AreaFields area={content.area} />

          {SERVICE_PAGE_IDS.map((id) => (
            <section key={id} className={styles.sectionCard}>
              <h2 className={styles.sectionTitle}>{pageNames[id]}</h2>
              <p className={styles.sectionSubtitle}>
                Ouvrir la page publique <Link to={services[id].paths.fr} target="_blank" rel="noopener noreferrer">FR</Link>
                {" / "}<Link to={services[id].paths.en} target="_blank" rel="noopener noreferrer">EN</Link>
              </p>

              <div className={styles.row2}>
                {languages.map((lang) => (
                  <div key={lang} lang={lang}>
                    <h3 className={styles.cardTitle}>{lang === "fr" ? "Français" : "English"}</h3>
                    {pageFields.map((field) => (
                      <TextField key={field.key} name={`${id}.${field.key}.${lang}`} label={field.label}
                        value={content[id][field.key][lang]} maxLength={SERVICE_PAGE_FIELDS[field.key]}
                        multiline={"multiline" in field && field.multiline} />
                    ))}

                    {content[id].offerings.map((offer, index) => (
                      <div key={index} className={styles.field}>
                        <h4 className={styles.cardTitle}>Prestation {index + 1}</h4>
                        {offerFields.map((field) => (
                          <TextField key={field.key} name={`${id}.offerings.${index}.${field.key}.${lang}`} label={field.label}
                            value={offer[field.key][lang]} maxLength={SERVICE_OFFER_FIELDS[field.key]}
                            multiline={"multiline" in field && field.multiline} />
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}

          <button type="submit" className={styles.submitButton} disabled={isSaving || isCorrupted}>
            {isSaving ? "Enregistrement…" : "Enregistrer les textes"}
          </button>
        </Form>
      </main>
    </div>
  );
}
