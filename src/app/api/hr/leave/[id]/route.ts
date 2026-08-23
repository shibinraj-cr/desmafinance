import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { employeeForUser } from "@/lib/hr-me";
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

  // No self-approval: an approver cannot decide their own leave. The queue
  // already hides own requests, but enforce it server-side too so an HR
  // manager's leave routes to another approver (admin). Admins with no linked
  // employee are unaffected.
  const approverEmp = userId ? await employeeForUser(userId) : null;
  if (approverEmp && approverEmp.id === lr.employeeId) {
    return NextResponse.json(
      { error: "You can't approve your own request — it must be reviewed by another approver." },
      { status: 403 },
    );
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
