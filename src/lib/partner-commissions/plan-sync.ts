/**
 * Keeps a sent Partner Commissions invoice's collection plan in step with the
 * invoice, so the money it is owed shows in the Collection Plans list, the
 * Finance overview and the CEO dashboard's expected collections for the month.
 *
 * - Marked sent → a plan for the partner with one instalment due (sent date +
 *   payment term), in rupees at the partner's recent AUD → INR (see
 *   collection-plan.ts).
 * - Lines or terms edited while sent → the due amount and date follow.
 * - A payment approved → a received instalment at its real INR value, linked
 *   to the Revenue row it posted; whatever is still open stays due.
 * - Cancelled → the plan is cancelled.
 *
 * The plan is read-only on the Collection Plan pages (commissionPlanRefusal):
 * the payment is recorded on the invoice, which posts the ledger entry, so a
 * second "Record payment" there would book it twice.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { istDateString, toPrismaDate, fromPrismaDate } from "@/lib/lead-pulse-dates";
import { LEDGER } from "./constants";
import { invoiceTotal } from "./logic";
import { commissionPlanShape, rateFromReceipts, type CommissionPlanRow } from "./collection-plan";

const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d.toString()));

/** Statuses an invoice is still owed money in. */
const OPEN_STATUSES = ["sent", "awaiting", "partpaid"];

/** The partner's Party for the Revenue rows and its plan: the linked one, else one named like it (created when missing). */
export async function partnerPartyId(
  tx: Prisma.TransactionClient,
  partner: { id: string; name: string; partyId: string | null },
): Promise<string> {
  if (partner.partyId) return partner.partyId;
  const existing = await tx.party.findFirst({
    where: { name: { equals: partner.name, mode: "insensitive" }, group: "Vendor" },
    select: { id: true },
  });
  const partyId = existing?.id ?? (await tx.party.create({ data: { name: partner.name, group: "Vendor", txTypes: "Both" } })).id;
  await tx.commissionPartner.update({ where: { id: partner.id }, data: { partyId } });
  return partyId;
}

/** Rupees per AUD from the latest approved payments: this partner's, else anyone's. */
async function recentRate(tx: Prisma.TransactionClient, partnerId: string): Promise<number | null> {
  const pick = (where: Prisma.CommissionReceiptWhereInput) =>
    tx.commissionReceipt.findMany({
      where: { status: "approved", audSettled: { gt: 0 }, inrAmount: { gt: 0 }, ...where },
      orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: { audSettled: true, inrAmount: true },
    });
  const toNums = (rows: Array<{ audSettled: Prisma.Decimal; inrAmount: Prisma.Decimal }>) =>
    rows.map((r) => ({ audSettled: num(r.audSettled), inrAmount: num(r.inrAmount) }));
  return rateFromReceipts(toNums(await pick({ invoice: { partnerId } }))) ?? rateFromReceipts(toNums(await pick({})));
}

const planLabel = (number: string) => `Partner commission · ${number}`;

type StoredRow = { seq: number; expectedDate: string; amount: number; status: string; transactionId: string | null; description: string };

const sameRows = (a: StoredRow[], b: CommissionPlanRow[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return (
      x.seq === y.seq &&
      x.expectedDate === y.expectedDate &&
      Math.abs(x.amount - y.amount) < 0.005 &&
      x.status === y.status &&
      x.transactionId === y.transactionId &&
      x.description === y.description
    );
  });

/**
 * Bring the invoice's collection plan in line with the invoice, inside the
 * caller's transaction (after it has written the invoice). Makes the plan the
 * first time an invoice is past draft and still owed (or being paid now).
 */
