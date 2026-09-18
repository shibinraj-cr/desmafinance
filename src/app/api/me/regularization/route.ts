import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import {
  REGULARIZATION_REASONS,
  REGULARIZATION_WINDOW_WORKING_DAYS,
  isWithinRegularizationWindow,
} from "@/lib/hr-regularization";
import { hasPunch } from "@/lib/hr-attendance-status";
import { notifyRequestSubmitted } from "@/lib/hr-request-notify";
import { businessDaysBetween } from "@/lib/hr-me";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REASON_CODES = REGULARIZATION_REASONS.map((r) => r.code) as [string, ...string[]];

const Schema = z.object({
  date: z.string().regex(DATE_RE),
  // 'punch' (correct a missing/wrong punch), 'leave' (request paid leave for an
  // absence), or 'note' (put an explanation on record for a half-day / late-
  // coming day — approval changes nothing). Punch requests carry a punch
  // reasonType + proposed times; leave/note requests carry just a reason.
  requestType: z.enum(["punch", "leave", "note"]).default("punch"),
  reasonType: z.string().max(40).optional(),
  reason: z.string().min(5).max(500),
  // Leave requests only: "AM" = first half, "PM" = second half, null/absent =
  // the whole day. A half-day request resolves to HD on approval (0.5-day
  // deduction) rather than LV.
  halfSession: z.enum(["AM", "PM"]).nullable().optional(),
  /// LEAVE requests only: the last day of a multi-day leave. Omit for a
  /// single-day request. A range may be in the future — that is planned leave.
  toDate: z.string().regex(DATE_RE).nullable().optional(),
  proposedIn: z.string().regex(TIME_RE).nullable().optional(),
  proposedOut: z.string().regex(TIME_RE).nullable().optional(),
  attachmentUrl: z.string().url().nullable().optional(),
});

export async function GET() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ requests: [] });
  const requests = await prisma.hrAttendanceRegularization.findMany({
    where: { employeeId: emp.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ requests });
}

