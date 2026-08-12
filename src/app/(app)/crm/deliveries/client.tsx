"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type DeliveryRow = {
  id: string;
  leadId: string | null;
  candidateName: string | null;
  phone: string | null;
  touch: number | null;
  stage: string | null;
  owner: string | null;
  /** 'delivery' = Meta bounced it after Wabis accepted; 'transport' = our POST never landed. */
  layer: "delivery" | "transport";
  errorCode: string | null;
  errorMessage: string | null;
  flaggedUndeliverable: boolean;
  undeliverableReason: string | null;
  at: string;
};

/** Human meaning for the Meta/WhatsApp error codes we see in practice. */
const ERROR_MEANING: Record<string, string> = {
  "131026": "Undeliverable — not on WhatsApp / bad number",
  "131049": "Frequency-capped — Meta cold-marketing limit",
  "131047": "Re-engagement outside the 24h window",
  "131051": "Unsupported message type",
  "131000": "Generic error — can retry",
  "132000": "Template mismatch (params)",
  "132001": "Template does not exist / not approved",
  "470": "Re-engagement window expired",
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";

function meaning(code: string | null): string {
  if (!code) return "Unknown / no code reported";
  return ERROR_MEANING[code] ?? `Error ${code}`;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ImportSummary = {
  parsed: number;
  matched: number;
  unmatched: number;
  failures: number;
  flagged: number;
  delivered: number;
  unmatchedPhones: string[];
};

export function DeliveriesClient({ rows, canImport }: { rows: DeliveryRow[]; canImport: boolean }) {
  const [q, setQ] = useState("");
  const [codeFilter, setCodeFilter] = useState<string>("all");

  const [importTouch, setImportTouch] = useState(1);
  const [importBusy, setImportBusy] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function runImport() {
    if (!importFile) return;
    setImportBusy(true);
    setImportResult(null);
    setImportError(null);
    try {
      const csv = await importFile.text();
      const r = await fetch("/api/crm/integrations/wabis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import_delivery_report", csv, touch: importTouch }),
      });
      const p = (await r.json().catch(() => ({}))) as { summary?: ImportSummary; message?: string };
      if (!r.ok || !p.summary) {
        setImportError(p.message ?? "That didn't work.");
        return;
      }
      const s = p.summary;
      setImportResult(
        `Imported ${s.parsed} rows for Touch ${importTouch}: ${s.matched} matched to leads ` +
          `(${s.failures} failures recorded, ${s.flagged} flagged undeliverable, ${s.delivered} delivered/read), ` +
          `${s.unmatched} unmatched. Refresh to see them below.`,
      );
    } catch {
      setImportError("Couldn't read that file — make sure it's the Wabis CSV export.");
    } finally {
      setImportBusy(false);
    }
  }

  const codes = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) {
      const k = r.errorCode ?? "none";
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const undeliverable = rows.filter((r) => r.errorCode === "131026" || r.flaggedUndeliverable).length;
  const capped = rows.filter((r) => r.errorCode === "131049").length;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (codeFilter !== "all") {
        if (codeFilter === "none" ? r.errorCode != null : r.errorCode !== codeFilter) return false;
      }
      if (!term) return true;
      return (
        (r.candidateName ?? "").toLowerCase().includes(term) ||
        (r.phone ?? "").toLowerCase().includes(term) ||
        (r.owner ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, q, codeFilter]);

  function downloadCsv() {
    const head = ["Lead", "Phone", "Touch", "Stage", "Owner", "Layer", "Error code", "Meaning", "Flagged undeliverable", "When"];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const r of filtered) {
      lines.push(
        [
          r.candidateName ?? "",
          r.phone ?? "",
          r.touch != null ? `Touch ${r.touch}` : "",
          r.stage ?? "",
          r.owner ?? "",
          r.layer,
          r.errorCode ?? "",
          meaning(r.errorCode),
          r.flaggedUndeliverable ? "yes" : "no",
          fmt(r.at),
        ]
          .map((v) => esc(String(v)))
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "campaign-delivery-failures.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-lg">
      {/* Summary tiles */}
      <div className="grid gap-base sm:grid-cols-3">
        <div className={card + " p-md"}>
          <div className="text-display-sm text-on-surface">{rows.length}</div>
          <div className="text-label-sm text-on-surface-variant">Failed touches</div>
        </div>
        <div className={card + " p-md"}>
          <div className="text-display-sm text-error">{undeliverable}</div>
          <div className="text-label-sm text-on-surface-variant">Undeliverable (bad number · 131026)</div>
        </div>
        <div className={card + " p-md"}>
          <div className="text-display-sm text-on-surface">{capped}</div>
          <div className="text-label-sm text-on-surface-variant">Frequency-capped (131049)</div>
        </div>
      </div>

      <div className="rounded-lg bg-surface-container-low border border-outline-variant px-md py-sm text-label-sm text-on-surface-variant">
        Failures appear here from the Wabis <span className="font-medium">delivery-status webhook</span> (configured in
        CRM → Settings → Re-marketing) and from our own send layer. A lead flagged{" "}
        <span className="font-medium">undeliverable</span> (131026) is dropped from all further touches until its number
        is fixed. If this list is empty right after a campaign, the delivery webhook isn&apos;t wired up in Wabis yet.
      </div>

      {/* Admin backfill — import a Wabis workflow CSV export from before the
          delivery webhook was wired, so historical failures show here. */}
      {canImport && (
        <div className={card + " p-md space-y-sm"}>
          <div className="text-label-sm font-semibold text-on-surface">Import a Wabis delivery report (backfill)</div>
          <p className="text-label-sm text-on-surface-variant">
            Upload a touch workflow&apos;s CSV export from Wabis. Rows are matched to leads by phone and replayed through
            the same handler as the live webhook — failures appear below and 131026 numbers get flagged. Safe to re-run.
          </p>
          <div className="flex flex-wrap items-center gap-base">
            <select
              className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary"
              value={importTouch}
              onChange={(e) => setImportTouch(Number(e.target.value))}
              aria-label="Which touch this report is for"
            >
              <option value={1}>Touch 1</option>
              <option value={2}>Touch 2</option>
              <option value={3}>Touch 3</option>
              <option value={4}>Touch 4</option>
            </select>
            <input
              type="file"
              accept=".csv,text/csv"
              className="text-body-sm text-on-surface-variant file:mr-base file:h-9 file:rounded-lg file:border file:border-outline-variant file:bg-surface-container-low file:px-md file:text-label-sm file:font-semibold"
              onChange={(e) => {
                setImportFile(e.target.files?.[0] ?? null);
                setImportResult(null);
                setImportError(null);
              }}
            />
            <button
              className="h-9 px-md rounded-lg text-label-sm font-semibold bg-primary text-on-primary hover:bg-primary-container disabled:opacity-60"
              disabled={importBusy || !importFile}
              onClick={runImport}
            >
              {importBusy ? "Importing…" : "Import"}
            </button>
          </div>
          {importError && (
            <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">{importError}</div>
          )}
          {importResult && (
            <div className="rounded-lg bg-surface-container-lowest border border-outline-variant px-md py-sm text-label-sm text-on-surface-variant">
              {importResult}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-base">
        <input
          className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary w-[260px]"
          placeholder="Search name, phone, or owner…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary"
          value={codeFilter}
          onChange={(e) => setCodeFilter(e.target.value)}
          aria-label="Filter by error code"
        >
          <option value="all">All error codes</option>
          {codes.map(([c, n]) => (
            <option key={c} value={c}>
              {c === "none" ? "No code" : c} ({n})
            </option>
          ))}
        </select>
        <div className="grow" />
        <button
          className="h-9 px-md rounded-lg text-label-sm font-semibold border border-outline-variant text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60"
          onClick={downloadCsv}
          disabled={filtered.length === 0}
        >
          Download CSV
        </button>
      </div>

      {/* Table */}
      <div className={card + " overflow-x-auto"}>
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-label-sm text-on-surface-variant border-b border-outline-variant">
              <th className="px-md py-sm font-medium">Lead</th>
              <th className="px-md py-sm font-medium">Phone</th>
              <th className="px-md py-sm font-medium">Touch</th>
              <th className="px-md py-sm font-medium">Why it failed</th>
              <th className="px-md py-sm font-medium">Owner</th>
              <th className="px-md py-sm font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-md py-lg text-center text-on-surface-variant">
                  No failed deliveries{q || codeFilter !== "all" ? " match this filter" : " recorded yet"}.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-outline-variant/50 last:border-0 align-top">
                <td className="px-md py-sm">
                  {r.leadId ? (
                    <Link href={`/crm/leads/${r.leadId}`} className="font-medium text-primary hover:underline">
                      {r.candidateName || "(unnamed lead)"}
                    </Link>
                  ) : (
                    <span className="text-on-surface-variant">{r.candidateName || "(no CRM lead matched)"}</span>
                  )}
                  {r.stage && <div className="text-label-sm text-on-surface-variant">{r.stage}</div>}
                </td>
                <td className="px-md py-sm font-mono">{r.phone ?? "—"}</td>
                <td className="px-md py-sm">{r.touch != null ? `Touch ${r.touch}` : "—"}</td>
                <td className="px-md py-sm">
                  <div className="flex flex-wrap items-center gap-xs">
                    {r.flaggedUndeliverable && (
                      <span className="inline-flex items-center rounded-full bg-error-container text-on-error-container px-xs text-label-sm font-semibold">
                        undeliverable
                      </span>
                    )}
                    <span className="font-medium text-on-surface">{r.errorCode ?? "—"}</span>
                    <span className="text-on-surface-variant">· {meaning(r.errorCode)}</span>
                  </div>
                  {r.errorMessage && r.errorMessage !== meaning(r.errorCode) && (
                    <div className="text-label-sm text-on-surface-variant truncate max-w-[420px]" title={r.errorMessage}>
                      {r.errorMessage}
                    </div>
                  )}
                </td>
                <td className="px-md py-sm">{r.owner ?? "—"}</td>
                <td className="px-md py-sm whitespace-nowrap text-on-surface-variant">{fmt(r.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
