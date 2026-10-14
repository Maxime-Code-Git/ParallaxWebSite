import fs from "node:fs";
import { ALLOWED_WIDTHS, type AllowedWidth } from "./gallery-preview.server";
import { verifySecurePathChain, SafeImageError } from "./media-image.server";

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses standard HTTP Range header (e.g. "bytes=0-1024").
 * Returns null if the range is invalid or unsatisfiable (RFC 7233).
 * Multiple / multipart ranges are rejected (returns null) for safety.
 */
export function parseRangeHeader(rangeHeader: string | null, totalSize: number): ByteRange | null {
  if (!rangeHeader || totalSize <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null; // Reject multipart or malformed syntax

  const [, rawStart, rawEnd] = match;

  if (rawStart === "" && rawEnd === "") {
    return null;
  }

  let start: number;
  let end: number;

  if (rawStart === "") {
    // Suffix range: bytes=-500 -> last 500 bytes
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (Number.isNaN(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else if (rawEnd === "") {
    // Open range: bytes=500- -> from byte 500 to end
    start = Number.parseInt(rawStart, 10);
    if (Number.isNaN(start) || start < 0 || start >= totalSize) return null;
    end = totalSize - 1;
  } else {
    // Exact range: bytes=500-1000
    start = Number.parseInt(rawStart, 10);
    end = Number.parseInt(rawEnd, 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= totalSize) {
      return null;
    }
    end = Math.min(end, totalSize - 1);
  }

  return { start, end };
}

/**
 * Validates requested width against allowed preview breakpoints (480, 960, 1920).
 */
export function parseWidth(widthStr: string | null): AllowedWidth | null {
  if (!widthStr) return null;
  const num = Number.parseInt(widthStr, 10);
  if ((ALLOWED_WIDTHS as readonly number[]).includes(num)) {
    return num as AllowedWidth;
  }
  return null;
}

/**
 * Validates requested preview format (WebP strictly).
 */
export function parseFormat(formatStr: string | null): "webp" | null {
  if (!formatStr) return null;
  const normalized = formatStr.trim().toLowerCase();
  return normalized === "webp" ? "webp" : null;
}

/**
 * Builds RFC 6266 / RFC 5987 compliant Content-Disposition header with safe ASCII fallback
 * and UTF-8 filename encoding.
 */
export function buildContentDisposition(disposition: "inline" | "attachment", rawFilename: string): string {
  const sanitized = pathBasenameSafe(rawFilename);
  const asciiFallback = sanitized.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  const utf8Encoded = encodeURIComponent(sanitized).replace(/['()]/g, escape).replace(/\*/g, "%2A");

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

function pathBasenameSafe(name: string): string {
  // Strip control characters and path traversal markers
  const clean = name.replace(/[\0\r\n/\\]/g, "_").trim();
  return clean.length > 0 ? clean : "media";
}

export interface SecureMediaHandle {
  fd: number;
  size: number;
  fullPath: string;
  createReadStream: (options?: { start?: number; end?: number }) => fs.ReadStream;
  close: () => void;
}

/**
 * Safely opens a media file by validating every directory and leaf component
 * against symlink traversal and strict confinement, then opening with O_RDONLY | O_NOFOLLOW
 * and verifying via fstatSync on the open descriptor.
 */
export function openSecureMediaFile(baseDir: string, segments: string[]): SecureMediaHandle {
  const verifiedPath = verifySecurePathChain(baseDir, segments, "file");
  let fd: number;
  try {
    fd = fs.openSync(verifiedPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw new SafeImageError("Impossible d'ouvrir le fichier de média de façon sécurisée.");
  }

  let stat: fs.Stats;
  try {
    stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      fs.closeSync(fd);
      throw new SafeImageError("Le descripteur ouvert ne correspond pas à un fichier régulier.");
    }
  } catch (err) {
    try {
      fs.closeSync(fd);
    } catch {
      // Ignored
    }
    if (err instanceof SafeImageError) throw err;
    throw new SafeImageError("Impossible de vérifier les attributs du fichier ouvert.");
  }

  let isClosed = false;
  const safeClose = () => {
    if (!isClosed) {
      isClosed = true;
      try {
        fs.closeSync(fd);
      } catch {
        // Ignored
      }
    }
  };

  return {
    fd,
    size: stat.size,
    fullPath: verifiedPath,
    createReadStream: (options?: { start?: number; end?: number }) => {
      if (isClosed) throw new Error("File descriptor already closed");
      const readStream = fs.createReadStream(verifiedPath, {
        fd,
        autoClose: true,
        start: options?.start,
        end: options?.end,
      });
      readStream.on("close", () => {
        isClosed = true;
      });
      return readStream;
    },
    close: safeClose,
  };
}
