import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { WeeklyPnlChart } from "@/components/CeoCharts";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { inr, inrFull } from "@/lib/format";
import { fyLabel, parseFy, selectableFys } from "@/lib/fiscal-year";
import { weekChange, weeklyPnl, type WeekRow } from "@/lib/weekly-pnl";
import { FyPicker } from "@/app/(app)/finance/expenses/matrix/client";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "26 Sep" — dates are midnight UTC for the calendar day, so read them in UTC. */
function dayLabel(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function rangeLabel(w: WeekRow): string {
  return `${dayLabel(w.from)} – ${dayLabel(w.to)}`;
}

export default async function WeeklyPnlPage({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!perms.isAdmin) {
    return (
      <>
        <TopBar title="Weekly P&L" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You need admin access to view this page.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const now = new Date();
  const fy = parseFy(searchParams.fy, now);
  const pnl = await weeklyPnl(fy, now);
  const { lastClosed: last, priorClosed: prior, running, total } = pnl;

  const chartData = pnl.weeks
    .slice()
    .reverse()
    .map((w) => ({
      week: dayLabel(w.from),
      range: `${rangeLabel(w)}${w.running ? " (so far)" : ""}`,
      netSales: w.netSales,
      netProfit: w.netProfit,
      netCashFlow: w.netCashFlow,
    }));

  const soFar = (pick: (w: WeekRow) => number) =>
    running ? ` · this week so far ${inr(pick(running))}` : "";

  return (
    <>
      <TopBar
        title="Weekly P&L"
        subtitle={`Net sales, net profit & net cash flow · Saturday → Friday · ${fyLabel(fy)}`}
        action={
          <div className="flex items-center gap-md">
            <Link
              href="/executive/dashboard"
              className="text-accent text-label-sm font-semibold hover:underline"
            >
              ← CEO Dashboard
            </Link>
            <FyPicker fy={fy} years={selectableFys(now)} />
          </div>
        }
      />
      <div className="p-margin space-y-lg">
        {last ? (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
            <KpiCard
              label={`Net Sales · ${rangeLabel(last)}`}
              value={last.netSales}
              tone="primary"
              hero
              trendPct={weekChange(last.netSales, prior?.netSales)}
              hint={`${inr(last.sales)} sales + ${inr(last.collections)} collections${last.otherIncome ? ` + ${inr(last.otherIncome)} other` : ""}${last.refunds ? ` − ${inr(last.refunds)} refunds` : ""}${soFar((w) => w.netSales)}`}
            />
            <KpiCard
              label={`Net Profit · ${rangeLabel(last)}`}
              value={last.netProfit}
              tone={last.netProfit >= 0 ? "success" : "danger"}
              hero
              trendPct={weekChange(last.netProfit, prior?.netProfit)}
              hint={`${last.marginPct === null ? "—" : `${last.marginPct.toFixed(1)}%`} margin · ${inr(last.operatingExpense)} operating expense${soFar((w) => w.netProfit)}`}
            />
            <KpiCard
              label={`Net Cash Flow · ${rangeLabel(last)}`}
              value={last.netCashFlow}
              tone={last.netCashFlow >= 0 ? "success" : "danger"}
              hero
              trendPct={weekChange(last.netCashFlow, prior?.netCashFlow)}
              hint={`Net profit − ${inr(last.nonOperating)} assets & loan repayments${soFar((w) => w.netCashFlow)}`}
            />
          </section>
        ) : (
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              No completed week in {fyLabel(fy)} yet.
            </div>
          </Section>
        )}

        {chartData.length > 0 && (
          <Section title="Week on Week">
            <WeeklyPnlChart data={chartData} />
          </Section>
        )}

        <Section
          title="Weekly Breakdown"
          action={
            <Link
              href="/finance/cashflow"
              className="text-accent text-label-sm font-semibold hover:underline"
            >
              Cash Flow →
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="text-on-surface-variant">
                <tr className="text-left">
                  <Th>Week (Sat – Fri)</Th>
                  <Th right>Sales</Th>
                  <Th right>Collections</Th>
                  <Th right>Other</Th>
                  <Th right>Refunds</Th>
                  <Th right strong>Net Sales</Th>
                  <Th right>Operating Exp.</Th>
                  <Th right strong>Net Profit</Th>
                  <Th right>Margin</Th>
                  <Th right>Assets & Loans</Th>
                  <Th right strong>Net Cash Flow</Th>
                </tr>
              </thead>
              <tbody>
                {pnl.weeks.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-md text-center text-on-surface-variant">
                      {fyLabel(fy)} hasn&apos;t started yet.
                    </td>
                  </tr>
                )}
                {pnl.weeks.map((w) => (
                  <tr key={w.from.toISOString()} className="border-t border-outline-variant/60">
                    <td className="py-sm pr-md whitespace-nowrap font-medium">
                      {rangeLabel(w)}
                      {w.running && <Chip>in progress</Chip>}
                      {w.partial && !w.running && <Chip>part week</Chip>}
                    </td>
                    <Money v={w.sales} />
                    <Money v={w.collections} />
                    <Money v={w.otherIncome} />
                    <Money v={-w.refunds} />
                    <Money v={w.netSales} strong />
                    <Money v={-w.operatingExpense} />
                    <Money v={w.netProfit} strong signed />
                    <td className="py-sm pr-md text-right font-mono whitespace-nowrap">
                      {w.marginPct === null ? "—" : `${w.marginPct.toFixed(1)}%`}
                    </td>
                    <Money v={-w.nonOperating} />
                    <Money v={w.netCashFlow} strong signed />
                  </tr>
                ))}
              </tbody>
              {pnl.weeks.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-outline-variant font-semibold">
                    <td className="py-sm pr-md whitespace-nowrap">{fyLabel(fy)} to date</td>
                    <Money v={total.sales} />
                    <Money v={total.collections} />
                    <Money v={total.otherIncome} />
                    <Money v={-total.refunds} />
                    <Money v={total.netSales} strong />
                    <Money v={-total.operatingExpense} />
                    <Money v={total.netProfit} strong signed />
                    <td className="py-sm pr-md text-right font-mono whitespace-nowrap">
                      {total.marginPct === null ? "—" : `${total.marginPct.toFixed(1)}%`}
                    </td>
                    <Money v={-total.nonOperating} />
                    <Money v={total.netCashFlow} strong signed />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-caption text-on-surface-variant mt-md">
            Net Sales = all revenue − refunds. Net Profit = net sales − operating expenses
            (everything except refunds, asset purchases and loan repayments). Net Cash Flow = all
            money in − all money out, the same figure as the Cash Flow page. Weeks are cut at the
            fiscal-year boundary, so the first and last weeks of a year can be part weeks.
          </p>
        </Section>
      </div>
    </>
  );
}

function Th({
  children,
  right,
  strong,
}: {
  children: React.ReactNode;
  right?: boolean;
  strong?: boolean;
}) {
  return (
    <th
      className={
        "py-sm pr-md text-label-sm uppercase whitespace-nowrap " +
        (right ? "text-right " : "") +
        (strong ? "text-on-surface" : "")
      }
    >
      {children}
    </th>
  );
}

function Money({ v, strong, signed }: { v: number; strong?: boolean; signed?: boolean }) {
  return (
    <td
      className={
        "py-sm pr-md text-right font-mono whitespace-nowrap " +
        (strong ? "font-semibold " : "") +
        (signed && v < 0 ? "text-error" : v === 0 ? "text-on-surface-variant" : "text-on-surface")
      }
    >
      {v === 0 ? "—" : inrFull(Math.round(v))}
    </td>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-sm px-xs py-[2px] rounded bg-surface-container text-[11px] font-semibold text-on-surface-variant">
      {children}
    </span>
  );
}
