import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { recomputeLeaveBalance } from "@/lib/hr-leave-balance";

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

  // Keep the canonical balance in sync. `used` is derived from reviewed &
  // decided attendance leave (LV/HD), not from the request itself, so the
  // deduction lands when the leave shows up as a decided LV day — this just
  // refreshes the stored row against current eligibility + decided leave.
  await recomputeLeaveBalance(lr.employeeId, lr.fromDate.getUTCFullYear());

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
