import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApprove, canSeePage } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { fromPrismaDate } from "@/lib/lead-pulse-dates";
import { PlanChangeRefused, applyPaymentToPlan } from "@/lib/collection-payment-server";
import { lockLedgerRow } from "@/lib/invoices/ledger-lock";
import { NOT_INVOICEABLE_MESSAGE, notInvoiceableReason } from "@/lib/invoices/core";
import { loadSettings } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

const PAGE = "/finance/collection-plan";

/** The entry is not this candidate's live revenue, or is already a plan payment. */
class LinkUnavailable extends Error {}

/**
 * POST — the payment is already on the ledger (booked from the bank line or
 * the Daily Tracker): link that entry to the instalment instead of posting it
 * again. The plan is reshaped by the entry's amount, exactly as Record payment
 * would; nothing new is posted. Approvers only. Undo payment unlinks it again
 * and leaves the entry where it was.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; installmentId: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE) || !canApprove(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = z.object({ transactionId: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const { transactionId } = parsed.data;

  const installment = await prisma.collectionPlanInstallment.findUnique({
    where: { id: params.installmentId },
    include: { plan: { include: { party: true } } },
  });
  if (!installment || installment.planId !== params.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (installment.status !== "pending") return NextResponse.json({ error: "installment_not_pending" }, { status: 409 });
  if (installment.plan.status !== "active") return NextResponse.json({ error: "plan_not_active" }, { status: 400 });

  let linked;
  try {
    linked = await prisma.$transaction(async (tx) => {
      await lockLedgerRow(tx, transactionId);
      const entry = await tx.transaction.findUnique({
        where: { id: transactionId },
        select: { id: true, type: true, partyId: true, deletedAt: true, amount: true, date: true, category: true, paymentMode: true, isHistorical: true, collectionInstallment: { select: { id: true } } },
      });
      if (!entry || entry.deletedAt || entry.type !== "Revenue" || entry.partyId !== installment.plan.partyId || entry.collectionInstallment) {
        throw new LinkUnavailable();
      }
      const paid = Number(entry.amount.toString());
      const change = await applyPaymentToPlan(tx, { instalmentId: installment.id, transactionId: entry.id, paid, linked: true });
      return { entry, paid, change };
    });
  } catch (e) {
    if (e instanceof LinkUnavailable) return NextResponse.json({ error: "link_unavailable" }, { status: 409 });
    if (e instanceof PlanChangeRefused) return NextResponse.json(e.problem, { status: 409 });
    // Linked to another instalment at the same moment (transactionId is unique).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return NextResponse.json({ error: "link_unavailable" }, { status: 409 });
    throw e;
  }

  await recordAudit({
    entityType: "CollectionPlanInstallment",
    entityId: installment.id,
    action: "UPDATE",
    userId,
    changes: { kind: "link_existing_payment", planId: installment.planId, transactionId, amount: linked.paid, planChange: linked.change },
  });

  const settings = await loadSettings();
  const reason = notInvoiceableReason(
    {
      type: "Revenue",
      deletedAt: null,
      isHistorical: linked.entry.isHistorical,
      category: linked.entry.category,
      paymentMode: linked.entry.paymentMode,
      date: fromPrismaDate(linked.entry.date),
      partyGroup: installment.plan.party.group,
    },
    { activeBanks: settings.banks.filter((b) => b.isActive).map((b) => b.paymentMode), startsOn: settings.startsOn },
  );
  const invoiced = await prisma.invoice.count({ where: { transactionId, status: "issued" } });
  return NextResponse.json({
    ok: true,
    applied: true,
    linked: true,
    transactionId,
    amount: linked.paid,
    date: fromPrismaDate(linked.entry.date),
    invoice: invoiced
      ? { canIssue: false, reason: "It already has an invoice." }
      : { canIssue: reason === null, reason: reason ? NOT_INVOICEABLE_MESSAGE[reason] : null },
  });
}
