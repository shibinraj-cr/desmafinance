"use client";

import { useCallback, useEffect, useState } from "react";

type Remarketing = {
  enabled: boolean;
  urls: string[];
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
  const [urls, setUrls] = useState<string[]>(["", "", "", ""]);
  const [offsets, setOffsets] = useState("5,19,33");
  const [keywords, setKeywords] = useState("");
  const [inboundSecret, setInboundSecret] = useState("");

  const [testPhone, setTestPhone] = useState("");
  const [testTouch, setTestTouch] = useState(1);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [runBusy, setRunBusy] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const [enrolBusy, setEnrolBusy] = useState(false);
  const [enrolCount, setEnrolCount] = useState<number | null>(null);
  const [enrolCapped, setEnrolCapped] = useState(false);
  const [enrolMsg, setEnrolMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/integrations/wabis");
    if (r.ok) {
      const rm = ((await r.json()) as { remarketing: Remarketing }).remarketing;
      setEnabled(rm.enabled);
      setUrls([0, 1, 2, 3].map((i) => rm.urls[i] ?? ""));
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
      body: JSON.stringify({ action: "save_remarketing", enabled, urls, offsets, keywords, inboundSecret }),
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

  async function sendTest() {
    setTestBusy(true);
    setTestResult(null);
    const r = await fetch("/api/crm/integrations/wabis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test_remarketing", phone: testPhone, touch: testTouch }),
    });
    const p = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: number | null;
      body?: string;
      error?: string;
      message?: string;
    };
    setTestBusy(false);
    if (!r.ok) {
      setTestResult(p.message ?? p.error ?? "That didn't work.");
      return;
    }
    if (p.ok) {
      setTestResult(`Test touch ${testTouch} sent — Wabis replied ${p.status ?? "OK"}. Check that number for the WhatsApp.`);
    } else {
      setTestResult(p.error ?? `Test failed${p.status ? ` (HTTP ${p.status})` : ""}: ${p.body || "no response"}`);
    }
  }

  // Run the scheduler now — the same work the daily cron does, session-authed so
  // it needs no CRON_SECRET. Surfaces the result (touches sent, or why not) so a
  // stalled campaign stops being a black box: a `skipped` reason means the
  // feature is off; touchesSent: 0 with campaigns running means nothing is due.
  async function runNow() {
    setRunBusy(true);
    setRunResult(null);
    const r = await fetch("/api/crm/integrations/wabis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run_remarketing_now" }),
    });
    const p = (await r.json().catch(() => ({}))) as {
      scheduler?: { touchesSent?: number; completed?: number; stopped?: number; skipped?: string };
      drain?: { attempted?: number; sent?: number; errored?: number; skipped?: string };
      message?: string;
    };
    setRunBusy(false);
    if (!r.ok) {
      setRunResult(p.message ?? "That didn't work.");
      return;
    }
    const s = p.scheduler ?? {};
    if (s.skipped) {
      setRunResult(`Scheduler skipped: ${s.skipped}. Tick “Run re-marketing campaigns”, Save, then run again.`);
      return;
    }
    const d = p.drain ?? {};
    setRunResult(
      `Scheduler ran — ${s.touchesSent ?? 0} touch(es) enqueued, ${s.completed ?? 0} completed, ${s.stopped ?? 0} stopped. ` +
        `Delivery: ${d.sent ?? 0} sent / ${d.attempted ?? 0} attempted${d.errored ? `, ${d.errored} errored` : ""}. ` +
        `Check the lead's timeline for “Re-marketing touch … sent”.`,
    );
  }

  async function enrol(dryRun: boolean) {
    setEnrolBusy(true);
    setEnrolMsg(null);
    if (dryRun) {
      setEnrolCount(null);
      setEnrolCapped(false);
    }
    const r = await fetch("/api/crm/integrations/wabis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "enrol_remaining_remarketing", dryRun }),
    });
    const p = (await r.json().catch(() => ({}))) as {
      summary?: {
        eligible: number;
        opened: number;
        backdated: number;
        alreadyDue: number;
        capped: boolean;
        sample: { name: string; phone: string }[];
      };
      message?: string;
    };
    setEnrolBusy(false);
    if (!r.ok || !p.summary) {
      setEnrolMsg(p.message ?? "That didn't work.");
      return;
    }
    const s = p.summary;
    if (dryRun) {
      setEnrolCount(s.eligible);
      setEnrolCapped(s.capped);
      setEnrolMsg(
        s.eligible === 0
          ? "No un-touched Re-marketing leads — everyone eligible already has touch 1."
          : `${s.eligible} Re-marketing lead(s) have never been sent touch 1${s.capped ? " (first batch — re-run to enrol more)" : ""}. ` +
              `Sample: ${s.sample.map((x) => x.name || x.phone).slice(0, 5).join(", ")}${s.sample.length > 5 ? "…" : ""}.`,
      );
    } else {
      setEnrolCount(null);
      setEnrolMsg(
        `Enrolled — ${s.opened} campaign(s) opened, ${s.backdated} re-dated, ${s.alreadyDue} already due` +
          `${s.capped ? " (batch capped — Preview again to enrol the rest)" : ""}. ` +
          `Now click “Run re-marketing now” (up to 60 sent per click) to fire touch 1; touches 2–4 follow automatically.`,
      );
    }
  }

  return (
    <section className={card + " p-lg space-y-md"}>
      <div className="flex items-center justify-between gap-base">
        <div>
          <h3 className="text-h3 text-on-surface">Re-marketing nurturing (Wabis)</h3>
          <p className="text-label-sm text-on-surface-variant">
            When a lead enters the Re-marketing stage, send WhatsApp touch-points on a schedule. A candidate
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

          <div className="space-y-sm">
            <div className="text-label-sm text-on-surface-variant">
              Wabis workflow URL <span className="font-medium">per touch</span> — one Wabis workflow sends one template
              (no in-flow branching), so each touch needs its own webhook URL. Leave a touch blank to skip it. Timing
              comes from the offsets above.
            </div>
            {[0, 1, 2, 3].map((i) => (
              <label key={i} className="flex items-center gap-base">
                <span className="w-[64px] shrink-0 text-label-sm text-on-surface-variant">Touch {i + 1}</span>
                <input
                  className={input + " flex-1 font-mono"}
                  value={urls[i] ?? ""}
                  onChange={(e) => setUrls((prev) => prev.map((u, j) => (j === i ? e.target.value : u)))}
                  placeholder="https://bot.wabis.in/webhook/whatsapp-workflow/…"
                />
              </label>
            ))}
          </div>

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

          <div className="rounded-lg bg-surface-container-low border border-outline-variant px-md py-sm text-label-sm text-on-surface-variant">
            <span className="font-medium text-on-surface">Delivery status (recommended).</span> On each touch workflow&apos;s{" "}
            <span className="font-medium">delivered / read / failed</span> event, add an HTTP-API block pointing at{" "}
            <span className="font-mono">/api/crm/integrations/wabis/delivery-status</span> (same secret above), echoing{" "}
            <span className="font-mono">campaign_id</span> + <span className="font-mono">touch</span> (from the outbound
            payload), the <span className="font-mono">phone</span>, the <span className="font-mono">status</span>, and any{" "}
            <span className="font-mono">error_code</span>. A hard failure then stops that lead&apos;s remaining touches
            and lists it under <span className="font-medium">CRM → Campaign Delivery</span>; a 131026 also flags the
            number as undeliverable.
          </div>

          <div className="flex flex-wrap items-center justify-end gap-base">
            <button
              className={btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"}
              disabled={runBusy}
              onClick={runNow}
              title="Run the re-marketing scheduler immediately (same as the daily cron) — enqueues any due touch-point now."
            >
              {runBusy ? "Running…" : "Run re-marketing now"}
            </button>
            <button className={primary} disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save re-marketing"}
            </button>
          </div>
          {runResult && (
            <div className="rounded-lg bg-surface-container-lowest border border-outline-variant px-md py-sm text-label-sm text-on-surface-variant">
              {runResult}
            </div>
          )}

          {/* Bulk enrolment — touch every un-touched Re-marketing lead. Preview
              (count) first, then Enrol; the scheduler above does the sending. */}
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-sm">
            <div className="text-label-sm font-semibold text-on-surface">Enrol remaining Re-marketing leads into touch 1</div>
            <p className="text-label-sm text-on-surface-variant">
              Opens a campaign for every lead in the Re-marketing stage that has{" "}
              <span className="font-medium">never been sent touch 1</span> (skips anyone already touched, phone-less, or
              flagged undeliverable) and back-dates it so touch 1 is due now. Touches 2–4 then follow automatically while
              the lead stays in Re-marketing. <span className="font-medium">Preview</span> the count first — nothing
              sends until you click <span className="font-medium">Run re-marketing now</span> (up to 60 per click).
            </p>
            <div className="flex flex-wrap items-center gap-base">
              <button
                className={btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"}
                disabled={enrolBusy}
                onClick={() => enrol(true)}
              >
                {enrolBusy ? "Working…" : "Preview count"}
              </button>
              {enrolCount != null && enrolCount > 0 && (
                <button
                  className={primary}
                  disabled={enrolBusy}
                  onClick={() => enrol(false)}
                >
                  {enrolBusy ? "Enrolling…" : `Enrol ${enrolCount}${enrolCapped ? "+" : ""} lead(s)`}
                </button>
              )}
            </div>
            {enrolMsg && (
              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant px-md py-sm text-label-sm text-on-surface-variant">
                {enrolMsg}
              </div>
            )}
          </div>

          {/* Test send — proves the pipeline end-to-end AND lets Wabis capture the
              payload so you can map the template's variables. Uses the SAVED URL. */}
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-sm">
            <div className="text-label-sm font-semibold text-on-surface">Send a test touch</div>
            <p className="text-label-sm text-on-surface-variant">
              Fires a sample touch at the <span className="font-medium">saved</span> workflow URL — sends a real
              WhatsApp to the number below, and lets Wabis capture the payload so you can map the template variables.
            </p>
            <div className="flex flex-wrap items-center gap-base">
              <select
                className={input + " w-[120px]"}
                value={testTouch}
                onChange={(e) => setTestTouch(Number(e.target.value))}
                aria-label="Which touch to simulate"
              >
                <option value={1}>Touch 1</option>
                <option value={2}>Touch 2</option>
                <option value={3}>Touch 3</option>
                <option value={4}>Touch 4</option>
              </select>
              <input
                className={input + " w-[190px] font-mono"}
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="Test to (your mobile)"
                aria-label="Send the test touch to this number"
              />
              <button
                className={btn + " border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"}
                disabled={testBusy || !testPhone.trim()}
                onClick={sendTest}
              >
                {testBusy ? "Sending…" : "Send test touch"}
              </button>
            </div>
            {testResult && (
              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant px-md py-sm text-label-sm text-on-surface-variant">
                {testResult}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
