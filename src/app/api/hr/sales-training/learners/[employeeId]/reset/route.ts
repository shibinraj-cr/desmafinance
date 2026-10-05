import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Schema = z.object({ moduleId: z.string().min(1) });

/**
 * Give a learner a fresh start on one module: their attempts are voided (kept
 * on record, shown struck through) so the attempt limit and best score start
 * over. Watch progress is left alone — they've seen the videos.
 */
export async function POST(req: Request, { params }: { params: { employeeId: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { count } = await prisma.salesTrainingAttempt.updateMany({
    where: { moduleId: parsed.data.moduleId, employeeId: params.employeeId, voidedAt: null },
    data: { voidedAt: new Date(), voidedById: userId },
  });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "sales_training_reset",
      entityType: "SalesTrainingModule",
      entityId: parsed.data.moduleId,
      metadata: { employeeId: params.employeeId, voided: count },
    },
  });
  return NextResponse.json({ voided: count });
}
