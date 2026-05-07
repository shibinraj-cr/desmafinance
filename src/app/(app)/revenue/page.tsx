import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { CashflowDualLine, CategoryDonut, HorizontalBars } from "@/components/Charts";
import {
  monthlySeries,
  revenueByCategory,
  topRevenueServices,
  totalsByType,
} from "@/lib/aggregations";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";
import { DateFilter } from "@/components/DateFilter";

export const dynamic = "force-dynamic";

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const period = parsePeriod(searchParams);
  const range = rangeFor(period);
  const [totals, series, byCat, topRev] = await Promise.all([
    totalsByType(range),
    monthlySeries(range),
    revenueByCategory(range),
    topRevenueServices(8, range),
  ]);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const mom = prev?.revenue ? Math.round(((last.revenue - prev.revenue) / prev.revenue) * 100) : 0;
  const activeMonths = series.filter((s) => s.revenue > 0).length;
  const ytdAvg = activeMonths ? totals.revenue / activeMonths : 0;

  return (
    <>
      <TopBar title="Revenue Analysis" subtitle={periodLabel(period)} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
          <KpiCard label="Total Revenue" value={totals.revenue} tone="primary" />
          <KpiCard
            label="MoM Growth"
            value={`${mom >= 0 ? "+" : ""}${mom}%`}
            tone={mom >= 0 ? "success" : "danger"}
          />
          <KpiCard label="Avg / Active Month" value={ytdAvg} hint="Across months with revenue" />
          <KpiCard label="Categories" value={byCat.length} hint="Distinct revenue streams" />
        </section>
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
          <div className="lg:col-span-7">
            <Section title="Top Services">
              {topRev.length ? <HorizontalBars data={topRev} /> : <Empty>No revenue yet.</Empty>}
            </Section>
          </div>
          <div className="lg:col-span-5">
            <Section title="Revenue Mix by Category">
              {byCat.length ? <CategoryDonut data={byCat} /> : <Empty>No revenue yet.</Empty>}
            </Section>
          </div>
        </section>
        <Section title="Inflow vs Outflow (Monthly)">
          <CashflowDualLine data={series} />
        </Section>
      </div>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-lg text-center text-on-surface-variant">{children}</div>;
}
