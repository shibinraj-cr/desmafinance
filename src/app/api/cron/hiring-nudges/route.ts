import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { nudgesDue } from "@/lib/hiring/interviews";
import { notifyUsers } from "@/lib/hiring/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scorecard nudges (§3.5): panel members whose scorecard is still outstanding
 * are reminded 2h and 24h after the interview ends.
 *
 * Honest about the granularity: Vercel Cron fires on a schedule, so "2h after"
 * means "on the first run at least 2h after". vercel.json lists this path four
 * times across the working day, which puts the real resolution at a few hours.
 * The Interviews rail's "Awaiting scorecards" tab is the always-accurate view;
 * this is the push on top of it.
 *
 * Auth matches the other crons: Bearer CRON_SECRET, or ?key= for a manual run.
 * With CRON_SECRET unset it refuses rather than running anonymously.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — nudges disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Only look back far enough to cover the 24h window plus a missed run.
  const since = new Date(Date.now() - 5 * 86_400_000);
  const interviews = await prisma.hiringInterview.findMany({
    where: { status: "completed", scheduledAt: { gte: since } },
    select: {
      id: true,
      scheduledAt: true,
      durationMin: true,
      status: true,
      nudged2hAt: true,
      nudged24hAt: true,
      panel: true,
      scorecards: { select: { reviewerId: true } },
      application: {
        select: { id: true, candidate: { select: { fullName: true } }, job: { select: { title: true } } },
      },
    },
  });

  const due = nudgesDue(interviews);
  let sent = 0;

  for (const item of due) {
    const interview = interviews.find((i) => i.id === item.interviewId)!;
    try {
      await notifyUsers({
        userIds: item.reviewerIds,
        title: "Scorecard still outstanding",
        body:
          `${interview.application.candidate.fullName} (${interview.application.job.title}) — ` +
          `your scorecard has not been filed${item.window === "24h" ? " and it has been a day" : ""}.`,
        href: `/hiring/interviews?tab=awaiting`,
      });
      await prisma.hiringInterview.update({
        where: { id: item.interviewId },
        data: item.window === "24h" ? { nudged24hAt: new Date() } : { nudged2hAt: new Date() },
      });
      sent++;
    } catch (e) {
      // One bad notification must not stop the rest of the run.
      logger.error("hiring_nudge_failed", {
        interviewId: item.interviewId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  logger.info("hiring_nudges_run", { considered: interviews.length, due: due.length, sent });
  return NextResponse.json({ considered: interviews.length, due: due.length, sent });
}

export const GET = handle;
export const POST = handle;
