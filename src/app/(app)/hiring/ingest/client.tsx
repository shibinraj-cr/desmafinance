"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { formatHiringDate } from "@/lib/hiring/core";

type JobLite = { id: string; title: string; department: string };
type BatchRow = {
  id: string; jobTitle: string; origin: string; status: string;
  fileCount: number; parsedCount: number; skippedCount: number; failedCount: number;
  createdByName: string | null; createdAt: string;
};
type Suggestion = { jobId: string; title: string; fit: number; matchedMustHaves: string[]; missingMustHaves: string[] };
type Item = {
  id: string; fileName: string; status: string; blobUrl: string | null; error: string | null;
  aiScore: number | null;
  aiScoreBreakdown: { criterion: string; weight: number; score: number; evidence: string }[] | null;
  acceptedCandidateId: string | null;
  parsed: {
    fullName: string | null; email: string | null; phone: string | null;
    currentTitle: string | null; currentEmployer: string | null; locationText: string | null;
    totalExperienceYears: number | null; skills: string[]; confidence: number;
  } | null;
  duplicate: {
    id: string; fullName: string; email: string | null; phone: string | null;
    currentEmployer: string | null; via: string | null; needsConfirmation: boolean;
  } | null;
  suggestions: Suggestion[];
};

/** One request per chunk; each résumé is a model call and the function has 60s. */
const CHUNK = 12;

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";

