// Voxbay call reconciliation — parse a Voxbay incoming-call CSV export and
// reconcile the CALLERS against CRM leads, to surface people who phoned in but
// were never entered as a lead. Pure parse/aggregate/classify logic lives here
// (no DB) so it's unit-testable; the route batches the CRM phone lookups and any
// create writes.
//
// A Voxbay call carries only a phone number (`sourceNumber` = the caller) and a
// timestamp — no email, usually no name. So matching is phone-only, and "in CRM"
// means a lead already exists with that number.
import { normalizePhone, phoneMatchKeys } from "./crm";
import { parseSinceDate } from "./crm-meta-reconcile";

export { parseSinceDate };

// ── CSV parsing (RFC-4180-ish; mirrors the Voxbay upload route) ──────────────

/** Handles quoted fields with embedded commas/newlines and CRLF lines. */
export function parseCsv(input: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // swallow — the following \n closes the row
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/**
 * Parse a Voxbay timestamp ("YYYY-MM-DD HH:mm:ss", no zone) as IST — the
 * business timezone — so the date filter is stable regardless of server TZ.
 */
export function parseVoxbayDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, mi, sec] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec ?? "00"}+05:30`;
    const dt = new Date(iso);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

/** "HH:MM:SS" → seconds. Blank/garbage → 0. */
export function hmsToSeconds(hms: string | null | undefined): number {
  if (!hms) return 0;
  const parts = String(hms).trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return 0;
  const [h = 0, m = 0, s = 0] = parts.length === 3 ? parts : [0, ...parts];
  return h * 3600 + m * 60 + s;
}

// ── Types ─────────────────────────────────────────────────────────────────

/** One parsed incoming-call row (only the fields the reconcile needs). */
export type VoxbayCallRow = {
  rowNumber: number;
  sourceNumber: string;
  phoneE164: string | null;
  callStartTime: string | null; // ISO
  callStatus: string | null;
  /** user_status ("ANSWERED" | "FAILED" | …) — the authoritative answered flag. */
  userStatus: string | null;
  /** True when user_status === ANSWERED, i.e. an agent actually picked up. */
  answered: boolean;
  answeredDurationSec: number;
  /**
   * The agent who ANSWERED the call, from agentName — or null when the call went
   * unanswered. Voxbay only fills agentName on answered calls; last_tried /
   * first_tried name agents who were merely rung and did NOT pick up, so they are
   * never credited as the handler.
   */
  agent: string | null;
  contactName: string | null;
};

/** One unique caller (aggregated across all their calls in the window). */
export type VoxbayCaller = {
  phoneE164: string;
  sourceNumber: string;
  callCount: number;
  connectedCount: number; // calls actually answered by an agent (user_status ANSWERED)
  firstCallAt: string | null;
  lastCallAt: string | null;
  contactName: string | null;
  /** Distinct agents who ANSWERED this caller (empty ⇒ every call was missed). */
  agents: string[];
};

export type VoxbayReconcileBuckets = {
  /** Unique in-window callers with NO matching CRM lead → import candidates. */
  missing: VoxbayCaller[];
  /** Unique in-window callers that already have a matching CRM lead. */
  inCrm: VoxbayCaller[];
};

// ── Parse ────────────────────────────────────────────────────────────────────

const HEADER_KEYS = {
  sourceNumber: "sourceNumber",
  callStartTime: "callStartTime",
  callStatus: "call_status",
  userStatus: "user_status",
  answeredDuration: "answeredDuration",
  agentName: "agentName",
  lastTried: "last_tried_name",
  firstTried: "first_tried_name",
  contactName: "contact_name",
} as const;

/** Parse the Voxbay incoming-call CSV text into normalised call rows. */
export function parseVoxbayCsv(text: string): { rows: VoxbayCallRow[]; header: string[] } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], header: grid[0] ?? [] };
  const header = grid[0].map((h) => h.replace(/^﻿/, "").trim());
  const idx = (name: string) => header.indexOf(name);
  const cSrc = idx(HEADER_KEYS.sourceNumber);
  const cStart = idx(HEADER_KEYS.callStartTime);
  const cStatus = idx(HEADER_KEYS.callStatus);
  const cUserStatus = idx(HEADER_KEYS.userStatus);
  const cAns = idx(HEADER_KEYS.answeredDuration);
  const cAgent = idx(HEADER_KEYS.agentName);
  const cLast = idx(HEADER_KEYS.lastTried);
  const cFirst = idx(HEADER_KEYS.firstTried);
  const cContact = idx(HEADER_KEYS.contactName);

  const rows: VoxbayCallRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    const at = (c: number) => (c < 0 ? "" : (cells[c] ?? "").trim());
    const sourceNumber = at(cSrc);
    const phoneE164 = normalizePhone(sourceNumber);
    const start = parseVoxbayDate(at(cStart));
    const userStatus = at(cUserStatus) || null;
    const answered = (userStatus ?? "").toUpperCase() === "ANSWERED";
    // Credit a handler only when the call was actually answered — agentName is the
    // agent who picked up; last_tried/first_tried are only a defensive fallback and
    // still gated behind `answered` so a merely-rung agent is never the handler.
    const agent = answered ? at(cAgent) || at(cLast) || at(cFirst) || null : null;
    rows.push({
      rowNumber: r + 1,
      sourceNumber,
      phoneE164,
      callStartTime: start ? start.toISOString() : null,
      callStatus: at(cStatus) || null,
      userStatus,
      answered,
      answeredDurationSec: hmsToSeconds(at(cAns)),
      agent,
      contactName: at(cContact) || null,
    });
  }
  return { rows, header };
}

// ── Aggregate ─────────────────────────────────────────────────────────────

export type AggregateResult = {
  callers: VoxbayCaller[];
  /** Call rows dropped because their start time is before the chosen date. */
  beforeSince: number;
  /** Rows with no usable caller number (can't be matched). */
  noNumber: number;
  /** Rows with a number but no parseable date (can't be windowed). */
  undated: number;
};

/**
 * Collapse the call rows into unique callers within the date window. Many calls
 * per number → one caller with a call count, first/last time, and the agents who
 * handled them.
 */
export function aggregateCallers(rows: VoxbayCallRow[], sinceStart: Date): AggregateResult {
  const map = new Map<string, VoxbayCaller>();
  let beforeSince = 0;
  let noNumber = 0;
  let undated = 0;

  for (const row of rows) {
    if (!row.phoneE164) {
      noNumber++;
      continue;
    }
    if (!row.callStartTime) {
      undated++;
      continue;
    }
    if (new Date(row.callStartTime).getTime() < sinceStart.getTime()) {
      beforeSince++;
      continue;
    }
    const existing = map.get(row.phoneE164);
    if (!existing) {
      map.set(row.phoneE164, {
        phoneE164: row.phoneE164,
        sourceNumber: row.sourceNumber,
        callCount: 1,
        connectedCount: row.answered ? 1 : 0,
        firstCallAt: row.callStartTime,
        lastCallAt: row.callStartTime,
        contactName: row.contactName,
        agents: row.agent ? [row.agent] : [],
      });
    } else {
      existing.callCount++;
      if (row.answered) existing.connectedCount++;
      if (row.callStartTime < (existing.firstCallAt ?? row.callStartTime)) existing.firstCallAt = row.callStartTime;
      if (row.callStartTime > (existing.lastCallAt ?? row.callStartTime)) existing.lastCallAt = row.callStartTime;
      if (!existing.contactName && row.contactName) existing.contactName = row.contactName;
      if (row.agent && !existing.agents.includes(row.agent)) existing.agents.push(row.agent);
    }
  }

  return { callers: [...map.values()], beforeSince, noNumber, undated };
}

/** Distinct phone match keys across the aggregated callers (for one batched lookup). */
export function collectCallerPhoneKeys(callers: VoxbayCaller[]): string[] {
  const set = new Set<string>();
  for (const c of callers) for (const k of phoneMatchKeys(c.phoneE164, null)) set.add(k);
  return [...set];
}

/** Split callers into those already in the CRM (by phone) and those missing. */
export function reconcileCallers(callers: VoxbayCaller[], existingPhoneKeys: Set<string>): VoxbayReconcileBuckets {
  const missing: VoxbayCaller[] = [];
  const inCrm: VoxbayCaller[] = [];
  for (const c of callers) {
    const keys = phoneMatchKeys(c.phoneE164, null);
    (keys.some((k) => existingPhoneKeys.has(k)) ? inCrm : missing).push(c);
  }
  return { missing, inCrm };
}

// ── Lead naming & consultant resolution (used by the import route) ──────────

/** Display label shown to whoever handled a caller: the agent(s), or "Missed call". */
export const MISSED_CALL_LABEL = "Missed call";

/** Handler label for a caller — the answering agent(s), or "Missed call" if none answered. */
export function callerHandledByLabel(caller: Pick<VoxbayCaller, "agents">): string {
  return caller.agents.length ? caller.agents.join(", ") : MISSED_CALL_LABEL;
}

/**
 * Timestamp label for a caller's last call, formatted to match the "Last call"
 * column in the reconcile table exactly (so the generated lead name equals the
 * value the operator sees there). Blank ISO → "".
 */
export function voxbayCallLabel(lastCallAtIso: string | null | undefined): string {
  if (!lastCallAtIso) return "";
  return lastCallAtIso.slice(0, 16).replace("T", " ");
}

/**
 * Name for a phone-only Voxbay lead. Uses the caller's contact name when Voxbay
 * captured one; otherwise "Voxbay call <last call>" (see {@link voxbayCallLabel}).
 */
export function voxbayLeadName(
  contactName: string | null | undefined,
  lastCallAtIso: string | null | undefined,
): string {
  const nm = (contactName ?? "").trim();
  if (nm) return nm;
  const label = voxbayCallLabel(lastCallAtIso);
  return label ? `Voxbay call ${label}` : "Voxbay Caller";
}

export type RosterEntry = { userId: string; displayName: string };

/** Trim, lowercase, and collapse internal whitespace for name matching. */
function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve the consultant a Voxbay-created lead should be auto-assigned to, given
 * the distinct agents who ANSWERED that caller. The Voxbay agent name is a first
 * name (e.g. "Sreeshma") and maps to the BDE whose roster displayName is the full
 * name (e.g. "Sreeshma S"). Assignment is deliberately conservative — it returns
 * a consultant ONLY when ownership is unambiguous:
 *   - no answering agent (every call missed) → null (assign later),
 *   - more than one distinct answering agent → null (mixed handlers),
 *   - an agent name matching zero or several BDEs → null.
 */
export function resolveVoxbayAssignee(
  answeringAgents: string[],
  roster: RosterEntry[],
): RosterEntry | null {
  const distinct = [...new Set(answeringAgents.map(normName).filter(Boolean))];
  if (distinct.length !== 1) return null;
  const agent = distinct[0];
  // Exact full-name match wins outright.
  const exact = roster.filter((r) => normName(r.displayName) === agent);
  if (exact.length === 1) return { userId: exact[0].userId, displayName: exact[0].displayName };
  if (exact.length > 1) return null;
  // First-name match: displayName is "<agent> <surname…>".
  const byFirst = roster.filter((r) => {
    const dn = normName(r.displayName);
    return dn === agent || dn.startsWith(agent + " ");
  });
  return byFirst.length === 1 ? { userId: byFirst[0].userId, displayName: byFirst[0].displayName } : null;
}
