/**
 * "Was this lead contacted?" — the rule behind the daily lead report (R1).
 *
 * A lead counts as contacted only when the BDE it is assigned to, after it was
 * assigned to them, has done BOTH halves of one of these pairs:
 *
 *   - a call AND a note, or
 *   - an outbound WhatsApp AND a stage or Status change.
 *
 * One action alone never counts. The note typed in the call sheet (Log call /
 * the after-call sheet on the app) is the note half for that call — it lives on
 * the CALL_LOGGED entry rather than as a separate note, and the BDE wrote it.
 * `firstContactedAt` is the moment the first pair completed, i.e. the later of
 * its two halves.
 *
 * Every half is read from the LeadActivity ledger, which records who did what:
 *   - call:     CALL_LOGGED, or a VOXBAY_CALL the BDE made (or answered)
 *   - note:     NOTE_ADDED (an oversight note is someone else's)
 *   - WhatsApp: WHATSAPP_SENT by a person — automated sends carry no actor
 *   - stage:    STATUS_CHANGED (stage) or SUB_STATUS_CHANGED (Status)
 *
 * Pure: the DB side is crm-contact-data.ts.
 */

export const CONTACT_STATUSES = ["pending", "contacted", "missed", "contacted_late", "reassigned"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** The LeadActivity types that can make up a contact. */
export const CONTACT_ACTIVITY_TYPES = [
  "CALL_LOGGED",
  "VOXBAY_CALL",
  "NOTE_ADDED",
  "WHATSAPP_SENT",
  "STATUS_CHANGED",
  "SUB_STATUS_CHANGED",
] as const;

export type ContactKind = "call" | "note" | "whatsapp" | "stage";

export type ContactEvent = {
  kind: ContactKind;
  actorId: string | null;
  at: Date;
  /** A call logged with a note in the same step — both halves of the first pair at once. */
  withNote?: boolean;
};

/** Which halves the BDE has done so far on this assignment — drives "called, note missing" hints. */
export type ContactHalves = { call: boolean; note: boolean; whatsapp: boolean; stage: boolean };

export type ContactVerdict = {
  status: ContactStatus;
  firstContactedAt: Date | null;
  halves: ContactHalves;
};

export type AssignmentWindow = {
  userId: string;
  assignedAt: Date;
  contactDueAt: Date;
  /** When the lead left this BDE; their actions after it no longer count. */
  endedAt: Date | null;
};

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * One LeadActivity row as a contact event, or null when it can't be part of a
 * contact (wrong type, no person behind it, a Voxbay call nobody answered).
 */
export function activityToContactEvent(row: {
  type: string;
  actorId: string | null;
  occurredAt: Date;
  metadata: unknown;
}): ContactEvent | null {
  if (!row.actorId) return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const base = { actorId: row.actorId, at: row.occurredAt };
  switch (row.type) {
    case "CALL_LOGGED":
      return { ...base, kind: "call", withNote: hasText(meta.note) };
    case "VOXBAY_CALL":
      // Dialling out is an attempt whatever the outcome — like Log call with
      // "No answer". An incoming call only counts once someone picked it up.
      if (meta.direction === "incoming" && meta.outcome !== "answered") return null;
      return { ...base, kind: "call" };
    case "NOTE_ADDED":
      return { ...base, kind: "note" };
    case "WHATSAPP_SENT":
      return { ...base, kind: "whatsapp" };
    case "STATUS_CHANGED":
    case "SUB_STATUS_CHANGED":
      return { ...base, kind: "stage" };
    default:
      return null;
  }
}

function earliest(times: number[]): number | null {
  return times.length ? Math.min(...times) : null;
}

/** When both halves first existed: the later of each half's earliest occurrence. */
function pairCompletedAt(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.max(a, b);
}

/**
 * Judge one assignment against the events on its lead. Only the assigned BDE's
 * own events between `assignedAt` and `endedAt` count.
 *
 *   - contacted        first pair completed at or before the deadline
 *   - contacted_late   completed after the deadline (still a miss for that day)
 *   - missed           nothing complete and the deadline has passed
 *   - reassigned       left this BDE before the deadline, uncontacted — on nobody's record
 *   - pending          nothing complete yet, deadline still ahead
 */
export function evaluateContact(a: AssignmentWindow, events: ContactEvent[], now: Date): ContactVerdict {
  const from = a.assignedAt.getTime();
  const to = a.endedAt ? a.endedAt.getTime() : Infinity;
  const mine = events.filter((e) => e.actorId === a.userId && e.at.getTime() >= from && e.at.getTime() <= to);

  const times = (pred: (e: ContactEvent) => boolean) => mine.filter(pred).map((e) => e.at.getTime());
  const calls = times((e) => e.kind === "call");
  const notes = times((e) => e.kind === "note");
  const callsWithNote = times((e) => e.kind === "call" && !!e.withNote);
  const whatsapps = times((e) => e.kind === "whatsapp");
  const stages = times((e) => e.kind === "stage");

  const completions = [
    earliest(callsWithNote),
    pairCompletedAt(earliest(calls), earliest(notes)),
    pairCompletedAt(earliest(whatsapps), earliest(stages)),
  ].filter((t): t is number => t !== null);
  const first = earliest(completions);

  const halves: ContactHalves = {
    call: calls.length > 0,
    note: notes.length > 0 || callsWithNote.length > 0,
    whatsapp: whatsapps.length > 0,
    stage: stages.length > 0,
  };
  const due = a.contactDueAt.getTime();

  if (first !== null) {
    return { status: first <= due ? "contacted" : "contacted_late", firstContactedAt: new Date(first), halves };
  }
  if (a.endedAt && a.endedAt.getTime() <= due) return { status: "reassigned", firstContactedAt: null, halves };
  return { status: now.getTime() > due ? "missed" : "pending", firstContactedAt: null, halves };
}

// ── Keeping assignment rows in step with Lead (the safety net) ───────────────

export type LeadOwnerState = { assignedToId: string | null; assignedAt: Date | null };
export type AssignmentRowState = { id: string; leadId: string; userId: string; assignedAt: Date; endedAt: Date | null };

export type AssignmentSyncPlan = {
  open: { leadId: string; userId: string; assignedAt: Date }[];
  close: { id: string; endedAt: Date }[];
};

/**
 * What the safety-net pass must change so every lead's current owner has an
 * open assignment row and no row stays open for an owner the lead has left.
 * The assignment code writes these rows itself; this catches any path that
 * changes `Lead.assignedToId` without doing so.
 *
 * `leads` holds the current owner of every lead in scope; `rows` every
 * assignment row for those leads. Only assignments at or after `floor` are
 * opened, so switching tracking on never back-fills old leads.
 */
export function planAssignmentSync(
  leads: Map<string, LeadOwnerState>,
  rows: AssignmentRowState[],
  floor: Date,
  now: Date,
): AssignmentSyncPlan {
  const key = (leadId: string, userId: string, at: Date) => `${leadId}|${userId}|${at.getTime()}`;
  const known = new Set(rows.map((r) => key(r.leadId, r.userId, r.assignedAt)));

  const open: AssignmentSyncPlan["open"] = [];
  for (const [leadId, lead] of leads) {
    if (!lead.assignedToId || !lead.assignedAt || lead.assignedAt.getTime() < floor.getTime()) continue;
    if (!known.has(key(leadId, lead.assignedToId, lead.assignedAt))) {
      open.push({ leadId, userId: lead.assignedToId, assignedAt: lead.assignedAt });
    }
  }

  const close: AssignmentSyncPlan["close"] = [];
  for (const r of rows) {
    if (r.endedAt) continue;
    const lead = leads.get(r.leadId);
    if (!lead) continue;
    const current =
      lead.assignedToId === r.userId && lead.assignedAt?.getTime() === r.assignedAt.getTime();
    if (current) continue;
    // Reassigned: the row ended when the new assignment began. Released: the
    // exact moment isn't on the lead any more, so now is the best bound.
    const endedAt =
      lead.assignedAt && lead.assignedAt.getTime() > r.assignedAt.getTime() ? lead.assignedAt : now;
    close.push({ id: r.id, endedAt });
  }
  return { open, close };
}

/**
 * What is still missing on a half-done lead, in the BDE's words — or null when
 * nothing has been started (then any pair will do). Each pair is judged on its
 * own: a call without a note says "note missing" even if WhatsApp was also sent.
 */
export function contactHint(h: ContactHalves): string | null {
  if (h.call && !h.note) return "called, note missing";
  if (h.whatsapp && !h.stage) return "WhatsApp sent, stage or Status change missing";
  if (h.note && !h.call) return "note added, call missing";
  if (h.stage && !h.whatsapp) return "stage changed, WhatsApp missing";
  return null;
}
