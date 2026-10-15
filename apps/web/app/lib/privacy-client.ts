import {
  PRIVACY_COOKIE_NAME,
  type VideoProvider,
} from "./privacy-preferences.shared";

let inMemoryOneTime: Record<VideoProvider, boolean> = {
  youtube: false,
  vimeo: false,
};

export function getClientOneTimeConsent(provider: VideoProvider): boolean {
  return Boolean(inMemoryOneTime[provider]);
}

export function setClientOneTimeConsent(provider: VideoProvider, granted = true): void {
  inMemoryOneTime[provider] = granted;
  if (!granted && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("parallax:privacy-updated", {
        detail: { provider, granted: false },
      })
    );
  }
}

export function parseClientPrivacyCookie(): { youtube: boolean; vimeo: boolean } {
  if (typeof document === "undefined") {
    return { youtube: false, vimeo: false };
  }
  const cookies = document.cookie || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${PRIVACY_COOKIE_NAME}=([^;]+)`));
  if (!match) {
    return { youtube: false, vimeo: false };
  }
  const parts = match[1].split(".");
  if (parts.length !== 5) {
    return { youtube: false, vimeo: false };
  }
  const [, ytStr, vimStr] = parts;
  return {
    youtube: ytStr === "1",
    vimeo: vimStr === "1",
  };
}

export function hasProviderConsent(provider: VideoProvider): boolean {
  if (getClientOneTimeConsent(provider)) {
    return true;
  }
  const persistent = parseClientPrivacyCookie();
  return Boolean(persistent[provider]);
}

export async function persistProviderPreferences(prefs: {
  youtube?: boolean;
  vimeo?: boolean;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const current = parseClientPrivacyCookie();
    const updated = {
      youtube: prefs.youtube !== undefined ? prefs.youtube : current.youtube,
      vimeo: prefs.vimeo !== undefined ? prefs.vimeo : current.vimeo,
    };

    const res = await fetch("/api/privacy/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updated),
    });

    if (res.ok) {
      if (prefs.youtube) inMemoryOneTime.youtube = true;
      if (prefs.vimeo) inMemoryOneTime.vimeo = true;
      if (prefs.youtube === false) inMemoryOneTime.youtube = false;
      if (prefs.vimeo === false) inMemoryOneTime.vimeo = false;

      window.dispatchEvent(
        new CustomEvent("parallax:privacy-updated", {
          detail: updated,
        })
      );
      return true;
    }
  } catch {
    // Network or server issue
  }
  return false;
}

export async function revokeAllProviderConsent(): Promise<boolean> {
  inMemoryOneTime = { youtube: false, vimeo: false };
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("parallax:privacy-updated", {
        detail: { youtube: false, vimeo: false },
      })
    );
  }
  try {
    const res = await fetch("/api/privacy/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "revoke_all" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
