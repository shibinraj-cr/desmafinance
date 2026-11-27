import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  NO_OWNER,
  ageBucket,
  bucketCounts,
  exchangeState,
  istDayStart,
  lateAnswers,
  pairExchanges,
  quantile,
  resolveTrackerRange,
  sortWaiting,
  summarise,
  summariseByOwner,
  waitingSince,
  windowOpen,
  type ExchangeRow,
  type TrackerMessage,
  type WaitingRow,
} from "@/lib/wa/reply-tracker";

const T0 = Date.parse("2026-11-27T10:00:00+05:30");
const m = (n: number) => T0 + n * MINUTE_MS;
const inMsg = (at: number): TrackerMessage => ({ direction: "in", occurredAt: at, sentById: null });
const human = (at: number, by = "u1"): TrackerMessage => ({ direction: "out", occurredAt: at, sentById: by });
const bot = (at: number): TrackerMessage => ({ direction: "out", occurredAt: at, sentById: null });

describe("pairExchanges", () => {
  it("joins messages in a row into one exchange answered by the next human reply", () => {
    const ex = pairExchanges([inMsg(m(0)), inMsg(m(2)), inMsg(m(5)), human(m(20))]);
    expect(ex).toEqual([{ askedAt: m(0), lastInboundAt: m(5), inboundCount: 3, answeredAt: m(20), answeredById: "u1" }]);
  });

  it("ignores automated sends — they neither answer nor start anything", () => {
    const ex = pairExchanges([bot(m(-10)), inMsg(m(0)), bot(m(1)), human(m(30), "u2")]);
    expect(ex).toHaveLength(1);
    expect(ex[0].answeredAt).toBe(m(30));
    expect(ex[0].answeredById).toBe("u2");
  });

  it("leaves the last exchange open when nobody has replied", () => {
    const ex = pairExchanges([inMsg(m(0)), human(m(5)), inMsg(m(60)), bot(m(61))]);
    expect(ex).toHaveLength(2);
    expect(ex[1]).toMatchObject({ askedAt: m(60), answeredAt: null });
  });

  it("does not count a human message with nothing to answer", () => {
    expect(pairExchanges([human(m(0)), human(m(1))])).toEqual([]);
  });

  it("sorts its input, so arrival order does not matter", () => {
    const ex = pairExchanges([human(m(20)), inMsg(m(5)), inMsg(m(0))]);
    expect(ex[0]).toMatchObject({ askedAt: m(0), answeredAt: m(20), inboundCount: 2 });
  });
});

describe("waitingSince", () => {
  it("dates the wait from the first unanswered message", () => {
    expect(waitingSince([inMsg(m(0)), human(m(5)), inMsg(m(10)), inMsg(m(15))])).toEqual({ since: m(10), inboundCount: 2 });
  });
  it("is null when the latest exchange was answered", () => {
    expect(waitingSince([inMsg(m(0)), human(m(5)), bot(m(6))])).toBeNull();
  });
});

describe("exchangeState", () => {
  const open = { askedAt: 0, lastInboundAt: 0, inboundCount: 1, answeredAt: null, answeredById: null };
  it("closed without a reply is its own state, not waiting", () => {
    expect(exchangeState(open, "closed")).toBe("closed");
    expect(exchangeState(open, "open")).toBe("waiting");
    expect(exchangeState({ ...open, answeredAt: 5 }, "closed")).toBe("answered");
  });
});

const row = (over: Partial<ExchangeRow>): ExchangeRow => ({
  conversationId: "c1",
  ownerId: "u1",
  askedAt: m(0),
  answeredAt: null,
  answeredById: null,
  inboundCount: 1,
  state: "waiting",
  ...over,
});

