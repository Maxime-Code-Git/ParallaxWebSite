export function isOsSystemAlias(p: string): boolean;
export function pathExists(targetPath: string): boolean;
export function isSymlink(targetPath: string): boolean;
export function getCanonicalPath(targetPath: string): string;
export function hasUserSymlinkInPath(targetPath: string): boolean;
export function assertNoUserSymlinks(targetPath: string, contextLabel?: string): void;
export function assertPathConfined(parentDir: string, childPath: string, contextLabel?: string): void;
export function isSubPath(parentDir: string, childPath: string): boolean;
