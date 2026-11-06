export interface SocialProfileUrls {
  instagramUrl?: string;
  youtubeUrl?: string;
}

function getProfileUrl(value: string | undefined, host: string, shortHost?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password && !url.port &&
      (url.hostname === host || url.hostname.endsWith(`.${host}`) || url.hostname === shortHost)
    ) {
      return url.href;
    }
  } catch {
    // Blank or invalid URLs are not public links.
  }
  return undefined;
}

export function getParallaxSocialProfiles(socials: SocialProfileUrls) {
  return {
    instagramUrl: getProfileUrl(socials.instagramUrl, "instagram.com"),
    youtubeUrl: getProfileUrl(socials.youtubeUrl, "youtube.com", "youtu.be"),
  };
}
