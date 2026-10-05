import { z } from "zod";

/**
 * Executive Meeting Notes — shapes and pure rules. No Prisma import, so the
 * client bundle and the tests can share it with the API routes.
 */

export const MEETING_KINDS = ["leadership", "review", "board", "one_on_one", "client", "other"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export const MEETING_KIND_LABEL: Record<MeetingKind, string> = {
  leadership: "Leadership",
  review: "Review",
  board: "Board",
  one_on_one: "1:1",
  client: "Client / Partner",
  other: "Other",
};

export function meetingKindLabel(kind: string): string {
  return MEETING_KIND_LABEL[kind as MeetingKind] ?? "Other";
}

export type MeetingActionRow = {
  id: string;
  text: string;
  /** Free-text owner (someone without a login). */
  owner: string | null;
  /** Linked owner login — gets the reminder pop-up and can update the item. */
  ownerUserId: string | null;
  ownerName: string | null;
  /** YYYY-MM-DD */
  dueOn: string | null;
  done: boolean;
};

export type MeetingRow = {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  meetingOn: string;
  kind: string;
  attendees: string | null;
  agenda: string | null;
  notes: string | null;
  decisions: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
  actions: MeetingActionRow[];
  /** Users this meeting is shared with (read-only, under My Workspace). */
  sharedWith: ShareUser[];
};

export type ShareUser = { id: string; username: string };

// ── Request shapes ──────────────────────────────────────────────────────────

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const longText = z.string().trim().max(20000).nullable().optional();

export const ActionInputSchema = z.object({
  /** Present for an existing item; absent for one added in this edit. */
  id: z.string().min(1).optional(),
  text: z.string().trim().min(1, "An action item needs some text").max(500),
  owner: z.string().trim().max(120).nullable().optional(),
  ownerUserId: z.string().min(1).max(64).nullable().optional(),
  dueOn: DATE.nullable().optional(),
  done: z.boolean().default(false),
});
export type ActionInput = z.infer<typeof ActionInputSchema>;

export const MeetingInputSchema = z.object({
  title: z.string().trim().min(1, "Give the meeting a title").max(200),
  meetingOn: DATE,
  kind: z.enum(MEETING_KINDS).default("leadership"),
  attendees: z.string().trim().max(1000).nullable().optional(),
  agenda: longText,
  notes: longText,
  decisions: longText,
  /** The full list after this edit — items left out are removed. */
  actions: z.array(ActionInputSchema).max(100).default([]),
  /** User ids to share with — the full list; anyone left out loses access. */
  sharedWith: z.array(z.string().min(1).max(64)).max(200).default([]),
});
export type MeetingInput = z.infer<typeof MeetingInputSchema>;

export const ActionToggleSchema = z.object({ done: z.boolean() });

/** What an action item's owner can do from the reminder or My Workspace. */
export const OwnerActionUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("done") }),
  z.object({ action: z.literal("reopen") }),
  /** Not today — ask again tomorrow. */
  z.object({ action: z.literal("snooze") }),
  /** A new due date; the reminder moves with it. */
  z.object({ action: z.literal("reschedule"), dueOn: DATE }),
]);
export type OwnerActionUpdate = z.infer<typeof OwnerActionUpdateSchema>;

/** Who to show as the owner: the login's name, else the free text. */
export function ownerLabel(a: Pick<MeetingActionRow, "owner" | "ownerName">): string | null {
  return a.ownerName ?? a.owner ?? null;
}

/** Blank strings mean "nothing", so an emptied textarea clears the column. */
export function blankToNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// ── Rules ───────────────────────────────────────────────────────────────────

export type ActionState = "done" | "overdue" | "due_today" | "open";

/** Where an action item stands on `today` (IST, YYYY-MM-DD). */
export function actionState(a: Pick<MeetingActionRow, "done" | "dueOn">, today: string): ActionState {
  if (a.done) return "done";
  if (!a.dueOn) return "open";
  if (a.dueOn < today) return "overdue";
  if (a.dueOn === today) return "due_today";
  return "open";
}

/**
 * Whether the owner's reminder pop-up should show this item on `today` (IST):
 * still open, due today or earlier, and not snoozed past today. An overdue item
 * keeps reminding every day until it is done, rescheduled or snoozed.
 */
export function isReminderDue(
  a: { done: boolean; dueOn: string | null; snoozedUntil: string | null },
  today: string,
): boolean {
  if (a.done || !a.dueOn || a.dueOn > today) return false;
  return !a.snoozedUntil || a.snoozedUntil <= today;
}

/**
 * Open items across meetings, most urgent first: overdue (oldest first), then
 * due dates ascending, then undated ones last.
 */
export function openActions(
  meetings: MeetingRow[],
  today: string,
): Array<MeetingActionRow & { meetingId: string; meetingTitle: string; state: ActionState }> {
  const rows = meetings.flatMap((m) =>
    m.actions
      .filter((a) => !a.done)
      .map((a) => ({ ...a, meetingId: m.id, meetingTitle: m.title, state: actionState(a, today) })),
  );
  return rows.sort((x, y) => {
    if (x.dueOn && y.dueOn) return x.dueOn.localeCompare(y.dueOn);
    if (x.dueOn) return -1;
    if (y.dueOn) return 1;
    return 0;
  });
}

/** Case-insensitive match over every text field a person might remember. */
export function meetingMatches(m: MeetingRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    m.title,
    m.attendees,
    m.agenda,
    m.notes,
    m.decisions,
    ...m.actions.flatMap((a) => [a.text, a.owner, a.ownerName]),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
