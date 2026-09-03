import { prisma } from "@/lib/prisma";
import { verifyCalendarToken, buildIcs } from "@/lib/hiring/interviews";
import { INTERVIEW_KIND_LABELS, type InterviewKind } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/hiring/calendar/[userId]/[token] — a per-user ICS subscription feed.
 *
 * Unauthenticated by necessity: a calendar client subscribes with a URL and
 * cannot carry a session. The token is an HMAC of the user id under
 * NEXTAUTH_SECRET (see calendarToken), verified in constant time, so the URL
 * itself is the credential — which is why the feed carries only the interviews
 * that user is on, and no contact details beyond the candidate's name.
 *
 * Rotating NEXTAUTH_SECRET revokes every feed at once.
 */
export async function GET(
  _req: Request,
  { params }: { params: { userId: string; token: string } },
) {
  if (!verifyCalendarToken(params.userId, params.token)) {
    return new Response("Not found", { status: 404 });
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { username: true, isActive: true },
  });
  if (!user?.isActive) return new Response("Not found", { status: 404 });

  // A window, not everything: a calendar does not need last year's phone screens.
  const from = new Date(Date.now() - 30 * 86_400_000);
  const interviews = await prisma.hiringInterview.findMany({
    where: { panel: { has: params.userId }, scheduledAt: { gte: from } },
    include: {
      application: {
        select: {
          candidate: { select: { fullName: true } },
          job: { select: { title: true } },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });

  const ics = buildIcs(
    interviews.map((i) => ({
      uid: `hiring-${i.id}@desgro.in`,
      start: i.scheduledAt,
      end: new Date(i.scheduledAt.getTime() + i.durationMin * 60_000),
      summary: `${INTERVIEW_KIND_LABELS[i.kind as InterviewKind] ?? i.kind}: ${i.application.candidate.fullName}`,
      description: `${i.application.job.title}\nMode: ${i.mode}${i.locationOrLink ? `\n${i.locationOrLink}` : ""}`,
      location: i.locationOrLink,
      status: i.status,
    })),
    `DESMA interviews — ${user.username}`,
  );

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": 'inline; filename="desma-interviews.ics"',
    },
  });
}
