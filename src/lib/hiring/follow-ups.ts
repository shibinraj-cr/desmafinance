import { istDateString } from "@/lib/lead-pulse-dates";
import { isSilentShortlist } from "./core";
import type { ApplicationRowDTO } from "./candidates";

/**
 * "Who to chase today" (§3.4).
 *
 * Three groups, and the third is the one that earns the rail: a candidate who
 * was shortlisted and then nobody called. That is invisible on a pipeline board
 * — the card sits in the right column looking fine — and it is the most
 * expensive thing a hiring process does to a person.
 */

export type FollowUpGroup = "overdue" | "due_today" | "silent";

export const GROUP_LABELS: Record<FollowUpGroup, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  silent: "Shortlisted but silent",
};

export const GROUP_BLURBS: Record<FollowUpGroup, string> = {
  overdue: "The follow-up date has passed.",
  due_today: "Scheduled for today.",
  silent: "Shortlisted more than two working days ago, and nobody has reached out. Sundays excluded.",
};

export type FollowUpRow = ApplicationRowDTO & { group: FollowUpGroup };

/**
 * Bucket the applications. An application belongs to exactly ONE group, in the
 * order overdue → due today → silent, so the same person is never chased twice
 * from the same screen.
 */
export function bucketFollowUps(
  rows: ApplicationRowDTO[],
  now: Date = new Date(),
): Record<FollowUpGroup, FollowUpRow[]> {
  const today = istDateString(now);
  const out: Record<FollowUpGroup, FollowUpRow[]> = { overdue: [], due_today: [], silent: [] };

  for (const row of rows) {
    // Terminal applications are nobody's follow-up.
    if (row.status !== "active") continue;

    if (row.nextFollowUpAt) {
      const day = istDateString(new Date(row.nextFollowUpAt));
      if (day < today) {
        out.overdue.push({ ...row, group: "overdue" });
        continue;
      }
      if (day === today) {
        out.due_today.push({ ...row, group: "due_today" });
        continue;
      }
      // A follow-up scheduled for later is not today's problem, and having one
      // scheduled is exactly the case the silent check should not re-flag.
      continue;
    }

    if (
      row.stageKind &&
      row.stageName &&
      isSilentShortlist(
        {
          stageKind: row.stageKind,
          stageName: row.stageName,
          stageEnteredAt: new Date(row.stageEnteredAt),
          lastContactedAt: row.lastContactedAt ? new Date(row.lastContactedAt) : null,
        },
        now,
      )
    ) {
      out.silent.push({ ...row, group: "silent" });
    }
  }

  // Within a group, the longest-waiting first — that is the order you want to
  // work down.
  const byWait = (a: FollowUpRow, b: FollowUpRow) =>
    (b.daysSinceContact ?? Number.MAX_SAFE_INTEGER) - (a.daysSinceContact ?? Number.MAX_SAFE_INTEGER);
  out.overdue.sort(byWait);
  out.due_today.sort(byWait);
  out.silent.sort(byWait);

  return out;
}

/** The next action to suggest, in words a person can act on. */
export function suggestedAction(row: FollowUpRow): string {
  if (row.group === "silent") {
    return row.lastContactedAt
      ? "Shortlisted, and quiet since the last message. Call or message them."
      : "Shortlisted and never contacted. Reach out today.";
  }
  if (row.group === "overdue") return "The follow-up you set has passed. Chase, or reschedule it.";
  return "Scheduled for today.";
}

export function countAll(groups: Record<FollowUpGroup, FollowUpRow[]>): number {
  return groups.overdue.length + groups.due_today.length + groups.silent.length;
}
