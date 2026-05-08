import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { CashflowDualLine, NetCashFlowLine } from "@/components/Charts";
import { monthlySeries, paymentModeMix, totalsByType } from "@/lib/aggregations";
import { inrFull } from "@/lib/format";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";
import { DateFilter } from "@/components/DateFilter";

export const dynamic = "force-dynamic";

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const period = parsePeriod(searchParams);
  const range = rangeFor(period);
  const [totals, series, modes] = await Promise.all([
    totalsByType(range),
    monthlySeries(range),
    paymentModeMix(range),
  ]);
  const positiveMonths = series.filter((s) => s.net > 0).length;
  const negativeMonths = series.filter((s) => s.net < 0).length;

  return (
    <>
      <TopBar title="Cash Flow Statement" subtitle={periodLabel(period)} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
          <KpiCard label="Total Inflow" value={totals.revenue} tone="success" />
          <KpiCard label="Total Outflow" value={totals.expense} tone="danger" />
          <KpiCard
            label="Net Cash"
            value={totals.net}
            tone={totals.net >= 0 ? "success" : "danger"}
            hero
          />
          <KpiCard
            label="Months Positive / Negative"
            value={`${positiveMonths} / ${negativeMonths}`}
            hint="Where net > 0 vs net < 0"
          />
        </section>

        <Section title="Inflow vs Outflow">
          <CashflowDualLine data={series} />
        </Section>

        <Section title="Net Cash Trend">
          <NetCashFlowLine data={series} />
        </Section>

        <Section title="By Payment Mode">
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="text-on-surface-variant">
                <tr className="text-left">
                  <th className="py-sm pr-md text-label-sm uppercase">Mode</th>
                  <th className="py-sm pr-md text-label-sm uppercase text-right">Inflow</th>
                  <th className="py-sm pr-md text-label-sm uppercase text-right">Outflow</th>
                  <th className="py-sm pr-md text-label-sm uppercase text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {modes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-md text-center text-on-surface-variant">
                      No transactions yet.
                    </td>
                  </tr>
                )}
                {modes.map((m) => {
                  const net = m.inflow - m.outflow;
                  return (
                    <tr key={m.mode} className="border-t border-outline-variant/60">
                      <td className="py-sm pr-md font-medium">{m.mode}</td>
                      <td className="py-sm pr-md text-right font-mono text-green-700">
                        {inrFull(m.inflow)}
                      </td>
                      <td className="py-sm pr-md text-right font-mono text-error">
                        {inrFull(m.outflow)}
                      </td>
                      <td
                        className={
                          "py-sm pr-md text-right font-mono " + (net >= 0 ? "text-on-surface" : "text-error")
                        }
                      >
                        {inrFull(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
