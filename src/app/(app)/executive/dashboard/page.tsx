import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { KpiCard, Section } from "@/components/Cards";
import { RevenueExpenseNetChart, EnrollmentsChart } from "@/components/CeoCharts";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import {
  ceoHeadline,
  fyMonthlySeries,
  forecastFromSeries,
  orgHealth,
} from "@/lib/ceo-dashboard";
import { inr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ExecutiveDashboardPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!perms.isAdmin) {
    return (
      <>
        <TopBar title="CEO Dashboard" />
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

  const [headline, series] = await Promise.all([ceoHeadline(), fyMonthlySeries()]);
  const forecast = forecastFromSeries(series);
  const health = await orgHealth(series);

  const payrollTrendPct =
    health.previousMonthPayroll > 0
      ? ((health.currentMonthPayroll - health.previousMonthPayroll) /
          health.previousMonthPayroll) *
        100
      : null;

  return (
    <>
      <TopBar
        title="CEO Dashboard"
        subtitle="Marketing · Finance · HR · Real-time"
        action={
          <span className="text-caption text-on-surface-variant">
            FY 2026-27
          </span>
        }
      />
      <div className="p-margin space-y-lg">
        {/* Row 1 — Headline KPIs */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
          <KpiCard
            label={`Current Month Revenue · ${headline.currentMonthLabel}`}
            value={headline.currentMonthRevenue}
            tone="primary"
            hero
            trendPct={headline.currentMonthRevenueTrendPct}
            hint={`vs ${inr(headline.previousMonthRevenue)} last month`}
          />
          <KpiCard
            label="Expected Collections"
            value={headline.expectedCollections}
            tone="success"
            hero
            hint={`${headline.expectedCollectionsCount} installments pending / submitted`}
          />
          <KpiCard
            label="Pipeline Value (Open)"
            value={headline.pipelineValue}
            tone="primary"
            hero
            hint={`${headline.pipelineCount} open deals across L2 BDEs`}
          />
          <KpiCard
            label="Total Pending"
            value={headline.totalPending}
            tone="default"
            hero
            hint={`Collections + open pipeline · ${headline.pendingApprovalsCount} approvals queued`}
          />
        </section>

        {/* Row 2 — Forecast strip */}
        <section className="bg-brand text-on-brand rounded-xl shadow-sm border-l-4 border-primary p-lg">
          <div className="flex flex-wrap items-center gap-md mb-md">
            <div className="p-sm bg-primary text-on-primary rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                insights
              </span>
            </div>
            <div>
              <h3 className="text-h3 font-bold">End-of-FY Forecast</h3>
              <p className="text-caption text-on-brand-variant">
                Run-rate projection from {forecast.completedMonths} completed month
                {forecast.completedMonths === 1 ? "" : "s"} · {forecast.monthsRemaining} month
                {forecast.monthsRemaining === 1 ? "" : "s"} remaining
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            <ForecastTile
              icon="payments"
              label="Projected FY Revenue"
              value={inr(forecast.projectedFyRevenue)}
              detail={`YTD ${inr(forecast.ytdRevenue)} · avg ${inr(forecast.avgMonthlyRevenue)}/mo`}
            />
            <ForecastTile
              icon="school"
              label="Projected FY Enrollments"
              value={String(forecast.projectedFyEnrollments)}
              detail={`YTD ${forecast.ytdEnrollments} · avg ${forecast.avgMonthlyEnrollments.toFixed(1)}/mo`}
            />
            <ForecastTile
              icon="trending_up"
              label="Run-Rate Trajectory"
              value={
                forecast.completedMonths > 0
                  ? `${inr(forecast.avgMonthlyRevenue * 12)}/yr`
                  : "—"
              }
              detail={
                forecast.completedMonths > 0
                  ? "Annualised from completed months only"
                  : "Need at least one completed month"
              }
            />
          </div>
        </section>

        {/* Row 3 — Trend charts */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
          <div className="lg:col-span-2">
            <Section
              title="Month-on-Month — Revenue, Expense, Net"
              action={
                <Link
                  href="/finance/overview"
                  className="text-accent text-label-sm font-semibold hover:underline"
                >
                  Finance Overview →
                </Link>
              }
            >
              <RevenueExpenseNetChart data={series} />
            </Section>
          </div>
          <div className="lg:col-span-1">
            <Section
              title="Enrollments (MoM)"
              action={
                <Link
                  href="/marketing/lead-pulse"
                  className="text-accent text-label-sm font-semibold hover:underline"
                >
                  Lead Pulse →
                </Link>
              }
            >
              <EnrollmentsChart data={series} />
            </Section>
          </div>
        </section>

        {/* Row 4 — Org Health snapshot */}
        <Section title="Organisational Health Snapshot">
          <div className="flex flex-col lg:flex-row gap-lg">
            <div className="flex-shrink-0 flex flex-col items-center justify-center bg-surface-container rounded-xl p-lg w-full lg:w-56">
              <p className="text-caption text-on-surface-variant uppercase tracking-wider">
                Health Score
              </p>
              <p
                className={
                  "text-[56px] leading-none font-bold mt-xs " +
                  scoreColor(health.healthScore)
                }
              >
                {health.healthScore}
              </p>
              <p className="mt-xs text-label-sm font-semibold">{health.healthSummary}</p>
              <p className="text-caption text-on-surface-variant mt-xs text-center">
                Margin × conversion × payroll load
              </p>
            </div>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-md">
              <HealthStat
                icon="groups"
                label="Headcount"
                value={String(health.headcount)}
                detail={`${health.marketingHeadcount} active in Marketing`}
              />
              <HealthStat
                icon="payments"
                label={`Payroll · ${headline.currentMonthLabel}`}
                value={inr(health.currentMonthPayroll)}
                detail={
                  payrollTrendPct === null
                    ? `YTD ${inr(health.ytdPayroll)}`
                    : `${payrollTrendPct >= 0 ? "▲" : "▼"} ${Math.abs(payrollTrendPct).toFixed(1)}% MoM · YTD ${inr(health.ytdPayroll)}`
                }
              />
              <HealthStat
                icon="receipt_long"
                label="Top Expense (YTD)"
                value={health.topExpenseCategory?.name ?? "—"}
                detail={
                  health.topExpenseCategory
                    ? inr(health.topExpenseCategory.value)
                    : "No expenses recorded"
                }
              />
              <HealthStat
                icon="percent"
                label="Net Margin (YTD)"
                value={
                  health.netMarginPct === null
                    ? "—"
                    : `${health.netMarginPct.toFixed(1)}%`
                }
                detail="Net / Revenue across the FY"
              />
              <HealthStat
                icon="trending_up"
                label="Lead → Close Conversion"
                value={
                  health.funnelConversionPct === null
                    ? "—"
                    : `${health.funnelConversionPct.toFixed(1)}%`
                }
                detail="L2 closed_won ÷ leads (FY)"
              />
              <HealthStat
                icon="schedule_send"
                label="Receivables Coverage"
                value={
                  headline.currentMonthRevenue > 0
                    ? `${(headline.expectedCollections / headline.currentMonthRevenue).toFixed(1)}× MTD`
                    : "—"
                }
                detail={`${inr(headline.expectedCollections)} expected vs ${inr(headline.currentMonthRevenue)} realised`}
              />
            </div>
          </div>
        </Section>

        {/* Row 5 — Cross-module quicklinks */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          <QuickLink
            href="/finance/overview"
            icon="account_balance"
            title="Finance"
            body="Revenue, expenses, cash flow, daily tracker."
          />
          <QuickLink
            href="/marketing/lead-pulse"
            icon="campaign"
            title="Marketing"
            body="Lead Pulse funnel, pipeline, BDE performance."
          />
          <QuickLink
            href="/finance/collection-plan"
            icon="schedule_send"
            title="Collections"
            body="Staged installments awaiting collection."
          />
        </section>
      </div>
    </>
  );
}

function ForecastTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-brand-elevated/60 border border-brand-line rounded-lg p-md flex gap-md">
      <span className="material-symbols-outlined text-primary" style={{ fontSize: 28 }}>
        {icon}
      </span>
      <div>
        <p className="text-label-sm uppercase tracking-wider text-on-brand-variant">{label}</p>
        <p className="text-h3 font-bold mt-xs">{value}</p>
        <p className="text-caption text-on-brand-variant mt-xs">{detail}</p>
      </div>
    </div>
  );
}

function HealthStat({
  icon,
  label,
  value,
  detail,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-md flex gap-md">
      <span className="material-symbols-outlined text-accent" style={{ fontSize: 24 }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</p>
        <p className="text-h3 font-semibold truncate">{value}</p>
        <p className="text-caption text-on-surface-variant mt-xs">{detail}</p>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex gap-md hover:border-primary transition group"
    >
      <span
        className="material-symbols-outlined text-primary group-hover:scale-110 transition"
        style={{ fontSize: 32 }}
      >
        {icon}
      </span>
      <div>
        <p className="text-h3 font-bold">{title}</p>
        <p className="text-body-md text-on-surface-variant">{body}</p>
      </div>
    </Link>
  );
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-green-700";
  if (score >= 55) return "text-accent";
  if (score >= 35) return "text-amber-600";
  return "text-error";
}
