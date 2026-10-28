"use client";

/**
 * One poll for every CRM pop-up. Each reminder (the uncontacted-lead alarm, the
 * quality-rating reminder) subscribes to its part; the feed fetches all
 * subscribed parts together from /api/crm/attention once a minute while the tab
 * is visible, and on return to the tab. Each pop-up keeps its own cadence for
 * re-opening — only the fetching is shared.
 */
export type AttentionPart = "uncontacted" | "quality";
type Listener = (data: unknown) => void;

const POLL_MS = 60_000;
const listeners = new Map<AttentionPart, Set<Listener>>();
let timer: number | null = null;
let pending: number | null = null;

async function tick(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  const parts = Array.from(listeners.entries())
    .filter(([, set]) => set.size > 0)
    .map(([part]) => part);
  if (parts.length === 0) return;
  try {
    const res = await fetch(`/api/crm/attention?parts=${parts.join(",")}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as Partial<Record<AttentionPart, unknown>>;
    for (const part of parts) {
      if (part in data) listeners.get(part)?.forEach((fn) => fn(data[part]));
    }
  } catch {
    /* offline or a deploy in progress — try again next tick */
  }
}

/** Coalesce: several pop-ups mounting together cost one request. */
function soon(): void {
  if (pending !== null) return;
  pending = window.setTimeout(() => {
    pending = null;
    void tick();
  }, 50);
}

function onVisible(): void {
  if (document.visibilityState === "visible") soon();
}

/** Receive this part's data on every poll. Returns the unsubscribe. */
export function subscribeAttention(part: AttentionPart, fn: Listener): () => void {
  const set = listeners.get(part) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(part, set);
  if (timer === null) {
    timer = window.setInterval(() => void tick(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  soon();
  return () => {
    set.delete(fn);
    const empty = Array.from(listeners.values()).every((s) => s.size === 0);
    if (empty && timer !== null) {
      window.clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}
