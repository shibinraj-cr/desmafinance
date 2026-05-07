import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { CashflowDualLine, CategoryDonut, HorizontalBars } from "@/components/Charts";
import {
  monthlySeries,
  revenueByCategory,
  topRevenueServices,
  totalsByType,
} from "@/lib/aggregations";
import { inr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RevenuePage() {
  const [totals, series, byCat, topRev] = await Promise.all([
    totalsByType(),
    monthlySeries(),
    revenueByCategory(),
    topRevenueServices(8),
  ]);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const mom = prev?.revenue ? Math.round(((last.revenue - prev.revenue) / prev.revenue) * 100) : 0;
  const ytdAvg = series.length ? totals.revenue / Math.max(1, series.filter((s) => s.revenue > 0).length) : 0;

  return (
    <>
      <TopBar title="Revenue Analysis" />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
          <KpiCard label="Total Revenue" value={totals.revenue} tone="primary" />
          <KpiCard label="MoM Growth" value={`${mom >= 0 ? "+" : ""}${mom}%`} tone={mom >= 0 ? "success" : "danger"} />
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
