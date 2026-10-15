import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { ENV } from "./env.server";
import { validateOrigin, getClientIp, readStrictFormUrlEncoded } from "./security.server";
import {
  checkRateLimit,
  RateLimitExceededError,
  RateLimitStorageError,
  acquireContactClaim,
  completeContactClaim,
  markUncertainContactClaim,
  failContactClaim,
  type ContactClaimAcquireResult,
} from "./rate-limit.server";
import { getSiteContent } from "./site-content.server";
import {
  type CommonContent,
  type ContactPageContent,
  type SiteContent,
  DEFAULT_CONTACT_PAGE_MESSAGES,
} from "./site-content.shared";
import { sendContactEmail, getSmtpDiagnostic, SmtpConfigError, SmtpDeliveryError } from "./mailer.server";

const FLASH_COOKIE_NAME = "__parallax_contact_flash";
const CONTEXT_COOKIE_NAME = "__parallax_contact_ctx";
const MIN_SUBMISSION_DELAY_MS = 2000; // 2 seconds
const MAX_SUBMISSION_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_BODY_BYTES = 64 * 1024; // 64 KiB

export interface ContactLoaderData {
  lang: "fr" | "en";
  content: {
    common: CommonContent;
    contactPage: ContactPageContent;
    home: {
      contact: {
        email: string;
        instagramUrl: string;
        youtubeUrl: string;
      };
    };
  };
  token: string;
  prefillType: string;
  flashSuccess: boolean;
  flashSuccessId?: string | null;
  smtpAvailable: boolean;
}

export interface ContactActionSuccess {
  ok: true;
}

export interface ContactActionFailure {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

export type ContactActionResult = ContactActionSuccess | ContactActionFailure;

function isProductionHttps(): boolean {
  return process.env.NODE_ENV === "production" && process.env.PARALLAX_LOCAL_PREVIEW !== "true";
}

export function createContactContextCookie(
  contextId: string,
  expiresAt: number,
  secret = ENV.RATE_LIMIT_SECRET
): string {
  const isSecure = isProductionHttps();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`contact-ctx:${contextId}:${expiresAt}`)
    .digest("hex");
  const cookieVal = `${contextId}.${expiresAt}.${signature}`;
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${CONTEXT_COOKIE_NAME}=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure ? "; Secure" : ""}`;
}

export function getOrCreateContactContext(
  request: Request,
  secret = ENV.RATE_LIMIT_SECRET
): { contextId: string; cookieHeader?: string } {
  const cookieHeader = request.headers.get("Cookie");
  const now = Date.now();

  if (cookieHeader) {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CONTEXT_COOKIE_NAME}=([^;]+)`));
    if (match) {
      const parts = match[1].split(".");
      if (parts.length === 3) {
        const [contextId, expiresAtStr, sig] = parts;
        if (/^[0-9a-f]{32}$/i.test(contextId) && /^\d+$/.test(expiresAtStr) && /^[0-9a-f]{64}$/i.test(sig)) {
          const expiresAt = parseInt(expiresAtStr, 10);
          const expectedSig = crypto
            .createHmac("sha256", secret)
            .update(`contact-ctx:${contextId}:${expiresAt}`)
            .digest("hex");
          if (
            expectedSig.length === sig.length &&
            crypto.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(sig, "hex")) &&
            expiresAt > now + 60_000
          ) {
            return { contextId };
          }
        }
      }
    }
  }

  const contextId = crypto.randomBytes(16).toString("hex");
  const expiresAt = now + MAX_SUBMISSION_AGE_MS;
  const setCookie = createContactContextCookie(contextId, expiresAt, secret);
  return { contextId, cookieHeader: setCookie };
}

export function generateContactToken(
  contextId: string,
  issuedAt = Date.now(),
  secret = ENV.RATE_LIMIT_SECRET
): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`contact-token:${issuedAt}:${nonce}:${contextId}`)
    .digest("hex");
  return `${issuedAt}.${nonce}.${contextId}.${signature}`;
}

