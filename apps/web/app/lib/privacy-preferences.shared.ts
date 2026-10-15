export interface PrivacyPreferences {
  youtube: boolean;
  vimeo: boolean;
  version: number;
  updatedAt: number;
}

export const DEFAULT_PRIVACY_PREFERENCES: PrivacyPreferences = {
  youtube: false,
  vimeo: false,
  version: 1,
  updatedAt: 0,
};

export const PRIVACY_POLICY_VERSION = 1;
export const PRIVACY_COOKIE_NAME = "__parallax_privacy_prefs";
export const PRIVACY_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // 180 days (~6 months)

export type VideoProvider = "youtube" | "vimeo";

export function detectVideoProvider(url: string | null | undefined): VideoProvider | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be"
    ) {
      return "youtube";
    }
    if (
      host === "vimeo.com" ||
      host === "www.vimeo.com" ||
      host === "player.vimeo.com"
    ) {
      return "vimeo";
    }
  } catch {
    return null;
  }
  return null;
}
