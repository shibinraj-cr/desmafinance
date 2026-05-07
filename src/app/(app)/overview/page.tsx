import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import {
  CategoryDonut,
  HorizontalBars,
  MonthlyRevenueExpenseBars,
} from "@/components/Charts";
import {
  expenseBreakdown,
  monthlySeries,
  topRevenueServices,
  totalsByType,
} from "@/lib/aggregations";
import { inr, pct } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [totals, series, topRev, expBreak] = await Promise.all([
    totalsByType(),
    monthlySeries(),
    topRevenueServices(5),
    expenseBreakdown(8),
  ]);

  const margin = totals.revenue ? Math.round((totals.net / totals.revenue) * 100) : 0;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const mom = prev?.revenue ? pct(last.revenue - prev.revenue, prev.revenue) : 0;

  return (
    <>
      <TopBar title="Financial Overview" subtitle="FY 2026-27" />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
          <KpiCard
            label="Total Revenue"
            value={totals.revenue}
            tone="primary"
            trailing={
              mom !== 0 ? (
                <span
                  className={
                    "px-xs py-[2px] rounded text-[11px] font-bold " +
                    (mom >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")
                  }
                >
                  {mom >= 0 ? "+" : ""}
                  {mom}%
                </span>
              ) : null
            }
          />
          <KpiCard label="Total Expenses" value={totals.expense} hint="Operational costs & taxes" />
          <KpiCard
            label="Net Position"
            value={totals.net}
            tone={totals.net >= 0 ? "primary" : "danger"}
            hint={totals.net >= 0 ? "Strong liquidity state" : "Negative cash position"}
          />
          <KpiCard label="Profit Margin" value={`${margin}%`} hint="Net / Revenue" />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
          <div className="lg:col-span-7">
            <Section
              title="Revenue by Service"
              action={
                <Link className="text-primary text-label-sm hover:underline" href="/revenue">
                  View details
                </Link>
              }
            >
              {topRev.length ? (
                <HorizontalBars data={topRev} />
              ) : (
                <Empty>No revenue recorded yet.</Empty>
              )}
            </Section>
          </div>
          <div className="lg:col-span-5">
            <Section title="Expense Breakdown">
              {expBreak.length ? (
                <CategoryDonut data={expBreak.slice(0, 6)} />
              ) : (
                <Empty>No expenses recorded yet.</Empty>
              )}
            </Section>
          </div>
        </section>

        <Section title="Revenue vs Expenses (FY 2026-27)">
          <MonthlyRevenueExpenseBars data={series} />
        </Section>

        <section className="bg-primary text-on-primary p-lg rounded-xl flex items-center gap-lg shadow-sm border-l-4 border-primary-fixed-dim">
          <div className="p-md bg-white/10 rounded-full flex items-center justify-center">
            <span className="material-symbols-outlined" style={{ fontSize: 32 }}>psychology</span>
          </div>
          <div className="flex-1">
            <p className="text-body-lg font-medium">
              {totals.net >= 0
                ? `Net cash position is ${inr(totals.net)} on ${inr(totals.revenue)} of revenue.`
                : `Expenses are exceeding revenue by ${inr(-totals.net)}. Review marketing & salary spend.`}{" "}
              <span className="opacity-80 font-normal">Open AI Insights for detailed analysis.</span>
            </p>
          </div>
          <Link
            href="/ai-insights"
            className="bg-white/20 hover:bg-white/30 px-md py-sm rounded-lg text-label-sm transition uppercase tracking-widest font-bold"
          >
            View
          </Link>
        </section>
      </div>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-lg text-center text-on-surface-variant">{children}</div>;
}
