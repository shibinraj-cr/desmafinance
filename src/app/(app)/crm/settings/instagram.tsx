"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * Instagram DMs → leads (CRM → Settings → Instagram).
 *
 * Laid out in the order the setup has to happen — connect the Page, point
 * Meta's webhook here and subscribe the Page, then switch capture and auto-ask
 * on — with the proof at the bottom: the last delivery Meta made and the
 * contacts it produced. Phase 0 of the rollout is "a test DM shows up in that
 * list", before either switch is on.
 *
 * The access token is write-only, as on the WhatsApp card: a masked hint comes
 * back and a blank field keeps what is stored.
 */

type Recent = {
  id: string;
  username: string | null;
  name: string | null;
  email: string | null;
  phoneE164: string | null;
  qualification: string | null;
  leadId: string | null;
  leadName: string | null;
  leadCreated: boolean;
  askCount: number;
  thanked: boolean;
  humanReplied: boolean;
  autoAskBlocked: string | null;
  lastInboundAt: string | null;
  lastMessage: string | null;
};

type Settings = {
  pageId: string;
  apiVersion: string;
  defaultApiVersion: string;
  hasToken: boolean;
  tokenHint: string | null;
  hasPageToken: boolean;
  accountId: string | null;
  username: string | null;
  verifyToken: string | null;
  webhookUrl: string;
  appSecretConfigured: boolean;
  captureEnabled: boolean;
  autoAskEnabled: boolean;
  texts: { intro: string; followUp: string; thanks: string };
  defaults: { intro: string; followUp: string; thanks: string };
  lastWebhookAt: string | null;
  stats: { contacts: number; leadsCreated: number; leadsLinked: number; inbound24h: number; autoSent: number };
  recent: Recent[];
};

type SubApp = { name: string | null; id: string | null; fields: string[] };

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const ghost = btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low";
const input =
  "h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary";
const textarea =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary";

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

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const BLOCKED_LABEL: Record<string, string> = {
  earlier_conversation: "Off: chat started before DesGro",
  history_unknown: "Off: couldn't check chat history",
  standby: "Off: another app owns this chat",
};

function autoAskLabel(r: Recent): string {
  if (r.humanReplied) return "Stopped: team replied";
  if (r.autoAskBlocked) return BLOCKED_LABEL[r.autoAskBlocked] ?? `Off: ${r.autoAskBlocked}`;
  if (r.thanked) return "Done";
  if (r.askCount > 0) return `Asked ${r.askCount}×`;
  return "—";
}