export async function syncCommissionPlan(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  // One sync per invoice at a time, so two can't both make its plan.
  await tx.$queryRaw`SELECT id FROM "CommissionInvoice" WHERE id = ${invoiceId} FOR UPDATE`;
  const inv = await tx.commissionInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: { select: { program: true, amount: true } },
      receipts: true,
      partner: { select: { id: true, name: true, partyId: true } },
      collectionPlan: { select: { id: true, label: true, status: true, partyId: true } },
    },
  });
  if (!inv || inv.status === "draft") return;
  // Nothing to expect: never tracked, and no longer owed.
  if (!inv.collectionPlan && inv.status === "cancelled") return;

  const sentOn = istDateString(inv.sentAt ?? inv.createdAt);
  const shape = commissionPlanShape({
    invoice: {
      status: inv.status,
      sentOn,
      paymentTerm: inv.paymentTerm,
      totalAud: invoiceTotal(inv.lines.map((l) => ({ amount: num(l.amount) }))),
    },
    approved: inv.receipts
      .filter((r) => r.status === "approved")
      .map((r) => ({
        receivedOn: fromPrismaDate(r.receivedOn),
        audSettled: num(r.audSettled),
        aedAmount: num(r.aedAmount),
        inrAmount: num(r.inrAmount),
        settleInFull: r.settleInFull,
        skipLedger: r.skipLedger,
        transactionId: r.postedTxIds[0] ?? null,
      })),
    rate: await recentRate(tx, inv.partnerId),
  });

  let planId = inv.collectionPlan?.id ?? null;
  const programs = [...new Set(inv.lines.map((l) => l.program))];
  if (!planId) {
    const partyId = await partnerPartyId(tx, inv.partner);
    planId = (
      await tx.collectionPlan.create({
        data: {
          partyId,
          label: planLabel(inv.number),
          category: LEDGER.category,
          subItem: programs.length === 1 ? LEDGER.subItem(programs[0]) : null,
          paymentMode: LEDGER.paymentMode,
          expDom: LEDGER.expDom,
          notes: "Follows the Partner Commissions invoice. Record the partner's payment on the invoice; this plan updates when it is approved.",
          status: shape.status,
          createdById: inv.createdById,
          commissionInvoiceId: inv.id,
        },
      })
    ).id;
  } else if (inv.collectionPlan!.label !== planLabel(inv.number) || inv.collectionPlan!.status !== shape.status) {
    await tx.collectionPlan.update({ where: { id: planId }, data: { label: planLabel(inv.number), status: shape.status } });
  }

  const current = await tx.collectionPlanInstallment.findMany({
    where: { planId },
    orderBy: { seq: "asc" },
    select: { seq: true, expectedDate: true, amount: true, status: true, transactionId: true, description: true },
  });
  const currentRows: StoredRow[] = current.map((r) => ({
    ...r,
    expectedDate: fromPrismaDate(r.expectedDate),
    amount: num(r.amount),
    description: r.description ?? "",
  }));
  if (sameRows(currentRows, shape.rows)) return;

  // A posted row already linked to some other plan's instalment stays there.
  const txIds = shape.rows.map((r) => r.transactionId).filter((x): x is string => !!x);
  const taken = txIds.length
    ? new Set(
        (
          await tx.collectionPlanInstallment.findMany({
            where: { transactionId: { in: txIds }, planId: { not: planId } },
            select: { transactionId: true },
          })
        ).map((r) => r.transactionId),
      )
    : new Set<string | null>();

  await tx.collectionPlanInstallment.deleteMany({ where: { planId } });
  await tx.collectionPlanInstallment.createMany({
    data: shape.rows.map((r) => ({
      planId: planId!,
      seq: r.seq,
      expectedDate: toPrismaDate(r.expectedDate),
      amount: r.amount,
      status: r.status,
      transactionId: r.transactionId && !taken.has(r.transactionId) ? r.transactionId : null,
      description: r.description,
    })),
  });
}

/**
 * Give every invoice that is still owed money a plan (invoices sent before
 * this existed, or one whose sync failed). Cheap when there is nothing to do:
 * one indexed query. Never throws.
 */
export async function syncOpenCommissionPlans(): Promise<number> {
  try {
    const missing = await prisma.commissionInvoice.findMany({
      where: { status: { in: OPEN_STATUSES }, collectionPlan: { is: null } },
      select: { id: true },
      take: 50,
    });
    for (const m of missing) {
      await prisma.$transaction((tx) => syncCommissionPlan(tx, m.id));
    }
    return missing.length;
  } catch (e) {
    logger.error("pc_plan_backfill_failed", { error: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

/** The invoice a plan follows, when it follows one. */
export async function commissionInvoiceOfPlan(planId: string): Promise<{ id: string; number: string } | null> {
  const plan = await prisma.collectionPlan.findUnique({
    where: { id: planId },
    select: { commissionInvoice: { select: { id: true, number: true } } },
  });
  return plan?.commissionInvoice ?? null;
}

/** For the Collection Plan write routes: refuse when the plan follows a commission invoice. */
export async function commissionPlanRefusal(planId: string): Promise<{ error: "commission_plan"; invoiceId: string; number: string } | null> {
  const inv = await commissionInvoiceOfPlan(planId);
  return inv ? { error: "commission_plan", invoiceId: inv.id, number: inv.number } : null;
}
