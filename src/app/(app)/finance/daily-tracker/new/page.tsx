import { TopBar } from "@/components/TopBar";
import { TransactionForm } from "@/components/TransactionForm";
import { getTransactionFormMasters } from "@/lib/master-data";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage() {
  const { categories, parties } = await getTransactionFormMasters();
  return (
    <>
      <TopBar title="New Transaction" subtitle="Record an inflow or outflow" />
      <div className="p-margin max-w-3xl">
        <TransactionForm categories={categories} parties={parties} />
      </div>
    </>
  );
}
