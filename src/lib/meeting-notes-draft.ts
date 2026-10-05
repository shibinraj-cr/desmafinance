/**
 * Autosaved meeting-note drafts.
 *
 * Kept in the browser's localStorage, keyed per meeting ("new" for one not yet
 * saved), so a closed drawer, a refresh or a crashed tab never loses what was
 * typed. Deliberately not written to the server: a half-typed meeting would
 * otherwise appear in every admin's shared list before its author pressed Save.
 *
 * Storage can be missing or throw (private window, blocked site data), so every
 * access is guarded and a failure just means no autosave — never a broken page.
 */

export type StoredDraft<T> = {
  draft: T;
  /** ISO time of the last autosave. */
  savedAt: string;
  /** The meeting's updatedAt when editing began; null for a new meeting. */
  base: string | null;
};

const PREFIX = "desgro:meeting-draft:";

export function draftKey(meetingId: string | null): string {
  return PREFIX + (meetingId ?? "new");
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft<T>(meetingId: string | null, store: Storage | null = storage()): StoredDraft<T> | null {
  try {
    const raw = store?.getItem(draftKey(meetingId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed !== "object" || !parsed.draft || typeof parsed.savedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Returns the saved time, or null if the browser would not store it. */
export function writeDraft<T>(
  meetingId: string | null,
  draft: T,
  base: string | null,
  store: Storage | null = storage(),
  now: Date = new Date(),
): string | null {
  try {
    if (!store) return null;
    const savedAt = now.toISOString();
    store.setItem(draftKey(meetingId), JSON.stringify({ draft, savedAt, base } satisfies StoredDraft<T>));
    return savedAt;
  } catch {
    return null;
  }
}

export function clearDraft(meetingId: string | null, store: Storage | null = storage()): void {
  try {
    store?.removeItem(draftKey(meetingId));
  } catch {
    // Nothing to do — a draft that can't be cleared is just restored next time.
  }
}

/**
 * True when a draft for an existing meeting was started from an older copy
 * than the one now on the server, so saving it would overwrite newer edits.
 */
export function isStale(stored: Pick<StoredDraft<unknown>, "base">, currentUpdatedAt: string): boolean {
  return stored.base !== null && stored.base !== currentUpdatedAt;
}

/** Every meeting id with a draft in this browser ("new" for the unsaved one). */
export function listDraftIds(store: Storage | null = storage()): Set<string> {
  const ids = new Set<string>();
  try {
    if (!store) return ids;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) ids.add(key.slice(PREFIX.length));
    }
  } catch {
    // Unreadable storage simply means no drafts to show.
  }
  return ids;
}
