import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { MONTHS, PAYMENT_MODES, flowFor } from "@/lib/catalog";
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

/** Optional body: lets the caller supply category/sub-item/payment-mode/
 *  EXP-DOM at submit time when the plan doesn't have defaults. */
const BodySchema = z
  .object({
    category: z.string().min(1).max(120).optional().nullable(),
    subItem: z.string().min(1).max(160).optional().nullable(),
    paymentMode: z.enum(PAYMENT_MODES).optional().nullable(),
    expDom: z.enum(["EXP", "DOM"]).optional().nullable(),
  })
  .optional()
  .nullable();

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
  req: NextRequest,
  { params }: { params: { id: string; installmentId: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Body is optional; only required if the plan/installment don't
  // already carry the missing fields.
  const rawBody = await req.json().catch(() => null);
  const parsedBody = BodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const body = parsedBody.data ?? {};

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

  // Resolution order: per-submit body → installment override → plan default.
  const category = body?.category ?? installment.category ?? plan.category ?? null;
  const subItem = body?.subItem ?? installment.subItem ?? plan.subItem ?? null;
  const paymentMode =
    body?.paymentMode ?? installment.paymentMode ?? plan.paymentMode ?? null;
  const expDom = body?.expDom ?? plan.expDom ?? null;
  if (!category || !subItem || !paymentMode || !expDom) {
    return NextResponse.json(
      {
        error: "submit_fields_required",
        missing: {
          category: !category,
          subItem: !subItem,
          paymentMode: !paymentMode,
          expDom: !expDom,
        },
      },
      { status: 400 },
    );
  }
  const verr = await verifyCategorySubItem(category, subItem, "Revenue");
  if (verr) return NextResponse.json({ error: verr }, { status: 400 });

  // Persist the user's picks back onto plan + installment so the next
  // submit doesn't re-prompt for the same answers.
  await prisma.$transaction([
    prisma.collectionPlan.update({
      where: { id: plan.id },
      data: {
        ...(plan.category ? {} : { category }),
        ...(plan.subItem ? {} : { subItem }),
        ...(plan.paymentMode ? {} : { paymentMode }),
        ...(plan.expDom ? {} : { expDom }),
      },
    }),
    prisma.collectionPlanInstallment.update({
      where: { id: installment.id },
      data: {
        // Only write per-installment override when caller asked for
        // something different from the (now-saved) plan default.
        ...(body?.category && body.category !== plan.category
          ? { category: body.category }
          : {}),
        ...(body?.subItem && body.subItem !== plan.subItem ? { subItem: body.subItem } : {}),
        ...(body?.paymentMode && body.paymentMode !== plan.paymentMode
          ? { paymentMode: body.paymentMode }
          : {}),
      },
    }),
  ]);

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
    expDom,
  };

  // Route per role. We don't use submitCreate() directly because we
  // need to set PendingApproval.collectionInstallmentId atomically and
  // flip the installment to its new status / link.
  //
  // draftFirst is intentionally NOT special-cased here. For ad-hoc
  // Daily Tracker entries that flag routes a user's submissions through
  // a personal draft queue first; but a collection-plan installment is
  // already explicitly reviewed in the "Submit to Daily Tracker" dialog
  // (category / sub-item / payment / EXP-DOM are confirmed there), and
  // TransactionDraft has no link back to the installment — so a draft
  // would orphan the installment and risk a double-submit. draftFirst
  // executives therefore use the standard executive enqueue path below,
  // which keeps the installment ↔ PendingApproval link intact.

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
