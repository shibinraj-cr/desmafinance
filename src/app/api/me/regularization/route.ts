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
  const inWindow = await isWithinRegularizationWindow(date);
  if (!inWindow) {
    return NextResponse.json(
      {
        error: `Regularization requests must be submitted within ${REGULARIZATION_WINDOW_WORKING_DAYS} working days of the discrepancy date.`,
      },
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
  if (isLeave && !halfSession && day && hasPunch(day.inTime, day.outTime)) {
    return NextResponse.json(
      {
        error: `${parsed.data.date} has a punch (${day.inTime ?? "—"}–${day.outTime ?? "—"}), so it's a worked day. Request a half-day instead, or file a punch correction if the punch is wrong.`,
      },
      { status: 400 },
    );
  }

  // Prevent duplicate pending requests for the same date.
  const existing = await prisma.hrAttendanceRegularization.findFirst({
    where: { employeeId: emp.id, date, status: { in: ["pending", "clarification"] } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "A request for this date is already under review." },
      { status: 409 },
    );
  }

  const created = await prisma.hrAttendanceRegularization.create({
    data: {
      employeeId: emp.id,
      attendanceDayId: day?.id ?? null,
      date,
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
