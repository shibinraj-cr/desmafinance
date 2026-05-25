import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

/**
 * Replace the employee's department memberships with the supplied list.
 * Exactly one department may be flagged `isPrimary=true` — enforced here
 * (Prisma can't express it as a constraint).
 *
 * POST body:
 *   { memberships: [{ departmentId, isPrimary }, ...] }
 */
const Schema = z.object({
  memberships: z
    .array(
      z.object({
        departmentId: z.string().min(1),
        isPrimary: z.boolean().optional().default(false),
      }),
    )
    .max(50),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const memberships = parsed.data.memberships;
  const primaryCount = memberships.filter((m) => m.isPrimary).length;
  if (primaryCount > 1) {
    return NextResponse.json(
      { error: "at most one department may be marked primary" },
      { status: 400 },
    );
  }
  // If multiple memberships and none flagged primary, auto-promote the first.
  if (memberships.length > 0 && primaryCount === 0) {
    memberships[0].isPrimary = true;
  }
  // Dedupe by departmentId in case the client sent duplicates.
  const seen = new Set<string>();
  const dedup = memberships.filter((m) => {
    if (seen.has(m.departmentId)) return false;
    seen.add(m.departmentId);
    return true;
  });

  await prisma.$transaction([
    prisma.hrEmployeeDepartment.deleteMany({ where: { employeeId: params.id } }),
    ...dedup.map((m) =>
      prisma.hrEmployeeDepartment.create({
        data: { employeeId: params.id, departmentId: m.departmentId, isPrimary: m.isPrimary },
      }),
    ),
  ]);
  return NextResponse.json({ count: dedup.length });
}
