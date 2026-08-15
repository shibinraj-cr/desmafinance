"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * WhatsApp module settings — the conversation mirror, the Cloud API credentials
 * and the broadcast switch.
 *
 * Separate from the Wabis card above it because they are different transports,
 * and during the transition BOTH are live: Wabis keeps running the assignment
 * intros and the re-marketing drip while this module reads and answers
 * conversations. Merging them into one form would imply an either/or that is not
 * true yet.
 *
 * The token and app secret are write-only — the server returns a masked hint and
 * a blank field means "leave it alone", so re-saving cannot wipe a credential
 * nobody can see.
 */

type Settings = {
  provider: "wabis" | "cloud";
  activeProvider: string;
  activeProviderLabel: string;
  cloudConfigured: boolean;
  mirror: {
    enabled: boolean;
    autoCreateLeads: boolean;
    secret: string;
    webhookUrl: string | null;
    verifyToken: string | null;
  };
  cloud: {
    phoneNumberId: string;
    wabaId: string;
    apiVersion: string;
    hasToken: boolean;
    tokenHint: string | null;
    hasAppSecret: boolean;
    appSecretHint: string | null;
  };
  broadcasts: { enabled: boolean; batchSize: string };
  wabisApi: { hasToken: boolean; tokenHint: string | null };
};

type ImportSummary = {
  dryRun: boolean;
  subscribersSeen: number;
  conversationsTouched: number;
  messagesFound: number;
  messagesImported: number;
  leadsMatched: number;
  skippedNoPhone: number;
  stoppedEarly: boolean;
  sampleRaw: unknown;
  observedKeys: string[];
  observedSenders: { value: string; direction: string; count: number }[];
  rawResponse: string | null;
  requestSent: string | null;
  errors: string[];
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const ghost = btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low";
const input =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
      {hint && <span className="block text-label-sm text-on-surface-variant mt-xs">{hint}</span>}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <span>
        <span className="block text-body-md text-on-surface">{label}</span>
        {hint && <span className="block text-label-sm text-on-surface-variant">{hint}</span>}
      </span>
    </label>
  );
}

