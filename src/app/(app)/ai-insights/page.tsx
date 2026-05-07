import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import {
  expenseBreakdown,
  monthlySeries,
  topRevenueServices,
  totalsByType,
} from "@/lib/aggregations";
import { inr } from "@/lib/format";

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
}): Insight[] {
  const { totals, series, topRev, expBreak } = opts;
  const out: Insight[] = [];

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

export default async function AiInsightsPage() {
  const [totals, series, topRev, expBreak] = await Promise.all([
    totalsByType(),
    monthlySeries(),
    topRevenueServices(5),
    expenseBreakdown(8),
  ]);
  const insights = buildInsights({ totals, series, topRev, expBreak });

  return (
    <>
      <TopBar title="AI Insights" subtitle="Auto-generated from your transaction history" />
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
