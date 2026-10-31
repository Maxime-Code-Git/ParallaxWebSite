import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
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
  saveStudiosContent,
  getSiteContentFilePath,
  cleanStudiosContent,
  RevisionConflictError,
  ValidationError,
} from "../../lib/site-content.server";
import { ENV } from "../../lib/env.server";
import { cleanupUnreferencedMedia } from "../../lib/media-image.server";
import {
  type StudiosContent,
  type StudiosFraming,
  type UploadedMediaMetadata,
} from "../../lib/site-content.shared";
import { ImageUploader } from "../../components/admin/ImageUploader";
import formStyles from "./adminForms.module.css";
import customStyles from "./studios.module.css";

export function meta() {
  return [
    { title: "Administration - Passerelle StudioLM | Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const { content, isCorrupted, corruptionError } = getRawSiteContent();
  const studios = cleanStudiosContent(content?.studios);
  const csrfToken = session.get("csrfToken") || "";

  return Response.json(
    {
      csrfToken,
      studios,
      revision: content.revision,
      isCorrupted,
      corruptionError: isCorrupted ? corruptionError || "Erreur de format ou de validation" : undefined,
      media: content.media || {},
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
    formData = await readStrictFormUrlEncoded(request, 500 * 1024, [
      "csrfToken",
      "revision",
      "studiosData",
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
  if (!/^[0-9a-f]{32}$/i.test(revision)) {
    return Response.json({ error: "Format de révision invalide." }, { status: 400, headers });
  }

  const studiosDataStr = String(formData.get("studiosData") || "");
  let parsedStudios: StudiosContent;
  try {
    parsedStudios = JSON.parse(studiosDataStr);
  } catch {
    return Response.json({ error: "Données JSON invalides." }, { status: 422, headers });
  }

  try {
    const newRevision = saveStudiosContent(parsedStudios, revision);
    const { content: latest } = getRawSiteContent();
    cleanupUnreferencedMedia(latest, ENV.SITE_MEDIA_PATH, getSiteContentFilePath());
    return Response.json({ success: true, newRevision }, { headers });
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      const { content: currentSiteContent } = getRawSiteContent();
      return Response.json(
        {
          error:
            "Conflit de révision : le contenu a été mis à jour par un autre enregistrement. Vos réglages ont été conservés.",
          conflict: true,
          latestRevision: currentSiteContent.revision,
        },
        { status: 409, headers }
      );
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 422, headers });
    }
    return Response.json({ error: "Erreur lors de l'enregistrement." }, { status: 500, headers });
  }
}

type ActionData = {
  success?: boolean;
  error?: string;
  conflict?: boolean;
  newRevision?: string;
  latestRevision?: string;
};

export default function AdminStudiosPage() {
  const {
    csrfToken,
    studios: initialStudios,
    revision: initialRevision,
    isCorrupted,
    corruptionError,
    media: initialMedia,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [formData, setFormData] = useState<StudiosContent>(initialStudios);
  const [currentRevision, setCurrentRevision] = useState<string>(initialRevision);
  const [media, setMedia] = useState<Record<string, UploadedMediaMetadata>>(initialMedia || {});
  const [isGlobalUploading, setIsGlobalUploading] = useState(false);

  useEffect(() => {
    if (actionData?.newRevision) {
      setCurrentRevision(actionData.newRevision);
    }
  }, [actionData]);

  const updateFraming = (brand: "sempra" | "parallax", framing: StudiosFraming) => {
    setFormData((prev) => ({
      ...prev,
      [brand]: {
        ...prev[brand],
        framing,
      },
    }));
  };

  const getFramingClass = (framing: StudiosFraming) => {
    if (framing === "top") return customStyles.framingTop;
    if (framing === "bottom") return customStyles.framingBottom;
    return customStyles.framingCenter;
  };

  return (
    <div className={formStyles.container}>
      <header className={formStyles.header}>
        <div className={formStyles.headerLeft}>
          <Link to="/admin/dashboard" className={formStyles.backLink}>
            ← Retour au tableau de bord
          </Link>
          <h1 className={formStyles.pageHeading}>Passerelle StudioLM</h1>
        </div>
      </header>

      <main className={formStyles.mainContent}>
        <div className={formStyles.topBar}>
          <div
            className={`${formStyles.revisionTag} ${
              isCorrupted ? formStyles.revisionTagCorrupted : ""
            }`}
          >
            {isCorrupted
              ? "Révision serveur : Indisponible (fichier non valide)"
              : `Révision serveur : ${currentRevision}`}
          </div>
        </div>

        {/* Informational Callout & Preview Link */}
        <div className={customStyles.previewCallout}>
          <div className={customStyles.previewCalloutText}>
            <span>
              La passerelle autonome réunit les deux marques SEMPRA et Parallax sous l'identité commune StudioLM.
            </span>
            <a
              href="/studios"
              target="_blank"
              rel="noopener noreferrer"
              className={customStyles.previewLink}
            >
              Voir la passerelle (/studios) ↗
            </a>
          </div>
          <p className={customStyles.infoNote}>
            <strong>Précision sur la sauvegarde :</strong> L'importation, le remplacement et le retrait d'une image
            sont enregistrés immédiatement sur le serveur. Le cadrage (centré, haut, bas) est enregistré lors de la
            validation via le bouton « Enregistrer les réglages » ci-dessous.
          </p>
        </div>

        {isCorrupted && (
          <div className={formStyles.alertError} role="alert">
            <p>
              <strong>Attention : contenu de secours actif en mémoire :</strong> Le fichier de configuration
              présente une anomalie de validation et les modifications sont bloquées pour protéger vos données.
            </p>
            {corruptionError && <p className={formStyles.alertSubText}>Détail : {corruptionError}</p>}
          </div>
        )}

        {actionData?.error && (
          <div className={formStyles.alertError} role="alert">
            <p>{actionData.error}</p>
            {actionData.conflict && actionData.latestRevision && (
              <button
                type="button"
                className={formStyles.secondaryButton}
                onClick={() => setCurrentRevision(actionData.latestRevision!)}
                style={{ marginTop: 8 }}
              >
                Mettre à jour avec la dernière révision ({actionData.latestRevision.slice(0, 8)}…)
              </button>
            )}
          </div>
        )}

        {actionData?.success && (
          <div className={formStyles.alertSuccess} role="status">
            Réglages de la passerelle enregistrés avec succès.
          </div>
        )}

        <Form method="post">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="revision" value={currentRevision} />
          <input type="hidden" name="studiosData" value={JSON.stringify(formData)} />

          {/* Block 1: SEMPRA Panel */}
          <section className={formStyles.sectionCard}>
            <div className={customStyles.brandHeader}>
              <span className={customStyles.brandBadgeSempra}>SEMPRA</span>
              <h2 className={formStyles.sectionTitle} style={{ margin: 0 }}>
                Image du panneau SEMPRA
              </h2>
            </div>
            <p className={formStyles.sectionSubtitle}>
              Photographie d'arrière-plan du panneau SEMPRA (mariage). Sans image choisie, le panneau affiche uniquement le fond vert profond et ses dégradés.
            </p>

            <div className={formStyles.fieldGroup}>
              <label className={formStyles.label}>Photographie du panneau SEMPRA</label>
              <ImageUploader
                csrfToken={csrfToken}
                revision={currentRevision}
                location="studios_sempra"
                currentImageId={formData.sempra.imageId || ""}
                mediaMetadata={formData.sempra.imageId ? media[formData.sempra.imageId] : null}
                alt="Photographie d'ambiance SEMPRA"
                disabled={isCorrupted || isSaving}
                isGlobalUploading={isGlobalUploading}
                setIsGlobalUploading={setIsGlobalUploading}
                onSuccess={(newRevision, newId, metadata) => {
                  setCurrentRevision(newRevision);
                  setFormData((prev) => ({
                    ...prev,
                    sempra: { ...prev.sempra, imageId: newId },
                  }));
                  setMedia((prev) => ({ ...prev, [newId]: metadata }));
                }}
                onRevertSuccess={(newRevision) => {
                  setCurrentRevision(newRevision);
                  setFormData((prev) => ({
                    ...prev,
                    sempra: { ...prev.sempra, imageId: null },
                  }));
                }}
                label="panneau SEMPRA"
                aspect="standard"
              />
            </div>

            <div className={formStyles.fieldGroup}>
              <label className={formStyles.label} htmlFor="framing-sempra">
                Cadrage de l'image SEMPRA
              </label>
              <select
                id="framing-sempra"
                value={formData.sempra.framing}
                onChange={(e) => updateFraming("sempra", e.target.value as StudiosFraming)}
                className={formStyles.input}
                disabled={isCorrupted || isSaving}
              >
                <option value="center">Centré (cadrage par défaut)</option>
                <option value="top">Haut (privilégier le haut de l'image)</option>
                <option value="bottom">Bas (privilégier le bas de l'image)</option>
              </select>
              <p className={formStyles.fieldHint}>
                Ajuste l'alignement vertical de la photographie, particulièrement sur mobile et écrans étroits.
              </p>
            </div>

            {/* Live simulation preview */}
            <div className={customStyles.simPreviewContainer}>
              <p className={customStyles.simPreviewLabel}>Aperçu du rendu panneau SEMPRA</p>
              <div className={`${customStyles.simPanel} ${customStyles.simPanelSempra}`}>
                {formData.sempra.imageId && (
                  <img
                    src={`/media/site/studios_sempra/${formData.sempra.imageId}/640p/webp`}
                    alt=""
                    aria-hidden="true"
                    className={`${customStyles.simBgImage} ${getFramingClass(formData.sempra.framing)}`}
                  />
                )}
                <div className={customStyles.simOverlaySempra} aria-hidden="true" />
                <div className={customStyles.simContent}>
                  <img
                    src="/img/img-73c121e112.png"
                    alt="SEMPRA"
                    className={customStyles.simLogoSempra}
                  />
                  <p className={customStyles.simTextSempra}>Photographie et vidéo de mariage</p>
                  <span className={customStyles.simButtonSempra}>Découvrir SEMPRA →</span>
                </div>
              </div>
            </div>
          </section>

          {/* Block 2: Parallax Panel */}
          <section className={formStyles.sectionCard}>
            <div className={customStyles.brandHeader}>
              <span className={customStyles.brandBadgeParallax}>Parallax</span>
              <h2 className={formStyles.sectionTitle} style={{ margin: 0 }}>
                Image du panneau Parallax
              </h2>
            </div>
            <p className={formStyles.sectionSubtitle}>
              Photographie d'arrière-plan du panneau Parallax (studio photo & vidéo). Sans image choisie, le panneau affiche uniquement le fond sombre et son accent bleu.
            </p>

            <div className={formStyles.fieldGroup}>
              <label className={formStyles.label}>Photographie du panneau Parallax</label>
              <ImageUploader
                csrfToken={csrfToken}
                revision={currentRevision}
                location="studios_parallax"
                currentImageId={formData.parallax.imageId || ""}
                mediaMetadata={formData.parallax.imageId ? media[formData.parallax.imageId] : null}
                alt="Photographie d'ambiance Parallax"
                disabled={isCorrupted || isSaving}
                isGlobalUploading={isGlobalUploading}
                setIsGlobalUploading={setIsGlobalUploading}
                onSuccess={(newRevision, newId, metadata) => {
                  setCurrentRevision(newRevision);
                  setFormData((prev) => ({
                    ...prev,
                    parallax: { ...prev.parallax, imageId: newId },
                  }));
                  setMedia((prev) => ({ ...prev, [newId]: metadata }));
                }}
                onRevertSuccess={(newRevision) => {
                  setCurrentRevision(newRevision);
                  setFormData((prev) => ({
                    ...prev,
                    parallax: { ...prev.parallax, imageId: null },
                  }));
                }}
                label="panneau Parallax"
                aspect="standard"
              />
            </div>

            <div className={formStyles.fieldGroup}>
              <label className={formStyles.label} htmlFor="framing-parallax">
                Cadrage de l'image Parallax
              </label>
              <select
                id="framing-parallax"
                value={formData.parallax.framing}
                onChange={(e) => updateFraming("parallax", e.target.value as StudiosFraming)}
                className={formStyles.input}
                disabled={isCorrupted || isSaving}
              >
                <option value="center">Centré (cadrage par défaut)</option>
                <option value="top">Haut (privilégier le haut de l'image)</option>
                <option value="bottom">Bas (privilégier le bas de l'image)</option>
              </select>
              <p className={formStyles.fieldHint}>
                Ajuste l'alignement vertical de la photographie, particulièrement sur mobile et écrans étroits.
              </p>
            </div>

            {/* Live simulation preview */}
            <div className={customStyles.simPreviewContainer}>
              <p className={customStyles.simPreviewLabel}>Aperçu du rendu panneau Parallax</p>
              <div className={`${customStyles.simPanel} ${customStyles.simPanelParallax}`}>
                {formData.parallax.imageId && (
                  <img
                    src={`/media/site/studios_parallax/${formData.parallax.imageId}/640p/webp`}
                    alt=""
                    aria-hidden="true"
                    className={`${customStyles.simBgImage} ${getFramingClass(formData.parallax.framing)}`}
                  />
                )}
                <div className={customStyles.simOverlayParallax} aria-hidden="true" />
                <div className={customStyles.simContent}>
                  <div className={customStyles.simLogoParallaxWrap}>
                    <img
                      src="/img/logo-parallax.png"
                      alt=""
                      aria-hidden="true"
                      className={customStyles.simLogoParallax}
                    />
                    <span className={customStyles.simBrandParallax}>Parallax</span>
                  </div>
                  <p className={customStyles.simTextParallax}>Photographie et création vidéo</p>
                  <span className={customStyles.simButtonParallax}>Découvrir Parallax →</span>
                </div>
              </div>
            </div>
          </section>

          {/* Form Actions */}
          <div className={formStyles.formActions}>
            <button
              type="submit"
              disabled={isCorrupted || isSaving || isGlobalUploading}
              className={formStyles.submitButton}
            >
              {isSaving ? "Enregistrement en cours..." : "Enregistrer les réglages"}
            </button>
          </div>
        </Form>
      </main>
    </div>
  );
}
