import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { validateOrigin, readStrictFormUrlEncoded } from "../../lib/security.server";
import {
  createSignedPrivacyCookie,
  createClearPrivacyCookie,
  parsePrivacyCookie,
} from "../../lib/privacy-preferences.server";

const MAX_PREFS_BODY_BYTES = 8 * 1024; // 8 KiB

const ALLOWED_DESTINATIONS = new Set([
  "/fr/cookies",
  "/en/cookies",
  "/fr/cookies#preferences",
  "/en/cookies#preferences",
]);

function resolveSafeDestination(raw: unknown, fallbackLang: "fr" | "en" = "fr"): string {
  const fallback = fallbackLang === "en" ? "/en/cookies#preferences" : "/fr/cookies#preferences";
  if (!raw || typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith("//") || trimmed.includes("\\") || trimmed.includes(":")) {
    return fallback;
  }
  if (ALLOWED_DESTINATIONS.has(trimmed)) {
    return trimmed;
  }
  return fallback;
}

async function readStrictBoundedJson(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const contentLengthHeader = request.headers.get("Content-Length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader.trim());
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return { ok: false, status: 400, error: "Invalid Content-Length" };
    }
    if (contentLength > maxBytes) {
      return { ok: false, status: 413, error: "Payload too large" };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, error: "Missing request body" };
  }

  const reader = request.body.getReader();
  let bytesRead = 0;
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          try {
            await reader.cancel("Payload too large");
          } catch {
            // Ignored
          }
          return { ok: false, status: 413, error: "Payload too large" };
        }
        chunks.push(value);
      }
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // Ignored
    }
    return { ok: false, status: 400, error: "Error reading request stream" };
  }

  const totalBuffer = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    totalBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(totalBuffer);
    const parsed = JSON.parse(text);
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON format" };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const preferences = parsePrivacyCookie(request);
  return Response.json(
    { ok: true, preferences },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Vary": "Cookie",
      },
    }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const noStoreHeaders = new Headers({
    "Cache-Control": "private, no-store",
    "Vary": "Cookie",
  });

  if (request.method !== "POST") {
    noStoreHeaders.set("Allow", "POST");
    return Response.json(
      { ok: false, error: "Method Not Allowed" },
      { status: 405, headers: noStoreHeaders }
    );
  }

  if (!validateOrigin(request)) {
    return Response.json(
      { ok: false, error: "Invalid Origin" },
      { status: 403, headers: noStoreHeaders }
    );
  }

  const rawContentType = request.headers.get("Content-Type") || "";
  const contentType = rawContentType.toLowerCase().split(";")[0].trim();

  let youtube = false;
  let vimeo = false;
  let isRevocation = false;
  let rawDestination: unknown;
  const isJsonRequest = contentType === "application/json";

  if (isJsonRequest) {
    const readResult = await readStrictBoundedJson(request, MAX_PREFS_BODY_BYTES);
    if (!readResult.ok) {
      return Response.json(
        { ok: false, error: readResult.error },
        { status: readResult.status, headers: noStoreHeaders }
      );
    }

    const json = readResult.data;
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      return Response.json(
        { ok: false, error: "Payload must be a JSON object" },
        { status: 400, headers: noStoreHeaders }
      );
    }

    const payload = json as Record<string, unknown>;
    const allowedKeys = new Set(["youtube", "vimeo", "action", "intent", "returnTo", "redirectTo"]);
    for (const key of Object.keys(payload)) {
      if (!allowedKeys.has(key)) {
        return Response.json(
          { ok: false, error: `Propriété inconnue '${key}'` },
          { status: 400, headers: noStoreHeaders }
        );
      }
    }

    const actionVal = payload.action !== undefined ? payload.action : payload.intent;
    if (actionVal !== undefined) {
      if (typeof actionVal !== "string") {
        return Response.json(
          { ok: false, error: "Action must be a string" },
          { status: 400, headers: noStoreHeaders }
        );
      }
      if (!["save", "revoke_all", "refuse_all"].includes(actionVal)) {
        return Response.json(
          { ok: false, error: "Action inconnue" },
          { status: 400, headers: noStoreHeaders }
        );
      }
    }

    if (actionVal === "revoke_all" || actionVal === "refuse_all") {
      if (payload.youtube === true || payload.vimeo === true) {
        return Response.json(
          { ok: false, error: "Contradictory revocation payload" },
          { status: 400, headers: noStoreHeaders }
        );
      }
      isRevocation = true;
    } else {
      if (payload.youtube !== undefined) {
        if (typeof payload.youtube !== "boolean") {
          return Response.json(
            { ok: false, error: "Le champ youtube doit être un booléen strict" },
            { status: 400, headers: noStoreHeaders }
          );
        }
        youtube = payload.youtube;
      }
      if (payload.vimeo !== undefined) {
        if (typeof payload.vimeo !== "boolean") {
          return Response.json(
            { ok: false, error: "Le champ vimeo doit être un booléen strict" },
            { status: 400, headers: noStoreHeaders }
          );
        }
        vimeo = payload.vimeo;
      }
    }

    rawDestination = payload.returnTo || payload.redirectTo;
  } else if (contentType === "application/x-www-form-urlencoded") {
    let formParams: URLSearchParams;
    try {
      formParams = await readStrictFormUrlEncoded(request, MAX_PREFS_BODY_BYTES, [
        "youtube",
        "vimeo",
        "action",
        "intent",
        "returnTo",
        "redirectTo",
      ]);
    } catch (err: unknown) {
      const status =
        err && typeof err === "object" && "status" in err && typeof err.status === "number"
          ? err.status
          : 400;
      return Response.json(
        { ok: false, error: "Invalid form payload" },
        { status, headers: noStoreHeaders }
      );
    }

    const actionVal = formParams.get("action") || formParams.get("intent");
    if (actionVal !== null && !["save", "revoke_all", "refuse_all"].includes(actionVal)) {
      return Response.json(
        { ok: false, error: "Action inconnue" },
        { status: 400, headers: noStoreHeaders }
      );
    }

    if (actionVal === "revoke_all" || actionVal === "refuse_all") {
      isRevocation = true;
    } else {
      youtube = formParams.get("youtube") === "true" || formParams.get("youtube") === "on";
      vimeo = formParams.get("vimeo") === "true" || formParams.get("vimeo") === "on";
    }

    rawDestination = formParams.get("returnTo") || formParams.get("redirectTo");
  } else {
    return Response.json(
      { ok: false, error: "Unsupported Content-Type" },
      { status: 415, headers: noStoreHeaders }
    );
  }

  if (rawDestination !== null && rawDestination !== undefined && rawDestination !== "") {
    if (typeof rawDestination !== "string") {
      return Response.json(
        { ok: false, error: "Destination de retour non autorisée" },
        { status: 400, headers: noStoreHeaders }
      );
    }
    const trimmed = rawDestination.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.includes("\\") ||
      trimmed.includes(":") ||
      !ALLOWED_DESTINATIONS.has(trimmed)
    ) {
      return Response.json(
        { ok: false, error: "Destination de retour non autorisée" },
        { status: 400, headers: noStoreHeaders }
      );
    }
  }

  const cookieHeader = isRevocation
    ? createClearPrivacyCookie()
    : createSignedPrivacyCookie({ youtube, vimeo });

  noStoreHeaders.append("Set-Cookie", cookieHeader);

  const acceptHeader = request.headers.get("Accept") || "";
  const isHtmlNavigation = !isJsonRequest || acceptHeader.includes("text/html");

  if (isHtmlNavigation) {
    const isEn = typeof rawDestination === "string" && rawDestination.includes("/en/");
    const safeDestination = resolveSafeDestination(rawDestination, isEn ? "en" : "fr");
    noStoreHeaders.set("Location", safeDestination);
    return new Response(null, {
      status: 303,
      headers: noStoreHeaders,
    });
  }

  return Response.json(
    {
      ok: true,
      preferences: {
        youtube: isRevocation ? false : youtube,
        vimeo: isRevocation ? false : vimeo,
      },
    },
    { status: 200, headers: noStoreHeaders }
  );
}
