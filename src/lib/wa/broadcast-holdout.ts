/**
 * Did the campaign change anything? Replies and "stage moved" measure attention,
 * not enrolments — a candidate who would have enrolled anyway still replies. The
 * control group (WaBroadcast.holdoutPct) answers it: the share of SENT leads
 * that enrolled within the window, against the share of HELD-BACK leads that
 * did, from the same frozen audience.
 */
import { prisma } from "../prisma";

export const HOLDOUT_WINDOW_DAYS = 30;
/** Below this many leads in either group the difference is noise, and the page says so. */
export const HOLDOUT_MIN_GROUP = 30;

export type HoldoutComparison = {
  windowDays: number;
  /** ISO — the window opens when the campaign started sending. */
  from: string;
  to: string;
  sent: { leads: number; enrolled: number };
  holdout: { leads: number; enrolled: number };
  /** Percentage-point difference in enrolment rate, sent minus held back; null if either group is empty. */
  liftPts: number | null;
  /** True when both groups are big enough to read the difference at all. */
  readable: boolean;
};

export function enrolmentLift(
  sent: { leads: number; enrolled: number },
  holdout: { leads: number; enrolled: number },
): number | null {
  if (sent.leads === 0 || holdout.leads === 0) return null;
  const pts = (sent.enrolled / sent.leads - holdout.enrolled / holdout.leads) * 100;
  return Math.round(pts * 10) / 10;
}

export async function holdoutComparison(broadcastId: string): Promise<HoldoutComparison | null> {
  const b = await prisma.waBroadcast.findUnique({
    where: { id: broadcastId },
    select: { holdoutPct: true, startedAt: true, createdAt: true },
  });
  if (!b || b.holdoutPct <= 0) return null;
  const from = b.startedAt ?? b.createdAt;
  const to = new Date(from.getTime() + HOLDOUT_WINDOW_DAYS * 86_400_000);

  const sentWhere = { waBroadcastRecipients: { some: { broadcastId, status: "sent" } } };
  const holdWhere = { waBroadcastRecipients: { some: { broadcastId, skipReason: "holdout" } } };
  const enrolledInWindow = { pipeline: { status: "closed_won", closedDate: { gte: from, lte: to } } };

  const [sentLeads, sentEnrolled, holdLeads, holdEnrolled] = await Promise.all([
    prisma.lead.count({ where: sentWhere }),
    prisma.lead.count({ where: { ...sentWhere, ...enrolledInWindow } }),
    prisma.lead.count({ where: holdWhere }),
    prisma.lead.count({ where: { ...holdWhere, ...enrolledInWindow } }),
  ]);
  const sent = { leads: sentLeads, enrolled: sentEnrolled };
  const holdout = { leads: holdLeads, enrolled: holdEnrolled };
  return {
    windowDays: HOLDOUT_WINDOW_DAYS,
    from: from.toISOString(),
    to: to.toISOString(),
    sent,
    holdout,
    liftPts: enrolmentLift(sent, holdout),
    readable: sentLeads >= HOLDOUT_MIN_GROUP && holdLeads >= HOLDOUT_MIN_GROUP,
  };
}
