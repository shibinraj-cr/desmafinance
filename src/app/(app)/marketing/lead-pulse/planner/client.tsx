"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlannerBaseline } from "@/lib/lead-pulse-metrics";
import { computePlan } from "@/lib/lead-pulse-planner";
import { ReverseFunnelChart } from "../_charts";
import { Kpi } from "../_kpi";
import { Markdown } from "../_markdown";

type AiResult = { markdown: string; aiEnabled: boolean; model?: string | null };

const round1 = (n: number) => Math.round(n * 10) / 10;
const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const rupee = (n: number) => `₹${inr(n)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;

export function PlannerClient({
  baseline,
  aiEnabled,
}: {
  baseline: PlannerBaseline;
  aiEnabled: boolean;
}) {
  const [target, setTarget] = useState(100);
  const [l2ConvPct, setL2] = useState(round1(baseline.rates.l2ConvPct));
  const [l1ToTransferPct, setL1] = useState(round1(baseline.rates.l1ToTransferPct));

  const plan = useMemo(
    () =>
      computePlan({
        targetClosedWon: target,
        rates: { ...baseline.rates, l2ConvPct, l1ToTransferPct },
        capacity: baseline.capacity,
        roster: baseline.roster,
        meta: {
          costPerQualifiedLead: baseline.meta.costPerQualifiedLead,
          currentQualifiedLeadsPerMonth: baseline.meta.qualifiedLeadsPerMonth,
          currentSpendPerMonth: baseline.meta.spendPerMonth,
        },
      }),
    [target, l2ConvPct, l1ToTransferPct, baseline],
  );

  const dirty =
    l2ConvPct !== round1(baseline.rates.l2ConvPct) ||
    l1ToTransferPct !== round1(baseline.rates.l1ToTransferPct);
  function reset() {
    setL2(round1(baseline.rates.l2ConvPct));
    setL1(round1(baseline.rates.l1ToTransferPct));
  }

  // ── AI panels ───────────────────────────────────────────────────────
  const [rec, setRec] = useState<AiResult | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AiResult | null>(null);
  const [qLoading, setQLoading] = useState(false);

  const scenarioBody = () => ({ target, l2ConvPct, l1ToTransferPct });

  async function generate() {
    setRecLoading(true);
    setRec(null);
    try {
      const res = await fetch("/api/marketing/lead-pulse/planner/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenarioBody()),
      });
      setRec(await res.json());
    } catch {
      setRec({ markdown: "Couldn't reach the planner service. Try again.", aiEnabled: false });
    } finally {
      setRecLoading(false);
    }
  }

  async function ask(q?: string) {
    const question_ = (q ?? question).trim();
    if (!question_) return;
    setQuestion(question_);
    setQLoading(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/marketing/lead-pulse/planner/whatif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scenarioBody(), question: question_ }),
      });
      setAnswer(await res.json());
    } catch {
      setAnswer({ markdown: "Couldn't reach the planner service. Try again.", aiEnabled: false });
    } finally {
      setQLoading(false);
    }
  }

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Growth Planner</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Goal-seek from a target back to the leads & BDEs you need · baseline {baseline.windowLabel}{" "}
            ({baseline.monthsAnalyzed}-mo)
          </p>
        </div>
        <AiBadge live={aiEnabled} />
      </header>

      {plan.warnings.length > 0 && (
        <div
          className="rounded-[12px] border px-[16px] py-[12px] text-[12px] space-y-[4px]"
          style={{
            backgroundColor: "rgba(255,180,171,0.08)",
            borderColor: "var(--lp-error)",
            color: "var(--lp-error)",
          }}
        >
          {plan.warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
        {/* Controls */}
        <Card title="Your goal" className="lg:col-span-1">
          <label className="block text-[11px] uppercase tracking-widest mb-[4px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Target enrollments / month
          </label>
          <input
            type="number"
            min={0}
            max={100000}
            value={target}
            onChange={(e) => setTarget(Math.max(0, Number(e.target.value) || 0))}
            className="w-full h-[44px] px-[12px] rounded-[8px] text-[22px] font-bold tabular-nums mb-[16px]"
            style={{
              backgroundColor: "var(--lp-surface-container-high)",
              color: "var(--lp-primary)",
              border: "1px solid var(--lp-outline-variant)",
            }}
          />

          <Slider
            label="L2 conversion"
            sub="closes ÷ L2 leads"
            value={l2ConvPct}
            onChange={setL2}
            baseline={round1(baseline.rates.l2ConvPct)}
          />
          <Slider
            label="L1 → L2 hand-off"
            sub="transfers ÷ L1 leads"
            value={l1ToTransferPct}
            onChange={setL1}
            baseline={round1(baseline.rates.l1ToTransferPct)}
          />

          {dirty && (
            <button
              onClick={reset}
              className="mt-[4px] text-[12px] underline"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              Reset to historic rates
            </button>
          )}

          <div
            className="mt-[16px] pt-[12px] grid grid-cols-2 gap-[8px] text-[11px] border-t"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}
          >
            <CapacityStat label="Leads / L1 BDE" value={baseline.capacity.leadsPerActiveL1} />
            <CapacityStat label="Closes / L2 BDE" value={baseline.capacity.closesPerActiveL2} />
            <CapacityStat label="Active L1 BDEs" value={baseline.roster.activeL1} />
            <CapacityStat label="Active L2 BDEs" value={baseline.roster.activeL2} />
          </div>
          <p className="mt-[8px] text-[10px]" style={{ color: "var(--lp-on-surface-variant)", opacity: 0.7 }}>
            Per-head capacity is derived from history and held constant.
          </p>
        </Card>

        {/* Reverse funnel */}
        <Card title="What it takes" className="lg:col-span-2">
          <ReverseFunnelChart data={plan.stages.map((s) => ({ name: s.label, value: s.value }))} />
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-[8px] mt-[8px] text-[11px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <MiniStat label="L1 leads" value={plan.requiredL1Leads} />
            <MiniStat label="Direct→L2 leads" value={plan.requiredDirect} />
            <MiniStat label="L2 leads worked" value={plan.requiredL2Leads} />
            <MiniStat label="Enrollments" value={plan.target} />
          </div>
        </Card>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
        <Kpi
          label="Leads needed / month"
          value={inr(plan.requiredTotalLeads)}
          icon="filter_alt"
          subLabel="L2 leads worked"
          subValue={inr(plan.requiredL2Leads)}
        />
        <Kpi
          label="L1 BDEs required"
          value={inr(plan.requiredL1Bdes)}
          icon="diversity_3"
          target={gapText(plan.l1Gap, "L1")}
          subLabel="Active now"
          subValue={inr(baseline.roster.activeL1)}
        />
        <Kpi
          label="L2 BDEs required"
          value={inr(plan.requiredL2Bdes)}
          icon="handshake"
          target={gapText(plan.l2Gap, "L2")}
          subLabel="Active now"
          subValue={inr(baseline.roster.activeL2)}
        />
        <Kpi
          label="Target enrollments"
          value={inr(plan.target)}
          icon="emoji_events"
          subLabel="At L2 conversion"
          subValue={`${l2ConvPct.toFixed(1)}%`}
        />
      </div>

      {/* Meta spend (you enter it) + the blended budget it implies */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
        <MetaSpendEditor baseline={baseline} className="lg:col-span-1" />
        {plan.meta && <MetaBudgetCard meta={plan.meta} baseline={baseline} className="lg:col-span-2" />}
      </div>

      {/* Source recommendation + AI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
        <Card title="Where leads convert (historic)">
          <SourceTable sources={baseline.sources} />
        </Card>

        <Card title="AI recommendation">
          <div className="flex items-center gap-[8px] mb-[10px]">
            <button
              onClick={generate}
              disabled={recLoading}
              className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold disabled:opacity-60"
              style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
            >
              {recLoading ? "Thinking…" : rec ? "Regenerate" : "Generate recommendation"}
            </button>
            {rec && <ResultBadge live={rec.aiEnabled} />}
          </div>
          {rec ? (
            <Markdown text={rec.markdown} />
          ) : (
            <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              Generate an action plan for the current scenario — which sources to scale, hiring needed, and risks.
            </p>
          )}

          {/* What-if */}
          <div className="mt-[16px] pt-[12px] border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
            <p className="text-[11px] uppercase tracking-widest mb-[8px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              Ask a what-if
            </p>
            <div className="flex flex-wrap gap-[6px] mb-[8px]">
              {WHATIF_CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => ask(c)}
                  disabled={qLoading}
                  className="text-[11px] px-[10px] py-[4px] rounded-full border disabled:opacity-60"
                  style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-[8px]">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="e.g. What if I add 2 L1 BDEs?"
                className="flex-1 h-[36px] px-[12px] rounded-[8px] text-[13px]"
                style={{
                  backgroundColor: "var(--lp-surface-container-high)",
                  color: "var(--lp-on-surface)",
                  border: "1px solid var(--lp-outline-variant)",
                }}
              />
              <button
                onClick={() => ask()}
                disabled={qLoading || !question.trim()}
                className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold disabled:opacity-60"
                style={{ backgroundColor: "var(--lp-surface-container-high)", color: "var(--lp-on-surface)", border: "1px solid var(--lp-outline-variant)" }}
              >
                {qLoading ? "…" : "Ask"}
              </button>
            </div>
            {answer && (
              <div className="mt-[10px] flex items-start gap-[8px]">
                <span className="material-symbols-outlined mt-[1px]" style={{ fontSize: 16, color: "var(--lp-primary)" }}>
                  auto_awesome
                </span>
                <div className="flex-1">
                  <Markdown text={answer.markdown} />
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

const WHATIF_CHIPS = [
  "What if I add 2 L1 BDEs?",
  "Which source should I scale first?",
  "How risky is this target?",
];

// ── Small presentational helpers (dark HUD tokens) ────────────────────

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[12px] border p-[20px] ${className ?? ""}`}
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <h2 className="text-[14px] font-semibold mb-[12px]">{title}</h2>
      {children}
    </div>
  );
}

