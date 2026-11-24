import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApprove, canSeePage } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { UndoRefused, undoPayment } from "@/lib/collection-payment-server";

export const dynamic = "force-dynamic";

const PAGE = "/finance/collection-plan";

/**
 * POST — undo the plan's most recent recorded payment (a wrong amount, the
 * wrong candidate, a typo): the plan goes back to exactly how it was before
 * it, and the ledger entry it posted is deleted — a linked entry is only
 * unlinked. Approvers only. Refused once anything else on the plan changed,
 * or while the entry has a live GST invoice (cancel that first).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string; installmentId: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE) || !canApprove(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const own = await prisma.collectionPlanInstallment.findUnique({ where: { id: params.installmentId }, select: { planId: true } });
  if (!own || own.planId !== params.id) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let out;
  try {
    out = await prisma.$transaction((tx) => undoPayment(tx, { instalmentId: params.installmentId, userId }));
  } catch (e) {
    if (e instanceof UndoRefused) return NextResponse.json({ error: e.problem }, { status: 409 });
    throw e;
  }

  await recordAudit({
    entityType: "CollectionPlanInstallment",
    entityId: params.installmentId,
    action: "UPDATE",
    userId,
    changes: { kind: "undo_payment", planId: out.planId, transactionId: out.transactionId, linked: out.linked },
  });
  if (!out.linked) {
    await recordAudit({
      entityType: "Transaction",
      entityId: out.transactionId,
      action: "DELETE",
      userId,
      changes: { via: "collection_plan_undo", installmentId: params.installmentId, planId: out.planId },
    });
  }
  return NextResponse.json({ ok: true, ...out });
}