export function verifyContactToken(
  token: string | null | undefined,
  request: Request,
  options?: { minDelayMs?: number; maxAgeMs?: number; secret?: string }
): {
  valid: boolean;
  reason?: "MISSING" | "FORMAT_INVALID" | "SIGNATURE_INVALID" | "TOO_FAST" | "EXPIRED" | "INVALID_CONTEXT" | "CONTEXT_MISMATCH";
  contextId?: string;
  issuedAt?: number;
  expiresAt?: number;
} {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "MISSING" };
  }

  const parts = token.split(".");
  if (parts.length !== 4) {
    return { valid: false, reason: "FORMAT_INVALID" };
  }

  const [issuedAtStr, nonce, tokenContextId, receivedSig] = parts;
  if (
    !/^\d+$/.test(issuedAtStr) ||
    !/^[0-9a-f]{32}$/i.test(nonce) ||
    !/^[0-9a-f]{32}$/i.test(tokenContextId) ||
    !/^[0-9a-f]{64}$/i.test(receivedSig)
  ) {
    return { valid: false, reason: "FORMAT_INVALID" };
  }

  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) {
    return { valid: false, reason: "INVALID_CONTEXT" };
  }
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CONTEXT_COOKIE_NAME}=([^;]+)`));
  if (!match) {
    return { valid: false, reason: "INVALID_CONTEXT" };
  }
  const ctxParts = match[1].split(".");
  if (ctxParts.length !== 3) {
    return { valid: false, reason: "INVALID_CONTEXT" };
  }
  const [cookieContextId, cookieExpiresAtStr, cookieSig] = ctxParts;
  if (!/^[0-9a-f]{32}$/i.test(cookieContextId) || !/^\d+$/.test(cookieExpiresAtStr) || !/^[0-9a-f]{64}$/i.test(cookieSig)) {
    return { valid: false, reason: "INVALID_CONTEXT" };
  }

  const secret = options?.secret ?? ENV.RATE_LIMIT_SECRET;
  const cookieExpiresAt = parseInt(cookieExpiresAtStr, 10);
  const expectedCookieSig = crypto
    .createHmac("sha256", secret)
    .update(`contact-ctx:${cookieContextId}:${cookieExpiresAt}`)
    .digest("hex");

  if (
    expectedCookieSig.length !== cookieSig.length ||
    !crypto.timingSafeEqual(Buffer.from(expectedCookieSig, "hex"), Buffer.from(cookieSig, "hex")) ||
    cookieExpiresAt <= Date.now()
  ) {
    return { valid: false, reason: "INVALID_CONTEXT" };
  }

  if (
    tokenContextId.length !== cookieContextId.length ||
    !crypto.timingSafeEqual(Buffer.from(tokenContextId), Buffer.from(cookieContextId))
  ) {
    return { valid: false, reason: "CONTEXT_MISMATCH" };
  }

  const issuedAt = parseInt(issuedAtStr, 10);
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`contact-token:${issuedAt}:${nonce}:${tokenContextId}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSig, "hex");
  const receivedBuf = Buffer.from(receivedSig, "hex");

  if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    return { valid: false, reason: "SIGNATURE_INVALID" };
  }

  const now = Date.now();
  const minDelayMs = options?.minDelayMs ?? MIN_SUBMISSION_DELAY_MS;
  const maxAgeMs = options?.maxAgeMs ?? MAX_SUBMISSION_AGE_MS;

  if (issuedAt > now + 60_000) {
    return { valid: false, reason: "FORMAT_INVALID" };
  }

  if (now - issuedAt < minDelayMs) {
    return { valid: false, reason: "TOO_FAST" };
  }

  if (now - issuedAt > maxAgeMs) {
    return { valid: false, reason: "EXPIRED" };
  }

  return { valid: true, contextId: tokenContextId, issuedAt, expiresAt: issuedAt + maxAgeMs };
}

