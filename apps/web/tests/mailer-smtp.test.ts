import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SMTPServer } from "smtp-server";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import {
  sendContactEmail,
  getSmtpDiagnostic,
  parseStrictPort,
  SmtpConfigError,
  SmtpDeliveryError,
} from "../app/lib/mailer.server";

describe("Mailer & Local SMTP Security Tests", () => {
  let server: SMTPServer;
  let port: number;
  let certsDir: string;
  let keyPath: string;
  let certPath: string;
  let capturedMessages: Array<{
    from: string;
    to: string[];
    raw: string;
  }> = [];

  const originalEnv = { ...process.env };

  function decodeMimeBody(raw: string): string {
    const unwrapped = raw.replace(/=\r?\n/g, "");
    const buf: number[] = [];
    for (let i = 0; i < unwrapped.length; i++) {
      if (
        unwrapped[i] === "=" &&
        i + 2 < unwrapped.length &&
        /^[0-9A-Fa-f]{2}$/.test(unwrapped.slice(i + 1, i + 3))
      ) {
        buf.push(parseInt(unwrapped.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        buf.push(unwrapped.charCodeAt(i));
      }
    }
    return Buffer.from(buf).toString("utf-8");
  }

  beforeAll(async () => {
    // 1. Generate artificial self-signed certificate in private temp directory
    certsDir = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-smtp-test-"));
    keyPath = path.join(certsDir, "key.pem");
    certPath = path.join(certsDir, "cert.pem");

    const configPath = path.join(certsDir, "openssl-ca.cnf");
    const configContent = `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no
[req_distinguished_name]
CN = 127.0.0.1
[v3_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
subjectAltName = @alt_names
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
`;
    fs.writeFileSync(configPath, configContent);

    execSync(
      `openssl req -nodes -new -x509 -keyout key.pem -out cert.pem -days 1 -config openssl-ca.cnf`,
      { cwd: certsDir, stdio: "ignore" }
    );

    // 2. Start local fake SMTP server bound to 127.0.0.1 on ephemeral port 0
    capturedMessages = [];
    server = new SMTPServer({
      secure: false, // upgrades via STARTTLS
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      authOptional: false,
      onAuth(auth, _session, callback) {
        if (auth.username === "testuser" && auth.password === "testpass123") {
          return callback(null, { user: "testuser" });
        }
        return callback(new Error("Invalid username or password"));
      },
      onRcptTo(addr, _session, callback) {
        if (addr.address === "rejected@parallax.test") {
          const err = new Error("Mailbox unavailable / rejected recipient") as Error & { responseCode?: number };
          err.responseCode = 550;
          return callback(err);
        }
        return callback();
      },
      onData(stream, session, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          capturedMessages.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
            to: session.envelope.rcptTo.map((r) => r.address),
            raw,
          });
          callback();
        });
      },
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.server.address();
        if (address && typeof address !== "string") {
          port = address.port;
          resolve();
        } else {
          reject(new Error("Failed to acquire ephemeral port"));
        }
      });
    });
  });

  afterAll(async () => {
    process.env = originalEnv;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    fs.rmSync(certsDir, { recursive: true, force: true });
  });

  it("reports incomplete SMTP diagnostic when env variables are missing", () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.CONTACT_FROM_EMAIL;
    delete process.env.CONTACT_TO_EMAIL;

    const diag = getSmtpDiagnostic();
    expect(diag.status).toBe("incomplete");
    expect(diag.missing).toContain("SMTP_HOST");
    expect(diag.missing).toContain("CONTACT_TO_EMAIL");
  });

  it("reports invalid SMTP diagnostic when port is malformed", () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "99999";
    process.env.SMTP_USER = "testuser";
    process.env.SMTP_PASSWORD = "testpass123";
    process.env.CONTACT_FROM_EMAIL = "from@parallax.test";
    process.env.CONTACT_TO_EMAIL = "contact@parallax.test";

    const diag = getSmtpDiagnostic();
    expect(diag.status).toBe("invalid");
    expect(diag.reason).toContain("SMTP_PORT invalide");
  });

  it("reports invalid SMTP diagnostic when email address is malformed", () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "testuser";
    process.env.SMTP_PASSWORD = "testpass123";
    process.env.CONTACT_FROM_EMAIL = "invalid-email";
    process.env.CONTACT_TO_EMAIL = "contact@parallax.test";

    const diag = getSmtpDiagnostic();
    expect(diag.status).toBe("invalid");
    expect(diag.reason).toContain("CONTACT_FROM_EMAIL invalide");
  });

  it("refuses sending when SMTP is unconfigured or incomplete", async () => {
    delete process.env.SMTP_HOST;
    await expect(
      sendContactEmail({
        name: "Test Visiteur",
        email: "visiteur@example.com",
        projectTypeId: "music-video",
        projectTypeLabel: "Clip musical",
        lang: "fr",
        message: "Bonjour, message de test.",
      })
    ).rejects.toThrow(SmtpConfigError);
  });

  it("fails to connect when CA is missing or untrusted (strict certificate validation active)", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = "testuser";
    process.env.SMTP_PASSWORD = "testpass123";
    process.env.CONTACT_FROM_EMAIL = "studio@parallax.test";
    process.env.CONTACT_TO_EMAIL = "admin@parallax.test";
    delete process.env.SMTP_CA_CERT; // No artificial CA provided!

    await expect(
      sendContactEmail({
        name: "Test Visiteur",
        email: "visiteur@example.com",
        projectTypeId: "music-video",
        projectTypeLabel: "Clip musical",
        lang: "fr",
        message: "Test TLS strict sans CA.",
      })
    ).rejects.toThrow(SmtpDeliveryError);
  });

  it("successfully connects, performs STARTTLS with artificial CA, and delivers message to local SMTP server", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = "testuser";
    process.env.SMTP_PASSWORD = "testpass123";
    process.env.CONTACT_FROM_EMAIL = "studio@parallax.test";
    process.env.CONTACT_TO_EMAIL = "admin@parallax.test";
    process.env.SMTP_CA_CERT = fs.readFileSync(certPath, "utf-8"); // Inject artificial CA

    const initialCount = capturedMessages.length;

    await sendContactEmail({
      name: "Artiste & Co",
      email: "artiste@example.com",
      phone: "+32 470 12 34 56",
      timeline: "automne 2026",
      projectTypeId: "music-video",
      projectTypeLabel: "Clip musical",
      lang: "fr",
      message: "Bonjour Maxime et Ludovic,\nNous souhaitons réaliser un clip musical en Belgique.",
    });

    expect(capturedMessages.length).toBe(initialCount + 1);
    const sent = capturedMessages[capturedMessages.length - 1];
    const decoded = decodeMimeBody(sent.raw);

    expect(sent.from).toBe("studio@parallax.test");
    expect(sent.to).toEqual(["admin@parallax.test"]);
    expect(sent.raw).toContain("Reply-To: artiste@example.com");
    expect(sent.raw).toContain("Subject: [Parallax] Nouvelle demande : Clip musical - Artiste & Co");
    expect(decoded).toContain("Nom / société       : Artiste & Co");
    expect(decoded).toContain("Email               : artiste@example.com");
    expect(decoded).toContain("Téléphone           : +32 470 12 34 56");
    expect(decoded).toContain("Échéance souhaitée  : automne 2026");
    expect(decoded).toContain("Type de projet      : Clip musical (music-video)");
    expect(decoded).toContain("Langue              : FR");
    expect(decoded).toContain("Nous souhaitons réaliser un clip musical en Belgique.");
  });

  it("successfully delivers English request message format", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = "testuser";
    process.env.SMTP_PASSWORD = "testpass123";
    process.env.CONTACT_FROM_EMAIL = "studio@parallax.test";
    process.env.CONTACT_TO_EMAIL = "admin@parallax.test";
    process.env.SMTP_CA_CERT = fs.readFileSync(certPath, "utf-8");

    const initialCount = capturedMessages.length;

    await sendContactEmail({
      name: "Acme Brand",
      email: "hello@acme.test",
      projectTypeId: "advertising",
      projectTypeLabel: "Advertising",
      lang: "en",
      message: "Hello team, we have a commercial production enquiry.",
    });

    expect(capturedMessages.length).toBe(initialCount + 1);
    const sent = capturedMessages[capturedMessages.length - 1];
    const decoded = decodeMimeBody(sent.raw);

    expect(sent.from).toBe("studio@parallax.test");
    expect(sent.to).toEqual(["admin@parallax.test"]);
    expect(sent.raw).toContain("Reply-To: hello@acme.test");
    expect(sent.raw).toContain("Subject: [Parallax] Nouvelle demande : Advertising - Acme Brand");
    expect(decoded).toContain("Téléphone           : Not specified");
    expect(decoded).toContain("Échéance souhaitée  : Not specified");
    expect(decoded).toContain("Langue              : EN");
  });

  it("strictly rejects CRLF injection attempts in email or name headers", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = "testuser";
    process.env.SMTP_PASSWORD = "testpass123";
    process.env.CONTACT_FROM_EMAIL = "studio@parallax.test";
    process.env.CONTACT_TO_EMAIL = "admin@parallax.test";
    process.env.SMTP_CA_CERT = fs.readFileSync(certPath, "utf-8");

    await expect(
      sendContactEmail({
        name: "Hostile\r\nBcc: evil@attacker.test",
        email: "legit@example.com",
        projectTypeId: "portrait",
        projectTypeLabel: "Portrait",
        lang: "fr",
        message: "Test CRLF",
      })
    ).rejects.toThrow(SmtpDeliveryError);

    await expect(
      sendContactEmail({
        name: "Legit Name",
        email: "legit@example.com\r\nTo: evil@attacker.test",
        projectTypeId: "portrait",
        projectTypeLabel: "Portrait",
        lang: "fr",
        message: "Test CRLF",
      })
    ).rejects.toThrow(SmtpDeliveryError);
  });

  it("throws SmtpDeliveryError when recipient is rejected by the SMTP server", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = "testuser";
    process.env.SMTP_PASSWORD = "testpass123";
    process.env.CONTACT_FROM_EMAIL = "studio@parallax.test";
    process.env.CONTACT_TO_EMAIL = "rejected@parallax.test"; // Configured to trigger 550 reject
    process.env.SMTP_CA_CERT = fs.readFileSync(certPath, "utf-8");

    await expect(
      sendContactEmail({
        name: "Test Reject",
        email: "visiteur@example.com",
        projectTypeId: "portrait",
        projectTypeLabel: "Portrait",
        lang: "fr",
        message: "Ce message doit échouer car le destinataire est refusé.",
      })
    ).rejects.toThrow(SmtpDeliveryError);
  });

  describe("Strict Port Validation & SMTP Diagnostic", () => {
    it("rejects invalid port values in parseStrictPort", () => {
      expect(parseStrictPort("587oops")).toBeNull();
      expect(parseStrictPort("587.5")).toBeNull();
      expect(parseStrictPort("+587")).toBeNull();
      expect(parseStrictPort("-587")).toBeNull();
      expect(parseStrictPort("0")).toBeNull();
      expect(parseStrictPort("65536")).toBeNull();
      expect(parseStrictPort("abc")).toBeNull();
      expect(parseStrictPort("")).toBeNull();
      expect(parseStrictPort(undefined)).toBeNull();
      expect(parseStrictPort("587")).toBe(587);
      expect(parseStrictPort("465")).toBe(465);
    });

    it("reports invalid port status in getSmtpDiagnostic when port contains non-decimal characters like 587oops", () => {
      process.env.SMTP_HOST = "mail.parallax.test";
      process.env.SMTP_PORT = "587oops";
      process.env.SMTP_USER = "user";
      process.env.SMTP_PASSWORD = "password";
      process.env.CONTACT_FROM_EMAIL = "from@parallax.test";
      process.env.CONTACT_TO_EMAIL = "to@parallax.test";

      const diag = getSmtpDiagnostic();
      expect(diag.status).toBe("invalid");
      expect(diag.reason).toContain("entier décimal");
    });

    it("reports configured status when port is strictly 587 or 465 and all keys are valid", () => {
      process.env.SMTP_HOST = "mail.parallax.test";
      process.env.SMTP_USER = "user";
      process.env.SMTP_PASSWORD = "password";
      process.env.CONTACT_FROM_EMAIL = "from@parallax.test";
      process.env.CONTACT_TO_EMAIL = "to@parallax.test";

      process.env.SMTP_PORT = "587";
      expect(getSmtpDiagnostic().status).toBe("configured");

      process.env.SMTP_PORT = "465";
      expect(getSmtpDiagnostic().status).toBe("configured");
    });

    it("reports incomplete when required keys are missing without preventing application startup", () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      const diag = getSmtpDiagnostic();
      expect(diag.status).toBe("incomplete");
      expect(diag.missing).toContain("SMTP_HOST");
      expect(diag.missing).toContain("SMTP_PORT");
    });
  });
});
