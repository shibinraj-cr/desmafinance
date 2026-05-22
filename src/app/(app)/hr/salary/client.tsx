"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Run = {
  id: string;
  monthKey: string;
  status: string;
  workingDaysBase: number;
  totalNet: number;
  approvedAt: string | null;
  axisExportName: string | null;
  axisExportedAt: string | null;
  lineCount: number;
};

function inr(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const STATUS_TONE: Record<string, string> = {
  draft: "bg-yellow-50 text-yellow-800",
  hr_approved: "bg-green-50 text-green-800",
  finance_paid: "bg-blue-50 text-blue-800",
  cancelled: "bg-red-50 text-red-800",
};

export function SalaryRunsClient({
  runs,
  currentMonth,
  canCompute,
  canDownload,
}: {
  runs: Run[];
  currentMonth: string;
  canCompute: boolean;
  canApprove: boolean;
  canDownload: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [month, setMonth] = useState(currentMonth);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function compute() {
    setError(null);
    setStatus("Computing…");
    const res = await fetch("/api/hr/salary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthKey: month }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(j.error || "compute failed");
      setStatus(null);
      return;
    }
    setStatus(
      `Computed ${j.lineCount} line${j.lineCount === 1 ? "" : "s"}.` +
        (j.warnings?.length ? ` ${j.warnings.length} warning(s).` : ""),
    );
    start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {canCompute && (
        <Section title="Compute / re-compute a month">
          <div className="flex flex-wrap items-end gap-sm">
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Month</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
              />
            </label>
            <button
              onClick={compute}
              disabled={pending}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
            >
              Compute salary
            </button>
            {status && <span className="text-label-sm text-on-surface-variant">{status}</span>}
            {error && <span className="text-red-700 text-label-sm">{error}</span>}
          </div>
          <p className="text-caption text-on-surface-variant mt-sm">
            Compute pulls active employees&apos; attendance for the month + their salary structure and
            re-builds the line items in draft. Idempotent. You must approve the run before Finance
            can download the Axis file.
          </p>
        </Section>
      )}

      <Section title="Runs">
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Month</th>
                <th className="py-sm pr-md">Status</th>
                <th className="py-sm pr-md">Lines</th>
                <th className="py-sm pr-md">Total net</th>
                <th className="py-sm pr-md">Approved</th>
                <th className="py-sm pr-md">Axis export</th>
                <th className="py-sm pr-md text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-outline-variant last:border-0">
                  <td className="py-sm pr-md font-bold">
                    <Link href={`/hr/salary/${r.id}`} className="hover:underline">
                      {r.monthKey}
                    </Link>
                  </td>
                  <td className="py-sm pr-md">
                    <span
                      className={
                        "inline-block px-xs py-[2px] rounded text-[11px] font-bold " +
                        (STATUS_TONE[r.status] ?? "bg-surface-container")
                      }
                    >
                      {r.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="py-sm pr-md">{r.lineCount}</td>
                  <td className="py-sm pr-md font-bold">{inr(r.totalNet)}</td>
                  <td className="py-sm pr-md text-on-surface-variant">
                    {r.approvedAt ? new Date(r.approvedAt).toLocaleString() : "—"}
                  </td>
                  <td className="py-sm pr-md text-on-surface-variant">
                    {r.axisExportedAt ? new Date(r.axisExportedAt).toLocaleString() : "—"}
                  </td>
                  <td className="py-sm pr-md text-right">
                    <Link href={`/hr/salary/${r.id}`} className="underline">
                      Open
                    </Link>
                    {canDownload && (r.status === "hr_approved" || r.status === "finance_paid") && (
                      <a
                        href={`/api/hr/salary/${r.id}/axis-export`}
                        className="ml-sm underline text-blue-700"
                      >
                        Download Axis
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-lg text-center text-on-surface-variant">
                    No salary runs yet. Compute the current month above to create one.
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
