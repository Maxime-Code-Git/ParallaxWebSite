import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import type { EntryContext } from "react-router";
import crypto from "node:crypto";

const ABORT_DELAY = 5_000;

export function applyAdminSecurityHeaders(headers: Headers, url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/")) {
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      headers.set("X-Robots-Tag", "noindex, nofollow");
    }
  } catch {
    if (url.includes("/admin")) {
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      headers.set("X-Robots-Tag", "noindex, nofollow");
    }
  }
}

export function applyContactSecurityHeaders(headers: Headers, url: string): void {
  try {
    const parsed = new URL(url);
    if (/^\/(fr|en)\/contact(\/|\.|$)/i.test(parsed.pathname) || parsed.pathname === "/contact") {
      headers.set("Cache-Control", "no-store");
    }
  } catch {
    if (url.includes("/contact")) {
      headers.set("Cache-Control", "no-store");
    }
  }
}

import { validateServerStartup } from "./lib/env.server";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: Record<string, unknown>
) {
  validateServerStartup();
  return isbot(request.headers.get("user-agent") ?? "")
    ? handleBotRequest(request, responseStatusCode, responseHeaders, routerContext)
    : handleBrowserRequest(request, responseStatusCode, responseHeaders, routerContext);
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  const styleSrc = isDev ? "'self' 'unsafe-inline'" : "'self'";
  const connectSrc = isDev ? "'self' ws: wss:" : "'self'";

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src ${styleSrc}`,
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  return directives.join("; ");
}

export function addSecurityHeaders(headers: Headers, nonce: string): void {
  headers.set("Content-Security-Policy", buildCsp(nonce));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  return new Promise<Response>((resolve, reject) => {
    const nonce = generateNonce();
    let shellRendered = false;

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
      {
        nonce,
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          applyAdminSecurityHeaders(responseHeaders, request.url);
          applyContactSecurityHeaders(responseHeaders, request.url);
          addSecurityHeaders(responseHeaders, nonce);
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  return new Promise<Response>((resolve, reject) => {
    const nonce = generateNonce();
    let shellRendered = false;

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
      {
        nonce,
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          applyAdminSecurityHeaders(responseHeaders, request.url);
          applyContactSecurityHeaders(responseHeaders, request.url);
          addSecurityHeaders(responseHeaders, nonce);
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
