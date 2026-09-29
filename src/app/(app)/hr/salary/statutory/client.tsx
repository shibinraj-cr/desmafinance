"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Rule = {
  id: string;
  code: string;
  wageCeiling: number;
  employeeRatePct: number;
  employerRatePct: number;
  epsRatePct: number;
  epsApplicable: boolean;
  higherWageAllowed: boolean;
  effectiveFrom: string; // yyyy-mm-dd
  effectiveTo: string | null;
  notes: string | null;
  status: "active" | "superseded" | "scheduled";
};

function inr(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function longDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const STATUS_TONE: Record<Rule["status"], string> = {
  active: "bg-green-50 text-green-800",
  superseded: "bg-surface-container text-on-surface-variant",
  scheduled: "bg-blue-50 text-blue-800",
};

const emptyDraft = () => ({
  code: "",
  wageCeiling: "",
  employeeRatePct: "12",
  employerRatePct: "12",
  epsRatePct: "8.33",
  epsApplicable: true,
  higherWageAllowed: true,
  effectiveFrom: "",
  notes: "",
});

export function StatutorySettingsClient({ rules, canEdit }: { rules: Rule[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  const active = rules.find((r) => r.status === "active") ?? null;
  const scheduled = rules.filter((r) => r.status === "scheduled");
  const history = rules.filter((r) => r.status === "superseded");

  async function addRule() {
    setError(null);
    const wageCeiling = Number(draft.wageCeiling);
    if (!(wageCeiling > 0)) {
      setError("Enter a wage ceiling greater than zero.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)) {
      setError("Enter the effective-from date (YYYY-MM-DD).");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/hr/salary/pf-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: draft.code.trim() || undefined,
        wageCeiling,
        employeeRatePct: Number(draft.employeeRatePct) || 12,
        employerRatePct: Number(draft.employerRatePct) || 12,
        epsRatePct: Number(draft.epsRatePct) || 0,
        epsApplicable: draft.epsApplicable,
        higherWageAllowed: draft.higherWageAllowed,
        effectiveFrom: draft.effectiveFrom,
        notes: draft.notes.trim() || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setDraft(emptyDraft());
    setShowAdd(false);
    start(() => router.refresh());
  }

  async function deleteRule(rule: Rule) {
    if (!confirm(`Delete the scheduled rule ${rule.code} (${inr(rule.wageCeiling)} from ${rule.effectiveFrom})? The previous rule becomes open-ended again.`)) return;
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/hr/salary/pf-rules/${rule.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "delete failed");
      return;
    }
    start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {/* Currently active statutory rule, shown prominently. */}
      <Section title="">
        {active ? (
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-md">
            <p className="text-h3 font-extrabold">
              Current statutory PF wage ceiling: {inr(active.wageCeiling)}
            </p>
            <p className="text-label-sm font-bold mt-xs">
              Effective from: {longDate(active.effectiveFrom)}
            </p>
            <p className="text-label-sm text-on-surface-variant mt-sm">
              Employee {active.employeeRatePct}% · Employer {active.employerRatePct}%
              {active.epsApplicable && <> (EPS {active.epsRatePct}% of the ceiling-capped wage, remainder to EPF)</>}
              {" · "}rule {active.code}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 p-md text-red-800 text-label-sm">
            No PF rule is active today — payroll falls back to the built-in ₹15,000 ceiling.
            Run the pending database migration or add a rule below.
          </div>
        )}
        <p className="text-caption text-on-surface-variant mt-sm">
          The payroll engine selects the rule by <b>salary-period date</b>, so historical runs keep
          their historical maths. A period straddling a boundary (the 26 Aug – 25 Sep 2026 cycle
          crosses the 17 Sep 2026 revision) is split into per-rule slices, prorated by calendar
          days, and combined into that month&apos;s PF. Contributions are always{" "}
          <b>eligible wage × rate</b> — the ₹1,800 / ₹3,000 caps are consequences of the ceiling,
          never fixed amounts.
        </p>
        {error && <p className="text-red-700 text-label-sm mt-sm">{error}</p>}
      </Section>

      <Section title="Rules">
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Rule</th>
                <th className="py-sm pr-md">PF Wage Ceiling</th>
                <th className="py-sm pr-md">Employee %</th>
                <th className="py-sm pr-md">Employer %</th>
                <th className="py-sm pr-md">EPS</th>
                <th className="py-sm pr-md">Contribution Basis</th>
                <th className="py-sm pr-md">Higher Wage</th>
                <th className="py-sm pr-md">Effective From</th>
                <th className="py-sm pr-md">Effective To</th>
                <th className="py-sm pr-md">Status</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {[...scheduled, ...(active ? [active] : []), ...history].map((r) => (
                <tr key={r.id} className="border-b border-outline-variant last:border-0">
                  <td className="py-sm pr-md font-semibold whitespace-nowrap">
                    {r.code}
                    {r.notes && (
                      <div className="text-caption text-on-surface-variant max-w-[280px]">{r.notes}</div>
                    )}
                  </td>
                  <td className="py-sm pr-md font-bold">{inr(r.wageCeiling)}</td>
                  <td className="py-sm pr-md">{r.employeeRatePct}%</td>
                  <td className="py-sm pr-md">{r.employerRatePct}%</td>
                  <td className="py-sm pr-md">
                    {r.epsApplicable ? `${r.epsRatePct}%` : "—"}
                  </td>
                  <td className="py-sm pr-md text-on-surface-variant">
                    Statutory ceiling
                    <div className="text-caption">per-employee: actual wages opt-in</div>
                  </td>
                  <td className="py-sm pr-md">{r.higherWageAllowed ? "Allowed" : "No"}</td>
                  <td className="py-sm pr-md whitespace-nowrap">{r.effectiveFrom}</td>
                  <td className="py-sm pr-md whitespace-nowrap">{r.effectiveTo ?? "Active"}</td>
                  <td className="py-sm pr-md">
                    <span
                      className={
                        "inline-block px-sm py-xs rounded font-bold text-caption capitalize " +
                        STATUS_TONE[r.status]
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="py-sm pr-md text-right">
                      {r.status === "scheduled" && (
                        <button
                          onClick={() => deleteRule(r)}
                          disabled={busy || pending}
                          className="text-red-700 underline text-caption disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 11 : 10} className="py-lg text-center text-on-surface-variant">
                    No rules on file.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="mt-md">
            {!showAdd ? (
              <button
                onClick={() => setShowAdd(true)}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold"
              >
                Add effective-dated rule
              </button>
            ) : (
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-sm max-w-[840px]">
                <p className="text-label-sm font-bold">New statutory rule</p>
                <p className="text-caption text-on-surface-variant">
                  The rule takes effect on its effective-from date; the currently open rule is
                  closed the day before automatically. History is append-only — the new date must
                  be after every existing rule&apos;s.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-sm">
                  <label className="flex flex-col gap-xs text-label-sm">
                    <span className="text-caption text-on-surface-variant">Wage ceiling (₹/mo) *</span>
                    <input
                      type="number"
                      min="0"
                      className="px-sm py-xs rounded border border-outline-variant bg-surface"
                      value={draft.wageCeiling}
                      onChange={(e) => setDraft({ ...draft, wageCeiling: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-xs text-label-sm">
                    <span className="text-caption text-on-surface-variant">Effective from *</span>
                    <input
                      type="date"
                      className="px-sm py-xs rounded border border-outline-variant bg-surface"
                      value={draft.effectiveFrom}
                      onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-xs text-label-sm">
                    <span className="text-caption text-on-surface-variant">Employee %</span>
                    <input
                      type="number"
                      step="0.01"
                      className="px-sm py-xs rounded border border-outline-variant bg-surface"
                      value={draft.employeeRatePct}
                      onChange={(e) => setDraft({ ...draft, employeeRatePct: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-xs text-label-sm">
                    <span className="text-caption text-on-surface-variant">Employer %</span>
                    <input
                      type="number"
                      step="0.01"
                      className="px-sm py-xs rounded border border-outline-variant bg-surface"
                      value={draft.employerRatePct}
                      onChange={(e) => setDraft({ ...draft, employerRatePct: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-xs text-label-sm">
                    <span className="text-caption text-on-surface-variant">EPS % (of capped wage)</span>
                    <input
                      type="number"
                      step="0.01"
                      className="px-sm py-xs rounded border border-outline-variant bg-surface"
                      value={draft.epsRatePct}
                      onChange={(e) => setDraft({ ...draft, epsRatePct: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-xs text-label-sm">
                    <span className="text-caption text-on-surface-variant">Code (optional)</span>
                    <input
                      placeholder="PF_RULE_…"
                      className="px-sm py-xs rounded border border-outline-variant bg-surface"
                      value={draft.code}
                      onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                    />
                  </label>
                  <label className="flex items-center gap-xs text-label-sm mt-md">
                    <input
                      type="checkbox"
                      checked={draft.epsApplicable}
                      onChange={(e) => setDraft({ ...draft, epsApplicable: e.target.checked })}
                    />
                    EPS applicable
                  </label>
                  <label className="flex items-center gap-xs text-label-sm mt-md">
                    <input
                      type="checkbox"
                      checked={draft.higherWageAllowed}
                      onChange={(e) => setDraft({ ...draft, higherWageAllowed: e.target.checked })}
                    />
                    Higher-wage contribution allowed
                  </label>
                  <label className="flex flex-col gap-xs text-label-sm col-span-2 md:col-span-4">
                    <span className="text-caption text-on-surface-variant">Notes</span>
                    <input
                      className="px-sm py-xs rounded border border-outline-variant bg-surface"
                      value={draft.notes}
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    />
                  </label>
                </div>
                <div className="flex items-center gap-sm">
                  <button
                    onClick={addRule}
                    disabled={busy || pending}
                    className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
                  >
                    Save rule
                  </button>
                  <button
                    onClick={() => {
                      setShowAdd(false);
                      setDraft(emptyDraft());
                    }}
                    className="px-md py-sm rounded border border-outline-variant"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
