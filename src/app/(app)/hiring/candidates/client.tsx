"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { CandidateDrawer } from "@/components/hiring/CandidateDrawer";
import { ImportPanel } from "@/components/hiring/ImportPanel";
import {
  candidatesToCsv,
  CANDIDATE_SORTS,
  CANDIDATE_SORT_LABELS,
  CANDIDATE_STATUS_FILTERS,
  CANDIDATE_STATUS_LABELS,
  type ApplicationRowDTO,
  type CandidateSort,
  type CandidateStatusFilter,
} from "@/lib/hiring/candidates";
import { CANDIDATE_SOURCES, CANDIDATE_SOURCE_LABELS } from "@/lib/hiring/constants";
import { formatHiringDate } from "@/lib/hiring/core";

type Lite = { id: string; title?: string; username?: string };
type Filters = {
  status: string; jobId: string; ownerId: string; minScore: string;
  source: string; q: string; sort: string; stageTab: string;
};

/** The stage tabs the rail offers, matched by name across every requisition. */
const STAGE_TABS = ["", "Applied", "Shortlisted", "Interview", "Offer", "Hired"];

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";
const selectCls =
  "h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";

export function CandidatesClient({
  applications,
  jobs,
  owners,
  savedViews,
  filters,
  canWrite,
  canMove,
  aiEnabled,
  loadedAt,
}: {
  applications: ApplicationRowDTO[];
  jobs: Lite[];
  owners: Lite[];
  savedViews: { id: string; name: string; filters: Record<string, string>; isShared: boolean }[];
  filters: Filters;
  canWrite: boolean;
  canMove: boolean;
  aiEnabled: boolean;
  loadedAt: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<"table" | "grid">("table");
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function go(next: Partial<Filters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v && !(k === "status" && v === "active") && !(k === "sort" && v === "score_desc")) {
        params.set(k, v);
      }
    }
    const qs = params.toString();
    router.push(qs ? `/hiring/candidates?${qs}` : "/hiring/candidates");
  }

  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([candidatesToCsv(applications)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `hiring-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-md">
        <nav className="flex flex-wrap gap-xs" aria-label="Filter by stage">
          {STAGE_TABS.map((t) => (
            <button
              key={t || "all"}
              type="button"
              onClick={() => go({ stageTab: t })}
              aria-current={filters.stageTab === t ? "page" : undefined}
              className={
                "h-8 px-md rounded-full text-label-sm border transition " +
                (filters.stageTab === t
                  ? "bg-primary text-on-primary border-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {t || "All"}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-xs">
          <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden" role="group" aria-label="View">
            {(["table", "grid"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={
                  "h-9 px-md text-label-sm transition " +
                  (view === v ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-low")
                }
              >
                {v === "table" ? "Table" : "Grid"}
              </button>
            ))}
          </div>
          <button type="button" className={btn} onClick={exportCsv} disabled={applications.length === 0}>
            Export
          </button>
          {canWrite && (
            <button type="button" className={btn} onClick={() => setImporting((v) => !v)}>
              Import CSV
            </button>
          )}
        </div>
      </div>

      {importing && canWrite && (
        <ImportPanel
          jobs={jobs.map((j) => ({ id: j.id, title: j.title ?? "" }))}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            router.refresh();
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-sm">
        <label className="sr-only" htmlFor="cand-search">
          Search candidates
        </label>
        <input
          id="cand-search"
          defaultValue={filters.q}
          placeholder="Name, email, phone, employer…"
          className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md w-60"
          onKeyDown={(e) => {
            if (e.key === "Enter") go({ q: (e.target as HTMLInputElement).value });
          }}
        />
        <select className={selectCls} value={filters.status} onChange={(e) => go({ status: e.target.value })} aria-label="Status">
          {CANDIDATE_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {CANDIDATE_STATUS_LABELS[s as CandidateStatusFilter]}
            </option>
          ))}
        </select>
        <select className={selectCls} value={filters.jobId} onChange={(e) => go({ jobId: e.target.value })} aria-label="Requisition">
          <option value="">Every requisition</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </select>
        <select className={selectCls} value={filters.minScore} onChange={(e) => go({ minScore: e.target.value })} aria-label="Minimum score">
          <option value="">Any score</option>
          {[50, 60, 70, 80, 90].map((n) => (
            <option key={n} value={String(n)}>
              Score ≥ {n}
            </option>
          ))}
        </select>
        <select className={selectCls} value={filters.source} onChange={(e) => go({ source: e.target.value })} aria-label="Source">
          <option value="">Any source</option>
          {CANDIDATE_SOURCES.map((s) => (
            <option key={s} value={s}>
              {CANDIDATE_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <select className={selectCls} value={filters.ownerId} onChange={(e) => go({ ownerId: e.target.value })} aria-label="Owner">
          <option value="">Any owner</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.username}
            </option>
          ))}
        </select>
        <select className={selectCls} value={filters.sort} onChange={(e) => go({ sort: e.target.value })} aria-label="Sort">
          {CANDIDATE_SORTS.map((s) => (
            <option key={s} value={s}>
              {CANDIDATE_SORT_LABELS[s as CandidateSort]}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <RefreshBar loadedAt={loadedAt} label={`${applications.length} shown`} />
        </div>
      </div>

      {savedViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-xs">
          <span className="text-label-sm text-on-surface-variant">Saved views</span>
          {savedViews.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => go(v.filters as Partial<Filters>)}
              className="h-8 px-md rounded-full border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition"
            >
              {v.name}
            </button>
          ))}
        </div>
      )}

      {applications.length === 0 ? (
        <EmptyCandidates
          filters={filters}
          canWrite={canWrite}
          onClear={() => go({ status: "active", jobId: "", ownerId: "", minScore: "", source: "", q: "", stageTab: "" })}
          onImport={() => setImporting(true)}
        />
      ) : view === "table" ? (
        <CandidateTable rows={applications} onOpen={setOpenId} />
      ) : (
        <CandidateGrid rows={applications} onOpen={setOpenId} />
      )}

      {openId && (
        <CandidateDrawer
          applicationId={openId}
          canMove={canMove}
          canWrite={canWrite}
          aiEnabled={aiEnabled}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            setError(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ScoreCell({ score }: { score: number | null }) {
  if (score == null) return <span className="text-on-surface-variant">—</span>;
  const tone = score >= 75 ? "text-accent" : score >= 55 ? "text-on-surface" : "text-on-surface-variant";
  return <span className={"tabular-nums font-semibold " + tone}>{score}</span>;
}

function CandidateTable({ rows, onOpen }: { rows: ApplicationRowDTO[]; onOpen: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
      <table className="w-full text-body-md">
        <thead className="text-left border-b border-outline-variant bg-surface-container-low">
          <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            <th className="px-lg py-sm">Candidate</th>
            <th className="px-md py-sm">Applied for</th>
            <th className="px-md py-sm">Stage</th>
            <th className="px-md py-sm text-right">Score</th>
            <th className="px-md py-sm text-right">In stage</th>
            <th className="px-md py-sm">Last contact</th>
            <th className="px-md py-sm">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              tabIndex={0}
              role="button"
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(r.id);
                }
              }}
              className="border-b border-outline-variant last:border-0 cursor-pointer hover:bg-surface-container-low/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <td className="px-lg py-sm">
                <div className="text-on-surface font-medium flex items-center gap-xs">
                  {r.fullName}
                  {r.needsAttention && (
                    <span className="text-error" title={r.screenedOutReason ?? "Needs attention"}>
                      ⚑
                    </span>
                  )}
                </div>
                <div className="text-caption text-on-surface-variant">
                  {r.currentTitle ?? r.email ?? r.phone ?? "—"}
                  {r.currentEmployer ? ` · ${r.currentEmployer}` : ""}
                </div>
              </td>
              <td className="px-md py-sm text-on-surface-variant">{r.jobTitle}</td>
              <td className="px-md py-sm">
                <span className="text-on-surface">{r.stageName ?? "—"}</span>
                {r.slaBreached && (
                  <span className="ml-xs text-error text-label-sm" title="Past this stage's SLA">
                    SLA
                  </span>
                )}
              </td>
              <td className="px-md py-sm text-right">
                <ScoreCell score={r.aiScore} />
              </td>
              <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{r.daysInStage}d</td>
              <td className="px-md py-sm text-on-surface-variant whitespace-nowrap">
                {r.lastContactedAt ? formatHiringDate(r.lastContactedAt) : "Never"}
              </td>
              <td className="px-md py-sm text-on-surface-variant">{r.sourceLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandidateGrid({ rows, onOpen }: { rows: ApplicationRowDTO[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r.id)}
          className="text-left rounded-xl border border-outline-variant bg-surface-container-lowest p-md hover:border-primary transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <div className="flex items-start justify-between gap-sm">
            <div className="min-w-0">
              <div className="text-body-lg font-semibold text-on-surface truncate">{r.fullName}</div>
              <div className="text-caption text-on-surface-variant truncate">
                {r.currentTitle ?? "—"}
                {r.currentEmployer ? ` · ${r.currentEmployer}` : ""}
              </div>
            </div>
            <ScoreCell score={r.aiScore} />
          </div>
          <div className="mt-sm text-body-sm text-on-surface-variant">{r.jobTitle}</div>
          <div className="mt-sm flex items-center justify-between text-label-sm text-on-surface-variant">
            <span>{r.stageName ?? "—"}</span>
            <span className={r.slaBreached ? "text-error" : ""}>{r.daysInStage}d</span>
          </div>
          {r.needsAttention && r.screenedOutReason && (
            <p className="mt-sm text-caption text-error">⚑ {r.screenedOutReason}</p>
          )}
        </button>
      ))}
    </div>
  );
}

function EmptyCandidates({
  filters,
  canWrite,
  onClear,
  onImport,
}: {
  filters: Filters;
  canWrite: boolean;
  onClear: () => void;
  onImport: () => void;
}) {
  const filtered =
    filters.q !== "" || filters.jobId !== "" || filters.minScore !== "" ||
    filters.source !== "" || filters.ownerId !== "" || filters.stageTab !== "" ||
    filters.status !== "active";

  return (
    <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
      <div className="text-body-lg text-on-surface mb-xs">
        {filtered ? "Nobody matches those filters" : "No candidates yet"}
      </div>
      <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto mb-md">
        {filtered
          ? "There are candidates in the system, just not these."
          : "Candidates arrive when someone applies from the careers page, when a colleague refers one, or when you import a spreadsheet."}
      </p>
      {filtered ? (
        <button type="button" className={btn} onClick={onClear}>
          Clear filters
        </button>
      ) : (
        canWrite && (
          <button type="button" className={primaryBtn} onClick={onImport}>
            Import a CSV
          </button>
        )
      )}
    </div>
  );
}
