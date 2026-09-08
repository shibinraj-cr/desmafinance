"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { jobsToCsv, JOB_TABS, JOB_TAB_LABELS, type JobRowDTO, type JobKpis, type JobTab } from "@/lib/hiring/jobs";
import { JOB_STATUS_LABELS, WORK_TYPE_LABELS, SENIORITY_LABELS } from "@/lib/hiring/constants";
import type { JobStatus, WorkType, Seniority } from "@/lib/hiring/constants";

type Lite = { id: string; name?: string; username?: string };
type SavedView = { id: string; name: string; filters: Record<string, string>; isShared: boolean; mine: boolean };
type Filters = { tab: string; department: string; ownerId: string; locationId: string; q: string };

const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-md rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const selectCls =
  "h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: size }} aria-hidden>
      {name}
    </span>
  );
}

export function JobsClient({
  jobs,
  kpis,
  locations,
  owners,
  departments,
  savedViews,
  filters,
  canWrite,
  canApprove,
  loadedAt,
}: {
  jobs: JobRowDTO[];
  kpis: JobKpis;
  locations: Lite[];
  owners: Lite[];
  departments: string[];
  savedViews: SavedView[];
  filters: Filters;
  canWrite: boolean;
  canApprove: boolean;
  loadedAt: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "board">("list");
  const [quickAdd, setQuickAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function go(next: Partial<Filters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v && !(k === "tab" && v === "all")) params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `/hiring/jobs?${qs}` : "/hiring/jobs");
  }

  function exportCsv() {
    const csv = jobsToCsv(jobs);
    // A Blob URL is used rather than a data: URI so a large export does not hit
    // the browser's URL-length ceiling.
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hiring-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveView() {
    const name = window.prompt("Name this view");
    if (!name?.trim()) return;
    setBusy(true);
    const res = await fetch("/api/hiring/saved-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rail: "jobs", name: name.trim(), filters }),
    });
    setBusy(false);
    if (!res.ok) setError("Could not save that view.");
    else router.refresh();
  }

  const filtersActive =
    filters.department !== "" || filters.ownerId !== "" || filters.locationId !== "" || filters.q !== "";

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      {/* ---- KPIs -------------------------------------------------------- */}
      <div className="grid gap-md grid-cols-2 lg:grid-cols-5">
        <Kpi label="Open reqs" value={kpis.openReqs} />
        <Kpi label="Applicants (90d)" value={kpis.applicants90d} />
        <Kpi label="In interview" value={kpis.inInterview} hint="Active applications with an interview booked" />
        <Kpi label="Offers out" value={kpis.offersOut} />
        <Kpi label="Aging > 21d" value={kpis.aging} tone={kpis.aging > 0 ? "warn" : undefined} />
      </div>

      {/* ---- Tabs + actions ---------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-md">
        <nav className="flex flex-wrap gap-xs" aria-label="Filter by status">
          {JOB_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => go({ tab: t })}
              aria-current={filters.tab === t ? "page" : undefined}
              className={
                "h-8 px-md rounded-full text-label-sm border transition " +
                (filters.tab === t
                  ? "bg-primary text-on-primary border-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {JOB_TAB_LABELS[t as JobTab]}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-xs">
          <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden" role="group" aria-label="View">
            {(["list", "board"] as const).map((v) => (
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
                {v === "list" ? "List" : "Board"}
              </button>
            ))}
          </div>
          <button type="button" className={secondaryBtn} onClick={exportCsv} disabled={jobs.length === 0}>
            Export CSV
          </button>
          {canWrite && (
            <>
              <button type="button" className={secondaryBtn} onClick={() => setQuickAdd((v) => !v)}>
                Quick add
              </button>
              <Link href="/hiring/jobs/new" className={primaryBtn + " inline-flex items-center gap-xs"}>
                <Icon name="add" /> New job
              </Link>
            </>
          )}
        </div>
      </div>

      {quickAdd && canWrite && (
        <QuickAdd
          departments={departments}
          owners={owners}
          onDone={() => {
            setQuickAdd(false);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {/* ---- Filters ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-sm">
        <label className="sr-only" htmlFor="job-search">
          Search jobs
        </label>
        <input
          id="job-search"
          defaultValue={filters.q}
          placeholder="Search title or department…"
          className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md w-56"
          onKeyDown={(e) => {
            if (e.key === "Enter") go({ q: (e.target as HTMLInputElement).value });
          }}
        />
        <select className={selectCls} value={filters.department} onChange={(e) => go({ department: e.target.value })} aria-label="Department">
          <option value="">Every department</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
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
        <select className={selectCls} value={filters.locationId} onChange={(e) => go({ locationId: e.target.value })} aria-label="Location">
          <option value="">Anywhere</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {filtersActive && (
          <button type="button" className="text-label-sm text-primary hover:underline" onClick={() => go({ department: "", ownerId: "", locationId: "", q: "" })}>
            Clear filters
          </button>
        )}
        <button type="button" className="text-label-sm text-on-surface-variant hover:underline" onClick={saveView} disabled={busy}>
          Save this view
        </button>
        <div className="ml-auto">
          <RefreshBar loadedAt={loadedAt} label={`${jobs.length} shown`} />
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
              {v.isShared && <span className="ml-xs opacity-60">shared</span>}
            </button>
          ))}
        </div>
      )}

      {/* ---- The list ----------------------------------------------------- */}
      {jobs.length === 0 ? (
        <EmptyJobs tab={filters.tab} canWrite={canWrite} filtered={filtersActive} onClear={() => go({ department: "", ownerId: "", locationId: "", q: "" })} />
      ) : view === "list" ? (
        <JobTable jobs={jobs} canApprove={canApprove} />
      ) : (
        <JobBoard jobs={jobs} />
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md" title={hint}>
      <div className={"text-h1 tabular-nums " + (tone === "warn" && value > 0 ? "text-error" : "text-on-surface")}>
        {value}
      </div>
      <div className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "live"
      ? "bg-primary text-on-primary"
      : status === "pending_approval"
        ? "bg-primary-fixed text-on-surface"
        : status === "closed"
          ? "bg-surface-container text-on-surface-variant"
          : "bg-surface-container-high text-on-surface-variant";
  return (
    <span className={"inline-flex items-center h-6 px-sm rounded-full text-label-sm whitespace-nowrap " + tone}>
      {JOB_STATUS_LABELS[status as JobStatus] ?? status}
    </span>
  );
}

function JobTable({ jobs, canApprove }: { jobs: JobRowDTO[]; canApprove: boolean }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
      <table className="w-full text-body-md">
        <thead className="text-left border-b border-outline-variant bg-surface-container-low">
          <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
            <th className="px-lg py-sm">Role</th>
            <th className="px-md py-sm">Status</th>
            <th className="px-md py-sm text-right">Applicants</th>
            <th className="px-md py-sm text-right">Days open</th>
            <th className="px-md py-sm">Owner</th>
            <th className="px-md py-sm">Comp</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low/50">
              <td className="px-lg py-sm">
                <Link href={`/hiring/jobs/${j.id}`} className="text-on-surface font-medium hover:text-primary">
                  {j.title}
                </Link>
                <div className="text-caption text-on-surface-variant">
                  {j.department}
                  {j.locationName ? ` · ${j.locationName}` : ""} ·{" "}
                  {WORK_TYPE_LABELS[j.workType as WorkType] ?? j.workType} ·{" "}
                  {SENIORITY_LABELS[j.seniority as Seniority] ?? j.seniority}
                  {j.openings > 1 ? ` · ${j.openings} openings` : ""}
                </div>
              </td>
              <td className="px-md py-sm">
                <div className="flex items-center gap-xs">
                  <StatusPill status={j.status} />
                  {j.isAging && (
                    <span className="text-error" title={`Open ${j.daysOpen} days`}>
                      <Icon name="flag" size={16} />
                      <span className="sr-only">Aging</span>
                    </span>
                  )}
                  {j.status === "pending_approval" && canApprove && (
                    <Link href={`/hiring/jobs/${j.id}`} className="text-label-sm text-primary hover:underline">
                      Review
                    </Link>
                  )}
                </div>
              </td>
              <td className="px-md py-sm text-right tabular-nums">{j.applicantCount}</td>
              <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">
                {j.daysOpen ?? "—"}
              </td>
              <td className="px-md py-sm text-on-surface-variant">{j.ownerName ?? "Unassigned"}</td>
              <td className="px-md py-sm text-on-surface-variant whitespace-nowrap">{j.compLabel ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BOARD_COLUMNS: { status: JobStatus; label: string }[] = [
  { status: "draft", label: "Drafts" },
  { status: "pending_approval", label: "Pending approval" },
  { status: "live", label: "Live" },
  { status: "paused", label: "Paused" },
  { status: "closed", label: "Closed" },
];

function JobBoard({ jobs }: { jobs: JobRowDTO[] }) {
  const columns = useMemo(
    () => BOARD_COLUMNS.map((c) => ({ ...c, jobs: jobs.filter((j) => j.status === c.status) })),
    [jobs],
  );
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-md min-w-max pb-md">
        {columns.map((col) => (
          <section key={col.status} className="w-72 flex-shrink-0">
            <h3 className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-sm px-xs">
              {col.label} <span className="opacity-60">{col.jobs.length}</span>
            </h3>
            <div className="space-y-sm">
              {col.jobs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-outline-variant p-md text-caption text-on-surface-variant text-center">
                  Nothing here
                </div>
              ) : (
                col.jobs.map((j) => (
                  <Link
                    key={j.id}
                    href={`/hiring/jobs/${j.id}`}
                    className="block rounded-lg border border-outline-variant bg-surface-container-lowest p-md hover:border-primary transition"
                  >
                    <div className="text-body-md font-medium text-on-surface">{j.title}</div>
                    <div className="text-caption text-on-surface-variant mt-xs">
                      {j.department}
                      {j.locationName ? ` · ${j.locationName}` : ""}
                    </div>
                    <div className="mt-sm flex items-center justify-between text-label-sm text-on-surface-variant">
                      <span>{j.applicantCount} applicants</span>
                      {j.isAging ? (
                        <span className="text-error">{j.daysOpen}d</span>
                      ) : (
                        <span>{j.daysOpen == null ? "—" : `${j.daysOpen}d`}</span>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function EmptyJobs({
  tab,
  canWrite,
  filtered,
  onClear,
}: {
  tab: string;
  canWrite: boolean;
  filtered: boolean;
  onClear: () => void;
}) {
  if (filtered) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
        <div className="text-body-lg text-on-surface mb-xs">Nothing matches those filters</div>
        <p className="text-body-sm text-on-surface-variant mb-md">There are requisitions, just not these.</p>
        <button type="button" className={secondaryBtn} onClick={onClear}>
          Clear filters
        </button>
      </div>
    );
  }
  const copy: Record<string, { title: string; body: string }> = {
    all: {
      title: "No requisitions yet",
      body: "A requisition is one role you are hiring for. Creating one gives you a pipeline, a scoring rubric, and a public page candidates can apply from.",
    },
    live: { title: "Nothing is live", body: "Publish a draft to put it on the careers page." },
    drafts: { title: "No drafts", body: "Drafts are reqs still being written, and reqs waiting on approval." },
    paused: { title: "Nothing is paused", body: "Pausing a req takes it off the careers page without closing it." },
    closed: { title: "Nothing closed yet", body: "Closed reqs keep their pipeline history for analytics." },
    aging: { title: "No aging reqs", body: "A live req open more than 21 days shows up here." },
  };
  const { title, body } = copy[tab] ?? copy.all!;
  return (
    <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
      <div className="text-body-lg text-on-surface mb-xs">{title}</div>
      <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto mb-md">{body}</p>
      {canWrite && tab !== "aging" && (
        <Link href="/hiring/jobs/new" className={primaryBtn + " inline-flex items-center gap-xs"}>
          <Icon name="add" /> Create a requisition
        </Link>
      )}
    </div>
  );
}

/** Title + department + owner only. Lands as a draft, and says so. */
function QuickAdd({
  departments,
  owners,
  onDone,
  onError,
}: {
  departments: string[];
  owners: Lite[];
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState(departments[0] ?? "");
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim() || !department.trim()) return;
    setBusy(true);
    const res = await fetch("/api/hiring/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, department, ownerId: ownerId || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      onError(d.message ?? "Could not create that requisition.");
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md">
      <div className="grid gap-md sm:grid-cols-[2fr,1fr,1fr,auto] sm:items-end">
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Job title</span>
          <input
            className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Business Development Executive"
          />
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Department</span>
          <input
            className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            list="qa-departments"
          />
          <datalist id="qa-departments">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Owner</span>
          <select className="w-full h-10 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Me</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.username}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={primaryBtn} onClick={submit} disabled={busy || !title.trim() || !department.trim()}>
          {busy ? "Adding…" : "Add draft"}
        </button>
      </div>
      <p className="text-caption text-on-surface-variant mt-sm">
        This lands as a <strong>draft</strong>. It needs a description, must-haves and a rubric
        totalling 100% before it can go live.
      </p>
    </div>
  );
}