export function getContactMessage(
  content: SiteContent,
  key: keyof typeof DEFAULT_CONTACT_PAGE_MESSAGES,
  lang: "fr" | "en",
  params?: Record<string, string | number>
): string {
  const custom = content.contactPage?.messages?.[key]?.[lang]?.trim();
  let text = custom || DEFAULT_CONTACT_PAGE_MESSAGES[key][lang];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

export function computeFormContentHash(
  params: {
    lang: string;
    name: string;
    email: string;
    phone?: string;
    timeline?: string;
    type: string;
    message: string;
  },
  secret = ENV.RATE_LIMIT_SECRET
): string {
  const canonicalArray = [
    "v2",
    params.lang.trim().toLowerCase(),
    params.name.trim(),
    params.email.trim().toLowerCase(),
    params.phone?.trim() ?? "",
    params.timeline?.trim() ?? "",
    params.type.trim(),
    params.message.trim(),
  ];
  const canonicalPayload = JSON.stringify(canonicalArray);
  return crypto.createHmac("sha256", secret).update(`contact-content-v2:${canonicalPayload}`).digest("hex");
}

function computeTokenClaimHash(token: string, secret = ENV.RATE_LIMIT_SECRET): string {
  return crypto.createHmac("sha256", secret).update(`contact-claim:${token}`).digest("hex");
}

export function createContactFlashCookie(secret = ENV.RATE_LIMIT_SECRET): string {
  const ts = Date.now();
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = `${ts}.${nonce}`;
  const sig = crypto.createHmac("sha256", secret).update(`contact-flash:${payload}`).digest("hex");
  const cookieVal = `${payload}.${sig}`;
  const isSecure = isProductionHttps();

  return `${FLASH_COOKIE_NAME}=${cookieVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60${isSecure ? "; Secure" : ""}`;
}

export function readAndClearContactFlash(
  request: Request,
  secret = ENV.RATE_LIMIT_SECRET
): { hasFlash: boolean; flashId?: string; clearCookieHeader?: string } {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) {
    return { hasFlash: false };
  }

  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${FLASH_COOKIE_NAME}=([^;]+)`));
  if (!match) {
    return { hasFlash: false };
  }

  const rawVal = match[1];
  const parts = rawVal.split(".");
  const isSecure = isProductionHttps();
  const clearHeader = `${FLASH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? "; Secure" : ""}`;

  if (parts.length !== 3) {
    return { hasFlash: false, clearCookieHeader: clearHeader };
  }

  const [tsStr, nonce, receivedSig] = parts;
  if (!/^\d+$/.test(tsStr) || !/^[0-9a-f]{16}$/i.test(nonce) || !/^[0-9a-f]{64}$/i.test(receivedSig)) {
    return { hasFlash: false, clearCookieHeader: clearHeader };
  }

  const payload = `${tsStr}.${nonce}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(`contact-flash:${payload}`).digest("hex");

  const expectedBuf = Buffer.from(expectedSig, "hex");
  const receivedBuf = Buffer.from(receivedSig, "hex");

  if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    return { hasFlash: false, clearCookieHeader: clearHeader };
  }

  const ts = parseInt(tsStr, 10);
  const now = Date.now();
  if (now - ts > 60_000 || ts > now + 60_000) {
    return { hasFlash: false, clearCookieHeader: clearHeader };
  }

  return { hasFlash: true, flashId: `${tsStr}.${nonce}`, clearCookieHeader: clearHeader };
}

export function detectRequestLang(request: Request, forcedLang?: "fr" | "en"): "fr" | "en" {
  if (forcedLang) return forcedLang;
  try {
    const url = new URL(request.url);
    if (/^\/en(\/|\.|$)/i.test(url.pathname)) {
      return "en";
    }
  } catch {
    // fallback
  }
  return "fr";
}

const ALLOWED_FORM_FIELDS = ["name", "email", "phone", "timeline", "type", "message", "website", "_token"] as const;

