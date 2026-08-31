/**
 * Reading the re-marketing drip: what has gone out, what is due, and what any of
 * it achieved.
 *
 * The engine records only the four `touchNSentAt` stamps and derives everything
 * else at send time, which is right for a scheduler and useless for a report —
 * "when is touch 2 due for this lead" has never been answerable anywhere in the
 * CRM, and neither has "which touch earned the reply".
 *
 * Both are computable from what is already stored, so this module computes them
 * rather than adding columns. The one thing it must not do is compute them
 * DIFFERENTLY from the scheduler: a report that disagrees with the thing it
 * reports on is worse than no report. The day arithmetic here is deliberately
 * the same whole-calendar-day rule `daysBetween` applies.
 */

/**
 * `sent`         — it went out; `at` is when.
 * `due`          — its day has arrived and it has not gone. Either tonight's run
 *                  will take it, or something is stopping it, and those look
 *                  identical from here — which is exactly why it is worth showing.
 * `scheduled`    — a future date.
 * `unconfigured` — no offset for this touch, so it will never fire.
 */
export type TouchState = "sent" | "due" | "scheduled" | "unconfigured";

export type TouchCell = {
  /** 1-based, matching the `touchNSentAt` columns and the Wabis URL positions. */
  index: number;
  state: TouchState;
  /** When it was sent, or when it is expected. Null only when unconfigured. */
  at: Date | null;
  /** Meta/Wabis delivery state for a sent touch: delivered, read, failed… */
  delivery: string | null;
  errorCode: string | null;
};

/** Whole calendar days, matching the scheduler's own rule exactly. */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function buildTouchSchedule(input: {
  startedAt: Date;
  offsets: readonly number[];
  /** Positional, 1-based touch N at index N-1. Null where not yet sent. */
  sentAt: readonly (Date | null)[];
  /** Delivery outcome per touch, positional, from the outbox. */
  delivery?: readonly ({ status: string | null; errorCode: string | null } | null)[];
  now: Date;
  /** Hard cap, matching the four columns the campaign row actually has. */
  totalTouches?: number;
}): TouchCell[] {
  const total = input.totalTouches ?? 4;
  const cells: TouchCell[] = [];

  for (let i = 0; i < total; i++) {
    const sent = input.sentAt[i] ?? null;
    const outcome = input.delivery?.[i] ?? null;

    if (sent) {
      cells.push({
        index: i + 1,
        state: "sent",
        at: sent,
        delivery: outcome?.status ?? null,
        errorCode: outcome?.errorCode ?? null,
      });
      continue;
    }

    const offset = input.offsets[i];
    if (offset === undefined) {
      // No offset configured for this position. A campaign that has only ever
      // had three offsets will never fire a fourth, and saying so is more useful
      // than an empty cell that reads like "not yet".
      cells.push({ index: i + 1, state: "unconfigured", at: null, delivery: null, errorCode: null });
      continue;
    }

    const at = addDays(input.startedAt, offset);
    cells.push({
      index: i + 1,
      // `<=` rather than `<` so a touch whose day is today counts as due, which
      // is what the scheduler's `elapsed >= offset` also decides.
      state: at.getTime() <= input.now.getTime() ? "due" : "scheduled",
      at,
      delivery: null,
      errorCode: null,
    });
  }

  return cells;
}

/**
 * Which touch was the last to go out before the candidate replied.
 *
 * DERIVED, not recorded — the engine stores that a campaign ended and when, but
 * never which touch preceded it. Deriving it is what makes a per-touch reply rate
 * possible, and a reply rate per touch is the only evidence for whether touch 3
 * and touch 4 are worth sending at all. Attribution by "last touch before the
 * reply" is the same convention every drip tool uses; it is an attribution rule
 * rather than a fact, and a touch sent the same day is still credited.
 *
 * Null when the campaign ended without a reply, or replied before any touch — a
 * candidate who answered an earlier conversation entirely of their own accord.
 */
export function repliedAfterTouch(input: {
  sentAt: readonly (Date | null)[];
  endedAt: Date | null;
  status: string;
}): number | null {
  if (input.status !== "responded" || !input.endedAt) return null;
  const ended = input.endedAt.getTime();

  let latest: number | null = null;
  input.sentAt.forEach((at, i) => {
    if (at && at.getTime() <= ended) latest = i + 1;
  });
  return latest;
}

export type TouchFunnelRow = {
  index: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  /** Campaigns that ended in a reply attributed to this touch. */
  replied: number;
  /** Replies as a share of sends, the number the whole report exists to produce. */
  replyRate: number;
};

/**
 * Sends, outcomes and replies per touch.
 *
 * `delivered` counts every touch that reached the phone, INCLUDING the ones later
 * read — a message that was read was necessarily delivered, and reporting them as
 * separate populations would make the funnel appear to leak where it did not.
 */
export function buildFunnel(
  campaigns: readonly {
    sentAt: readonly (Date | null)[];
    delivery: readonly ({ status: string | null; errorCode: string | null } | null)[];
    endedAt: Date | null;
    status: string;
  }[],
  totalTouches = 4,
): TouchFunnelRow[] {
  const rows: TouchFunnelRow[] = Array.from({ length: totalTouches }, (_, i) => ({
    index: i + 1,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    replied: 0,
    replyRate: 0,
  }));

  for (const c of campaigns) {
    for (let i = 0; i < totalTouches; i++) {
      if (!c.sentAt[i]) continue;
      const row = rows[i];
      row.sent++;
      const state = c.delivery[i]?.status ?? null;
      if (state === "read") {
        row.read++;
        row.delivered++;
      } else if (state === "delivered") {
        row.delivered++;
      } else if (state === "failed") {
        row.failed++;
      }
    }

    const credited = repliedAfterTouch({ sentAt: c.sentAt, endedAt: c.endedAt, status: c.status });
    if (credited) rows[credited - 1].replied++;
  }

  for (const row of rows) {
    row.replyRate = row.sent > 0 ? row.replied / row.sent : 0;
  }
  return rows;
}

/**
 * The earliest touch that is due and unsent — what tonight's run would take for
 * this campaign.
 *
 * Earliest-first, matching the scheduler: a campaign that fell behind catches up
 * one touch per run rather than firing its whole backlog at a candidate at once.
 */
export function nextDueTouch(cells: readonly TouchCell[]): TouchCell | null {
  return cells.find((c) => c.state === "due") ?? null;
}

/** The next thing that will happen on this campaign, due or merely scheduled. */
export function nextUpcoming(cells: readonly TouchCell[]): TouchCell | null {
  return cells.find((c) => c.state === "due" || c.state === "scheduled") ?? null;
}
