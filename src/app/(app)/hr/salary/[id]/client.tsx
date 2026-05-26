"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type RunHeader = {
  id: string;
  monthKey: string;
  status: string;
  workingDaysBase: number;
  totalNet: number;
  approvedAt: string | null;
  axisExportedAt: string | null;
};

type Line = {
  id: string;
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
  adjustments: number;
  adjustmentNote: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [adjEdits, setAdjEdits] = useState<Record<string, { amount: string; note: string }>>({});

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
    if (!confirm("Recompute the run from current attendance + structures? Existing line items will be replaced.")) return;
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

  async function saveAdjustment(line: Line) {
    const edit = adjEdits[line.id] ?? { amount: String(line.adjustments), note: line.adjustmentNote ?? "" };
    const res = await fetch(`/api/hr/salary/${run.id}/lines/${line.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adjustments: Number(edit.amount || 0),
        adjustmentNote: edit.note || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
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
              disabled={pending}
              className="px-md py-sm rounded border border-outline-variant disabled:opacity-50"
            >
              Recompute
            </button>
          )}
          {canApprove && (
            <button
              onClick={approve}
              disabled={pending}
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
                <th className="py-sm pr-md">Adjust</th>
                <th className="py-sm pr-md font-bold">Net</th>
                <th className="py-sm pr-md">Bank</th>
                <th className="py-sm pr-md">Slip</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const edit = adjEdits[l.id] ?? { amount: String(l.adjustments), note: l.adjustmentNote ?? "" };
                return (
                  <tr key={l.id} className="border-b border-outline-variant last:border-0">
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
                    <td className="py-sm pr-md min-w-[160px]">
                      {canEdit ? (
                        <div className="flex flex-col gap-xs">
                          <input
                            type="number"
                            className="px-xs py-xs rounded border border-outline-variant bg-surface w-24"
                            value={edit.amount}
                            onChange={(e) =>
                              setAdjEdits({ ...adjEdits, [l.id]: { ...edit, amount: e.target.value } })
                            }
                            onBlur={() => saveAdjustment(l)}
                          />
                          <input
                            placeholder="note"
                            className="px-xs py-xs rounded border border-outline-variant bg-surface w-full"
                            value={edit.note}
                            onChange={(e) =>
                              setAdjEdits({ ...adjEdits, [l.id]: { ...edit, note: e.target.value } })
                            }
                            onBlur={() => saveAdjustment(l)}
                          />
                        </div>
                      ) : (
                        <>
                          ₹{inr(l.adjustments)}
                          {l.adjustmentNote && (
                            <div className="text-caption text-on-surface-variant">{l.adjustmentNote}</div>
                          )}
                        </>
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
