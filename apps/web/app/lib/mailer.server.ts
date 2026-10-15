import fs from "node:fs";
import nodemailer, { type Transporter } from "nodemailer";

export interface ContactEmailPayload {
  name: string;
  email: string;
  phone?: string;
  timeline?: string;
  projectTypeId: string;
  projectTypeLabel: string;
  lang: "fr" | "en";
  message: string;
}

export type SmtpConfigStatus = "configured" | "incomplete" | "invalid";

export interface SmtpDiagnostic {
  status: SmtpConfigStatus;
  missing: string[];
  reason?: string;
}

export class SmtpConfigError extends Error {
  code: string;
  constructor(message: string, code = "SMTP_UNCONFIGURED") {
    super(message);
    this.name = "SmtpConfigError";
    this.code = code;
  }
}

export class SmtpDeliveryError extends Error {
  code: string;
  constructor(message: string, code = "SMTP_DELIVERY_FAILED", cause?: unknown) {
    super(message, { cause });
    this.name = "SmtpDeliveryError";
    this.code = code;
  }
}

export const REQUIRED_SMTP_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "CONTACT_FROM_EMAIL",
  "CONTACT_TO_EMAIL",
] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getSmtpDiagnostic(): SmtpDiagnostic {
  const missing: string[] = [];
  for (const key of REQUIRED_SMTP_KEYS) {
    const val = process.env[key];
    if (!val || !val.trim()) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    return {
      status: "incomplete",
      missing,
      reason: `Variables manquantes: ${missing.join(", ")}`,
    };
  }

  const portRaw = process.env.SMTP_PORT?.trim() ?? "";
  const port = parseInt(portRaw, 10);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    return {
      status: "invalid",
      missing: [],
      reason: `SMTP_PORT invalide (${portRaw}). Port attendu entre 1 et 65535.`,
    };
  }

  const fromEmail = process.env.CONTACT_FROM_EMAIL?.trim() ?? "";
  const toEmail = process.env.CONTACT_TO_EMAIL?.trim() ?? "";

  if (!EMAIL_REGEX.test(fromEmail)) {
    return {
      status: "invalid",
      missing: [],
      reason: "CONTACT_FROM_EMAIL invalide.",
    };
  }

  if (!EMAIL_REGEX.test(toEmail)) {
    return {
      status: "invalid",
      missing: [],
      reason: "CONTACT_TO_EMAIL invalide.",
    };
  }

  return {
    status: "configured",
    missing: [],
  };
}

function resolveCaCert(raw: string | undefined): string | Buffer | undefined {
  if (!raw) return undefined;
  if (raw.includes("-----BEGIN CERTIFICATE-----")) {
    return raw;
  }
  if (fs.existsSync(raw)) {
    try {
      return fs.readFileSync(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

// Bounded concurrency queue to avoid unbounded memory / connections
let activeSends = 0;
const MAX_CONCURRENT_SENDS = 5;

export async function sendContactEmail(data: ContactEmailPayload): Promise<void> {
  const diagnostic = getSmtpDiagnostic();
  if (diagnostic.status !== "configured") {
    throw new SmtpConfigError(
      diagnostic.reason ?? "Configuration SMTP incomplète ou invalide.",
      diagnostic.status === "invalid" ? "SMTP_INVALID_CONFIG" : "SMTP_UNCONFIGURED"
    );
  }

  // Prevent CRLF injection in email/name/label
  if (/[\r\n]/.test(data.email) || /[\r\n]/.test(data.name) || /[\r\n]/.test(data.projectTypeLabel)) {
    throw new SmtpDeliveryError("Caractères non autorisés dans les en-têtes.", "INVALID_HEADER_CHARS");
  }

  if (activeSends >= MAX_CONCURRENT_SENDS) {
    throw new SmtpDeliveryError("Service temporairement saturé.", "SMTP_CONCURRENCY_LIMIT");
  }

  activeSends++;
  let transporter: Transporter | null = null;

  try {
    const host = process.env.SMTP_HOST!.trim();
    const port = parseInt(process.env.SMTP_PORT!.trim(), 10);
    const user = process.env.SMTP_USER!.trim();
    const pass = process.env.SMTP_PASSWORD!;
    const fromEmail = process.env.CONTACT_FROM_EMAIL!.trim();
    const toEmail = process.env.CONTACT_TO_EMAIL!.trim();
    const caCert = resolveCaCert(process.env.SMTP_CA_CERT);

    const isDirectTls = port === 465;
    const isStartTls = !isDirectTls;

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: isDirectTls,
      requireTLS: isStartTls,
      tls: {
        rejectUnauthorized: true,
        ...(caCert ? { ca: [caCert] } : {}),
      },
      auth: {
        user,
        pass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    const isFr = data.lang === "fr";
    const bodyLines = [
      `Nouvelle demande de contact (Parallax - ${data.lang.toUpperCase()})`,
      "--------------------------------------------------",
      `Nom / société       : ${data.name.trim()}`,
      `Email               : ${data.email.trim()}`,
      `Téléphone           : ${data.phone?.trim() ? data.phone.trim() : (isFr ? "Non précisé" : "Not specified")}`,
      `Échéance souhaitée  : ${data.timeline?.trim() ? data.timeline.trim() : (isFr ? "Non précisée" : "Not specified")}`,
      `Type de projet      : ${data.projectTypeLabel} (${data.projectTypeId})`,
      `Langue              : ${data.lang.toUpperCase()}`,
      "--------------------------------------------------",
      "Message :",
      "",
      data.message.trim(),
      "",
      "--------------------------------------------------",
    ];

    const subject = `[Parallax] Nouvelle demande : ${data.projectTypeLabel} - ${data.name.trim()}`;

    const info = await transporter.sendMail({
      from: fromEmail,
      to: toEmail,
      replyTo: data.email.trim(),
      subject,
      text: bodyLines.join("\n"),
    });

    if (!info.accepted || !info.accepted.includes(toEmail)) {
      throw new SmtpDeliveryError(
        "Le destinataire n'a pas été accepté par le serveur SMTP.",
        "RECIPIENT_NOT_ACCEPTED"
      );
    }
  } catch (err: unknown) {
    if (err instanceof SmtpConfigError || err instanceof SmtpDeliveryError) {
      throw err;
    }
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "TRANSPORT_ERROR";
    console.error(`[SMTP_DELIVERY_FAILURE] code=${code}`);
    throw new SmtpDeliveryError("Erreur de transport SMTP lors de l'envoi du message.", code, err);
  } finally {
    activeSends--;
    if (transporter) {
      try {
        transporter.close();
      } catch {
        // Ignored
      }
    }
  }
}
