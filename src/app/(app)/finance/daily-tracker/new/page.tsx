import { redirect } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { TransactionForm } from "@/components/TransactionForm";
import { getTransactionFormMasters } from "@/lib/master-data";

export const dynamic = "force-dynamic";

const PAGE = "/finance/daily-tracker";

export default async function NewTransactionPage() {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, PAGE)) redirect("/finance/overview");

  const { categories, parties, employees } = await getTransactionFormMasters();
  return (
    <>
      <TopBar title="New Transaction" subtitle="Record an inflow or outflow" />
      <div className="p-margin max-w-3xl">
        <TransactionForm categories={categories} parties={parties} employees={employees} />
      </div>
    </>
  );
}
