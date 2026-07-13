import { redirect } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
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
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GST liability bake-in rate. Payment modes considered "taxable
 *  banking channels" — Suhaina's spec is: only Axis Bank + HDFC Bank
 *  revenue carries the 18% GST line. Cash / Cheque / other modes are
 *  treated as non-GST for this view. */
const GST_RATE = 0.18;
const GST_TAXABLE_MODES = ["Axis Bank", "HDFC Bank"] as const;

const PAGE = "/finance/revenue";

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, PAGE)) redirect("/finance/overview");

  const period = parsePeriod(searchParams);
  const range = rangeFor(period);

  // GST liability now honours the same period filter as the rest of the
  // page — supervisors can flip to a different month / quarter / FY and
  // the tile recomputes. Two narrowing rules:
  //   - paymentMode must be one of GST_TAXABLE_MODES (Axis / HDFC), AND
  //   - expDom = 'DOM' (Domestic). Exports are GST-exempt for this team.
  const [totals, series, byCat, topRev, gstAgg] = await Promise.all([
    totalsByType(range),
    monthlySeries(range),
    revenueByCategory(range),
    topRevenueServices(8, range),
    prisma.transaction.aggregate({
      where: {
        deletedAt: null,
        type: "Revenue",
        expDom: "DOM",
        paymentMode: { in: [...GST_TAXABLE_MODES] },
        ...(range.from || range.to
          ? {
              date: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lt: range.to } : {}),
              },
            }
          : {}),
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);
  // GST baked into a GST-inclusive amount: liability = total − total/1.18.
  const gstGross = gstAgg._sum.amount ? Number(gstAgg._sum.amount.toString()) : 0;
  const gstBase = gstGross / (1 + GST_RATE);
  const gstLiability = gstGross - gstBase;
  const gstCount = gstAgg._count._all;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const mom = prev?.revenue ? Math.round(((last.revenue - prev.revenue) / prev.revenue) * 100) : 0;
  const activeMonths = series.filter((s) => s.revenue > 0).length;
  const ytdAvg = activeMonths ? totals.revenue / activeMonths : 0;

  return (
    <>
      <TopBar title="Revenue Analysis" subtitle={periodLabel(period)} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-gutter">
          <KpiCard
            label={`GST Liability · ${periodLabel(period)}`}
            value={gstLiability}
            tone="danger"
            hero
            hint={
              gstCount > 0
                ? `From ${gstCount} DOM bank-mode receipt${gstCount === 1 ? "" : "s"} totalling ₹${Math.round(gstGross).toLocaleString("en-IN")} (Axis + HDFC, GST-inclusive @ 18%; EXP excluded)`
                : "No DOM revenue in Axis Bank / HDFC Bank for this period yet."
            }
          />
          <KpiCard label="Total Revenue" value={totals.revenue} tone="primary" hero />
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
              {byCat.length ? (
                <CategoryDonut data={byCat} centerTotal={totals.revenue} centerLabel="Total" />
              ) : (
                <Empty>No revenue yet.</Empty>
              )}
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
