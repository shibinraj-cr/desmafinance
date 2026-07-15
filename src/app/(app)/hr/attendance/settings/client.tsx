"use client";

import { useEffect, useState } from "react";

type Cfg = {
  configured: boolean;
  cutover: string;
  baseUrl: string;
  corpId: string;
  username: string;
  empcode: string;
  authMode: string;
  passwordSet: boolean;
  envAuthHeader: boolean;
  envAuthRaw: boolean;
  envFallback: boolean;
  cronConfigured: boolean;
  defaultBaseUrl: string;
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const btn = "h-9 px-md rounded-lg text-label-sm font-semibold transition disabled:opacity-60";
const primary = btn + " bg-primary text-on-primary hover:bg-primary-container";
const ghost = btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low";
const danger = btn + " border border-error/40 text-error hover:bg-error/10";
const inputCls =
  "w-full h-9 px-md rounded-lg border border-outline-variant bg-surface-container-low text-body-md";
const label = "text-label-sm text-on-surface-variant mb-xs block";

export function EtimeSettingsClient() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "test" | "clear">(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);

  // Editable form fields (password is write-only — never populated from server).
  const [baseUrl, setBaseUrl] = useState("");
  const [corpId, setCorpId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [empcode, setEmpcode] = useState("ALL");
  const [authMode, setAuthMode] = useState("corp-user-pass");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/hr/attendance/etime-settings");
    if (r.ok) {
      const d = (await r.json()) as Cfg;
      setCfg(d);
      setBaseUrl(d.baseUrl || d.defaultBaseUrl);
      setCorpId(d.corpId);
      setUsername(d.username);
      setEmpcode(d.empcode || "ALL");
      setAuthMode(d.authMode || "corp-user-pass");
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  function payload() {
    return { baseUrl, corpId, username, password, empcode, authMode };
  }

  async function save() {
    setBusy("save");
    setMsg(null);
    const r = await fetch("/api/hr/attendance/etime-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save", ...payload() }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) {
      setMsg({ tone: "err", text: j.error || "Save failed" });
      return;
    }
    setPassword("");
    setMsg({ tone: "ok", text: j.configured ? "Saved. Credentials are stored." : "Saved (still incomplete)." });
    await load();
  }

  async function test() {
    setBusy("test");
    setMsg({ tone: "info", text: "Contacting eTimeOffice…" });
    const r = await fetch("/api/hr/attendance/etime-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test", ...payload() }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    setMsg(r.ok ? { tone: "ok", text: j.message || "Connected." } : { tone: "err", text: j.error || "Test failed" });
  }

  async function clear() {
    if (!confirm("Remove the stored eTimeOffice credentials? The sync will stop until re-entered.")) return;
    setBusy("clear");
    setMsg(null);
    const r = await fetch("/api/hr/attendance/etime-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });
    setBusy(null);
    if (r.ok) {
      setPassword("");
      setMsg({ tone: "info", text: "Credentials cleared." });
      await load();
    }
  }

  return (
    <section className={card + " p-lg space-y-md max-w-3xl"}>
      <div className="flex items-start justify-between gap-base">
        <div>
          <h3 className="text-h3 text-on-surface">eTimeOffice biometric cloud</h3>
          <p className="text-label-sm text-on-surface-variant">
            Auto-fetch in/out punches into HR attendance. Data before{" "}
            <span className="font-semibold">{cfg?.cutover ?? "the cutover"}</span> is never modified by the
            sync.
          </p>
        </div>
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 28 }}>
          fingerprint
        </span>
      </div>

      {loading && <p className="text-body-md text-on-surface-variant">Loading…</p>}

      {cfg && (
        <>
          {/* Status row */}
          <div className="flex flex-wrap items-center gap-xs">
            {cfg.configured ? (
              <span className="px-sm py-[2px] rounded-full text-[11px] font-bold bg-green-100 text-green-800">
                CONFIGURED
              </span>
            ) : (
              <span className="px-sm py-[2px] rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                NOT CONFIGURED
              </span>
            )}
            {cfg.envFallback && (
              <span className="px-sm py-[2px] rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
                USING ENV VARS
              </span>
            )}
            {(cfg.envAuthHeader || cfg.envAuthRaw) && (
              <span className="px-sm py-[2px] rounded-full text-[11px] font-bold bg-purple-100 text-purple-800">
                ENV AUTH OVERRIDE
              </span>
            )}
            <span
              className={
                "px-sm py-[2px] rounded-full text-[11px] font-bold " +
                (cfg.cronConfigured ? "bg-green-100 text-green-800" : "bg-surface-container text-on-surface-variant")
              }
              title="Whether CRON_SECRET is set, enabling the nightly automatic sync"
            >
              {cfg.cronConfigured ? "NIGHTLY CRON ON" : "NIGHTLY CRON OFF"}
            </span>
          </div>

          {/* Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
            <div className="sm:col-span-2">
              <label className={label}>API base URL</label>
              <input className={inputCls + " font-mono"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={cfg.defaultBaseUrl} />
            </div>
            <div>
              <label className={label}>Corporate ID</label>
              <input className={inputCls} value={corpId} onChange={(e) => setCorpId(e.target.value)} placeholder="e.g. DESMA" />
            </div>
            <div>
              <label className={label}>Username</label>
              <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className={label}>
                Password {cfg.passwordSet && <span className="text-green-700 font-semibold">· stored</span>}
              </label>
              <input
                className={inputCls}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={cfg.passwordSet ? "•••••••• (leave blank to keep)" : "Enter password"}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className={label}>Employee scope</label>
              <input className={inputCls} value={empcode} onChange={(e) => setEmpcode(e.target.value)} placeholder="ALL" />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Auth mode</label>
              <select className={inputCls} value={authMode} onChange={(e) => setAuthMode(e.target.value)}>
                <option value="corp-user-pass">Basic base64(CorpId:Username:Password) — default</option>
                <option value="user-pass">Basic base64(Username:Password)</option>
              </select>
              <p className="text-caption text-on-surface-variant mt-xs">
                Verify against your official eTimeOffice API document. If neither mode matches, use the
                <span className="font-mono"> ETIMEOFFICE_AUTH_HEADER</span> /{" "}
                <span className="font-mono">ETIMEOFFICE_AUTH_RAW</span> env var to paste the exact header.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-base pt-xs">
            <button className={primary} disabled={busy !== null} onClick={save}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button className={ghost} disabled={busy !== null} onClick={test}>
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            <button className={danger + " ml-auto"} disabled={busy !== null || !cfg.configured} onClick={clear}>
              Clear credentials
            </button>
          </div>

          {msg && (
            <div
              className={
                "rounded-lg p-sm text-label-sm " +
                (msg.tone === "ok"
                  ? "bg-green-50 text-green-800"
                  : msg.tone === "err"
                    ? "bg-red-50 text-red-800"
                    : "bg-surface-container text-on-surface")
              }
            >
              {msg.text}
            </div>
          )}

          <p className="text-caption text-on-surface-variant border-t border-outline-variant pt-md">
            Once configured, use <span className="font-semibold">Sync from eTimeOffice</span> on the{" "}
            <a className="text-primary underline" href="/hr/attendance">
              Attendance
            </a>{" "}
            page for an immediate pull, or let the nightly cron keep it current. The Corporate ID, Username
            and Employee scope can also be set via <span className="font-mono">ETIMEOFFICE_*</span> env vars;
            values saved here take precedence.
          </p>
        </>
      )}
    </section>
  );
}
