export interface AdaptationResult {
  success: boolean;
  changed?: boolean;
  reason?: string;
  error?: unknown;
  backupName?: string;
  newRevision?: string;
  serverRevision?: string;
}

export function adaptPortfolioContent(
  targetPath?: string,
  expectedRevision?: string
): AdaptationResult;

export function adaptSiteContentDrafts(
  targetPath?: string,
  expectedRevision?: string
): AdaptationResult;

export function runAdaptTypography(): void;
