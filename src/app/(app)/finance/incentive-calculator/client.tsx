"use client";

import { useCallbackRef } from "./use-callback-ref";
import { useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "@/components/TopBar";
import {
  computeIncentive,
  DEFAULT_BDES,
  DEFAULT_RULES,
  type DistMethod,
  type IncentiveBdeRow,
  type IncentivePlanData,
  type IncentiveRules,
} from "@/lib/incentive";

const rupee = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
// Enrolment counts can be fractional (e.g. 12.5) — show the decimal only when
// there is one, and strip float noise.
const qtyFmt = (n: number) => String(Math.round((n || 0) * 100) / 100);

type SaveState = "idle" | "saving" | "saved" | "error";

const NEW = "__new__";

export function IncentiveCalculator({
  initialPeriod,
  initialPlan,
  initialPeriods,
}: {
  initialPeriod: string;
  initialPlan: IncentivePlanData | null;
  initialPeriods: string[];
}) {
  const [period, setPeriod] = useState(initialPeriod);
  const [rules, setRules] = useState<IncentiveRules>(initialPlan ?? DEFAULT_RULES);
  const [bdes, setBdes] = useState<IncentiveBdeRow[]>(
    initialPlan ? initialPlan.bdes : DEFAULT_BDES.map((b) => ({ ...b })),
  );
  const [periods, setPeriods] = useState<string[]>(
    initialPeriods.includes(initialPeriod) ? initialPeriods : [initialPeriod, ...initialPeriods],
  );
  const [saveState, setSaveState] = useState<SaveState>(initialPlan ? "saved" : "idle");
  const [creating, setCreating] = useState(false);
  const [newPeriod, setNewPeriod] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const computed = useMemo(() => computeIncentive(rules, bdes), [rules, bdes]);
  const animatedGrand = useCountUp(computed.grand);

  // ---- explicit save (via the Save button) --------------------------------
  // `dirty` = there are edits not yet persisted. The Save button is the
  // primary, deliberate save; we also save before switching months and warn
  // on tab close so nothing is silently lost.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const latest = useRef({ period, rules, bdes });
  latest.current = { period, rules, bdes };
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = useCallbackRef(async () => {
    const { period, rules, bdes } = latest.current;
    setSaveState("saving");
    try {
      const res = await fetch("/api/finance/incentive-plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          period,
          ...rules,
          bdes: bdes.map((b) => ({
            name: (b.name || "").trim() || "BDE",
            minimum: b.minimum,
            target: b.target,
            enrol: b.enrol,
            fast48: b.fast48,
            selfRef: b.selfRef,
          })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { periods?: string[] } = await res.json();
      if (data.periods) setPeriods(data.periods);
      setSaveState("saved");
      setDirty(false);
    } catch {
      setSaveState("error");
    }
  });

  // Warn before leaving the tab with unsaved edits; best-effort save on unmount.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (dirtyRef.current) void doSave();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [doSave]);

  // ---- celebration when the team target flips to met ----------------------
  const prevTeamHit = useRef(computed.teamHit);
  useEffect(() => {
    if (computed.teamHit && !prevTeamHit.current) {
      setCelebrate(true);
      showToast("Team target met — pool unlocked");
      const t = setTimeout(() => setCelebrate(false), 1500);
      prevTeamHit.current = computed.teamHit;
      return () => clearTimeout(t);
    }
    prevTeamHit.current = computed.teamHit;
  }, [computed.teamHit]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  // ---- edit handlers ------------------------------------------------------
  function patchRules(patch: Partial<IncentiveRules>) {
    setRules((r) => ({ ...r, ...patch }));
    setDirty(true);
  }
  function patchBde(i: number, patch: Partial<IncentiveBdeRow>) {
    setBdes((list) => list.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
    setDirty(true);
  }
  function addBde() {
    setBdes((list) => [
      ...list,
      { name: "New BDE", minimum: 8, target: 14, enrol: 0, fast48: 0, selfRef: 0 },
    ]);
    setDirty(true);
  }
  function removeBde(i: number) {
    setBdes((list) => list.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  // ---- period switching ---------------------------------------------------
  async function loadPeriod(p: string) {
    // Persist current edits before leaving this month so they aren't lost.
    if (dirtyRef.current) await doSave();
    setSaveState("saving");
    try {
      const res = await fetch(`/api/finance/incentive-plan?period=${encodeURIComponent(p)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { plan: IncentivePlanData | null; periods: string[] } = await res.json();
      setPeriod(p);
      if (data.plan) {
        setRules(extractRules(data.plan));
        setBdes(data.plan.bdes);
        setSaveState("saved");
      } else {
        setRules({ ...DEFAULT_RULES });
        setBdes(DEFAULT_BDES.map((b) => ({ ...b })));
        setSaveState("idle");
      }
      setDirty(false);
      setPeriods((prev) => (prev.includes(p) ? prev : [p, ...prev]));
    } catch {
      setSaveState("error");
    }
  }

  function onSelectPeriod(value: string) {
    if (value === NEW) {
      setCreating(true);
      setNewPeriod("");
      return;
    }
    if (value !== period) void loadPeriod(value);
  }

  function confirmNewPeriod() {
    const p = newPeriod.trim();
    setCreating(false);
    if (!p || p === period) return;
    void loadPeriod(p);
  }

  // ---- copy summary -------------------------------------------------------
  function copySummary() {
    const c = rules;
    let s = `BDE INCENTIVE — ${period}\nDesma International\n\n`;
    computed.rows.forEach((r) => {
      s += `${r.name}: ${qtyFmt(r.enrol)} enrolments\n`;
      s += `  Enrolment incentive: ${rupee(r.enrolPay)} (@ ${rupee(r.rate)}${r.boost ? " boosted" : ""})\n`;
      s += `  Target bonus: ${rupee(r.tgtPay)}${r.tgtMet ? "" : " (not met)"}\n`;
      s += `  ≤48h closes (${r.fast48 || 0}): ${rupee(r.fastPay)}\n`;
      s += `  Self-ref closes (${r.selfRef || 0}): ${rupee(r.refPay)}\n`;
      s += `  Team share: ${rupee(r.teamShare)}\n`;
      s += `  TOTAL: ${rupee(r.total)}\n\n`;
    });
    s += `Team target: ${qtyFmt(computed.totalEnrol)}/${qtyFmt(c.teamTarget)} — ${computed.teamHit ? "MET" : "not met"}\n`;
    s += `GRAND TOTAL: ${rupee(computed.grand)}\n`;
    navigator.clipboard?.writeText(s).then(
      () => showToast("Summary copied to clipboard"),
      () => showToast("Copy failed"),
    );
  }

  const teamPct =
    rules.teamTarget > 0 ? Math.min(100, (computed.totalEnrol / rules.teamTarget) * 100) : 0;

  return (
    <>
      <TopBar
        title="Incentive Calculator"
        subtitle="L2 · BDE"
        action={
          <div className="flex items-center gap-base flex-wrap justify-end">
            <SaveButton dirty={dirty} state={saveState} onClick={() => doSave()} />
            {creating ? (
              <div className="flex items-center gap-xs">
                <input
                  autoFocus
                  value={newPeriod}
                  onChange={(e) => setNewPeriod(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmNewPeriod();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  placeholder="e.g. July 2026"
                  className="h-9 w-36 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={confirmNewPeriod}
                  className="h-9 w-9 grid place-items-center rounded-lg bg-primary text-on-primary"
                  title="Create period"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    check
                  </span>
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="h-9 w-9 grid place-items-center rounded-lg border border-outline-variant text-on-surface-variant"
                  title="Cancel"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    close
                  </span>
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 18 }}>
                  calendar_month
                </span>
                <select
                  value={period}
                  onChange={(e) => onSelectPeriod(e.target.value)}
                  className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  {periods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value={NEW}>＋ New month…</option>
                </select>
              </label>
            )}
            <ActionBtn icon="content_copy" label="Copy" onClick={copySummary} />
            <ActionBtn icon="print" label="Print" onClick={() => window.print()} />
          </div>
        }
      />

      <div className="p-margin space-y-lg">
        {/* HERO: total payout + team meter */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-gutter">
          <div
            className={
              "lg:col-span-3 p-lg rounded-xl shadow-sm border bg-surface-container-lowest transition-all " +
              (celebrate
                ? "border-primary ring-2 ring-primary/40"
                : "border-outline-variant border-l-4 border-l-primary")
            }
          >
            <p className="text-label-sm uppercase tracking-wider text-on-surface-variant flex items-center gap-xs">
              <span className="w-[6px] h-[6px] rounded-full bg-primary inline-block" />
              Total payout · {period}
            </p>
            <div className="text-accent font-extrabold leading-none mt-sm" style={{ fontSize: "clamp(40px,6vw,64px)" }}>
              {rupee(animatedGrand)}
            </div>
            <p className="text-body-md text-on-surface-variant mt-sm">
              <b className="text-on-surface">{computed.rows.length}</b> BDE
              {computed.rows.length !== 1 ? "s" : ""} ·{" "}
              <b className="text-on-surface">{qtyFmt(computed.totalEnrol)}</b> enrolment
              {computed.totalEnrol !== 1 ? "s" : ""} this period
            </p>
          </div>

          <div className="lg:col-span-2 p-lg rounded-xl shadow-sm border border-outline-variant bg-surface-container-lowest flex flex-col">
            <div className="flex items-center justify-between mb-md">
              <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                Team target
              </span>
              {computed.teamHit ? (
                <span className="inline-flex items-center gap-xs text-[11px] font-bold px-sm py-[3px] rounded-full bg-primary text-on-primary">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                    check
                  </span>
                  Target met
                </span>
              ) : (
                <span className="text-[11px] font-bold px-sm py-[3px] rounded-full border border-outline-variant text-on-surface-variant">
                  {qtyFmt(Math.max(0, rules.teamTarget - computed.totalEnrol))} to go
                </span>
              )}
            </div>
            <div className="h-3 rounded-full bg-surface-container-high overflow-hidden border border-outline-variant">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${teamPct}%` }}
              />
            </div>
            <div className="flex items-baseline justify-between mt-sm">
              <span className="text-body-md text-on-surface-variant">
                <b className="text-on-surface text-data-mono">{qtyFmt(computed.totalEnrol)}</b> of{" "}
                {qtyFmt(rules.teamTarget)} enrolments
              </span>
              <span className="text-accent font-semibold text-body-md">
                {computed.teamHit && rules.teamPool > 0
                  ? `${rupee(rules.teamPool)} unlocked`
                  : rules.teamPool > 0
                    ? `${rupee(rules.teamPool)} on the line`
                    : ""}
              </span>
            </div>
          </div>
        </section>

        {/* RULES */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg">
          <div className="flex items-center gap-sm mb-lg">
            <span className="w-7 h-7 grid place-items-center rounded-md border border-primary text-accent text-data-mono font-bold">
              1
            </span>
            <h3 className="text-h3 font-bold">Rules for this month</h3>
            <span className="ml-auto text-caption text-on-surface-variant hidden md:block max-w-[46ch] text-right">
              Editable every month — adjust and everything recalculates. All figures in ₹.
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-md">
            <RuleField label="Base rate / enrolment" prefix="₹">
              <NumInput value={rules.baseRate} onChange={(v) => patchRules({ baseRate: v })} hasPrefix />
            </RuleField>
            <RuleField label="Boost threshold" hint="Reach this many → higher rate on every enrolment.">
              <NumInput value={rules.boostThreshold} onChange={(v) => patchRules({ boostThreshold: v })} decimal />
            </RuleField>
            <RuleField label="Boosted rate / enrolment" prefix="₹">
              <NumInput value={rules.boostRate} onChange={(v) => patchRules({ boostRate: v })} hasPrefix />
            </RuleField>
            <RuleField label="Individual target bonus" prefix="₹" hint="Flat bonus when a BDE hits their own target.">
              <NumInput value={rules.individualBonus} onChange={(v) => patchRules({ individualBonus: v })} hasPrefix />
            </RuleField>
            <RuleField label="≤48h close bonus" prefix="₹" hint="Per lead closed within 48 hours.">
              <NumInput value={rules.fastBonus} onChange={(v) => patchRules({ fastBonus: v })} hasPrefix />
            </RuleField>
            <RuleField label="Self-reference bonus" prefix="₹" hint="Per self-sourced candidate reference closed.">
              <NumInput value={rules.refBonus} onChange={(v) => patchRules({ refBonus: v })} hasPrefix />
            </RuleField>
            <RuleField label="Team target (enrolments)" hint="Combined enrolments across all BDEs.">
              <NumInput value={rules.teamTarget} onChange={(v) => patchRules({ teamTarget: v })} decimal />
            </RuleField>
            <RuleField label="Team pool (if met)" prefix="₹">
              <NumInput value={rules.teamPool} onChange={(v) => patchRules({ teamPool: v })} hasPrefix />
            </RuleField>
            <div className="col-span-2">
              <RuleField label="Team pool split logic">
                <select
                  value={rules.distMethod}
                  onChange={(e) => patchRules({ distMethod: e.target.value as DistMethod })}
                  className="w-full h-11 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="equal">Equal — split evenly among all BDEs</option>
                  <option value="enrolments">By contribution — share of total enrolments</option>
                  <option value="achievers">Among achievers — only those who hit their target</option>
                </select>
              </RuleField>
            </div>
          </div>

          <label className="flex items-center gap-md mt-lg pt-lg border-t border-dashed border-outline-variant cursor-pointer">
            <Switch checked={rules.requireMin} onChange={(v) => patchRules({ requireMin: v })} />
            <span>
              <b className="text-body-md font-bold">Gate enrolment incentive on the minimum</b>
              <span className="block text-caption text-on-surface-variant mt-[2px] max-w-[74ch]">
                ON = a BDE earns ₹0 in enrolment incentive until they clear their minimum. OFF =
                they earn from enrolment #1.
              </span>
            </span>
          </label>
        </section>

        {/* ROSTER */}
        <section>
          <div className="flex items-center gap-sm mb-md">
            <span className="w-7 h-7 grid place-items-center rounded-md border border-primary text-accent text-data-mono font-bold">
              2
            </span>
            <h3 className="text-h3 font-bold">Team &amp; payouts</h3>
            <span className="ml-auto text-caption text-on-surface-variant hidden md:block max-w-[46ch] text-right">
              Set each person&apos;s minimum &amp; target, then enter what they achieved — payouts
              update live.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">
            {computed.rows.map((r, i) => (
              <BdeCard
                key={bdes[i]?.id ?? i}
                row={r}
                rules={rules}
                onPatch={(patch) => patchBde(i, patch)}
                onRemove={() => removeBde(i)}
              />
            ))}
          </div>

          <button
            onClick={addBde}
            className="mt-md w-full py-md rounded-xl border-[1.5px] border-dashed border-outline-variant text-accent font-semibold flex items-center justify-center gap-xs hover:bg-primary/5 hover:border-primary transition"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              add
            </span>
            Add BDE
          </button>
        </section>

        <footer className="pt-lg border-t border-outline-variant text-caption text-on-surface-variant text-center leading-relaxed">
          <span className="text-accent font-semibold">Desma International</span> · BDE Incentive
          Calculator — all rules editable each month. Click Save to persist · copy a summary or
          print a clean payout report for finance.
        </footer>
      </div>

      {/* toast */}
      <div
        className={
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-xs px-lg py-sm rounded-full bg-brand text-on-brand border border-primary/40 text-body-md font-semibold shadow-2xl transition-all duration-200 " +
          (toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none")
        }
      >
        <span className="w-[7px] h-[7px] rounded-full bg-primary inline-block" />
        {toast}
      </div>
    </>
  );
}

// ---- pieces ---------------------------------------------------------------

function BdeCard({
  row,
  rules,
  onPatch,
  onRemove,
}: {
  row: ReturnType<typeof computeIncentive>["rows"][number];
  rules: IncentiveRules;
  onPatch: (patch: Partial<IncentiveBdeRow>) => void;
  onRemove: () => void;
}) {
  const domain = Math.max(row.target || 0, rules.boostThreshold || 0, row.enrol, 1);
  const fillPct = Math.min(100, (row.enrol / domain) * 100);
  const targetPct = row.target > 0 ? Math.min(100, (row.target / domain) * 100) : null;
  const boostPct = rules.boostThreshold > 0 ? Math.min(100, (rules.boostThreshold / domain) * 100) : null;

  return (
    <div
      className={
        "relative p-lg rounded-xl shadow-sm border bg-surface-container-lowest flex flex-col transition-all " +
        (row.boost ? "border-primary ring-1 ring-primary/20" : "border-outline-variant")
      }
    >
      <div className="flex items-center gap-sm mb-md">
        <input
          value={row.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Name"
          className="flex-1 min-w-0 text-h3 font-bold bg-transparent border-b border-transparent focus:border-primary outline-none py-[2px]"
        />
        <button
          onClick={onRemove}
          title="Remove"
          className="w-8 h-8 grid place-items-center rounded-md border border-outline-variant text-on-surface-variant hover:border-error hover:text-error transition"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            close
          </span>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-sm mb-sm">
        <Mini label="Minimum" value={row.minimum} onChange={(v) => onPatch({ minimum: v })} decimal />
        <Mini label="Target" value={row.target} onChange={(v) => onPatch({ target: v })} decimal />
        <Mini label="Achieved" value={row.enrol} onChange={(v) => onPatch({ enrol: v })} accent big decimal />
      </div>
      <div className="grid grid-cols-2 gap-sm mb-md">
        <Mini label="Closed ≤48h" value={row.fast48} onChange={(v) => onPatch({ fast48: v })} gold />
        <Mini label="Self-ref close" value={row.selfRef} onChange={(v) => onPatch({ selfRef: v })} gold />
      </div>

      {/* progress to target / boost */}
      <div className="relative h-9 mb-md">
        <div className="absolute left-0 right-0 top-3 h-2 rounded-full bg-surface-container-high border border-outline-variant overflow-hidden">
          <div
            className={"h-full rounded-full transition-all duration-500 " + (row.boost ? "bg-primary" : "bg-primary-container")}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        {targetPct !== null && (
          <Marker pct={targetPct} label="Target" tone="muted" />
        )}
        {boostPct !== null && (
          <Marker pct={boostPct} label="★ Boost" tone="gold" below />
        )}
      </div>

      {/* badges */}
      <div className="flex flex-wrap gap-xs mb-md">
        <Badge tone={row.minMet ? "met" : "off"}>
          {row.minMet ? "✓ Min met" : `Below min · ${qtyFmt(row.minimum)}`}
        </Badge>
        {row.boost && <Badge tone="boost">★ Boost rate</Badge>}
        <Badge tone={row.tgtMet ? "met" : "off"}>
          {row.tgtMet ? "✓ Target met" : `Target ${qtyFmt(row.target)}`}
        </Badge>
      </div>

      {/* ledger */}
      <div className="border-t border-outline-variant pt-sm mt-auto space-y-[2px]">
        <LedgerLine label={`Enrolments × ${rupee(row.rate)}${row.gated ? " (gated)" : ""}`} value={rupee(row.enrolPay)} />
        <LedgerLine label="Individual target bonus" value={rupee(row.tgtPay)} muted={!row.tgtMet} />
        <LedgerLine label={`≤48h closes × ${rupee(rules.fastBonus)}`} value={rupee(row.fastPay)} muted={row.fastPay <= 0} />
        <LedgerLine label={`Self-ref close × ${rupee(rules.refBonus)}`} value={rupee(row.refPay)} muted={row.refPay <= 0} />
        <LedgerLine label="Team pool share" value={rupee(row.teamShare)} muted={row.teamShare <= 0} />
        <div className="flex items-baseline justify-between pt-sm mt-xs border-t border-outline-variant">
          <span className="font-bold text-body-md">Total payout</span>
          <span className="text-accent font-bold text-data-mono" style={{ fontSize: 22 }}>
            {rupee(row.total)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Marker({
  pct,
  label,
  tone,
  below,
}: {
  pct: number;
  label: string;
  tone: "muted" | "gold";
  below?: boolean;
}) {
  const color = tone === "gold" ? "text-accent" : "text-on-surface-variant";
  const tick = tone === "gold" ? "bg-primary" : "bg-outline";
  return (
    <div
      className="absolute top-1 flex flex-col items-center -translate-x-1/2"
      style={{ left: `${pct}%` }}
    >
      {!below && <span className={"text-[8.5px] font-bold uppercase tracking-wide whitespace-nowrap " + color}>{label}</span>}
      <span className={"w-[2px] h-[18px] rounded " + tick} />
      {below && <span className={"text-[8.5px] font-bold uppercase tracking-wide whitespace-nowrap " + color}>{label}</span>}
    </div>
  );
}

function LedgerLine({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={"flex items-baseline justify-between gap-sm text-body-md " + (muted ? "opacity-50" : "")}>
      <span className="text-on-surface-variant min-w-0 leading-tight">{label}</span>
      <span className="text-data-mono text-on-surface whitespace-nowrap">{value}</span>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "met" | "boost" | "off" }) {
  const cls =
    tone === "boost"
      ? "bg-primary text-on-primary border-transparent"
      : tone === "met"
        ? "bg-primary/10 text-accent border-primary/40"
        : "bg-surface-container border-outline-variant text-on-surface-variant";
  return (
    <span className={"text-[10px] font-bold uppercase tracking-wide px-sm py-[3px] rounded-full border " + cls}>
      {children}
    </span>
  );
}

function Mini({
  label,
  value,
  onChange,
  accent,
  gold,
  big,
  decimal,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  accent?: boolean;
  gold?: boolean;
  big?: boolean;
  /** Allow fractional values (e.g. .5 enrolments). */
  decimal?: boolean;
}) {
  return (
    <label className="block">
      <span
        className={
          "block text-[9.5px] font-bold uppercase tracking-wide text-center mb-xs " +
          (accent || gold ? "text-accent" : "text-on-surface-variant")
        }
      >
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={0}
        step={decimal ? 0.5 : 1}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(decimal ? toNum(e.target.value) : toInt(e.target.value))}
        className={
          "w-full text-center text-data-mono rounded-lg border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 py-sm " +
          (big ? "font-bold text-[17px]" : "")
        }
      />
    </label>
  );
}

function RuleField({
  label,
  prefix,
  hint,
  children,
}: {
  label: string;
  prefix?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-on-surface-variant mb-xs">
        {label}
      </span>
      <div className="relative">
        {prefix && (
          <span className="absolute left-md top-1/2 -translate-y-1/2 text-data-mono text-on-surface-variant pointer-events-none">
            {prefix}
          </span>
        )}
        {children}
      </div>
      {hint && <p className="text-caption text-on-surface-variant mt-xs leading-tight">{hint}</p>}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  hasPrefix,
  decimal,
}: {
  value: number;
  onChange: (v: number) => void;
  hasPrefix?: boolean;
  /** Allow fractional values (e.g. .5 enrolments). */
  decimal?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      step={decimal ? 0.5 : 1}
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => onChange(decimal ? toNum(e.target.value) : toInt(e.target.value))}
      className={
        "w-full h-11 rounded-lg border border-outline-variant bg-surface-container-lowest text-data-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 " +
        (hasPrefix ? "pl-[26px] pr-md" : "px-md")
      }
    />
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        "relative w-12 h-7 rounded-full border transition flex-none " +
        (checked ? "bg-primary border-transparent" : "bg-surface-container-high border-outline-variant")
      }
    >
      <span
        className={
          "absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all " +
          (checked ? "left-[23px]" : "left-[3px]")
        }
      />
    </button>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-xs h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold hover:bg-surface-container-low transition"
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function SaveButton({
  dirty,
  state,
  onClick,
}: {
  dirty: boolean;
  state: SaveState;
  onClick: () => void;
}) {
  const saving = state === "saving";
  // Needs saving when there are edits, the plan was never saved, or a prior
  // save failed (retry). When clean & saved, the button is a passive "Saved".
  const needsSave = dirty || state === "idle" || state === "error";
  const enabled = !saving && needsSave;

  const label = saving
    ? "Saving…"
    : dirty
      ? "Save changes"
      : state === "error"
        ? "Retry save"
        : state === "idle"
          ? "Save"
          : "Saved";
  const icon = saving ? "cloud_sync" : !needsSave ? "cloud_done" : state === "error" ? "error" : "save";

  const tone = saving
    ? "bg-surface-container text-on-surface-variant cursor-wait"
    : needsSave
      ? "bg-primary text-on-primary hover:brightness-95 shadow-sm"
      : "bg-surface-container-low text-on-surface-variant cursor-default";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      title={needsSave ? "Save this plan" : "All changes saved"}
      className={"inline-flex items-center gap-xs h-9 px-md rounded-lg text-label-sm font-semibold transition " + tone}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

// ---- helpers --------------------------------------------------------------

function toInt(raw: string): number {
  if (raw === "") return 0;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Like toInt but keeps decimals (snapped to 2 dp) — for fractional enrolments.
function toNum(raw: string): number {
  if (raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function extractRules(p: IncentivePlanData): IncentiveRules {
  return {
    baseRate: p.baseRate,
    boostThreshold: p.boostThreshold,
    boostRate: p.boostRate,
    individualBonus: p.individualBonus,
    fastBonus: p.fastBonus,
    refBonus: p.refBonus,
    teamTarget: p.teamTarget,
    teamPool: p.teamPool,
    distMethod: p.distMethod,
    requireMin: p.requireMin,
  };
}

function useCountUp(target: number): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) {
      setVal(target);
      return;
    }
    const dur = 500;
    const start = performance.now();
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setVal(from + (target - from) * ease(p));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target]);
  return val;
}
