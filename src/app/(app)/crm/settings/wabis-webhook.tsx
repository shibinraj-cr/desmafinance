"use client";

/**
 * Admin card for the outbound Wabis WhatsApp automation: enable it, point it at
 * a Wabis Webhook Workflow, correct any consultant whose Wabis agent is spelled
 * differently, send a test, and read the delivery log.
 *
 * The consultant table deliberately shows the *resolved* values — what would
 * actually be sent — because a name mismatch between DesGro and Wabis is the
 * one failure this integration can't detect on its own: Wabis accepts the
 * payload and simply routes to nobody.
 */

import { useCallback, useEffect, useState } from "react";

type Consultant = {
  userId: string;
  displayName: string;
  rolePhone: string | null;
  overrideAgent: string;
  overridePhone: string;
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
  candidateName: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
};
type Data = {
  enabled: boolean;
  url: string;
  secret: string;
  refireOnReassign: boolean;
  consultants: Consultant[];
  deliveries: Delivery[];
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const ghost = btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low";
const input =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary";
const smInput = "h-8 px-sm w-full rounded border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary text-label-sm";

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${M[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

export function WabisWebhookCard() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Draft state — the card is a form, so edits are local until Save.
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [refire, setRefire] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, { agent: string; phone: string }>>({});
  // A test drives Wabis all the way to a real WhatsApp send, so the admin says
  // where it goes — usually their own phone.
  const [testPhone, setTestPhone] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/integrations/wabis");
    if (r.ok) {
      const d = (await r.json()) as Data;
      setData(d);
      setEnabled(d.enabled);
      setUrl(d.url);
      setSecret(d.secret);
      setRefire(d.refireOnReassign);
      setOverrides(
        Object.fromEntries(d.consultants.map((c) => [c.userId, { agent: c.overrideAgent, phone: c.overridePhone }])),
      );
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okNote: string) {
    setBusy(true);
    setNote(null);
    setError(null);
    const r = await fetch("/api/crm/integrations/wabis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!r.ok) {
      setError(
        payload.error === "url_required"
          ? "Add the Wabis webhook URL before enabling."
          : payload.error === "invalid_url"
            ? "The webhook URL must be an https:// address."
            : // The server explains a refused retry precisely; pass it through.
              (payload.message as string | undefined) ?? "Failed to save.",
      );
      return null;
    }
    setNote(okNote);
    await load();
    return payload;
  }

  async function save() {
    await post({ action: "save", enabled, url, secret, refireOnReassign: refire, overrides }, "Saved.");
  }

  async function test() {
    const res = await post({ action: "test", phone: testPhone }, "");
    if (!res) return;
    setNote(
      res.ok
        ? `Test sent — Wabis replied ${res.status ?? "OK"}. Check that number for the WhatsApp message.`
        : `Test failed${res.status ? ` (HTTP ${res.status})` : ""}: ${String(res.error ?? res.body ?? "no response")}`,
    );
  }

  async function drain() {
    const res = await post({ action: "drain" }, "");
    if (!res) return;
    setNote(
      res.skipped
        ? "Nothing sent — the automation is switched off."
        : `Retried ${res.attempted ?? 0}, delivered ${res.sent ?? 0}.`,
    );
  }

  const missingPhone = (data?.consultants ?? []).filter((c) => !c.sendsAgentPhone);
  const pending = (data?.deliveries ?? []).filter((d) => d.status === "pending").length;

  return (
    <section className={card + " p-lg space-y-md"}>
      <div className="flex items-center justify-between gap-base">
        <div>
          <h3 className="text-h3 text-on-surface">WhatsApp automation (CRM → Wabis)</h3>
          <p className="text-label-sm text-on-surface-variant">
            On the first assignment of a lead, send the candidate and consultant to Wabis, which creates the WhatsApp
            subscriber, routes it to the matching agent, and sends the intro template.
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

          <label className="flex items-center gap-xs text-body-md">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Send the WhatsApp intro when a lead is assigned
          </label>

          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Wabis webhook URL</div>
            <input
              className={input + " w-full font-mono"}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://bot.wabis.in/webhook/whatsapp-workflow/…"
            />
            <p className="text-label-sm text-on-surface-variant mt-xs">
              Wabis → Bot Manager → Webhook Workflows → your workflow → Webhook Callback URL.
            </p>
          </div>

          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Outbound secret (optional)</div>
            <input
              className={input + " w-full font-mono"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Sent as the X-Webhook-Secret header"
            />
          </div>

          <label className="flex items-center gap-xs text-body-md">
            <input type="checkbox" checked={refire} onChange={(e) => setRefire(e.target.checked)} />
            Also send when a lead is <em>re</em>assigned to a different consultant
          </label>

          {/* Consultant → Wabis agent */}
          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Consultant → Wabis agent</div>
            <p className="text-label-sm text-on-surface-variant mb-xs">
              Names must match the agent in Wabis exactly. Leave the override blank to send the consultant&apos;s own
              name and number from CRM → Team.
            </p>
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
                    <th className="px-md py-xs">Consultant</th>
                    <th className="px-md py-xs">Wabis agent name (override)</th>
                    <th className="px-md py-xs">Agent phone (override)</th>
                    <th className="px-md py-xs">Sends as</th>
                  </tr>
                </thead>
                <tbody>
                  {data.consultants.map((c) => (
                    <tr key={c.userId} className="border-t border-outline-variant/60">
                      <td className="px-md py-xs whitespace-nowrap">{c.displayName}</td>
                      <td className="px-md py-xs">
                        <input
                          className={smInput}
                          placeholder={c.displayName}
                          value={overrides[c.userId]?.agent ?? ""}
                          onChange={(e) =>
                            setOverrides((o) => ({
                              ...o,
                              [c.userId]: { agent: e.target.value, phone: o[c.userId]?.phone ?? "" },
                            }))
                          }
                        />
                      </td>
                      <td className="px-md py-xs">
                        <input
                          className={smInput}
                          placeholder={c.rolePhone ?? "—"}
                          value={overrides[c.userId]?.phone ?? ""}
                          onChange={(e) =>
                            setOverrides((o) => ({
                              ...o,
                              [c.userId]: { agent: o[c.userId]?.agent ?? "", phone: e.target.value },
                            }))
                          }
                        />
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

          <div className="flex flex-wrap items-center gap-base">
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <span className="flex items-center gap-xs">
              <input
                className={input + " w-[190px] font-mono"}
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="Test to (your mobile)"
                aria-label="Send the test WhatsApp to this number"
              />
              <button className={ghost} disabled={busy || !url || !testPhone.trim()} onClick={test}>
                Send test
              </button>
            </span>
            <span className="text-label-sm text-on-surface-variant">
              A test sends a real WhatsApp message to that number.
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

          {/* Delivery log */}
          <div>
            <div className="text-label-sm text-on-surface-variant mb-xs">Recent deliveries</div>
            <div className="rounded-lg border border-outline-variant overflow-x-auto">
              <table className="w-full text-label-sm">
                <thead className="bg-surface-container-low text-on-surface-variant">
                  <tr className="text-left">
                    <th className="px-md py-xs">When</th>
                    <th className="px-md py-xs">Lead</th>
                    <th className="px-md py-xs">Status</th>
                    <th className="px-md py-xs">Tries</th>
                    <th className="px-md py-xs">Response</th>
                    <th className="px-md py-xs" />
                  </tr>
                </thead>
                <tbody>
                  {data.deliveries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-md py-md text-center text-on-surface-variant">
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
                          ) : d.leadId && d.event === "lead_assigned_skipped" ? (
                            <a className="text-primary hover:underline" href={`/crm/leads/${d.leadId}`}>
                              {d.candidateName || d.leadId} <span className="text-on-surface-variant">(skipped)</span>
                            </a>
                          ) : d.leadId ? (
                            <a className="text-primary hover:underline" href={`/crm/leads/${d.leadId}`}>
                              {d.candidateName || d.leadId}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-md py-xs">
                          <StatusPill status={d.status} />
                        </td>
                        <td className="px-md py-xs font-mono text-on-surface-variant">
                          {d.attempts}/{d.maxAttempts}
                        </td>
                        <td className="px-md py-xs text-on-surface-variant max-w-[320px] truncate" title={d.responseBody ?? ""}>
                          {d.responseStatus ? `HTTP ${d.responseStatus}` : ""}
                          {d.responseBody ? ` ${d.responseBody}` : d.responseStatus ? "" : "—"}
                        </td>
                        <td className="px-md py-xs text-right">
                          {d.status === "failed" && d.event === "lead_assigned" && (
                            <button
                              className="text-primary hover:underline text-label-sm font-semibold"
                              disabled={busy}
                              onClick={() => post({ action: "requeue", id: d.id }, "Queued for another try.")}
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