function Slider({
  label,
  sub,
  value,
  onChange,
  baseline,
}: {
  label: string;
  sub: string;
  value: number;
  onChange: (n: number) => void;
  baseline: number;
}) {
  return (
    <div className="mb-[14px]">
      <div className="flex items-baseline justify-between mb-[2px]">
        <span className="text-[12px] font-medium" style={{ color: "var(--lp-on-surface)" }}>
          {label}
        </span>
        <span className="text-[14px] font-bold tabular-nums" style={{ color: "var(--lp-primary)" }}>
          {value.toFixed(1)}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: "var(--lp-primary)" }}
      />
      <div className="flex justify-between text-[10px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        <span>{sub}</span>
        <span>historic {baseline.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function CapacityStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p style={{ opacity: 0.8 }}>{label}</p>
      <p className="text-[15px] font-bold tabular-nums" style={{ color: "var(--lp-on-surface)" }}>
        {value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-[8px] px-[10px] py-[8px]"
      style={{ backgroundColor: "var(--lp-surface-container-low)" }}
    >
      <p style={{ opacity: 0.8 }}>{label}</p>
      <p className="text-[16px] font-bold tabular-nums" style={{ color: "var(--lp-on-surface)" }}>
        {inr(value)}
      </p>
    </div>
  );
}