export function WhatsAppModuleCard() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Settings | null>(null);

  const [provider, setProvider] = useState<"wabis" | "cloud">("wabis");
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [autoCreate, setAutoCreate] = useState(true);
  const [mirrorSecret, setMirrorSecret] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [broadcastEnabled, setBroadcastEnabled] = useState(false);
  const [batchSize, setBatchSize] = useState("");
  const [wabisApiToken, setWabisApiToken] = useState("");

  const [importPhone, setImportPhone] = useState("");
  const [importMax, setImportMax] = useState("25");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  // Local to this card: the page-level note renders at the top, which is out of
  // sight from the button that triggered it.
  const [keyNote, setKeyNote] = useState<string | null>(null);

  const [testPhone, setTestPhone] = useState("");
  const [testBody, setTestBody] = useState("");
  const [testTemplate, setTestTemplate] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/wa/settings");
    if (r.ok) {
      const d = (await r.json()) as Settings;
      setS(d);
      setProvider(d.provider);
      setMirrorEnabled(d.mirror.enabled);
      setAutoCreate(d.mirror.autoCreateLeads);
      setMirrorSecret(d.mirror.secret);
      setPhoneNumberId(d.cloud.phoneNumberId);
      setWabaId(d.cloud.wabaId);
      setApiVersion(d.cloud.apiVersion);
      setBroadcastEnabled(d.broadcasts.enabled);
      setBatchSize(d.broadcasts.batchSize);
      setToken("");
      setAppSecret("");
      setWabisApiToken("");
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
    const r = await fetch("/api/crm/wa/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        provider,
        mirrorEnabled,
        autoCreateLeads: autoCreate,
        mirrorSecret,
        phoneNumberId,
        wabaId,
        apiVersion,
        token,
        appSecret,
        broadcastEnabled,
        batchSize,
        wabisApiToken,
      }),
    });
    const p = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!r.ok) {
      setError((p.message as string | undefined) ?? "That didn't save.");
      return;
    }
    setNote("WhatsApp settings saved.");
    void load();
  }

  async function generateSecret() {
    const r = await fetch("/api/crm/wa/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "generate_secret" }),
    });
    if (r.ok) {
      const p = (await r.json()) as { secret: string };
      setMirrorSecret(p.secret);
      setNote("New secret generated and saved. Update it wherever the webhook is configured.");
      void load();
    }
  }

  async function sendTest() {
    setTestBusy(true);
    setTestResult(null);
    const r = await fetch("/api/crm/wa/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "test_send",
        phone: testPhone,
        ...(testTemplate.trim() ? { template: testTemplate.trim() } : { body: testBody }),
      }),
    });
    const p = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      providerLabel?: string;
      providerMessageId?: string | null;
      unsupported?: boolean;
      detail?: string;
      message?: string;
    };
    setTestBusy(false);
    setTestOk(!!p.ok);
    if (p.ok) {
      setTestResult(
        `Sent via ${p.providerLabel}${p.providerMessageId ? ` — message id ${p.providerMessageId}` : " (no message id returned)"}`,
      );
    } else {
      setTestResult(
        p.unsupported
          ? `${p.providerLabel} can't do this: ${p.detail}`
          : (p.detail ?? p.message ?? "The test send failed."),
      );
    }
  }

  if (loading) return <div className={card + " p-lg text-on-surface-variant"}>Loading…</div>;

  const driftWarning = s && s.provider === "cloud" && s.activeProvider !== "cloud";

  return (
    <div className="space-y-lg">
      <div className={card + " p-lg space-y-md"}>
        <div className="flex items-center justify-between gap-base">
          <h3 className="text-h3 text-on-surface">WhatsApp Inbox &amp; Broadcasts</h3>
          <span className="text-label-sm text-on-surface-variant">
            Live transport: <span className="font-semibold text-on-surface">{s?.activeProviderLabel}</span>
          </span>
        </div>

        {driftWarning && (
          <p className="text-label-sm text-error">
            Cloud API is selected but not configured, so sends are still going through Wabis. Fill in the phone number
            id and access token below.
          </p>
        )}
        {note && <p className="text-label-sm text-primary">{note}</p>}
        {error && <p className="text-label-sm text-error">{error}</p>}

        <Field label="Transport" hint="Wabis keeps running the assignment intros and the re-marketing drip either way — those never use this setting.">
          <select value={provider} onChange={(e) => setProvider(e.target.value as "wabis" | "cloud")} className={input + " w-full max-w-sm"}>
            <option value="wabis">Wabis — read-only inbox, cannot send from the CRM</option>
            <option value="cloud">WhatsApp Cloud API — full send and receive</option>
          </select>
        </Field>
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">Conversation mirror</h3>
        <p className="text-label-sm text-on-surface-variant">
          Stores incoming messages so the CRM can show the conversation. Off means nothing is recorded at all.
        </p>

        <Toggle checked={mirrorEnabled} onChange={setMirrorEnabled} label="Store incoming conversations" />
        <Toggle
          checked={autoCreate}
          onChange={setAutoCreate}
          label="Create a lead when an unknown number messages us"
          hint="Recommended — otherwise a first-contact message has nothing to attach to."
        />

        <Field label="Webhook secret" hint="Sent as ?key= on the webhook URL, and used as Meta's verify token.">
          <div className="flex flex-wrap items-center gap-sm">
            <input value={mirrorSecret} onChange={(e) => setMirrorSecret(e.target.value)} className={input + " flex-1 min-w-[280px] font-mono text-label-sm"} />
            <button type="button" className={ghost} onClick={() => void generateSecret()}>
              Generate
            </button>
          </div>
        </Field>

        {s?.mirror.webhookUrl && (
          <Field label="Webhook URL — paste this into Meta (or Wabis)">
            <code className="block px-md py-sm rounded-lg bg-surface-container-low text-label-sm font-mono break-all">
              {s.mirror.webhookUrl}
            </code>
          </Field>
        )}
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">WhatsApp Cloud API</h3>
        <p className="text-label-sm text-on-surface-variant">
          From your own Meta app. The access token should be a permanent System User token — the default one expires in
          hours and would fail silently mid-campaign.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-base">
          <Field label="Phone number ID" hint="The number's id, not the number itself.">
            <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className={input + " w-full font-mono text-label-sm"} />
          </Field>
          <Field label="WhatsApp Business Account ID" hint="Only needed to list approved templates.">
            <input value={wabaId} onChange={(e) => setWabaId(e.target.value)} className={input + " w-full font-mono text-label-sm"} />
          </Field>
          <Field
            label="Access token"
            hint={s?.cloud.hasToken ? `Stored: ${s.cloud.tokenHint} — leave blank to keep it.` : "Not set."}
          >
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={s?.cloud.hasToken ? "•••••• (unchanged)" : ""}
              className={input + " w-full font-mono text-label-sm"}
            />
          </Field>
          <Field
            label="App secret"
            hint={
              s?.cloud.hasAppSecret
                ? `Stored: ${s.cloud.appSecretHint} — leave blank to keep it.`
                : "Optional. Verifies Meta's webhook signature; without it the shared secret is used."
            }
          >
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={s?.cloud.hasAppSecret ? "•••••• (unchanged)" : ""}
              className={input + " w-full font-mono text-label-sm"}
            />
          </Field>
          <Field label="Graph API version" hint="Blank uses the pinned default (v21.0).">
            <input value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} placeholder="v21.0" className={input + " w-full font-mono text-label-sm"} />
          </Field>
        </div>
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">Broadcasts</h3>
        <Toggle
          checked={broadcastEnabled}
          onChange={setBroadcastEnabled}
          label="Allow campaigns to send"
          hint="Off means campaigns can be built and queued but nothing goes out."
        />
        <Field label="Messages per run" hint="Blank uses 100. Each run is bounded by time as well, so a large campaign takes several.">
          <input value={batchSize} onChange={(e) => setBatchSize(e.target.value)} placeholder="100" className={input + " w-40"} />
        </Field>
      </div>

      <div className="flex items-center gap-base">
        <button type="button" className={primary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save WhatsApp settings"}
        </button>
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">Send a test message</h3>
        <p className="text-label-sm text-on-surface-variant">
          Proves the transport works without touching a webhook, a subscription or the mirror — outbound needs only the
          token and phone number id. Safe to run while Wabis is live. Free text only reaches someone who messaged the
          business number in the last 24 hours; otherwise use a template.
        </p>

        {/* Say which transport this will use BEFORE it is pressed. Without this
            the button silently used whatever Transport was selected above, and
            failed on a capability Wabis does not have — which reads as though
            the Cloud credentials were wrong. */}
        {s?.cloudConfigured ? (
          <p className="text-label-sm text-on-surface-variant">
            Sends via <span className="font-semibold text-on-surface">WhatsApp Cloud API</span> — deliberately, even
            while the live transport is still {s.activeProviderLabel}. That is what makes this safe to run before
            cutting over.
          </p>
        ) : (
          <p className="text-label-sm text-error">
            Fill in the phone number id and access token above and save — without them there is nothing here that can
            send.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-base">
          <Field label="To (your own number)">
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+91…" className={input + " w-full"} />
          </Field>
          <Field label="Template" hint="name:language, e.g. hello_world:en_US. Leave blank to send free text.">
            <input value={testTemplate} onChange={(e) => setTestTemplate(e.target.value)} className={input + " w-full font-mono text-label-sm"} />
          </Field>
          <Field label="Message" hint="Used only when no template is given.">
            <input value={testBody} onChange={(e) => setTestBody(e.target.value)} placeholder="DesGro CRM test message." className={input + " w-full"} />
          </Field>
        </div>

        <button
          type="button"
          className={ghost}
          disabled={testBusy || !testPhone.trim() || !s?.cloudConfigured}
          title={s?.cloudConfigured ? undefined : "Save the Cloud API phone number id and access token first"}
          onClick={() => void sendTest()}
        >
          {testBusy ? "Sending…" : "Send test"}
        </button>

        {testResult && <p className={"text-label-sm " + (testOk ? "text-primary" : "text-error")}>{testResult}</p>}
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">Import history from Wabis</h3>
        <p className="text-label-sm text-on-surface-variant">
          Pulls past conversations out of Wabis so the inbox doesn’t start empty. One-off, not a sync — run it before
          Wabis is retired. Safe to repeat: messages are matched on their WhatsApp id, so nothing duplicates.
        </p>
        <p className="text-label-sm text-on-surface-variant">
          <span className="font-semibold text-on-surface">Always dry-run first.</span> Wabis doesn’t document what its
          API returns, so the dry run reports the field names it actually saw — that’s what the mapping gets corrected
          against before anything is written.
        </p>

        {/* This field has its own Save. The page-level Save button sits above
            this card, so a key typed here with no adjacent button reads as saved
            when it is not — which is exactly how the first attempt failed. */}
        <Field
          label="Wabis API key"
          hint={
            s?.wabisApi.hasToken
              ? `Stored: ${s.wabisApi.tokenHint}`
              : "From Wabis: avatar menu → API Developer. Used only for this import."
          }
        >
          <div className="flex flex-wrap items-center gap-sm">
            <input
              type="password"
              value={wabisApiToken}
              onChange={(e) => setWabisApiToken(e.target.value)}
              placeholder={s?.wabisApi.hasToken ? "•••••• (stored)" : "Paste the key, then Save key"}
              className={input + " flex-1 min-w-[260px] max-w-md font-mono text-label-sm"}
            />
            <button
              type="button"
              className={primary}
              disabled={keyBusy || !wabisApiToken.trim()}
              onClick={() => void saveWabisKey()}
            >
              {keyBusy ? "Saving…" : "Save key"}
            </button>
          </div>
        </Field>

        {keyNote && <p className="text-label-sm text-primary">{keyNote}</p>}

        {!s?.wabisApi.hasToken && (
          <p className="text-label-sm text-on-surface-variant">
            Save the key before running anything here — the import reads it from the server, not from this box.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-base">
          <Field label="Only this number" hint="Strongly recommended for the first run.">
            <input value={importPhone} onChange={(e) => setImportPhone(e.target.value)} placeholder="+91…" className={input + " w-48"} />
          </Field>
          <Field label="Max contacts" hint="Ignored when a number is given.">
            <input value={importMax} onChange={(e) => setImportMax(e.target.value)} className={input + " w-28"} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-base">
          <button
            type="button"
            className={ghost}
            disabled={importBusy || !s?.wabisApi.hasToken}
            title={s?.wabisApi.hasToken ? undefined : "Save the Wabis API key first"}
            onClick={() => void runImport(true)}
          >
            {importBusy ? "Working…" : "Dry run"}
          </button>
          <button
            type="button"
            className={primary}
            disabled={importBusy || !importResult || importResult.dryRun === false}
            onClick={() => void runImport(false)}
            title={!importResult ? "Do a dry run first" : undefined}
          >
            Import for real
          </button>
        </div>

        {importResult && <ImportReport summary={importResult} />}
      </div>
    </div>
  );

  async function saveWabisKey() {
    setKeyBusy(true);
    setKeyNote(null);
    const r = await fetch("/api/crm/wa/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save_wabis_key", token: wabisApiToken }),
    }).catch(() => null);
    setKeyBusy(false);
    if (!r?.ok) {
      setKeyNote("The Wabis API key didn’t save.");
      return;
    }
    setKeyNote("Saved. You can dry-run now.");
    // Reload so `hasToken` flips and the Dry run button unlocks.
    void load();
  }

  async function runImport(dryRun: boolean) {
    setImportBusy(true);
    setImportResult(null);
    const r = await fetch("/api/crm/wa/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dryRun,
        maxSubscribers: Math.max(1, Math.min(500, Number(importMax) || 25)),
        onlyPhone: importPhone.trim() || null,
      }),
    }).catch(() => null);
    setImportBusy(false);
    if (!r?.ok) {
      setImportResult({
        dryRun,
        subscribersSeen: 0,
        conversationsTouched: 0,
        messagesFound: 0,
        messagesImported: 0,
        leadsMatched: 0,
        skippedNoPhone: 0,
        stoppedEarly: false,
        sampleRaw: null,
        observedKeys: [],
        observedSenders: [],
        rawResponse: null,
        requestSent: null,
        errors: ["The import request failed."],
      });
      return;
    }
    setImportResult((await r.json()) as ImportSummary);
  }
}

