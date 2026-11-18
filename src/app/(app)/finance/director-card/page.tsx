import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { CARD_PAGE, directorCardView, floatCaps } from "@/lib/cash-floats-data";
import { DirectorCardClient } from "./client";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Director's Card — expenses paid on the director's personal credit card
 * (ledger payment mode "Credit Card") are owed to the director; bank payments
 * to the director repay them, oldest first. A repayment is never a second
 * expense: the expense is already in the ledger.
 */
export default async function DirectorCardPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const caps = floatCaps(perms, CARD_PAGE);
  if (!caps.view) redirect("/finance/overview");
  const all = searchParams.all === "1";
  const data = await directorCardView(all);

  return (
    <>
      <TopBar title="Director's Card" subtitle="Finance" />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
          <KpiCard label="Owed to the director" value={inr(data.totals.outstanding)} tone={data.totals.outstanding ? "danger" : "default"} hint="Card expenses not yet repaid" />
          <KpiCard label="Claimed" value={inr(data.totals.claimed)} hint={`Expenses paid on the card since ${data.settings.startOn}`} />
          <KpiCard
            label="Repaid"
            value={inr(data.totals.repaid)}
            hint={data.totals.unapplied ? `${inr(data.totals.unapplied)} more than claimed (an advance)` : "Bank payments to the director"}
          />
        </section>
        <DirectorCardClient all={all} data={data} canAct={caps.act} />
      </div>
    </>
  );
}
