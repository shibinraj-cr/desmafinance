/**
 * Engagement-time tracking — shared, DB-free logic used by both the client
 * heartbeat (src/components/UsageTracker.tsx) and the ingest endpoint
 * (src/app/api/telemetry/activity/route.ts).
 *
 * The design goal is to measure *active* time, not open-tab wall-clock: a tab
 * left open in the background, or a page nobody is touching, must not accrue
 * time. The client credits a tick only when the tab is VISIBLE and there was
 * real interaction (mouse / keyboard / scroll / touch) within USAGE_IDLE_MS.
 * The server re-validates and caps everything the client sends so a bad or
 * hostile client can't inflate the numbers.
 */

import { moduleForPath, activePage, MODULES } from "@/lib/modules";

// --- Tunables --------------------------------------------------------------

/** How often the client evaluates whether to credit active time. */
export const USAGE_TICK_MS = 5_000;
/**
 * No interaction for this long → the user is idle and the clock pauses. This is
 * the knob behind "just keeping it open should not be counted": leave the tab
 * untouched (even in the foreground) for a minute and time stops accruing.
 */
export const USAGE_IDLE_MS = 60_000;
/** How often the client flushes accumulated seconds to the server. */
export const USAGE_FLUSH_MS = 30_000;
/**
 * Hard cap on the credit any single tick can contribute. Guards the sleep/wake
 * case: after the laptop resumes, one tick may report a huge elapsed gap — but
 * if the user genuinely just interacted, the idle check passes, so we still cap
 * the credit to a couple of ticks rather than banking the whole sleep.
 */
export const USAGE_MAX_TICK_CREDIT_MS = USAGE_TICK_MS * 2;
/** Interaction event names the client listens to as "the user is here". */
export const USAGE_INTERACTION_EVENTS = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "wheel",
  "touchstart",
  "click",
] as const;

/** Server-side cap on seconds per item per flush (defence-in-depth vs a bad client). */
export const USAGE_MAX_ITEM_SECONDS = 6 * 60 * 60; // 6h
/** Server-side cap on the number of buckets a single flush may carry. */
export const USAGE_MAX_ITEMS_PER_FLUSH = 60;
/** Longest page string we store (registered hrefs are short; guards unknown paths). */
export const USAGE_MAX_PAGE_LEN = 200;

// --- Path → module/page resolution ----------------------------------------

export type UsageLocation = { moduleId: string; page: string };

const KNOWN_MODULE_IDS: ReadonlySet<string> = new Set(MODULES.map((m) => m.id));

/** True for a module id the registry knows about (else it folds to "unknown"). */
export function isKnownModuleId(id: string): boolean {
  return KNOWN_MODULE_IDS.has(id);
}

/** Trim a raw pathname to something safe to store as a `page` key. */
function normalizePage(pathname: string): string {
  const clean = (pathname.split(/[?#]/)[0] || "/").trim();
  const safe = clean.startsWith("/") ? clean : `/${clean}`;
  return safe.length > USAGE_MAX_PAGE_LEN ? safe.slice(0, USAGE_MAX_PAGE_LEN) : safe;
}

/**
 * Resolve a browser pathname to the module it belongs to and the registered
 * sub-page href (so e.g. every /crm/leads/[id] detail view folds into the
 * "/crm/leads" bucket). Unmatched paths bucket under module "unknown".
 */
export function resolvePathUsage(pathname: string): UsageLocation {
  const mod = moduleForPath(pathname);
  if (!mod) return { moduleId: "unknown", page: normalizePage(pathname) };
  const pg = activePage(mod, pathname);
  return { moduleId: mod.id, page: pg ? pg.href : normalizePage(pathname) };
}

// --- The active-time crediting rule (pure, unit-tested) --------------------

export type TickInput = {
  nowMs: number;
  lastTickMs: number;
  lastInteractionMs: number;
  visible: boolean;
  /** Overrides for tests; default to the module tunables. */
  idleMs?: number;
  maxCreditMs?: number;
};

/**
 * Seconds of active time a single tick should credit — the heart of the "active,
 * not open" rule. Returns 0 when the tab is hidden, when the user has been idle
 * beyond the threshold, or when no wall-clock elapsed. Otherwise returns the
 * elapsed seconds, capped by maxCreditMs so a sleep/wake gap can't bank hours.
 */
export function creditForTick(opts: TickInput): number {
  const idleMs = opts.idleMs ?? USAGE_IDLE_MS;
  const maxCreditMs = opts.maxCreditMs ?? USAGE_MAX_TICK_CREDIT_MS;
  const elapsed = opts.nowMs - opts.lastTickMs;
  if (elapsed <= 0) return 0;
  if (!opts.visible) return 0;
  if (opts.nowMs - opts.lastInteractionMs > idleMs) return 0;
  return Math.min(elapsed, maxCreditMs) / 1000;
}

// --- Server-side ingest validation (pure, unit-tested) ---------------------

export type UsageItem = { moduleId: string; page: string; seconds: number };

/**
 * Validate and clamp the raw payload a client posts to /api/telemetry/activity.
 * Unknown module ids fold to "unknown"; pages are normalized and length-capped;
 * seconds are floored to a positive integer and capped; the item count is
 * bounded. Anything unparseable is dropped rather than throwing, so one bad
 * bucket never discards a whole flush.
 */
export function sanitizeUsageItems(raw: unknown): UsageItem[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : null;
  if (!arr) return [];

  const out: UsageItem[] = [];
  for (const entry of arr) {
    if (out.length >= USAGE_MAX_ITEMS_PER_FLUSH) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const rawSeconds = typeof e.seconds === "number" ? e.seconds : Number(e.seconds);
    if (!Number.isFinite(rawSeconds) || rawSeconds < 1) continue;
    const seconds = Math.min(Math.floor(rawSeconds), USAGE_MAX_ITEM_SECONDS);

    const rawPage = typeof e.page === "string" ? e.page : "";
    if (!rawPage) continue;
    const page = normalizePage(rawPage);

    const rawModule = typeof e.moduleId === "string" ? e.moduleId : "";
    const moduleId = isKnownModuleId(rawModule) ? rawModule : "unknown";

    out.push({ moduleId, page, seconds });
  }
  return out;
}

// --- Formatting ------------------------------------------------------------

/** Active seconds → compact hours label, e.g. 0, "12m", "1.4h", "18h". */
export function formatActiveTime(seconds: number): string {
  if (seconds <= 0) return "0";
  if (seconds < 60) return "<1m";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}

/** Active seconds → hours as a number (for ratios like enrollments/hour). */
export function activeHours(seconds: number): number {
  return seconds / 3600;
}
