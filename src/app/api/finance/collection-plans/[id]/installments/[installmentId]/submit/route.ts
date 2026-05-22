import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { MONTHS, flowFor } from "@/lib/catalog";
import { verifyCategorySubItem } from "@/lib/master-data";
import { canApprove } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import type { TxProposed } from "@/lib/approval";

export const dynamic = "force-dynamic";

const MONTH_CODES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthFromDate(d: Date): string {
  const code = `${MONTH_CODES[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(-2)}`;
  return (MONTHS as readonly string[]).includes(code) ? code : MONTHS[0];
}

/**
 * Submit an installment to the Daily Tracker for approval. Routing
 * follows the same rules as POST /api/finance/transactions:
 *
 *   - draftFirst user → creates a TransactionDraft (the user must
 *     then submit it from My Drafts; the pending row will link to
 *     this installment at that later step).
 *   - canApprove user → writes Transaction directly, links the
 *     installment to it with status='received'.
 *   - executive → creates a PendingApproval with the installment id
 *     attached, so approve/reject can update the installment.
 *
 * The installment is locked (status='submitted', editing blocked)
 * for the canApprove + executive paths; the draftFirst path leaves
 * status as 'pending' so the executive can still edit/resubmit if
 * the draft is discarded — see TODO below.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; installmentId: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const installment = await prisma.collectionPlanInstallment.findUnique({
    where: { id: params.installmentId },
    include: { plan: { include: { party: true } } },
  });
  if (!installment || installment.planId !== params.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (installment.status !== "pending") {
    return NextResponse.json(
      { error: "installment_not_pending", status: installment.status },
      { status: 409 },
    );
  }
  const plan = installment.plan;
  if (plan.status !== "active") {
    return NextResponse.json({ error: "plan_not_active" }, { status: 400 });
  }
  if (!plan.party || !plan.party.isActive) {
    return NextResponse.json({ error: "party_inactive" }, { status: 400 });
  }

  const category = installment.category ?? plan.category;
  const subItem = installment.subItem ?? plan.subItem;
  const paymentMode = installment.paymentMode ?? plan.paymentMode;
  const verr = await verifyCategorySubItem(category, subItem, "Revenue");
  if (verr) return NextResponse.json({ error: verr }, { status: 400 });

  const amountNum = Number(installment.amount.toString());
  const expectedDate = installment.expectedDate;
  const proposed: TxProposed = {
    date: expectedDate.toISOString(),
    month: monthFromDate(expectedDate),
    type: "Revenue",
    category,
    subItem,
    description: installment.description ?? plan.label,
    paymentMode,
    amount: amountNum,
    flow: flowFor("Revenue"),
    partyId: plan.partyId,
    expDom: plan.expDom ?? "DOM",
  };

  // Route per role. We don't use submitCreate() directly because we
  // need to set PendingApproval.collectionInstallmentId atomically and
  // flip the installment to its new status / link.
  if (perms.draftFirst) {
    // Draft-first users never bypass their own review. The installment
    // stays 'pending' until they push the draft through; the eventual
    // PendingApproval row created from the draft will not be linked
    // back to this installment, so the user should submit the
    // installment directly from the Daily Tracker draft instead. For
    // v1 we surface a 400 so the UI knows to route them via the
    // standard Daily Tracker form.
    return NextResponse.json({ error: "draft_first_not_supported" }, { status: 400 });
  }

  if (canApprove(perms)) {
    const tx = await prisma.transaction.create({
      data: {
        date: expectedDate,
        month: proposed.month,
        type: "Revenue",
        category,
        subItem,
        description: proposed.description ?? null,
        paymentMode,
        amount: amountNum,
        flow: proposed.flow,
        partyId: plan.partyId,
        expDom: proposed.expDom ?? null,
        createdById: userId,
      },
    });
    const updated = await prisma.collectionPlanInstallment.update({
      where: { id: installment.id },
      data: { status: "received", transactionId: tx.id, pendingApprovalId: null },
    });
    await recordAudit({
      entityType: "Transaction",
      entityId: tx.id,
      action: "CREATE",
      userId,
      changes: { ...proposed, fromInstallmentId: installment.id, planId: plan.id },
    });
    return NextResponse.json({
      ok: true,
      applied: true,
      transactionId: tx.id,
      installment: { ...updated, amount: Number(updated.amount.toString()) },
    });
  }

  // Executive — enqueue.
  const pending = await prisma.pendingApproval.create({
    data: {
      kind: "create",
      status: "pending",
      proposed: proposed as unknown as object,
      submittedById: userId,
      collectionInstallmentId: installment.id,
    },
  });
  const updated = await prisma.collectionPlanInstallment.update({
    where: { id: installment.id },
    data: { status: "submitted", pendingApprovalId: pending.id },
  });
  await recordAudit({
    entityType: "PendingApproval",
    entityId: pending.id,
    action: "SUBMIT_CREATE",
    userId,
    changes: { ...proposed, fromInstallmentId: installment.id, planId: plan.id },
  });
  return NextResponse.json({
    ok: true,
    applied: false,
    pendingId: pending.id,
    installment: { ...updated, amount: Number(updated.amount.toString()) },
  });
}
