import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type HeadersArgs,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useState } from "react";
import * as crypto from "node:crypto";
import {
  requireValidAdminSession,
  createAdminHeaders,
  composeAdminHeaders,
} from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { commitSession } from "../../lib/session.server";
import { validateOrigin, readStrictFormUrlEncoded } from "../../lib/security.server";
import {
  getRetentionSettings,
  updateRetentionSettings,
  simulateRetentionImpact,
  type RetentionSettings,
  type RetentionImpactSimulation,
} from "../../lib/gallery-retention.server";
import { GalleryConflictError, GalleryValidationError } from "../../lib/gallery.server";
import styles from "./data-retention.module.css";

export function meta() {
  return [
    { title: "Paramètres de conservation des galeries | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function headers(args: HeadersArgs): Headers {
  return composeAdminHeaders(args);
}

interface LoaderData {
  settings: RetentionSettings;
  csrfToken: string;
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

  const settings = getRetentionSettings();

  return Response.json({ settings, csrfToken }, { headers });
}

interface ActionData {
  success?: boolean;
  message?: string;
  error?: string;
  conflict?: boolean;
  simulation?: RetentionImpactSimulation;
  proposedSettings?: {
    enabled: boolean;
    retentionDays: number | null;
    logRetentionDays: number | null;
  };
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    const headers = createAdminHeaders();
    headers.set("Allow", "POST");
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  const session = await requireValidAdminSession(request);
  const expectedCsrfToken = session.get("csrfToken") || "";

  if (!validateOrigin(request)) {
    return Response.json(
      { error: "Origine invalide." },
      { status: 403, headers: createAdminHeaders() }
    );
  }

  let body: URLSearchParams;
  try {
    body = await readStrictFormUrlEncoded(request, 4096);
  } catch {
    return Response.json(
      { error: "Corps de requête invalide." },
      { status: 400, headers: createAdminHeaders() }
    );
  }

  const formCsrf = body.get("csrfToken") || "";
  if (!formCsrf || !constantTimeEqual(formCsrf, expectedCsrfToken)) {
    return Response.json(
      { error: "Jeton CSRF invalide." },
      { status: 403, headers: createAdminHeaders() }
    );
  }

  const intent = body.get("intent");
  const rawEnabled = body.get("enabled") === "1";
  const rawDays = (body.get("retentionDays") || "").trim();
  const rawLogDays = (body.get("logRetentionDays") || "").trim();
  const expectedRevision = Number.parseInt(body.get("expectedRevision") || "1", 10);
  const confirmActivation = body.get("confirmActivation") === "1";

  const retentionDays = rawDays ? Number.parseInt(rawDays, 10) : null;
  const logRetentionDays = rawLogDays ? Number.parseInt(rawLogDays, 10) : null;

  if (intent === "simulate") {
    const simulation = simulateRetentionImpact({
      enabled: rawEnabled,
      retentionDays,
    });

    return Response.json(
      {
        simulation,
        proposedSettings: {
          enabled: rawEnabled,
          retentionDays,
          logRetentionDays,
        },
      },
      { headers: createAdminHeaders() }
    );
  }

  if (intent === "save_settings") {
    const current = getRetentionSettings();

    // Check if activating or shortening delay without explicit dedicated confirmation
    const isActivating = rawEnabled && !current.enabled;
    const isShortening =
      rawEnabled &&
      current.enabled &&
      retentionDays !== null &&
      current.retentionDays !== null &&
      retentionDays < current.retentionDays;

    if ((isActivating || isShortening) && !confirmActivation) {
      return Response.json(
        {
          error: "Une confirmation dédiée est obligatoire pour activer la purge automatique ou en raccourcir le délai.",
          proposedSettings: {
            enabled: rawEnabled,
            retentionDays,
            logRetentionDays,
          },
        },
        { status: 400, headers: createAdminHeaders() }
      );
    }

    try {
      updateRetentionSettings(
        {
          enabled: rawEnabled,
          retentionDays,
          logRetentionDays,
        },
        expectedRevision
      );

      return Response.json(
        {
          success: true,
          message: "Les paramètres de conservation ont été mis à jour avec succès.",
        },
        { headers: createAdminHeaders() }
      );
    } catch (err) {
      if (err instanceof GalleryConflictError) {
        return Response.json(
          {
            error: "Conflit de révision (409) : les paramètres ont été modifiés par un autre administrateur. Rechargez la page.",
            conflict: true,
          },
          { status: 409, headers: createAdminHeaders() }
        );
      }
      if (err instanceof GalleryValidationError) {
        return Response.json({ error: err.message }, { status: 400, headers: createAdminHeaders() });
      }
      return Response.json(
        { error: err instanceof Error ? err.message : "Erreur lors de la sauvegarde." },
        { status: 500, headers: createAdminHeaders() }
      );
    }
  }

  return Response.json({ error: "Action inconnue." }, { status: 400, headers: createAdminHeaders() });
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

export default function AdminDataRetentionSettingsPage() {
  const data = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const currentSettings = data.settings;
  const initialEnabled = actionData?.proposedSettings
    ? actionData.proposedSettings.enabled
    : currentSettings.enabled;
  const initialDays = actionData?.proposedSettings
    ? actionData.proposedSettings.retentionDays ?? ""
    : currentSettings.retentionDays ?? "";
  const initialLogDays = actionData?.proposedSettings
    ? actionData.proposedSettings.logRetentionDays ?? ""
    : currentSettings.logRetentionDays ?? "";

  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [retentionDays, setRetentionDays] = useState<string>(String(initialDays));
  const [logRetentionDays, setLogRetentionDays] = useState<string>(String(initialLogDays));
  const [confirmActivation, setConfirmActivation] = useState(false);

  const simulation = actionData?.simulation;

  const isActivating = enabled && !currentSettings.enabled;
  const isShortening =
    enabled &&
    currentSettings.enabled &&
    retentionDays !== "" &&
    currentSettings.retentionDays !== null &&
    Number(retentionDays) < currentSettings.retentionDays;

  const requiresConfirmation = isActivating || isShortening;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link to="/admin/data-retention" className={styles.backLink}>
            ← Retour au tableau
          </Link>
          <h1 className={styles.pageTitle}>Paramètres de conservation des galeries</h1>
        </div>
      </header>

      <main className={styles.content}>
        {actionData?.success && actionData.message && (
          <div className={styles.alertSuccess} role="status">
            {actionData.message}
          </div>
        )}

        {actionData?.error && (
          <div className={styles.alertError} role="alert">
            {actionData.error}
          </div>
        )}

        <div className={styles.card} style={{ maxWidth: 840, margin: "0 auto" }}>
          <h2 className={styles.cardTitle}>Politique de purge et de journalisation</h2>

          <Form method="post">
            <input type="hidden" name="csrfToken" value={data.csrfToken} />
            <input type="hidden" name="expectedRevision" value={currentSettings.revision} />

            {/* Toggle Enable */}
            <div style={{ marginBottom: 24, padding: "16px", background: "#0C0F17", borderRadius: 10, border: "0.5px solid #232B3A" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  name="enabled"
                  value="1"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 2 }}
                />
                <div>
                  <strong style={{ fontSize: 15, color: "#F5F6F7", display: "block" }}>
                    Activer la purge automatique des galeries
                  </strong>
                  <span style={{ fontSize: 13, color: "#AEB6C6", lineHeight: 1.5, display: "block", marginTop: 4 }}>
                    Lorsque cette option est désactivée (état initial), aucune galerie n'est jamais détruite automatiquement.
                    Les suppressions restent strictement manuelles et confirmées par l'administrateur.
                  </span>
                </div>
              </label>
            </div>

            {/* Retention delay */}
            <div className={styles.modalInputGroup}>
              <label htmlFor="retentionDaysInput" className={styles.modalInputLabel}>
                Délai de conservation après expiration client (en jours) :
              </label>
              <input
                id="retentionDaysInput"
                type="number"
                name="retentionDays"
                min="1"
                max="3650"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                placeholder="Laisser vide pour « Non configuré »"
                className={styles.modalInput}
              />
              <span style={{ fontSize: 12, color: "#8A92A6" }}>
                La date prévisionnelle de purge se calcule en UTC : <code>date_expiration + delai</code>.
                Tant qu'aucun délai n'est configuré, l'échéance affiche « Non configurée ».
              </span>
            </div>

            {/* Log retention delay */}
            <div className={styles.modalInputGroup}>
              <label htmlFor="logRetentionDaysInput" className={styles.modalInputLabel}>
                Conservation du journal technique de suppression (en jours) :
              </label>
              <input
                id="logRetentionDaysInput"
                type="number"
                name="logRetentionDays"
                min="1"
                max="3650"
                value={logRetentionDays}
                onChange={(e) => setLogRetentionDays(e.target.value)}
                placeholder="Laisser vide pour conservation permanente des traces"
                className={styles.modalInput}
              />
              <span style={{ fontSize: 12, color: "#8A92A6" }}>
                Seules les traces des opérations finalisées sont nettoyées. Les tâches nécessaires aux reprises de crash ne sont jamais purgées.
              </span>
            </div>

            {/* Simulation Button */}
            <div style={{ marginTop: 20, marginBottom: 24, display: "flex", gap: 12 }}>
              <button
                type="submit"
                name="intent"
                value="simulate"
                disabled={isSubmitting}
                className={`${styles.btn} ${styles.btnSecondary}`}
              >
                {isSubmitting ? "Calcul en cours..." : "Simuler l'impact sur les galeries"}
              </button>
            </div>

            {/* Simulation Preview Results */}
            {simulation && (
              <div
                style={{
                  background: "#0C0F17",
                  border: "0.5px solid #1E9EFF",
                  borderRadius: 12,
                  padding: "20px",
                  marginBottom: 24,
                }}
              >
                <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "#5FB8FF" }}>
                  Résultat de la simulation d'impact
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 16 }}>
                  <div>
                    <span className={styles.policyLabel}>Galeries au total</span>
                    <div className={styles.policyValue}>{simulation.totalGalleries}</div>
                  </div>
                  <div>
                    <span className={styles.policyLabel}>Volume total géré</span>
                    <div className={styles.policyValue}>{formatBytes(simulation.totalSize)}</div>
                  </div>
                  <div>
                    <span className={styles.policyLabel} style={{ color: "#FCA5A5" }}>
                      Éligibles immédiatement
                    </span>
                    <div className={styles.policyValue} style={{ color: simulation.immediatelyEligibleCount > 0 ? "#EF4444" : "#10B981" }}>
                      {simulation.immediatelyEligibleCount} galerie(s) ({formatBytes(simulation.immediatelyEligibleTotalSize)})
                    </div>
                  </div>
                </div>

                {simulation.immediatelyEligibleGalleries.length > 0 && (
                  <div>
                    <span className={styles.policyLabel} style={{ color: "#FCA5A5", marginBottom: 8, display: "block" }}>
                      Galeries qui seraient immédiatement purgées à l'activation :
                    </span>
                    <div className={styles.modalSelectedList}>
                      {simulation.immediatelyEligibleGalleries.map((g) => (
                        <div key={g.id} className={styles.modalSelectedListItem}>
                          <span>
                            <strong>{g.title}</strong> ({g.clientName}) · expirée le {formatDate(g.expiresAt)}
                          </span>
                          <span style={{ color: "#FCA5A5" }}>{formatBytes(g.totalSize)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dedicated Confirmation Checkbox (mandatory if activating or shortening) */}
            {requiresConfirmation && (
              <div className={styles.modalWarningBox}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name="confirmActivation"
                    value="1"
                    checked={confirmActivation}
                    onChange={(e) => setConfirmActivation(e.target.checked)}
                    style={{ width: 18, height: 18, marginTop: 2 }}
                    required
                  />
                  <span>
                    <strong>Confirmation dédiée obligatoire :</strong> J'ai pris connaissance de l'impact de cette
                    politique et je confirme vouloir{" "}
                    {isActivating ? "activer la suppression automatique" : "raccourcir le délai de conservation"}.
                  </span>
                </label>
              </div>
            )}

            {/* Save Button */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
              <Link to="/admin/data-retention" className={`${styles.btn} ${styles.btnSecondary}`}>
                Annuler
              </Link>
              <button
                type="submit"
                name="intent"
                value="save_settings"
                disabled={isSubmitting || (requiresConfirmation && !confirmActivation)}
                className={`${styles.btn} ${styles.btnPrimary}`}
              >
                {isSubmitting ? "Enregistrement..." : "Enregistrer la politique"}
              </button>
            </div>
          </Form>

          {/* Legal / Policy note */}
          <div className={styles.sourceNotice} style={{ marginTop: 32 }}>
            <strong>Cadre juridique et technique :</strong>
            <p style={{ margin: "6px 0 0" }}>
              Ce module fournit des outils techniques de gestion, de prévisualisation et de purge sécurisée.
              Il ne remplace pas une analyse juridique de vos engagements contractuels ni les délais légaux
              éventuellement applicables à vos activités. Les durées enregistrées relèvent de votre choix de gestion.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
