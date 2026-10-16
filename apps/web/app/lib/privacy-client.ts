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

// Sequential queue for mutation network requests to guarantee that Set-Cookie headers
// arrive and are processed in exact chronological order without race conditions.
let mutationFetchQueue: Promise<unknown> = Promise.resolve();

export type PersistStatus = "success" | "stale" | "error";

export interface PersistResult {
  ok: boolean;
  status: PersistStatus;
}

export function getPrivacyEpoch(): number {
  return privacyEpoch;
}

export function isTabExplicitRefusal(): boolean {
  return tabExplicitRefusal;
}

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
  mutationFetchQueue = Promise.resolve();
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

    // Boundary 1: Check after fetch()
    if (reqEpoch !== privacyEpoch || tabExplicitRefusal) {
      return validatedServerPrefs ? { ...validatedServerPrefs } : { youtube: false, vimeo: false };
    }

    if (res.ok) {
      const data = (await res.json()) as {
        ok: boolean;
        preferences: { youtube: boolean; vimeo: boolean };
      };

      // Boundary 2: Check after res.json()
      if (reqEpoch !== privacyEpoch || tabExplicitRefusal) {
        return validatedServerPrefs ? { ...validatedServerPrefs } : { youtube: false, vimeo: false };
      }

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

export async function persistProviderPreferencesDetailed(prefs: {
  youtube?: boolean;
  vimeo?: boolean;
}): Promise<PersistResult> {
  if (typeof window === "undefined") return { ok: false, status: "error" };

  // New user decision advances generation
  privacyEpoch += 1;
  const reqEpoch = privacyEpoch;

  if (prefs.youtube === true || prefs.vimeo === true) {
    tabExplicitRefusal = false;
  }

  const current = validatedServerPrefs || { youtube: false, vimeo: false };
  const updated = {
    youtube: prefs.youtube !== undefined ? prefs.youtube : current.youtube,
    vimeo: prefs.vimeo !== undefined ? prefs.vimeo : current.vimeo,
  };

  // Wait for previous in-flight mutation's fetch to complete before sending this one,
  // guaranteeing sequential delivery and deterministic Set-Cookie order.
  const previousFetch = mutationFetchQueue;
  let releaseMyFetch!: () => void;
  const myFetchCompleted = new Promise<void>((resolve) => {
    releaseMyFetch = resolve;
  });
  mutationFetchQueue = myFetchCompleted;

  const executeMutation = async (): Promise<PersistResult> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const waitPrevious = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(resolve, 6000);
      previousFetch.catch(() => {}).then(() => {
        clearTimeout(timeoutHandle);
        resolve();
      });
    });

    try {
      await waitPrevious;
    } catch {
      // Proceed even if previous wait encountered an issue
    }

    // Check if superseded while waiting in queue before fetch
    if (reqEpoch !== privacyEpoch) {
      releaseMyFetch();
      return { ok: false, status: "stale" };
    }

    try {
      let res: Response;
      try {
        res = await fetch("/api/privacy/preferences", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(updated),
        });
      } finally {
        // Release the fetch lock immediately once the HTTP response headers arrive
        // (and browser commits Set-Cookie), or if fetch fails, so the next mutation can fetch.
        releaseMyFetch();
      }

      // Boundary 1: Check after fetch()
      if (reqEpoch !== privacyEpoch) {
        return { ok: false, status: "stale" };
      }

      if (!res.ok) {
        return { ok: false, status: "error" };
      }

      const data = (await res.json()) as {
        ok: boolean;
        preferences?: { youtube: boolean; vimeo: boolean };
      };

      // Boundary 2: Check after res.json()
      if (reqEpoch !== privacyEpoch) {
        return { ok: false, status: "stale" };
      }

      if (data && data.ok) {
        if (tabExplicitRefusal) {
          return { ok: false, status: "stale" };
        }
        validatedServerPrefs = {
          youtube: Boolean(data.preferences?.youtube ?? updated.youtube),
          vimeo: Boolean(data.preferences?.vimeo ?? updated.vimeo),
        };

        window.dispatchEvent(
          new CustomEvent("parallax:privacy-updated", {
            detail: validatedServerPrefs,
          })
        );
        return { ok: true, status: "success" };
      }
      return { ok: false, status: "error" };
    } catch {
      releaseMyFetch();
      if (reqEpoch !== privacyEpoch) {
        return { ok: false, status: "stale" };
      }
      return { ok: false, status: "error" };
    }
  };

  return await executeMutation();
}

export async function persistProviderPreferences(prefs: {
  youtube?: boolean;
  vimeo?: boolean;
}): Promise<boolean> {
  const result = await persistProviderPreferencesDetailed(prefs);
  return result.ok;
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

  const previousFetch = mutationFetchQueue;
  let releaseMyFetch!: () => void;
  const myFetchCompleted = new Promise<void>((resolve) => {
    releaseMyFetch = resolve;
  });
  mutationFetchQueue = myFetchCompleted;

  const executeRevoke = async (): Promise<boolean> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const waitPrevious = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(resolve, 6000);
      previousFetch.catch(() => {}).then(() => {
        clearTimeout(timeoutHandle);
        resolve();
      });
    });

    try {
      await waitPrevious;
    } catch {
      // Proceed even if previous wait encountered an issue
    }

    if (reqEpoch !== privacyEpoch) {
      releaseMyFetch();
      return false;
    }

    try {
      let res: Response;
      try {
        res = await fetch("/api/privacy/preferences", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ action: "revoke_all" }),
        });
      } finally {
        releaseMyFetch();
      }

      // Boundary 1: Check after fetch()
      if (reqEpoch !== privacyEpoch) {
        return false;
      }

      if (res.ok) {
        try {
          await res.json();
        } catch {
          // Ignore json parse error on revoke
        }
        // Boundary 2: Check after body read
        if (reqEpoch !== privacyEpoch) {
          return false;
        }
        return true;
      }
      return false;
    } catch {
      releaseMyFetch();
      return false;
    }
  };

  return await executeRevoke();
}
