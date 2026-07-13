"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import {
  ADJUSTMENT_CATEGORIES,
  ADJUSTMENT_CATEGORY_LABELS,
  ADJUSTMENT_CATEGORY_DEFAULT_KIND,
  type AdjustmentKind,
  type AdjustmentCategory,
} from "@/lib/hr-adjustment-types";

type RunHeader = {
  id: string;
  monthKey: string;
  status: string;
  workingDaysBase: number;
  totalNet: number;
  approvedAt: string | null;
  axisExportedAt: string | null;
};

type AdjRow = {
  id: string;
  kind: string; // "deduction" | "addition"
  category: string;
  amount: number;
  note: string | null;
};

type Line = {
  id: string;
  employeeId: string;
  empCode: string;
  name: string;
  daysAttended: number;
  totalLeaveForLop: number;
  paidLeave: number;
  unpaidLeave: number;
  halfDayLeave: number;
  monthlySalary: number;
  basicAfterLop: number;
  salaryBeforeEsi: number;
  esiEmployee: number;
  pfEmployee: number;
  professionalTax: number;
  adjustments: number; // cached rollup: Σ additions − Σ deductions
  adjustmentRows: AdjRow[];
  netSalary: number;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankName: string | null;
};

function inr(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const STATUS_TONE: Record<string, string> = {
  draft: "bg-yellow-50 text-yellow-800",
  hr_approved: "bg-green-50 text-green-800",
  finance_paid: "bg-blue-50 text-blue-800",
  cancelled: "bg-red-50 text-red-800",
};

type Draft = { category: AdjustmentCategory; kind: AdjustmentKind; amount: string; note: string };

const emptyDraft = (): Draft => ({
  category: "penalty",
  kind: ADJUSTMENT_CATEGORY_DEFAULT_KIND.penalty,
  amount: "",
  note: "",
});

export function SalaryRunDetail({
  run,
  lines,
  canEdit,
  canApprove,
  canDownload,
}: {
  run: RunHeader;
  lines: Line[];
  canEdit: boolean;
  canApprove: boolean;
  canDownload: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const total = lines.reduce((s, l) => s + l.netSalary + l.adjustments, 0);

  async function approve() {
    if (!confirm(`Approve salary run for ${run.monthKey}? This locks the lines and lets Finance download the Axis file.`)) return;
    setError(null);
    const res = await fetch(`/api/hr/salary/${run.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "approve failed");
      return;
    }
    start(() => router.refresh());
  }

  async function recompute() {
    if (!confirm("Recompute the run from current attendance + structures? Line items are rebuilt, but your itemised adjustments are preserved.")) return;
    const res = await fetch("/api/hr/salary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthKey: run.monthKey }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "compute failed");
      return;
    }
    start(() => router.refresh());
  }

  async function addAdjustment(line: Line) {
    const d = drafts[line.id] ?? emptyDraft();
    const amount = Number(d.amount);
    if (!(amount > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/hr/salary/${run.id}/adjustments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        employeeId: line.employeeId,
        kind: d.kind,
        category: d.category,
        amount,
        note: d.note.trim() || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setDrafts({ ...drafts, [line.id]: emptyDraft() });
    start(() => router.refresh());
  }

  async function deleteAdjustment(adjId: string) {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/hr/salary/${run.id}/adjustments/${adjId}`, { method: "DELETE" });
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
      <Section title="">
        <div className="flex flex-wrap items-center gap-base">
          <span
            className={
              "inline-block px-sm py-xs rounded font-bold text-label-sm " +
              (STATUS_TONE[run.status] ?? "bg-surface-container")
            }
          >
            {run.status.replace("_", " ")}
          </span>
          <span className="text-on-surface-variant text-label-sm">
            Working days base: {run.workingDaysBase}
          </span>
          <span className="text-h3 font-extrabold ml-auto">Total ₹{inr(total)}</span>
          {canEdit && (
            <button
              onClick={recompute}
              disabled={pending || busy}
              className="px-md py-sm rounded border border-outline-variant disabled:opacity-50"
            >
              Recompute
            </button>
          )}
          {canApprove && (
            <button
              onClick={approve}
              disabled={pending || busy}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
            >
              Approve &amp; lock
            </button>
          )}
          {canDownload && (
            <a
              href={`/api/hr/salary/${run.id}/axis-export`}
              className="px-md py-sm rounded bg-blue-600 text-white font-bold"
            >
              Download Axis Bank file
            </a>
          )}
          {canDownload && (
            <a
              href={`/hr/salary/${run.id}/slips`}
              target="_blank"
              rel="noopener"
              className="px-md py-sm rounded bg-purple-600 text-white font-bold"
            >
              All salary slips (PDF)
            </a>
          )}
        </div>
        {error && <p className="text-red-700 text-label-sm mt-sm">{error}</p>}
      </Section>

      <Section title="Line items">
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Emp</th>
                <th className="py-sm pr-md">Days</th>
                <th className="py-sm pr-md">LOP days</th>
                <th className="py-sm pr-md">Monthly</th>
                <th className="py-sm pr-md">Before ESI</th>
                <th className="py-sm pr-md">ESI(E)</th>
                <th className="py-sm pr-md">PF(E)</th>
                <th className="py-sm pr-md">PT</th>
                <th className="py-sm pr-md">Adjustments</th>
                <th className="py-sm pr-md font-bold">Net</th>
                <th className="py-sm pr-md">Bank</th>
                <th className="py-sm pr-md">Slip</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const isOpen = openLine === l.id;
                const draft = drafts[l.id] ?? emptyDraft();
                // Penalty deductions are folded into the reduced Before-ESI /
                // ESI / PF / Net columns (pre-statutory), so they're shown
                // separately from the post-net flat adjustments.
                const penaltyTotal = l.adjustmentRows
                  .filter((r) => r.kind === "deduction" && r.category === "penalty")
                  .reduce((s, r) => s + r.amount, 0);
                const otherDeductTotal = l.adjustmentRows
                  .filter((r) => r.kind === "deduction" && r.category !== "penalty")
                  .reduce((s, r) => s + r.amount, 0);
                const addTotal = l.adjustmentRows
                  .filter((r) => r.kind === "addition")
                  .reduce((s, r) => s + r.amount, 0);
                return (
                  <Fragment key={l.id}>
                    <tr className="border-b border-outline-variant last:border-0">
                      <td className="py-sm pr-md font-semibold whitespace-nowrap">
                        {l.empCode} · {l.name}
                      </td>
                      <td className="py-sm pr-md">
                        {l.daysAttended.toFixed(1)}
                        <span className="text-on-surface-variant"> / {run.workingDaysBase}</span>
                      </td>
                      <td className="py-sm pr-md">
                        {l.totalLeaveForLop.toFixed(1)}
                        <div className="text-caption text-on-surface-variant">
                          PL {l.paidLeave.toFixed(1)} · LOP {l.unpaidLeave.toFixed(1)} · HD {l.halfDayLeave.toFixed(1)}
                        </div>
                      </td>
                      <td className="py-sm pr-md">₹{inr(l.monthlySalary)}</td>
                      <td className="py-sm pr-md">₹{inr(l.salaryBeforeEsi)}</td>
                      <td className="py-sm pr-md">₹{inr(l.esiEmployee)}</td>
                      <td className="py-sm pr-md">₹{inr(l.pfEmployee)}</td>
                      <td className="py-sm pr-md">₹{inr(l.professionalTax)}</td>
                      <td className="py-sm pr-md min-w-[120px]">
                        <div className={l.adjustments === 0 ? "text-on-surface-variant" : l.adjustments < 0 ? "text-red-700" : "text-green-700"}>
                          {l.adjustments === 0 ? "—" : (l.adjustments > 0 ? "+" : "−") + "₹" + inr(Math.abs(l.adjustments))}
                        </div>
                        {(otherDeductTotal > 0 || addTotal > 0) && (
                          <div className="text-caption text-on-surface-variant">
                            {otherDeductTotal > 0 && <>−₹{inr(otherDeductTotal)} ded</>}
                            {otherDeductTotal > 0 && addTotal > 0 && " · "}
                            {addTotal > 0 && <>+₹{inr(addTotal)} add</>}
                          </div>
                        )}
                        {penaltyTotal > 0 && (
                          <div className="text-caption text-amber-700">
                            −₹{inr(penaltyTotal)} penalty (pre-ESI)
                          </div>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => setOpenLine(isOpen ? null : l.id)}
                            className="mt-xs text-caption underline text-primary"
                          >
                            {isOpen ? "Close" : l.adjustmentRows.length ? "Edit" : "Add"}
                          </button>
                        )}
                      </td>
                      <td className="py-sm pr-md font-bold">₹{inr(l.netSalary + l.adjustments)}</td>
                      <td className="py-sm pr-md text-on-surface-variant text-[11px]">
                        {l.bankName ?? "—"}
                        <div>{l.bankAccount}</div>
                        <div>{l.bankIfsc}</div>
                      </td>
                      <td className="py-sm pr-md">
                        {canDownload && (
                          <a
                            href={`/hr/salary/${run.id}/slip/${l.id}`}
                            target="_blank"
                            rel="noopener"
                            className="px-sm py-[2px] rounded bg-primary text-on-primary text-caption font-semibold"
                          >
                            Slip
                          </a>
                        )}
                      </td>
                    </tr>
                    {canEdit && isOpen && (
                      <tr className="border-b border-outline-variant bg-surface-container-low">
                        <td colSpan={12} className="p-md">
                          <div className="space-y-sm max-w-[720px]">
                            <div className="font-semibold">
                              Adjustments · {l.empCode} · {l.name}
                            </div>
                            <p className="text-caption text-on-surface-variant">
                              <b>Penalty</b> reduces the salary before ESI/PF/PT, so those recompute on
                              the lower amount. Other deductions (advance, loan…) come off take-home
                              only. Additions are paid on top of net.
                            </p>

                            {l.adjustmentRows.length > 0 ? (
                              <table className="w-full text-caption">
                                <tbody>
                                  {l.adjustmentRows.map((r) => (
                                    <tr key={r.id} className="border-b border-outline-variant last:border-0">
                                      <td className="py-xs pr-sm">
                                        <span
                                          className={
                                            "inline-block px-xs rounded font-semibold " +
                                            (r.kind === "deduction" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700")
                                          }
                                        >
                                          {r.kind === "deduction" ? "− Deduction" : "+ Addition"}
                                        </span>
                                      </td>
                                      <td className="py-xs pr-sm">
                                        {ADJUSTMENT_CATEGORY_LABELS[r.category as AdjustmentCategory] ?? r.category}
                                        {r.kind === "deduction" && r.category === "penalty" && (
                                          <span className="ml-xs text-amber-700">· before ESI/PF</span>
                                        )}
                                      </td>
                                      <td className="py-xs pr-sm font-semibold">
                                        {r.kind === "deduction" ? "−" : "+"}₹{inr(r.amount)}
                                      </td>
                                      <td className="py-xs pr-sm text-on-surface-variant">{r.note}</td>
                                      <td className="py-xs pr-sm text-right">
                                        <button
                                          onClick={() => deleteAdjustment(r.id)}
                                          disabled={busy}
                                          className="text-red-700 underline disabled:opacity-50"
                                        >
                                          Remove
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-caption text-on-surface-variant">No adjustments yet.</p>
                            )}

                            <div className="flex flex-wrap items-end gap-sm pt-xs">
                              <label className="flex flex-col gap-xs">
                                <span className="text-caption text-on-surface-variant">Category</span>
                                <select
                                  className="px-sm py-xs rounded border border-outline-variant bg-surface"
                                  value={draft.category}
                                  onChange={(e) => {
                                    const category = e.target.value as AdjustmentCategory;
                                    setDrafts({
                                      ...drafts,
                                      [l.id]: { ...draft, category, kind: ADJUSTMENT_CATEGORY_DEFAULT_KIND[category] },
                                    });
                                  }}
                                >
                                  {ADJUSTMENT_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>
                                      {ADJUSTMENT_CATEGORY_LABELS[c]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex flex-col gap-xs">
                                <span className="text-caption text-on-surface-variant">Type</span>
                                <select
                                  className="px-sm py-xs rounded border border-outline-variant bg-surface"
                                  value={draft.kind}
                                  onChange={(e) =>
                                    setDrafts({ ...drafts, [l.id]: { ...draft, kind: e.target.value as AdjustmentKind } })
                                  }
                                >
                                  <option value="deduction">Deduction (−)</option>
                                  <option value="addition">Addition (+)</option>
                                </select>
                              </label>
                              <label className="flex flex-col gap-xs">
                                <span className="text-caption text-on-surface-variant">Amount ₹</span>
                                <input
                                  type="number"
                                  min="0"
                                  className="px-sm py-xs rounded border border-outline-variant bg-surface w-28"
                                  value={draft.amount}
                                  onChange={(e) =>
                                    setDrafts({ ...drafts, [l.id]: { ...draft, amount: e.target.value } })
                                  }
                                />
                              </label>
                              <label className="flex flex-col gap-xs flex-1 min-w-[140px]">
                                <span className="text-caption text-on-surface-variant">Note</span>
                                <input
                                  className="px-sm py-xs rounded border border-outline-variant bg-surface w-full"
                                  value={draft.note}
                                  onChange={(e) =>
                                    setDrafts({ ...drafts, [l.id]: { ...draft, note: e.target.value } })
                                  }
                                />
                              </label>
                              <button
                                onClick={() => addAdjustment(l)}
                                disabled={busy}
                                className="px-md py-xs rounded bg-primary text-on-primary font-semibold disabled:opacity-50"
                              >
                                Add
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-lg text-center text-on-surface-variant">
                    No line items yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
