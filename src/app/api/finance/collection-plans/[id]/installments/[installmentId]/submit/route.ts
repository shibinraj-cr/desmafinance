import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { MONTHS, PAYMENT_MODES, flowFor, monthCodeFromDate } from "@/lib/catalog";
import { verifyCategorySubItem } from "@/lib/master-data";
import { canApprove, canSeePage } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import type { TxProposed } from "@/lib/approval";
import { isBeforeHistoricalFloor, isCandidatePaymentCategory, isHistoricalDate } from "@/lib/finance-historical";
import { gstInAmount } from "@/lib/finance-gst";
import { todayIst, toPrismaDate } from "@/lib/lead-pulse-dates";
import { utrRequired } from "@/lib/crm-enroll-confirm";
import { planChangeFor } from "@/lib/collection-payment";
import { PlanChangeRefused, applyPaymentToPlan, findDuplicatePayment, loadPlanInstalments, type DuplicatePayment } from "@/lib/collection-payment-server";
import { NOT_INVOICEABLE_MESSAGE, notInvoiceableReason } from "@/lib/invoices/core";
import { loadSettings } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

// Collection-plan installments are recorded from the Collection Plan page.
const PAGE = "/finance/collection-plan";

/**
 * The ledger month for a payment date, or null when the date falls outside
 * the months the ledger tracks (it used to fall back to MONTHS[0], posting a
 * 2027 date in "Apr-26"). A payment from before DesGro keeps its real month:
 * isHistorical keeps it out of the month-bucketed reports.
 */
/** Thrown inside the executive's transaction: the instalment stopped being due meanwhile. */
class InstalmentTaken extends Error {}

/** Thrown inside the posting transaction: the UTR reached the ledger meanwhile. */
class DuplicateMeanwhile extends Error {
  constructor(readonly dup: DuplicatePayment) {
    super("duplicate_payment");
  }
}

/** 409 naming the entry that already carries this UTR; an approver may link it instead. */
function duplicateResponse(dup: DuplicatePayment, approver: boolean) {
  return NextResponse.json(
    {
      error: "duplicate_payment",
      existing: { source: dup.source, id: dup.id, date: dup.date, amount: dup.amount, description: dup.description },
      canLink: approver && dup.source === "ledger" && !dup.linked,
    },
    { status: 409 },
  );
}

function ledgerMonthFor(d: Date): string | null {
  const code = monthCodeFromDate(d);
  if (isHistoricalDate(d)) return code;
  return (MONTHS as readonly string[]).includes(code) ? code : null;
}

/**
 * The payment as it arrived: the day the money landed, the amount, the bank,
 * the UTR and, when someone else paid, who. Category / sub-item / EXP-DOM are
 * asked only when the plan doesn't carry them yet.
 */
const BodySchema = z.object({
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().positive().max(1_000_000_000),
  paymentMode: z.enum(PAYMENT_MODES).optional().nullable(),
  utr: z.string().trim().max(60).optional().nullable(),
  paidBy: z.string().trim().max(120).optional().nullable(),
  category: z.string().min(1).max(120).optional().nullable(),
  subItem: z.string().min(1).max(160).optional().nullable(),
  expDom: z.enum(["EXP", "DOM"]).optional().nullable(),
});

