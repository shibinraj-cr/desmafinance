// Heartbeat for the lead-spreadsheet webhook — "did the sheet talk to us?",
// recorded separately from "did we create a lead".
//
// The Integrations page used to date each source by its last LeadImportBatch,
// and a batch is only written when a row becomes a NEW lead. So three very
// different situations all rendered as "last sync 2d ago":
//   1. the Apps Script trigger is dead / unauthorised — nothing arrives at all,
//   2. the secret was regenerated here but not in the sheet — every POST 401s,
//   3. everything works and every row was already in the CRM.
// Only (1) and (2) are faults, and neither left a trace anywhere. This records
// every call — accepted, rejected or idle — so the page can say which it is.
//
// Stored as AppSetting rows (one per source, plus one for rejections) rather
// than a new table: it is a few hundred bytes of last-known-state, overwritten
// in place, and a per-source key means two sheets posting at once never race.
import { getSetting, setSetting } from "./app-settings";
import { prisma } from "./prisma";
import { logger } from "./logger";

const PREFIX = "sheet_leads_health:";
const REJECTED_KEY = PREFIX + "__rejected";

export type SheetContact = {
  /** When the webhook last accepted a call for this source. */
  at: string;
  rows: number;
  inserted: number;
  reInquiries: number;
  /** Rows we already had — the healthy no-op that used to look like silence. */
  skipped: number;
  errorRows: number;
  campaign: string | null;
  /**
   * Last time this source checked in with nothing to send. Its presence also
   * means the sheet runs a script new enough to heartbeat, which is what lets
   * `verdictFor` hold it to the tight staleness threshold.
   */
  lastHeartbeatAt?: string | null;
};

export type SheetRejection = {
  at: string;
  /** "invalid_secret" (sheet and CRM disagree) or "not_configured". */
  reason: string;
  /** Consecutive rejections since the last accepted call — a stuck sheet climbs. */
  count: number;
};

/**
 * Record an accepted call. Best-effort: a health write must never be the reason
 * an ingest fails, so everything here is swallowed and logged.
 */
export async function recordSheetContact(
  sourceKey: string,
  c: Omit<SheetContact, "at" | "lastHeartbeatAt">,
  opts: { heartbeat?: boolean } = {},
): Promise<void> {
  const at = new Date().toISOString();
  try {
    const prev = parse<SheetContact>(await getSetting(PREFIX + sourceKey).catch(() => null));
    const next: SheetContact = {
      ...c,
      at,
      // Sticky: once a sheet has heartbeated we keep knowing it can, even on
      // the calls that carry real rows.
      lastHeartbeatAt: opts.heartbeat ? at : (prev?.lastHeartbeatAt ?? null),
    };
    await setSetting(PREFIX + sourceKey, JSON.stringify(next));
    // An accepted call clears the rejection streak — sheet and CRM agree again.
    await prisma.appSetting.deleteMany({ where: { key: REJECTED_KEY } });
  } catch (e) {
    logger.warn("sheet_health_write_failed", { sourceKey, message: e instanceof Error ? e.message : String(e) });
  }
}

/** Record a call we turned away, counting how many in a row. */
export async function recordSheetRejection(reason: string): Promise<void> {
  try {
    const prev = parse<SheetRejection>(await getSetting(REJECTED_KEY).catch(() => null));
    const count = prev && prev.reason === reason ? prev.count + 1 : 1;
    await setSetting(REJECTED_KEY, JSON.stringify({ at: new Date().toISOString(), reason, count } satisfies SheetRejection));
  } catch (e) {
    logger.warn("sheet_health_write_failed", { reason, message: e instanceof Error ? e.message : String(e) });
  }
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type SheetSyncHealth = {
  contacts: Record<string, SheetContact>;
  rejected: SheetRejection | null;
};

/** Everything the Integrations page needs to judge the pipe, in one query. */
export async function readSheetSyncHealth(): Promise<SheetSyncHealth> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { startsWith: PREFIX } },
    select: { key: true, value: true },
  });
  const contacts: Record<string, SheetContact> = {};
  let rejected: SheetRejection | null = null;
  for (const r of rows) {
    if (r.key === REJECTED_KEY) {
      rejected = parse<SheetRejection>(r.value);
      continue;
    }
    const c = parse<SheetContact>(r.value);
    if (c) contacts[r.key.slice(PREFIX.length)] = c;
  }
  return { contacts, rejected };
}

/**
 * A sheet that heartbeats is expected every minute, so a quarter of an hour of
 * silence already means the trigger stopped. A sheet still running a script too
 * old to heartbeat only calls when it has rows, so silence there is only
 * suspicious after most of a working day.
 */
export const STALE_AFTER_MINUTES = 15;
export const STALE_AFTER_MINUTES_NO_HEARTBEAT = 12 * 60;

export type SheetVerdict = "ok" | "idle" | "stale" | "rejected" | "never";

export function verdictFor(p: { contact: SheetContact | null; rejected: SheetRejection | null; now?: Date }): SheetVerdict {
  // A live rejection streak beats everything: the sheet IS talking and we are
  // turning it away, which is the one failure the CRM can diagnose on its own.
  if (p.rejected && p.rejected.count > 0) return "rejected";
  if (!p.contact) return "never";
  const ageMin = ((p.now?.getTime() ?? Date.now()) - new Date(p.contact.at).getTime()) / 60000;
  const limit = p.contact.lastHeartbeatAt ? STALE_AFTER_MINUTES : STALE_AFTER_MINUTES_NO_HEARTBEAT;
  if (ageMin > limit) return "stale";
  return p.contact.inserted > 0 ? "ok" : "idle";
}

/** One line of plain English per source, for the Integrations page. */
export function explainVerdict(v: SheetVerdict, c: SheetContact | null, r: SheetRejection | null): string {
  switch (v) {
    case "rejected":
      return r?.reason === "not_configured"
        ? `The sheet is calling but no webhook secret is set here — ${r.count} call${r.count === 1 ? "" : "s"} turned away.`
        : `The sheet is calling with the WRONG secret — ${r?.count ?? 0} call${r?.count === 1 ? "" : "s"} rejected. Update CRM_WEBHOOK_SECRET in each Apps Script to match the secret above.`;
    case "never":
      return "This sheet has never reached the CRM. Check the Apps Script trigger and its script properties.";
    case "stale":
      return "The sheet has stopped calling. Open the spreadsheet → Extensions → Apps Script → Triggers and check the trigger still exists and is not disabled; its Executions log shows why it stopped.";
    case "idle":
      return "Connected — the sheet is checking in, with no new rows to send.";
    case "ok":
      return "Connected and importing.";
  }
}