describe("summarise", () => {
  const sla = 60 * MINUTE_MS;
  const now = m(300);
  const rows = [
    row({ state: "answered", answeredAt: m(10) }), // on time
    row({ state: "answered", answeredAt: m(90) }), // late
    row({ askedAt: m(100) }), // waiting 200m → overdue
    row({ askedAt: m(280) }), // waiting 20m → pending
    row({ state: "closed" }),
  ];
  it("splits on time, late, overdue, pending and closed", () => {
    const s = summarise(rows, sla, now);
    expect(s).toMatchObject({ received: 5, answered: 2, onTime: 1, late: 1, overdue: 1, pending: 1, closed: 1, slaBase: 3 });
    expect(s.medianMs).toBe(10 * MINUTE_MS);
  });
  it("lists late answers slowest first", () => {
    const late = lateAnswers([...rows, row({ state: "answered", answeredAt: m(200) })], sla);
    expect(late.map((r) => r.answeredAt)).toEqual([m(200), m(90)]);
  });
});

describe("quantile", () => {
  it("returns the nearest-rank value", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });
});

const wait = (over: Partial<WaitingRow>): WaitingRow => ({
  conversationId: "c",
  phoneE164: "+910000000000",
  leadId: null,
  candidateName: null,
  stage: null,
  ownerId: null,
  since: m(0),
  lastInboundAt: m(0),
  inboundCount: 1,
  preview: null,
  sourceCampaign: null,
  ...over,
});

describe("waiting now", () => {
  it("buckets ages, with the 24h window as the last edge", () => {
    expect(ageBucket(5 * MINUTE_MS)).toBe("lt15m");
    expect(ageBucket(30 * MINUTE_MS)).toBe("lt1h");
    expect(ageBucket(2 * HOUR_MS)).toBe("lt4h");
    expect(ageBucket(10 * HOUR_MS)).toBe("lt24h");
    expect(ageBucket(DAY_MS)).toBe("over24h");
    const counts = bucketCounts([wait({ since: m(-5) }), wait({ since: m(-5 * 60) })], m(0));
    expect(counts.lt15m).toBe(1);
    expect(counts.lt24h).toBe(1);
  });

  it("reads the reply window from the LAST inbound message, not the first", () => {
    const w = wait({ since: m(-30 * 60), lastInboundAt: m(-60) });
    expect(windowOpen(w, m(0))).toBe(true);
    expect(windowOpen(wait({ lastInboundAt: m(-25 * 60) }), m(0))).toBe(false);
  });

  it("orders longest wait first", () => {
    const rows = sortWaiting([wait({ conversationId: "b", since: m(5) }), wait({ conversationId: "a", since: m(1) })]);
    expect(rows.map((r) => r.conversationId)).toEqual(["a", "b"]);
  });

  it("rolls up per owner, worst first, with no-owner as its own row", () => {
    const owners = summariseByOwner(
      [wait({ ownerId: "u1", since: m(-10) }), wait({ ownerId: null, since: m(-100) }), wait({ ownerId: null, since: m(-50) })],
      [row({ ownerId: "u2", state: "answered", answeredAt: m(5) })],
      60 * MINUTE_MS,
      m(0),
    );
    expect(owners.map((o) => o.key)).toEqual([NO_OWNER, "u1", "u2"]);
    expect(owners[0]).toMatchObject({ waitingNow: 2, oldestMs: 100 * MINUTE_MS });
    expect(owners[2].summary.onTime).toBe(1);
  });
});

describe("resolveTrackerRange", () => {
  const now = Date.parse("2026-11-27T01:00:00+05:30");
  it("cuts days at IST midnight", () => {
    expect(istDayStart(now)).toBe(Date.parse("2026-11-27T00:00:00+05:30"));
    expect(resolveTrackerRange(undefined, now)).toEqual({ key: "today", from: istDayStart(now), to: now });
    expect(resolveTrackerRange("yesterday", now)).toEqual({
      key: "yesterday",
      from: Date.parse("2026-11-26T00:00:00+05:30"),
      to: Date.parse("2026-11-27T00:00:00+05:30"),
    });
    expect(resolveTrackerRange("7d", now).from).toBe(Date.parse("2026-11-21T00:00:00+05:30"));
    expect(resolveTrackerRange("bogus", now).key).toBe("today");
  });
});