/**
 * Self-service monthly Meta-spend editor. Each row in the baseline window is an
 * editable ₹ amount; saving POSTs to the meta-spend route and refreshes so the
 * baseline (and the blended cost-per-qualified-lead) recompute. A row with no
 * manual entry shows the Finance-derived figure and a "from Finance" tag.
 */
function MetaSpendEditor({ baseline, className }: { baseline: PlannerBaseline; className?: string }) {
  const router = useRouter();
  const rows = [...baseline.meta.perMonthSpend].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
  // Local draft per "y-m" key; undefined ⇒ show the resolved baseline value.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(year: number, month: number, amount: number | null) {
    const key = `${year}-${month}`;
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/marketing/lead-pulse/planner/meta-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, amount }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDraft((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      router.refresh(); // re-pull baseline → cost-per-qualified-lead updates
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div
      className={`rounded-[12px] border p-[20px] ${className ?? ""}`}
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <div className="flex items-center gap-[8px] mb-[4px]">
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--lp-primary)" }}>
          payments
        </span>
        <h2 className="text-[14px] font-semibold">Monthly Meta spend</h2>
      </div>
      <p className="text-[11px] mb-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        Enter what you spent on Meta each month. Blank months fall back to Finance.
      </p>

      <div className="space-y-[8px]">
        {rows.map((r) => {
          const key = `${r.year}-${r.month}`;
          const draftVal = draft[key];
          const shown = draftVal !== undefined ? draftVal : String(r.amount);
          const dirty = draftVal !== undefined && Number(draftVal || 0) !== r.amount;
          const saving = savingKey === key;
          return (
            <div key={key} className="flex items-center gap-[8px]">
              <span className="text-[12px] w-[64px] shrink-0 tabular-nums" style={{ color: "var(--lp-on-surface)" }}>
                {monthLabel(r.year, r.month)}
              </span>
              <div className="relative flex-1">
                <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                  ₹
                </span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={shown}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && save(r.year, r.month, Math.max(0, Number(shown) || 0))}
                  className="w-full h-[32px] pl-[22px] pr-[8px] rounded-[6px] text-[13px] tabular-nums"
                  style={{
                    backgroundColor: "var(--lp-surface-container-high)",
                    color: "var(--lp-on-surface)",
                    border: "1px solid var(--lp-outline-variant)",
                  }}
                />
              </div>
              <span
                className="text-[9px] uppercase tracking-wide w-[58px] shrink-0 text-center rounded-full px-[6px] py-[2px]"
                style={{
                  color: r.isManual ? "var(--lp-on-primary)" : "var(--lp-on-surface-variant)",
                  backgroundColor: r.isManual ? "var(--lp-primary)" : "var(--lp-surface-container-low)",
                }}
              >
                {r.isManual ? "manual" : "finance"}
              </span>
              <button
                onClick={() => save(r.year, r.month, Math.max(0, Number(shown) || 0))}
                disabled={saving || !dirty}
                className="text-[11px] h-[28px] px-[10px] rounded-[6px] font-semibold disabled:opacity-40"
                style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
              >
                {saving ? "…" : "Save"}
              </button>
              {r.isManual && (
                <button
                  onClick={() => save(r.year, r.month, null)}
                  disabled={saving}
                  title="Revert to the Finance figure"
                  className="text-[11px] h-[28px] px-[8px] rounded-[6px] disabled:opacity-40"
                  style={{ color: "var(--lp-on-surface-variant)", border: "1px solid var(--lp-outline-variant)" }}
                >
                  ↺
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="mt-[8px] text-[11px]" style={{ color: "var(--lp-error)" }}>
          {error}
        </p>
      )}

      <p className="mt-[12px] pt-[10px] text-[11px] border-t" style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}>
        Blended <strong>cost / qualified lead</strong> ={" "}
        {baseline.meta.costPerQualifiedLead != null ? rupee(baseline.meta.costPerQualifiedLead) : "—"} ={" "}
        {rupee(baseline.meta.spendPerMonth)}/mo ÷ {inr(baseline.meta.qualifiedLeadsPerMonth)} qualified leads/mo
        ({baseline.windowLabel}).
      </p>
    </div>
  );
}

function MetaBudgetCard({
  meta,
  baseline,
  className,
}: {
  meta: NonNullable<ReturnType<typeof computePlan>["meta"]>;
  baseline: PlannerBaseline;
  className?: string;
}) {
  const hasCpl = meta.costPerQualifiedLead != null && meta.requiredBudgetPerMonth != null;
  const delta = meta.budgetDeltaPerMonth;
  return (
    <div
      className={`rounded-[12px] border p-[20px] ${className ?? ""}`}
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-primary)",
        boxShadow: "var(--lp-glow)",
      }}
    >
      <div className="flex items-center gap-[8px] mb-[12px]">
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--lp-primary)" }}>
          ads_click
        </span>
        <h2 className="text-[14px] font-semibold">Meta ad budget — your growth lever</h2>
      </div>

      {!hasCpl ? (
        <p className="text-[13px]" style={{ color: "var(--lp-error)" }}>
          Hitting this target needs <strong>{inr(meta.requiredQualifiedLeadsPerMonth)} qualified leads/month</strong>,
          but no Meta spend is recorded for the {baseline.windowLabel} window yet — so the cost per qualified lead
          can’t be derived. Enter this month’s Meta spend on the left to size the budget.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-[12px]">
          <BudgetStat
            label="Required Meta budget / mo"
            value={rupee(meta.requiredBudgetPerMonth ?? 0)}
            hero
          />
          <BudgetStat label="Qualified leads needed / mo" value={inr(meta.requiredQualifiedLeadsPerMonth)} />
          <BudgetStat label="Cost / qualified lead" value={rupee(meta.costPerQualifiedLead ?? 0)} />
          <BudgetStat
            label="vs current spend"
            value={
              delta == null
                ? "—"
                : delta === 0
                  ? "no change"
                  : `${delta > 0 ? "+" : "−"}${rupee(Math.abs(delta))}`
            }
            tone={delta == null || delta === 0 ? "neutral" : delta > 0 ? "up" : "down"}
          />
        </div>
      )}

      <p className="mt-[12px] text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        Qualified leads = every lead L2 works (from L1 + direct). Currently {inr(meta.currentQualifiedLeadsPerMonth)}{" "}
        qualified leads/mo at {rupee(meta.currentSpendPerMonth)}/mo ({baseline.windowLabel} avg).
      </p>
    </div>
  );
}

