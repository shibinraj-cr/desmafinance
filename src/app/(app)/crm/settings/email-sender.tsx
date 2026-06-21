"use client";

import { useEffect, useState } from "react";

type Data = {
  configured: boolean;
  user: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  dailyCap: number;
  passSet: boolean;
  envFallback: boolean;
  from: string | null;
  quota: { used: number; cap: number; remaining: number } | null;
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const ghost = btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low";
const input =
  "w-full h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">
        {label}
        {hint && <span className="text-on-surface-variant/70 font-normal"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function EmailSenderCard() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "test" | "clear">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Editable form state.
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [dailyCap, setDailyCap] = useState(450);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/crm/email-settings");
    if (r.ok) {
      const d = (await r.json()) as Data;
      setData(d);
      setUser(d.user);
      setFromName(d.fromName);
      setFromAddress(d.fromAddress);
      setReplyTo(d.replyTo);
      setDailyCap(d.dailyCap);
      setPass(""); // never round-trips the stored password
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function post(action: "save" | "test" | "clear", extra?: Record<string, unknown>) {
    setBusy(action);
    setMsg(null);
    const r = await fetch("/api/crm/email-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, user, pass: pass || undefined, fromName, fromAddress, replyTo, dailyCap, ...extra }),
    });
    setBusy(null);
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; sentTo?: string; message?: string; error?: string };
    if (!r.ok) {
      setMsg({ kind: "err", text: d.message || d.error || "Something went wrong." });
      return;
    }
    if (action === "save") setMsg({ kind: "ok", text: "Saved." });
    if (action === "test") setMsg({ kind: "ok", text: `Test email sent to ${d.sentTo}. Check the inbox & Sent folder.` });
    if (action === "clear") setMsg({ kind: "ok", text: "Email sender removed." });
    setPass("");
    await load();
  }

  return (
    <section className={card + " p-lg space-y-md"}>
      <div className="flex items-center justify-between gap-base">
        <div>
          <h3 className="text-h3 text-on-surface">Email sender (Gmail)</h3>
          <p className="text-label-sm text-on-surface-variant">
            Send lead emails (single &amp; bulk) from a Gmail account. Each message is filed in that account&apos;s Sent
            folder and logged on the lead&apos;s timeline.
          </p>
        </div>
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 28 }}>
          forward_to_inbox
        </span>
      </div>

      {loading && <p className="text-body-md text-on-surface-variant">Loading…</p>}

      {data && (
        <>
          <div className="flex items-center gap-xs text-label-sm">
            <span className="text-on-surface-variant">Status:</span>
            {data.configured ? (
              <span className="px-xs py-[1px] rounded-full text-[10px] font-bold bg-green-100 text-green-800">CONFIGURED</span>
            ) : (
              <span className="px-xs py-[1px] rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">NOT SET UP</span>
            )}
            {data.envFallback && (
              <span className="px-xs py-[1px] rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">USING ENV VAR</span>
            )}
            {data.quota && (
              <span className="text-on-surface-variant">
                · {data.quota.used}/{data.quota.cap} sent in last 24h ({data.quota.remaining} left)
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
            <Field label="Gmail address" hint="the account that sends">
              <input className={input} type="email" value={user} placeholder="leads@yourdomain.com" onChange={(e) => setUser(e.target.value)} />
            </Field>
            <Field label="App Password" hint={data.passSet ? "saved — leave blank to keep" : "16-char Google App Password"}>
              <input
                className={input}
                type="password"
                value={pass}
                placeholder={data.passSet ? "••••••••••••••••" : "abcd efgh ijkl mnop"}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="From name" hint="shown to recipients">
              <input className={input} value={fromName} placeholder="DESMA" onChange={(e) => setFromName(e.target.value)} />
            </Field>
            <Field label="From address" hint="optional verified alias; defaults to the Gmail address">
              <input className={input} type="email" value={fromAddress} placeholder="(same as Gmail address)" onChange={(e) => setFromAddress(e.target.value)} />
            </Field>
            <Field label="Reply-To" hint="optional">
              <input className={input} type="email" value={replyTo} placeholder="(none)" onChange={(e) => setReplyTo(e.target.value)} />
            </Field>
            <Field label="Daily send cap" hint="stay under Gmail's limit (~500/day)">
              <input
                className={input}
                type="number"
                min={1}
                max={2000}
                value={dailyCap}
                onChange={(e) => setDailyCap(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </Field>
          </div>

          <details className="text-label-sm text-on-surface-variant">
            <summary className="cursor-pointer hover:text-on-surface">How to get an App Password</summary>
            <ol className="list-decimal pl-lg mt-xs space-y-[2px]">
              <li>Google Account → Security → turn on 2-Step Verification.</li>
              <li>Security → App passwords → create one for &quot;Mail&quot; → copy the 16-character code.</li>
              <li>Paste it above (spaces are fine), Save, then Send test.</li>
            </ol>
          </details>

          {msg && (
            <div className={"rounded-lg px-md py-sm text-label-sm " + (msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-error-container text-on-error-container")}>
              {msg.text}
            </div>
          )}

          <div className="flex items-center gap-base">
            <button className={primary} disabled={busy !== null} onClick={() => post("save")}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button className={ghost} disabled={busy !== null} onClick={() => post("test")}>
              {busy === "test" ? "Sending…" : "Send test"}
            </button>
            {data.configured && (
              <button
                className={ghost + " ml-auto text-error border-error/40 hover:bg-error/5"}
                disabled={busy !== null}
                onClick={() => {
                  if (confirm("Remove the email sender? Bulk and single email sending will stop working until reconfigured.")) void post("clear");
                }}
              >
                {busy === "clear" ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
