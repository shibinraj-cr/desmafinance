"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MultiSelect } from "@/components/MultiSelect";
import { listParam } from "@/lib/filter-params";

type TemplateOpt = {
  name: string;
  language: string;
  category: string | null;
  status: string;
  /** 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null — a media header needs a URL. */
  headerFormat?: string | null;
};
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
  status: string[];
  service: string[];
  source: string[];
  variableMap: Record<string, string>;
  engagedWithinDays: string;
  headerMediaType: "image" | "video" | "document" | null;
  headerMediaUrl: string;
};

/** Human meaning for the Meta/WhatsApp error codes broadcasts hit in practice. */
const ERROR_MEANING: Record<string, string> = {
  "131026": "Undeliverable — not on WhatsApp / bad number",
  "131049": "Frequency-capped — Meta cold-marketing limit",
  "131047": "Re-engagement outside the 24h window",
  "131048": "Spam rate limit hit on this number",
  "130472": "In a Meta experiment group — not delivered",
  "131056": "Pair rate limit — too many to this recipient",
  "132000": "Template params don't match the template",
  "132001": "Template not found / not approved",
  "133010": "Number not registered on the WABA",
};
function errMeaning(code: string | null): string {
  if (!code) return "No code reported";
  return ERROR_MEANING[code] ?? `Error ${code}`;
}

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
  coldStageIds,
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
  coldStageIds: string[];
  services: Opt[];
  sources: Opt[];
}) {
  const [rows, setRows] = useState<BroadcastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; initial: FormInitial } | null>(null);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);

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
        headerMediaType: string | null;
        headerMediaUrl: string | null;
      };
    };
    const seg = (d.broadcast.segment ?? {}) as Record<string, unknown>;
    const engaged = Number(seg.engagedWithinDays);
    setCreating(false);
    setViewing(null);
    setEditing({
      id,
      initial: {
        name: d.broadcast.name,
        templateName: d.broadcast.templateName,
        // listParam reads both shapes: the scalars saved before filters went
        // multi-value, and the arrays saved since.
        status: listParam(seg.status as string | string[] | undefined),
        service: listParam(seg.service as string | string[] | undefined),
        source: listParam(seg.source as string | string[] | undefined),
        variableMap: d.broadcast.variableMap ?? {},
        engagedWithinDays: Number.isFinite(engaged) && engaged > 0 ? String(engaged) : "",
        // Round-trip the persisted kind, not just the URL: it is the fallback
        // that lets an edit preserve the stored media when the template is
        // momentarily unresolvable (paused at Meta / a transient catalogue read).
        headerMediaType:
          d.broadcast.headerMediaType === "image" ||
          d.broadcast.headerMediaType === "video" ||
          d.broadcast.headerMediaType === "document"
            ? d.broadcast.headerMediaType
            : null,
        headerMediaUrl: d.broadcast.headerMediaUrl ?? "",
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
              setViewing(null);
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
          coldStageIds={coldStageIds}
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

      {viewing && (
        <FailurePanel
          key={`view:${viewing.id}`}
          broadcastId={viewing.id}
          name={viewing.name}
          onClose={() => setViewing(null)}
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
                <BroadcastRowView
                  key={b.id}
                  row={b}
                  onChanged={load}
                  onEdit={() => void openEdit(b.id)}
                  onViewFailures={() => {
                    setCreating(false);
                    setEditing(null);
                    setViewing({ id: b.id, name: b.name });
                  }}
                />
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
  onViewFailures,
}: {
  row: BroadcastRow;
  onChanged: () => void;
  onEdit: () => void;
  onViewFailures: () => void;
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
        {row.failedCount > 0 && (
          <ActionBtn busy={busy} onClick={onViewFailures}>
            Failures
          </ActionBtn>
        )}
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
  coldStageIds,
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
  coldStageIds: string[];
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
  const [status, setStatus] = useState<string[]>(initial?.status ?? []);
  const [service, setService] = useState<string[]>(initial?.service ?? []);
  const [source, setSource] = useState<string[]>(initial?.source ?? []);
  const [engagedDays, setEngagedDays] = useState<string>(initial?.engagedWithinDays ?? "");
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string>(initial?.headerMediaUrl ?? "");
  const [variableMap, setVariableMap] = useState<Record<string, string>>(initial?.variableMap ?? {});
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const approved = templates.filter((t) => t.status === "APPROVED");
  // Stored as JSON and read back as LeadFilterParams, which takes one value or
  // several per key — so a segment can be "Study Abroad OR Nursing".
  const segment: Record<string, unknown> = {};
  if (status.length) segment.status = status;
  if (service.length) segment.service = service;
  if (source.length) segment.source = source;
  // Only leads who messaged us within N days — the deliverability lever.
  if (engagedDays) segment.engagedWithinDays = Number(engagedDays);

  // Warn before queuing a Marketing template at a cold audience (re-marketing /
  // lost stages), which mostly fails (131049/131026) and hurts the number's
  // quality rating. Not blocking — just honest.
  const selectedTemplate = approved.find((t) => `${t.name}:${t.language}` === templateName) ?? null;
  const isMarketing = (selectedTemplate?.category ?? "").toUpperCase() === "MARKETING";
  const hasColdStage = status.some((id) => coldStageIds.includes(id));
  const showColdWarning = isMarketing && hasColdStage && !engagedDays;

  // A media-header template needs its header media (image/video/document) on every
  // send — the type is dictated by the template, the URL supplied here.
  const headerFormat = (selectedTemplate?.headerFormat ?? "").toUpperCase();
  const templateHeaderKind =
    headerFormat === "IMAGE" || headerFormat === "VIDEO" || headerFormat === "DOCUMENT"
      ? (headerFormat.toLowerCase() as "image" | "video" | "document")
      : null;
  // When the template resolves, TRUST it (null = a text/header-less template, so
  // a stale URL is correctly dropped). When it does NOT resolve — paused at Meta,
  // dropped from the approved list, or a transient catalogue read — fall back to
  // the kind persisted on the draft, so an ordinary edit does not silently wipe
  // the stored media and reintroduce 132012.
  const headerKind = selectedTemplate ? templateHeaderKind : (initial?.headerMediaType ?? null);
  const headerMissing = !!headerKind && !headerMediaUrl.trim();

  async function save(queue: boolean) {
    setBusy(true);
    setError(null);
    setNote(null);
    // Header media only when the template actually has a media header; cleared
    // (null) otherwise so switching to a text template drops a stale URL.
    const headerMediaType = headerKind;
    const headerMediaUrlValue = headerKind ? headerMediaUrl.trim() || null : null;
    try {
      // First save of a brand-new campaign: POST exactly once. Everything after
      // binds to the returned id and takes the update path below.
      if (!effectiveId) {
        const res = await fetch("/api/crm/wa/broadcasts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            templateName,
            segment,
            variableMap,
            headerMediaType,
            headerMediaUrl: headerMediaUrlValue,
            queue,
          }),
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
        body: JSON.stringify({
          action: "update",
          name,
          templateName,
          segment,
          variableMap,
          headerMediaType,
          headerMediaUrl: headerMediaUrlValue,
        }),
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
          <select
            value={templateName}
            onChange={(e) => {
              setTemplateName(e.target.value);
              // The header media belongs to the template that was chosen — drop a
              // carried-over URL so a switch (e.g. image-header → video-header)
              // can't persist a link of the wrong kind. Edit pre-fill sets both
              // directly, so the stored URL survives opening the form.
              setHeaderMediaUrl("");
            }}
            className={inputCls + " w-full"}
          >
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

      {headerKind && (
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">
            Header {headerKind} URL <span className="text-error">*</span>
          </span>
          <input
            value={headerMediaUrl}
            onChange={(e) => setHeaderMediaUrl(e.target.value)}
            placeholder={`https://… public ${headerKind} link`}
            className={inputCls + " w-full font-mono"}
          />
          <span className="block text-label-sm text-on-surface-variant mt-xs">
            This template has a {headerKind} header — Meta needs the media on every send. Paste a public{" "}
            <span className="font-mono">https</span> URL (same {headerKind} for everyone). Without it, sends fail with
            error 132012.
          </span>
        </label>
      )}

      <div>
        <span className="block text-label-sm text-on-surface-variant mb-xs">Audience</span>
        <div className="flex flex-wrap gap-base">
          <MultiSelect
            placeholder="Any stage"
            options={statuses.map((s) => ({ value: s.id, label: s.label ?? s.name ?? s.id }))}
            selected={status}
            onChange={setStatus}
          />
          <MultiSelect
            placeholder="Any service"
            options={services.map((s) => ({ value: s.id, label: s.name ?? s.label ?? s.id }))}
            selected={service}
            onChange={setService}
          />
          <MultiSelect
            placeholder="Any source"
            options={sources.map((s) => ({ value: s.id, label: s.label ?? s.name ?? s.id }))}
            selected={source}
            onChange={setSource}
          />
          <select
            value={engagedDays}
            onChange={(e) => setEngagedDays(e.target.value)}
            className={inputCls}
            aria-label="Only leads who replied recently"
          >
            <option value="">Anyone who matches</option>
            <option value="7">Replied in last 7 days</option>
            <option value="30">Replied in last 30 days</option>
            <option value="90">Replied in last 90 days</option>
          </select>
        </div>
        <p className="text-label-sm text-on-surface-variant mt-xs">
          Opted-out and undeliverable numbers are excluded automatically and reported as skipped.{" "}
          <span className="font-medium">Replied in last N days</span> restricts the send to leads who messaged you — the
          audience a marketing template actually reaches.
        </p>
        {showColdWarning && (
          <div className="mt-sm rounded-lg border border-amber-500/40 bg-amber-500/10 px-md py-sm text-label-sm text-amber-700">
            <span className="font-semibold">Heads-up:</span> this is a Marketing template to a cold stage (re-marketing /
            lost). Meta throttles marketing to never-engaged numbers, so most will fail (131049 / 131026) and a high
            failure rate lowers your number&apos;s quality rating. Use a warmer stage, a <span className="font-medium">Utility</span>{" "}
            template, or set <span className="font-medium">“Replied in last N days.”</span>
          </div>
        )}
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
          disabled={busy || !name.trim() || !templateName || headerMissing}
          onClick={() => void save(false)}
          className="h-9 px-lg rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant disabled:opacity-40"
        >
          {startedInEdit ? "Save changes & preview count" : "Save draft & preview count"}
        </button>
        <button
          type="button"
          disabled={busy || !name.trim() || !templateName || headerMissing}
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

type RecipientRow = {
  id: string;
  phoneE164: string;
  status: string;
  skipReason: string | null;
  waErrorCode: string | null;
  waErrorMessage: string | null;
  lead: { id: string; candidateName: string | null } | null;
};

/**
 * Why a broadcast's recipients failed — the panel the list never had. Fetches the
 * campaign detail (failures first) and shows a by-error-code breakdown plus the
 * individual bounces, so "107 failed" stops being a mystery.
 */
function FailurePanel({ broadcastId, name, onClose }: { broadcastId: string; name: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [counts, setCounts] = useState<{ failedCount: number; skippedCount: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      const res = await fetch(`/api/crm/wa/broadcasts/${broadcastId}`).catch(() => null);
      if (!alive) return;
      setLoading(false);
      if (!res?.ok) return;
      const d = (await res.json()) as {
        broadcast: { failedCount: number; skippedCount: number };
        recipients: RecipientRow[];
      };
      setCounts({ failedCount: d.broadcast.failedCount, skippedCount: d.broadcast.skippedCount });
      setRecipients(d.recipients);
    })();
    return () => {
      alive = false;
    };
  }, [broadcastId]);

  const failed = useMemo(() => recipients.filter((r) => r.status === "failed"), [recipients]);
  const byCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of failed) {
      const k = r.waErrorCode ?? "none";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [failed]);

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <div className="flex items-center justify-between gap-base">
        <h3 className="text-h3 text-on-surface">Failures — {name}</h3>
        <button type="button" onClick={onClose} className="h-9 px-md text-label-sm text-on-surface-variant">
          Close
        </button>
      </div>

      {loading ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : (
        <>
          <p className="text-label-sm text-on-surface-variant">
            {counts?.failedCount ?? failed.length} failed · {counts?.skippedCount ?? 0} skipped. A hard failure (131026)
            flags the number so later sends skip it; 131049 is Meta&apos;s cold-marketing cap.
          </p>

          <div className="flex flex-wrap gap-base">
            {byCode.map(([code, n]) => (
              <span
                key={code}
                className="inline-flex items-center rounded-lg border border-outline-variant bg-surface-container-low px-md py-xs text-label-sm text-on-surface-variant"
              >
                <span className="font-semibold text-on-surface">{code === "none" ? "No code" : code}</span>
                <span className="ml-xs">· {n} · {errMeaning(code === "none" ? null : code)}</span>
              </span>
            ))}
          </div>

          <div className="rounded-xl border border-outline-variant overflow-hidden">
            <div className="overflow-auto scrollbar-thin max-h-[420px]">
              <table className="w-full text-body-sm">
                <thead className="bg-surface-container-low text-on-surface-variant sticky top-0">
                  <tr>
                    <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Lead</th>
                    <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Phone</th>
                    <th className="px-md py-sm text-label-sm uppercase tracking-wider text-left">Why it failed</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-md py-lg text-center text-on-surface-variant">
                        No failed recipients in this campaign.
                      </td>
                    </tr>
                  )}
                  {failed.map((r) => (
                    <tr key={r.id} className="border-t border-outline-variant align-top">
                      <td className="px-md py-sm">{r.lead?.candidateName || "(unnamed)"}</td>
                      <td className="px-md py-sm font-mono">{r.phoneE164}</td>
                      <td className="px-md py-sm">
                        <span className="font-medium text-on-surface">{r.waErrorCode ?? "—"}</span>
                        <span className="text-on-surface-variant"> · {errMeaning(r.waErrorCode)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {recipients.length >= 200 && (
            <p className="text-label-sm text-on-surface-variant">Showing the first 200 recipients (failures first).</p>
          )}
        </>
      )}
    </div>
  );
}
