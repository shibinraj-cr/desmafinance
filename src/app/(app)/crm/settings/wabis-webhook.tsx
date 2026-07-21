"use client";

/**
 * Admin card for the outbound Wabis WhatsApp automation.
 *
 * Wabis's "assign conversation to a user" action is static per workflow, so one
 * callback URL can only ever reach one agent. The card is therefore built around
 * a list of endpoints — one workflow per consultant, plus a default fallback —
 * rather than a single URL field.
 *
 * The consultant table shows the *resolved* routing (which endpoint, and the
 * exact agent name that would be sent), because a name mismatch between DesGro
 * and Wabis is the one failure this integration can't detect on its own: Wabis
 * accepts the payload and simply routes to nobody.
 */

import { useCallback, useEffect, useState } from "react";

type Endpoint = {
  id: string;
  label: string;
  consultantId: string | null;
  consultantName: string | null;
  webhookUrl: string;
  agentName: string;
  agentPhone: string;
  isActive: boolean;
  isDefault: boolean;
};
type Consultant = {
  userId: string;
  displayName: string;
  rolePhone: string | null;
  endpointId: string | null;
  endpointLabel: string | null;
  usingDefault: boolean;
  unrouted: boolean;
  sendsAgent: string;
  sendsAgentPhone: string;
};
type Delivery = {
  id: string;
  event: string;
  leadId: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  endpointLabel: string | null;
  candidateName: string | null;
  createdAt: string;
};
type Data = {
  enabled: boolean;
  secret: string;
  endpoints: Endpoint[];
  consultants: Consultant[];
  deliveries: Delivery[];
};

