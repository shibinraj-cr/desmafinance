import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

/**
 * Replace the employee's role memberships with the supplied list.
 * POST body: { roleIds: ["id1", "id2", ...] }
 */
const Schema = z.object({
  roleIds: z.array(z.string().min(1)).max(50),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const unique = [...new Set(parsed.data.roleIds)];
  await prisma.$transaction([
    prisma.hrEmployeeRole.deleteMany({ where: { employeeId: params.id } }),
    ...unique.map((roleId) =>
      prisma.hrEmployeeRole.create({ data: { employeeId: params.id, roleId } }),
    ),
  ]);
  return NextResponse.json({ count: unique.length });
}
