import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Schema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  note: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const lr = await prisma.hrLeaveRequest.findUnique({ where: { id: params.id } });
  if (!lr) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (lr.status !== "pending") {
    return NextResponse.json({ error: "already decided" }, { status: 400 });
  }
  const status = parsed.data.action === "approve" ? "approved" : parsed.data.action === "reject" ? "rejected" : "cancelled";
  const updated = await prisma.hrLeaveRequest.update({
    where: { id: lr.id },
    data: {
      status,
      reviewedById: userId,
      reviewedAt: new Date(),
      reviewNote: parsed.data.note ?? null,
    },
  });

  if (status === "approved" && lr.leaveType !== "LOP") {
    const year = lr.fromDate.getUTCFullYear();
    const bal = await prisma.hrLeaveBalance.findUnique({
      where: { employeeId_year: { employeeId: lr.employeeId, year } },
    });
    const used = Number(bal?.used ?? 0) + Number(lr.days);
    const opening = Number(bal?.opening ?? 0);
    const accrued = Number(bal?.accrued ?? 0);
    if (bal) {
      await prisma.hrLeaveBalance.update({
        where: { id: bal.id },
        data: { used, balance: opening + accrued - used },
      });
    } else {
      await prisma.hrLeaveBalance.create({
        data: {
          employeeId: lr.employeeId,
          year,
          opening: 0,
          accrued: 0,
          used: Number(lr.days),
          balance: -Number(lr.days),
        },
      });
    }
  }

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: `leave_${status}`,
      entityType: "HrLeaveRequest",
      entityId: lr.id,
      metadata: { days: Number(lr.days), employeeId: lr.employeeId, note: parsed.data.note ?? null },
    },
  });
  return NextResponse.json({ request: updated });
}
