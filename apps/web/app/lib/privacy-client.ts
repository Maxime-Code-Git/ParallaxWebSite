import type { VideoProvider } from "./privacy-preferences.shared";

let validatedServerPrefs: { youtube: boolean; vimeo: boolean } | null = null;
const inMemoryOneTimeByMedia = new Map<string, boolean>();

// Monotonic generation counter for privacy decisions in the current tab session
let privacyEpoch = 0;

// Tab-local explicit refusal lock: when the user explicitly revokes/refuses in this tab,
// this refusal remains strictly authoritative in the current tab session even if the server
// revocation POST fails (e.g. network error) or an old server cookie is re-read, until the user
// voluntarily grants consent again.
let tabExplicitRefusal = false;

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
  privacyEpoch = 0;
  tabExplicitRefusal = false;
}

export function setClientValidatedPreferences(prefs: { youtube: boolean; vimeo: boolean }): void {
  if (tabExplicitRefusal) {
    validatedServerPrefs = { youtube: false, vimeo: false };
    return;
  }
  validatedServerPrefs = {
    youtube: Boolean(prefs.youtube),
    vimeo: Boolean(prefs.vimeo),
  };
}

export function getClientValidatedPreferences(): { youtube: boolean; vimeo: boolean } | null {
  if (tabExplicitRefusal) {
    return { youtube: false, vimeo: false };
  }
  return validatedServerPrefs ? { ...validatedServerPrefs } : null;
}

export async function fetchValidatedPreferences(): Promise<{ youtube: boolean; vimeo: boolean }> {
  if (typeof window === "undefined") {
    return { youtube: false, vimeo: false };
  }

  const reqEpoch = privacyEpoch;

  try {
    const res = await fetch("/api/privacy/preferences", {
      headers: {
        Accept: "application/json",
      },
    });

    // Check if a newer decision or revocation occurred while this GET was in flight
    if (reqEpoch !== privacyEpoch) {
      return validatedServerPrefs ? { ...validatedServerPrefs } : { youtube: false, vimeo: false };
    }

    if (res.ok) {
      const data = (await res.json()) as {
        ok: boolean;
        preferences: { youtube: boolean; vimeo: boolean };
      };
      if (data && data.ok && data.preferences) {
        if (tabExplicitRefusal) {
          // Tab refusal takes precedence over any older or un-cleared server cookie
          return { youtube: false, vimeo: false };
        }
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

  if (tabExplicitRefusal) {
    return { youtube: false, vimeo: false };
  }
  return validatedServerPrefs ? { ...validatedServerPrefs } : { youtube: false, vimeo: false };
}

export function hasProviderConsent(provider: VideoProvider, mediaUrl?: string): boolean {
  if (mediaUrl && inMemoryOneTimeByMedia.get(mediaUrl) === true) {
    return true;
  }
  if (tabExplicitRefusal) {
    return false;
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

  // New user decision advances generation
  privacyEpoch += 1;
  const reqEpoch = privacyEpoch;

  if (prefs.youtube === true || prefs.vimeo === true) {
    tabExplicitRefusal = false;
  }

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
        Accept: "application/json",
      },
      body: JSON.stringify(updated),
    });

    // Discard response if another action happened while this POST was in flight
    if (reqEpoch !== privacyEpoch) {
      return false;
    }

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
  // Advance generation to immediately obsolete any in-flight GET or save POST
  privacyEpoch += 1;
  const reqEpoch = privacyEpoch;

  // Enforce local refusal immediately in this tab
  tabExplicitRefusal = true;
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
        Accept: "application/json",
      },
      body: JSON.stringify({ action: "revoke_all" }),
    });

    if (reqEpoch !== privacyEpoch) {
      return false;
    }
    return res.ok;
  } catch {
    // Even on network failure, tabExplicitRefusal remains true in this tab
    return false;
  }
}