export function InstagramCard() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Settings | null>(null);

  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [apiVersion, setApiVersion] = useState("");
  const [capture, setCapture] = useState(false);
  const [autoAsk, setAutoAsk] = useState(false);
  const [intro, setIntro] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [thanks, setThanks] = useState("");

  const [checkResult, setCheckResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [subs, setSubs] = useState<{ ok: boolean; apps: SubApp[]; detail: string; subscribeDetail: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/ig/settings");
    if (r.ok) {
      const d = (await r.json()) as Settings;
      setS(d);
      setPageId(d.pageId);
      setApiVersion(d.apiVersion);
      setCapture(d.captureEnabled);
      setAutoAsk(d.autoAskEnabled);
      setIntro(d.texts.intro);
      setFollowUp(d.texts.followUp);
      setThanks(d.texts.thanks);
      setToken("");
    } else {
      setError("Couldn't load the Instagram settings.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const r = await fetch("/api/crm/ig/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const p = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      setError((p.message as string | undefined) ?? (p.error as string | undefined) ?? "That didn't work.");
      return null;
    }
    return p;
  }

  async function save() {
    setBusy(true);
    setNote(null);
    setError(null);
    const p = await post({
      action: "save",
      pageId,
      accessToken: token,
      apiVersion,
      captureEnabled: capture,
      autoAskEnabled: autoAsk,
      intro,
      followUp,
      thanks,
    });
    setBusy(false);
    if (p) {
      setNote("Saved.");
      await load();
    }
  }

  async function generateVerifyToken() {
    setError(null);
    const p = await post({ action: "generate_verify_token" });
    if (p) await load();
  }

  async function checkConnection() {
    setBusy(true);
    setError(null);
    setCheckResult(null);
    const p = await post({ action: "check_connection" });
    setBusy(false);
    if (!p) return;
    if (p.ok) {
      setCheckResult({
        ok: true,
        text: `Connected: Page "${(p.pageName as string) ?? "?"}" → Instagram @${(p.username as string) ?? "?"}${
          p.pageTokenDerived ? "" : " (using the pasted token as the Page token)"
        }.`,
      });
      await load();
    } else {
      setCheckResult({ ok: false, text: String(p.detail ?? "Check failed.") });
    }
  }

  async function subscription(action: "check_subscription" | "subscribe") {
    setBusy(true);
    setError(null);
    const p = await post({ action });
    setBusy(false);
    if (p) {
      setSubs({
        ok: !!p.ok,
        apps: (p.apps as SubApp[]) ?? [],
        detail: String(p.detail ?? ""),
        subscribeDetail: String(p.subscribeDetail ?? ""),
      });
    }
  }

  if (loading && !s) {
    return <div className={card + " p-lg text-on-surface-variant"}>Loading…</div>;
  }

  const connected = !!s?.accountId;
  const heard = !!s?.lastWebhookAt;

  return (
    <div className="space-y-lg">
      <div className={card + " p-lg space-y-md"}>
        <div className="flex flex-wrap items-center justify-between gap-base">
          <h3 className="text-h3 text-on-surface">Instagram DMs → Leads</h3>
          <div className="flex flex-wrap items-center gap-sm text-label-sm">
            <span className={connected ? "text-primary font-semibold" : "text-on-surface-variant"}>
              {connected ? `Connected: @${s?.username ?? s?.accountId}` : "Not connected"}
            </span>
            <span className="text-on-surface-variant">·</span>
            <span className={heard ? "text-on-surface" : "text-on-surface-variant"}>
              Last delivery from Meta: <span className="font-semibold">{ago(s?.lastWebhookAt ?? null)}</span>
            </span>
          </div>
        </div>
        <p className="text-label-sm text-on-surface-variant">
          When someone DMs the Instagram account, DesGro stores the message and reads their phone, email, qualification
          and name from it. Once a phone or email arrives, a lead is created with source <b>Insta</b>, or, if that
          number or email is already a lead, it&apos;s recorded as a re-inquiry on that lead. Your team keeps replying in
          Business Suite as usual. Setup steps are in <code className="font-mono">INSTAGRAM.md</code>.
        </p>
        {note && <p className="text-label-sm text-primary">{note}</p>}
        {error && <p className="text-label-sm text-error">{error}</p>}
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">1. Connect the account</h3>
        <p className="text-label-sm text-on-surface-variant">
          Through the Facebook Page the Instagram professional account is linked to. Use a System User token, which does
          not expire, with these permissions: instagram_basic, instagram_manage_messages, pages_manage_metadata,
          pages_show_list.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-base">
          <Field label="Facebook Page ID">
            <input value={pageId} onChange={(e) => setPageId(e.target.value)} className={input + " w-full font-mono text-label-sm"} />
          </Field>
          <Field label="Access token" hint={s?.hasToken ? `Stored: ${s.tokenHint}. Leave blank to keep it.` : "Not set."}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={s?.hasToken ? "•••••• (unchanged)" : ""}
              className={input + " w-full font-mono text-label-sm"}
            />
          </Field>
          <Field label="Graph API version" hint={`Blank uses ${s?.defaultApiVersion ?? "the default"}.`}>
            <input
              value={apiVersion}
              onChange={(e) => setApiVersion(e.target.value)}
              placeholder={s?.defaultApiVersion}
              className={input + " w-full font-mono text-label-sm"}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <button type="button" className={primary} disabled={busy} onClick={() => void save()}>
            Save
          </button>
          <button type="button" className={ghost} disabled={busy || !s?.hasToken || !s?.pageId} onClick={() => void checkConnection()}>
            Check connection
          </button>
          {checkResult && (
            <span className={"text-label-sm " + (checkResult.ok ? "text-primary" : "text-error")}>{checkResult.text}</span>
          )}
        </div>
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">2. Point Meta&apos;s webhook here</h3>
        <p className="text-label-sm text-on-surface-variant">
          Meta App Dashboard → Webhooks → <b>Instagram</b> → Subscribe to this object. Paste the callback URL and verify
          token below, then subscribe to the <b>messages</b> field. Then subscribe the Page with the button below.
          Without that second step, Meta verifies the URL but never delivers a message.
        </p>
        <Field label="Callback URL">
          <code className="block px-md py-sm rounded-lg bg-surface-container-low text-label-sm font-mono break-all">
            {s?.webhookUrl}
          </code>
        </Field>
        <Field label="Verify token">
          <div className="flex flex-wrap items-center gap-sm">
            <code className="flex-1 min-w-[280px] px-md py-sm rounded-lg bg-surface-container-low text-label-sm font-mono break-all">
              {s?.verifyToken ?? "Not set yet. Generate one."}
            </code>
            <button type="button" className={ghost} onClick={() => void generateVerifyToken()}>
              {s?.verifyToken ? "Regenerate" : "Generate"}
            </button>
          </div>
        </Field>
        {!s?.appSecretConfigured && (
          <div className="rounded-lg border border-error/40 bg-error/5 p-md">
            <p className="text-label-sm text-error font-semibold">
              Messages will be rejected until the Meta App secret is saved.
            </p>
            <p className="text-label-sm text-on-surface-variant">
              It&apos;s the same secret the WhatsApp module uses: CRM → Settings → WhatsApp Inbox → App secret (Meta → App
              Dashboard → Settings → Basic).
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-sm">
          <button type="button" className={primary} disabled={busy || !connected} onClick={() => void subscription("subscribe")}>
            Subscribe the Page
          </button>
          <button type="button" className={ghost} disabled={busy || !s?.pageId} onClick={() => void subscription("check_subscription")}>
            Check subscription
          </button>
          {!connected && <span className="text-label-sm text-on-surface-variant">Check the connection first.</span>}
        </div>
        {subs && (
          <div className="rounded-lg bg-surface-container-low p-md text-label-sm space-y-xs">
            {subs.subscribeDetail && <p className={subs.ok ? "text-primary" : "text-error"}>{subs.subscribeDetail}</p>}
            {subs.detail && <p className="text-error">{subs.detail}</p>}
            {subs.apps.length === 0 && !subs.detail && <p className="text-on-surface-variant">No apps are subscribed to this Page.</p>}
            {subs.apps.map((a) => (
              <p key={a.id ?? a.name ?? "app"} className="text-on-surface">
                <span className="font-semibold">{a.name ?? a.id}</span>
                {a.fields.length > 0 && <span className="text-on-surface-variant">: {a.fields.join(", ")}</span>}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">3. Lead capture</h3>
        <Toggle
          checked={capture}
          onChange={setCapture}
          label="Create leads from Instagram DMs"
          hint="Messages are stored either way. Switch this on once a test DM shows up in the list below."
        />
      </div>

      <div className={card + " p-lg space-y-md"}>
        <h3 className="text-h3 text-on-surface">4. Auto-ask for details</h3>
        <Toggle
          checked={autoAsk}
          onChange={setAutoAsk}
          label="Reply to new DMs asking for phone, email and qualification"
          hint="At most two asks plus one thank-you. Only for chats that start after this is on, never for a chat that already existed. It stops for good once anyone on the team replies, and it never messages someone who is already a lead."
        />
        <p className="text-label-sm text-on-surface-variant">
          Leave a box blank to use the default shown. Merge fields: <code className="font-mono">{"{first_name}"}</code>,
          and in the follow-up <code className="font-mono">{"{missing}"}</code> (e.g. &quot;email ID and
          qualification&quot;). When the qualification is missing, tap-to-answer buttons for your qualification list are
          added.
        </p>
        <Field label="First reply">
          <textarea rows={3} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder={s?.defaults.intro} className={textarea} />
        </Field>
        <Field label="Follow-up (when they gave some details)">
          <textarea rows={2} value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder={s?.defaults.followUp} className={textarea} />
        </Field>
        <Field label="Thank-you (everything received)">
          <textarea rows={2} value={thanks} onChange={(e) => setThanks(e.target.value)} placeholder={s?.defaults.thanks} className={textarea} />
        </Field>
        <button type="button" className={primary} disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>

      <div className={card + " overflow-hidden"}>
        <div className="flex flex-wrap items-center justify-between gap-base px-lg py-md border-b border-outline-variant">
          <div>
            <h3 className="text-h3 text-on-surface">Recent Instagram contacts</h3>
            <p className="text-label-sm text-on-surface-variant">
              {s?.stats.contacts ?? 0} contacts · {s?.stats.leadsCreated ?? 0} new leads · {s?.stats.leadsLinked ?? 0}{" "}
              matched to existing leads · {s?.stats.inbound24h ?? 0} DMs in the last 24 h · {s?.stats.autoSent ?? 0} auto
              replies sent
            </p>
          </div>
          <button type="button" className={ghost} disabled={loading} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {s && s.recent.length === 0 ? (
          <p className="px-lg py-md text-label-sm text-on-surface-variant">
            No DMs received yet. Send a test DM to the account from a personal Instagram account and refresh.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container-low text-on-surface-variant text-label-sm">
                <tr>
                  <th className="text-left px-md py-sm">Contact</th>
                  <th className="text-left px-md py-sm">Details found</th>
                  <th className="text-left px-md py-sm">Lead</th>
                  <th className="text-left px-md py-sm">Auto-ask</th>
                  <th className="text-left px-md py-sm">Last message</th>
                </tr>
              </thead>
              <tbody>
                {s?.recent.map((r) => (
                  <tr key={r.id} className="border-t border-outline-variant align-top">
                    <td className="px-md py-sm">
                      <div className="text-on-surface">{r.name ?? (r.username ? `@${r.username}` : "Unknown")}</div>
                      {r.username && r.name && <div className="text-label-sm text-on-surface-variant">@{r.username}</div>}
                    </td>
                    <td className="px-md py-sm text-label-sm">
                      <div>{r.phoneE164 ?? <span className="text-on-surface-variant">no phone</span>}</div>
                      <div>{r.email ?? <span className="text-on-surface-variant">no email</span>}</div>
                      <div>{r.qualification ?? <span className="text-on-surface-variant">no qualification</span>}</div>
                    </td>
                    <td className="px-md py-sm text-label-sm">
                      {r.leadId ? (
                        <>
                          <Link href={`/crm/leads/${r.leadId}`} className="text-primary hover:underline">
                            {r.leadName ?? "Open lead"}
                          </Link>
                          <div className="text-on-surface-variant">{r.leadCreated ? "New lead" : "Existing lead (re-inquiry)"}</div>
                        </>
                      ) : (
                        <span className="text-on-surface-variant">No lead yet</span>
                      )}
                    </td>
                    <td className="px-md py-sm text-label-sm">{autoAskLabel(r)}</td>
                    <td className="px-md py-sm text-label-sm max-w-[320px]">
                      <div className="truncate" title={r.lastMessage ?? ""}>
                        {r.lastMessage ?? "—"}
                      </div>
                      <div className="text-on-surface-variant">{ago(r.lastInboundAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
