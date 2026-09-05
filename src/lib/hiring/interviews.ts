import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { INTERVIEW_KIND_LABELS, type InterviewKind } from "./constants";

/**
 * Interviews: scheduling, the awaiting-scorecard queue, the nudge window, and
 * the per-user calendar feed.
 */

export const interviewInclude = {
  application: {
    select: {
      id: true,
      candidate: { select: { id: true, fullName: true, email: true, phone: true } },
      job: { select: { id: true, title: true, department: true } },
      stage: { select: { name: true } },
    },
  },
  scorecards: { select: { id: true, reviewerId: true, overall: true, submittedAt: true } },
} satisfies Prisma.HiringInterviewInclude;

type InterviewRow = Prisma.HiringInterviewGetPayload<{ include: typeof interviewInclude }>;

export type InterviewRowDTO = ReturnType<typeof serializeInterview>;

export function serializeInterview(i: InterviewRow, now: Date = new Date()) {
  const endsAt = new Date(i.scheduledAt.getTime() + i.durationMin * 60_000);
  return {
    id: i.id,
    applicationId: i.application.id,
    candidateId: i.application.candidate.id,
    candidateName: i.application.candidate.fullName,
    candidateEmail: i.application.candidate.email,
    jobId: i.application.job.id,
    jobTitle: i.application.job.title,
    department: i.application.job.department,
    stageName: i.application.stage?.name ?? null,
    kind: i.kind,
    kindLabel: INTERVIEW_KIND_LABELS[i.kind as InterviewKind] ?? i.kind,
    scheduledAt: i.scheduledAt.toISOString(),
    endsAt: endsAt.toISOString(),
    durationMin: i.durationMin,
    mode: i.mode,
    locationOrLink: i.locationOrLink,
    status: i.status,
    panel: i.panel,
    hasPrepPacket: !!i.prepPacketMd,
    hasRecording: !!i.recordingUrl,
    hasTranscript: !!i.transcriptText,
    scorecardCount: i.scorecards.length,
    /** Panel members who have not filed a scorecard yet. */
    missingReviewers: i.panel.filter((p) => !i.scorecards.some((s) => s.reviewerId === p)),
    isPast: endsAt.getTime() < now.getTime(),
    /**
     * §3.5: a COMPLETED interview with no submitted scorecard is "awaiting
     * scores". Deliberately keyed on status, not on the clock — an interview
     * that ran late is not overdue, and one that was cancelled is not awaited.
     */
    awaitingScores: i.status === "completed" && i.scorecards.length === 0,
  };
}

export type InterviewKpis = {
  today: number;
  scheduled: number;
  awaitingScores: number;
  scored: number;
  avgScore: number | null;
};

/** Start and end of the IST day containing `now`, as UTC instants. */
export function istDayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const istNow = new Date(now.getTime() + 5.5 * 3_600_000);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  const startIst = Date.UTC(y, m, d, 0, 0, 0);
  return {
    start: new Date(startIst - 5.5 * 3_600_000),
    end: new Date(startIst + 24 * 3_600_000 - 5.5 * 3_600_000),
  };
}

export async function computeInterviewKpis(now: Date = new Date()): Promise<InterviewKpis> {
  const { start, end } = istDayBounds(now);

  const [today, scheduled, completedWithout, scored, verdicts] = await Promise.all([
    prisma.hiringInterview.count({
      where: { scheduledAt: { gte: start, lt: end }, status: { in: ["scheduled", "completed"] } },
    }),
    prisma.hiringInterview.count({ where: { status: "scheduled" } }),
    prisma.hiringInterview.count({ where: { status: "completed", scorecards: { none: {} } } }),
    prisma.hiringInterview.count({ where: { status: "completed", scorecards: { some: {} } } }),
    prisma.hiringScorecard.findMany({ select: { overall: true } }),
  ]);

  return {
    today,
    scheduled,
    awaitingScores: completedWithout,
    scored,
    avgScore: averageVerdict(verdicts.map((v) => v.overall)),
  };
}

/**
 * The four verdicts as a 0–100 number, so "AVG SCORE" is one figure.
 * strong_no = 0, no = 33, yes = 67, strong_yes = 100 — evenly spaced, because
 * nothing in the rubric says the gap between "no" and "yes" is wider than the
 * gap between "yes" and "strong yes".
 */
export function averageVerdict(verdicts: string[]): number | null {
  const values = verdicts
    .map((v) => ({ strong_no: 0, no: 33, yes: 67, strong_yes: 100 })[v])
    .filter((n): n is number => typeof n === "number");
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Which interviews are due a scorecard nudge right now (§3.5: 2h and 24h after
 * the interview ENDS). Returns which of the two is due so the caller can stamp
 * the right column and never send the same nudge twice.
 */
export function nudgesDue(
  interviews: {
    id: string;
    scheduledAt: Date;
    durationMin: number;
    status: string;
    nudged2hAt: Date | null;
    nudged24hAt: Date | null;
    panel: string[];
    scorecards: { reviewerId: string }[];
  }[],
  now: Date = new Date(),
): { interviewId: string; window: "2h" | "24h"; reviewerIds: string[] }[] {
  const out: { interviewId: string; window: "2h" | "24h"; reviewerIds: string[] }[] = [];
  for (const i of interviews) {
    if (i.status !== "completed") continue;
    const missing = i.panel.filter((p) => !i.scorecards.some((s) => s.reviewerId === p));
    if (!missing.length) continue;

    const endedAt = i.scheduledAt.getTime() + i.durationMin * 60_000;
    const hoursSince = (now.getTime() - endedAt) / 3_600_000;

    // 24h is checked first: past a day, the 24h nudge is the one to send, and
    // an interview whose 2h nudge was somehow missed should not get a stale one.
    if (hoursSince >= 24 && !i.nudged24hAt) {
      out.push({ interviewId: i.id, window: "24h", reviewerIds: missing });
    } else if (hoursSince >= 2 && hoursSince < 24 && !i.nudged2hAt) {
      out.push({ interviewId: i.id, window: "2h", reviewerIds: missing });
    }
  }
  return out;
}

// ── Calendar feed ──────────────────────────────────────────────────────────

/**
 * A per-user ICS token. Derived by HMAC from the user id rather than stored,
 * so there is no table to keep in sync and no token to leak from the database —
 * and rotating NEXTAUTH_SECRET invalidates every feed at once, which is the
 * revocation story.
 */
export function calendarToken(userId: string): string {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update(`hiring-ics:${userId}`).digest("hex").slice(0, 32);
}

/** Constant-time check, so the token cannot be probed a character at a time. */
export function verifyCalendarToken(userId: string, token: string): boolean {
  const expected = Buffer.from(calendarToken(userId));
  const given = Buffer.from(token ?? "");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location: string | null;
  status: string;
};

/** iCalendar text for a feed. Folding is skipped; lines are kept short instead. */
export function buildIcs(events: IcsEvent[], calendarName: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Desgro//Hiring//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
    "X-WR-TIMEZONE:Asia/Kolkata",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${icsStamp(new Date())}`,
      `DTSTART:${icsStamp(e.start)}`,
      `DTEND:${icsStamp(e.end)}`,
      `SUMMARY:${escapeIcs(e.summary)}`,
      `DESCRIPTION:${escapeIcs(e.description)}`,
      ...(e.location ? [`LOCATION:${escapeIcs(e.location)}`] : []),
      // A cancelled interview must be published as CANCELLED, not omitted:
      // dropping it silently leaves it on everyone's calendar forever.
      `STATUS:${e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function escapeIcs(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
