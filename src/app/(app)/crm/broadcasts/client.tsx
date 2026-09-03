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

/** Pre-fill values for the form — empty for a new campaign, a draft's own for edit. */
type FormInitial = {
  name: string;
  templateName: string;
  status: string;
  service: string;
  source: string;
  variableMap: Record<string, string>;
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
  const [editing, setEditing] = useState<{ id: string; initial: FormInitial } | null>(null);

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

  // Open the edit form for a draft — fetch its full segment/variableMap first,
  // since the list row doesn't carry them.
  const openEdit = useCallback(async (id: string) => {
    const res = await fetch(`/api/crm/wa/broadcasts/${id}`).catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as {
      broadcast: {
        name: string;
        templateName: string;
        segment: Record<string, unknown> | null;
        variableMap: Record<string, string> | null;
      };
    };
    const seg = (d.broadcast.segment ?? {}) as Record<string, unknown>;
    setCreating(false);
    setEditing({
      id,
      initial: {
        name: d.broadcast.name,
        templateName: d.broadcast.templateName,
        status: typeof seg.status === "string" ? seg.status : "",
        service: typeof seg.service === "string" ? seg.service : "",
        source: typeof seg.source === "string" ? seg.source : "",
        variableMap: d.broadcast.variableMap ?? {},
      },
    });
  }, []);

  const showForm = creating || !!editing;

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
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
            className="h-9 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold"
          >
            New campaign
          </button>
        )}
      </div>

      {showForm && (
        <BroadcastForm
          key={editing ? `edit:${editing.id}` : "new"}
          templates={templates}
          mergeFields={mergeFields}
          statuses={statuses}
          services={services}
          sources={sources}
          broadcastId={editing?.id}
          initial={editing?.initial}
          onReload={load}
          onClose={() => {
            setCreating(false);
            setEditing(null);
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
                <BroadcastRowView key={b.id} row={b} onChanged={load} onEdit={() => void openEdit(b.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BroadcastRowView({
  row,
  onChanged,
  onEdit,
}: {
  row: BroadcastRow;
  onChanged: () => void;
  onEdit: () => void;
}) {
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

  async function remove() {
    if (typeof window !== "undefined" && !window.confirm(`Delete campaign “${row.name}”? This can’t be undone.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/wa/broadcasts/${row.id}`, { method: "DELETE" }).catch(() => null);
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
      <td className="px-md py-sm text-right tabular-nums">
        {row.totalRecipients}
        {row.status === "draft" && <span className="text-on-surface-variant"> est.</span>}
      </td>
      <td className="px-md py-sm text-right tabular-nums text-emerald-600">{row.sentCount}</td>
      <td className="px-md py-sm text-right tabular-nums text-error">{row.failedCount || ""}</td>
      <td className="px-md py-sm text-right tabular-nums text-on-surface-variant">{row.skippedCount || ""}</td>
      <td className="px-md py-sm text-right whitespace-nowrap">
        {row.status === "draft" && (
          <>
            <ActionBtn busy={busy} onClick={onEdit}>
              Edit
            </ActionBtn>
            <ActionBtn busy={busy} onClick={() => void act("queue")}>
              Queue
            </ActionBtn>
            <ActionBtn busy={busy} danger onClick={() => void remove()}>
              Delete
            </ActionBtn>
          </>
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
        {row.status === "cancelled" && (
          <ActionBtn busy={busy} danger onClick={() => void remove()}>
            Delete
          </ActionBtn>
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
 * Build or edit a campaign: pick the audience with the CRM's own lead filters,
 * pick an approved template, map its numbered variables to merge tokens, and see
 * the live audience count. "Save draft" keeps this form open and refreshes the
 * count; "Queue" freezes the audience and starts the send.
 */
function BroadcastForm({
  templates,
  mergeFields,
  statuses,
  services,
  sources,
  broadcastId,
  initial,
  onReload,
  onClose,
}: {
  templates: TemplateOpt[];
  mergeFields: MergeField[];
  statuses: Opt[];
  services: Opt[];
  sources: Opt[];
  broadcastId?: string;
  initial?: FormInitial;
  onReload: () => void;
  onClose: () => void;
}) {
  // `startedInEdit` fixes the heading/labels for the session; `effectiveId` is the
  // campaign the form is bound to — the prop when editing, else the id of the draft
  // this form created on its first save. Once set, later saves UPDATE that draft
  // instead of POSTing another one (the create form now stays open).
  const startedInEdit = !!broadcastId;
  const [createdId, setCreatedId] = useState<string | null>(null);
  const effectiveId = broadcastId ?? createdId;
  const [name, setName] = useState(initial?.name ?? "");
  const [templateName, setTemplateName] = useState(initial?.templateName ?? "");
  const [status, setStatus] = useState(initial?.status ?? "");
  const [service, setService] = useState(initial?.service ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [variableMap, setVariableMap] = useState<Record<string, string>>(initial?.variableMap ?? {});
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const approved = templates.filter((t) => t.status === "APPROVED");
  const segment: Record<string, string> = {};
  if (status) segment.status = status;
  if (service) segment.service = service;
  if (source) segment.source = source;

  async function save(queue: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      // First save of a brand-new campaign: POST exactly once. Everything after
      // binds to the returned id and takes the update path below.
      if (!effectiveId) {
        const res = await fetch("/api/crm/wa/broadcasts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, templateName, segment, variableMap, queue }),
        }).catch(() => null);
        const d = res ? ((await res.json().catch(() => ({}))) as { id?: string; estimate?: number; message?: string }) : {};
        if (!res?.ok) {
          setError(d.message ?? "The campaign could not be saved.");
          return;
        }
        onReload();
        if (queue) {
          onClose();
          return;
        }
        // Bind the still-open form to the draft it just created, so the next
        // Save/Queue updates it rather than creating a second one.
        if (d.id) setCreatedId(d.id);
        if (typeof d.estimate === "number") setEstimate(d.estimate);
        setNote("Draft saved.");
        return;
      }

      // Update the existing (or just-created) draft, then optionally queue it.
      const res = await fetch(`/api/crm/wa/broadcasts/${effectiveId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", name, templateName, segment, variableMap }),
      }).catch(() => null);
      const d = res ? ((await res.json().catch(() => ({}))) as { estimate?: number; message?: string }) : {};
      if (!res?.ok) {
        setError(d.message ?? "The changes could not be saved.");
        return;
      }
      if (typeof d.estimate === "number") setEstimate(d.estimate);
      onReload();
      if (queue) {
        const q = await fetch(`/api/crm/wa/broadcasts/${effectiveId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "queue" }),
        }).catch(() => null);
        if (!q?.ok) {
          const qd = q ? ((await q.json().catch(() => ({}))) as { message?: string }) : {};
          setError(qd.message ?? "Saved, but queuing failed.");
          onReload();
          return;
        }
        onReload();
        onClose();
        return;
      }
      setNote(startedInEdit ? "Changes saved." : "Draft saved.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none";

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <h3 className="text-h3 text-on-surface">{startedInEdit ? "Edit campaign" : "New campaign"}</h3>
      {error && <p className="text-label-sm text-error">{error}</p>}
      {note && <p className="text-label-sm text-emerald-600">{note}</p>}

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
          This audience currently matches <span className="font-semibold tabular-nums">{estimate}</span> leads (before
          opted-out / undeliverable / no-phone are skipped at queue time).
        </p>
      )}

      <div className="flex items-center gap-base">
        <button
          type="button"
          disabled={busy || !name.trim() || !templateName}
          onClick={() => void save(false)}
          className="h-9 px-lg rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant disabled:opacity-40"
        >
          {startedInEdit ? "Save changes & preview count" : "Save draft & preview count"}
        </button>
        <button
          type="button"
          disabled={busy || !name.trim() || !templateName}
          onClick={() => void save(true)}
          className="h-9 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-40"
        >
          Queue campaign
        </button>
        <button type="button" onClick={onClose} className="h-9 px-md text-label-sm text-on-surface-variant">
          Close
        </button>
      </div>
      <p className="text-label-sm text-on-surface-variant">
        Queuing freezes the audience into a fixed recipient list, so the campaign can be reported on and resumed even if
        leads change afterwards.
      </p>
    </div>
  );
}
