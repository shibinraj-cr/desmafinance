"use client";

import { useCallback, useEffect, useState } from "react";

type TemplateOpt = { name: string; language: string; category: string | null; status: string };
type Opt = { id: string; label?: string; name?: string };
type MergeField = { token: string; label: string };

type BroadcastRow = {
  id: string;
  name: string;
  templateName: string;
  status: string;
  scheduledAt: string | null;
  completedAt: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  createdByName: string | null;
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-surface-container text-on-surface-variant",
  scheduled: "bg-amber-500/15 text-amber-600",
  sending: "bg-primary/15 text-primary",
  sent: "bg-emerald-500/15 text-emerald-600",
  cancelled: "bg-surface-container text-on-surface-variant",
  failed: "bg-error/15 text-error",
};

export function BroadcastsClient({
  providerLabel,
  canBroadcast,
  broadcastEnabled,
  batchSize,
  templates,
  mergeFields,
  statuses,
  services,
  sources,
}: {
  providerLabel: string;
  canBroadcast: boolean;
  broadcastEnabled: boolean;
  batchSize: number;
  templates: TemplateOpt[];
  mergeFields: MergeField[];
  statuses: Opt[];
  services: Opt[];
  sources: Opt[];
}) {
  const [rows, setRows] = useState<BroadcastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/crm/wa/broadcasts").catch(() => null);
    setLoading(false);
    if (!res?.ok) return;
    const d = (await res.json()) as { broadcasts: BroadcastRow[] };
    setRows(d.broadcasts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-lg">
      {!canBroadcast && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md text-body-md text-on-surface-variant">
          <span className="font-semibold text-on-surface">Broadcasts need the WhatsApp Cloud API.</span>{" "}
          {providerLabel} addresses each template by workflow URL rather than by name, so it cannot send a campaign to a
          segment. Existing campaigns are shown; new ones can be created once the number is on the Cloud API.
        </div>
      )}
      {canBroadcast && !broadcastEnabled && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md text-body-md text-on-surface-variant">
          <span className="font-semibold text-on-surface">Sending is paused.</span> Campaigns can be built and queued,
          but nothing goes out until <code className="font-mono text-label-sm">wa_broadcast_enabled</code> is switched on
          in CRM → Settings.
        </div>
      )}

      <div className="flex items-center justify-between gap-base">
        <p className="text-label-sm text-on-surface-variant">
          {batchSize} messages per run · a campaign of a few thousand takes several runs on the current plan
        </p>
        {canBroadcast && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="h-9 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold"
          >
            New campaign
          </button>
        )}
      </div>

      {creating && (
        <CreateForm
          templates={templates}
          mergeFields={mergeFields}
          statuses={statuses}
          services={services}
          sources={sources}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
        <div className="overflow-auto scrollbar-thin">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-on-surface-variant">
              <tr>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Campaign</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Template</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Status</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Audience</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Sent</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Failed</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Skipped</th>
                <th className="px-md py-sm"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-md py-lg text-center text-on-surface-variant">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-md py-lg text-center text-on-surface-variant">
                    No campaigns yet.
                  </td>
                </tr>
              )}
              {rows.map((b) => (
                <BroadcastRowView key={b.id} row={b} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BroadcastRowView({ row, onChanged }: { row: BroadcastRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "queue" | "cancel" | "send_now") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/wa/broadcasts/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const d = res ? ((await res.json().catch(() => null)) as { message?: string } | null) : null;
      setError(d?.message ?? "That didn’t work.");
      return;
    }
    onChanged();
  }

  const remaining = row.totalRecipients - row.sentCount - row.failedCount;

  return (
    <tr className="border-t border-outline-variant">
      <td className="px-md py-sm">
        <span className="font-semibold text-on-surface">{row.name}</span>
        {row.createdByName && <span className="block text-label-sm text-on-surface-variant">{row.createdByName}</span>}
        {error && <span className="block text-label-sm text-error">{error}</span>}
      </td>
      <td className="px-md py-sm font-mono text-label-sm text-on-surface-variant">{row.templateName}</td>
      <td className="px-md py-sm">
        <span
          className={
            "px-sm h-6 inline-flex items-center rounded-full text-label-sm font-semibold " +
            (STATUS_TONE[row.status] ?? STATUS_TONE.draft)
          }
        >
          {row.status}
        </span>
      </td>
      <td className="px-md py-sm text-right tabular-nums">{row.totalRecipients}</td>
      <td className="px-md py-sm text-right tabular-nums text-emerald-600">{row.sentCount}</td>
      <td className="px-md py-sm text-right tabular-nums text-error">{row.failedCount || ""}</td>
      <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{row.skippedCount || ""}</td>
      <td className="px-md py-sm text-right whitespace-nowrap">
        {row.status === "draft" && (
          <ActionBtn busy={busy} onClick={() => void act("queue")}>
            Queue
          </ActionBtn>
        )}
        {(row.status === "scheduled" || row.status === "sending") && (
          <>
            <ActionBtn busy={busy} onClick={() => void act("send_now")}>
              {remaining > 0 ? `Send next ${Math.min(remaining, 100)}` : "Send now"}
            </ActionBtn>
            <ActionBtn busy={busy} danger onClick={() => void act("cancel")}>
              Cancel
            </ActionBtn>
          </>
        )}
      </td>
    </tr>
  );
}

function ActionBtn({
  busy,
  danger,
  onClick,
  children,
}: {
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={
        "h-8 px-md ml-xs rounded-lg border text-label-sm font-semibold disabled:opacity-40 " +
        (danger
          ? "border-error/40 text-error hover:bg-error/10"
          : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
      }
    >
      {children}
    </button>
  );
}

/**
 * Build a campaign: pick the audience with the CRM's own lead filters, pick an
 * approved template, map its numbered variables to merge tokens, then preview
 * the count before anything is frozen.
 */
function CreateForm({
  templates,
  mergeFields,
  statuses,
  services,
  sources,
  onClose,
  onCreated,
}: {
  templates: TemplateOpt[];
  mergeFields: MergeField[];
  statuses: Opt[];
  services: Opt[];
  sources: Opt[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");
  const [source, setSource] = useState("");
  const [variableMap, setVariableMap] = useState<Record<string, string>>({});
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approved = templates.filter((t) => t.status === "APPROVED");
  const segment: Record<string, string> = {};
  if (status) segment.status = status;
  if (service) segment.service = service;
  if (source) segment.source = source;

  async function create(queue: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/crm/wa/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, templateName, segment, variableMap, queue }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const d = res ? ((await res.json().catch(() => null)) as { message?: string } | null) : null;
      setError(d?.message ?? "The campaign could not be created.");
      return;
    }
    const d = (await res.json()) as { estimate?: number };
    if (!queue && typeof d.estimate === "number") setEstimate(d.estimate);
    onCreated();
  }

  const inputCls =
    "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none";

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <h3 className="text-h3 text-on-surface">New campaign</h3>
      {error && <p className="text-label-sm text-error">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-base">
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Campaign name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls + " w-full"} />
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Approved template</span>
          <select value={templateName} onChange={(e) => setTemplateName(e.target.value)} className={inputCls + " w-full"}>
            <option value="">Choose…</option>
            {approved.map((t) => (
              <option key={`${t.name}:${t.language}`} value={`${t.name}:${t.language}`}>
                {t.name} ({t.language}){t.category ? ` · ${t.category}` : ""}
              </option>
            ))}
          </select>
          {approved.length === 0 && (
            <span className="block text-label-sm text-on-surface-variant mt-xs">
              No approved templates found in the WhatsApp Business Account.
            </span>
          )}
        </label>
      </div>

      <div>
        <span className="block text-label-sm text-on-surface-variant mb-xs">Audience</span>
        <div className="flex flex-wrap gap-base">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            <option value="">Any stage</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={service} onChange={(e) => setService(e.target.value)} className={inputCls}>
            <option value="">Any service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
            <option value="">Any source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-label-sm text-on-surface-variant mt-xs">
          Opted-out and undeliverable numbers are excluded automatically and reported as skipped.
        </p>
      </div>

      <div>
        <span className="block text-label-sm text-on-surface-variant mb-xs">
          Template variables — Meta numbers them {"{{1}}"}, {"{{2}}"}, …
        </span>
        <div className="flex flex-wrap gap-base">
          {["1", "2", "3"].map((slot) => (
            <label key={slot} className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">{`{{${slot}}}`}</span>
              <select
                value={variableMap[slot] ?? ""}
                onChange={(e) => setVariableMap((m) => ({ ...m, [slot]: e.target.value }))}
                className={inputCls}
              >
                <option value="">—</option>
                {mergeFields.map((f) => (
                  <option key={f.token} value={f.token}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      {estimate !== null && (
        <p className="text-body-md text-on-surface">
          This audience currently matches <span className="font-semibold tabular-nums">{estimate}</span> leads.
        </p>
      )}

      <div className="flex items-center gap-base">
        <button
          type="button"
          disabled={busy || !name.trim() || !templateName}
          onClick={() => void create(false)}
          className="h-9 px-lg rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant disabled:opacity-40"
        >
          Save draft &amp; preview count
        </button>
        <button
          type="button"
          disabled={busy || !name.trim() || !templateName}
          onClick={() => void create(true)}
          className="h-9 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-40"
        >
          Queue campaign
        </button>
        <button type="button" onClick={onClose} className="h-9 px-md text-label-sm text-on-surface-variant">
          Cancel
        </button>
      </div>
      <p className="text-label-sm text-on-surface-variant">
        Queuing freezes the audience into a fixed recipient list, so the campaign can be reported on and resumed even if
        leads change afterwards.
      </p>
    </div>
  );
}
