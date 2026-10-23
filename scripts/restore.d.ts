export interface RestoreOptions {
  backupDir: string;
  targetDir?: string;
  dryRun?: boolean;
  verifyOnly?: boolean;
  /**
   * @deprecated L'option --force est strictement interdite : la restauration s'effectue exclusivement vers un répertoire cible isolé neuf.
   */
  force?: boolean;
  serviceStopped?: boolean;
}

export interface RestoreVerificationResult {
  path: string;
  type: string;
  valid: boolean;
  error?: string;
  details?: Record<string, unknown>;
  schemaVersion?: number;
}

export interface RestoreResult {
  success: boolean;
  verified?: boolean;
  dryRun?: boolean;
  isIsolated?: boolean;
  targetDir?: string;
  restoredCount?: number;
  totalFiles?: number;
  totalBytes?: number;
  reason?: string;
  errors?: string[];
  plan?: Array<{
    component: string;
    srcBackupPath: string;
    destPath: string;
    sizeBytes: number;
  }>;
  verificationResults?: RestoreVerificationResult[];
}

export function computeSha256(filePath: string): string;
export function isSubPath(parentDir: string, childPath: string): boolean;
export function performSiteRestore(options: RestoreOptions): RestoreResult;
