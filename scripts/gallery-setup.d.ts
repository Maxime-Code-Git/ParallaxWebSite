export interface SetupGalleryEnvironmentOptions {
  monorepoRoot?: string;
  envPath?: string;
  dataDir?: string;
  homeDir?: string;
  dryRun?: boolean;
  log?: boolean;
}

export interface ConfiguredKeyItem {
  key: string;
  status: "preserve" | "created";
}

export interface SetupGalleryEnvironmentResult {
  success: boolean;
  envPath: string;
  dataDir: string;
  configuredKeys: ConfiguredKeyItem[];
  updatesCount: number;
}

export function setupGalleryEnvironment(
  options?: SetupGalleryEnvironmentOptions
): SetupGalleryEnvironmentResult;
