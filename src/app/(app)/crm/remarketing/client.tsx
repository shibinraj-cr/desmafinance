"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TouchFunnelRow, TouchState } from "@/lib/crm-remarketing-report";

export type TouchView = {
  index: number;
  state: TouchState;
  at: string | null;
  delivery: string | null;
  errorCode: string | null;
};

export type CampaignRow = {
  id: string;
  leadId: string | null;
  candidateName: string;
  consultant: string | null;
  stage: string | null;
  startedAt: string;
  status: string;
  endedReason: string | null;
  undeliverable: boolean;
  repliedAfter: number | null;
  nextAt: string | null;
  nextIndex: number | null;
  nextDue: boolean;
  touches: TouchView[];
};

const FILTERS = ["due", "running", "replied", "ended", "all"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  due: "Due now",
  running: "Running",
  replied: "Replied",
  ended: "Ended",
  all: "All",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/**
 * A touch cell. Four states, and they must not be confusable at a glance — the
 * whole value of the board is telling "already gone" from "going to go" from
 * "should have gone and did not".
 */
function TouchCell({ touch }: { touch: TouchView }) {
  if (touch.state === "unconfigured") {
    return <span className="text-on-surface-variant/50" title="No offset configured for this touch">—</span>;
  }

  if (touch.state === "sent") {
    const d = touch.delivery;
    const tone =
      d === "read" ? "text-primary" : d === "failed" ? "text-error" : "text-on-surface-variant";
    const glyph = d === "read" || d === "delivered" ? "done_all" : d === "failed" ? "error" : "done";
    const label = d ? d[0].toUpperCase() + d.slice(1) : "Sent, no callback yet";
    return (
      <span
        className={"inline-flex items-center gap-xs whitespace-nowrap " + tone}
        title={touch.errorCode ? `${label} — Meta error ${touch.errorCode}` : label}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          {glyph}
        </span>
        <span className="tabular-nums">{fmt(touch.at)}</span>
      </span>
    );
  }

  // Due and scheduled share a shape but never a colour: one is a date in the
  // future, the other is a date that has passed with nothing sent.
  const due = touch.state === "due";
  return (
    <span
      className={"inline-flex items-center gap-xs whitespace-nowrap " + (due ? "text-error" : "text-on-surface-variant")}
      title={due ? "Due — the next scheduler run should take this" : "Scheduled"}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        {due ? "pending" : "schedule"}
      </span>
      <span className="tabular-nums">{fmt(touch.at)}</span>
    </span>
  );
}

export function RemarketingClient({
  rows,
  funnel,
  offsets,
  enabled,
  configuredTouches,
  truncated,
}: {
  rows: CampaignRow[];
  funnel: TouchFunnelRow[];
  offsets: number[];
  enabled: boolean;
  configuredTouches: number;
  truncated: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("due");
  const [search, setSearch] = useState("");

  const counts = useMemo(
    () => ({
      due: rows.filter((r) => r.nextDue).length,
      running: rows.filter((r) => r.status === "running").length,
      replied: rows.filter((r) => r.status === "responded").length,
      ended: rows.filter((r) => r.status === "completed" || r.status === "stopped").length,
      all: rows.length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === "due" && !r.nextDue) return false;
        if (filter === "running" && r.status !== "running") return false;
        if (filter === "replied" && r.status !== "responded") return false;
        if (filter === "ended" && r.status !== "completed" && r.status !== "stopped") return false;
        if (q && !r.candidateName.toLowerCase().includes(q) && !(r.consultant ?? "").toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      // Soonest first: the top of the list is always what happens next.
      .sort((a, b) => {
        if (!a.nextAt && !b.nextAt) return b.startedAt.localeCompare(a.startedAt);
        if (!a.nextAt) return 1;
        if (!b.nextAt) return -1;
        return a.nextAt.localeCompare(b.nextAt);
      });
  }, [rows, filter, search]);

  const card = "bg-surface-container-lowest border border-outline-variant rounded-xl";

  /**
   * The headline, in words.
   *
   * Everything below is in the funnel already, but "has touch 2 reached anybody"
   * is the question this page was built for and it was still being answered by
   * reading a cell out of a table. A configured touch that has never sent is the
   * striking fact, so it is the one stated outright.
   */
  const headline = useMemo(() => {
    const configured = funnel.filter((f) => offsets[f.index - 1] !== undefined);
    const totalSent = configured.reduce((n, f) => n + f.sent, 0);
    if (configured.length === 0) return "No touch schedule is configured, so nothing can be sent.";
    if (totalSent === 0) return "No touch has been sent to anybody yet.";

    const never = configured.filter((f) => f.sent === 0).map((f) => f.index);
    const reached = configured
      .filter((f) => f.sent > 0)
      .map((f) => `touch ${f.index} to ${f.sent.toLocaleString()}`)
      .join(", ");

    if (never.length === 0) return `Every configured touch has been sent — ${reached}.`;
    const list =
      never.length === 1
        ? `Touch ${never[0]} has`
        : `Touches ${never.slice(0, -1).join(", ")} and ${never[never.length - 1]} have`;
    return `${list} never been sent to anybody. So far: ${reached}.`;
  }, [funnel, offsets]);

  /** The very next thing the drip will do, named. */
  const nextUp = useMemo(() => {
    const upcoming = rows
      .filter((r) => r.status === "running" && r.nextAt)
      .sort((a, b) => a.nextAt!.localeCompare(b.nextAt!))[0];
    if (!upcoming) return null;
    return `Next: touch ${upcoming.nextIndex} for ${upcoming.candidateName}, ${
      upcoming.nextDue ? "due now" : `on ${fmt(upcoming.nextAt)}`
    }.`;
  }, [rows]);

  return (
    <div className="p-margin space-y-lg">
      {/* State of the engine, stated plainly. Every number below is meaningless
          if the drip is switched off or a touch has no destination — and that is
          exactly the confusion that prompted this page. */}
      {(!enabled || configuredTouches < offsets.length) && (
        <div className={card + " p-lg space-y-xs border-l-4 border-l-error"}>
          {!enabled && (
            <p className="text-body-md text-on-surface">
              <strong>The re-marketing engine is switched off.</strong> Nothing is being sent; the schedule below
              is what <em>would</em> go out.
            </p>
          )}
          {configuredTouches < offsets.length && (
            <p className="text-body-md text-on-surface">
              <strong>
                {configuredTouches} of {offsets.length} touches have a destination configured.
              </strong>{" "}
              Touches {configuredTouches + 1}–{offsets.length} cannot be sent until a workflow URL exists for
              each — CRM → Settings → Integrations, one line per touch, in order.
            </p>
          )}
        </div>
      )}

      {/* The funnel. Reply rate per touch is the only evidence for whether the
          later touches earn their cost. */}
      <div className={card + " p-lg"}>
        <h2 className="text-h3 text-on-surface mb-xs">Per touch</h2>
        <p className="text-body-md text-on-surface mb-xs">{headline}</p>
        {nextUp && <p className="text-label-sm text-on-surface-variant mb-xs">{nextUp}</p>}
        <p className="text-label-sm text-on-surface-variant mb-md">
          A reply is credited to the last touch sent before it — an attribution rule, not a recorded fact.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm min-w-[34rem]">
            <thead>
              <tr className="text-on-surface-variant">
                <th className="text-left font-medium pb-sm pr-md">Touch</th>
                <th className="text-right font-medium pb-sm px-md">Sent</th>
                <th className="text-right font-medium pb-sm px-md">Delivered</th>
                <th className="text-right font-medium pb-sm px-md">Read</th>
                <th className="text-right font-medium pb-sm px-md">Failed</th>
                <th className="text-right font-medium pb-sm px-md">Replied</th>
                <th className="text-right font-medium pb-sm pl-md">Rate</th>
              </tr>
            </thead>
            <tbody>
              {funnel.map((f) => (
                <tr key={f.index} className="border-t border-outline-variant">
                  <td className="py-sm pr-md text-on-surface">
                    Touch {f.index}
                    <span className="text-on-surface-variant">
                      {offsets[f.index - 1] !== undefined ? ` · day ${offsets[f.index - 1]}` : " · not configured"}
                    </span>
                  </td>
                  <td className="py-sm px-md text-right tabular-nums text-on-surface">{f.sent}</td>
                  <td className="py-sm px-md text-right tabular-nums text-on-surface-variant">{f.delivered}</td>
                  <td className="py-sm px-md text-right tabular-nums text-on-surface-variant">{f.read}</td>
                  <td className="py-sm px-md text-right tabular-nums text-error">{f.failed || ""}</td>
                  <td className="py-sm px-md text-right tabular-nums text-on-surface">{f.replied}</td>
                  <td className="py-sm pl-md text-right tabular-nums font-semibold text-on-surface">
                    {f.sent > 0 ? `${(f.replyRate * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card + " p-lg space-y-md"}>
        <div className="flex flex-wrap items-center gap-sm">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "h-8 px-md rounded-lg text-label-sm font-semibold transition " +
                (filter === f
                  ? "bg-primary text-on-primary"
                  : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {FILTER_LABEL[f]} <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Candidate or consultant…"
            className="h-8 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm outline-none focus:border-primary ml-auto w-56"
          />
        </div>

        {filter === "due" && counts.due > 0 && (
          <p className="text-label-sm text-on-surface-variant">
            What the next scheduler run should take — one touch per campaign, earliest first.
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-label-sm min-w-[52rem]">
            <thead>
              <tr className="text-on-surface-variant">
                <th className="text-left font-medium pb-sm pr-md">Candidate</th>
                <th className="text-left font-medium pb-sm px-md">Consultant</th>
                <th className="text-left font-medium pb-sm px-md">Stage</th>
                <th className="text-left font-medium pb-sm px-md">Started</th>
                {[1, 2, 3, 4].map((n) => (
                  <th key={n} className="text-left font-medium pb-sm px-md">
                    T{n}
                  </th>
                ))}
                <th className="text-left font-medium pb-sm pl-md">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-outline-variant align-top">
                  <td className="py-sm pr-md">
                    {r.leadId ? (
                      <Link href={`/crm/leads/${r.leadId}`} className="text-on-surface hover:text-primary">
                        {r.candidateName}
                      </Link>
                    ) : (
                      <span className="text-on-surface-variant">{r.candidateName}</span>
                    )}
                    {r.undeliverable && (
                      <span className="block text-error" title="This number was flagged undeliverable">
                        number undeliverable
                      </span>
                    )}
                  </td>
                  <td className="py-sm px-md text-on-surface-variant">{r.consultant ?? "—"}</td>
                  <td className="py-sm px-md text-on-surface-variant">{r.stage ?? "—"}</td>
                  <td className="py-sm px-md text-on-surface-variant tabular-nums">{fmt(r.startedAt)}</td>
                  {r.touches.map((t) => (
                    <td key={t.index} className="py-sm px-md">
                      <TouchCell touch={t} />
                    </td>
                  ))}
                  <td className="py-sm pl-md">
                    {r.status === "responded" ? (
                      <span className="text-primary font-semibold">
                        replied{r.repliedAfter ? ` · T${r.repliedAfter}` : ""}
                      </span>
                    ) : r.status === "running" ? (
                      <span className="text-on-surface-variant">running</span>
                    ) : (
                      <span className="text-on-surface-variant" title={r.endedReason ?? undefined}>
                        {r.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-lg text-center text-on-surface-variant">
                    {filter === "due"
                      ? "Nothing is due — every running campaign is waiting on a future date."
                      : "No campaigns match."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {truncated && (
          <p className="text-label-sm text-on-surface-variant">
            Showing the most recent 1,000 campaigns.
          </p>
        )}
      </div>
    </div>
  );
}
