import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { countBusinessDays, employeeForUser } from "@/lib/hr-me";

const Schema = z.object({
  fromDate: z.string().min(8),
  toDate: z.string().min(8),
  halfDay: z.boolean().default(false),
  leaveType: z.enum(["CL", "LOP", "HD", "SL"]).default("CL"),
  reason: z.string().min(1).max(500),
});

export async function GET() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ requests: [] });
  const requests = await prisma.hrLeaveRequest.findMany({
    where: { employeeId: emp.id },
    orderBy: { fromDate: "desc" },
    take: 100,
    include: { reviewedBy: { select: { username: true } } },
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
  const from = new Date(parsed.data.fromDate);
  const to = new Date(parsed.data.toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return NextResponse.json({ error: "invalid dates" }, { status: 400 });
  }
  let days: number;
  if (parsed.data.halfDay || parsed.data.leaveType === "HD") {
    days = 0.5;
  } else {
    days = await countBusinessDays(from, to);
  }
  if (days <= 0) {
    return NextResponse.json({ error: "selected range has no working days" }, { status: 400 });
  }

  const created = await prisma.hrLeaveRequest.create({
    data: {
      employeeId: emp.id,
      fromDate: from,
      toDate: to,
      days,
      leaveType: parsed.data.halfDay ? "HD" : parsed.data.leaveType,
      reason: parsed.data.reason,
      status: "pending",
    },
  });

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "leave_requested",
      entityType: "HrLeaveRequest",
      entityId: created.id,
      metadata: { days, leaveType: created.leaveType, employee: emp.name },
    },
  });

  return NextResponse.json({ request: created });
}
