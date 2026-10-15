import type { VideoProvider } from "./privacy-preferences.shared";

let validatedServerPrefs: { youtube: boolean; vimeo: boolean } | null = null;
const inMemoryOneTimeByMedia = new Map<string, boolean>();

export function getClientOneTimeConsent(mediaUrl: string): boolean {
  if (!mediaUrl) return false;
  return Boolean(inMemoryOneTimeByMedia.get(mediaUrl));
}

export function setClientOneTimeConsent(mediaUrlOrProvider: string, granted = true): void {
  if (!mediaUrlOrProvider) return;
  if (granted) {
    inMemoryOneTimeByMedia.set(mediaUrlOrProvider, true);
  } else {
    inMemoryOneTimeByMedia.delete(mediaUrlOrProvider);
    if (mediaUrlOrProvider === "youtube" || mediaUrlOrProvider === "vimeo") {
      for (const key of Array.from(inMemoryOneTimeByMedia.keys())) {
        if (key.includes(mediaUrlOrProvider)) {
          inMemoryOneTimeByMedia.delete(key);
        }
      }
    }
  }
}

export function clearClientOneTimeConsents(): void {
  inMemoryOneTimeByMedia.clear();
}

export function resetClientPrivacyState(): void {
  validatedServerPrefs = null;
  inMemoryOneTimeByMedia.clear();
}

export function setClientValidatedPreferences(prefs: { youtube: boolean; vimeo: boolean }): void {
  validatedServerPrefs = {
    youtube: Boolean(prefs.youtube),
    vimeo: Boolean(prefs.vimeo),
  };
}

export function getClientValidatedPreferences(): { youtube: boolean; vimeo: boolean } | null {
  return validatedServerPrefs ? { ...validatedServerPrefs } : null;
}

export async function fetchValidatedPreferences(): Promise<{ youtube: boolean; vimeo: boolean }> {
  if (typeof window === "undefined") {
    return { youtube: false, vimeo: false };
  }
  try {
    const res = await fetch("/api/privacy/preferences", {
      headers: {
        "Accept": "application/json",
      },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        ok: boolean;
        preferences: { youtube: boolean; vimeo: boolean };
      };
      if (data && data.ok && data.preferences) {
        validatedServerPrefs = {
          youtube: Boolean(data.preferences.youtube),
          vimeo: Boolean(data.preferences.vimeo),
        };
        return { ...validatedServerPrefs };
      }
    }
  } catch {
    // Network or server error
  }
  return { youtube: false, vimeo: false };
}

export function hasProviderConsent(provider: VideoProvider, mediaUrl?: string): boolean {
  if (mediaUrl && inMemoryOneTimeByMedia.get(mediaUrl) === true) {
    return true;
  }
  if (validatedServerPrefs && validatedServerPrefs[provider] === true) {
    return true;
  }
  return false;
}

export async function persistProviderPreferences(prefs: {
  youtube?: boolean;
  vimeo?: boolean;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const current = validatedServerPrefs || { youtube: false, vimeo: false };
    const updated = {
      youtube: prefs.youtube !== undefined ? prefs.youtube : current.youtube,
      vimeo: prefs.vimeo !== undefined ? prefs.vimeo : current.vimeo,
    };

    const res = await fetch("/api/privacy/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(updated),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        ok: boolean;
        preferences?: { youtube: boolean; vimeo: boolean };
      };
      if (data && data.ok) {
        validatedServerPrefs = {
          youtube: Boolean(data.preferences?.youtube ?? updated.youtube),
          vimeo: Boolean(data.preferences?.vimeo ?? updated.vimeo),
        };

        window.dispatchEvent(
          new CustomEvent("parallax:privacy-updated", {
            detail: validatedServerPrefs,
          })
        );
        return true;
      }
    }
  } catch {
    // Network or server issue
  }
  return false;
}

export async function revokeAllProviderConsent(): Promise<boolean> {
  inMemoryOneTimeByMedia.clear();
  validatedServerPrefs = { youtube: false, vimeo: false };

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
        "Accept": "application/json",
      },
      body: JSON.stringify({ action: "revoke_all" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
