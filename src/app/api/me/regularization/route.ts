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

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REASON_CODES = REGULARIZATION_REASONS.map((r) => r.code) as [string, ...string[]];

const Schema = z.object({
  date: z.string().regex(DATE_RE),
  // 'punch' (correct a missing/wrong punch) or 'leave' (request paid leave for
  // an absence). Punch requests carry a punch reasonType + proposed times; leave
  // requests carry just a reason.
  requestType: z.enum(["punch", "leave"]).default("punch"),
  reasonType: z.string().max(40).optional(),
  reason: z.string().min(5).max(500),
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
  // Punch requests must name a valid punch reason; leave requests are tagged
  // 'leave' and never carry proposed punch times.
  const reasonType = isLeave ? "leave" : parsed.data.reasonType ?? "";
  if (!isLeave && !REASON_CODES.includes(reasonType)) {
    return NextResponse.json({ error: "invalid reasonType for a punch request" }, { status: 400 });
  }
  const proposedIn = isLeave ? null : parsed.data.proposedIn ?? null;
  const proposedOut = isLeave ? null : parsed.data.proposedOut ?? null;
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
    select: { id: true },
  });

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
      },
    },
  });

  return NextResponse.json({ request: created });
}
