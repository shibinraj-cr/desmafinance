"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import { monthLabel, formatDays } from "@/lib/hr-statutory-reports";
import type { StatutoryReportData } from "@/lib/hr-statutory-reports-data";

type RunOption = { monthKey: string; status: string };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  hr_approved: "HR approved",
  finance_paid: "Paid",
};

function inr(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Missing-statutory-ID banner with links to fix each employee profile. */
function MissingIds({
  label,
  items,
}: {
  label: string;
  items: { employeeId: string; empCode: string; name: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-md text-amber-900 text-label-sm mb-md">
      <b>{items.length}</b> {label} — the portal will reject those rows. Add the number on the
      employee profile:{" "}
      {items.map((e, i) => (
        <span key={e.employeeId}>
          {i > 0 && ", "}
          <Link href={`/hr/employees/${e.employeeId}`} className="underline">
            {e.name}
          </Link>
        </span>
      ))}
    </div>
  );
}

export function StatutoryReportsClient({
  runs,
  data,
}: {
  runs: RunOption[];
  data: StatutoryReportData;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"ecr" | "esi">("ecr");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Zero-wage ESI rows need a reason code + last working day before upload.
  const [esiOverrides, setEsiOverrides] = useState<
    Record<string, { reasonCode: string; lastWorkingDay: string }>
  >({});

  const isDraft = data.run.status === "draft";
  const label = monthLabel(data.run.monthKey);

  async function downloadEsi() {
    setError(null);
    setDownloading(true);
    try {
      const overrides: Record<string, { reasonCode?: string; lastWorkingDay?: string }> = {};
      for (const [id, o] of Object.entries(esiOverrides)) {
        overrides[id] = {
          reasonCode: o.reasonCode.trim() || undefined,
          lastWorkingDay: o.lastWorkingDay.trim() || undefined,
        };
      }
      const res = await fetch(`/api/hr/salary/${data.run.id}/esi-export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ESI-${data.run.monthKey}.xls`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-lg">
      <Section title="">
        <div className="flex flex-wrap items-center gap-md">
          <label className="text-label-sm text-on-surface-variant">
            Salary month{" "}
            <select
              className="ml-xs px-sm py-sm rounded border border-outline-variant bg-surface"
              value={data.run.monthKey}
              onChange={(e) => router.push(`/hr/salary/reports?month=${e.target.value}`)}
            >
              {runs.map((r) => (
                <option key={r.monthKey} value={r.monthKey}>
                  {monthLabel(r.monthKey)} · {STATUS_LABEL[r.status] ?? r.status}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-lg border border-outline-variant overflow-hidden">
            {(["ecr", "esi"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-md py-sm text-label-sm font-semibold ${
                  tab === t ? "bg-primary text-on-primary" : "bg-surface text-on-surface-variant"
                }`}
              >
                {t === "ecr" ? `PF · ECR (${data.ecr.length})` : `ESI (${data.esi.length})`}
              </button>
            ))}
          </div>
        </div>
        {isDraft && (
          <p className="text-label-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg p-md mt-md">
            This run is still a draft — figures can change on recompute. Downloads unlock once HR
            approves the run.
          </p>
        )}
        <p className="text-caption text-on-surface-variant mt-sm">
          Rows are generated from the frozen salary-run lines — the same figures HR approved.
          Employees who left before the run (no salary line) are not listed; add them to the
          downloaded file the way you do today.
        </p>
        {error && <p className="text-red-700 text-label-sm mt-sm">{error}</p>}
      </Section>

      {tab === "ecr" && (
        <Section
          title={`ECR — ${label}`}
          action={
            isDraft ? undefined : (
              <a
                href={`/api/hr/salary/${data.run.id}/ecr-export`}
                className="px-md py-sm rounded-lg bg-primary text-on-primary text-label-sm font-semibold"
              >
                Download ECR (.xlsx)
              </a>
            )
          }
        >
          <MissingIds label="PF member(s) have no UAN on file" items={data.missingUan} />
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="py-sm pr-md">UAN</th>
                  <th className="py-sm pr-md">Member Name</th>
                  <th className="py-sm pr-md text-right">Gross Wages</th>
                  <th className="py-sm pr-md text-right">EPF Wages</th>
                  <th className="py-sm pr-md text-right">EPS Wage</th>
                  <th className="py-sm pr-md text-right">EDLI Wages</th>
                  <th className="py-sm pr-md text-right">EPF (EE)</th>
                  <th className="py-sm pr-md text-right">EPS (ER)</th>
                  <th className="py-sm pr-md text-right">EPF–EPS Diff</th>
                  <th className="py-sm pr-md text-right">NCP Days</th>
                </tr>
              </thead>
              <tbody>
                {data.ecr.map((r) => (
                  <tr key={r.employeeId} className="border-b border-outline-variant last:border-0">
                    <td className={`py-sm pr-md font-mono ${r.uan ? "" : "text-red-700 font-bold"}`}>
                      {r.uan || "missing"}
                    </td>
                    <td className="py-sm pr-md">{r.name}</td>
                    <td className="py-sm pr-md text-right">{inr(r.grossWages)}</td>
                    <td className="py-sm pr-md text-right">{inr(r.epfWages)}</td>
                    <td className="py-sm pr-md text-right">{inr(r.epsWage)}</td>
                    <td className="py-sm pr-md text-right">{inr(r.edliWages)}</td>
                    <td className="py-sm pr-md text-right font-semibold">{inr(r.epfContribution)}</td>
                    <td className="py-sm pr-md text-right font-semibold">{inr(r.epsContribution)}</td>
                    <td className="py-sm pr-md text-right font-semibold">{inr(r.epfEpsDifference)}</td>
                    <td className="py-sm pr-md text-right">{formatDays(r.ncpDays)}</td>
                  </tr>
                ))}
                {data.ecr.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-lg text-center text-on-surface-variant">
                      No PF members on this run.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {tab === "esi" && (
        <Section
          title={`ESI — ${label}`}
          action={
            isDraft ? undefined : (
              <button
                type="button"
                onClick={downloadEsi}
                disabled={downloading}
                className="px-md py-sm rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-50"
              >
                {downloading ? "Preparing…" : "Download ESI (.xls)"}
              </button>
            )
          }
        >
          <MissingIds label="ESI member(s) have no IP number on file" items={data.missingIp} />
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="py-sm pr-md">IP Number</th>
                  <th className="py-sm pr-md">IP Name</th>
                  <th className="py-sm pr-md text-right">Days Paid</th>
                  <th className="py-sm pr-md text-right">Monthly Wages</th>
                  <th className="py-sm pr-md">Zero-day Reason</th>
                  <th className="py-sm pr-md">Last Working Day</th>
                </tr>
              </thead>
              <tbody>
                {data.esi.map((r) => {
                  const o = esiOverrides[r.employeeId] ?? { reasonCode: "", lastWorkingDay: "" };
                  return (
                    <tr key={r.employeeId} className="border-b border-outline-variant last:border-0">
                      <td
                        className={`py-sm pr-md font-mono ${r.ipNumber ? "" : "text-red-700 font-bold"}`}
                      >
                        {r.ipNumber || "missing"}
                      </td>
                      <td className="py-sm pr-md">{r.name}</td>
                      <td className="py-sm pr-md text-right">{formatDays(r.daysPaid)}</td>
                      <td className="py-sm pr-md text-right">{inr(r.monthlyWages)}</td>
                      {r.zeroDays ? (
                        <>
                          <td className="py-sm pr-md">
                            <input
                              className="w-16 px-sm py-xs rounded border border-outline-variant bg-surface"
                              placeholder="0"
                              value={o.reasonCode}
                              onChange={(e) =>
                                setEsiOverrides({
                                  ...esiOverrides,
                                  [r.employeeId]: { ...o, reasonCode: e.target.value },
                                })
                              }
                            />
                          </td>
                          <td className="py-sm pr-md">
                            <input
                              className="w-32 px-sm py-xs rounded border border-outline-variant bg-surface"
                              placeholder="DD/MM/YYYY"
                              value={o.lastWorkingDay}
                              onChange={(e) =>
                                setEsiOverrides({
                                  ...esiOverrides,
                                  [r.employeeId]: { ...o, lastWorkingDay: e.target.value },
                                })
                              }
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-sm pr-md text-on-surface-variant">—</td>
                          <td className="py-sm pr-md text-on-surface-variant">—</td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {data.esi.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-lg text-center text-on-surface-variant">
                      No ESI members on this run.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.esi.some((r) => r.zeroDays) && (
            <p className="text-caption text-on-surface-variant mt-sm">
              Zero-wage rows need the ESIC reason code (and the last working day if the person
              left) — fill them above before downloading.
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
