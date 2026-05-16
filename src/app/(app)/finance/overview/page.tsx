import Link from "next/link";
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
  topRevenueServicesSplit,
  totalsByType,
} from "@/lib/aggregations";
import { inr } from "@/lib/format";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";
import { DateFilter } from "@/components/DateFilter";
import { pace } from "@/lib/pace";
import { PaceTracker } from "@/components/PaceTracker";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const period = parsePeriod(searchParams);
  const range = rangeFor(period);
  // "Current Month Revenue" tile is anchored to the running calendar
  // month regardless of the page's period filter, so the headline
  // number tracks where we are right now even if a supervisor is
  // browsing a different window.
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = currentMonthStart;
  const [totals, series, services, expBreak, paceData, currentMonthTotals, prevMonthTotals] =
    await Promise.all([
      totalsByType(range),
      monthlySeries(range),
      topRevenueServicesSplit(6, range),
      expenseBreakdown(8, range),
      pace(),
      totalsByType({ from: currentMonthStart, to: currentMonthEnd }),
      totalsByType({ from: prevMonthStart, to: prevMonthEnd }),
    ]);
  const currentMonthRevenueTrend =
    prevMonthTotals.revenue > 0
      ? ((currentMonthTotals.revenue - prevMonthTotals.revenue) / prevMonthTotals.revenue) * 100
      : null;
  const currentMonthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  const margin = totals.revenue ? Math.round((totals.net / totals.revenue) * 100) : 0;

  // Compute MoM trend chips and sparklines from the (already filtered) series.
  // We slice to the trailing months that actually have any activity.
  const activeSeries = trimEmpty(series);
  const last = activeSeries[activeSeries.length - 1];
  const prev = activeSeries[activeSeries.length - 2];

  const revenueTrend =
    prev && prev.revenue > 0 ? ((last.revenue - prev.revenue) / prev.revenue) * 100 : null;
  const expenseTrend =
    prev && prev.expense > 0 ? ((last.expense - prev.expense) / prev.expense) * 100 : null;
  const netTrend =
    prev && prev.net !== 0 ? ((last.net - prev.net) / Math.abs(prev.net)) * 100 : null;

  const prevMargin = prev?.revenue ? (prev.net / prev.revenue) * 100 : 0;
  const lastMargin = last?.revenue ? (last.net / last.revenue) * 100 : 0;
  const marginTrend =
    activeSeries.length >= 2 ? lastMargin - prevMargin : null;

  const sparkRevenue = activeSeries.map((s) => s.revenue);
  const sparkExpense = activeSeries.map((s) => s.expense);
  const sparkNet = activeSeries.map((s) => s.net);
  const sparkMargin = activeSeries.map((s) => (s.revenue ? (s.net / s.revenue) * 100 : 0));

  // Build the AI Insights highlights for the elevated strip.
  const highlights = buildHighlights({
    totals,
    services,
    expBreak,
    last,
    prev,
  });

  // Preserve the active period in the export link.
  const exportQs = new URLSearchParams();
  if (searchParams.period) exportQs.set("period", searchParams.period);
  if (searchParams.from) exportQs.set("from", searchParams.from);
  if (searchParams.to) exportQs.set("to", searchParams.to);
  const exportHref = `/api/finance/export${exportQs.toString() ? "?" + exportQs.toString() : ""}`;

  return (
    <>
      <TopBar
        title="Financial Overview"
        subtitle={periodLabel(period)}
        action={
          <div className="flex items-center gap-base">
            <DateFilter />
            <a
              href={exportHref}
              className="inline-flex items-center gap-xs h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold hover:bg-surface-container-low transition"
              title="Download filtered transactions as Excel"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                download
              </span>
              Export
            </a>
          </div>
        }
      />
      <div className="p-margin space-y-lg">
        {/* Hero Net Position card spans full width on lg, alongside compact KPIs */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-gutter">
          <KpiCard
            label={`Current Month Revenue · ${currentMonthLabel}`}
            value={currentMonthTotals.revenue}
            tone="primary"
            hero
            trendPct={currentMonthRevenueTrend}
            hint="Calendar month — independent of the period filter above"
          />
          <KpiCard
            label="Net Position"
            value={totals.net}
            tone={totals.net >= 0 ? "success" : "danger"}
            hero
            trendPct={netTrend}
            sparkline={sparkNet}
            hint={totals.net >= 0 ? "Strong liquidity state" : "Negative cash position"}
          />
          <KpiCard
            label="Total Revenue"
            value={totals.revenue}
            tone="primary"
            trendPct={revenueTrend}
            sparkline={sparkRevenue}
          />
          <KpiCard
            label="Total Expenses"
            value={totals.expense}
            tone="danger"
            trendPct={expenseTrend}
            trendInverted
            sparkline={sparkExpense}
          />
          <KpiCard
            label="Profit Margin"
            value={`${margin}%`}
            trendPct={marginTrend}
            sparkline={sparkMargin}
            hint="Net / Revenue"
          />
        </section>

        {/* As-on-date pace tracker */}
        <PaceTracker pace={paceData} />

        {/* Elevated AI Insights highlights */}
        <section className="bg-brand text-on-brand rounded-xl shadow-sm border-l-4 border-primary p-lg">
          <div className="flex items-center gap-md mb-md">
            <div className="p-sm bg-primary text-on-primary rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                psychology
              </span>
            </div>
            <h3 className="text-h3 font-bold">AI Highlights</h3>
            <Link
              href="/finance/ai-insights"
              className="ml-auto bg-primary text-on-primary hover:bg-primary-container px-md py-xs rounded-lg text-label-sm transition uppercase tracking-widest font-bold"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            {highlights.map((h, i) => (
              <div
                key={i}
                className="bg-brand-elevated/60 border border-brand-line rounded-lg p-md flex gap-md"
              >
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 28 }}>
                  {h.icon}
                </span>
                <div>
                  <p className="font-bold">{h.title}</p>
                  <p className="text-body-md text-on-brand-variant mt-xs">{h.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Sales vs Collections split */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
          <div className="lg:col-span-7">
            <Section
              title="Revenue by Service"
              action={
                <Link className="text-accent text-label-sm font-semibold hover:underline" href="/finance/revenue">
                  View details
                </Link>
              }
            >
              <div className="space-y-lg">
                <div>
                  <div className="flex items-center justify-between mb-base">
                    <h5 className="text-label-sm font-bold uppercase tracking-wider text-accent">
                      Sales (new pipeline)
                    </h5>
                    <span className="text-data-mono text-on-surface">
                      {inr(services.salesTotal)}
                    </span>
                  </div>
                  {services.sales.length ? (
                    <HorizontalBars data={services.sales.slice(0, 5)} />
                  ) : (
                    <Empty>No sales recorded.</Empty>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-base">
                    <h5 className="text-label-sm font-bold uppercase tracking-wider text-accent">
                      Collections (recovery)
                    </h5>
                    <span className="text-data-mono text-on-surface">
                      {inr(services.collectionsTotal)}
                    </span>
                  </div>
                  {services.collections.length ? (
                    <HorizontalBars data={services.collections.slice(0, 5)} />
                  ) : (
                    <Empty>No collections recorded.</Empty>
                  )}
                </div>
              </div>
            </Section>
          </div>
          <div className="lg:col-span-5">
            <Section title="Expense Breakdown">
              {expBreak.length ? (
                <CategoryDonut
                  data={expBreak.slice(0, 6)}
                  centerTotal={totals.expense}
                  centerLabel="Total"
                />
              ) : (
                <Empty>No expenses recorded yet.</Empty>
              )}
            </Section>
          </div>
        </section>

        <Section title="Revenue vs Expenses">
          <MonthlyRevenueExpenseBars data={series} />
        </Section>
      </div>
    </>
  );
}

function trimEmpty<T extends { revenue: number; expense: number }>(series: T[]): T[] {
  // Find the first month with any activity, return the slice up to & including
  // the last month with activity.
  const first = series.findIndex((s) => s.revenue > 0 || s.expense > 0);
  if (first === -1) return series;
  let last = series.length - 1;
  while (last > first && series[last].revenue === 0 && series[last].expense === 0) last--;
  return series.slice(first, last + 1);
}

type Highlight = { icon: string; title: string; body: string };
function buildHighlights(opts: {
  totals: { revenue: number; expense: number; net: number };
  services: { sales: { name: string; value: number }[]; collections: { name: string; value: number }[]; salesTotal: number; collectionsTotal: number };
  expBreak: { name: string; value: number }[];
  last?: { month: string; revenue: number; expense: number; net: number };
  prev?: { month: string; revenue: number; expense: number; net: number };
}): Highlight[] {
  const { totals, services, expBreak, last, prev } = opts;
  const out: Highlight[] = [];

  if (last && prev && prev.revenue > 0) {
    const mom = ((last.revenue - prev.revenue) / prev.revenue) * 100;
    if (Math.abs(mom) >= 5) {
      out.push({
        icon: mom >= 0 ? "trending_up" : "trending_down",
        title: `Revenue ${mom >= 0 ? "up" : "down"} ${Math.abs(mom).toFixed(0)}% MoM`,
        body: `${last.month}: ${inr(last.revenue)} vs ${inr(prev.revenue)} in ${prev.month}.`,
      });
    }
  }

  if (services.sales[0] && services.salesTotal > 0) {
    const share = (services.sales[0].value / services.salesTotal) * 100;
    out.push({
      icon: "donut_large",
      title: `${services.sales[0].name} leads sales`,
      body: `${share.toFixed(0)}% of sales (${inr(services.sales[0].value)}). Watch for concentration risk.`,
    });
  }

  if (expBreak[0] && totals.expense > 0) {
    const share = (expBreak[0].value / totals.expense) * 100;
    out.push({
      icon: "receipt_long",
      title: `${expBreak[0].name} top expense`,
      body: `${share.toFixed(0)}% of spend (${inr(expBreak[0].value)}).`,
    });
  }

  if (totals.revenue > 0) {
    const margin = (totals.net / totals.revenue) * 100;
    if (margin < 0) {
      out.push({
        icon: "warning",
        title: `Operating at a loss: ${margin.toFixed(0)}%`,
        body: `Expenses exceed revenue by ${inr(-totals.net)}.`,
      });
    } else if (margin >= 25 && out.length < 3) {
      out.push({
        icon: "savings",
        title: `Healthy ${margin.toFixed(0)}% net margin`,
        body: `Net ${inr(totals.net)} on ${inr(totals.revenue)} revenue.`,
      });
    }
  }

  while (out.length < 3) {
    out.push({
      icon: "lightbulb",
      title: "Add more transactions",
      body: "More data unlocks deeper insights — try logging this week's entries.",
    });
  }
  return out.slice(0, 3);
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-md text-center text-on-surface-variant text-body-md">{children}</div>;
}
