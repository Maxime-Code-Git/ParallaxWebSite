export interface BackupManifestFile {
  component: string;
  type: string;
  originalPath: string;
  backupRelPath: string;
  sizeBytes: number;
  sha256: string;
  isSecret?: boolean;
}

export interface BackupManifest {
  manifestVersion?: number;
  backupId: string;
  createdAt: string;
  nodeVersion: string;
  serviceStopped: boolean;
  includeImports: boolean;
  totalFiles: number;
  totalBytes: number;
  files: BackupManifestFile[];
}

export interface BackupOptions {
  dryRun?: boolean;
  serviceStopped?: boolean;
  includeImports?: boolean;
  outDir?: string;
  env?: Record<string, string | undefined>;
  configPath?: string;
}

export interface BackupDryRunResult {
  success: true;
  dryRun: true;
  backupDir: string;
  totalEstimatedBytes: number;
  items: Array<{
    component: string;
    type: string;
    srcPath: string | null;
    destRel?: string;
    status: string;
    sizeBytes: number;
  }>;
}

export interface BackupSuccessResult {
  success: true;
  dryRun: false;
  backupDir: string;
  manifest: BackupManifest;
}

export type BackupResult = BackupDryRunResult | BackupSuccessResult;

export function computeSha256(filePath: string): string;
export function isSubPath(parentDir: string, childPath: string): boolean;
export function copyDirRecursive(
  srcDir: string,
  destDir: string,
  fileList?: Array<{ relPath: string; sizeBytes: number; sha256: string }>,
  baseRel?: string
): void;
export function backupSqliteDatabase(srcPath: string, destPath: string): boolean;
export function performSiteBackup(options?: BackupOptions): BackupResult;
