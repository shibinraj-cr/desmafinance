"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Section } from "@/components/Cards";
import type { AutomationStatus } from "@/lib/bank/status";
import { Modal, Notice, StatusChip, api, day, inputCls, money, primaryBtn, secondaryBtn, time, when } from "./_ui";

type Run = {
  id: string;
  trigger: string;
  status: string;
  phase: string | null;
  fromDate: string | null;
  toDate: string | null;
  testResult: {
    steps?: Array<{ step: string; ok: boolean; message: string }>;
    preview?: {
      statementDate: string | null;
      transactions: number;
      totalDebit: number;
      totalCredit: number;
      openingBalance: number | null;
      closingBalance: number | null;
      errors: string[];
      warnings: string[];
      alreadyImported: boolean;
      sample: Array<{ date: string; description: string; debit: number; credit: number; balance: number | null }>;
    } | null;
  } | null;
  transactionsCreated: number;
  transactionsSkipped: number;
  errorSummary: string | null;
  events: Array<{ id: string; level: string; step: string; message: string; createdAt: string }>;
  statements: Array<{ id: string; periodStart: string | null; periodEnd: string | null; status: string; insertedCount: number | null; duplicateCount: number | null; transactionCount: number | null; lastError: string | null }>;
};

const ACTIVE = new Set(["QUEUED", "RUNNING"]);

const GMAIL_MESSAGES: Record<string, { tone: "ok" | "error" | "warn"; text: string }> = {
  connected: { tone: "ok", text: "Gmail connected." },
  denied: { tone: "warn", text: "Google access was not granted." },
  bad_state: { tone: "error", text: "The Google sign-in could not be verified — try connecting again." },
  no_refresh_token: { tone: "error", text: "Google did not return offline access. Remove DesGro from the Google account's third-party access, then connect again." },
  exchange_failed: { tone: "error", text: "Google sign-in failed. Check the OAuth client settings." },
  wrong_mailbox: { tone: "error", text: "That Google account is not the mailbox configured to receive the statements. Connect the correct account." },
  not_configured: { tone: "error", text: "Google OAuth is not configured on the server (BANK_GOOGLE_CLIENT_ID / SECRET)." },
  no_email: { tone: "error", text: "Google did not return the mailbox address." },
  bad_request: { tone: "error", text: "Could not start the Google sign-in." },
};

