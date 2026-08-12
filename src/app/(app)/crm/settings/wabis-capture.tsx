"use client";

import { useCallback, useEffect, useState } from "react";

type Capture = {
  enabled: boolean;
  keyword: string;
  campaign: string;
  secret: string;
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const input =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary";

/**
 * Inbound WhatsApp lead capture — a Meta-marketed WhatsApp number, wired through
 * a Wabis keyword flow, auto-creates a CRM lead when a candidate first messages
 * the campaign keyword (e.g. "study abroad"). Reads/writes the same admin endpoint
 * as the Wabis card (only the `capture` slice) and shows the ready-to-paste
 * webhook URL with the shared inbound secret embedded.
 */
export function WabisCaptureCard() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [keyword, setKeyword] = useState("study abroad");
  const [campaign, setCampaign] = useState("Study Abroad");
  const [secret, setSecret] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/integrations/wabis");
    if (r.ok) {
      const c = ((await r.json()) as { capture: Capture }).capture;
      setEnabled(c.enabled);
      setKeyword(c.keyword);
      setCampaign(c.campaign);
      setSecret(c.secret);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Built in the browser (origin is the admin's real host) — the secret rides in
  // the query string because Wabis's "Forward Data to Webhook" field can't add a
  // custom header. Reflects the CURRENT secret input for a live preview.
  const captureUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/crm/integrations/wabis/capture` +
        (secret.trim() ? `?key=${encodeURIComponent(secret.trim())}` : "")
      : "";

  async function save() {
    setBusy(true);
    setNote(null);
    setError(null);
    const r = await fetch("/api/crm/integrations/wabis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save_capture", enabled, keyword, campaign, inboundSecret: secret }),
    });
    const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!r.ok) {
      setError((payload.message as string | undefined) ?? "That didn't work.");
      return;
    }
    setNote("Lead capture settings saved.");
    void load();
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(captureUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — select the URL and copy it manually.");
    }
  }

  return (
    <section className={card + " p-lg space-y-md"}>
      <div className="flex items-center justify-between gap-base">
        <div>
          <h3 className="text-h3 text-on-surface">WhatsApp lead capture (Meta)</h3>
          <p className="text-label-sm text-on-surface-variant">
            When a candidate messages the Meta-marketed WhatsApp number with the campaign keyword, a Wabis keyword-reply
            flow calls the capture URL below and a lead is created automatically (source <span className="font-medium">Meta WhatsApp</span>).
            Repeat messages fold into a re-inquiry on the existing lead.
          </p>
        </div>
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 28 }}>
          waving_hand
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
            Accept inbound WhatsApp lead capture
          </label>

          <div className="grid gap-md md:grid-cols-2">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">
                Keyword safety-net (blank = trust Wabis)
              </span>
              <input
                className={input + " w-full"}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="study abroad"
              />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Campaign label on captured leads</span>
              <input
                className={input + " w-full"}
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="Study Abroad"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">
              Inbound secret (shared with the Re-marketing reply hook)
            </span>
            <input
              className={input + " w-full font-mono"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="shared secret embedded in the capture URL"
            />
          </label>

          <div className="rounded-lg bg-surface-container-low border border-outline-variant px-md py-sm space-y-sm">
            <div className="text-label-sm text-on-surface-variant">
              In Wabis, create a keyword-reply flow (keyword <span className="font-mono">{keyword || "study abroad"}</span>,{" "}
              <span className="font-medium">String match / contains</span>) and paste this into its
              &ldquo;Forward Data to Webhook&rdquo; field:
            </div>
            <div className="flex items-center gap-base">
              <code className="flex-1 overflow-x-auto rounded bg-surface-container-lowest border border-outline-variant px-sm py-xs text-label-sm">
                {secret.trim() ? captureUrl : "Set the inbound secret above to generate the URL"}
              </code>
              <button
                className={btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"}
                disabled={!secret.trim()}
                onClick={copyUrl}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="text-label-sm text-on-surface-variant">
              Optional: append <span className="font-mono">&amp;agent=&lt;consultant email&gt;</span> in a per-agent flow to
              auto-assign the lead to that consultant. Without it, leads land unassigned for pickup.
            </div>
          </div>

          <div className="flex justify-end">
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save lead capture"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
