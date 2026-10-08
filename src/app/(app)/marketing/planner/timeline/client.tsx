"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_LABELS,
  DISPLAY_STATUS_LABELS,
  MKT_PLANNER_HREF,
  daysBetween,
  fyMonthFirstDay,
  fyMonthLastDay,
  formatLakh,
  pctOf,
  prorateBudget,
  timelineBar,
  type CampaignSummaryDto,
  type DisplayStatus,
  type UserOpt,
} from "@/lib/mkt-planner-shared";
import { Card, Icon, cardStyle, faintText, inputStyle, mutedText, statusLook } from "../_ui";

const STATUS_FILTERS: DisplayStatus[] = ["live", "approved", "awaiting", "draft", "done"];
const TRACK_LABEL_W = 280;

export function TimelineClient({
  fy,
  range,
  today,
  prev,
  next,
  campaigns,
  ideas,
  awaiting,
  admin,
  allocation,
  planned,
  users,
  initialStatus,
}: {
  fy: number;
  range: { start: string; end: string; months: number[]; label: string };
  today: string;
  prev: { fy: number; q: number } | null;
  next: { fy: number; q: number } | null;
  campaigns: CampaignSummaryDto[];
  ideas: CampaignSummaryDto[];
  awaiting: CampaignSummaryDto[];
  admin: boolean;
  allocation: number;
  planned: { committedLike: number; awaiting: number; draft: number };
  users: UserOpt[];
  initialStatus: string;
}) {
  const [type, setType] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [owner, setOwner] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);

  const visible = useMemo(
    () =>
      campaigns.filter(
        (c) =>
          (!type || c.type === type) &&
          (!status || c.display === status) &&
          (!owner || c.ownerId === owner) &&
          (showCancelled || c.status !== "cancelled"),
      ),
    [campaigns, type, status, owner, showCancelled],
  );

  const span = daysBetween(range.start, range.end) + 1;
  const monthDays = range.months.map((m) => daysBetween(fyMonthFirstDay(fy, m), fyMonthLastDay(fy, m)) + 1);
  const monthCols = monthDays.map((d) => `${d}fr`).join(" ");
  const todayPct = today >= range.start && today <= range.end ? ((daysBetween(range.start, today) + 0.5) / span) * 100 : null;
  const monthName = (m: number) => new Date(`${fyMonthFirstDay(fy, m)}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });

  const total = planned.committedLike + planned.awaiting + planned.draft;
  const scale = Math.max(total, allocation, 1);
  const over = total - allocation;

  const groups = CAMPAIGN_TYPES.map((t) => ({
    type: t,
    items: visible.filter((c) => c.type === t),
  })).filter((g) => g.items.length);

  const quarterHref = (p: { fy: number; q: number }) => `${MKT_PLANNER_HREF}/timeline?fy=${p.fy}&q=${p.q}`;
  const navBtn = "w-[40px] h-[40px] rounded-[8px] border flex items-center justify-center";

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-[12px]">
        <div className="flex items-center gap-[4px]">
          {prev ? (
            <Link href={quarterHref(prev)} aria-label="Previous quarter" className={navBtn} style={inputStyle}>
              <Icon name="chevron_left" />
            </Link>
          ) : (
            <span className={`${navBtn} opacity-40`} style={inputStyle} aria-hidden="true">
              <Icon name="chevron_left" />
            </span>
          )}
          <h2 className="font-display text-[16px] font-semibold px-[10px] whitespace-nowrap">{range.label}</h2>
          {next ? (
            <Link href={quarterHref(next)} aria-label="Next quarter" className={navBtn} style={inputStyle}>
              <Icon name="chevron_right" />
            </Link>
          ) : (
            <span className={`${navBtn} opacity-40`} style={inputStyle} aria-hidden="true">
              <Icon name="chevron_right" />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <Filter label="Type" value={type} onChange={setType} options={CAMPAIGN_TYPES.map((t) => [t, CAMPAIGN_TYPE_LABELS[t]])} all="All types" />
          <Filter label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS.map((s) => [s, DISPLAY_STATUS_LABELS[s]])} all="Any status" />
          <Filter label="Owner" value={owner} onChange={setOwner} options={users.map((u) => [u.id, u.username])} all="Anyone" />
          <label className="flex items-center gap-[6px] text-[12px] min-h-[40px]" style={faintText}>
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} style={{ accentColor: "#facc15" }} />
            Cancelled
          </label>
        </div>
      </div>

      {awaiting.length > 0 && (
        <Card
          title={admin ? `Waiting for your approval · ${awaiting.length}` : `Awaiting approval · ${awaiting.length}`}
          subtitle={`${formatLakh(awaiting.reduce((a, c) => a + c.budget, 0))} requested in all, across every quarter.`}
        >
          <ul className="flex flex-col">
            {awaiting.map((c) => (
              <li key={c.id} className="border-b last:border-b-0" style={{ borderColor: "var(--lp-surface-container-high)" }}>
                <Link href={`${MKT_PLANNER_HREF}/campaigns/${c.id}`} className="flex flex-wrap items-center justify-between gap-[6px_16px] py-[10px]">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{c.name}</span>
                    <span className="block text-[12px]" style={faintText}>
                      {CAMPAIGN_TYPE_LABELS[c.type]} · {c.startDate}
                      {c.endDate && c.endDate !== c.startDate ? ` → ${c.endDate}` : ""}
                      {c.ownerName ? ` · ${c.ownerName}` : ""}
                    </span>
                  </span>
                  <span className="font-mono text-[13px]">{formatLakh(c.budget)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Quarter budget */}
      <section aria-label="Quarter budget" className="rounded-[12px] border px-[20px] py-[16px] flex flex-wrap items-center gap-[16px_32px]" style={cardStyle}>
        <div>
          <p className="text-[12px]" style={faintText}>Quarter allocation</p>
          <p className="font-mono text-[22px]">{formatLakh(allocation)}</p>
        </div>
        <div>
          <p className="text-[12px]" style={faintText}>Planned in the quarter</p>
          <p className="font-mono text-[22px]" style={{ color: over > 0 ? "var(--lp-orange)" : undefined }}>{formatLakh(total)}</p>
        </div>
        <div className="flex-[1_1_360px] min-w-0 flex flex-col gap-[8px]">
          <div className="relative h-[12px] rounded-[6px] flex gap-[2px]" style={{ backgroundColor: "var(--lp-surface-container-high)" }}>
            {planned.committedLike > 0 && <div title={`Live, approved and done: ${formatLakh(planned.committedLike)}`} style={{ width: `${pctOf(planned.committedLike, scale)}%`, backgroundColor: "#facc15", borderRadius: "6px 0 0 6px" }} />}
            {planned.awaiting > 0 && <div title={`Awaiting approval: ${formatLakh(planned.awaiting)}`} style={{ width: `${pctOf(planned.awaiting, scale)}%`, backgroundColor: "rgba(250, 204, 21, 0.45)" }} />}
            {planned.draft > 0 && <div title={`Draft: ${formatLakh(planned.draft)}`} style={{ width: `${pctOf(planned.draft, scale)}%`, border: "1px dashed #9a9078", boxSizing: "border-box" }} />}
            {allocation > 0 && <div aria-hidden="true" className="absolute" style={{ left: `${pctOf(allocation, scale)}%`, top: -5, bottom: -5, width: 2, backgroundColor: "var(--lp-on-surface)" }} />}
          </div>
          <div className="flex flex-wrap gap-[6px_18px] text-[12px]" style={mutedText}>
            <span>Live + approved <span className="font-mono" style={{ color: "var(--lp-on-surface)" }}>{formatLakh(planned.committedLike)}</span></span>
            <span>Awaiting approval <span className="font-mono" style={{ color: "var(--lp-on-surface)" }}>{formatLakh(planned.awaiting)}</span></span>
            <span>Draft <span className="font-mono" style={{ color: "var(--lp-on-surface)" }}>{formatLakh(planned.draft)}</span></span>
            <span className="inline-flex items-center gap-[6px]"><span className="inline-block w-[2px] h-[12px]" style={{ backgroundColor: "var(--lp-on-surface)" }} />Allocation</span>
          </div>
        </div>
        <p className="flex-[1_1_240px] text-[13px] leading-relaxed" style={mutedText}>
          {over > 0 ? (
            <>
              Over by <span className="font-mono" style={{ color: "var(--lp-orange)" }}>{formatLakh(over)}</span>. Approving more pushes the quarter further past its allocation.{" "}
              <Link href={`${MKT_PLANNER_HREF}/budget?fy=${fy}`} className="font-medium" style={{ color: "var(--lp-primary)" }}>Rebalance budget</Link>
            </>
          ) : allocation > 0 ? (
            <>
              <span className="font-mono" style={{ color: "var(--lp-on-surface)" }}>{formatLakh(-over)}</span> of the quarter is still unplanned.
            </>
          ) : (
            "No budget allocated to these months yet."
          )}
        </p>
      </section>

      {/* Timeline */}
      <section aria-label="Quarter timeline" className="rounded-[12px] border overflow-hidden" style={cardStyle}>
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            <div className="grid border-b" style={{ gridTemplateColumns: `${TRACK_LABEL_W}px minmax(0,1fr)`, borderColor: "var(--lp-outline-variant)", backgroundColor: "var(--lp-surface-container-low)" }}>
              <div className="px-[16px] py-[11px] text-[11px] font-semibold uppercase tracking-wider" style={faintText}>
                Campaign · owner · budget
              </div>
              <div className="relative grid" style={{ gridTemplateColumns: monthCols }}>
                {range.months.map((m) => (
                  <div key={m} className="font-display px-[12px] py-[11px] text-[13px] font-semibold border-l" style={{ borderColor: "var(--lp-surface-container-high)" }}>
                    {monthName(m)}
                  </div>
                ))}
                {todayPct !== null && (
                  <span className="absolute top-[8px] -translate-x-1/2 text-[10px] font-bold rounded-[4px] px-[6px] py-[2px] whitespace-nowrap" style={{ left: `${todayPct}%`, backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}>
                    TODAY
                  </span>
                )}
              </div>
            </div>

            {groups.length === 0 && (
              <p className="px-[16px] py-[28px] text-[13px] text-center" style={mutedText}>
                {campaigns.length ? "Nothing matches these filters." : "Nothing planned for this quarter yet. Add a campaign to start."}
              </p>
            )}

            {groups.map((g) => {
              const groupTotal = g.items.reduce(
                (a, c) => a + (c.status === "cancelled" ? 0 : prorateBudget(c.budget, c.startDate, c.endDate, range.start, range.end)),
                0,
              );
              return (
                <div key={g.type}>
                  <div className="grid border-b" style={{ gridTemplateColumns: `${TRACK_LABEL_W}px minmax(0,1fr)`, borderColor: "var(--lp-surface-container-high)", backgroundColor: "var(--lp-surface-container-low)" }}>
                    <div className="px-[16px] py-[7px] flex justify-between items-center text-[11px] font-semibold tracking-[0.1em] uppercase" style={mutedText}>
                      {CAMPAIGN_TYPE_LABELS[g.type]}
                      <span className="font-mono tracking-normal font-medium" style={faintText} title="Share of these budgets falling in this quarter">
                        {formatLakh(groupTotal)}
                      </span>
                    </div>
                    <MonthLines cols={monthCols} />
                  </div>
                  {g.items.map((c) => {
                    const bar = timelineBar(c.startDate!, c.endDate, range.start, range.end);
                    if (!bar) return null;
                    const look = statusLook(c.display);
                    const oneDay = !c.endDate || c.endDate === c.startDate;
                    const narrow = bar.width < 14;
                    const tip = `${c.name} · ${c.startDate}${c.endDate && c.endDate !== c.startDate ? ` → ${c.endDate}` : ""} · ${formatLakh(c.budget)} · ${DISPLAY_STATUS_LABELS[c.display]}`;
                    const href = `${MKT_PLANNER_HREF}/campaigns/${c.id}`;
                    return (
                      <div key={c.id} className="grid border-b" style={{ gridTemplateColumns: `${TRACK_LABEL_W}px minmax(0,1fr)`, borderColor: "var(--lp-surface-container-high)" }}>
                        <div className="px-[16px] py-[9px] flex flex-col gap-[2px] min-w-0">
                          <Link href={href} className="text-[13px] font-medium truncate" style={{ textDecoration: look.strike ? "line-through" : undefined }}>
                            {c.name}
                          </Link>
                          <span className="text-[11px] truncate" style={faintText}>
                            {c.ownerName ?? "No owner"} · <span className="font-mono">{formatLakh(c.budget)}</span>
                          </span>
                        </div>
                        <div className="relative h-[54px]">
                          <MonthLines cols={monthCols} absolute />
                          {todayPct !== null && <div aria-hidden="true" className="absolute top-0 bottom-0 w-[2px]" style={{ left: `${todayPct}%`, backgroundColor: "rgba(250, 204, 21, 0.5)" }} />}
                          {oneDay ? (
                            <Link href={href} title={tip} className="absolute top-[11px] h-[32px] flex items-center gap-[8px] text-[12px] font-medium whitespace-nowrap" style={{ left: `${bar.left}%` }}>
                              <span className="inline-block w-[14px] h-[14px] rotate-45" style={{ backgroundColor: look.bg === "transparent" ? undefined : look.bg, border: look.border }} />
                              {c.name} · {formatLakh(c.budget)}
                            </Link>
                          ) : (
                            <>
                              <Link
                                href={href}
                                title={tip}
                                className="absolute top-[11px] h-[32px] flex items-center px-[10px] text-[12px] font-semibold whitespace-nowrap overflow-hidden"
                                style={{
                                  left: `${bar.left}%`,
                                  width: `${bar.width}%`,
                                  backgroundColor: look.bg,
                                  color: look.fg,
                                  border: look.border,
                                  textDecoration: look.strike ? "line-through" : undefined,
                                  borderRadius: `${bar.clippedStart ? 0 : 6}px ${bar.clippedEnd ? 0 : 6}px ${bar.clippedEnd ? 0 : 6}px ${bar.clippedStart ? 0 : 6}px`,
                                }}
                              >
                                <span className="truncate">{narrow ? "" : `${c.name} · ${formatLakh(c.budget)}`}</span>
                              </Link>
                              {narrow && (
                                <span className="absolute top-[11px] h-[32px] flex items-center text-[12px] whitespace-nowrap pl-[6px]" style={{ left: `${bar.left + bar.width}%` }}>
                                  {c.name} · {formatLakh(c.budget)}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-[10px_22px] px-[16px] py-[13px] border-t text-[12px] items-center" style={{ ...mutedText, borderColor: "var(--lp-outline-variant)" }}>
          {(["live", "approved", "awaiting", "draft", "done"] as DisplayStatus[]).map((s) => {
            const l = statusLook(s);
            return (
              <span key={s} className="inline-flex items-center gap-[8px]">
                <span className="inline-block w-[22px] h-[12px] rounded-[3px]" style={{ backgroundColor: l.bg, border: l.border, boxSizing: "border-box" }} />
                {DISPLAY_STATUS_LABELS[s]}
              </span>
            );
          })}
          <span className="inline-flex items-center gap-[8px]">
            <span className="inline-block w-[10px] h-[10px] rotate-45" style={{ backgroundColor: "#9a9078" }} />
            One-day event
          </span>
        </div>
      </section>

      {/* Ideas */}
      <Card
        title="Unscheduled ideas"
        subtitle="Not counted in any budget until they get dates. A campaign created without dates lands here."
      >
        {ideas.length === 0 ? (
          <p className="text-[13px]" style={mutedText}>
            No ideas parked. Create a campaign without dates to keep one here.
          </p>
        ) : (
          <div className="flex flex-wrap gap-[10px]">
            {ideas.map((c) => (
              <div key={c.id} className="flex items-center gap-[12px] rounded-[10px] border px-[12px] py-[10px]" style={{ backgroundColor: "var(--lp-surface-container-low)", borderColor: "var(--lp-outline-variant)" }}>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{c.name}</p>
                  <p className="text-[11px]" style={faintText}>
                    {CAMPAIGN_TYPE_LABELS[c.type]}
                    {c.budget ? <> · est. <span className="font-mono">{formatLakh(c.budget)}</span></> : null}
                  </p>
                </div>
                <Link href={`${MKT_PLANNER_HREF}/campaigns/${c.id}?edit=1`} className="min-h-[36px] inline-flex items-center px-[12px] rounded-[6px] border text-[12px] font-semibold" style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-primary)" }}>
                  Schedule
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function MonthLines({ cols, absolute }: { cols: string; absolute?: boolean }) {
  return (
    <div aria-hidden="true" className={`${absolute ? "absolute inset-0" : ""} grid`} style={{ gridTemplateColumns: cols }}>
      <div className="border-l" style={{ borderColor: "var(--lp-surface-container-high)" }} />
      <div className="border-l" style={{ borderColor: "var(--lp-surface-container-high)" }} />
      <div className="border-l" style={{ borderColor: "var(--lp-surface-container-high)" }} />
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  all,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  all: string;
}) {
  return (
    <label className="flex items-center gap-[6px] text-[12px]" style={faintText}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-[8px] px-[10px] min-h-[40px] text-[13px] border outline-none" style={inputStyle}>
        <option value="">{all}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