export function AutomationView({ initial, canManage }: { initial: AutomationStatus; canManage: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState(initial);
  const [runId, setRunId] = useState<string | null>(initial.activeRunId);
  const [run, setRun] = useState<Run | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn" | "info"; text: string } | null>(() => {
    const g = search.get("gmail");
    return g ? (GMAIL_MESSAGES[g] ?? null) : null;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"backfill" | "password" | null>(null);
  const i = status.integration;
  const c = status.connection;
  const s = status.stats;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<AutomationStatus>(`/api/finance/bank-automation/status?integrationId=${i.id}`, "GET"));
    } catch {
      /* keep showing the last figures */
    }
  }, [i.id]);

  useEffect(() => setStatus(initial), [initial]);

  // Live progress: poll the run until it settles, then refresh the figures.
  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<Run>(`/api/finance/bank-automation/runs/${runId}`, "GET");
        if (stop) return;
        setRun(r);
        if (!ACTIVE.has(r.status)) {
          stop = true;
          await refreshStatus();
          router.refresh();
          return;
        }
      } catch {
        /* transient — try again */
      }
      if (!stop) setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [runId, refreshStatus, router]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(null);
    }
  };

  const start = (key: string, url: string, body: Record<string, unknown> = {}) =>
    act(key, async () => {
      const r = await api<{ runId: string; existing?: boolean }>(url, "POST", { integrationId: i.id, ...body });
      setRun(null);
      setRunId(r.runId);
      if (r.existing) setMsg({ tone: "info", text: "A run was already in progress — showing it." });
      setModal(null);
    });

  const save = (data: Record<string, unknown>, okText = "Settings saved.") =>
    act("save", async () => {
      await api("/api/finance/bank-automation/settings", "PATCH", { integrationId: i.id, ...data });
      await refreshStatus();
      setMsg({ tone: "ok", text: okText });
    });

  const running = !!run && ACTIVE.has(run.status);

  return (
    <div className="space-y-lg">
      {msg && <Notice tone={msg.tone === "info" ? "info" : msg.tone}>{msg.text}</Notice>}
      {!c.archiveConfigured && <Notice tone="warn">The private file store (BLOB_READ_WRITE_TOKEN) is not configured — statement PDFs cannot be archived.</Notice>}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter">
        <Tile label="Account" value={`${i.bankName} ${i.masked}`} hint={i.accountName} />
        <Tile
          label="Connection"
          value={c.connected ? "Connected" : "Disconnected"}
          tone={c.connected && !c.lastError ? "ok" : "bad"}
          hint={c.connected ? (c.lastError ? `Error: ${c.lastError.slice(0, 80)}` : (c.mailbox ?? "")) : "Connect the statement mailbox below"}
        />
        <Tile
          label="Automation"
          value={i.automationEnabled ? "Active" : "Paused"}
          tone={i.automationEnabled ? "ok" : "warn"}
          hint={s.nextRun ? `Next run ${s.nextRun.date === new Date().toISOString().slice(0, 10) ? "today" : day(s.nextRun.date)} · ${s.nextRun.time} IST` : "No scheduled runs while paused"}
        />
        <Tile label="Last statement date" value={day(s.lastStatementDate)} hint={`Received ${when(s.lastStatementReceivedAt)}`} />
        <Tile label="Last Gmail check" value={when(s.lastEmailCheckedAt)} />
        <Tile label="Last successful import" value={when(s.lastSuccessfulSyncAt)} />
        <Tile label="Imported today" value={s.importedToday.toLocaleString("en-IN")} hint={`${s.monthProcessed} statement${s.monthProcessed === 1 ? "" : "s"} processed this month`} />
        <Tile
          label="Need attention"
          value={(s.failed + s.review).toLocaleString("en-IN")}
          tone={s.failed + s.review ? "bad" : "ok"}
          hint={`${s.failed} failed · ${s.review} awaiting review`}
        />
      </section>

      {canManage && (
        <div className="flex flex-wrap gap-sm">
          <button type="button" className={primaryBtn} disabled={!!busy || running || !c.connected} onClick={() => start("run", "/api/finance/bank-automation/run")}>
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>Run now
          </button>
          <button type="button" className={secondaryBtn} disabled={!!busy || running || !c.connected} onClick={() => setModal("backfill")}>
            <span className="material-symbols-outlined text-[18px]">history</span>Backfill
          </button>
          <button
            type="button"
            className={secondaryBtn}
            disabled={!!busy || !c.connected}
            onClick={() =>
              act("gmail", async () => {
                const r = await api<{ ok: boolean; mailbox?: string; matched?: number; latest?: { receivedAt: string; period: string | null; hasLink: boolean; hasAttachment: boolean } | null; message?: string }>(
                  "/api/finance/bank-automation/test-email",
                  "POST",
                  { integrationId: i.id },
                );
                setMsg(
                  r.ok
                    ? {
                        tone: r.matched ? "ok" : "warn",
                        text: `Gmail OK (${r.mailbox}). ${r.matched} statement e-mail${r.matched === 1 ? "" : "s"} in the last 30 days${
                          r.latest ? ` — latest ${when(r.latest.receivedAt)}${r.latest.period ? ` for ${r.latest.period}` : ""}, ${r.latest.hasLink ? "statement link found" : r.latest.hasAttachment ? "PDF attached" : "NO link or attachment"}` : ""
                        }.`,
                      }
                    : { tone: "error", text: r.message ?? "Gmail test failed" },
                );
              })
            }
          >
            <span className="material-symbols-outlined text-[18px]">mark_email_read</span>
            {busy === "gmail" ? "Testing…" : "Test Gmail"}
          </button>
          <button type="button" className={secondaryBtn} disabled={!!busy || running || !c.connected} onClick={() => start("test", "/api/finance/bank-automation/test-statement-access")}>
            <span className="material-symbols-outlined text-[18px]">science</span>Test {i.bankName.replace(/ Bank$/, "")} statement access
          </button>
          <button
            type="button"
            className={secondaryBtn}
            disabled={!!busy}
            onClick={() => save({ automationEnabled: !i.automationEnabled }, i.automationEnabled ? "Automation paused." : "Automation resumed.")}
          >
            <span className="material-symbols-outlined text-[18px]">{i.automationEnabled ? "pause" : "play_circle"}</span>
            {i.automationEnabled ? "Pause automation" : "Resume automation"}
          </button>
          <a className={secondaryBtn} href="#bank-settings">
            <span className="material-symbols-outlined text-[18px]">settings</span>Settings
          </a>
        </div>
      )}

      {run && <RunPanel run={run} />}

      {canManage && (
        <>
          <Section title="Mailbox & credentials">
            <div className="grid md:grid-cols-2 gap-lg">
              <div className="space-y-sm">
                <h4 className="text-label-sm font-semibold">Gmail</h4>
                {!c.oauthConfigured ? (
                  <Notice tone="warn">Google OAuth is not configured on the server. Set BANK_GOOGLE_CLIENT_ID and BANK_GOOGLE_CLIENT_SECRET.</Notice>
                ) : c.connected ? (
                  <>
                    <p className="text-body-md">
                      Reading <b>{c.mailbox}</b> (read-only{c.sheetsAccess ? ", plus Google Sheets" : ""}).
                    </p>
                    <div className="flex flex-wrap gap-sm">
                      <a className={secondaryBtn} href={`/api/finance/bank-automation/gmail/connect?integrationId=${i.id}${i.sheetSyncEnabled ? "&sheets=1" : ""}`}>
                        Reconnect
                      </a>
                      <button
                        type="button"
                        className={secondaryBtn}
                        disabled={!!busy}
                        onClick={() =>
                          confirm("Disconnect Gmail? The automation stops until it is reconnected.") &&
                          act("disc", async () => {
                            await api("/api/finance/bank-automation/gmail/disconnect", "POST", { integrationId: i.id });
                            await refreshStatus();
                          })
                        }
                      >
                        Disconnect
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-body-md text-on-surface-variant">
                      Connect {i.emailRecipient ? <b>{i.emailRecipient}</b> : "the mailbox that receives the statements"} with read-only access.
                    </p>
                    <a className={primaryBtn} href={`/api/finance/bank-automation/gmail/connect?integrationId=${i.id}`}>
                      Connect Gmail
                    </a>
                  </>
                )}
                <dl className="text-caption text-on-surface-variant space-y-[2px] pt-sm">
                  <div>
                    <dt className="inline font-semibold">Sender: </dt>
                    <dd className="inline text-data-mono">{i.emailSender}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Subject contains: </dt>
                    <dd className="inline">{i.emailSubjectPattern}</dd>
                  </div>
                </dl>
              </div>
              <div className="space-y-sm">
                <h4 className="text-label-sm font-semibold">Statement password</h4>
                <p className="text-body-md">
                  <span className="tracking-widest">••••••••</span>{" "}
                  <span className="text-on-surface-variant">
                    {c.password.configured
                      ? c.password.source === "env"
                        ? `from deployment secret ${c.password.envName}`
                        : `stored encrypted · updated ${when(c.password.updatedAt)}`
                      : c.password.source === "env"
                        ? `not set — ${c.password.envName} is empty`
                        : "not set"}
                  </span>
                </p>
                {!c.password.configured && <Notice tone="warn">Without the statement password the bank page cannot be opened.</Notice>}
                <div className="flex flex-wrap gap-sm">
                  <button type="button" className={secondaryBtn} onClick={() => setModal("password")}>
                    Update password
                  </button>
                  {c.password.source === "db" && (
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={!!busy}
                      onClick={() =>
                        act("pwclear", async () => {
                          await api("/api/finance/bank-automation/password", "DELETE", { integrationId: i.id });
                          await refreshStatus();
                          setMsg({ tone: "ok", text: "Stored password removed — the deployment secret is used now." });
                        })
                      }
                    >
                      Use deployment secret
                    </button>
                  )}
                </div>
                <p className="text-caption text-on-surface-variant">The password is never shown again, logged, or sent to the browser.</p>
              </div>
            </div>
          </Section>

          <SettingsForm status={status} busy={!!busy} onSave={(d) => save(d)} onSync={() =>
            act("sync", async () => {
              const r = await api<{ ok: boolean; appended?: number; alreadyPresent?: number; message?: string }>("/api/finance/bank-automation/sheets-sync", "POST", { integrationId: i.id });
              await refreshStatus();
              setMsg(r.ok ? { tone: "ok", text: `Sheet synced — ${r.appended} row(s) added, ${r.alreadyPresent} already there.` } : { tone: "error", text: r.message ?? "Sheet sync failed" });
            })
          } />
        </>
      )}

      {modal === "backfill" && <BackfillDialog busy={busy === "backfill"} onClose={() => setModal(null)} onStart={(from, to) => start("backfill", "/api/finance/bank-automation/backfill", { from, to })} />}
      {modal === "password" && (
        <PasswordDialog
          onClose={() => setModal(null)}
          onSave={(password) =>
            act("pw", async () => {
              await api("/api/finance/bank-automation/password", "POST", { integrationId: i.id, password });
              await refreshStatus();
              setModal(null);
              setMsg({ tone: "ok", text: "Statement password updated." });
            })
          }
        />
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-green-700" : tone === "warn" ? "text-amber-800" : tone === "bad" ? "text-error" : "text-on-surface";
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-md">
      <div className="text-caption uppercase tracking-wide text-on-surface-variant font-semibold">{label}</div>
      <div className={`text-h3 font-bold mt-xs ${color}`}>{value}</div>
      {hint && <div className="text-caption text-on-surface-variant mt-xs truncate" title={hint}>{hint}</div>}
    </div>
  );
}

function RunPanel({ run }: { run: Run }) {
  const active = ACTIVE.has(run.status);
  const steps = run.testResult?.steps ?? [];
  const preview = run.testResult?.preview ?? null;
  return (
    <Section
      title={run.trigger === "TEST" ? "Connection test" : run.trigger === "BACKFILL" ? `Backfill ${day(run.fromDate)} → ${day(run.toDate)}` : "Statement import"}
      action={<StatusChip status={run.status} />}
    >
      <div className="space-y-md">
        <p className="flex items-center gap-sm text-body-md font-semibold" aria-live="polite">
          {active && <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>}
          {run.phase ?? (active ? "Working…" : "")}
        </p>

        {run.trigger === "TEST" ? (
          <>
            <ol className="space-y-xs">
              {steps.map((st, idx) => (
                <li key={idx} className="flex gap-sm text-body-md">
                  <span className={`material-symbols-outlined text-[18px] ${st.ok ? "text-green-700" : "text-error"}`}>{st.ok ? "check_circle" : "cancel"}</span>
                  <span>
                    <b className="capitalize">Step {idx + 1}</b> — {st.message}
                  </span>
                </li>
              ))}
            </ol>
            {preview && (
              <div className="border border-outline-variant rounded-lg p-md space-y-sm">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-md text-body-md">
                  <Stat label="Statement detected" value={day(preview.statementDate)} />
                  <Stat label="Transactions found" value={String(preview.transactions)} />
                  <Stat label="Total debit" value={money(preview.totalDebit)} />
                  <Stat label="Total credit" value={money(preview.totalCredit)} />
                  <Stat label="Closing balance" value={money(preview.closingBalance)} />
                </div>
                {preview.errors.length > 0 && <Notice tone="warn">Would be held for review: {preview.errors.slice(0, 3).join(" · ")}</Notice>}
                {preview.alreadyImported && <p className="text-caption text-on-surface-variant">This statement has already been imported.</p>}
                <p className="text-caption text-on-surface-variant">Preview only — nothing was saved. Use Run now to import.</p>
                {preview.sample.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-caption">
                      <tbody className="divide-y divide-outline-variant">
                        {preview.sample.map((r, k) => (
                          <tr key={k}>
                            <td className="py-xs pr-sm whitespace-nowrap">{day(r.date)}</td>
                            <td className="py-xs pr-sm">{r.description}</td>
                            <td className="py-xs pr-sm text-right text-error whitespace-nowrap">{r.debit ? money(r.debit) : ""}</td>
                            <td className="py-xs pr-sm text-right text-green-700 whitespace-nowrap">{r.credit ? money(r.credit) : ""}</td>
                            <td className="py-xs text-right whitespace-nowrap">{money(r.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          run.statements.length > 0 && (
            <ul className="divide-y divide-outline-variant border border-outline-variant rounded-lg">
              {run.statements.map((st) => (
                <li key={st.id} className="flex items-center justify-between gap-sm px-md py-sm text-body-md">
                  <span className="font-semibold w-28">{day(st.periodEnd)}</span>
                  <StatusChip status={st.status} title={st.lastError ?? undefined} />
                  <span className="flex-1 text-right text-on-surface-variant truncate">
                    {st.insertedCount !== null
                      ? `${st.insertedCount} transaction${st.insertedCount === 1 ? "" : "s"}${st.duplicateCount ? ` · ${st.duplicateCount} duplicate${st.duplicateCount === 1 ? "" : "s"} skipped` : ""}`
                      : (st.lastError ?? "")}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}

        {run.events.length > 0 && (
          <details open={active}>
            <summary className="cursor-pointer text-label-sm font-semibold text-on-surface-variant">Event log ({run.events.length})</summary>
            <ol className="mt-sm space-y-[2px] max-h-64 overflow-y-auto">
              {run.events.map((e) => (
                <li key={e.id} className={`flex gap-sm text-body-md ${e.level === "error" ? "text-red-700" : e.level === "warn" ? "text-amber-800" : ""}`}>
                  <span className="text-data-mono text-caption text-on-surface-variant w-[64px] flex-shrink-0">{time(e.createdAt)}</span>
                  <span className="break-words">{e.message}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption text-on-surface-variant">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}

function SettingsForm({
  status,
  busy,
  onSave,
  onSync,
}: {
  status: AutomationStatus;
  busy: boolean;
  onSave: (d: Record<string, unknown>) => void;
  onSync: () => void;
}) {
  const i = status.integration;
  const [f, setF] = useState({
    runTime: i.runTime,
    lookbackDays: i.lookbackDays,
    alertAfterBusinessDays: i.alertAfterBusinessDays,
    browserAutomationEnabled: i.browserAutomationEnabled,
    pdfArchiveEnabled: i.pdfArchiveEnabled,
    failureScreenshots: i.failureScreenshots,
    sheetSyncEnabled: i.sheetSyncEnabled,
    sheetId: i.sheetId ?? "",
    sheetTab: i.sheetTab,
    emailRecipient: i.emailRecipient ?? "",
  });
  const check = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="flex items-start gap-sm">
      <input type="checkbox" className="mt-1" checked={f[k] as boolean} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      <span>
        <span className="text-body-md font-semibold">{label}</span>
        {hint && <span className="block text-caption text-on-surface-variant">{hint}</span>}
      </span>
    </label>
  );
  return (
    <Section title="Settings" className="scroll-mt-24">
      <form
        id="bank-settings"
        className="space-y-lg"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(f);
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-md">
          <label className="space-y-xs">
            <span className="text-label-sm font-semibold">Frequency</span>
            <input className={inputCls} value="Daily" disabled />
          </label>
          <label className="space-y-xs">
            <span className="text-label-sm font-semibold">Execution time (Asia/Kolkata)</span>
            <input type="time" className={inputCls} value={f.runTime} onChange={(e) => setF({ ...f, runTime: e.target.value })} required />
          </label>
          <label className="space-y-xs">
            <span className="text-label-sm font-semibold">Lookback (days)</span>
            <input type="number" min={1} max={30} className={inputCls} value={f.lookbackDays} onChange={(e) => setF({ ...f, lookbackDays: Number(e.target.value) })} />
          </label>
          <label className="space-y-xs">
            <span className="text-label-sm font-semibold">Alert after (business days without a statement)</span>
            <input type="number" min={1} max={15} className={inputCls} value={f.alertAfterBusinessDays} onChange={(e) => setF({ ...f, alertAfterBusinessDays: Number(e.target.value) })} />
          </label>
        </div>
        <label className="block space-y-xs max-w-md">
          <span className="text-label-sm font-semibold">Statement mailbox</span>
          <input type="email" className={inputCls} value={f.emailRecipient} onChange={(e) => setF({ ...f, emailRecipient: e.target.value })} />
        </label>
        <div className="grid md:grid-cols-3 gap-md">
          {check("browserAutomationEnabled", "Browser automation", "Open the bank's statement link to fetch the PDF. Off: upload PDFs by hand.")}
          {check("pdfArchiveEnabled", "Archive original PDFs", "Keep every statement PDF privately for audit.")}
          {check("failureScreenshots", "Failure screenshots", "Save a private screenshot when the bank page fails. May show transactions.")}
        </div>
        <div className="border-t border-outline-variant pt-md space-y-md">
          {check("sheetSyncEnabled", "Sync to Google Sheets", "Optional reporting copy. DesGro stays the source of truth; rows are never duplicated.")}
          {f.sheetSyncEnabled && (
            <div className="grid md:grid-cols-3 gap-md">
              <label className="space-y-xs md:col-span-2">
                <span className="text-label-sm font-semibold">Google Sheet ID or URL</span>
                <input className={inputCls} value={f.sheetId} onChange={(e) => setF({ ...f, sheetId: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" />
              </label>
              <label className="space-y-xs">
                <span className="text-label-sm font-semibold">Tab name</span>
                <input className={inputCls} value={f.sheetTab} onChange={(e) => setF({ ...f, sheetTab: e.target.value })} />
              </label>
              {!status.connection.sheetsAccess && status.connection.connected && (
                <div className="md:col-span-3">
                  <Notice tone="warn">
                    The Google connection has no Sheets access.{" "}
                    <a className="underline font-semibold" href={`/api/finance/bank-automation/gmail/connect?integrationId=${i.id}&sheets=1`}>
                      Reconnect with Sheets access
                    </a>
                    .
                  </Notice>
                </div>
              )}
              <p className="text-caption text-on-surface-variant md:col-span-3">
                Last sync {when(i.lastSheetSyncAt)}
                {i.lastSheetSyncError ? ` · error: ${i.lastSheetSyncError}` : ""}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-sm">
          {i.sheetSyncEnabled && (
            <button type="button" className={secondaryBtn} disabled={busy} onClick={onSync}>
              Sync sheet now
            </button>
          )}
          <button className={primaryBtn} disabled={busy}>
            Save settings
          </button>
        </div>
      </form>
    </Section>
  );
}

function BackfillDialog({ busy, onClose, onStart }: { busy: boolean; onClose: () => void; onStart: (from: string, to: string) => void }) {
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  return (
    <Modal title="Backfill statements" subtitle="Imports every statement e-mail covering these dates, oldest first." onClose={onClose}>
      <div className="grid grid-cols-2 gap-md">
        <label className="space-y-xs">
          <span className="text-label-sm font-semibold">From date</span>
          <input type="date" className={inputCls} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-xs">
          <span className="text-label-sm font-semibold">To date</span>
          <input type="date" className={inputCls} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <p className="text-caption text-on-surface-variant">
        Safe to repeat: statements and transactions already imported are skipped, so running the same backfill twice adds nothing. A day that fails does not stop
        the others — retry it from the Statements tab.
      </p>
      <div className="flex justify-end gap-sm">
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={primaryBtn} disabled={busy || !from || !to || from > to} onClick={() => onStart(from, to)}>
          {busy ? "Starting…" : "Run backfill"}
        </button>
      </div>
    </Modal>
  );
}

function PasswordDialog({ onClose, onSave }: { onClose: () => void; onSave: (password: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <Modal title="Update statement password" subtitle="Stored encrypted. It cannot be viewed again — only replaced." onClose={onClose}>
      <form
        className="space-y-md"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) onSave(pw);
        }}
      >
        <input type="password" autoComplete="new-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Statement password" autoFocus />
        <div className="flex justify-end gap-sm">
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={primaryBtn} disabled={!pw}>
            Save password
          </button>
        </div>
      </form>
    </Modal>
  );
}
