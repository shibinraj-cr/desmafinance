import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Schema = z.object({
  active: z.boolean().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** Change a learner's due date, or remove/restore them (history is kept). */
export async function PATCH(req: Request, { params }: { params: { employeeId: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;
  const updated = await prisma.salesTrainingLearner
    .update({
      where: { employeeId: params.employeeId },
      data: {
        active: d.active,
        dueDate: d.dueDate === undefined ? undefined : d.dueDate ? new Date(`${d.dueDate}T00:00:00.000Z`) : null,
      },
    })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: "not enrolled" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
