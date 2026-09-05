"use client";

import { useState } from "react";
import { IMPORT_FIELDS, IMPORT_FIELD_LABELS, type ImportField } from "@/lib/hiring/csv-import";

/**
 * CSV import: pick a file → map its columns → read the preview → commit.
 *
 * The preview step is not optional. An import that silently drops rows is the
 * thing people discover three weeks later when a candidate says "I applied";
 * so every row that cannot be used is listed with its row number, before
 * anything is written.
 */

type Preview = {
  headers: string[];
  mapping: Record<string, ImportField | null>;
  rowCount: number;
  willCreate: number;
  willAttach: number;
  alreadyOnJob: number;
  problems: { rowNumber: number; reason: string }[];
  sample: { rowNumber: number; fullName: string; email: string | null; phone: string | null }[];
};

type Result = { created: number; attached: number; failures: { rowNumber: number; reason: string }[] };

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";

export function ImportPanel({
  jobs,
  onClose,
  onDone,
}: {
  jobs: { id: string; title: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportField | null>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setPreview(null);
    if (file.size > 2 * 1024 * 1024) {
      setError("That file is over 2 MB. Split it and import in parts.");
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function run(mode: "preview" | "commit", useMapping?: Record<string, ImportField | null>) {
    if (!csv || !jobId) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/hiring/candidates/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, csv, jobId, mapping: useMapping ?? (preview ? mapping : undefined) }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That file could not be read.");
      return;
    }
    if (mode === "preview") {
      const p = (await res.json()) as Preview;
      setPreview(p);
      setMapping(p.mapping);
    } else {
      setResult((await res.json()) as Result);
    }
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-low p-lg space-y-md">
      <div className="flex items-start justify-between gap-md">
        <div>
          <h3 className="text-h3 text-on-surface">Import candidates</h3>
          <p className="text-body-sm text-on-surface-variant">
            A CSV with a header row. Nothing is written until you have read the preview.
          </p>
        </div>
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      {result ? (
        <div className="space-y-md">
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
            <p className="text-body-md text-on-surface">
              <strong>{result.created}</strong> new {result.created === 1 ? "candidate" : "candidates"} created,{" "}
              <strong>{result.attached}</strong> attached to people already in the system.
            </p>
            {result.failures.length > 0 && (
              <>
                <p className="text-body-sm text-error mt-sm">
                  {result.failures.length} {result.failures.length === 1 ? "row was" : "rows were"} not imported:
                </p>
                <ul className="mt-xs space-y-xs text-body-sm text-on-surface-variant max-h-48 overflow-y-auto">
                  {result.failures.map((f) => (
                    <li key={f.rowNumber}>
                      Row {f.rowNumber} — {f.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <button type="button" className={primaryBtn} onClick={onDone}>
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-md sm:grid-cols-[1fr,1fr,auto] sm:items-end">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md file:mr-sm file:rounded file:border-0 file:bg-surface-container file:px-sm file:py-xs file:text-label-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Add them to</span>
              <select
                className="w-full h-10 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={primaryBtn} disabled={!csv || !jobId || busy} onClick={() => run("preview")}>
              {busy ? "Reading…" : "Read the file"}
            </button>
          </div>

          {fileName && <p className="text-caption text-on-surface-variant">{fileName}</p>}

          {preview && (
            <div className="space-y-md">
              <div>
                <h4 className="text-body-lg font-semibold text-on-surface mb-sm">Columns</h4>
                <div className="grid gap-sm sm:grid-cols-2 lg:grid-cols-3">
                  {preview.headers.map((h, i) => (
                    <label key={i} className="block">
                      <span className="block text-caption text-on-surface-variant mb-xs truncate" title={h}>
                        {h || `Column ${i + 1}`}
                      </span>
                      <select
                        className="w-full h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-sm"
                        value={mapping[String(i)] ?? ""}
                        onChange={(e) =>
                          setMapping((prev) => ({
                            ...prev,
                            [String(i)]: (e.target.value || null) as ImportField | null,
                          }))
                        }
                      >
                        <option value="">Ignore this column</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {IMPORT_FIELD_LABELS[f]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <button type="button" className={btn + " mt-sm"} onClick={() => run("preview", mapping)} disabled={busy}>
                  Re-read with this mapping
                </button>
              </div>

              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
                <h4 className="text-body-lg font-semibold text-on-surface">What will happen</h4>
                <ul className="text-body-md text-on-surface-variant space-y-xs">
                  <li>
                    <strong className="text-on-surface">{preview.willCreate}</strong> new candidates created
                  </li>
                  <li>
                    <strong className="text-on-surface">{preview.willAttach}</strong> already in the system —
                    they will be added to this requisition, not duplicated
                  </li>
                  <li>
                    <strong className="text-on-surface">{preview.alreadyOnJob}</strong> already on this
                    requisition — these will be skipped
                  </li>
                  <li className={preview.problems.length ? "text-error" : ""}>
                    <strong>{preview.problems.length}</strong> rows cannot be used
                  </li>
                </ul>

                {preview.problems.length > 0 && (
                  <details>
                    <summary className="text-label-sm text-on-surface-variant cursor-pointer">
                      Show the {preview.problems.length} unusable rows
                    </summary>
                    <ul className="mt-xs space-y-xs text-body-sm text-on-surface-variant max-h-48 overflow-y-auto">
                      {preview.problems.map((p) => (
                        <li key={p.rowNumber}>
                          Row {p.rowNumber} — {p.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {preview.sample.length > 0 && (
                  <details>
                    <summary className="text-label-sm text-on-surface-variant cursor-pointer">
                      Preview the first {preview.sample.length}
                    </summary>
                    <ul className="mt-xs space-y-xs text-body-sm text-on-surface-variant">
                      {preview.sample.map((s) => (
                        <li key={s.rowNumber}>
                          {s.fullName} · {s.email ?? s.phone ?? "—"}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              <button
                type="button"
                className={primaryBtn}
                disabled={busy || preview.willCreate + preview.willAttach === 0}
                onClick={() => run("commit")}
              >
                {busy
                  ? "Importing…"
                  : `Import ${preview.willCreate + preview.willAttach} ${
                      preview.willCreate + preview.willAttach === 1 ? "candidate" : "candidates"
                    }`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
