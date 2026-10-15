import "../../../scripts/env-loader.js";
import nodemailer from "nodemailer";

const REQUIRED_VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "CONTACT_FROM_EMAIL",
  "CONTACT_TO_EMAIL",
];

const missing = [];
for (const key of REQUIRED_VARS) {
  if (!process.env[key] || !process.env[key].trim()) {
    missing.push(key);
  }
}

function parseStrictPort(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
  if (String(port) !== trimmed) return null;
  return port;
}

if (missing.length > 0) {
  console.error(`[smtp:verify] ERREUR: Configuration incomplete. Variables manquantes: ${missing.join(", ")}`);
  process.exit(1);
}

const host = process.env.SMTP_HOST.trim();
const port = parseStrictPort(process.env.SMTP_PORT);
if (port === null) {
  console.error(`[smtp:verify] ERREUR: SMTP_PORT invalide (${process.env.SMTP_PORT ?? ""}). Port attendu : entier décimal entre 1 et 65535.`);
  process.exit(1);
}

const user = process.env.SMTP_USER.trim();
const pass = process.env.SMTP_PASSWORD;
const fromEmail = process.env.CONTACT_FROM_EMAIL.trim();
const toEmail = process.env.CONTACT_TO_EMAIL.trim();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(fromEmail)) {
  console.error(`[smtp:verify] ERREUR: CONTACT_FROM_EMAIL invalide.`);
  process.exit(1);
}
if (!emailRegex.test(toEmail)) {
  console.error(`[smtp:verify] ERREUR: CONTACT_TO_EMAIL invalide.`);
  process.exit(1);
}

console.log(`[smtp:verify] Verification de la configuration SMTP...`);
console.log(`[smtp:verify] Hote: ${host}:${port}`);
console.log(`[smtp:verify] Utilisateur: ${user}`);
console.log(`[smtp:verify] Expediteur declare: ${fromEmail}`);
console.log(`[smtp:verify] Destinataire: ${toEmail}`);

const isDirectTls = port === 465;
const isStartTls = !isDirectTls;

const tlsOptions = {
  rejectUnauthorized: true,
  ...(process.env.SMTP_CA_CERT ? { ca: [process.env.SMTP_CA_CERT] } : {}),
};

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: isDirectTls,
  requireTLS: isStartTls,
  tls: tlsOptions,
  auth: {
    user,
    pass,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

try {
  await transporter.verify();
  console.log(`[smtp:verify] SUCCES: Connexion et authentification SMTP reussies. Le serveur est pret a expedier.`);
  process.exit(0);
} catch (err) {
  console.error(`[smtp:verify] ECHEC: Impossible d'etablir la connexion SMTP.`);
  if (err && typeof err === "object") {
    const code = "code" in err ? String(err.code) : "UNKNOWN";
    const command = "command" in err ? String(err.command) : undefined;
    const responseCode = "responseCode" in err ? String(err.responseCode) : undefined;
    console.error(`[smtp:verify] Diagnostic: code=${code}${command ? ` commande=${command}` : ""}${responseCode ? ` reponse=${responseCode}` : ""}`);
  }
  process.exit(1);
}
