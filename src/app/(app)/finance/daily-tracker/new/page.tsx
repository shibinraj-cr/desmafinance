import { TopBar } from "@/components/TopBar";
import { TransactionForm } from "@/components/TransactionForm";

export default function NewTransactionPage() {
  return (
    <>
      <TopBar title="New Transaction" subtitle="Record an inflow or outflow" />
      <div className="p-margin max-w-3xl">
        <TransactionForm />
      </div>
    </>
  );
}