/**
 * POST — record the payment received for an instalment. The ledger entry
 * carries what actually arrived (paid date, amount, bank, UTR in the
 * description so bank reconciliation matches it); the plan is reshaped for a
 * part or extra payment (src/lib/collection-payment.ts).
 *
 *   - An approver posts it straight to the ledger, in one transaction with the
 *     plan change, and is told whether the payment can be invoiced now.
 *   - Anyone else's goes to Approvals; approving it posts it and changes the
 *     plan then (approvePending). draftFirst is deliberately not used here:
 *     a draft has no link back to the instalment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; installmentId: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsedBody = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const body = parsedBody.data;

  const installment = await prisma.collectionPlanInstallment.findUnique({
    where: { id: params.installmentId },
    include: { plan: { include: { party: true } } },
  });
  if (!installment || installment.planId !== params.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // A plan that follows a Partner Commissions invoice is paid on the invoice,
  // which posts the ledger entry: recording it here too would book it twice.
  if (installment.plan.commissionInvoiceId) {
    return NextResponse.json({ error: "commission_plan" }, { status: 409 });
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

  // Resolution order: this payment → installment override → plan default.
  const category = body.category ?? installment.category ?? plan.category ?? null;
  const subItem = body.subItem ?? installment.subItem ?? plan.subItem ?? null;
  const paymentMode = body.paymentMode ?? installment.paymentMode ?? plan.paymentMode ?? null;
  const expDom = body.expDom ?? plan.expDom ?? null;
  if (!category || !subItem || !paymentMode || !expDom) {
    return NextResponse.json(
      {
        error: "submit_fields_required",
        missing: { category: !category, subItem: !subItem, paymentMode: !paymentMode, expDom: !expDom },
      },
      { status: 400 },
    );
  }
  const verr = await verifyCategorySubItem(category, subItem, "Revenue");
  if (verr) return NextResponse.json({ error: verr }, { status: 400 });

  // The payment's own date, checked before anything is written.
  if (body.paidOn > todayIst()) {
    return NextResponse.json({ error: "paid_in_future" }, { status: 400 });
  }
  const paidOn = toPrismaDate(body.paidOn);
  const month = ledgerMonthFor(paidOn);
  if (!month) {
    return NextResponse.json({ error: "month_out_of_range" }, { status: 400 });
  }
  // Before DesGro's books began: the ledger's own rules for historical entries.
  if (isHistoricalDate(paidOn)) {
    if (isBeforeHistoricalFloor(paidOn)) return NextResponse.json({ error: "historical_too_old" }, { status: 400 });
    if (!isCandidatePaymentCategory(category)) return NextResponse.json({ error: "historical_payments_only" }, { status: 400 });
    if (plan.party.group !== "Candidate") return NextResponse.json({ error: "historical_candidate_only" }, { status: 400 });
  }
  const utr = body.utr?.replace(/\s+/g, "") || null;
  if (utrRequired(paymentMode) && (utr ?? "").length < 4) {
    return NextResponse.json({ error: "utr_required" }, { status: 400 });
  }
  const paidBy = body.paidBy?.trim() || null;
  const amount = Math.round(body.amount * 100) / 100;

  // Refuse up front what the plan can't take (an executive's entry is checked
  // again when it's approved, against the plan as it is then).
  const check = planChangeFor(await loadPlanInstalments(prisma, plan.id), installment.id, amount);
  if ("error" in check) return NextResponse.json(check, { status: 409 });

  // The same money twice: this UTR is already on the ledger for the candidate
  // (booked from the bank line or the Daily Tracker), or waiting for approval.
  const approver = canApprove(perms);
  const dup = await findDuplicatePayment(prisma, { partyId: plan.partyId, utr, includeWaiting: true });
  if (dup) return duplicateResponse(dup, approver);

  // Persist the picks back onto plan + installment so the next payment
  // doesn't ask for the same answers.
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
        ...(body.category && body.category !== plan.category ? { category: body.category } : {}),
        ...(body.subItem && body.subItem !== plan.subItem ? { subItem: body.subItem } : {}),
        ...(body.paymentMode && body.paymentMode !== plan.paymentMode ? { paymentMode: body.paymentMode } : {}),
      },
    }),
  ]);

  // "Plan label · instalment 2 · UTR … · paid by …": the UTR is what bank
  // reconciliation matches the statement line on.
  const description = [
    `${plan.label} · instalment ${installment.seq}`,
    installment.description?.trim() || null,
    utr ? `UTR ${utr}` : null,
    paidBy ? `paid by ${paidBy}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);

  const proposed: TxProposed = {
    date: paidOn.toISOString(),
    month,
    type: "Revenue",
    category,
    subItem,
    description,
    paymentMode,
    amount,
    flow: flowFor("Revenue"),
    partyId: plan.partyId,
    expDom,
  };
  const audit = { ...proposed, fromInstallmentId: installment.id, planId: plan.id, plannedAmount: Number(installment.amount.toString()), plannedDate: installment.expectedDate.toISOString() };

  if (approver) {
    // Atomic: the ledger row and the plan change land together or not at all.
    let posted;
    try {
      posted = await prisma.$transaction(async (dbtx) => {
        const again = await findDuplicatePayment(dbtx, { partyId: plan.partyId, utr });
        if (again) throw new DuplicateMeanwhile(again);
        const tx = await dbtx.transaction.create({
          data: {
            date: paidOn,
            month,
            type: "Revenue",
            category,
            subItem,
            description,
            paymentMode,
            amount,
            flow: proposed.flow,
            partyId: plan.partyId,
            expDom,
            isHistorical: isHistoricalDate(paidOn),
            gstAmount: gstInAmount({ type: "Revenue", paymentMode, expDom, amount }),
            createdById: userId,
          },
        });
        const change = await applyPaymentToPlan(dbtx, { instalmentId: installment.id, transactionId: tx.id, paid: amount });
        return { tx, change };
      });
    } catch (e) {
      if (e instanceof PlanChangeRefused) return NextResponse.json(e.problem, { status: 409 });
      if (e instanceof DuplicateMeanwhile) return duplicateResponse(e.dup, true);
      throw e;
    }
    await recordAudit({
      entityType: "Transaction",
      entityId: posted.tx.id,
      action: "CREATE",
      userId,
      changes: { ...audit, planChange: posted.change },
    });

    // Whether Finance can issue the invoice for it right now, and if not, why.
    const settings = await loadSettings();
    const reason = notInvoiceableReason(
      {
        type: "Revenue",
        deletedAt: null,
        isHistorical: isHistoricalDate(paidOn),
        category,
        paymentMode,
        date: body.paidOn,
        partyGroup: plan.party.group,
      },
      { activeBanks: settings.banks.filter((b) => b.isActive).map((b) => b.paymentMode), startsOn: settings.startsOn },
    );
    return NextResponse.json({
      ok: true,
      applied: true,
      transactionId: posted.tx.id,
      invoice: { canIssue: reason === null, reason: reason ? NOT_INVOICEABLE_MESSAGE[reason] : null },
    });
  }

  // Executive — enqueue. Atomic: the pending row and the instalment's link to
  // it together, so neither is left pointing at nothing, and only while the
  // instalment is still due. A rejected entry for this instalment is replaced
  // by this one (so it can't be resubmitted as well).
  let superseded: string[] = [];
  let pending;
  try {
    pending = await prisma.$transaction(async (dbtx) => {
      const old = await dbtx.pendingApproval.findMany({
        where: { collectionInstallmentId: installment.id, status: "rejected" },
        select: { id: true },
      });
      superseded = old.map((o) => o.id);
      if (superseded.length) await dbtx.pendingApproval.deleteMany({ where: { id: { in: superseded } } });
      const created = await dbtx.pendingApproval.create({
        data: {
          kind: "create",
          status: "pending",
          proposed: proposed as unknown as object,
          submittedById: userId,
          collectionInstallmentId: installment.id,
        },
      });
      const claimed = await dbtx.collectionPlanInstallment.updateMany({
        where: { id: installment.id, status: "pending" },
        data: { status: "submitted", pendingApprovalId: created.id },
      });
      if (claimed.count !== 1) throw new InstalmentTaken();
      return created;
    });
  } catch (e) {
    if (e instanceof InstalmentTaken) return NextResponse.json({ error: "installment_not_pending" }, { status: 409 });
    // Another entry for this instalment got there first (still waiting, or approved).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "pending_exists" }, { status: 409 });
    }
    throw e;
  }
  for (const id of superseded) {
    await recordAudit({
      entityType: "PendingApproval",
      entityId: id,
      action: "DELETE",
      userId,
      changes: { kind: "superseded_by_new_record", installmentId: installment.id, by: pending.id },
    });
  }
  await recordAudit({
    entityType: "PendingApproval",
    entityId: pending.id,
    action: "SUBMIT_CREATE",
    userId,
    changes: audit,
  });
  return NextResponse.json({ ok: true, applied: false, pendingId: pending.id });
}
