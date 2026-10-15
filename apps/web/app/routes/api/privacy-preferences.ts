import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { validateOrigin, readStrictFormUrlEncoded } from "../../lib/security.server";
import {
  createSignedPrivacyCookie,
  parsePrivacyCookie,
} from "../../lib/privacy-preferences.server";
import { ENV } from "../../lib/env.server";

const MAX_PREFS_BODY_BYTES = 8 * 1024; // 8 KiB

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

  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  let youtube = false;
  let vimeo = false;
  let isRevocation = false;
  let redirectTo: string | null = null;

  if (contentType.includes("application/json")) {
    let json: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_PREFS_BODY_BYTES) {
        return Response.json(
          { ok: false, error: "Payload too large" },
          { status: 413, headers: noStoreHeaders }
        );
      }
      json = JSON.parse(text);
    } catch {
      return Response.json(
        { ok: false, error: "Invalid JSON" },
        { status: 400, headers: noStoreHeaders }
      );
    }

    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      return Response.json(
        { ok: false, error: "Invalid payload format" },
        { status: 400, headers: noStoreHeaders }
      );
    }

    const payload = json as Record<string, unknown>;
    if (payload.action === "revoke_all" || payload.action === "refuse_all") {
      isRevocation = true;
    } else {
      youtube = Boolean(payload.youtube);
      vimeo = Boolean(payload.vimeo);
    }
    if (typeof payload.redirectTo === "string") {
      redirectTo = payload.redirectTo;
    }
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    let formParams: URLSearchParams;
    try {
      formParams = await readStrictFormUrlEncoded(request, MAX_PREFS_BODY_BYTES, [
        "youtube",
        "vimeo",
        "action",
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

    const actionVal = formParams.get("action");
    if (actionVal === "revoke_all" || actionVal === "refuse_all") {
      isRevocation = true;
    } else {
      youtube = formParams.get("youtube") === "on" || formParams.get("youtube") === "true";
      vimeo = formParams.get("vimeo") === "on" || formParams.get("vimeo") === "true";
    }

    const redirectVal = formParams.get("redirectTo");
    if (redirectVal && (redirectVal.startsWith("/") || redirectVal.startsWith(ENV.PUBLIC_SITE_URL))) {
      redirectTo = redirectVal;
    }
  } else {
    return Response.json(
      { ok: false, error: "Unsupported Content-Type" },
      { status: 415, headers: noStoreHeaders }
    );
  }

  const cookieHeader = isRevocation
    ? createSignedPrivacyCookie({ youtube: false, vimeo: false })
    : createSignedPrivacyCookie({ youtube, vimeo });

  noStoreHeaders.append("Set-Cookie", cookieHeader);

  // If request comes from a standard HTML form submission, redirect back gracefully
  const acceptHeader = request.headers.get("Accept") || "";
  const isHtmlNavigation = acceptHeader.includes("text/html");

  if (isHtmlNavigation || redirectTo) {
    const destination =
      redirectTo && redirectTo.startsWith("/") ? redirectTo : "/fr/cookies";
    noStoreHeaders.set("Location", destination);
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
    { headers: noStoreHeaders }
  );
}
