import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Schema = z.object({
  /// Either a single attendance-day id or a batch of ids.
  dayIds: z.array(z.string().min(1)).min(1).max(500),
  /// 'paid'   → mark as paid leave (status="LV"), counts as attended
  /// 'unpaid' → mark as unpaid leave (status="A"), full LOP deduction
  /// 'reset'  → revert to the original biometric status (rawStatus)
  decision: z.enum(["paid", "unpaid", "reset"]),
  note: z.string().max(500).nullable().optional(),
});

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const { dayIds, decision, note } = parsed.data;

  const days = await prisma.hrAttendanceDay.findMany({
    where: { id: { in: dayIds } },
    select: { id: true, status: true, rawStatus: true, date: true, employeeId: true },
  });
  if (days.length === 0) return NextResponse.json({ error: "no matching days" }, { status: 404 });

  const updates = days.map((d) => {
    let newStatus: string;
    if (decision === "paid") newStatus = "LV";
    else if (decision === "unpaid") newStatus = "A";
    else newStatus = d.rawStatus ?? d.status;
    return { id: d.id, newStatus };
  });

  const now = new Date();
  // Run as a single transaction so the audit log + day rows commit
  // together.
  await prisma.$transaction([
    ...updates.map((u) =>
      prisma.hrAttendanceDay.update({
        where: { id: u.id },
        data: {
          status: u.newStatus,
          decidedById: decision === "reset" ? null : userId,
          decidedAt: decision === "reset" ? null : now,
          decisionNote: decision === "reset" ? null : note ?? null,
        },
      }),
    ),
    prisma.hrAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: `attendance_${decision}`,
        entityType: "HrAttendanceDay",
        metadata: {
          dayIds,
          count: dayIds.length,
          note: note ?? null,
        },
      },
    }),
  ]);

  return NextResponse.json({ updated: updates.length, decision });
}
