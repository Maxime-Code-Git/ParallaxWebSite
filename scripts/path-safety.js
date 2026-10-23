import fs from "node:fs";
import path from "node:path";

/**
 * Checks if a path segment is an operating system system-level alias (such as macOS /var, /tmp, /etc).
 */
export function isOsSystemAlias(p) {
  const norm = path.normalize(p);
  return (
    norm === "/var" ||
    norm === "/tmp" ||
    norm === "/etc" ||
    norm === "/private" ||
    norm === "/private/var" ||
    norm === "/private/tmp" ||
    norm === "/private/etc"
  );
}

/**
 * Returns true if the path exists on disk, even if it is a broken symlink.
 */
export function pathExists(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the path is a symbolic link.
 */
export function isSymlink(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Resolves the canonical physical path, taking into account OS aliases
 * while preserving segments that do not exist yet.
 */
export function getCanonicalPath(targetPath) {
  const resolved = path.resolve(targetPath);
  let current = resolved;
  const tail = [];

  while (current !== path.dirname(current)) {
    try {
      fs.lstatSync(current);
      break;
    } catch {
      tail.unshift(path.basename(current));
      current = path.dirname(current);
    }
  }

  let canonicalHead;
  try {
    canonicalHead = fs.realpathSync(current);
  } catch {
    canonicalHead = current;
  }

  return tail.length > 0 ? path.join(canonicalHead, ...tail) : canonicalHead;
}

/**
 * Returns true if targetPath or any of its existing ancestors contains a non-OS user symlink.
 */
export function hasUserSymlinkInPath(targetPath) {
  const resolved = path.resolve(targetPath);
  let current = resolved;
  const segments = [];

  while (current !== path.dirname(current)) {
    segments.unshift(current);
    current = path.dirname(current);
  }

  for (const seg of segments) {
    try {
      const stat = fs.lstatSync(seg);
      if (stat.isSymbolicLink()) {
        if (!isOsSystemAlias(seg)) {
          return true;
        }
      }
    } catch {
      // Not yet created segment
    }
  }

  return false;
}

/**
 * Asserts that a path contains no user symlinks anywhere in its existing hierarchy.
 */
export function assertNoUserSymlinks(targetPath, contextLabel = "chemin") {
  if (pathExists(targetPath) && isSymlink(targetPath) && !isOsSystemAlias(targetPath)) {
    throw new Error(`${contextLabel} non sécurisé : est un lien symbolique (${targetPath}).`);
  }

  if (hasUserSymlinkInPath(targetPath)) {
    throw new Error(`${contextLabel} non sécurisé : contient un lien symbolique dans sa hiérarchie (${targetPath}).`);
  }
}

/**
 * Asserts that childPath is strictly confined within parentDir, both lexically and canonically.
 */
export function assertPathConfined(parentDir, childPath, contextLabel = "chemin") {
  const resolvedParent = path.resolve(parentDir);
  const resolvedChild = path.resolve(childPath);

  // 1. Lexical traversal check
  const lexicalRel = path.relative(resolvedParent, resolvedChild);
  if (lexicalRel.startsWith("..") || path.isAbsolute(lexicalRel) || lexicalRel === "") {
    throw new Error(`Tentative d'évasion lexicale détectée pour ${contextLabel} : ${childPath}`);
  }

  // 2. Canonical boundary check
  const canonParent = getCanonicalPath(resolvedParent);
  const canonChild = getCanonicalPath(resolvedChild);
  const canonRel = path.relative(canonParent, canonChild);
  if (canonRel.startsWith("..") || path.isAbsolute(canonRel) || canonRel === "") {
    throw new Error(`Tentative d'évasion canonique détectée pour ${contextLabel} : ${childPath}`);
  }
}

/**
 * Checks if childPath is strictly inside parentDir.
 */
export function isSubPath(parentDir, childPath) {
  try {
    assertPathConfined(parentDir, childPath);
    return true;
  } catch {
    return false;
  }
}
