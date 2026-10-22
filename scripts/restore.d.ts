export interface RestoreOptions {
  backupDir: string;
  targetDir?: string;
  dryRun?: boolean;
  verifyOnly?: boolean;
  force?: boolean;
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
export function performSiteRestore(options: RestoreOptions): RestoreResult;
