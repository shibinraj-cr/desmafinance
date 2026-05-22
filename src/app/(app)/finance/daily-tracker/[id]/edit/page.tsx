import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { TransactionForm, type TransactionFormValues } from "@/components/TransactionForm";
import { prisma } from "@/lib/prisma";
import { getTransactionFormMasters } from "@/lib/master-data";
import type { TxType } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function EditTransactionPage({
  params,
}: {
  params: { id: string };
}) {
  const [t, masters] = await Promise.all([
    prisma.transaction.findUnique({ where: { id: params.id } }),
    getTransactionFormMasters(),
  ]);
  if (!t || t.deletedAt) notFound();

  const initial: Partial<TransactionFormValues> = {
    type: t.type as TxType,
    date: t.date.toISOString().slice(0, 10),
    month: t.month,
    category: t.category,
    subItem: t.subItem,
    paymentMode: t.paymentMode,
    amount: t.amount.toString(),
    description: t.description ?? "",
    partyId: t.partyId ?? null,
    expDom: t.expDom === "EXP" ? "EXP" : t.expDom === "DOM" ? "DOM" : null,
  };

  return (
    <>
      <TopBar title="Edit Transaction" subtitle={t.description ?? t.subItem} />
      <div className="p-margin max-w-3xl">
        <TransactionForm
          mode="edit"
          initial={initial}
          transactionId={t.id}
          categories={masters.categories}
          parties={masters.parties}
        />
      </div>
    </>
  );
}
