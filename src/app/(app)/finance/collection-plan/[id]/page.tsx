import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApprove, canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { PlanDetailClient } from "./client";
import { PAYMENT_MODES } from "@/lib/catalog";
import { getTransactionFormMasters } from "@/lib/master-data";
import { todayIst, fromPrismaDate } from "@/lib/lead-pulse-dates";
import { loadSettings } from "@/lib/invoices/server";
import { notInvoiceableReason } from "@/lib/invoices/core";
import { parseUndo } from "@/lib/collection-payment-server";

export const dynamic = "force-dynamic";

const PAGE = "/finance/collection-plan";

export default async function CollectionPlanDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, PAGE)) redirect("/finance/overview");

  const plan = await prisma.collectionPlan.findUnique({
    where: { id: params.id },
    include: {
      party: { select: { id: true, name: true, group: true } },
      service: { select: { id: true, name: true } },
      installments: {
        orderBy: { seq: "asc" },
        include: {
          transaction: {
            select: {
              id: true,
              date: true,
              amount: true,
              paymentMode: true,
              category: true,
              isHistorical: true,
              deletedAt: true,
              invoices: { where: { status: "issued" }, select: { number: true }, take: 1 },
            },
          },
        },
      },
      createdBy: { select: { id: true, username: true } },
    },
  });
  if (!plan) notFound();

  // Undo payment: the plan's most recent recorded payment, for an approver,
  // while its entry is live and has no invoice (a linked entry only unlinks).
  // The server re-checks everything, including that nothing changed since.
  const latestRecorded = plan.installments
    .map((i) => ({ i, undo: parseUndo(i.paymentUndo) }))
    .filter((x) => x.undo && x.i.status === "received")
    .sort((a, b) => b.undo!.at.localeCompare(a.undo!.at))[0];
  const undoableId =
    canApprove(perms) &&
    latestRecorded &&
    latestRecorded.i.transaction &&
    !latestRecorded.i.transaction.deletedAt &&
    (latestRecorded.undo!.linked || !latestRecorded.i.transaction.invoices.length)
      ? latestRecorded.i.id
      : null;

  const [masters, invoiceSettings] = await Promise.all([getTransactionFormMasters(), loadSettings()]);
  const invoiceOpts = {
    activeBanks: invoiceSettings.banks.filter((b) => b.isActive).map((b) => b.paymentMode),
    startsOn: invoiceSettings.startsOn,
  };
  const revenueCategories = masters.categories.filter(
    (c) => c.isActive && (c.type === "Revenue" || c.type === "Both"),
  );

  return (
    <>
      <TopBar
        title={plan.label}
        subtitle={`${plan.party.name} · ${plan.installments.length} installment${plan.installments.length === 1 ? "" : "s"}`}
        action={
          <Link
            href="/finance/collection-plan"
            className="text-body-md text-primary hover:underline"
          >
            ← All plans
          </Link>
        }
      />
      <div className="p-margin">
        <PlanDetailClient
          plan={{
            id: plan.id,
            label: plan.label,
            partyId: plan.partyId,
            partyName: plan.party.name,
            serviceId: plan.serviceId,
            serviceName: plan.service?.name ?? null,
            category: plan.category ?? null,
            subItem: plan.subItem ?? null,
            paymentMode: plan.paymentMode ?? null,
            expDom: (plan.expDom as "EXP" | "DOM" | null) ?? null,
            notes: plan.notes,
            status: plan.status as "active" | "closed" | "cancelled",
            createdByUsername: plan.createdBy?.username ?? null,
            createdAt: plan.createdAt.toISOString(),
            installments: plan.installments.map((i) => ({
              id: i.id,
              seq: i.seq,
              expectedDate: i.expectedDate.toISOString().slice(0, 10),
              amount: Number(i.amount.toString()),
              category: i.category,
              subItem: i.subItem,
              paymentMode: i.paymentMode,
              description: i.description,
              status: i.status as "pending" | "submitted" | "received" | "cancelled",
              transactionId: i.transactionId,
              transaction: i.transaction
                ? {
                    id: i.transaction.id,
                    date: fromPrismaDate(i.transaction.date),
                    amount: Number(i.transaction.amount.toString()),
                    paymentMode: i.transaction.paymentMode,
                    invoiceNumber: i.transaction.invoices[0]?.number ?? null,
                    canInvoice:
                      !i.transaction.invoices.length &&
                      notInvoiceableReason(
                        {
                          type: "Revenue",
                          deletedAt: i.transaction.deletedAt,
                          isHistorical: i.transaction.isHistorical,
                          category: i.transaction.category,
                          paymentMode: i.transaction.paymentMode,
                          date: fromPrismaDate(i.transaction.date),
                          partyGroup: plan.party.group,
                        },
                        invoiceOpts,
                      ) === null,
                  }
                : null,
            })),
          }}
          categories={revenueCategories}
          paymentModes={[...PAYMENT_MODES]}
          today={todayIst()}
          canApprove={canApprove(perms)}
          undoableId={undoableId}
        />
      </div>
    </>
  );
}