export async function handleContactLoader(args: LoaderFunctionArgs, forcedLang?: "fr" | "en") {
  const { request } = args;
  const lang = detectRequestLang(request, forcedLang);
  const content = getSiteContent();
  const { contextId, cookieHeader: contextCookieHeader } = getOrCreateContactContext(request);
  const token = generateContactToken(contextId);

  const smtpDiag = getSmtpDiagnostic();
  const smtpAvailable = smtpDiag.status === "configured";

  const { hasFlash, flashId, clearCookieHeader } = readAndClearContactFlash(request);

  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type")?.trim() ?? "";
  const isValidType = content.contactPage.form.projectTypes.some((pt) => pt.id === typeParam && pt.enabled);
  const prefillType = isValidType ? typeParam : "";

  const headers = new Headers({
    "Cache-Control": "no-store",
  });
  if (contextCookieHeader) {
    headers.append("Set-Cookie", contextCookieHeader);
  }
  if (clearCookieHeader) {
    headers.append("Set-Cookie", clearCookieHeader);
  }

  return data<ContactLoaderData>(
    {
      lang,
      content: {
        common: content.common,
        contactPage: content.contactPage,
        home: {
          contact: {
            email: content.home.contact.email,
            instagramUrl: content.home.contact.instagramUrl,
            youtubeUrl: content.home.contact.youtubeUrl,
          },
        },
      },
      token,
      prefillType,
      flashSuccess: hasFlash,
      flashSuccessId: flashId ?? null,
      smtpAvailable,
    },
    { headers }
  );
}

