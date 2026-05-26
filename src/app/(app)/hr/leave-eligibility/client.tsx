"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type EmpRow = {
  id: string;
  empCode: string;
  name: string;
  joinDate: string | null;
  eligibility: {
    enabled: boolean;
    frequency: string;
    effectiveFrom: string;
    leavesPerPeriod: number;
    leaveType: string;
    carryForward: boolean;
    carryForwardCap: number;
    expiryMonths: number | null;
    notes: string | null;
  } | null;
};

type AccrualRow = {
  id: string;
  empCode: string;
  name: string;
  periodKey: string;
  delta: number;
  source: string;
  leaveType: string;
  reason: string | null;
  createdAt: string;
};

export function LeaveEligibilityClient({
  canEdit,
  employees,
  recent,
}: {
  canEdit: boolean;
  employees: EmpRow[];
  recent: AccrualRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accrualBusy, setAccrualBusy] = useState(false);
  const [accrualResult, setAccrualResult] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState(new Date().toISOString().slice(0, 7));
  const [adjust, setAdjust] = useState<{ employeeId: string; delta: number; reason: string } | null>(
    null,
  );

  async function runAccrual() {
    if (!confirm(`Run monthly accrual for ${periodKey}? This is idempotent — already-credited employees will be skipped.`)) return;
    setAccrualBusy(true);
    setAccrualResult(null);
    try {
      const res = await fetch("/api/hr/leave-accrual/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setAccrualResult(`Credited ${data.credited} · skipped ${data.skipped} · total ${data.totalDelta.toFixed(1)} days`);
      router.refresh();
    } catch (e) {
      setAccrualResult(e instanceof Error ? e.message : "Failed");
    } finally {
      setAccrualBusy(false);
    }
  }

  async function submitAdjustment() {
    if (!adjust) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/hr/leave-accrual/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adjust),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      setAdjust(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="Run monthly accrual"
        action={
          <div className="flex items-center gap-sm">
            <input
              type="month"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              className="bg-surface-container border border-outline-variant rounded-lg px-sm py-xs text-label-sm"
            />
            <button
              type="button"
              onClick={runAccrual}
              disabled={!canEdit || accrualBusy}
              className="px-md py-xs rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
            >
              {accrualBusy ? "Running…" : "Run accrual"}
            </button>
          </div>
        }
      >
        <p className="text-label-sm text-on-surface-variant">
          Credits each eligible employee&apos;s monthly allocation. Safe to re-run — already-credited
          employees for this period are skipped. Use the adjustment dialog for one-off corrections.
        </p>
        {accrualResult && (
          <p className="mt-base text-label-sm font-semibold">{accrualResult}</p>
        )}
      </Section>

      <Section title="Employee eligibility">
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm">
            <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
              <tr>
                <th className="px-sm py-xs text-left">Employee</th>
                <th className="px-sm py-xs text-left">Status</th>
                <th className="px-sm py-xs text-right">/ month</th>
                <th className="px-sm py-xs text-left">Type</th>
                <th className="px-sm py-xs text-left">Effective</th>
                <th className="px-sm py-xs text-left">Carry</th>
                <th className="px-sm py-xs text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-outline-variant">
                  <td className="px-sm py-xs">
                    <span className="font-semibold">{e.empCode}</span> · {e.name}
                  </td>
                  <td className="px-sm py-xs">
                    {e.eligibility?.enabled ? (
                      <span className="px-xs py-[1px] bg-green-100 text-green-800 rounded text-caption font-semibold uppercase">
                        Active
                      </span>
                    ) : (
                      <span className="text-on-surface-variant text-caption">Not configured</span>
                    )}
                  </td>
                  <td className="px-sm py-xs text-right tabular-nums">
                    {e.eligibility ? e.eligibility.leavesPerPeriod.toFixed(1) : "—"}
                  </td>
                  <td className="px-sm py-xs">{e.eligibility?.leaveType ?? "—"}</td>
                  <td className="px-sm py-xs text-on-surface-variant">
                    {e.eligibility?.effectiveFrom ?? "—"}
                  </td>
                  <td className="px-sm py-xs text-on-surface-variant">
                    {e.eligibility?.carryForward
                      ? `Yes (max ${e.eligibility.carryForwardCap.toFixed(0)})`
                      : "No"}
                  </td>
                  <td className="px-sm py-xs text-right">
                    {canEdit && (
                      <span className="inline-flex gap-xs">
                        <button
                          type="button"
                          onClick={() => setEditing(e.id)}
                          className="px-sm py-[2px] rounded bg-primary text-on-primary text-caption"
                        >
                          {e.eligibility ? "Edit" : "Configure"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAdjust({ employeeId: e.id, delta: 0, reason: "" })}
                          className="px-sm py-[2px] rounded bg-surface-container-high text-on-surface text-caption"
                        >
                          Adjust
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Recent ledger entries">
        {recent.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No accruals yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
                <tr>
                  <th className="px-sm py-xs text-left">When</th>
                  <th className="px-sm py-xs text-left">Employee</th>
                  <th className="px-sm py-xs text-left">Period</th>
                  <th className="px-sm py-xs text-right">Δ</th>
                  <th className="px-sm py-xs text-left">Source</th>
                  <th className="px-sm py-xs text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t border-outline-variant">
                    <td className="px-sm py-xs text-on-surface-variant">
                      {new Date(r.createdAt).toLocaleString("en-IN")}
                    </td>
                    <td className="px-sm py-xs">
                      <span className="font-semibold">{r.empCode}</span> · {r.name}
                    </td>
                    <td className="px-sm py-xs">{r.periodKey}</td>
                    <td className={`px-sm py-xs text-right font-semibold ${r.delta < 0 ? "text-error" : "text-green-700"}`}>
                      {r.delta > 0 ? "+" : ""}
                      {r.delta.toFixed(1)}
                    </td>
                    <td className="px-sm py-xs">
                      <span className="px-xs py-[1px] bg-surface-container-high rounded text-caption uppercase">
                        {r.source}
                      </span>
                    </td>
                    <td className="px-sm py-xs text-on-surface-variant">{r.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {editing && (
        <EligibilityModal
          employee={employees.find((e) => e.id === editing)!}
          busy={busy}
          err={err}
          onClose={() => {
            setEditing(null);
            setErr(null);
          }}
          onSave={async (values) => {
            setBusy(true);
            setErr(null);
            try {
              const res = await fetch(`/api/hr/leave-eligibility/${editing}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values),
              });
              if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error ?? "Failed");
              }
              setEditing(null);
              router.refresh();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {adjust && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-md">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg w-full max-w-md space-y-base">
            <h3 className="text-h3">Manual adjustment</h3>
            <p className="text-label-sm text-on-surface-variant">
              Adjust {employees.find((e) => e.id === adjust.employeeId)?.empCode}&apos;s leave
              balance. Positive credits days; negative deducts.
            </p>
            <label className="block space-y-xs">
              <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                Delta (days)
              </span>
              <input
                type="number"
                step="0.5"
                value={adjust.delta}
                onChange={(e) => setAdjust({ ...adjust, delta: Number(e.target.value) })}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
              />
            </label>
            <label className="block space-y-xs">
              <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                Reason
              </span>
              <input
                type="text"
                value={adjust.reason}
                onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
              />
            </label>
            {err && <p className="text-error text-label-sm">{err}</p>}
            <div className="flex justify-end gap-sm">
              <button
                type="button"
                onClick={() => {
                  setAdjust(null);
                  setErr(null);
                }}
                className="px-md py-sm rounded-lg text-on-surface-variant"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !adjust.reason || adjust.delta === 0}
                onClick={submitAdjustment}
                className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EligibilityModal({
  employee,
  busy,
  err,
  onClose,
  onSave,
}: {
  employee: EmpRow;
  busy: boolean;
  err: string | null;
  onClose: () => void;
  onSave: (values: {
    enabled: boolean;
    frequency: "monthly";
    effectiveFrom: string;
    leavesPerPeriod: number;
    leaveType: "CL" | "SL" | "PL";
    carryForward: boolean;
    carryForwardCap: number;
    expiryMonths: number | null;
    notes: string | null;
  }) => Promise<void>;
}) {
  const initial = employee.eligibility ?? {
    enabled: true,
    frequency: "monthly",
    effectiveFrom: employee.joinDate ?? new Date().toISOString().slice(0, 10),
    leavesPerPeriod: 1,
    leaveType: "CL",
    carryForward: true,
    carryForwardCap: 12,
    expiryMonths: null,
    notes: null,
  };
  const [v, setV] = useState({
    enabled: initial.enabled,
    frequency: "monthly" as const,
    effectiveFrom: initial.effectiveFrom,
    leavesPerPeriod: initial.leavesPerPeriod,
    leaveType: (initial.leaveType as "CL" | "SL" | "PL") ?? "CL",
    carryForward: initial.carryForward,
    carryForwardCap: initial.carryForwardCap,
    expiryMonths: initial.expiryMonths,
    notes: initial.notes,
  });
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-md">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg w-full max-w-md space-y-base">
        <h3 className="text-h3">{employee.empCode} · {employee.name}</h3>
        <label className="flex items-center gap-sm">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => setV({ ...v, enabled: e.target.checked })}
          />
          <span className="font-semibold">Enable monthly leave eligibility</span>
        </label>
        <div className="grid grid-cols-2 gap-base">
          <label className="block space-y-xs">
            <span className="text-caption uppercase tracking-wider text-on-surface-variant">
              Effective from
            </span>
            <input
              type="date"
              value={v.effectiveFrom}
              onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </label>
          <label className="block space-y-xs">
            <span className="text-caption uppercase tracking-wider text-on-surface-variant">
              Leaves per month
            </span>
            <input
              type="number"
              step="0.5"
              value={v.leavesPerPeriod}
              onChange={(e) => setV({ ...v, leavesPerPeriod: Number(e.target.value) })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </label>
          <label className="block space-y-xs">
            <span className="text-caption uppercase tracking-wider text-on-surface-variant">
              Leave type
            </span>
            <select
              value={v.leaveType}
              onChange={(e) => setV({ ...v, leaveType: e.target.value as "CL" | "SL" | "PL" })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            >
              <option value="CL">Casual Leave</option>
              <option value="SL">Sick Leave</option>
              <option value="PL">Paid Leave</option>
            </select>
          </label>
          <label className="block space-y-xs">
            <span className="text-caption uppercase tracking-wider text-on-surface-variant">
              Carry-forward cap
            </span>
            <input
              type="number"
              step="1"
              value={v.carryForwardCap}
              onChange={(e) => setV({ ...v, carryForwardCap: Number(e.target.value) })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </label>
        </div>
        <label className="flex items-center gap-sm">
          <input
            type="checkbox"
            checked={v.carryForward}
            onChange={(e) => setV({ ...v, carryForward: e.target.checked })}
          />
          <span>Carry forward unused balance to next year</span>
        </label>
        <label className="block space-y-xs">
          <span className="text-caption uppercase tracking-wider text-on-surface-variant">
            Expiry (months, optional)
          </span>
          <input
            type="number"
            min={1}
            value={v.expiryMonths ?? ""}
            onChange={(e) =>
              setV({ ...v, expiryMonths: e.target.value ? Number(e.target.value) : null })
            }
            placeholder="Never"
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
          />
        </label>
        {err && <p className="text-error text-label-sm">{err}</p>}
        <div className="flex justify-end gap-sm pt-sm">
          <button
            type="button"
            onClick={onClose}
            className="px-md py-sm rounded-lg text-on-surface-variant"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(v)}
            className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
