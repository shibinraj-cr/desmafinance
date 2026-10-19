"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MultiSelect } from "@/components/MultiSelect";
import { applyFilterPatch } from "@/lib/filter-params";
import {
  DAY_MS,
  DEFAULT_REPLY_WINDOW_DAYS,
  HOUR_MS,
  NO_OWNER,
  RANGE_OPTIONS,
  REPLY_WINDOW_OPTIONS,
  SESSION_WINDOW_MS,
  WORKLIST_TABS,
  applyFilter,
  formatDuration,
  matchesFocus,
  ownerChangeCounts,
  ownerKeyOf,
  percent,
  sessionOpen,
  stageMoveCounts,
  summarise,
  summariseByCampaign,
  summariseByOwner,
  withinWindow,
  worklist,
  worklistCounts,
  type BroadcastReportData,
  type RangeKey,
  type ReplyRow,
  type ReportSummary,
  type WorklistFocus,
  type WorklistTab,
} from "@/lib/wa/broadcast-report";

const PAGE = 50;

const TAB_LABEL: Record<WorklistTab, string> = {
  waiting: "Needs reply",
  no_owner: "No owner",
  handled: "Answered",
  all: "All replies",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * IST date/time by hand rather than toLocaleString: the server and the browser
 * ship different ICU data, and a one-character difference ("pm" vs "PM", a
 * narrow no-break space) is a hydration mismatch on every row.
 */
function istParts(ts: number) {
  const d = new Date(ts + 5.5 * HOUR_MS);
  return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], h: d.getUTCHours(), m: d.getUTCMinutes() };
}
function fmtDay(ts: number): string {
  const p = istParts(ts);
  return `${p.day} ${p.month}`;
}
function fmtWhen(ts: number): string {
  const p = istParts(ts);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${p.day} ${p.month}, ${h12}:${String(p.m).padStart(2, "0")} ${p.h < 12 ? "am" : "pm"}`;
}
const n = (x: number) => x.toLocaleString("en-IN");

function Panel({ title, sub, children, className }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
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

function Pill({ tone, children }: { tone: "red" | "amber" | "green" | "blue" | "gray"; children: React.ReactNode }) {
  const cls = {
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-800",
    green: "bg-green-50 text-green-700",
    blue: "bg-blue-50 text-blue-700",
    gray: "bg-surface-container text-on-surface-variant",
  }[tone];
  return <span className={"inline-flex items-center gap-xs whitespace-nowrap rounded-full px-base py-[2px] text-label-sm font-semibold " + cls}>{children}</span>;
}

function Stage({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded border border-outline-variant bg-surface-container-low px-xs py-[1px] text-caption text-on-surface">
      {label}
    </span>
  );
}

/** Answered-share bar: green when every reply is handled, amber, then red. */
function AnsweredBar({ s }: { s: ReportSummary }) {
  if (!s.replied) return <span className="text-on-surface-variant">—</span>;
  const p = s.handled / s.replied;
  const color = p >= 0.98 ? "bg-green-600" : p >= 0.85 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-base min-w-[120px]">
      <span className="flex-1 h-1.5 rounded bg-surface-container overflow-hidden">
        <span className={"block h-full rounded " + color} style={{ width: `${p * 100}%` }} />
      </span>
      <span className="font-semibold tabular-nums">{percent(s.handled, s.replied)}</span>
    </div>
  );
}

export function BroadcastReportClient({
  data,
  range,
  initial,
  seesEveryone,
  canOpenCampaigns,
}: {
  data: BroadcastReportData;
  range: { key: RangeKey; fromDay: string | null; toDay: string | null };
  initial: { campaignIds: string[]; ownerKeys: string[]; windowDays: number; tab: WorklistTab };
  seesEveryone: boolean;
  canOpenCampaigns: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [campaignIds, setCampaignIds] = useState(initial.campaignIds);
  const [ownerKeys, setOwnerKeys] = useState(initial.ownerKeys);
  const [windowDays, setWindowDays] = useState(initial.windowDays);
  const [tab, setTab] = useState<WorklistTab>(initial.tab);
  const [focus, setFocus] = useState<WorklistFocus | null>(null);
  const [focusLabel, setFocusLabel] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [customFrom, setCustomFrom] = useState(range.fromDay ?? "");
  const [customTo, setCustomTo] = useState(range.toDay ?? "");
  const [showCustom, setShowCustom] = useState(range.key === "custom");
  const worklistRef = useRef<HTMLDivElement | null>(null);

  const now = data.generatedAt;
  const person = (id: string | null) => (id ? data.people[id] ?? "Unknown user" : "No owner");
  const campaignById = useMemo(() => new Map(data.campaigns.map((c) => [c.id, c])), [data.campaigns]);

  /**
   * Browser-side filters ride in the URL without a server round-trip. Read from
   * the live address bar, not a hook snapshot, so two quick picks in a row both
   * survive.
   */
  function syncUrl(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(window.location.search);
    applyFilterPatch(params, patch);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }
  /** The date range decides which campaigns load, so it goes back to the server. */
  function pushRange(patch: Record<string, string | null>) {
    const params = new URLSearchParams(window.location.search);
    applyFilterPatch(params, patch);
    router.push(`${pathname}?${params.toString()}`);
  }

  function pickCampaigns(next: string[]) {
    setCampaignIds(next);
    setLimit(PAGE);
    syncUrl({ campaign: next });
  }
  function pickOwners(next: string[]) {
    setOwnerKeys(next);
    setLimit(PAGE);
    syncUrl({ owner: next });
  }
  function pickWindow(days: number) {
    setWindowDays(days);
    setLimit(PAGE);
    syncUrl({ window: days === DEFAULT_REPLY_WINDOW_DAYS ? null : String(days) });
  }
  function pickTab(next: WorklistTab) {
    setTab(next);
    setLimit(PAGE);
    syncUrl({ tab: next === "waiting" ? null : next });
  }
  function toggleIn(list: string[], v: string) {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }
  function drill(next: WorklistFocus, label: string) {
    const same = focus && JSON.stringify(focus) === JSON.stringify(next);
    setFocus(same ? null : next);
    setFocusLabel(same ? "" : label);
    if (!same) {
      setTab("all");
      setLimit(PAGE);
      syncUrl({ tab: "all" });
      worklistRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  function clearAll() {
    setCampaignIds([]);
    setOwnerKeys([]);
    setWindowDays(DEFAULT_REPLY_WINDOW_DAYS);
    setTab("waiting");
    setFocus(null);
    setLimit(PAGE);
    syncUrl({ campaign: null, owner: null, window: null, tab: null });
  }

  const view = useMemo(() => {
    const sliced = applyFilter(data, { campaignIds, ownerKeys });
    const counted = sliced.replies.filter((r) => withinWindow(r, windowDays));
    const campaigns = data.campaigns.filter((c) => !campaignIds.length || campaignIds.includes(c.id));
    return {
      summary: summarise(sliced.groups, sliced.replies, windowDays, now),
      counted,
      moves: stageMoveCounts(counted),
      ownerChanges: ownerChangeCounts(counted),
      byOwner: summariseByOwner(sliced.groups, sliced.replies, windowDays, now).sort(
        (a, b) => b.summary.waiting - a.summary.waiting || b.summary.replied - a.summary.replied || b.summary.sent - a.summary.sent,
      ),
      byCampaign: summariseByCampaign(campaigns, sliced.groups, sliced.replies, windowDays, now),
      campaignCount: campaigns.length,
    };
  }, [data, campaignIds, ownerKeys, windowDays, now]);

  const focused = useMemo(() => view.counted.filter((r) => matchesFocus(r, focus)), [view.counted, focus]);
  const tabCounts = useMemo(() => worklistCounts(focused), [focused]);
  const rows = useMemo(() => worklist(focused, tab), [focused, tab]);

  const s = view.summary;
  const campaignOptions = data.campaigns.map((c) => ({ value: c.id, label: c.name, hint: fmtDay(c.startedAt) }));
  const ownerOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const g of data.groups) keys.add(ownerKeyOf(g.ownerId));
    for (const r of data.replies) keys.add(ownerKeyOf(r.ownerId));
    return [...keys]
      .map((k) => ({ value: k, label: k === NO_OWNER ? "No owner" : data.people[k] ?? "Unknown user" }))
      .sort((a, b) => (a.value === NO_OWNER ? 1 : b.value === NO_OWNER ? -1 : a.label.localeCompare(b.label)));
  }, [data]);

  const exportQs = (() => {
    const params = new URLSearchParams();
    params.set("range", range.key);
    if (range.key === "custom" && range.fromDay && range.toDay) {
      params.set("from", range.fromDay);
      params.set("to", range.toDay);
    }
    for (const c of campaignIds) params.append("campaign", c);
    for (const o of ownerKeys) params.append("owner", o);
    params.set("window", String(windowDays));
    return params.toString();
  })();

  return (
    <div className="p-md md:p-margin flex flex-col gap-md">
      {/* Filters */}
      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <label className="flex items-center gap-base text-label-sm text-on-surface-variant">
            Campaigns started
            <select
              value={showCustom ? "custom" : range.key}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "custom") return setShowCustom(true);
                setShowCustom(false);
                pushRange({ range: v, from: null, to: null });
              }}
              className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold"
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {showCustom && (
            <span className="flex flex-wrap items-center gap-base">
              <input
                type="date"
                aria-label="From"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 px-base rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm"
              />
              <span className="text-caption text-on-surface-variant">to</span>
              <input
                type="date"
                aria-label="To"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 px-base rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm"
              />
              <button
                type="button"
                disabled={!customFrom || !customTo || customFrom > customTo}
                onClick={() => pushRange({ range: "custom", from: customFrom, to: customTo })}
                className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-50"
              >
                Apply
              </button>
            </span>
          )}
          <label className="flex items-center gap-base text-label-sm text-on-surface-variant">
            Count a reply if it arrives within
            <select
              value={windowDays}
              onChange={(e) => pickWindow(Number(e.target.value))}
              className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold"
            >
              {REPLY_WINDOW_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} days of the send
                </option>
              ))}
            </select>
          </label>
          <MultiSelect
            options={campaignOptions}
            selected={campaignIds}
            onChange={pickCampaigns}
            placeholder="All campaigns"
            icon="campaign"
            title="Campaign"
          />
          {seesEveryone && (
            <MultiSelect options={ownerOptions} selected={ownerKeys} onChange={pickOwners} placeholder="Every owner" icon="person" title="Lead owner" />
          )}
          <button type="button" onClick={clearAll} className="text-label-sm text-accent hover:underline">
            Clear filters
          </button>
          <span className="flex-1" />
          <a
            href={`/api/crm/wa/broadcast-report/export?${exportQs}`}
            className="inline-flex items-center gap-xs h-9 px-md rounded-lg border border-outline-variant text-label-sm font-semibold hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              download
            </span>
            Download .xlsx
          </a>
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
          {view.campaignCount} {view.campaignCount === 1 ? "campaign" : "campaigns"} · figures as of {fmtWhen(now)} ·{" "}
          <button type="button" onClick={() => router.refresh()} className="text-accent hover:underline">
            Refresh
          </button>
          {!seesEveryone && " · Showing leads you own."}
        </p>
        {data.truncated && (
          <p className="text-caption text-amber-800 bg-amber-50 rounded-lg px-sm py-xs">
            This period holds more data than one page loads, so some totals may be short. Pick a shorter range.
          </p>
        )}
      </section>

      {data.campaigns.length === 0 ? (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
          No campaign started sending in this period.{" "}
          {canOpenCampaigns && (
            <Link href="/crm/broadcasts" className="text-accent hover:underline">
              Go to Broadcasts
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-md">
            <Panel title="Delivery" sub={`${n(s.sent)} sent`}>
              <Funnel s={s} />
            </Panel>
            <Panel title="Replies answered" sub="Target: every reply gets a response">
              <Handling s={s} />
            </Panel>
          </div>

          <div ref={worklistRef} className="scroll-mt-md">
            <Panel
              title="Replies to work"
              sub="Longest-waiting first. Answered = a person sent a WhatsApp message or logged a call after their latest message."
            >
              <div className="flex flex-wrap items-center gap-base mb-sm">
                {WORKLIST_TABS.map((t) => {
                  const on = tab === t;
                  const alarm = !on && (t === "waiting" || t === "no_owner") && tabCounts[t] > 0;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => pickTab(t)}
                      className={
                        "inline-flex items-center gap-xs h-8 px-sm rounded-lg border text-label-sm font-semibold " +
                        (on ? "bg-brand border-brand text-on-brand" : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low")
                      }
                    >
                      {TAB_LABEL[t]}
                      <span
                        className={
                          "rounded-full px-xs min-w-[20px] text-center text-[11px] font-bold " +
                          (on ? "bg-primary text-on-primary" : alarm ? "bg-red-600 text-white" : "bg-surface-container text-on-surface-variant")
                        }
                      >
                        {n(tabCounts[t])}
                      </span>
                    </button>
                  );
                })}
                {focus && (
                  <span className="inline-flex items-center gap-xs rounded-full bg-primary-fixed px-sm py-[2px] text-label-sm text-on-surface">
                    {focusLabel}
                    <button type="button" aria-label="Remove this filter" onClick={() => setFocus(null)} className="px-xs">
                      ×
                    </button>
                  </span>
                )}
              </div>
              <Worklist rows={rows.slice(0, limit)} tab={tab} now={now} person={person} campaignName={(id) => campaignById.get(id)?.name ?? "—"} />
              {rows.length > limit && (
                <div className="flex justify-center mt-sm">
                  <button
                    type="button"
                    onClick={() => setLimit(limit + PAGE)}
                    className="h-9 px-md rounded-lg border border-outline-variant text-label-sm font-semibold hover:bg-surface-container-low"
                  >
                    Show {Math.min(PAGE, rows.length - limit)} more · {n(rows.length - limit)} left
                  </button>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-md">
            <Panel title="Stage changes after the reply" sub="Click a row to list those leads">
              {s.replied === 0 ? (
                <Empty text="No replies in this selection." />
              ) : (
                <>
                  <p className="text-body-md text-on-surface-variant mb-sm">
                    <b className="text-on-surface">
                      {n(s.stageMoved)} of {n(s.replied)}
                    </b>{" "}
                    replied leads changed stage ({percent(s.stageMoved, s.replied)}).
                  </p>
                  <div className="flex flex-col">
                    {view.moves.map((m) => {
                      const sel = focus?.kind === "move" && focus.from === m.from && focus.to === m.to;
                      return (
                        <OutcomeRow
                          key={`${m.from}→${m.to}`}
                          selected={sel}
                          n={m.n}
                          max={view.moves[0]?.n ?? 1}
                          onClick={() => drill({ kind: "move", from: m.from, to: m.to }, `${m.from} → ${m.to}`)}
                        >
                          <Stage label={m.from} />
                          <span className="text-on-surface-variant">→</span>
                          <Stage label={m.to} />
                          {m.auto > 0 && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant border border-outline-variant rounded px-xs" title="Moved by the system, not a person">
                              {m.auto} auto
                            </span>
                          )}
                        </OutcomeRow>
                      );
                    })}
                    <OutcomeRow
                      selected={focus?.kind === "no_action"}
                      n={s.noAction}
                      max={Math.max(view.moves[0]?.n ?? 1, s.noAction)}
                      muted
                      onClick={() => drill({ kind: "no_action" }, "No stage change or new owner")}
                    >
                      <span className="text-on-surface-variant">No stage change and no new owner</span>
                    </OutcomeRow>
                  </div>
                </>
              )}
            </Panel>
            <Panel title="Assigned or reassigned after the reply" sub="Click a row to list those leads">
              {s.replied === 0 ? (
                <Empty text="No replies in this selection." />
              ) : (
                <>
                  <p className="text-body-md text-on-surface-variant mb-sm">
                    <b className="text-on-surface">
                      {n(s.ownerChanged)} of {n(s.replied)}
                    </b>{" "}
                    replied leads changed owner ({percent(s.ownerChanged, s.replied)}).
                    {tabCounts.no_owner > 0 && !focus && (
                      <span className="text-red-700 font-semibold"> {n(tabCounts.no_owner)} still have no owner.</span>
                    )}
                  </p>
                  {view.ownerChanges.length === 0 ? (
                    <Empty text="No lead changed owner after replying." />
                  ) : (
                    <div className="flex flex-col">
                      {view.ownerChanges.map((c) => {
                        const sel = focus?.kind === "owner_change" && focus.fromId === c.fromId && focus.toId === c.toId;
                        const label = `${person(c.fromId)} → ${person(c.toId)}`;
                        return (
                          <OutcomeRow
                            key={`${ownerKeyOf(c.fromId)}→${ownerKeyOf(c.toId)}`}
                            selected={sel}
                            n={c.n}
                            max={view.ownerChanges[0]?.n ?? 1}
                            tone="blue"
                            onClick={() => drill({ kind: "owner_change", fromId: c.fromId, toId: c.toId }, label)}
                          >
                            {c.fromId ? <span>{person(c.fromId)}</span> : <Pill tone="gray">No owner</Pill>}
                            <span className="text-on-surface-variant">→</span>
                            {c.toId ? <b>{person(c.toId)}</b> : <Pill tone="red">No owner</Pill>}
                          </OutcomeRow>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </Panel>
          </div>

          {seesEveryone && (
            <Panel title="By owner" sub="Current lead owner. Click a row to filter the page.">
              <div className="overflow-x-auto rounded-lg border border-outline-variant">
                <table className="w-full min-w-[760px] text-body-md">
                  <thead>
                    <tr className="bg-surface-container-low text-left text-caption uppercase tracking-wide text-on-surface-variant">
                      <th className="px-sm py-base font-semibold">Owner</th>
                      <th className="px-sm py-base font-semibold text-right">Sent</th>
                      <th className="px-sm py-base font-semibold text-right">Replies</th>
                      <th className="px-sm py-base font-semibold text-right">Needs reply</th>
                      <th className="px-sm py-base font-semibold">Answered</th>
                      <th className="px-sm py-base font-semibold text-right">First response</th>
                      <th className="px-sm py-base font-semibold text-right">Oldest waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.byOwner.map(({ key, summary: o }) => (
                      <tr
                        key={key}
                        onClick={() => pickOwners(toggleIn(ownerKeys, key))}
                        className={"border-t border-outline-variant cursor-pointer hover:bg-surface-container-low " + (ownerKeys.includes(key) ? "bg-primary-fixed/40" : "")}
                      >
                        <td className="px-sm py-base">{key === NO_OWNER ? <Pill tone="red">No owner</Pill> : <b>{person(key)}</b>}</td>
                        <td className="px-sm py-base text-right tabular-nums">{n(o.sent)}</td>
                        <td className="px-sm py-base text-right tabular-nums">{n(o.replied)}</td>
                        <td className="px-sm py-base text-right">{o.waiting ? <Pill tone="red">{n(o.waiting)}</Pill> : <span className="text-on-surface-variant">0</span>}</td>
                        <td className="px-sm py-base">
                          <AnsweredBar s={o} />
                        </td>
                        <td className="px-sm py-base text-right tabular-nums">{formatDuration(o.medianFirstResponseMs)}</td>
                        <td className="px-sm py-base text-right tabular-nums">{o.waiting ? formatDuration(o.oldestWaitingMs) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel title="By campaign" sub="Click a row to filter the page.">
            <div className="overflow-x-auto rounded-lg border border-outline-variant">
              <table className="w-full min-w-[1000px] text-body-md">
                <thead>
                  <tr className="bg-surface-container-low text-left text-caption uppercase tracking-wide text-on-surface-variant">
                    <th className="px-sm py-base font-semibold">Campaign</th>
                    <th className="px-sm py-base font-semibold text-right">Sent</th>
                    <th className="px-sm py-base font-semibold text-right">Delivered</th>
                    <th className="px-sm py-base font-semibold text-right">Read</th>
                    <th className="px-sm py-base font-semibold text-right">Failed</th>
                    <th className="px-sm py-base font-semibold text-right">Replied</th>
                    <th className="px-sm py-base font-semibold">Answered</th>
                    <th className="px-sm py-base font-semibold text-right">Needs reply</th>
                    <th className="px-sm py-base font-semibold text-right">Stage changed</th>
                    <th className="px-sm py-base font-semibold text-right">New owner</th>
                  </tr>
                </thead>
                <tbody>
                  {view.byCampaign.map(({ key, summary: c }) => {
                    const meta = campaignById.get(key);
                    return (
                      <tr
                        key={key}
                        onClick={() => pickCampaigns(toggleIn(campaignIds, key))}
                        className={"border-t border-outline-variant cursor-pointer hover:bg-surface-container-low " + (campaignIds.includes(key) ? "bg-primary-fixed/40" : "")}
                      >
                        <td className="px-sm py-base">
                          <b>{meta?.name}</b>
                          <div className="text-caption text-on-surface-variant">
                            {meta?.templateName} · {meta ? fmtDay(meta.startedAt) : ""}
                            {meta?.status === "sending" ? " · still sending" : ""}
                          </div>
                        </td>
                        <td className="px-sm py-base text-right tabular-nums">{n(c.sent)}</td>
                        <td className="px-sm py-base text-right tabular-nums">
                          {n(c.delivered)}
                          <div className="text-caption text-on-surface-variant">{percent(c.delivered, c.sent)}</div>
                        </td>
                        <td className="px-sm py-base text-right tabular-nums">
                          {n(c.read)}
                          <div className="text-caption text-on-surface-variant">{percent(c.read, c.delivered)}</div>
                        </td>
                        <td className="px-sm py-base text-right tabular-nums">
                          <span className={c.failed ? "text-error" : ""}>{n(c.failed)}</span>
                          <div className="text-caption text-on-surface-variant">{percent(c.failed, c.sent)}</div>
                        </td>
                        <td className="px-sm py-base text-right tabular-nums">
                          <b>{n(c.replied)}</b>
                          <div className="text-caption text-on-surface-variant">{percent(c.replied, c.delivered)}</div>
                        </td>
                        <td className="px-sm py-base">
                          <AnsweredBar s={c} />
                        </td>
                        <td className="px-sm py-base text-right">{c.waiting ? <Pill tone="red">{n(c.waiting)}</Pill> : <span className="text-on-surface-variant">0</span>}</td>
                        <td className="px-sm py-base text-right tabular-nums">{n(c.stageMoved)}</td>
                        <td className="px-sm py-base text-right tabular-nums">{n(c.ownerChanged)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Definitions />
        </>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-lg text-center text-on-surface-variant">{text}</div>;
}

function Funnel({ s }: { s: ReportSummary }) {
  const base = s.sent || 1;
  const rows: Array<{ label: string; value: number; note: string; bar: string }> = [
    { label: "Sent", value: s.sent, note: s.sent ? "100%" : "—", bar: "bg-primary" },
    { label: "Delivered", value: s.delivered, note: `${percent(s.delivered, s.sent)} of sent`, bar: "bg-primary" },
    { label: "Read", value: s.read, note: `${percent(s.read, s.delivered)} of delivered`, bar: "bg-primary-fixed-dim" },
    { label: "Replied", value: s.replied, note: `${percent(s.replied, s.delivered)} of delivered`, bar: "bg-brand" },
  ];
  const side: Array<{ label: string; value: number; note: string; bar: string }> = [
    { label: "Failed", value: s.failed, note: `${percent(s.failed, s.sent)} of sent`, bar: "bg-red-400" },
    { label: "Skipped", value: s.skipped, note: "not sent", bar: "bg-outline" },
  ];
  if (s.pending) side.push({ label: "Queued", value: s.pending, note: "still to send", bar: "bg-outline-variant" });
  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <>
      <span className="text-body-md font-medium">{r.label}</span>
      <span className="h-5 rounded bg-surface-container overflow-hidden">
        <span className={"block h-full rounded " + r.bar} style={{ width: `${Math.min(100, (r.value / base) * 100)}%`, minWidth: r.value ? 2 : 0 }} />
      </span>
      <span className="text-right whitespace-nowrap tabular-nums">
        <b>{n(r.value)}</b>
        <span className="ml-base text-caption text-on-surface-variant">{r.note}</span>
      </span>
    </>
  );
  return (
    <div className="grid grid-cols-[80px_1fr_auto] items-center gap-x-sm gap-y-base">
      {rows.map((r) => (
        <Row key={r.label} r={r} />
      ))}
      <span className="col-span-3 border-t border-dashed border-outline-variant" />
      {side.map((r) => (
        <Row key={r.label} r={r} />
      ))}
    </div>
  );
}

function Handling({ s }: { s: ReportSummary }) {
  if (!s.replied) return <Empty text="No replies in this selection." />;
  const p = s.handled / s.replied;
  const tone = p >= 0.98 ? "text-green-700" : p >= 0.85 ? "text-amber-700" : "text-red-700";
  const segs = [
    { n: s.answered - s.answeredByCall, cls: "bg-green-600", label: "Answered on WhatsApp" },
    { n: s.answeredByCall, cls: "bg-green-300", label: "Answered by call" },
    { n: s.optedOut, cls: "bg-outline", label: "Opted out" },
    { n: s.waitingOpen, cls: "bg-amber-400", label: "Waiting · can reply now" },
    { n: s.waitingClosed, cls: "bg-red-500", label: "Waiting · 24h passed" },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-sm">
        <span className={"text-[40px] leading-none font-bold tabular-nums " + tone}>{percent(s.handled, s.replied)}</span>
        <span className="text-body-md text-on-surface-variant">
          <b className="text-on-surface">
            {n(s.handled)} of {n(s.replied)}
          </b>{" "}
          replies handled
        </span>
      </div>
      <div className="flex h-3.5 rounded overflow-hidden bg-surface-container mt-md mb-base" role="img" aria-label="Handled versus waiting">
        {segs.map((g) => (g.n ? <span key={g.label} className={g.cls} style={{ width: `${(g.n / s.replied) * 100}%` }} title={`${g.label}: ${g.n}`} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-md gap-y-xs text-caption text-on-surface-variant">
        {segs.map((g) => (
          <span key={g.label} className="inline-flex items-center gap-xs">
            <span className={"inline-block w-2.5 h-2.5 rounded-sm " + g.cls} />
            {g.label} <b className="text-on-surface">{n(g.n)}</b>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-base mt-md">
        <Stat label="Needs reply" value={n(s.waiting)} note={`${n(s.waitingClosed)} need a template`} alert={s.waiting > 0} good={s.waiting === 0} />
        <Stat label="No owner" value={n(s.waitingNoOwner)} note="waiting, unassigned" alert={s.waitingNoOwner > 0} good={s.waitingNoOwner === 0} />
        <Stat label="First response" value={formatDuration(s.medianFirstResponseMs)} note="median time" />
        <Stat label="Oldest waiting" value={s.waiting ? formatDuration(s.oldestWaitingMs) : "—"} note="since their message" alert={(s.oldestWaitingMs ?? 0) > DAY_MS} />
      </div>
    </div>
  );
}

function Stat({ label, value, note, alert, good }: { label: string; value: string; note: string; alert?: boolean; good?: boolean }) {
  return (
    <div className={"rounded-lg border px-sm py-base flex flex-col min-w-0 " + (alert ? "border-red-200 bg-red-50" : "border-outline-variant bg-surface-container-low")}>
      <span className={"text-[11px] font-semibold uppercase tracking-wide " + (alert ? "text-red-700" : "text-on-surface-variant")}>{label}</span>
      <span className={"text-h3 font-bold tabular-nums " + (alert ? "text-red-700" : good ? "text-green-700" : "text-on-surface")}>{value}</span>
      <span className="text-caption text-on-surface-variant">{note}</span>
    </div>
  );
}

function OutcomeRow({
  children,
  n: count,
  max,
  selected,
  muted,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  n: number;
  max: number;
  selected: boolean;
  muted?: boolean;
  tone?: "blue";
  onClick: () => void;
}) {
  const bar = muted ? "bg-outline-variant" : tone === "blue" ? "bg-blue-500" : "bg-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={"grid grid-cols-[minmax(0,1fr)_96px_44px] items-center gap-sm rounded-lg px-base py-base text-left " + (selected ? "bg-primary-fixed/50" : "hover:bg-surface-container-low")}
    >
      <span className="flex flex-wrap items-center gap-xs min-w-0 text-body-md">{children}</span>
      <span className="h-2 rounded bg-surface-container overflow-hidden">
        <span className={"block h-full rounded " + bar} style={{ width: `${max ? Math.min(100, (count / max) * 100) : 0}%` }} />
      </span>
      <span className="text-right font-semibold tabular-nums">{n(count)}</span>
    </button>
  );
}

function Worklist({
  rows,
  tab,
  now,
  person,
  campaignName,
}: {
  rows: ReplyRow[];
  tab: WorklistTab;
  now: number;
  person: (id: string | null) => string;
  campaignName: (id: string) => string;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-lg text-center text-on-surface-variant">
        {tab === "waiting" ? (
          <>
            <b className="block text-green-700 text-body-lg">Every reply has an answer</b>
            Nothing is waiting in this selection.
          </>
        ) : tab === "no_owner" ? (
          <>
            <b className="block text-green-700 text-body-lg">No unassigned replies</b>
            Every reply in this selection has an owner.
          </>
        ) : (
          "No replies in this selection."
        )}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-outline-variant">
      <table className="w-full min-w-[980px] text-body-md">
        <thead>
          <tr className="bg-surface-container-low text-left text-caption uppercase tracking-wide text-on-surface-variant">
            <th className="px-sm py-base font-semibold">Candidate</th>
            <th className="px-sm py-base font-semibold">Campaign</th>
            <th className="px-sm py-base font-semibold">Their message</th>
            <th className="px-sm py-base font-semibold">Owner</th>
            <th className="px-sm py-base font-semibold">Our response</th>
            <th className="px-sm py-base font-semibold">24h window</th>
            <th className="px-sm py-base font-semibold">Lead after the reply</th>
            <th className="px-sm py-base" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const waiting = r.state === "waiting";
            const since = now - r.lastInboundAt;
            const left = SESSION_WINDOW_MS - since;
            return (
              <tr key={r.id} className="border-t border-outline-variant align-top">
                <td className="px-sm py-base">
                  {r.leadId ? (
                    <Link href={`/crm/leads/${r.leadId}`} className="font-semibold hover:underline">
                      {r.candidateName}
                    </Link>
                  ) : (
                    <b>{r.candidateName}</b>
                  )}
                  <div className="text-caption text-on-surface-variant tabular-nums">{r.phone}</div>
                  {r.stageNow && <div className="mt-xs"><Stage label={r.stageNow} /></div>}
                </td>
                <td className="px-sm py-base">
                  <span className="text-label-sm">{campaignName(r.campaignId)}</span>
                  <div className="text-caption text-on-surface-variant">Sent {fmtDay(r.sentAt)}</div>
                </td>
                <td className="px-sm py-base max-w-[240px]">
                  <span className="break-words">“{r.firstText ?? "—"}”</span>
                  <div className="text-caption text-on-surface-variant mt-xs">
                    {r.lastText && <span className="break-words">then: “{r.lastText}” · </span>}
                    {fmtWhen(r.lastInboundAt)}
                  </div>
                </td>
                <td className="px-sm py-base">{r.ownerId ? person(r.ownerId) : <Pill tone="red">No owner</Pill>}</td>
                <td className="px-sm py-base">
                  {waiting ? (
                    <>
                      <Pill tone={since > 4 * HOUR_MS ? "red" : "amber"}>Waiting {formatDuration(since)}</Pill>
                      {r.firstResponseAt !== null && <div className="text-caption text-on-surface-variant mt-xs">Answered earlier, they wrote again</div>}
                    </>
                  ) : r.state === "opted_out" ? (
                    <>
                      <Pill tone="gray">Opted out</Pill>
                      <div className="text-caption text-on-surface-variant mt-xs">No reply needed</div>
                    </>
                  ) : (
                    <>
                      <Pill tone="green">
                        {r.answeredVia === "call" ? "Called" : "Replied"}
                        {r.firstResponseAt !== null ? ` in ${formatDuration(r.firstResponseAt - r.firstReplyAt)}` : ""}
                      </Pill>
                      {r.firstResponseBy && <div className="text-caption text-on-surface-variant mt-xs">by {person(r.firstResponseBy)}</div>}
                    </>
                  )}
                </td>
                <td className="px-sm py-base">
                  {sessionOpen(r, now) ? (
                    <Pill tone={waiting && left < 4 * HOUR_MS ? "amber" : "blue"}>Open · {formatDuration(left)} left</Pill>
                  ) : (
                    <>
                      <Pill tone="gray">Closed</Pill>
                      {waiting && <div className="text-caption text-on-surface-variant mt-xs">Send a template first</div>}
                    </>
                  )}
                </td>
                <td className="px-sm py-base">
                  <div className="flex flex-col items-start gap-xs">
                    {r.move && (
                      <span className="flex flex-wrap items-center gap-xs">
                        <Stage label={r.move.from} />
                        <span className="text-on-surface-variant">→</span>
                        <Stage label={r.move.to} />
                        {r.move.auto && <span className="text-[10px] font-semibold uppercase text-on-surface-variant border border-outline-variant rounded px-xs">auto</span>}
                      </span>
                    )}
                    {r.ownerChange && (
                      <span className="text-caption">
                        {r.ownerChange.fromId ? `${person(r.ownerChange.fromId)} → ` : "Assigned to "}
                        <b>{person(r.ownerChange.toId)}</b>
                      </span>
                    )}
                    {!r.move && !r.ownerChange && <span className="text-caption text-on-surface-variant">No change</span>}
                  </div>
                </td>
                <td className="px-sm py-base text-right">
                  <Link
                    href={`/crm/inbox?conversation=${r.conversationId}`}
                    className={
                      "inline-flex items-center h-8 px-sm rounded-lg text-label-sm font-semibold whitespace-nowrap " +
                      (waiting ? "bg-primary text-on-primary" : "border border-outline-variant hover:bg-surface-container-low")
                    }
                  >
                    {waiting ? (r.ownerId ? "Reply" : "Assign") : "Open chat"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Definitions() {
  const defs: Array<[string, string]> = [
    ["Sent", "Messages handed to WhatsApp. Skipped numbers (opted out, no number, known undeliverable) are not sent."],
    ["Delivered", "WhatsApp confirmed it reached the phone. Includes read, and anyone who replied."],
    ["Read", "WhatsApp sent a read receipt, or the person replied. People with read receipts off only show here if they reply."],
    ["Failed", "WhatsApp refused it or could not deliver it. Error codes are in the campaign's own report on Broadcasts."],
    ["Replied", "They wrote to us after the campaign, with the first message inside the window chosen above, and before any later campaign reached the same number."],
    ["Answered", "After their latest message, a person sent a WhatsApp message or logged a call on the lead. Automatic messages (intro, drip, reminders) do not count."],
    ["Needs reply", "Their latest message has no answer yet. If they write again after we answered, the reply comes back to this list."],
    ["Opted out", "Their latest message was an opt-out such as STOP. No reply is needed."],
    ["24h window", "WhatsApp allows a free-text reply only within 24 hours of their last message. After that, send an approved template first."],
    ["No owner", "The lead has no assigned BDE, for example in Centralised Marketing. Assign it so someone answers."],
    ["Stage change", "The stage before the first change after the reply, against the stage after the last one. “auto” means the system moved it."],
    ["New owner", "The lead was assigned, reassigned or unassigned after the reply."],
  ];
  return (
    <details className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
      <summary className="cursor-pointer text-body-lg font-semibold">How each number is counted</summary>
      <dl className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-x-md gap-y-base mt-md text-body-md max-w-4xl">
        {defs.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold">{k}</dt>
            <dd className="text-on-surface-variant mb-sm md:mb-0">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
