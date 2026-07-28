"use client";

import { useCallback, useEffect, useState } from "react";

type Remarketing = {
  enabled: boolean;
  url: string;
  offsets: string;
  keywords: string;
  inboundSecret: string;
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const input =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary";

/**
 * Re-marketing nurturing campaign settings — its own card rather than buried in
 * the Wabis assignment card, since it is a distinct feature with its own
 * schedule, keywords, inbound secret and Save. Reads/writes the same admin
 * endpoint as the Wabis card (only the `remarketing` slice) and keeps its own
 * save feedback so the confirmation appears next to this form, not elsewhere.
 */
export function RemarketingSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [offsets, setOffsets] = useState("5,19,33");
  const [keywords, setKeywords] = useState("");
  const [inboundSecret, setInboundSecret] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/integrations/wabis");
    if (r.ok) {
      const rm = ((await r.json()) as { remarketing: Remarketing }).remarketing;
      setEnabled(rm.enabled);
      setUrl(rm.url);
      setOffsets(rm.offsets);
      setKeywords(rm.keywords);
      setInboundSecret(rm.inboundSecret);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setNote(null);
    setError(null);
    const r = await fetch("/api/crm/integrations/wabis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save_remarketing", enabled, url, offsets, keywords, inboundSecret }),
    });
    const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!r.ok) {
      setError((payload.message as string | undefined) ?? "That didn't work.");
      return;
    }
    setNote("Re-marketing settings saved.");
    void load();
  }

  return (
    <section className={card + " p-lg space-y-md"}>
      <div className="flex items-center justify-between gap-base">
        <div>
          <h3 className="text-h3 text-on-surface">Re-marketing nurturing (Wabis)</h3>
          <p className="text-label-sm text-on-surface-variant">
            When a lead enters the Re-marketing stage, send three WhatsApp touch-points on a schedule. A candidate
            reply in Wabis (via a keyword-reply flow that calls the inbound URL below) moves the lead back to Follow-Up
            automatically.
          </p>
        </div>
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 28 }}>
          campaign
        </span>
      </div>

      {loading && <p className="text-body-md text-on-surface-variant">Loading…</p>}

      {!loading && (
        <>
          {error && (
            <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">{error}</div>
          )}
          {note && (
            <div className="rounded-lg bg-surface-container-low px-md py-sm text-body-md text-on-surface-variant">{note}</div>
          )}

          <label className="flex items-center gap-xs text-body-md">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Run re-marketing campaigns
          </label>

          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">Wabis touch-point workflow URL</span>
            <input
              className={input + " w-full font-mono"}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://bot.wabis.in/webhook/whatsapp-workflow/…  (branch on the `touch` field: 1/2/3)"
            />
          </label>

          <div className="grid gap-md md:grid-cols-2">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">
                Touch-point days (from stage entry)
              </span>
              <input
                className={input + " w-full font-mono"}
                value={offsets}
                onChange={(e) => setOffsets(e.target.value)}
                placeholder="5,19,33"
              />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">
                Re-engage keywords (blank = any reply advances)
              </span>
              <input
                className={input + " w-full"}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="interested, yes, call me"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">Inbound reply secret</span>
            <input
              className={input + " w-full font-mono"}
              value={inboundSecret}
              onChange={(e) => setInboundSecret(e.target.value)}
              placeholder="shared secret Wabis sends as the x-wabis-secret header"
            />
          </label>

          <div className="rounded-lg bg-surface-container-low border border-outline-variant px-md py-sm text-label-sm text-on-surface-variant">
            Point the Wabis keyword-reply flow&apos;s HTTP-API block at{" "}
            <span className="font-mono">/api/crm/integrations/wabis/inbound</span>, sending back{" "}
            <span className="font-mono">lead_id</span> (echoed from the outbound payload), the subscriber{" "}
            <span className="font-mono">phone</span>, and the reply <span className="font-mono">message</span>, with the
            secret above.
          </div>

          <div className="flex justify-end">
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save re-marketing"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
