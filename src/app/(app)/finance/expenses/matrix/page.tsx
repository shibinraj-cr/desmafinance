import { redirect } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { KpiCard } from "@/components/Cards";
import { inr } from "@/lib/format";
import { expenseMatrix, matrixHighlights } from "@/lib/expense-matrix";
import {
  FY_MONTH_SHORT,
  fyLabel,
  fyMonthLabels,
  parseFy,
  selectableFys,
} from "@/lib/fiscal-year";
import { ExpenseMatrixView, FyPicker } from "./client";

export const dynamic = "force-dynamic";

const PAGE = "/finance/expenses/matrix";

export default async function ExpenseMatrixPage({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, PAGE)) redirect("/finance/overview");

  const now = new Date();
  const fy = parseFy(searchParams.fy, now);
  const matrix = await expenseMatrix(fy, now);
  const { peak, mover } = matrixHighlights(matrix);

  const posted = matrix.postedMonths;
  const windowLabel =
    posted === 0
      ? "no months posted yet"
      : posted === 12
        ? "full year"
        : `Apr–${FY_MONTH_SHORT[posted - 1]} posted, ${posted} of 12 months`;

  const monthTotals = matrix.monthTotals.filter((v): v is number => v !== null);

  // Stand-ins for the year-on-year tiles while there is only one year of
  // ledger. `Top 3 share` is the same measure the Expense Tracker reports, so
  // the two pages cannot disagree about concentration.
  const biggest = matrix.rows.find((r) => !r.isOther) ?? null;
  const top3 = matrix.rows
    .filter((r) => !r.isOther)
    .slice(0, 3)
    .reduce((s, r) => s + r.total, 0);
  const top3Pct = matrix.total ? Math.round((top3 / matrix.total) * 100) : 0;

  return (
    <>
      <TopBar
        title="Expense Matrix"
        subtitle={`${fyLabel(fy)} · ${windowLabel}`}
        action={<FyPicker fy={fy} years={selectableFys(now)} />}
      />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
          <KpiCard
            label={posted === 12 ? "Spend this FY" : "Spend this FY to date"}
            value={matrix.total}
            tone="danger"
            hero
            hint={`${matrix.categoryCount} ${matrix.categoryCount === 1 ? "category" : "categories"}`}
            sparkline={monthTotals.length > 1 ? monthTotals : undefined}
          />
          {/* Until a second year is in the ledger the year-on-year tiles have
              nothing to say, so the slots carry within-year facts instead of
              two em-dashes. They swap back on their own once the comparison
              becomes real. */}
          {matrix.hasPrior ? (
            <>
              <KpiCard
                label={posted === 12 ? `Same year, ${fyLabel(fy - 1)}` : "Same period last FY"}
                value={matrix.priorTotal ?? "—"}
                trendPct={matrix.changePct}
                trendInverted
                hint="Like-for-like — the same months, a year earlier"
              />
              <KpiCard
                label="Fastest-growing category"
                value={mover ? mover.name : "—"}
                trendPct={mover?.changePct ?? null}
                trendInverted
                hint={
                  mover
                    ? `Now ${inr(mover.total)} against the same months last FY`
                    : "Needs a comparable year to rank growth"
                }
              />
            </>
          ) : (
            <>
              <KpiCard
                label="Biggest category"
                value={biggest ? biggest.name : "—"}
                hint={
                  biggest && matrix.total
                    ? `${inr(biggest.total)} · ${Math.round((biggest.total / matrix.total) * 100)}% of spend`
                    : `No comparison yet — ${fyLabel(fy - 1)} is not in the ledger`
                }
              />
              <KpiCard
                label="Top 3 share"
                value={`${top3Pct}%`}
                hint="Concentration of spend"
              />
            </>
          )}
          <KpiCard
            label="Heaviest month"
            value={peak ? peak.amount : "—"}
            hint={
              peak
                ? `${fyMonthLabels(fy)[peak.monthIndex]} · led by ${peak.leader}`
                : "No spend posted this year"
            }
          />
        </section>

        <ExpenseMatrixView
          matrix={matrix}
          fyName={fyLabel(fy)}
          priorFyName={fyLabel(fy - 1)}
          monthLabels={fyMonthLabels(fy)}
          priorMonthLabels={fyMonthLabels(fy - 1)}
        />
      </div>
    </>
  );
}
