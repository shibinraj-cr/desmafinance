"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MetaLeadRow, ReconcileSummary } from "@/lib/crm-meta-reconcile";

type ReconcileResult = ReconcileSummary & {
  fileName: string;
  missingRows: MetaLeadRow[];
};

type ImportResponse = {
  totalRows: number;
  insertedRows: number;
  reInquiryRows: number;
  revivedRows: number;
  errorRows: number;
  errors: string[];
};

const rowId = (r: MetaLeadRow) => `${r.sheetName}::${r.rowNumber}`;
const fmtNum = (n: number) => n.toLocaleString("en-IN");
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

// How many missing rows to render at once (selection/import still cover them all).
const PAGE_SIZE = 300;

// The parser pulls in xlsx (~400 KB), so it loads only when someone reconciles.
const loadReconcileLib = () => import("@/lib/crm-meta-reconcile");

// Let the browser paint a progress message before a long synchronous parse.
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Our JSON error message, else the HTTP status (a 413 from Vercel isn't JSON). */
async function failureMessage(res: Response, fallback: string): Promise<string> {
  const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return d.message || d.error || `${fallback} (HTTP ${res.status}).`;
}

export function MetaReconcileClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [sinceDate, setSinceDate] = useState("");
  const [reconciling, startReconcile] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-sheet include toggles + explicitly-deselected rows.
  const [includedSheets, setIncludedSheets] = useState<Set<string>>(new Set());
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [importing, startImport] = useTransition();
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // The file is parsed HERE, not uploaded — see src/lib/crm-meta-reconcile.ts.
  // Only the match keys go to the server, in batches, to ask which are in the CRM.
  function runReconcile() {
    if (!file || !sinceDate) return;
    setError(null);
    setResult(null);
    setImportResult(null);
    setImportError(null);
    startReconcile(async () => {
      try {
        const lib = await loadReconcileLib();
        const sinceStart = lib.parseSinceDate(sinceDate);
        if (!sinceStart) {
          setError("Pick a valid reconciliation date.");
          return;
        }

        setProgress("Reading the file…");
        await nextPaint();
        let parsed;
        try {
          parsed = lib.parseMetaWorkbook(await file.arrayBuffer());
        } catch {
          setError("Could not read the spreadsheet. Upload the original .xlsx (not a CSV re-export).");
          return;
        }
        const allRows = parsed.sheets.filter((s) => !s.skipped).flatMap((s) => s.rows);
        if (allRows.length === 0) {
          setError("No lead rows found in any sheet. Check the file has Name / Phone / Email columns.");
          return;
        }

        const { emailKeys, phoneKeys } = lib.collectLookupKeys(allRows, sinceStart);
        const keys = [
          ...emailKeys.map((key) => ({ kind: "email" as const, key })),
          ...phoneKeys.map((key) => ({ kind: "phone" as const, key })),
        ];
        const batches = lib.chunked(keys, lib.KEY_LOOKUP_BATCH);
        const existing = { emailKeys: new Set<string>(), phoneKeys: new Set<string>() };
        for (let i = 0; i < batches.length; i++) {
          setProgress(
            `Checking ${fmtNum(keys.length)} phone numbers and emails against the CRM` +
              (batches.length > 1 ? ` (batch ${i + 1} of ${batches.length})…` : "…"),
          );
          const res = await fetch("/api/crm/meta-reconcile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              emailKeys: batches[i].filter((k) => k.kind === "email").map((k) => k.key),
              phoneKeys: batches[i].filter((k) => k.kind === "phone").map((k) => k.key),
            }),
          });
          if (!res.ok) {
            setError(await failureMessage(res, "Reconciliation failed"));
            return;
          }
          const found = (await res.json()) as { emailKeys: string[]; phoneKeys: string[] };
          for (const k of found.emailKeys) existing.emailKeys.add(k);
          for (const k of found.phoneKeys) existing.phoneKeys.add(k);
        }

        const buckets = lib.reconcileRows(allRows, sinceStart, existing);
        const summary = lib.summarizeReconcile(parsed, buckets);
        setResult({ ...summary, fileName: file.name, missingRows: buckets.missing });
        // Default: include every lead sheet that has missing rows, except ones that
        // look like non-lead campaigns (e.g. Hiring) — the user can re-tick those.
        const included = new Set(
          summary.sheets.filter((s) => !s.skipped && !s.isLikelyNonLead && s.counts.missing > 0).map((s) => s.sheetName),
        );
        setIncludedSheets(included);
        setDeselected(new Set());
        setVisibleCount(PAGE_SIZE);
      } catch {
        setError("Reconciliation failed — check your connection and try again.");
      } finally {
        setProgress(null);
      }
    });
  }

  const missingRows = useMemo(() => result?.missingRows ?? [], [result]);

  const selectedRows = useMemo(
    () => missingRows.filter((r) => includedSheets.has(r.sheetName) && !deselected.has(rowId(r))),
    [missingRows, includedSheets, deselected],
  );
  const visibleRows = useMemo(
    () => missingRows.filter((r) => includedSheets.has(r.sheetName)),
    [missingRows, includedSheets],
  );

  function toggleSheet(name: string, on: boolean) {
    setIncludedSheets((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }
  function toggleRow(id: string, on: boolean) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible(on: boolean) {
    setDeselected((prev) => {
      const next = new Set(prev);
      for (const r of visibleRows) {
        if (on) next.delete(rowId(r));
        else next.add(rowId(r));
      }
      return next;
    });
  }

  // Sent in parts so a big selection can't hit the body cap either. Each part is
  // its own import batch; the server folds any row already in the CRM into a
  // re-inquiry, so a retry after a partial failure never duplicates a lead.
  function runImport() {
    if (selectedRows.length === 0 || !result) return;
    setImportError(null);
    setImportResult(null);
    const fileName = result.fileName;
    startImport(async () => {
      const total: ImportResponse = { totalRows: 0, insertedRows: 0, reInquiryRows: 0, revivedRows: 0, errorRows: 0, errors: [] };
      try {
        const lib = await loadReconcileLib();
        const parts = lib.chunked(selectedRows, lib.IMPORT_BATCH);
        for (let i = 0; i < parts.length; i++) {
          if (parts.length > 1) setImportProgress(`Importing part ${i + 1} of ${parts.length}…`);
          const res = await fetch("/api/crm/meta-reconcile/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: parts.length > 1 ? `${fileName} (part ${i + 1} of ${parts.length})` : fileName,
              rows: parts[i],
            }),
          });
          if (!res.ok) {
            const msg = await failureMessage(res, "Import failed");
            setImportError(
              i === 0
                ? msg
                : `${msg} ${i === 1 ? "Part 1" : `Parts 1–${i}`} of ${parts.length} were imported. Run Reconcile again to see what is still missing.`,
            );
            break;
          }
          const d = (await res.json()) as ImportResponse;
          total.totalRows += d.totalRows;
          total.insertedRows += d.insertedRows;
          total.reInquiryRows += d.reInquiryRows;
          total.revivedRows += d.revivedRows;
          total.errorRows += d.errorRows;
          total.errors.push(...d.errors);
        }
      } catch {
        setImportError(
          total.totalRows
            ? "Import stopped part-way — check your connection, then run Reconcile again to see what is still missing."
            : "Import failed — check your connection and try again.",
        );
      } finally {
        setImportProgress(null);
      }
      if (total.totalRows > 0) {
        setImportResult(total);
        router.refresh();
      }
    });
  }

  function reset() {
    setResult(null);
    setFile(null);
    setError(null);
    setImportResult(null);
    setImportError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-lg">
      {/* Upload */}
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
        <h2 className="text-title-sm font-semibold text-on-surface">Upload the Meta leads export</h2>
        <p className="mt-xs text-body-sm text-on-surface-variant">
          Upload the original Meta <strong>.xlsx</strong> (multiple sheets = multiple campaigns). Pick a date — only
          leads created on or after it are reconciled against the CRM. Existing candidates fold into a re-inquiry, so no
          duplicates are created.
        </p>
        <p className="mt-xs text-label-sm text-on-surface-variant">
          Keep the original <strong>.xlsx</strong>. Re-saving it as CSV in Excel corrupts phone numbers (scientific
          notation) — the tool reads the .xlsx correctly.
        </p>

        <div className="mt-md flex flex-wrap items-end gap-md">
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm font-semibold text-on-surface-variant">Meta file (.xlsx)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-body-sm text-on-surface file:mr-sm file:rounded-lg file:border file:border-outline-variant file:bg-surface-container-low file:px-md file:py-xs file:text-label-sm file:font-semibold file:text-on-surface"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm font-semibold text-on-surface-variant">Reconcile from date</label>
            <input
              type="date"
              value={sinceDate}
              onChange={(e) => setSinceDate(e.target.value)}
              className="h-9 rounded-lg border border-outline-variant bg-surface-container-lowest px-md text-body-sm text-on-surface"
            />
          </div>
          <button
            type="button"
            onClick={runReconcile}
            disabled={!file || !sinceDate || reconciling}
            className="inline-flex h-9 items-center gap-xs rounded-lg bg-primary px-lg text-label-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-50"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              rule
            </span>
            {reconciling ? "Reconciling…" : "Reconcile"}
          </button>
          {result && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center gap-xs rounded-lg border border-outline-variant px-md text-label-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-low"
            >
              Start over
            </button>
          )}
        </div>

        {reconciling && progress && <p className="mt-md text-body-sm text-on-surface-variant">{progress}</p>}
        {error && <div className="mt-md rounded-lg border border-error bg-error-container/30 px-md py-sm text-body-sm text-error">{error}</div>}
      </div>

      {result && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Missing from CRM" value={result.totals.missing} accent />
            <Tile label="Already in CRM" value={result.totals.matchedInCrm} />
            <Tile label="In-file duplicates" value={result.totals.withinFileDupes} />
            <Tile label="Before the date" value={result.totals.beforeSince} />
            <Tile label="No date" value={result.totals.noDate} />
            <Tile label="No phone/email" value={result.totals.unmatchable} />
          </div>

          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md text-body-sm text-on-surface-variant">
              <ul className="list-disc space-y-xs pl-lg">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-sheet breakdown */}
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
            <div className="border-b border-outline-variant px-lg py-md">
              <h2 className="text-title-sm font-semibold text-on-surface">Campaigns (sheets)</h2>
              <p className="mt-xs text-label-sm text-on-surface-variant">
                Tick the campaigns whose missing leads you want to import. Non-lead sheets are unticked by default.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead className="text-label-sm text-on-surface-variant">
                  <tr className="border-b border-outline-variant">
                    <th className="px-lg py-sm text-left font-semibold">Include</th>
                    <th className="px-md py-sm text-left font-semibold">Campaign / sheet</th>
                    <th className="px-md py-sm text-right font-semibold">Rows</th>
                    <th className="px-md py-sm text-right font-semibold">Missing</th>
                    <th className="px-md py-sm text-right font-semibold">In CRM</th>
                    <th className="px-md py-sm text-right font-semibold">Dupes</th>
                    <th className="px-md py-sm text-right font-semibold">No date</th>
                    <th className="px-md py-sm text-left font-semibold">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sheets.map((s) => (
                    <tr key={s.sheetName} className="border-b border-outline-variant/50">
                      <td className="px-lg py-sm">
                        <input
                          type="checkbox"
                          disabled={s.skipped || s.counts.missing === 0}
                          checked={includedSheets.has(s.sheetName)}
                          onChange={(e) => toggleSheet(s.sheetName, e.target.checked)}
                        />
                      </td>
                      <td className="px-md py-sm text-on-surface">
                        <span className="font-medium">{s.sheetName}</span>
                        {s.isLikelyNonLead && !s.skipped && (
                          <span className="ml-xs rounded bg-amber-100 px-xs text-label-sm text-amber-800">non-lead?</span>
                        )}
                      </td>
                      <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{fmtNum(s.dataRowCount)}</td>
                      <td className="px-md py-sm text-right tabular-nums font-semibold text-on-surface">{fmtNum(s.counts.missing)}</td>
                      <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{fmtNum(s.counts.matchedInCrm)}</td>
                      <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{fmtNum(s.counts.withinFileDupes)}</td>
                      <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{fmtNum(s.counts.noDate)}</td>
                      <td className="px-md py-sm text-label-sm text-on-surface-variant">
                        {s.skipped ? s.skipReason ?? "skipped" : Object.keys(s.mapping).length ? "" : "no columns mapped"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Missing leads + import */}
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
            <div className="flex flex-wrap items-center gap-md border-b border-outline-variant px-lg py-md">
              <h2 className="text-title-sm font-semibold text-on-surface">
                Missing leads{" "}
                <span className="text-on-surface-variant">
                  ({fmtNum(selectedRows.length)} selected of {fmtNum(visibleRows.length)})
                </span>
              </h2>
              <div className="ml-auto flex items-center gap-sm">
                <button type="button" onClick={() => selectAllVisible(true)} className="text-label-sm text-primary hover:underline">
                  Select all
                </button>
                <span className="text-outline-variant">·</span>
                <button type="button" onClick={() => selectAllVisible(false)} className="text-label-sm text-primary hover:underline">
                  Select none
                </button>
                <button
                  type="button"
                  onClick={runImport}
                  disabled={selectedRows.length === 0 || importing}
                  className="inline-flex h-9 items-center gap-xs rounded-lg bg-primary px-lg text-label-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    person_add
                  </span>
                  {importing ? importProgress ?? "Importing…" : `Import ${fmtNum(selectedRows.length)} selected`}
                </button>
              </div>
            </div>

            {importResult && (
              <div className="border-b border-outline-variant bg-green-50 px-lg py-sm text-body-sm text-green-800">
                Imported {fmtNum(importResult.insertedRows)} new lead{importResult.insertedRows === 1 ? "" : "s"}
                {importResult.reInquiryRows ? `, ${fmtNum(importResult.reInquiryRows)} folded into re-inquiry` : ""}
                {importResult.errorRows ? `, ${fmtNum(importResult.errorRows)} skipped` : ""}. Source “Meta”.
              </div>
            )}
            {importError && <div className="border-b border-outline-variant px-lg py-sm text-body-sm text-error">{importError}</div>}

            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead className="text-label-sm text-on-surface-variant">
                  <tr className="border-b border-outline-variant">
                    <th className="px-lg py-sm text-left font-semibold"></th>
                    <th className="px-md py-sm text-left font-semibold">Name</th>
                    <th className="px-md py-sm text-left font-semibold">Phone</th>
                    <th className="px-md py-sm text-left font-semibold">Email</th>
                    <th className="px-md py-sm text-left font-semibold">Campaign</th>
                    <th className="px-md py-sm text-left font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, visibleCount).map((r) => {
                    const id = rowId(r);
                    return (
                      <tr key={id} className="border-b border-outline-variant/50">
                        <td className="px-lg py-sm">
                          <input type="checkbox" checked={!deselected.has(id)} onChange={(e) => toggleRow(id, e.target.checked)} />
                        </td>
                        <td className="px-md py-sm text-on-surface">{r.candidateName || "—"}</td>
                        <td className="px-md py-sm tabular-nums text-on-surface-variant">{r.phoneE164 || r.phone || r.altPhoneE164 || r.altPhone || "—"}</td>
                        <td className="px-md py-sm text-on-surface-variant">{r.email || "—"}</td>
                        <td className="px-md py-sm text-on-surface-variant">{r.campaign || "—"}</td>
                        <td className="px-md py-sm tabular-nums text-on-surface-variant">{fmtDate(r.createdAt)}</td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-lg py-lg text-center text-on-surface-variant">
                        No missing leads in the ticked campaigns.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {visibleRows.length > visibleCount && (
              <div className="border-t border-outline-variant px-lg py-sm text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="text-label-sm text-primary hover:underline"
                >
                  Show {fmtNum(Math.min(PAGE_SIZE, visibleRows.length - visibleCount))} more
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-md ${accent ? "border-primary/40 bg-primary/5" : "border-outline-variant bg-surface-container-lowest"}`}>
      <div className={`text-headline-sm font-semibold tabular-nums ${accent ? "text-primary" : "text-on-surface"}`}>{fmtNum(value)}</div>
      <div className="mt-xs text-label-sm text-on-surface-variant">{label}</div>
    </div>
  );
}