type Draft = {
  id?: string;
  label: string;
  consultantId: string | null;
  webhookUrl: string;
  agentName: string;
  agentPhone: string;
  isActive: boolean;
  isDefault: boolean;
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const ghost = btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low";
const input =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary";

function fmt(iso: string) {
  const d = new Date(iso);
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${M[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function shortUrl(u: string) {
  try {
    const p = new URL(u);
    const tail = p.pathname.split("/").filter(Boolean).pop() ?? "";
    return `${p.host}/…/${tail.length > 14 ? tail.slice(0, 14) + "…" : tail}`;
  } catch {
    return u.length > 40 ? u.slice(0, 40) + "…" : u;
  }
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "sent"
      ? "bg-green-100 text-green-800"
      : status === "pending"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return <span className={"px-xs py-[1px] rounded-full text-[10px] font-bold uppercase " + tone}>{status}</span>;
}

const emptyDraft: Draft = {
  label: "",
  consultantId: null,
  webhookUrl: "",
  agentName: "",
  agentPhone: "",
  isActive: true,
  isDefault: false,
};

export function WabisWebhookCard() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [secret, setSecret] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testEndpointId, setTestEndpointId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/integrations/wabis");
    if (r.ok) {
      const d = (await r.json()) as Data;
      setData(d);
      setEnabled(d.enabled);
      setSecret(d.secret);
      // Re-validate rather than just defaulting: if the selected endpoint has
      // since been deactivated it drops out of the dropdown, leaving the select
      // visually blank while a stale id still fires a real WhatsApp through the
      // retired workflow.
      const active = d.endpoints.filter((e) => e.isActive);
      setTestEndpointId((cur) => (active.some((e) => e.id === cur) ? cur : (active[0]?.id ?? "")));
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, body: Record<string, unknown>, okNote: string | null) {
    setBusy(true);
    setNote(null);
    setError(null);
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!r.ok) {
      // The server explains refusals precisely — surface that, not a generic line.
      setError((payload.message as string | undefined) ?? "That didn't work.");
      return null;
    }
    if (okNote) setNote(okNote);
    await load();
    return payload;
  }

  const saveConfig = () => call("/api/crm/integrations/wabis", { action: "save", enabled, secret }, "Saved.");

  async function saveEndpoint() {
    if (!draft) return;
    const res = await call(
      "/api/crm/integrations/wabis/endpoints",
      { action: draft.id ? "update" : "create", ...draft },
      draft.id ? "Endpoint updated." : "Endpoint added.",
    );
    if (res) setDraft(null);
  }

  async function test() {
    const res = await call(
      "/api/crm/integrations/wabis",
      { action: "test", endpointId: testEndpointId, phone: testPhone },
      null,
    );
    if (!res) return;
    setNote(
      res.ok
        ? `Test sent — Wabis replied ${res.status ?? "OK"}. Check that number for the WhatsApp message.`
        : `Test failed${res.status ? ` (HTTP ${res.status})` : ""}: ${String(res.error ?? res.body ?? "no response")}`,
    );
  }

  async function drain() {
    const res = await call("/api/crm/integrations/wabis", { action: "drain" }, null);
    if (!res) return;
    setNote(
      res.skipped ? "Nothing sent — the automation is switched off." : `Retried ${res.attempted ?? 0}, delivered ${res.sent ?? 0}.`,
    );
  }

  const endpoints = data?.endpoints ?? [];
  const consultants = data?.consultants ?? [];
  const pending = (data?.deliveries ?? []).filter((d) => d.status === "pending").length;
  const unrouted = consultants.filter((c) => c.unrouted);
  const missingPhone = consultants.filter((c) => !c.unrouted && !c.sendsAgentPhone);
  // Consultants with no endpoint of their own are candidates for one — the whole
  // point of per-consultant routing is that the fallback can't assign the chat
  // to the right person.
  const onFallback = consultants.filter((c) => c.usingDefault);

  return (
    <section className={card + " p-lg space-y-md"}>
      <div className="flex items-center justify-between gap-base">
        <div>
          <h3 className="text-h3 text-on-surface">WhatsApp automation (CRM → Wabis)</h3>
          <p className="text-label-sm text-on-surface-variant">
            When a lead is assigned, send the candidate and consultant to that consultant&apos;s Wabis workflow, which
            creates the subscriber, assigns the chat to them, and sends the intro template.
          </p>
        </div>
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 28 }}>
          forum
        </span>
      </div>

      {loading && <p className="text-body-md text-on-surface-variant">Loading…</p>}

      {data && (
        <>
          {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">{error}</div>}
          {note && <div className="rounded-lg bg-surface-container-low px-md py-sm text-body-md text-on-surface-variant">{note}</div>}

          <div className="flex flex-wrap items-center gap-lg">
            <label className="flex items-center gap-xs text-body-md">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Send the WhatsApp intro when a lead is assigned
            </label>
            <label className="flex items-center gap-xs text-label-sm text-on-surface-variant">
              Outbound secret
              <input
                className={input + " w-[220px] font-mono"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="optional X-Webhook-Secret"
              />
            </label>
            <button className={primary} disabled={busy} onClick={saveConfig}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>

          <p className="text-label-sm text-on-surface-variant">
            Reassigning a lead to a different consultant sends again, so the conversation moves to the new
            consultant&apos;s Wabis inbox. The same consultant is never introduced twice for the same lead.
          </p>

          {/* ── Endpoints ─────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between gap-base mb-xs">
              <div>
                <div className="text-label-sm text-on-surface-variant">Wabis workflows</div>
                <p className="text-label-sm text-on-surface-variant">
                  One workflow per consultant — Wabis can only assign a workflow&apos;s chats to a single agent. Mark one
                  as the default to catch anyone unmapped.
                </p>
              </div>
              <button className={primary} disabled={busy} onClick={() => setDraft({ ...emptyDraft })}>
                Add workflow
              </button>
            </div>

            {unrouted.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-900 px-md py-sm text-label-sm mb-xs">
                No workflow and no default for {unrouted.map((c) => c.displayName).join(", ")} — leads assigned to them
                will not send at all.
              </div>
            )}
            {onFallback.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-md py-sm text-label-sm mb-xs">
                Using the default workflow: {onFallback.map((c) => c.displayName).join(", ")}. Their chats will land in
                whichever agent that workflow assigns to, not their own inbox.
              </div>
            )}
            {missingPhone.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-md py-sm text-label-sm mb-xs">
                No phone number for {missingPhone.map((c) => c.displayName).join(", ")} — their intro message will show a
                blank contact number.
              </div>
            )}

            <div className="rounded-lg border border-outline-variant overflow-x-auto">
              <table className="w-full text-label-sm">
                <thead className="bg-surface-container-low text-on-surface-variant">
                  <tr className="text-left">
                    <th className="px-md py-xs">Label</th>
                    <th className="px-md py-xs">Routes for</th>
                    <th className="px-md py-xs">URL</th>
                    <th className="px-md py-xs">Agent override</th>
                    <th className="px-md py-xs">Active</th>
                    <th className="px-md py-xs text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-md py-md text-center text-on-surface-variant">
                        No workflows yet. Add one per consultant, plus a default.
                      </td>
                    </tr>
                  ) : (
                    endpoints.map((e) => (
                      <tr key={e.id} className={"border-t border-outline-variant/60 " + (e.isActive ? "" : "opacity-55")}>
                        <td className="px-md py-xs">{e.label}</td>
                        <td className="px-md py-xs">
                          {e.isDefault ? (
                            <span className="px-xs py-[1px] rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                              DEFAULT
                            </span>
                          ) : (
                            (e.consultantName ?? "—")
                          )}
                        </td>
                        <td className="px-md py-xs font-mono text-on-surface-variant" title={e.webhookUrl}>
                          {shortUrl(e.webhookUrl)}
                        </td>
                        <td className="px-md py-xs text-on-surface-variant">
                          {e.agentName || e.agentPhone ? `${e.agentName || "—"} · ${e.agentPhone || "—"}` : "—"}
                        </td>
                        <td className="px-md py-xs">
                          <button
                            type="button"
                            disabled={busy}
                            title={e.isActive ? "Deactivate" : "Activate"}
                            className="text-on-surface-variant hover:text-accent"
                            onClick={() =>
                              call(
                                "/api/crm/integrations/wabis/endpoints",
                                { action: "toggle", id: e.id, isActive: !e.isActive },
                                e.isActive ? "Deactivated." : "Activated.",
                              )
                            }
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                              {e.isActive ? "toggle_on" : "toggle_off"}
                            </span>
                          </button>
                        </td>
                        <td className="px-md py-xs text-right whitespace-nowrap">
                          <button
                            className="text-primary hover:underline font-semibold mr-md"
                            disabled={busy}
                            onClick={() =>
                              setDraft({
                                id: e.id,
                                label: e.label,
                                consultantId: e.consultantId,
                                webhookUrl: e.webhookUrl,
                                agentName: e.agentName,
                                agentPhone: e.agentPhone,
                                isActive: e.isActive,
                                isDefault: e.isDefault,
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            className="text-on-surface-variant hover:text-error disabled:opacity-40"
                            disabled={busy || e.isActive}
                            title={
                              e.isActive
                                ? "Deactivate first — deleting removes it from the delivery history"
                                : "Delete permanently"
                            }
                            onClick={() => {
                              if (
                                !confirm(
                                  `Permanently delete "${e.label}"?\n\nDeactivating is usually better — it keeps the delivery log explicable. This cannot be undone.`,
                                )
                              )
                                return;
                              void call(
                                "/api/crm/integrations/wabis/endpoints",
                                { action: "delete", id: e.id },
                                "Endpoint deleted.",
                              );
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Add / edit form ───────────────────────────────────────── */}
          {draft && (
            <div className="rounded-lg border border-primary/40 bg-surface-container-low p-md space-y-md">
              <div className="text-label-sm font-semibold text-on-surface">
                {draft.id ? "Edit workflow" : "Add workflow"}
              </div>
              <div className="grid gap-md md:grid-cols-2">
                <label className="block">
                  <span className="block text-label-sm text-on-surface-variant mb-xs">Label</span>
                  <input
                    className={input + " w-full"}
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    placeholder="e.g. Priya workflow"
                  />
                </label>
                <label className="block">
                  <span className="block text-label-sm text-on-surface-variant mb-xs">Routes for</span>
                  <select
                    className={input + " w-full"}
                    value={draft.isDefault ? "__default__" : (draft.consultantId ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft({
                        ...draft,
                        isDefault: v === "__default__",
                        consultantId: v === "__default__" || !v ? null : v,
                      });
                    }}
                  >
                    <option value="">— choose —</option>
                    <option value="__default__">Default / all unmapped consultants</option>
                    {consultants.map((c) => (
                      <option key={c.userId} value={c.userId}>
                        {c.displayName}
                      </option>
                    ))}
                    {/* The mapped consultant may no longer be an active L1/L2.
                        Without this the select renders blank while draft.consultantId
                        still holds them, and saving would look like a no-op edit. */}
                    {draft.consultantId && !consultants.some((c) => c.userId === draft.consultantId) && (
                      <option value={draft.consultantId}>
                        {endpoints.find((e) => e.id === draft.id)?.consultantName ?? draft.consultantId} (inactive)
                      </option>
                    )}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Wabis webhook callback URL</span>
                <input
                  className={input + " w-full font-mono"}
                  value={draft.webhookUrl}
                  onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })}
                  placeholder="https://bot.wabis.in/webhook/whatsapp-workflow/…"
                />
              </label>
              <div className="grid gap-md md:grid-cols-2">
                <label className="block">
                  <span className="block text-label-sm text-on-surface-variant mb-xs">
                    Agent name override (optional)
                  </span>
                  <input
                    className={input + " w-full"}
                    value={draft.agentName}
                    onChange={(e) => setDraft({ ...draft, agentName: e.target.value })}
                    placeholder="only if Wabis spells the agent differently"
                  />
                </label>
                <label className="block">
                  <span className="block text-label-sm text-on-surface-variant mb-xs">
                    Agent phone override (optional)
                  </span>
                  <input
                    className={input + " w-full font-mono"}
                    value={draft.agentPhone}
                    onChange={(e) => setDraft({ ...draft, agentPhone: e.target.value })}
                    placeholder="shown verbatim in the message"
                  />
                </label>
              </div>
              <div className="flex items-center gap-base">
                <label className="flex items-center gap-xs text-body-md">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  />
                  Active
                </label>
                <div className="flex-1" />
                <button className={ghost} disabled={busy} onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button className={primary} disabled={busy} onClick={saveEndpoint}>
                  {busy ? "Saving…" : "Save workflow"}
                </button>
              </div>
            </div>
          )}

          {/* ── Consultant routing ────────────────────────────────────── */}
          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Consultant routing</div>
            <div className="rounded-lg border border-outline-variant overflow-x-auto">
              <table className="w-full text-label-sm">
                <thead className="bg-surface-container-low text-on-surface-variant">
                  <tr className="text-left">
                    <th className="px-md py-xs">Consultant</th>
                    <th className="px-md py-xs">Goes to</th>
                    <th className="px-md py-xs">Sends as</th>
                  </tr>
                </thead>
                <tbody>
                  {consultants.map((c) => (
                    <tr key={c.userId} className="border-t border-outline-variant/60">
                      <td className="px-md py-xs whitespace-nowrap">{c.displayName}</td>
                      <td className="px-md py-xs">
                        {c.unrouted ? (
                          <span className="text-error font-semibold">nothing configured</span>
                        ) : (
                          <>
                            {c.endpointLabel}
                            {c.usingDefault && <span className="text-on-surface-variant"> (default)</span>}
                          </>
                        )}
                      </td>
                      <td className="px-md py-xs font-mono text-on-surface-variant whitespace-nowrap">
                        {c.sendsAgent || "—"}
                        {" · "}
                        {c.sendsAgentPhone || <span className="text-error">no phone</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Test ──────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-base">
            <select
              className={input + " w-[220px]"}
              value={testEndpointId}
              onChange={(e) => setTestEndpointId(e.target.value)}
            >
              {endpoints
                .filter((e) => e.isActive)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
            </select>
            <input
              className={input + " w-[190px] font-mono"}
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Test to (your mobile)"
              aria-label="Send the test WhatsApp to this number"
            />
            <button className={ghost} disabled={busy || !testEndpointId || !testPhone.trim()} onClick={test}>
              Send test
            </button>
            <span className="text-label-sm text-on-surface-variant">
              A test sends a real WhatsApp message to that number, through the chosen workflow.
            </span>
          </div>

          {pending > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-md py-sm text-label-sm flex flex-wrap items-center gap-base">
              <span className="flex-1">
                {pending} {pending === 1 ? "delivery is" : "deliveries are"} waiting to be retried. Automatic retries run
                once a day on the current hosting plan — send them now once Wabis is reachable again.
              </span>
              <button className={ghost} disabled={busy} onClick={drain}>
                Retry pending now
              </button>
            </div>
          )}

          {/* ── Delivery log ──────────────────────────────────────────── */}
          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Recent deliveries</div>
            <div className="rounded-lg border border-outline-variant overflow-x-auto">
              <table className="w-full text-label-sm">
                <thead className="bg-surface-container-low text-on-surface-variant">
                  <tr className="text-left">
                    <th className="px-md py-xs">When</th>
                    <th className="px-md py-xs">Lead</th>
                    <th className="px-md py-xs">Workflow</th>
                    <th className="px-md py-xs">Status</th>
                    <th className="px-md py-xs">Tries</th>
                    <th className="px-md py-xs">Response</th>
                    <th className="px-md py-xs" />
                  </tr>
                </thead>
                <tbody>
                  {(data.deliveries ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-md py-md text-center text-on-surface-variant">
                        Nothing sent yet. Assign a lead (or use Send test) and it appears here.
                      </td>
                    </tr>
                  ) : (
                    data.deliveries.map((d) => (
                      <tr key={d.id} className="border-t border-outline-variant/60 align-top">
                        <td className="px-md py-xs whitespace-nowrap font-mono">{fmt(d.createdAt)}</td>
                        <td className="px-md py-xs">
                          {d.event === "test" ? (
                            <span className="text-on-surface-variant">Test send</span>
                          ) : d.leadId ? (
                            <a className="text-primary hover:underline" href={`/crm/leads/${d.leadId}`}>
                              {d.candidateName || d.leadId}
                              {d.event === "lead_assigned_skipped" && (
                                <span className="text-on-surface-variant"> (skipped)</span>
                              )}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-md py-xs text-on-surface-variant">{d.endpointLabel ?? "—"}</td>
                        <td className="px-md py-xs">
                          <StatusPill status={d.status} />
                        </td>
                        <td className="px-md py-xs font-mono text-on-surface-variant">
                          {d.attempts}/{d.maxAttempts}
                        </td>
                        <td className="px-md py-xs text-on-surface-variant max-w-[300px] truncate" title={d.responseBody ?? ""}>
                          {d.responseStatus ? `HTTP ${d.responseStatus}` : ""}
                          {d.responseBody ? ` ${d.responseBody}` : d.responseStatus ? "" : "—"}
                        </td>
                        <td className="px-md py-xs text-right">
                          {d.status === "failed" && d.event === "lead_assigned" && (
                            <button
                              className="text-primary hover:underline text-label-sm font-semibold"
                              disabled={busy}
                              onClick={() =>
                                call("/api/crm/integrations/wabis", { action: "requeue", id: d.id }, "Queued for another try.")
                              }
                            >
                              Retry
                            </button>
                          )}
                        </td>
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
