import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { CASH_PAGE, cashFloatsView, floatCaps } from "@/lib/cash-floats-data";
import { CashFloatsClient } from "./client";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Cash Floats — cash taken out of the bank into the Outdoor Marketing float
 * (held by the director, spent against vouchers) or Petty Cash (spent through
 * ledger entries paid in Cash). A withdrawal is not an expense and not an
 * outflow: it moves money from the bank into a float.
 */
export default async function CashFloatsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const caps = floatCaps(perms, CASH_PAGE);
  if (!caps.view) redirect("/finance/overview");
  const tab = ["petty", "outdoor"].includes(String(searchParams.tab)) ? (String(searchParams.tab) as "petty" | "outdoor") : "tag";
  const all = searchParams.all === "1";
  const data = await cashFloatsView(all);
  const last = <T extends { closing: number }>(m: T[]) => (m.length ? m[m.length - 1].closing : 0);

  return (
    <>
      <TopBar title="Cash Floats" subtitle="Finance" />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
          <KpiCard label="Withdrawals to tag" value={data.toTag.filter((l) => l.suggested).length.toLocaleString("en-IN")} hint="ATM and cash debits not yet tagged" />
          <KpiCard label="Petty cash in hand" value={inr(last(data.petty.months))} hint="Withdrawals − expenses paid in Cash" />
          <KpiCard label="Outdoor Marketing with the director" value={inr(last(data.om.months))} hint="Withdrawals − vouchers uploaded" />
        </section>
        <CashFloatsClient tab={tab} all={all} data={data} canAct={caps.act} />
      </div>
    </>
  );
}
