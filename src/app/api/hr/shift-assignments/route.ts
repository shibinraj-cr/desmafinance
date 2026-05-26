import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { addShiftAssignment } from "@/lib/hr-shift";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CreateSchema = z.object({
  employeeId: z.string().min(1),
  shiftId: z.string().min(1),
  effectiveFrom: z.string().regex(DATE_RE, "Use YYYY-MM-DD"),
  effectiveTo: z.string().regex(DATE_RE).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  status: z.enum(["approved", "pending"]).default("approved"),
});

export async function GET(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const employeeId = url.searchParams.get("employeeId");
  const status = url.searchParams.get("status");
  const rows = await prisma.hrShiftAssignment.findMany({
    where: {
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ employeeId: "asc" }, { effectiveFrom: "desc" }],
    include: {
      shift: { select: { code: true, name: true, startTime: true, endTime: true } },
      employee: { select: { empCode: true, name: true } },
    },
  });
  return NextResponse.json({ assignments: rows });
}

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  // Any HR user can submit (pending), but only HR Managers can directly
  // create an approved assignment. Non-managers' requests default to
  // pending regardless of what they put in the body.
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const status = canApproveHr(perms) ? parsed.data.status : "pending";
  try {
    const created = await addShiftAssignment({
      employeeId: parsed.data.employeeId,
      shiftId: parsed.data.shiftId,
      effectiveFrom: new Date(parsed.data.effectiveFrom),
      effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
      reason: parsed.data.reason ?? null,
      status,
      createdById: userId ?? null,
    });
    return NextResponse.json({ id: created.id, status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
