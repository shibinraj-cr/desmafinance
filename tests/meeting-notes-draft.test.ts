import { describe, expect, it } from "vitest";
import { clearDraft, draftKey, isStale, listDraftIds, readDraft, writeDraft } from "@/lib/meeting-notes-draft";

/** Minimal in-memory Storage. */
function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const throwing: Storage = {
  length: 0,
  key: () => null,
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
  clear: () => undefined,
};

describe("meeting note drafts", () => {
  it("round-trips a draft per meeting and lists them", () => {
    const store = memStore();
    const now = new Date("2026-10-05T09:00:00.000Z");
    expect(writeDraft(null, { title: "New one" }, null, store, now)).toBe(now.toISOString());
    writeDraft("m1", { title: "Edited" }, "2026-10-01T10:00:00.000Z", store, now);

    expect(readDraft<{ title: string }>(null, store)?.draft.title).toBe("New one");
    expect(readDraft<{ title: string }>("m1", store)).toMatchObject({
      draft: { title: "Edited" },
      base: "2026-10-01T10:00:00.000Z",
    });
    expect(listDraftIds(store)).toEqual(new Set(["new", "m1"]));

    clearDraft(null, store);
    expect(readDraft(null, store)).toBeNull();
    expect(listDraftIds(store)).toEqual(new Set(["m1"]));
  });

  it("ignores garbage and unrelated keys", () => {
    const store = memStore();
    store.setItem(draftKey("bad"), "{not json");
    store.setItem(draftKey("empty"), JSON.stringify({ savedAt: "x" }));
    store.setItem("other-app", "1");
    expect(readDraft("bad", store)).toBeNull();
    expect(readDraft("empty", store)).toBeNull();
    expect(listDraftIds(store)).toEqual(new Set(["bad", "empty"]));
  });

  it("never throws when storage is blocked or missing", () => {
    expect(writeDraft(null, { a: 1 }, null, throwing)).toBeNull();
    expect(readDraft(null, throwing)).toBeNull();
    expect(() => clearDraft(null, throwing)).not.toThrow();
    expect(writeDraft(null, { a: 1 }, null, null)).toBeNull();
    expect(listDraftIds(null).size).toBe(0);
  });

  it("flags a draft started from an older copy of the meeting", () => {
    expect(isStale({ base: "t1" }, "t1")).toBe(false);
    expect(isStale({ base: "t1" }, "t2")).toBe(true);
    expect(isStale({ base: null }, "t2")).toBe(false);
  });
});