export async function POST(req: Request) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) {
    return NextResponse.json(
      { error: "your login is not linked to an employee record — ask HR" },
      { status: 400 },
    );
  }
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const isLeave = parsed.data.requestType === "leave";
  // A 'note' is an on-record explanation for a half-day / late-coming day: like a
  // leave request it carries no proposed punch times, and it's exempt from the
  // punch-reason validation.
  const isNote = parsed.data.requestType === "note";
  // Punch requests must name a valid punch reason; leave/note requests are
  // tagged accordingly and never carry proposed punch times.
  const reasonType = isLeave ? "leave" : isNote ? "explain" : parsed.data.reasonType ?? "";
  if (!isLeave && !isNote && !REASON_CODES.includes(reasonType)) {
    return NextResponse.json({ error: "invalid reasonType for a punch request" }, { status: 400 });
  }
  const proposedIn = isLeave || isNote ? null : parsed.data.proposedIn ?? null;
  const proposedOut = isLeave || isNote ? null : parsed.data.proposedOut ?? null;
  // Only a leave request carries a half — a punch fix restores the real times
  // and a note changes nothing, so neither has a half to ask for.
  const halfSession = isLeave ? parsed.data.halfSession ?? null : null;
  const date = new Date(parsed.data.date);
  // A leave request may span a range and may be in the FUTURE — that is planned
  // leave, the ordinary case ("I'm off Mon-Wed next week"). Until now the only
  // way to get leave on record was to be absent first and regularize afterwards.
  const toDate = isLeave && parsed.data.toDate ? new Date(parsed.data.toDate) : null;
  if (toDate && toDate < date) {
    return NextResponse.json({ error: "The end date is before the start date." }, { status: 400 });
  }
  if (toDate && halfSession) {
    return NextResponse.json(
      { error: "A half-day applies to a single date — file the half-day on its own." },
      { status: 400 },
    );
  }
  const rangeEnd = toDate ?? date;
  const todayUtc = (() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  })();
  const isFuture = rangeEnd > todayUtc;

  // The regularization window governs how far BACK a correction may reach. It
  // has nothing to say about leave planned ahead, so only past-dated requests
  // are measured against it.
  if (!isFuture || date <= todayUtc) {
    const inWindow = await isWithinRegularizationWindow(date);
    if (!inWindow) {
      return NextResponse.json(
        {
          error: `Requests about a past date must be submitted within ${REGULARIZATION_WINDOW_WORKING_DAYS} working days of it.`,
        },
        { status: 400 },
      );
    }
  }
  if (isFuture && !isLeave) {
    return NextResponse.json(
      { error: "Only a leave request can be for a future date." },
      { status: 400 },
    );
  }

  // Working days actually covered — Sundays and published holidays inside a
  // range are not leave and are never charged.
  const coveredDays = await businessDaysBetween(date, rangeEnd);
  if (coveredDays.length === 0) {
    return NextResponse.json(
      { error: "That range has no working days — nothing to apply for." },
      { status: 400 },
    );
  }

  // Find the related attendance row if it exists.
  const day = await prisma.hrAttendanceDay.findUnique({
    where: { employeeId_date: { employeeId: emp.id, date } },
    select: { id: true, inTime: true, outTime: true },
  });

  // A day with a punch was worked, so only HALF of it can be claimed as leave —
  // the same rule the approval routes enforce (`leaveStatusBlockedByPunch`).
  // Reject the full-day request here rather than letting it sit in the queue
  // until HR discovers it can't be applied.
  if (isLeave && !halfSession) {
    // A day with a punch was worked, so only HALF of it can be claimed as leave.
    // Across a range, name every offending day rather than rejecting on the
    // first one — the employee can then adjust the range in one go.
    const punched = await prisma.hrAttendanceDay.findMany({
      where: { employeeId: emp.id, date: { gte: date, lte: rangeEnd } },
      select: { date: true, inTime: true, outTime: true },
    });
    const worked = punched.filter((d) => hasPunch(d.inTime, d.outTime));
    if (worked.length > 0) {
      const list = worked.map((d) => d.date.toISOString().slice(0, 10)).join(", ");
      return NextResponse.json(
        {
          error: `${list} ${worked.length === 1 ? "has a punch, so it is a worked day" : "have punches, so they are worked days"}. Request a half-day instead, adjust the dates, or file a punch correction if a punch is wrong.`,
        },
        { status: 400 },
      );
    }
  }

  // Prevent duplicate pending requests for the same date.
  // Overlap guard. A stored request covers [date, toDate ?? date], so two
  // requests clash when their ranges intersect — not only when they start on
  // the same day.
  const live = await prisma.hrAttendanceRegularization.findMany({
    where: {
      employeeId: emp.id,
      status: { in: ["pending", "clarification"] },
      date: { lte: rangeEnd },
    },
    select: { date: true, toDate: true },
  });
  const clash = live.find((r) => (r.toDate ?? r.date) >= date);
  if (clash) {
    const span = clash.toDate
      ? `${clash.date.toISOString().slice(0, 10)} → ${clash.toDate.toISOString().slice(0, 10)}`
      : clash.date.toISOString().slice(0, 10);
    return NextResponse.json(
      {
        error: `A request covering ${span} is already under review. Withdraw or edit it from "My requests" below if you need to change the dates.`,
      },
      { status: 409 },
    );
  }

  const created = await prisma.hrAttendanceRegularization.create({
    data: {
      employeeId: emp.id,
      attendanceDayId: day?.id ?? null,
      date,
      toDate,
      requestType: parsed.data.requestType,
      reasonType,
      reason: parsed.data.reason,
      halfSession,
      proposedIn,
      proposedOut,
      attachmentUrl: parsed.data.attachmentUrl ?? null,
      status: "pending",
    },
  });

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "regularization_submitted",
      entityType: "HrAttendanceRegularization",
      entityId: created.id,
      metadata: {
        employeeId: emp.id,
        date: parsed.data.date,
        toDate: toDate ? toDate.toISOString().slice(0, 10) : null,
        days: coveredDays.length,
        requestType: parsed.data.requestType,
        reasonType,
        halfSession,
      },
    },
  });

  // Tell whoever may decide it that a request is waiting. Best-effort and
  // after the write, so a notification failure cannot lose the request.
  await notifyRequestSubmitted({
    employeeId: emp.id,
    employeeName: emp.name,
    requestType: parsed.data.requestType,
    halfSession,
    date,
    reason: parsed.data.reason,
  });

  return NextResponse.json({ request: created });
}
