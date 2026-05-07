import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { CategoryDonut, HorizontalBars, MonthlyRevenueExpenseBars } from "@/components/Charts";
import { expenseBreakdown, monthlySeries, totalsByType } from "@/lib/aggregations";
import { prisma } from "@/lib/prisma";
import { inrFull } from "@/lib/format";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";
import { DateFilter } from "@/components/DateFilter";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const period = parsePeriod(searchParams);
  const range = rangeFor(period);
  const recentWhere = {
    type: "Expense",
    deletedAt: null,
    ...(range.from || range.to
      ? {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lt: range.to } : {}),
          },
        }
      : {}),
  };
  const [totals, breakdown, series, recent] = await Promise.all([
    totalsByType(range),
    expenseBreakdown(10, range),
    monthlySeries(range),
    prisma.transaction.findMany({
      where: recentWhere,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 10,
    }),
  ]);
  const top3 = breakdown.slice(0, 3).reduce((s, r) => s + r.value, 0);
  const top3Pct = totals.expense ? Math.round((top3 / totals.expense) * 100) : 0;

  return (
    <>
      <TopBar title="Expense Tracker" subtitle={periodLabel(period)} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
          <KpiCard label="Total Expenses" value={totals.expense} tone="danger" />
          <KpiCard label="Categories" value={breakdown.length} />
          <KpiCard label="Top 3 Share" value={`${top3Pct}%`} hint="Concentration of spend" />
          <KpiCard
            label="Net After Expenses"
            value={totals.net}
            tone={totals.net >= 0 ? "success" : "danger"}
          />
        </section>
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
          <div className="lg:col-span-7">
            <Section title="Top Spend Categories">
              {breakdown.length ? <HorizontalBars data={breakdown.slice(0, 8)} /> : <Empty>No expenses yet.</Empty>}
            </Section>
          </div>
          <div className="lg:col-span-5">
            <Section title="Distribution">
              {breakdown.length ? <CategoryDonut data={breakdown.slice(0, 6)} /> : <Empty>No expenses yet.</Empty>}
            </Section>
          </div>
        </section>
        <Section title="Monthly Trend">
          <MonthlyRevenueExpenseBars data={series} />
        </Section>
        <Section title="Recent Expenses">
          {recent.length === 0 ? (
            <Empty>No expenses yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-md">
                <thead className="text-on-surface-variant">
                  <tr className="text-left">
                    <th className="py-sm pr-md text-label-sm uppercase">Date</th>
                    <th className="py-sm pr-md text-label-sm uppercase">Category</th>
                    <th className="py-sm pr-md text-label-sm uppercase">Sub-Item</th>
                    <th className="py-sm pr-md text-label-sm uppercase">Mode</th>
                    <th className="py-sm pr-md text-label-sm uppercase text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id} className="border-t border-outline-variant/60">
                      <td className="py-sm pr-md">{t.date.toISOString().slice(0, 10)}</td>
                      <td className="py-sm pr-md">{t.category}</td>
                      <td className="py-sm pr-md">{t.subItem}</td>
                      <td className="py-sm pr-md">{t.paymentMode}</td>
                      <td className="py-sm pr-md text-right font-mono text-error">
                        −{inrFull(Number(t.amount.toString())).slice(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-lg text-center text-on-surface-variant">{children}</div>;
}