export function IngestClient({
  jobs,
  batches,
  openBatchId,
  aiEnabled,
  creditsRemaining,
  parseCost,
  scoreCost,
  loadedAt,
}: {
  jobs: JobLite[];
  batches: BatchRow[];
  openBatchId: string | null;
  aiEnabled: boolean;
  creditsRemaining: number;
  parseCost: number;
  scoreCost: number;
  loadedAt: string;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(openBatchId);
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merges, setMerges] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const loadBatch = useCallback(async (id: string) => {
    const res = await fetch(`/api/hiring/ingest/${id}`);
    if (!res.ok) {
      setError("Could not load that batch.");
      return;
    }
    const d = (await res.json()) as { items: Item[] };
    setItems(d.items);
  }, []);

  useEffect(() => {
    if (batchId) void loadBatch(batchId);
  }, [batchId, loadBatch]);

  async function upload() {
    if (!files.length || !jobId) return;
    setError(null);
    setProgress({ done: 0, total: files.length });
    let currentBatch = batchId;

    for (let i = 0; i < files.length; i += CHUNK) {
      const slice = files.slice(i, i + CHUNK);
      const form = new FormData();
      form.set("jobId", jobId);
      if (currentBatch) form.set("batchId", currentBatch);
      for (const f of slice) form.append("files", f);

      const res = await fetch("/api/hiring/ingest", { method: "POST", body: form });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        setError(d.message ?? "That upload failed. Anything already read is kept.");
        setProgress(null);
        if (currentBatch) setBatchId(currentBatch);
        return;
      }
      const d = (await res.json()) as { batchId: string };
      currentBatch = d.batchId;
      setProgress({ done: Math.min(i + CHUNK, files.length), total: files.length });
    }

    setProgress(null);
    setFiles([]);
    setBatchId(currentBatch);
    router.refresh();
  }

  async function act(action: "accept" | "reject") {
    if (!selected.size) return;
    setBusy(action);
    setError(null);
    const res = await fetch("/api/hiring/ingest/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        itemIds: [...selected],
        confirmedMerges: [...merges],
      }),
    });
    setBusy(null);
    if (!res.ok) {
      setError("That didn't save.");
      return;
    }
    const d = (await res.json()) as { skipped?: { reason: string }[] };
    if (d.skipped?.length) {
      setError(`${d.skipped.length} row(s) were skipped — ${d.skipped[0]!.reason}`);
    }
    setSelected(new Set());
    if (batchId) await loadBatch(batchId);
    router.refresh();
  }

  async function score() {
    const ids = [...selected].slice(0, 8);
    if (!ids.length) return;
    setBusy("score");
    setError(null);
    const res = await fetch("/api/hiring/ingest/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemIds: ids }),
    });
    setBusy(null);
    if (!res.ok) {
      setError("Scoring failed.");
      return;
    }
    if (batchId) await loadBatch(batchId);
  }

  const reviewable = (items ?? []).filter((i) => i.status === "parsed");
  const estimate = files.length * parseCost;

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div>
            <h2 className="text-h3 text-on-surface">Read a folder of CVs</h2>
            <p className="text-body-sm text-on-surface-variant max-w-prose">
              Each résumé becomes a candidate profile in the <strong>talent pool</strong>, with the
              file attached. Nobody is put into the pipeline — that stays something you do
              deliberately, so your conversion numbers keep meaning what they say.
            </p>
          </div>
          <RefreshBar loadedAt={loadedAt} label={`${creditsRemaining.toLocaleString("en-IN")} credits left`} />
        </div>

        {!aiEnabled && (
          <p className="rounded-lg border border-error bg-error-container px-md py-sm text-body-sm text-on-error-container">
            No AI key is configured, so résumés cannot be read. Everything else in Hiring works.
          </p>
        )}

        <div className="grid gap-md sm:grid-cols-[1fr,2fr,auto] sm:items-end">
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">These CVs are for</span>
            <select
              className="w-full h-10 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title} · {j.department}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">PDF files</span>
            <input
              type="file"
              multiple
              accept=".pdf,application/pdf"
              className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md file:mr-sm file:rounded file:border-0 file:bg-surface-container file:px-sm file:py-xs file:text-label-sm"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>

          <button
            type="button"
            className={primaryBtn}
            disabled={!aiEnabled || !files.length || !jobId || progress !== null}
            onClick={upload}
          >
            {progress ? `Reading ${progress.done}/${progress.total}…` : "Read them"}
          </button>
        </div>

        {files.length > 0 && !progress && (
          <p className="text-caption text-on-surface-variant">
            {files.length} file{files.length === 1 ? "" : "s"} · about{" "}
            <strong className="text-on-surface">{estimate.toLocaleString("en-IN")} credits</strong> to
            read them ({parseCost} each). Scoring is separate, and on demand, at {scoreCost} each.
            {estimate > creditsRemaining && (
              <span className="text-error"> That is more than you have left.</span>
            )}
          </p>
        )}

        {progress && (
          <div className="h-2 rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total}>
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
        )}
      </section>

      {items && (
        <section className="space-y-md">
          <div className="flex flex-wrap items-center justify-between gap-md">
            <h2 className="text-h2 text-on-surface">
              Review <span className="text-on-surface-variant">{reviewable.length} to decide</span>
            </h2>
            <div className="flex flex-wrap items-center gap-xs">
              <button type="button" className={btn} disabled={!selected.size || busy !== null} onClick={score}>
                {busy === "score" ? "Scoring…" : `Score selected (${scoreCost} each)`}
              </button>
              <button type="button" className={btn} disabled={!selected.size || busy !== null} onClick={() => act("reject")}>
                Reject
              </button>
              <button type="button" className={primaryBtn} disabled={!selected.size || busy !== null} onClick={() => act("accept")}>
                {busy === "accept" ? "Adding…" : `Add ${selected.size} to talent pool`}
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Nothing in this batch yet.</p>
          ) : (
            <ul className="space-y-sm">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={
                    "rounded-xl border p-md " +
                    (selected.has(item.id)
                      ? "border-primary ring-1 ring-primary bg-surface-container-lowest"
                      : "border-outline-variant bg-surface-container-lowest")
                  }
                >
                  <div className="flex items-start gap-sm">
                    <input
                      type="checkbox"
                      className="mt-xs accent-primary"
                      aria-label={`Select ${item.fileName}`}
                      disabled={item.status === "accepted" || item.status === "unreadable"}
                      checked={selected.has(item.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        })
                      }
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-sm">
                        <div className="min-w-0">
                          <span className="text-body-lg font-semibold text-on-surface">
                            {item.parsed?.fullName ?? item.fileName}
                          </span>
                          {item.parsed?.currentTitle && (
                            <span className="text-body-sm text-on-surface-variant">
                              {" "}· {item.parsed.currentTitle}
                              {item.parsed.currentEmployer ? ` at ${item.parsed.currentEmployer}` : ""}
                            </span>
                          )}
                        </div>
                        <StatusPill status={item.status} score={item.aiScore} />
                      </div>

                      <div className="text-caption text-on-surface-variant mt-xs">
                        {item.parsed?.email ?? "no email"} · {item.parsed?.phone ?? "no phone"}
                        {item.parsed?.totalExperienceYears != null && ` · ${item.parsed.totalExperienceYears} yrs`}
                        {item.blobUrl && (
                          <>
                            {" · "}
                            <a className="text-primary hover:underline" href={item.blobUrl} target="_blank" rel="noopener noreferrer">
                              open CV
                            </a>
                          </>
                        )}
                        {" · "}
                        <span className="opacity-70">{item.fileName}</span>
                      </div>

                      {item.parsed && item.parsed.confidence < 0.5 && (
                        <p className="text-caption text-error mt-xs">
                          Low confidence ({Math.round(item.parsed.confidence * 100)}%) — likely a scan.
                          Check the fields against the CV before accepting.
                        </p>
                      )}

                      {item.error && <p className="text-caption text-on-surface-variant mt-xs">{item.error}</p>}

                      {item.duplicate && (
                        <div
                          className={
                            "mt-sm rounded-lg border p-sm " +
                            (item.duplicate.needsConfirmation
                              ? "border-primary bg-primary-fixed/30"
                              : "border-outline-variant bg-surface-container-low")
                          }
                        >
                          <div className="text-body-sm text-on-surface">
                            {item.duplicate.needsConfirmation ? "Might be" : "Already on file as"}{" "}
                            <strong>{item.duplicate.fullName}</strong>
                            {item.duplicate.currentEmployer ? ` · ${item.duplicate.currentEmployer}` : ""}
                          </div>
                          {item.duplicate.needsConfirmation && (
                            <label className="mt-xs flex items-center gap-xs text-body-sm text-on-surface-variant">
                              <input
                                type="checkbox"
                                className="accent-primary"
                                checked={merges.has(item.id)}
                                onChange={(e) =>
                                  setMerges((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(item.id);
                                    else next.delete(item.id);
                                    return next;
                                  })
                                }
                              />
                              Yes, this is the same person — attach the CV to their record
                            </label>
                          )}
                        </div>
                      )}

                      {item.suggestions.length > 0 && (
                        <div className="mt-sm flex flex-wrap items-center gap-xs">
                          <span className="text-caption text-on-surface-variant">Looks like a fit for</span>
                          {item.suggestions
                            .filter((s) => s.fit > 0)
                            .slice(0, 3)
                            .map((s) => (
                              <span
                                key={s.jobId}
                                title={
                                  s.missingMustHaves.length
                                    ? `No evidence for: ${s.missingMustHaves.join(", ")}`
                                    : "Every must-have evidenced"
                                }
                                className="h-6 inline-flex items-center px-sm rounded-full bg-surface-container text-label-sm text-on-surface"
                              >
                                {s.title} · {s.fit}
                              </span>
                            ))}
                          {item.suggestions.every((s) => s.fit === 0) && (
                            <span className="text-caption text-on-surface-variant">
                              nothing obvious — worth a look yourself
                            </span>
                          )}
                        </div>
                      )}

                      {item.aiScoreBreakdown && (
                        <details className="mt-sm">
                          <summary className="text-label-sm text-on-surface-variant cursor-pointer">
                            Why {item.aiScore}?
                          </summary>
                          <ul className="mt-xs space-y-xs">
                            {item.aiScoreBreakdown.map((b) => (
                              <li key={b.criterion} className="text-body-sm">
                                <span className="text-on-surface">{b.criterion}</span>{" "}
                                <span className="text-on-surface-variant tabular-nums">
                                  {b.score}/4 · {b.weight}%
                                </span>
                                <p className="text-caption text-on-surface-variant italic">
                                  &ldquo;{b.evidence}&rdquo;
                                </p>
                              </li>
                            ))}
                          </ul>
                          <p className="text-caption text-on-surface-variant mt-xs">
                            Scored from the CV alone — it has not seen answers to your screening
                            questions, because nobody has applied.
                          </p>
                        </details>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {batches.length > 0 && (
        <section className="space-y-sm">
          <h2 className="text-h2 text-on-surface">Recent imports</h2>
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">Requisition</th>
                  <th className="px-md py-sm text-right">Files</th>
                  <th className="px-md py-sm text-right">Read</th>
                  <th className="px-md py-sm text-right">Duplicates</th>
                  <th className="px-md py-sm text-right">Unreadable</th>
                  <th className="px-md py-sm">When</th>
                  <th className="px-md py-sm sr-only">Open</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-outline-variant last:border-0">
                    <td className="px-lg py-sm text-on-surface">{b.jobTitle}</td>
                    <td className="px-md py-sm text-right tabular-nums">{b.fileCount}</td>
                    <td className="px-md py-sm text-right tabular-nums">{b.parsedCount}</td>
                    <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{b.skippedCount}</td>
                    <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{b.failedCount}</td>
                    <td className="px-md py-sm text-on-surface-variant whitespace-nowrap">
                      {formatHiringDate(b.createdAt)}
                    </td>
                    <td className="px-md py-sm text-right">
                      <button type="button" className={btn} onClick={() => setBatchId(b.id)}>
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function StatusPill({ status, score }: { status: string; score: number | null }) {
  const label =
    status === "accepted" ? "Added" :
    status === "duplicate" ? "Duplicate" :
    status === "unreadable" ? "Couldn't read" :
    status === "rejected" ? "Rejected" : "Ready";
  const tone =
    status === "accepted" ? "bg-primary text-on-primary" :
    status === "unreadable" ? "bg-error-container text-on-error-container" :
    "bg-surface-container text-on-surface-variant";
  return (
    <span className="flex items-center gap-xs">
      {score != null && (
        <span className="text-body-md font-semibold text-on-surface tabular-nums">{score}</span>
      )}
      <span className={"inline-flex items-center h-6 px-sm rounded-full text-label-sm " + tone}>{label}</span>
    </span>
  );
}
