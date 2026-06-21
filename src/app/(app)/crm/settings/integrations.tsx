"use client";

import { useEffect, useState } from "react";

type Source = {
  key: string;
  label: string;
  sourceCode: string;
  nameColumns: string[];
  emailColumns: string[];
  phoneColumns: string[];
  leadCount: number;
  lastSyncAt: string | null;
};
type Batch = {
  id: string;
  fileName: string | null;
  totalRows: number;
  insertedRows: number;
  duplicateRows: number;
  errorRows: number;
  createdAt: string;
};
type Data = {
  webhookUrl: string;
  secret: string | null;
  secretSet: boolean;
  envFallback: boolean;
  sources: Source[];
  appsScript: string;
  recentBatches: Batch[];
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const ghost = btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low";

function fmt(iso: string) {
  const d = new Date(iso);
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${M[d.getMonth()]} ${String(d.getFullYear()).slice(2)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function rel(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

export function IntegrationsCard() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/crm/integrations");
    if (r.ok) setData((await r.json()) as Data);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function generate(regen: boolean) {
    if (regen && !confirm("Regenerate the secret? Existing sheets stop syncing until you update CRM_WEBHOOK_SECRET in each Apps Script.")) return;
    setBusy(true);
    const r = await fetch("/api/crm/integrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "generate" }),
    });
    setBusy(false);
    if (r.ok) {
      setReveal(true);
      await load();
    }
  }
  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
  }

  return (
    <section className={card + " p-lg space-y-md"}>
      <div className="flex items-center justify-between gap-base">
        <div>
          <h3 className="text-h3 text-on-surface">Lead capture (Google Sheets → CRM)</h3>
          <p className="text-label-sm text-on-surface-variant">
            Auto-import leads from spreadsheets. Configure once here, then paste the script into each sheet.
          </p>
        </div>
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 28 }}>
          sync_alt
        </span>
      </div>

      {loading && <p className="text-body-md text-on-surface-variant">Loading…</p>}

      {data && (
        <>
          {/* Webhook URL */}
          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Webhook URL</div>
            <div className="flex items-center gap-base">
              <input readOnly value={data.webhookUrl} className="flex-1 h-9 px-md rounded-lg border border-outline-variant bg-surface-container-low text-body-md font-mono" />
              <button className={ghost} onClick={() => copy(data.webhookUrl, "url")}>
                {copied === "url" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {/* Secret */}
          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs flex items-center gap-xs">
              Webhook secret
              {data.secretSet ? (
                <span className="px-xs py-[1px] rounded-full text-[10px] font-bold bg-green-100 text-green-800">SET</span>
              ) : data.envFallback ? (
                <span className="px-xs py-[1px] rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">USING ENV VAR</span>
              ) : (
                <span className="px-xs py-[1px] rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">NOT SET</span>
              )}
            </div>
            {data.secret ? (
              <div className="flex items-center gap-base">
                <input
                  readOnly
                  value={reveal ? data.secret : "•".repeat(Math.min(28, data.secret.length))}
                  className="flex-1 h-9 px-md rounded-lg border border-outline-variant bg-surface-container-low text-body-md font-mono"
                />
                <button className={ghost} onClick={() => setReveal((v) => !v)}>{reveal ? "Hide" : "Reveal"}</button>
                <button className={ghost} onClick={() => copy(data.secret!, "secret")}>{copied === "secret" ? "Copied" : "Copy"}</button>
                <button className={ghost} disabled={busy} onClick={() => generate(true)}>Regenerate</button>
              </div>
            ) : (
              <div className="flex items-center gap-base">
                <p className="text-body-md text-on-surface-variant flex-1">
                  {data.envFallback
                    ? "An env-var secret is active. Generate one here to manage it in-app instead."
                    : "No secret yet — generate one, then paste it into each sheet's Apps Script."}
                </p>
                <button className={primary} disabled={busy} onClick={() => generate(false)}>
                  {busy ? "Generating…" : "Generate secret"}
                </button>
              </div>
            )}
          </div>

          {/* Sources */}
          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Sources &amp; column mapping</div>
            <div className="rounded-lg border border-outline-variant overflow-hidden">
              <table className="w-full text-label-sm">
                <thead className="bg-surface-container-low text-on-surface-variant">
                  <tr className="text-left">
                    <th className="px-md py-xs">CRM_SOURCE</th>
                    <th className="px-md py-xs">CRM source</th>
                    <th className="px-md py-xs">Status</th>
                    <th className="px-md py-xs">Name / Email / Phone columns</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.map((s) => (
                    <tr key={s.key} className="border-t border-outline-variant/60">
                      <td className="px-md py-xs font-mono">{s.key}</td>
                      <td className="px-md py-xs">{s.label}</td>
                      <td className="px-md py-xs whitespace-nowrap">
                        {s.leadCount > 0 || s.lastSyncAt ? (
                          <span className="inline-flex items-center gap-xs">
                            <span className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="text-on-surface font-medium">{s.leadCount.toLocaleString()} leads</span>
                            {s.lastSyncAt && <span className="text-on-surface-variant">· last sync {rel(s.lastSyncAt)}</span>}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-xs text-on-surface-variant">
                            <span className="h-2 w-2 rounded-full bg-outline" />
                            No data received yet
                          </span>
                        )}
                      </td>
                      <td className="px-md py-xs text-on-surface-variant">
                        {s.nameColumns.join(", ")} · {s.emailColumns.join(", ")} · {s.phoneColumns.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Apps Script */}
          <div>
            <div className="flex items-center gap-base mb-xs">
              <div className="text-label-sm text-on-surface-variant flex-1">
                Google Apps Script — paste into each spreadsheet (Extensions → Apps Script)
              </div>
              <button className={ghost} onClick={() => setShowScript((v) => !v)}>{showScript ? "Hide" : "Show"}</button>
              <button className={primary} onClick={() => copy(data.appsScript, "script")}>{copied === "script" ? "Copied" : "Copy script"}</button>
            </div>
            <ol className="text-label-sm text-on-surface-variant list-decimal pl-lg space-y-[2px]">
              <li>In the sheet: Extensions → Apps Script → paste the script → Save.</li>
              <li>Project Settings → Script properties: <span className="font-mono">CRM_WEBHOOK_URL</span>, <span className="font-mono">CRM_WEBHOOK_SECRET</span>, <span className="font-mono">CRM_SOURCE</span> (meta or website).</li>
              <li>Run <span className="font-mono">initBaseline</span> once → add an every-minute <span className="font-mono">syncNewLeads</span> trigger.</li>
            </ol>
            {showScript && (
              <pre className="mt-xs max-h-[320px] overflow-auto rounded-lg border border-outline-variant bg-surface-container-low p-md text-[11px] leading-snug font-mono whitespace-pre">
                {data.appsScript}
              </pre>
            )}
          </div>

          {/* Recent syncs */}
          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Recent syncs</div>
            <div className="rounded-lg border border-outline-variant overflow-hidden">
              <table className="w-full text-label-sm">
                <thead className="bg-surface-container-low text-on-surface-variant">
                  <tr className="text-left">
                    <th className="px-md py-xs">When</th>
                    <th className="px-md py-xs">Source / campaign</th>
                    <th className="px-md py-xs text-right">New</th>
                    <th className="px-md py-xs text-right">Dupes</th>
                    <th className="px-md py-xs text-right">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentBatches.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-md py-md text-center text-on-surface-variant">
                        No syncs yet. Once the script runs, imports appear here.
                      </td>
                    </tr>
                  ) : (
                    data.recentBatches.map((b) => (
                      <tr key={b.id} className="border-t border-outline-variant/60">
                        <td className="px-md py-xs whitespace-nowrap font-mono">{fmt(b.createdAt)}</td>
                        <td className="px-md py-xs">{b.fileName ?? "—"}</td>
                        <td className="px-md py-xs text-right font-mono">{b.insertedRows}</td>
                        <td className="px-md py-xs text-right font-mono text-on-surface-variant">{b.duplicateRows}</td>
                        <td className={"px-md py-xs text-right font-mono " + (b.errorRows ? "text-error" : "text-on-surface-variant")}>{b.errorRows}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
