import * as net from "node:net";
import { ENV } from "./env.server";

export const MAX_AUTH_BODY_SIZE = 8192; // 8 KiB exact

export class ActionSecurityError extends Error {
  status: number;
  headers?: Record<string, string>;

  constructor(message: string, status = 400, headers?: Record<string, string>) {
    super(message);
    this.name = "ActionSecurityError";
    this.status = status;
    this.headers = headers;
  }
}

/**
 * Validates request Origin against the configured PUBLIC_SITE_URL.
 */
export function validateOrigin(request: Request): boolean {
  const originHeader = request.headers.get("Origin");
  if (!originHeader) {
    return false;
  }
  try {
    const originUrl = new URL(originHeader);
    const siteUrl = new URL(ENV.PUBLIC_SITE_URL);
    return originUrl.origin === siteUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Extracts client IP address safely according to TRUST_PROXY setting.
 * When TRUST_PROXY is false, client proxy headers are ignored to prevent spoofing.
 */
export function getClientIp(request: Request): string | null {
  if (ENV.TRUST_PROXY) {
    let ip = request.headers.get("cf-connecting-ip");
    if (!ip) {
      ip = request.headers.get("x-forwarded-for");
    }

    if (!ip || !ip.trim()) {
      return null;
    }

    // Reject if multiple IPs (comma) indicating chained or untrusted proxy headers
    if (ip.includes(",")) {
      return null;
    }

    const cleanIp = ip.trim();
    if (!net.isIP(cleanIp)) {
      return null;
    }
    return cleanIp;
  }

  // Conservative local key when TRUST_PROXY is false
  return "127.0.0.1";
}

/**
 * Reads form data with strict Content-Type, Content-Length, and streaming size limits.
 * Rejects unexpected duplicates of sensitive keys.
 */
export async function readStrictFormUrlEncoded(
  request: Request,
  maxBytes: number = MAX_AUTH_BODY_SIZE
): Promise<URLSearchParams> {
  if (request.method !== "POST") {
    throw new ActionSecurityError("Method Not Allowed", 405, { Allow: "POST" });
  }

  const contentTypeRaw = request.headers.get("Content-Type");
  const contentType = contentTypeRaw ? contentTypeRaw.trim() : "";
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*utf-8\s*)?$/i.test(contentType)) {
    throw new ActionSecurityError("Unsupported Media Type", 415);
  }

  const contentLengthStr = request.headers.get("Content-Length");
  if (contentLengthStr) {
    if (!/^\d+$/.test(contentLengthStr)) {
      throw new ActionSecurityError("Invalid Content-Length", 400);
    }
    const contentLength = Number(contentLengthStr);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new ActionSecurityError("Invalid Content-Length", 400);
    }
    if (contentLength > maxBytes) {
      throw new ActionSecurityError("Payload Too Large", 413);
    }
  }

  if (!request.body) {
    throw new ActionSecurityError("Bad Request", 400);
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
          await reader.cancel("Payload too large");
          throw new ActionSecurityError("Payload Too Large", 413);
        }
        chunks.push(value);
      }
    }
  } catch (err: unknown) {
    if (err instanceof ActionSecurityError) throw err;
    throw new ActionSecurityError("Error reading request", 400);
  }

  const totalBuffer = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    totalBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const rawText = new TextDecoder("utf-8", { fatal: true }).decode(totalBuffer);

  // Check for duplicate keys in sensitive form fields
  const seenKeys = new Set<string>();
  const sensitiveDuplicateKeys = ["password", "csrfToken", "intent"];

  for (const pair of rawText.split("&")) {
    if (!pair) continue;
    const [key] = pair.split("=");
    const decodedKey = decodeURIComponent(key.replace(/\+/g, " "));
    if (sensitiveDuplicateKeys.includes(decodedKey)) {
      if (seenKeys.has(decodedKey)) {
        throw new ActionSecurityError("Duplicate field not permitted", 400);
      }
      seenKeys.add(decodedKey);
    }
  }

  return new URLSearchParams(rawText);
}
