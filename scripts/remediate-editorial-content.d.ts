export interface RemediationResult {
  success: boolean;
  changed?: boolean;
  dryRun?: boolean;
  reason?: string;
  error?: unknown;
  backupName?: string;
  newRevision?: string;
  serverRevision?: string;
  modifiedFields?: string[];
}

export interface RemediationOptions {
  targetPath?: string;
  dryRun?: boolean;
  expectedRevision?: string;
}

export function remediateSiteContentEditorial(
  options?: RemediationOptions
): RemediationResult;

export function runRemediateEditorial(): void;
