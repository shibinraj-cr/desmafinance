"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VoxbayCaller } from "@/lib/crm-voxbay-reconcile";

type ReconcileResponse = {
  sinceDate: string;
  fileName: string | null;
  totals: {
    callRows: number;
    uniqueCallers: number;
    missing: number;
    inCrm: number;
    beforeSince: number;
    noNumber: number;
    undated: number;
  };
  missingCallers: VoxbayCaller[];
  warnings: string[];
};

type ImportResponse = {
  totalRows: number;
  insertedRows: number;
  reInquiryRows: number;
  errorRows: number;
  errors: string[];
};

const fmtNum = (n: number) => n.toLocaleString("en-IN");
const fmtDateTime = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");
const PAGE_SIZE = 300;

export function VoxbayReconcileClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [sinceDate, setSinceDate] = useState("");
  const [reconciling, startReconcile] = useTransition();
  const [result, setResult] = useState<ReconcileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [importing, startImport] = useTransition();
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function runReconcile() {
    if (!file || !sinceDate) return;
    setError(null);
    setResult(null);
    setImportResult(null);
    setImportError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("sinceDate", sinceDate);
    startReconcile(async () => {
      const res = await fetch("/api/crm/voxbay-reconcile", { method: "POST", body: fd });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(d.message || d.error || "Reconciliation failed.");
        return;
      }
      const data = (await res.json()) as ReconcileResponse;
      setResult(data);
      setDeselected(new Set());
      setVisibleCount(PAGE_SIZE);
    });
  }

  const missingCallers = useMemo(() => result?.missingCallers ?? [], [result]);
  const selected = useMemo(
    () => missingCallers.filter((c) => !deselected.has(c.phoneE164)),
    [missingCallers, deselected],
  );

  function toggle(key: string, on: boolean) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function selectAll(on: boolean) {
    setDeselected(on ? new Set() : new Set(missingCallers.map((c) => c.phoneE164)));
  }

  function runImport() {
    if (selected.length === 0) return;
    setImportError(null);
    setImportResult(null);
    startImport(async () => {
      const res = await fetch("/api/crm/voxbay-reconcile/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: result?.fileName ?? null, callers: selected }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setImportError(d.message || d.error || "Import failed.");
        return;
      }
      setImportResult((await res.json()) as ImportResponse);
      router.refresh();
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
        <h2 className="text-title-sm font-semibold text-on-surface">Upload the Voxbay incoming-call report</h2>
        <p className="mt-xs text-body-sm text-on-surface-variant">
          Upload the Voxbay <strong>incoming-call CSV</strong> and pick a date. Every caller (by phone number) with a
          call on or after that date is checked against the CRM — the ones with no matching lead are listed below so you
          can create them. Repeat calls from the same number are collapsed into one caller.
        </p>

        <div className="mt-md flex flex-wrap items-end gap-md">
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm font-semibold text-on-surface-variant">Call report (.csv)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
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
              phone_in_talk
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

        {error && <div className="mt-md rounded-lg border border-error bg-error-container/30 px-md py-sm text-body-sm text-error">{error}</div>}
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Missing from CRM" value={result.totals.missing} accent />
            <Tile label="Already in CRM" value={result.totals.inCrm} />
            <Tile label="Unique callers" value={result.totals.uniqueCallers} />
            <Tile label="Call rows" value={result.totals.callRows} />
            <Tile label="Before the date" value={result.totals.beforeSince} />
            <Tile label="No number" value={result.totals.noNumber} />
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

          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
            <div className="flex flex-wrap items-center gap-md border-b border-outline-variant px-lg py-md">
              <h2 className="text-title-sm font-semibold text-on-surface">
                Callers not in the CRM{" "}
                <span className="text-on-surface-variant">
                  ({fmtNum(selected.length)} selected of {fmtNum(missingCallers.length)})
                </span>
              </h2>
              <div className="ml-auto flex items-center gap-sm">
                <button type="button" onClick={() => selectAll(true)} className="text-label-sm text-primary hover:underline">
                  Select all
                </button>
                <span className="text-outline-variant">·</span>
                <button type="button" onClick={() => selectAll(false)} className="text-label-sm text-primary hover:underline">
                  Select none
                </button>
                <button
                  type="button"
                  onClick={runImport}
                  disabled={selected.length === 0 || importing}
                  className="inline-flex h-9 items-center gap-xs rounded-lg bg-primary px-lg text-label-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    person_add
                  </span>
                  {importing ? "Creating…" : `Create ${fmtNum(selected.length)} lead${selected.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>

            {importResult && (
              <div className="border-b border-outline-variant bg-green-50 px-lg py-sm text-body-sm text-green-800">
                Created {fmtNum(importResult.insertedRows)} lead{importResult.insertedRows === 1 ? "" : "s"}
                {importResult.reInquiryRows ? `, ${fmtNum(importResult.reInquiryRows)} folded into re-inquiry` : ""}
                {importResult.errorRows ? `, ${fmtNum(importResult.errorRows)} skipped` : ""}. Source “Voxbay”, phone-only
                — add names as they’re worked.
              </div>
            )}
            {importError && <div className="border-b border-outline-variant px-lg py-sm text-body-sm text-error">{importError}</div>}

            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead className="text-label-sm text-on-surface-variant">
                  <tr className="border-b border-outline-variant">
                    <th className="px-lg py-sm text-left font-semibold"></th>
                    <th className="px-md py-sm text-left font-semibold">Caller number</th>
                    <th className="px-md py-sm text-right font-semibold">Calls</th>
                    <th className="px-md py-sm text-left font-semibold">Last call</th>
                    <th className="px-md py-sm text-left font-semibold">Handled by</th>
                    <th className="px-md py-sm text-left font-semibold">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {missingCallers.slice(0, visibleCount).map((c) => (
                    <tr key={c.phoneE164} className="border-b border-outline-variant/50">
                      <td className="px-lg py-sm">
                        <input type="checkbox" checked={!deselected.has(c.phoneE164)} onChange={(e) => toggle(c.phoneE164, e.target.checked)} />
                      </td>
                      <td className="px-md py-sm tabular-nums text-on-surface">{c.phoneE164}</td>
                      <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{fmtNum(c.callCount)}</td>
                      <td className="px-md py-sm tabular-nums text-on-surface-variant">{fmtDateTime(c.lastCallAt)}</td>
                      <td className="px-md py-sm text-on-surface-variant">{c.agents.join(", ") || "—"}</td>
                      <td className="px-md py-sm text-on-surface-variant">{c.contactName || "—"}</td>
                    </tr>
                  ))}
                  {missingCallers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-lg py-lg text-center text-on-surface-variant">
                        Every caller since that date is already in the CRM. 🎉
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {missingCallers.length > visibleCount && (
              <div className="border-t border-outline-variant px-lg py-sm text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="text-label-sm text-primary hover:underline"
                >
                  Show {fmtNum(Math.min(PAGE_SIZE, missingCallers.length - visibleCount))} more
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
