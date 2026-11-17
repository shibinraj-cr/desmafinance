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
  asCashSeries,
} from "@/lib/aggregations";
import { GST_BEARING_MODES } from "@/lib/finance-gst";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";
import { DateFilter } from "@/components/DateFilter";
import { PaymentModeFilter } from "@/components/PaymentModeFilter";
import { listParam } from "@/lib/filter-params";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE = "/finance/revenue";

export default async function RevenuePage({
  searchParams,
}: {
  // `mode` is the payment-mode multi-select — one value or several, written
  // as repeated query keys.
  searchParams: { period?: string; from?: string; to?: string; mode?: string | string[] };
}) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, PAGE)) redirect("/finance/overview");

  const period = parsePeriod(searchParams);
  const range = rangeFor(period);
  const modes = listParam(searchParams.mode);

  // Revenue on this page is net of GST. The GST tile is the GST stored on
  // each row (src/lib/finance-gst.ts: Axis/HDFC DOM receipts at 18%), under
  // the same period and payment-mode filter as everything else, so picking
  // Cash or RCS correctly shows none.
  const gstModes = GST_BEARING_MODES.filter((m) => !modes.length || modes.includes(m));
  const [totals, series, byCat, topRev, gstAgg] = await Promise.all([
    totalsByType(range, modes),
    monthlySeries(range, modes),
    revenueByCategory(range, modes),
    topRevenueServices(8, range, modes),
    prisma.transaction.aggregate({
      where: {
        deletedAt: null,
        isHistorical: false,
        type: "Revenue",
        gstAmount: { gt: 0 },
        paymentMode: { in: gstModes },
        ...(range.from || range.to
          ? {
              date: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lt: range.to } : {}),
              },
            }
          : {}),
      },
      _sum: { amount: true, gstAmount: true },
      _count: { _all: true },
    }),
  ]);
  const gstGross = gstAgg._sum.amount ? Number(gstAgg._sum.amount.toString()) : 0;
  const gstLiability = gstAgg._sum.gstAmount ? Number(gstAgg._sum.gstAmount.toString()) : 0;
  const gstCount = gstAgg._count._all;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const mom = prev?.revenue ? Math.round(((last.revenue - prev.revenue) / prev.revenue) * 100) : 0;
  // An empty chart under an active mode filter is a filter result, not an
  // empty ledger — say which it is.
  const emptyMsg = modes.length
    ? `No revenue in ${modes.join(", ")} for this period.`
    : "No revenue yet.";
  const activeMonths = series.filter((s) => s.revenue > 0).length;
  const ytdAvg = activeMonths ? totals.revenue / activeMonths : 0;

  return (
    <>
      <TopBar
        title="Revenue Analysis"
        subtitle={modes.length ? `${periodLabel(period)} · ${modes.join(", ")}` : periodLabel(period)}
        action={
          <>
            <PaymentModeFilter />
            <DateFilter />
          </>
        }
      />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-gutter">
          <KpiCard
            label={`GST Liability · ${periodLabel(period)}`}
            value={gstLiability}
            tone="danger"
            hero
            hint={
              gstModes.length === 0
                ? "No GST-bearing mode in the filter — GST is only charged on Axis Bank / HDFC Bank receipts."
                : gstCount > 0
                  ? `From ${gstCount} DOM bank-mode receipt${gstCount === 1 ? "" : "s"} totalling ₹${Math.round(gstGross).toLocaleString("en-IN")} (${gstModes.join(" + ")}, GST-inclusive @ 18%; EXP excluded)`
                  : `No DOM revenue in ${gstModes.join(" / ")} for this period yet.`
            }
          />
          <KpiCard label="Total Revenue" value={totals.revenue} tone="primary" hero hint="Net of GST" />
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
              {topRev.length ? <HorizontalBars data={topRev} /> : <Empty>{emptyMsg}</Empty>}
            </Section>
          </div>
          <div className="lg:col-span-5">
            <Section title="Revenue Mix by Category">
              {byCat.length ? (
                <CategoryDonut data={byCat} centerTotal={totals.revenue} centerLabel="Total" />
              ) : (
                <Empty>{emptyMsg}</Empty>
              )}
            </Section>
          </div>
        </section>
        <Section title="Inflow vs Outflow (Monthly)">
          {/* Money in and out, GST included: the cash view of the same rows. */}
          <CashflowDualLine data={asCashSeries(series)} />
        </Section>
      </div>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-lg text-center text-on-surface-variant">{children}</div>;
}
