import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { recomputeLeaveBalance } from "@/lib/hr-leave-balance";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const UpsertSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["monthly"]).default("monthly"),
  effectiveFrom: z.string().regex(DATE_RE),
  leavesPerPeriod: z.number().min(0).max(31),
  leaveType: z.enum(["CL", "SL", "PL"]).default("CL"),
  carryForward: z.boolean().default(true),
  carryForwardCap: z.number().min(0).max(365).default(0),
  expiryMonths: z.number().int().min(1).max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PUT(req: Request, { params }: { params: { employeeId: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = UpsertSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;
  const employee = await prisma.employee.findUnique({
    where: { id: params.employeeId },
    select: { id: true },
  });
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const result = await prisma.hrLeaveEligibility.upsert({
    where: { employeeId: params.employeeId },
    update: {
      enabled: data.enabled,
      frequency: data.frequency,
      effectiveFrom: new Date(data.effectiveFrom),
      leavesPerPeriod: data.leavesPerPeriod,
      leaveType: data.leaveType,
      carryForward: data.carryForward,
      carryForwardCap: data.carryForwardCap,
      expiryMonths: data.expiryMonths ?? null,
      notes: data.notes ?? null,
    },
    create: {
      employeeId: params.employeeId,
      enabled: data.enabled,
      frequency: data.frequency,
      effectiveFrom: new Date(data.effectiveFrom),
      leavesPerPeriod: data.leavesPerPeriod,
      leaveType: data.leaveType,
      carryForward: data.carryForward,
      carryForwardCap: data.carryForwardCap,
      expiryMonths: data.expiryMonths ?? null,
      notes: data.notes ?? null,
    },
  });
  // Eligibility drives accrual — recompute the displayed (current-year)
  // balance immediately so the change shows up without waiting on the
  // monthly accrual job.
  const balance = await recomputeLeaveBalance(
    params.employeeId,
    new Date().getUTCFullYear(),
  );

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "leave_eligibility_updated",
      entityType: "HrLeaveEligibility",
      entityId: result.id,
      metadata: { employeeId: params.employeeId, ...data },
    },
  });
  return NextResponse.json({ eligibility: result, balance });
}
