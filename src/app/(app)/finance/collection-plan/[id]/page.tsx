import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { PlanDetailClient } from "./client";
import { PAYMENT_MODES } from "@/lib/catalog";
import { getTransactionFormMasters } from "@/lib/master-data";

export const dynamic = "force-dynamic";

export default async function CollectionPlanDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");

  const plan = await prisma.collectionPlan.findUnique({
    where: { id: params.id },
    include: {
      party: { select: { id: true, name: true, group: true } },
      service: { select: { id: true, name: true } },
      installments: {
        orderBy: { seq: "asc" },
        include: {
          transaction: { select: { id: true, date: true, amount: true, paymentMode: true } },
        },
      },
      createdBy: { select: { id: true, username: true } },
    },
  });
  if (!plan) notFound();

  const masters = await getTransactionFormMasters();
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
                    date: i.transaction.date.toISOString().slice(0, 10),
                    amount: Number(i.transaction.amount.toString()),
                    paymentMode: i.transaction.paymentMode,
                  }
                : null,
            })),
          }}
          categories={revenueCategories}
          paymentModes={[...PAYMENT_MODES]}
        />
      </div>
    </>
  );
}
