export type VideoProvider = "youtube" | "vimeo";

export interface ParsedVideo {
  provider: VideoProvider;
  videoId: string;
}

/**
 * Strict parser for YouTube and Vimeo URLs.
 * Rejects arbitrary URLs, non-HTTPS protocols, credentials, and invalid formats.
 */
export function parseVideoUrl(url: string | null | undefined): ParsedVideo | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;

    const host = u.hostname.toLowerCase();

    const isYouTube =
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be";

    if (isYouTube) {
      let videoId = "";
      if (host === "youtu.be") {
        videoId = u.pathname.slice(1);
      } else if (u.pathname === "/watch") {
        videoId = u.searchParams.get("v") || "";
      } else if (u.pathname.startsWith("/shorts/")) {
        videoId = u.pathname.slice(8);
      } else if (u.pathname.startsWith("/embed/")) {
        videoId = u.pathname.slice(7);
      }
      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return { provider: "youtube", videoId };
      }
      return null;
    }

    const isVimeo =
      host === "vimeo.com" ||
      host === "www.vimeo.com" ||
      host === "player.vimeo.com";

    if (isVimeo) {
      const match = u.pathname.match(/^\/(?:video\/)?(\d+)$/);
      if (match) {
        const videoId = match[1];
        if (/^\d{5,15}$/.test(videoId)) {
          return { provider: "vimeo", videoId };
        }
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export function getCanonicalVideoUrl(video: ParsedVideo | null | undefined): string {
  if (!video) return "";
  if (video.provider === "youtube") {
    return `https://www.youtube.com/watch?v=${video.videoId}`;
  }
  if (video.provider === "vimeo") {
    return `https://vimeo.com/${video.videoId}`;
  }
  return "";
}

export function getEmbedVideoUrl(video: ParsedVideo | null | undefined): string {
  if (!video) return "";
  if (video.provider === "youtube") {
    return `https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1`;
  }
  if (video.provider === "vimeo") {
    return `https://player.vimeo.com/video/${video.videoId}?autoplay=1`;
  }
  return "";
}
