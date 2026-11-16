/**
 * Rules for the "Log outcome" step after a call (POST /api/crm/leads/[id]/outcome
 * and the lead page's call sheet). Pure, so the sheet and the route agree.
 */

import { fromIstWallClock, istDayKey, istDayKeyFrom } from "@/lib/dates";

/**
 * The New stage's code. Mirrors NEW_LEAD_STATUS_CODE in crm-leads.ts, which is
 * server-only (prisma) and so cannot be imported by the call sheet; a test keeps
 * the two equal.
 */
export const NEW_STAGE_CODE = "not_yet_started";

export const CALL_OUTCOMES = ["connected", "no_answer", "busy", "wrong_number"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  connected: "Connected",
  no_answer: "No answer",
  busy: "Busy",
  wrong_number: "Wrong number",
};

/**
 * Does this call move a New lead to Follow-Up? Only when the candidate was
 * actually reached: an unanswered call is an attempt (it still clears the
 * uncontacted alarm, and it still counts as a contact attempt), not the start of
 * a conversation.
 */
export function outcomeMovesNewLead(outcome: CallOutcome, stageCode: string): boolean {
  return outcome === "connected" && stageCode === NEW_STAGE_CODE;
}

/**
 * Follow-up presets the sheet offers, as a due date from `now`. Days and hours
 * are India wall-clock time, not the browser's: a laptop left on another
 * timezone would otherwise book "tomorrow 10:00" at 10:00 somewhere else.
 */
export function followUpPreset(preset: "later_today" | "tomorrow" | "in_3_days" | "next_week", now: Date): Date {
  const tenAm = (days: number) => fromIstWallClock(`${istDayKeyFrom(now, days)}T10:00`)!;
  switch (preset) {
    case "later_today": {
      // Two hours on, but not past 18:00 — a "later today" that lands at
      // midnight is not one. After 18:00, an hour from now.
      const sixPm = fromIstWallClock(`${istDayKey(now)}T18:00`)!;
      const plusTwo = new Date(now.getTime() + 2 * 3_600_000);
      if (plusTwo.getTime() <= sixPm.getTime()) return plusTwo;
      if (now.getTime() < sixPm.getTime()) return sixPm;
      return new Date(now.getTime() + 3_600_000);
    }
    case "tomorrow":
      return tenAm(1);
    case "in_3_days":
      return tenAm(3);
    case "next_week":
      return tenAm(7);
  }
}

/** The task subject the sheet suggests for a follow-up after this outcome. */
export function suggestedFollowUpSubject(outcome: CallOutcome): string {
  return outcome === "connected" ? "Follow-up call" : "Call again — not reached";
}