/**
 * The dry-run report is the actual deliverable of a first run: the observed
 * field names and one raw record are what tell us whether the normaliser is
 * reading the right keys, without anyone having to read a log.
 */
function ImportReport({ summary }: { summary: ImportSummary }) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-sm">
      <p className="text-body-md text-on-surface">
        {summary.dryRun ? "Dry run — nothing was written." : "Imported."}{" "}
        <span className="tabular-nums">
          {summary.subscribersSeen} contacts · {summary.messagesFound} messages found
          {!summary.dryRun && ` · ${summary.messagesImported} stored · ${summary.leadsMatched} matched to a lead`}
        </span>
      </p>

      {summary.stoppedEarly && (
        <p className="text-label-sm text-on-surface-variant">
          Stopped on the time limit — run it again to continue where it left off.
        </p>
      )}
      {summary.skippedNoPhone > 0 && (
        <p className="text-label-sm text-on-surface-variant">{summary.skippedNoPhone} contacts had no usable number.</p>
      )}

      {summary.observedKeys.length > 0 && (
        <div>
          <span className="block text-label-sm text-on-surface-variant mb-xs">Fields Wabis actually returned</span>
          <code className="block text-label-sm font-mono break-all">{summary.observedKeys.join(", ")}</code>
        </div>
      )}

      {summary.observedSenders.length > 0 && (
        <div>
          <span className="block text-label-sm text-on-surface-variant mb-xs">
            Who sent what — check these read the right way round
          </span>
          <ul className="space-y-xs">
            {summary.observedSenders.map((s) => (
              <li key={s.value} className="text-label-sm">
                <code className="font-mono">{s.value}</code> → {s.direction === "out" ? "us" : "the candidate"}{" "}
                <span className="text-on-surface-variant tabular-nums">({s.count})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.sampleRaw != null && (
        <details>
          <summary className="text-label-sm text-primary cursor-pointer">Sample message record</summary>
          <pre className="mt-xs text-label-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(summary.sampleRaw, null, 2)}
          </pre>
        </details>
      )}

      {/* Shown whether or not anything was found — when nothing is, this IS the
          finding. Open by default in that case so it does not have to be hunted for. */}
      {summary.rawResponse && (
        <details open={summary.messagesFound === 0}>
          <summary className="text-label-sm text-primary cursor-pointer">
            What Wabis actually returned {summary.messagesFound === 0 && "— read this"}
          </summary>
          {summary.requestSent && (
            <p className="mt-xs text-label-sm font-mono text-on-surface-variant break-all">{summary.requestSent}</p>
          )}
          <pre className="mt-xs text-label-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
            {summary.rawResponse}
          </pre>
        </details>
      )}

      {summary.errors.length > 0 && (
        <div>
          <span className="block text-label-sm text-error mb-xs">Problems</span>
          <ul className="list-disc pl-lg space-y-xs">
            {summary.errors.slice(0, 10).map((e, i) => (
              <li key={i} className="text-label-sm text-error break-all">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
