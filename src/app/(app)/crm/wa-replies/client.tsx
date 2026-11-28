"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MultiSelect } from "@/components/MultiSelect";
import { applyFilterPatch } from "@/lib/filter-params";
import {
  AGE_BUCKETS,
  DEFAULT_SLA_MINUTES,
  HOUR_MS,
  MINUTE_MS,
  NO_OWNER,
  SESSION_WINDOW_MS,
  SLA_OPTIONS,
  TRACKER_RANGES,
  ageBucket,
  bucketCounts,
  formatDuration,
  lateAnswers,
  ownerKeyOf,
  percent,
  slaLabel,
  sortWaiting,
  summarise,
  summariseByOwner,
  windowOpen,
  type AgeBucketKey,
  type ReplyTrackerData,
  type TrackerSummary,
} from "@/lib/wa/reply-tracker";

const PAGE = 50;
/** The page is a live monitor: re-read the server this often while the tab is visible. */
const AUTO_REFRESH_MS = 60_000;

type Tab = "waiting" | "bot" | "late";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * IST date/time by hand rather than toLocaleString: server and browser ship
 * different ICU data, and a one-character difference is a hydration mismatch.
 */
function fmtWhen(ts: number): string {
  const d = new Date(ts + 5.5 * HOUR_MS);
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
const n = (x: number) => x.toLocaleString("en-IN");

const TONE_TEXT = { green: "text-green-700", amber: "text-amber-700", red: "text-red-700" } as const;
const TONE_BAR = { green: "bg-green-500", amber: "bg-amber-400", red: "bg-red-500" } as const;

function Panel({ title, sub, children, className }: { title: string; sub?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={"rounded-xl border border-outline-variant bg-surface-container-lowest p-lg min-w-0 " + (className ?? "")}>
      <div className="flex flex-wrap items-baseline justify-between gap-base mb-md">
        <h3 className="text-body-lg font-semibold text-on-surface">{title}</h3>
        {sub && <span className="text-caption text-on-surface-variant">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Pill({ tone, children }: { tone: "red" | "amber" | "green" | "gray"; children: React.ReactNode }) {
  const cls = {
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-800",
    green: "bg-green-50 text-green-700",
    gray: "bg-surface-container text-on-surface-variant",
  }[tone];
  return <span className={"inline-flex items-center gap-xs whitespace-nowrap rounded-full px-base py-[2px] text-label-sm font-semibold " + cls}>{children}</span>;
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md min-w-0">
      <div className="text-label-sm text-on-surface-variant">{label}</div>
      <div className={"text-[28px] leading-tight font-bold tabular-nums " + (tone ? TONE_TEXT[tone] : "text-on-surface")}>{value}</div>
      {note && <div className="text-caption text-on-surface-variant mt-xs">{note}</div>}
    </div>
  );
}

/** How a share of on-time answers reads: green at 95%+, amber at 80%+, else red. */
function slaTone(s: TrackerSummary): "green" | "amber" | "red" | undefined {
  if (!s.slaBase) return undefined;
  const p = s.onTime / s.slaBase;
  return p >= 0.95 ? "green" : p >= 0.8 ? "amber" : "red";
}

function waitTone(ageMs: number, slaMs: number): "green" | "amber" | "red" {
  if (ageMs >= SESSION_WINDOW_MS) return "red";
  if (ageMs > slaMs) return "red";
  if (ageMs > slaMs / 2) return "amber";
  return "green";
}

export function ReplyTrackerClient({
  data,
  seesEveryone,
  initial,
}: {
  data: ReplyTrackerData;
  seesEveryone: boolean;
  initial: { slaMinutes: number; ownerKeys: string[]; tab: Tab };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [slaMinutes, setSlaMinutes] = useState(initial.slaMinutes);
  const [ownerKeys, setOwnerKeys] = useState(initial.ownerKeys);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [bucket, setBucket] = useState<AgeBucketKey | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const now = data.generatedAt;
  const slaMs = slaMinutes * MINUTE_MS;
  const person = (id: string | null) => (id ? data.people[id] ?? "Unknown user" : "No owner");

  // A live monitor: refresh while the tab is visible, and as soon as it comes back.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  function syncUrl(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(window.location.search);
    applyFilterPatch(params, patch);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }
  function pushRange(v: string) {
    const params = new URLSearchParams(window.location.search);
    applyFilterPatch(params, { range: v === "today" ? null : v });
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }
  function pickSla(m: number) {
    setSlaMinutes(m);
    syncUrl({ sla: m === DEFAULT_SLA_MINUTES ? null : String(m) });
  }
  function pickOwners(next: string[]) {
    setOwnerKeys(next);
    setLimit(PAGE);
    syncUrl({ owner: next });
  }
  function pickTab(next: Tab) {
    setTab(next);
    setLimit(PAGE);
    syncUrl({ tab: next === "waiting" ? null : next });
  }
  function pickBucket(b: AgeBucketKey) {
    setBucket((cur) => (cur === b ? null : b));
    setTab("waiting");
    setLimit(PAGE);
    syncUrl({ tab: null });
  }

  const view = useMemo(() => {
    const inOwners = (id: string | null) => !ownerKeys.length || ownerKeys.includes(ownerKeyOf(id));
    const waiting = sortWaiting(data.waiting.filter((w) => inOwners(w.ownerId)));
    const exchanges = data.exchanges.filter((e) => inOwners(e.ownerId));
    const bot = sortWaiting(data.botReplied.filter((b) => inOwners(b.ownerId)));
    const oldest = waiting[0] ?? null;
    return {
      waiting,
      bot,
      exchanges,
      oldestMs: oldest ? now - oldest.since : null,
      windowClosed: waiting.filter((w) => !windowOpen(w, now)).length,
      overSla: waiting.filter((w) => now - w.since > slaMs).length,
      buckets: bucketCounts(waiting, now),
      summary: summarise(exchanges, slaMs, now),
      late: lateAnswers(exchanges, slaMs),
      byOwner: summariseByOwner(data.waiting, data.exchanges, slaMs, now, data.botReplied).filter((o) => !ownerKeys.length || ownerKeys.includes(o.key)),
    };
  }, [data, ownerKeys, slaMs, now]);

  const waitingRows = bucket ? view.waiting.filter((w) => ageBucket(now - w.since) === bucket) : view.waiting;
  const s = view.summary;
  const rangeLabel = TRACKER_RANGES.find((r) => r.key === data.range.key)?.label ?? "";

  const ownerOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const w of data.waiting) keys.add(ownerKeyOf(w.ownerId));
    for (const e of data.exchanges) keys.add(ownerKeyOf(e.ownerId));
    for (const k of ownerKeys) keys.add(k);
    return [...keys]
      .map((k) => ({ value: k, label: k === NO_OWNER ? "No owner" : data.people[k] ?? "Unknown user" }))
      .sort((a, b) => (a.value === NO_OWNER ? -1 : b.value === NO_OWNER ? 1 : a.label.localeCompare(b.label)));
  }, [data, ownerKeys]);

  return (
    <div className="p-md md:p-margin flex flex-col gap-md">
      {/* Filters */}
      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <label className="flex items-center gap-base text-label-sm text-on-surface-variant">
            Messages received
            <select
              value={data.range.key}
              onChange={(e) => pushRange(e.target.value)}
              className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold"
            >
              {TRACKER_RANGES.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-base text-label-sm text-on-surface-variant">
            Target: reply within
            <select
              value={slaMinutes}
              onChange={(e) => pickSla(Number(e.target.value))}
              className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold"
            >
              {SLA_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {slaLabel(m)}
                </option>
              ))}
            </select>
          </label>
          {seesEveryone && (
            <MultiSelect options={ownerOptions} selected={ownerKeys} onChange={pickOwners} placeholder="Every consultant" icon="person" title="Chat owner" />
          )}
          <span className="flex-1" />
          <Link
            href="/crm/inbox?filter=needs_reply"
            className="inline-flex items-center gap-xs h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              forum
            </span>
            Inbox · Needs reply
          </Link>
        </div>
        <p className="text-caption text-on-surface-variant">
          As of {fmtWhen(now)} · refreshes every minute ·{" "}
          <button type="button" onClick={() => router.refresh()} className="text-accent hover:underline">
            Refresh now
          </button>
          {!seesEveryone && " · Showing your chats."} Answered = a person sent a WhatsApp reply after the candidate&apos;s message. Automated messages and calls don&apos;t count.
        </p>
        {data.truncated && (
          <p className="text-caption text-amber-800 bg-amber-50 rounded-lg px-sm py-xs">
            This period holds more messages than one page loads, so some totals may be short. Pick a shorter period.
          </p>
        )}
      </section>

      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-md">
        <Tile label="Waiting for a reply now" value={n(view.waiting.length)} tone={view.waiting.length ? "red" : "green"} note={
            (view.waiting.length ? `${n(view.overSla)} past the ${slaLabel(slaMinutes)} target` : "Every chat answered") +
            (view.bot.length ? ` · ${n(view.bot.length)} more got only a bot reply` : "")
          }
        />
        <Tile label="Longest wait" value={formatDuration(view.oldestMs)} tone={view.oldestMs === null ? undefined : waitTone(view.oldestMs, slaMs)} />
        <Tile label="24h passed · template only" value={n(view.windowClosed)} tone={view.windowClosed ? "red" : undefined} note="Free text can't be sent; use a template" />
        <Tile label={`Received · ${rangeLabel}`} value={n(s.received)} note={`${n(s.answered)} answered`} />
        <Tile label={`Answered within ${slaLabel(slaMinutes)}`} value={percent(s.onTime, s.slaBase)} tone={slaTone(s)} note={s.slaBase ? `${n(s.onTime)} of ${n(s.slaBase)}` : "Nothing to judge yet"} />
        <Tile label="Median reply time" value={formatDuration(s.medianMs)} note={s.p90Ms !== null ? `90% within ${formatDuration(s.p90Ms)}` : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-md">
        <Panel title="How long they have been waiting" sub="Click a bar to filter the list">
          <AgeBars counts={view.buckets} total={view.waiting.length} active={bucket} onPick={pickBucket} />
        </Panel>
        <Panel title={`Messages received · ${rangeLabel}`} sub={`Target: reply within ${slaLabel(slaMinutes)}`}>
          <Outcome s={s} />
        </Panel>
      </div>

      {seesEveryone && (
        <Panel title="By consultant" sub="Owner of the chat. Click a row to filter.">
          {view.byOwner.length === 0 ? (
            <Empty text="Nothing waiting and no messages in this period." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-md">
                <thead>
                  <tr className="text-left text-label-sm text-on-surface-variant">
                    <th className="px-sm py-base font-semibold">Consultant</th>
                    <th className="px-sm py-base font-semibold text-right">Waiting now</th>
                    <th className="px-sm py-base font-semibold text-right">Longest wait</th>
                    <th className="px-sm py-base font-semibold text-right">24h passed</th>
                    <th className="px-sm py-base font-semibold text-right" title="Nobody answered, but an automated message went after theirs">Bot replied</th>
                    <th className="px-sm py-base font-semibold text-right">Received</th>
                    <th className="px-sm py-base font-semibold text-right">Answered</th>
                    <th className="px-sm py-base font-semibold text-right">Within {slaLabel(slaMinutes)}</th>
                    <th className="px-sm py-base font-semibold text-right">Median reply</th>
                  </tr>
                </thead>
                <tbody>
                  {view.byOwner.map((o) => {
                    const on = ownerKeys.includes(o.key);
                    const tone = slaTone(o.summary);
                    return (
                      <tr
                        key={o.key}
                        onClick={() => pickOwners(on ? ownerKeys.filter((k) => k !== o.key) : [...ownerKeys, o.key])}
                        className={"border-t border-outline-variant cursor-pointer hover:bg-surface-container-low " + (on ? "bg-primary-fixed/40" : "")}
                      >
                        <td className="px-sm py-base font-medium">{o.key === NO_OWNER ? <span className="text-red-700">No owner</span> : person(o.key)}</td>
                        <td className={"px-sm py-base text-right tabular-nums font-semibold " + (o.waitingNow ? "text-red-700" : "text-on-surface-variant")}>{n(o.waitingNow)}</td>
                        <td className="px-sm py-base text-right tabular-nums">{formatDuration(o.oldestMs)}</td>
                        <td className={"px-sm py-base text-right tabular-nums " + (o.windowClosed ? "text-red-700" : "")}>{n(o.windowClosed)}</td>
                        <td className="px-sm py-base text-right tabular-nums text-on-surface-variant">{n(o.botReplied)}</td>
                        <td className="px-sm py-base text-right tabular-nums">{n(o.summary.received)}</td>
                        <td className="px-sm py-base text-right tabular-nums">{n(o.summary.answered)}</td>
                        <td className={"px-sm py-base text-right tabular-nums font-semibold " + (tone ? TONE_TEXT[tone] : "")}>{percent(o.summary.onTime, o.summary.slaBase)}</td>
                        <td className="px-sm py-base text-right tabular-nums">{formatDuration(o.summary.medianMs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* Worklist */}
      <Panel
        title={tab === "waiting" ? "Chats to answer" : tab === "bot" ? "Bot replied" : "Answered late"}
        sub={
          tab === "waiting"
            ? "The candidate wrote last. Longest wait first. Reply opens the chat in the Inbox."
            : tab === "bot"
              ? "Nobody has answered them, but an automated message (assignment intro, task reminder, re-marketing) went after their last one. Worth a person's look."
              : `Answered after the ${slaLabel(slaMinutes)} target, slowest first.`
        }
      >
        <div className="flex flex-wrap items-center gap-base mb-sm">
          {(
            [
              ["waiting", "Waiting now", view.waiting.length],
              ["bot", "Bot replied", view.bot.length],
              ["late", `Answered late · ${rangeLabel}`, view.late.length],
            ] as const
          ).map(([t, label, count]) => {
            const on = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => pickTab(t)}
                className={
                  "h-8 px-md rounded-full border text-label-sm font-semibold " +
                  (on ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface hover:bg-surface-container-low")
                }
              >
                {label} <span className={"tabular-nums " + (!on && t === "waiting" && count ? "text-red-700" : "")}>({n(count)})</span>
              </button>
            );
          })}
          {tab === "waiting" && bucket && (
            <button type="button" onClick={() => setBucket(null)} className="text-label-sm text-accent hover:underline">
              Showing {AGE_BUCKETS.find((b) => b.key === bucket)?.label.toLowerCase()} · clear
            </button>
          )}
        </div>

        {tab === "waiting" ? (
          waitingRows.length === 0 ? (
            <Empty text={view.waiting.length ? "Nothing in this wait band." : "Nothing waiting. Every chat has a reply."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-md">
                <thead>
                  <tr className="text-left text-label-sm text-on-surface-variant">
                    <th className="px-sm py-base font-semibold">Candidate</th>
                    {seesEveryone && <th className="px-sm py-base font-semibold">Owner</th>}
                    <th className="px-sm py-base font-semibold">Waiting</th>
                    <th className="px-sm py-base font-semibold">Their last message</th>
                    <th className="px-sm py-base font-semibold">Reply window</th>
                    <th className="px-sm py-base font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {waitingRows.slice(0, limit).map((w) => {
                    const age = now - w.since;
                    const left = SESSION_WINDOW_MS - (now - w.lastInboundAt);
                    return (
                      <tr key={w.conversationId} className="border-t border-outline-variant align-top">
                        <td className="px-sm py-base">
                          {w.leadId ? (
                            <Link href={`/crm/leads/${w.leadId}`} className="font-medium text-on-surface hover:underline">
                              {w.candidateName || w.phoneE164}
                            </Link>
                          ) : (
                            <span className="font-medium">{w.phoneE164}</span>
                          )}
                          <div className="text-caption text-on-surface-variant">
                            {w.phoneE164}
                            {w.stage && ` · ${w.stage}`}
                            {!w.leadId && " · no lead linked"}
                          </div>
                          {w.sourceCampaign && <div className="text-caption text-on-surface-variant">Replied to {w.sourceCampaign}</div>}
                        </td>
                        {seesEveryone && <td className={"px-sm py-base " + (w.ownerId ? "" : "text-red-700 font-semibold")}>{person(w.ownerId)}</td>}
                        <td className="px-sm py-base whitespace-nowrap">
                          <span className={"font-semibold tabular-nums " + TONE_TEXT[waitTone(age, slaMs)]}>{formatDuration(age)}</span>
                          <div className="text-caption text-on-surface-variant">since {fmtWhen(w.since)}</div>
                          {w.inboundCount > 1 && <div className="text-caption text-on-surface-variant">{w.inboundCount} messages</div>}
                        </td>
                        <td className="px-sm py-base max-w-[360px]">
                          <span className="line-clamp-2 text-on-surface">{w.preview ?? <span className="text-on-surface-variant">Media</span>}</span>
                        </td>
                        <td className="px-sm py-base whitespace-nowrap">
                          {left > 0 ? <Pill tone={left < 2 * HOUR_MS ? "amber" : "green"}>{formatDuration(left)} left</Pill> : <Pill tone="red">Template only</Pill>}
                        </td>
                        <td className="px-sm py-base text-right">
                          <Link
                            href={`/crm/inbox?conversation=${w.conversationId}`}
                            className="inline-flex items-center gap-xs h-8 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold"
                          >
                            Reply
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : tab === "bot" ? (
          view.bot.length === 0 ? (
            <Empty text="No chat where only a bot replied." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-md">
                <thead>
                  <tr className="text-left text-label-sm text-on-surface-variant">
                    <th className="px-sm py-base font-semibold">Candidate</th>
                    {seesEveryone && <th className="px-sm py-base font-semibold">Owner</th>}
                    <th className="px-sm py-base font-semibold">Their last message</th>
                    <th className="px-sm py-base font-semibold">Then the bot sent</th>
                    <th className="px-sm py-base font-semibold">Reply window</th>
                    <th className="px-sm py-base font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {view.bot.slice(0, limit).map((b) => {
                    const left = SESSION_WINDOW_MS - (now - b.lastInboundAt);
                    return (
                      <tr key={b.conversationId} className="border-t border-outline-variant align-top">
                        <td className="px-sm py-base">
                          {b.leadId ? (
                            <Link href={`/crm/leads/${b.leadId}`} className="font-medium text-on-surface hover:underline">
                              {b.candidateName || b.phoneE164}
                            </Link>
                          ) : (
                            <span className="font-medium">{b.phoneE164}</span>
                          )}
                          <div className="text-caption text-on-surface-variant">
                            {b.phoneE164}
                            {b.stage && ` · ${b.stage}`}
                          </div>
                        </td>
                        {seesEveryone && <td className={"px-sm py-base " + (b.ownerId ? "" : "text-red-700 font-semibold")}>{person(b.ownerId)}</td>}
                        <td className="px-sm py-base max-w-[320px]">
                          <span className="line-clamp-2 text-on-surface">{b.preview ?? <span className="text-on-surface-variant">Media</span>}</span>
                          <div className="text-caption text-on-surface-variant">{fmtWhen(b.lastInboundAt)}</div>
                        </td>
                        <td className="px-sm py-base whitespace-nowrap">
                          <span className="font-mono text-label-sm">{b.autoTemplate ?? "Automated message"}</span>
                          <div className="text-caption text-on-surface-variant">
                            {fmtWhen(b.autoAt)} · {formatDuration(now - b.autoAt)} ago
                          </div>
                        </td>
                        <td className="px-sm py-base whitespace-nowrap">
                          {left > 0 ? <Pill tone={left < 2 * HOUR_MS ? "amber" : "green"}>{formatDuration(left)} left</Pill> : <Pill tone="gray">Template only</Pill>}
                        </td>
                        <td className="px-sm py-base text-right">
                          <Link
                            href={`/crm/inbox?conversation=${b.conversationId}`}
                            className="inline-flex items-center gap-xs h-8 px-md rounded-lg border border-outline-variant text-label-sm font-semibold hover:bg-surface-container-low"
                          >
                            Open chat
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : view.late.length === 0 ? (
          <Empty text={`Every answered message in this period was answered within ${slaLabel(slaMinutes)}.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead>
                <tr className="text-left text-label-sm text-on-surface-variant">
                  <th className="px-sm py-base font-semibold">Candidate</th>
                  {seesEveryone && <th className="px-sm py-base font-semibold">Owner</th>}
                  <th className="px-sm py-base font-semibold">Message received</th>
                  <th className="px-sm py-base font-semibold">Answered</th>
                  <th className="px-sm py-base font-semibold text-right">Took</th>
                  <th className="px-sm py-base font-semibold" />
                </tr>
              </thead>
              <tbody>
                {view.late.slice(0, limit).map((e) => {
                  const t = data.threads[e.conversationId];
                  return (
                    <tr key={`${e.conversationId}-${e.askedAt}`} className="border-t border-outline-variant">
                      <td className="px-sm py-base">
                        {t?.leadId ? (
                          <Link href={`/crm/leads/${t.leadId}`} className="font-medium hover:underline">
                            {t.candidateName || t.phoneE164}
                          </Link>
                        ) : (
                          <span className="font-medium">{t?.phoneE164 ?? "—"}</span>
                        )}
                        <div className="text-caption text-on-surface-variant">{t?.phoneE164}</div>
                      </td>
                      {seesEveryone && <td className="px-sm py-base">{person(e.ownerId)}</td>}
                      <td className="px-sm py-base whitespace-nowrap">{fmtWhen(e.askedAt)}</td>
                      <td className="px-sm py-base whitespace-nowrap">
                        {fmtWhen(e.answeredAt!)}
                        <div className="text-caption text-on-surface-variant">by {person(e.answeredById)}</div>
                      </td>
                      <td className="px-sm py-base text-right tabular-nums font-semibold text-red-700">{formatDuration(e.answeredAt! - e.askedAt)}</td>
                      <td className="px-sm py-base text-right">
                        <Link href={`/crm/inbox?conversation=${e.conversationId}`} className="text-label-sm text-accent hover:underline">
                          Open chat
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(tab === "waiting" ? waitingRows.length : tab === "bot" ? view.bot.length : view.late.length) > limit && (
          <div className="flex justify-center mt-sm">
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="h-9 px-md rounded-lg border border-outline-variant text-label-sm font-semibold hover:bg-surface-container-low">
              Show more
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-lg text-center text-on-surface-variant">{text}</div>;
}

function AgeBars({ counts, total, active, onPick }: { counts: Record<AgeBucketKey, number>; total: number; active: AgeBucketKey | null; onPick: (b: AgeBucketKey) => void }) {
  if (!total) return <Empty text="Nothing waiting. Every chat has a reply." />;
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="flex flex-col gap-base">
      {AGE_BUCKETS.map((b) => (
        <button
          key={b.key}
          type="button"
          onClick={() => onPick(b.key)}
          disabled={!counts[b.key]}
          className={
            "grid grid-cols-[110px_1fr_48px] items-center gap-x-sm rounded text-left hover:bg-surface-container-low disabled:cursor-default disabled:hover:bg-transparent " +
            (active && active !== b.key ? "opacity-50" : "")
          }
        >
          <span className={"text-body-md " + (active === b.key ? "font-semibold" : "font-medium")}>{b.label}</span>
          <span className="h-5 rounded bg-surface-container overflow-hidden">
            <span className={"block h-full rounded " + TONE_BAR[b.tone]} style={{ width: `${(counts[b.key] / max) * 100}%`, minWidth: counts[b.key] ? 2 : 0 }} />
          </span>
          <span className="text-right tabular-nums font-semibold">{n(counts[b.key])}</span>
        </button>
      ))}
    </div>
  );
}

function Outcome({ s }: { s: TrackerSummary }) {
  if (!s.received) return <Empty text="No messages from candidates in this period." />;
  const segs = [
    { n: s.onTime, cls: "bg-green-600", label: "Answered on time" },
    { n: s.late, cls: "bg-amber-400", label: "Answered late" },
    { n: s.overdue, cls: "bg-red-500", label: "Waiting · past target" },
    { n: s.pending, cls: "bg-blue-300", label: "Waiting · within target" },
    { n: s.auto, cls: "bg-outline-variant", label: "Only a bot replied" },
    { n: s.closed, cls: "bg-outline", label: "Closed without reply" },
  ];
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex h-4 rounded overflow-hidden bg-surface-container">
        {segs.map((g) => (g.n ? <span key={g.label} className={g.cls} style={{ width: `${(g.n / s.received) * 100}%` }} title={`${g.label}: ${g.n}`} /> : null))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-md gap-y-xs">
        {segs.map((g) => (
          <div key={g.label} className="flex items-center gap-base text-body-md">
            <span className={"inline-block w-2.5 h-2.5 rounded-sm " + g.cls} />
            <span className="flex-1">{g.label}</span>
            <b className="tabular-nums">{n(g.n)}</b>
            <span className="text-caption text-on-surface-variant w-10 text-right">{percent(g.n, s.received)}</span>
          </div>
        ))}
      </div>
      <p className="text-caption text-on-surface-variant">
        One row per message a candidate started: several messages in a row before anyone replies count once. Reply time runs from their first message to the first reply.
      </p>
    </div>
  );
}
