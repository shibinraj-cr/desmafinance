import { redirect } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  expenseBreakdown,
  monthlySeries,
  topRevenueServices,
  totalsByType,
} from "@/lib/aggregations";
import { inr } from "@/lib/format";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";
import { DateFilter } from "@/components/DateFilter";
import { pace, deltaPct, type Pace } from "@/lib/pace";

export const dynamic = "force-dynamic";

type Insight = {
  tone: "info" | "good" | "warn" | "alert";
  icon: string;
  title: string;
  body: string;
};

function buildInsights(opts: {
  totals: { revenue: number; expense: number; net: number };
  series: { month: string; revenue: number; expense: number; net: number }[];
  topRev: { name: string; value: number }[];
  expBreak: { name: string; value: number }[];
  pace: Pace;
}): Insight[] {
  const { totals, series, topRev, expBreak, pace: p } = opts;
  const out: Insight[] = [];

  // Pace cards lead the list when there is at least one prior month — they're
  // the most actionable signal for the team this week.
  if (p.revenue.priorMonthCount > 0 && !p.revenue.isFirstMonth) {
    const r = p.revenue;
    const dPrev = deltaPct(r.thisMtd, r.prevMtd);
    if (dPrev !== null) {
      const tone: Insight["tone"] = dPrev >= 5 ? "good" : dPrev <= -5 ? "warn" : "info";
      out.push({
        tone,
        icon: dPrev >= 0 ? "trending_up" : "trending_down",
        title: `Revenue pace: ${r.thisMonthLabel} 1–${r.asOfDay} vs ${r.prevMonthLabel} 1–${r.asOfDay}`,
        body: `So far this month: ${inr(r.thisMtd)}. Same window in ${r.prevMonthLabel}: ${inr(r.prevMtd ?? 0)}. ${dPrev >= 0 ? "Up" : "Down"} ${Math.abs(dPrev).toFixed(1)}% on a calendar-fair basis.`,
      });
    }
    const dAvg = deltaPct(r.thisMtd, r.trailingAvg);
    if (dAvg !== null) {
      const tone: Insight["tone"] = dAvg >= 5 ? "good" : dAvg <= -5 ? "warn" : "info";
      out.push({
        tone,
        icon: "insights",
        title: `Pace vs trailing ${r.priorMonthCount}-month average`,
        body: `${r.thisMonthLabel} 1–${r.asOfDay}: ${inr(r.thisMtd)}. Trailing avg of the same window across ${r.priorMonthCount} prior month${r.priorMonthCount === 1 ? "" : "s"}: ${inr(r.trailingAvg ?? 0)}. ${dAvg >= 0 ? "Up" : "Down"} ${Math.abs(dAvg).toFixed(1)}%.`,
      });
    }
  }

  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last && prev && prev.revenue > 0) {
    const mom = ((last.revenue - prev.revenue) / prev.revenue) * 100;
    if (mom >= 5) {
      out.push({
        tone: "good",
        icon: "trending_up",
        title: `Revenue up ${mom.toFixed(0)}% MoM`,
        body: `${last.month} delivered ${inr(last.revenue)} vs ${inr(prev.revenue)} in ${prev.month}. Sustain the channels driving this growth.`,
      });
    } else if (mom <= -5) {
      out.push({
        tone: "warn",
        icon: "trending_down",
        title: `Revenue down ${Math.abs(mom).toFixed(0)}% MoM`,
        body: `${last.month} fell to ${inr(last.revenue)} from ${inr(prev.revenue)} in ${prev.month}. Investigate the slowing service line.`,
      });
    }
  }

  if (topRev[0] && totals.revenue) {
    const share = (topRev[0].value / totals.revenue) * 100;
    if (share >= 30) {
      out.push({
        tone: share >= 50 ? "warn" : "info",
        icon: "donut_large",
        title: `${topRev[0].name} drives ${share.toFixed(0)}% of revenue`,
        body:
          share >= 50
            ? "Concentration risk — consider diversifying service offerings to de-risk the pipeline."
            : "This service is the strongest revenue lever. Prioritize marketing & ops capacity here.",
      });
    }
  }

  if (expBreak[0] && totals.expense) {
    const share = (expBreak[0].value / totals.expense) * 100;
    out.push({
      tone: "info",
      icon: "receipt_long",
      title: `${expBreak[0].name} is the largest expense (${share.toFixed(0)}%)`,
      body: `Spend in ${expBreak[0].name} totals ${inr(expBreak[0].value)} so far. Benchmark this against revenue contribution.`,
    });
  }

  if (totals.revenue) {
    const margin = (totals.net / totals.revenue) * 100;
    if (margin >= 25) {
      out.push({
        tone: "good",
        icon: "savings",
        title: `Healthy net margin: ${margin.toFixed(0)}%`,
        body: `Net of ${inr(totals.net)} on ${inr(totals.revenue)} of revenue. Reinvestment headroom is available.`,
      });
    } else if (margin < 0) {
      out.push({
        tone: "alert",
        icon: "warning",
        title: `Operating at a loss: ${margin.toFixed(0)}%`,
        body: `Expenses are exceeding revenue by ${inr(-totals.net)}. Review the largest categories and renegotiate where possible.`,
      });
    }
  }

  if (out.length === 0) {
    out.push({
      tone: "info",
      icon: "lightbulb",
      title: "Add transactions to unlock insights",
      body: "Once a few weeks of data is recorded, you will see month-over-month trends, concentration risks, and margin signals here.",
    });
  }
  return out;
}

const TONE_CLS: Record<Insight["tone"], string> = {
  info: "border-primary-fixed-dim bg-primary-fixed/40 text-accent",
  good: "border-green-200 bg-green-50 text-green-800",
  warn: "border-amber-300 bg-amber-50 text-amber-800",
  alert: "border-red-300 bg-red-50 text-red-800",
};

const PAGE = "/finance/ai-insights";

export default async function AiInsightsPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const perms = await getCurrentUserPermissions();
  if (!perms) redirect("/login");
  if (!canSeePage(perms, PAGE)) redirect("/finance/overview");

  const period = parsePeriod(searchParams);
  const range = rangeFor(period);
  const [totals, series, topRev, expBreak, paceData] = await Promise.all([
    totalsByType(range),
    monthlySeries(range),
    topRevenueServices(5, range),
    expenseBreakdown(8, range),
    pace(),
  ]);
  const insights = buildInsights({ totals, series, topRev, expBreak, pace: paceData });

  return (
    <>
      <TopBar title="AI Insights" subtitle={periodLabel(period)} action={<DateFilter />} />
      <div className="p-margin space-y-lg">
        <section className="bg-brand text-on-brand p-lg rounded-xl shadow-sm flex items-center gap-lg border-l-4 border-primary">
          <div className="p-md bg-primary text-on-primary rounded-full">
            <span className="material-symbols-outlined" style={{ fontSize: 32 }}>psychology</span>
          </div>
          <div>
            <h3 className="text-h3 font-bold">Snapshot</h3>
            <p className="text-body-md text-on-brand-variant">
              Revenue {inr(totals.revenue)} • Expenses {inr(totals.expense)} • Net {inr(totals.net)}
            </p>
          </div>
        </section>

        <Section title="Insights">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
            {insights.map((i, idx) => (
              <div key={idx} className={"rounded-xl border p-md flex gap-md " + TONE_CLS[i.tone]}>
                <span className="material-symbols-outlined" style={{ fontSize: 28 }}>
                  {i.icon}
                </span>
                <div>
                  <p className="font-bold">{i.title}</p>
                  <p className="text-body-md opacity-90 mt-xs">{i.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