function BudgetStat({
  label,
  value,
  hero,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hero?: boolean;
  tone?: "neutral" | "up" | "down";
}) {
  const color =
    tone === "up" ? "var(--lp-error)" : tone === "down" ? "var(--lp-cyan)" : hero ? "var(--lp-primary)" : "var(--lp-on-surface)";
  return (
    <div
      className="rounded-[8px] px-[12px] py-[10px]"
      style={{ backgroundColor: "var(--lp-surface-container-low)" }}
    >
      <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
        {label}
      </p>
      <p
        className={`${hero ? "text-[24px]" : "text-[18px]"} font-bold tabular-nums mt-[2px]`}
        style={{ color }}
      >
        {value}
      </p>
    </div>
  );
}

function SourceTable({ sources }: { sources: PlannerBaseline["sources"] }) {
  const rows = sources.filter((s) => s.avgMonthlyLeads > 0);
  if (rows.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        No source history yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="text-left" style={{ color: "var(--lp-on-surface-variant)" }}>
            <th className="font-semibold py-[4px]">Source</th>
            <th className="font-semibold py-[4px] text-right">Leads / mo</th>
            <th className="font-semibold py-[4px] text-right">L2 conv.</th>
            <th className="font-semibold py-[4px] text-right">Won / mo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.sourceCode} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
              <td className="py-[6px]" style={{ color: "var(--lp-on-surface)" }}>{s.sourceLabel}</td>
              <td className="py-[6px] text-right">{inr(s.avgMonthlyLeads)}</td>
              <td
                className="py-[6px] text-right font-semibold"
                style={{
                  color:
                    s.l2ConversionPct == null
                      ? "var(--lp-on-surface-variant)"
                      : s.l2ConversionPct >= 20
                        ? "var(--lp-primary)"
                        : s.l2ConversionPct < 8
                          ? "var(--lp-error)"
                          : "var(--lp-on-surface)",
                }}
              >
                {s.l2ConversionPct == null ? "—" : `${s.l2ConversionPct.toFixed(1)}%`}
              </td>
              <td className="py-[6px] text-right">{s.avgMonthlyWon == null ? "—" : inr(s.avgMonthlyWon)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function gapText(gap: number, role: string): string {
  if (gap > 0) return `Hire ${gap} more ${role}`;
  if (gap < 0) return `${Math.abs(gap)} ${role} spare`;
  return `On target`;
}

function AiBadge({ live }: { live: boolean }) {
  return (
    <span
      className="text-[11px] px-[10px] py-[4px] rounded-full inline-flex items-center gap-[6px]"
      style={{
        backgroundColor: live ? "rgba(51,228,255,0.14)" : "var(--lp-surface-container-high)",
        color: live ? "var(--lp-cyan)" : "var(--lp-on-surface-variant)",
      }}
      title={live ? "Claude is connected" : "No ANTHROPIC_API_KEY — using built-in analysis"}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        {live ? "auto_awesome" : "memory"}
      </span>
      {live ? "AI online" : "AI offline · built-in"}
    </span>
  );
}

function ResultBadge({ live }: { live: boolean }) {
  return (
    <span
      className="text-[10px] px-[8px] py-[2px] rounded-full"
      style={{
        backgroundColor: live ? "rgba(51,228,255,0.14)" : "var(--lp-surface-container-high)",
        color: live ? "var(--lp-cyan)" : "var(--lp-on-surface-variant)",
      }}
    >
      {live ? "Claude" : "Built-in analysis"}
    </span>
  );
}