export async function handleContactAction(args: ActionFunctionArgs, forcedLang?: "fr" | "en"): Promise<Response> {
  const { request } = args;
  const lang = detectRequestLang(request, forcedLang);
  const isFr = lang === "fr";
  const siteContent = getSiteContent();
  const contactPage = siteContent.contactPage;

  const noStoreHeaders = new Headers({
    "Cache-Control": "no-store",
  });

  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method Not Allowed" },
      { status: 405, headers: { ...Object.fromEntries(noStoreHeaders), Allow: "POST" } }
    );
  }

  if (!validateOrigin(request)) {
    return Response.json(
      { ok: false, error: isFr ? "Origine de la requête non autorisée." : "Unauthorized request origin." },
      { status: 403, headers: noStoreHeaders }
    );
  }

  let formData: URLSearchParams;
  try {
    formData = await readStrictFormUrlEncoded(request, MAX_BODY_BYTES, ALLOWED_FORM_FIELDS);
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err && typeof err.status === "number" ? err.status : 400;
    const msg = isFr ? "Requête invalide ou taille excessive." : "Invalid request or payload too large.";
    return Response.json({ ok: false, error: msg }, { status, headers: noStoreHeaders });
  }

  // Honeypot check
  const websiteHoneypot = formData.get("website")?.trim();
  if (websiteHoneypot) {
    // Silently reject bot without revealing the honeypot mechanism
    return Response.json(
      { ok: false, error: getContactMessage(siteContent, "sessionExpired", lang) },
      { status: 400, headers: noStoreHeaders }
    );
  }

  // Token validation
  const token = formData.get("_token");
  const tokenCheck = verifyContactToken(token, request);
  if (!tokenCheck.valid) {
    return Response.json(
      { ok: false, error: getContactMessage(siteContent, "sessionExpired", lang) },
      { status: 400, headers: noStoreHeaders }
    );
  }

  // Field extraction & preservation
  const rawName = formData.get("name")?.trim() ?? "";
  const rawEmail = formData.get("email")?.trim() ?? "";
  const rawPhone = formData.get("phone")?.trim() ?? "";
  const rawTimeline = formData.get("timeline")?.trim() ?? "";
  const rawType = formData.get("type")?.trim() ?? "";
  const rawMessage = formData.get("message")?.trim() ?? "";

  const values: Record<string, string> = {
    name: rawName,
    email: rawEmail,
    phone: rawPhone,
    timeline: rawTimeline,
    type: rawType,
    message: rawMessage,
  };

  const fieldErrors: Record<string, string> = {};

  // Validate Name
  if (!rawName) {
    fieldErrors.name = getContactMessage(siteContent, "nameRequired", lang);
  } else if (rawName.length > 100) {
    fieldErrors.name = getContactMessage(siteContent, "nameTooLong", lang);
  } else if (/[\r\n]/.test(rawName)) {
    fieldErrors.name = isFr ? "Caractères invalides." : "Invalid characters.";
  }

  // Validate Email
  if (!rawEmail) {
    fieldErrors.email = getContactMessage(siteContent, "emailRequired", lang);
  } else if (rawEmail.length > 254) {
    fieldErrors.email = isFr ? "254 caractères maximum." : "Maximum 254 characters.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    fieldErrors.email = getContactMessage(siteContent, "emailInvalid", lang);
  } else if (/[\r\n]/.test(rawEmail)) {
    fieldErrors.email = isFr ? "Caractères invalides." : "Invalid characters.";
  }

  // Validate Phone (optional)
  if (rawPhone) {
    if (rawPhone.length > 50) {
      fieldErrors.phone = isFr ? "50 caractères maximum." : "Maximum 50 characters.";
    } else if (!/^[\d\s\-+().]{4,50}$/.test(rawPhone)) {
      fieldErrors.phone = getContactMessage(siteContent, "phoneInvalid", lang);
    } else if (/[\r\n]/.test(rawPhone)) {
      fieldErrors.phone = isFr ? "Caractères invalides." : "Invalid characters.";
    }
  }

  // Validate Timeline (optional)
  if (rawTimeline) {
    if (rawTimeline.length > 120) {
      fieldErrors.timeline = getContactMessage(siteContent, "timelineInvalid", lang);
    } else if (/[\r\n]/.test(rawTimeline)) {
      fieldErrors.timeline = isFr ? "Caractères invalides." : "Invalid characters.";
    }
  }

  // Validate Project Type
  const matchedType = contactPage.form.projectTypes.find((pt) => pt.id === rawType && pt.enabled);
  if (!rawType || !matchedType) {
    fieldErrors.type = getContactMessage(siteContent, "typeRequired", lang);
  }

  // Validate Message
  if (!rawMessage) {
    fieldErrors.message = getContactMessage(siteContent, "messageRequired", lang);
  } else if (rawMessage.length > 5000) {
    fieldErrors.message = getContactMessage(siteContent, "messageTooLong", lang);
  }

  if (Object.keys(fieldErrors).length > 0) {
    const errorSummary = getContactMessage(siteContent, "errorSummary", lang);
    return Response.json(
      { ok: false, error: errorSummary, fieldErrors, values },
      { status: 400, headers: noStoreHeaders }
    );
  }

  // Check Rate Limit (IP based: 5 attempts per 15 minutes)
  const clientIp = getClientIp(request);
  if (!clientIp) {
    return Response.json(
      { ok: false, error: isFr ? "Adresse réseau invalide." : "Invalid network address.", values },
      { status: 403, headers: noStoreHeaders }
    );
  }

  try {
    checkRateLimit(clientIp, "contact");
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) {
      const errorMsg = getContactMessage(siteContent, "rateLimit", lang, { seconds: err.retryAfter });
      const rlHeaders = new Headers(noStoreHeaders);
      rlHeaders.set("Retry-After", String(err.retryAfter));
      return Response.json({ ok: false, error: errorMsg, values }, { status: 429, headers: rlHeaders });
    }
    if (err instanceof RateLimitStorageError) {
      return Response.json(
        { ok: false, error: isFr ? "Base de données temporairement indisponible." : "Database temporarily unavailable.", values },
        { status: 503, headers: noStoreHeaders }
      );
    }
    throw err;
  }

  // Content hash & anti-replay claim
  const contentHash = computeFormContentHash({
    lang,
    name: rawName,
    email: rawEmail,
    phone: rawPhone,
    timeline: rawTimeline,
    type: rawType,
    message: rawMessage,
  });
  const tokenHash = computeTokenClaimHash(token!);
  const tokenExpiresAt = tokenCheck.expiresAt ?? Date.now() + MAX_SUBMISSION_AGE_MS;

  let claimResult: ContactClaimAcquireResult;
  try {
    claimResult = acquireContactClaim(tokenHash, contentHash, tokenExpiresAt);
  } catch (err: unknown) {
    console.error("[CONTACT_CLAIM_ACQUIRE_ERROR]", err instanceof Error ? err.message : String(err));
    return Response.json(
      { ok: false, error: contactPage.messages.unavailableMessage[lang], values },
      { status: 503, headers: noStoreHeaders }
    );
  }

  if (claimResult.status === "completed") {
    // Already sent successfully: return 303 PRG redirect with flash cookie without re-sending
    const flashCookie = createContactFlashCookie();
    const redirectHeaders = new Headers({
      Location: `/${lang}/contact`,
      "Set-Cookie": flashCookie,
      "Cache-Control": "no-store",
    });
    return new Response(null, { status: 303, headers: redirectHeaders });
  }

  if (claimResult.status === "conflict_content_mismatch") {
    return Response.json(
      {
        ok: false,
        error: getContactMessage(siteContent, "conflict", lang),
        values,
      },
      { status: 409, headers: noStoreHeaders }
    );
  }

  if (claimResult.status === "in_progress") {
    return Response.json(
      {
        ok: false,
        error: getContactMessage(siteContent, "inProgress", lang),
        values,
      },
      { status: 409, headers: noStoreHeaders }
    );
  }

  if (claimResult.status === "uncertain") {
    return Response.json(
      {
        ok: false,
        error: getContactMessage(siteContent, "uncertain", lang),
        values,
      },
      { status: 504, headers: noStoreHeaders }
    );
  }

  const claimId = claimResult.claimId;

  // Send email via Nodemailer
  try {
    await sendContactEmail({
      name: rawName,
      email: rawEmail,
      phone: rawPhone,
      timeline: rawTimeline,
      projectTypeId: matchedType!.id,
      projectTypeLabel: matchedType!.label[lang],
      lang,
      message: rawMessage,
    });

    try {
      completeContactClaim(tokenHash, claimId, tokenExpiresAt);
    } catch (persistErr: unknown) {
      console.error(
        "[CONTACT_CLAIM_PERSISTENCE_FAILURE] Failed to persist completed contact claim receipt",
        persistErr instanceof Error ? persistErr.message : String(persistErr)
      );
    }

    const flashCookie = createContactFlashCookie();
    const redirectHeaders = new Headers({
      Location: `/${lang}/contact`,
      "Set-Cookie": flashCookie,
      "Cache-Control": "no-store",
    });

    return new Response(null, { status: 303, headers: redirectHeaders });
  } catch (err: unknown) {
    if (err instanceof SmtpDeliveryError && err.isUncertain) {
      try {
        markUncertainContactClaim(tokenHash, claimId, tokenExpiresAt);
      } catch (claimErr: unknown) {
        console.error(
          "[CONTACT_CLAIM_UNCERTAIN_FAILURE] Failed to mark claim as uncertain",
          claimErr instanceof Error ? claimErr.message : String(claimErr)
        );
      }
      return Response.json(
        {
          ok: false,
          error: getContactMessage(siteContent, "uncertain", lang),
          values,
        },
        { status: 504, headers: noStoreHeaders }
      );
    }

    // Certain failure: fail the claim so user can retry
    try {
      failContactClaim(tokenHash, claimId);
    } catch (claimErr: unknown) {
      console.error(
        "[CONTACT_CLAIM_FAIL_FAILURE] Failed to mark claim as failed",
        claimErr instanceof Error ? claimErr.message : String(claimErr)
      );
    }

    if (err instanceof SmtpConfigError) {
      return Response.json(
        { ok: false, error: contactPage.messages.unavailableMessage[lang], values },
        { status: 503, headers: noStoreHeaders }
      );
    }

    if (err instanceof SmtpDeliveryError) {
      return Response.json(
        { ok: false, error: getContactMessage(siteContent, "genericError", lang), values },
        { status: 500, headers: noStoreHeaders }
      );
    }

    return Response.json(
      { ok: false, error: getContactMessage(siteContent, "genericError", lang), values },
      { status: 500, headers: noStoreHeaders }
    );
  }
}
