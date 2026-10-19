import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  NO_OWNER,
  applyFilter,
  attributeReply,
  deliveryOutcome,
  formatDuration,
  matchesFocus,
  ownerChangeAfter,
  ownerChangeCounts,
  parseStatusChange,
  resolveRange,
  stageMoveAfter,
  stageMoveCounts,
  summarise,
  summariseByOwner,
  worklist,
  worklistCounts,
  type FunnelGroup,
  type LeadEvent,
  type ReplyRow,
  type ThreadEvent,
} from "@/lib/wa/broadcast-report";
import { isOptOutMessage } from "@/lib/wa/inbound";

const T0 = Date.parse("2026-10-10T10:00:00+05:30");
const h = (n: number) => T0 + n * HOUR_MS;
const isOptOut = (t: string | null) => isOptOutMessage(t);

function attribute(events: ThreadEvent[], over: Partial<{ nextSendAt: number | null; windowDays: number }> = {}) {
  return attributeReply({ sentAt: T0, nextSendAt: over.nextSendAt ?? null, windowDays: over.windowDays ?? 7, events, isOptOut });
}

describe("deliveryOutcome", () => {
  it("prefers Meta's state, then our send lifecycle", () => {
    expect(deliveryOutcome("sent", "read")).toBe("read");
    expect(deliveryOutcome("sent", "delivered")).toBe("delivered");
    expect(deliveryOutcome("sent", "failed")).toBe("failed");
    expect(deliveryOutcome("failed", null)).toBe("failed");
    expect(deliveryOutcome("skipped", null)).toBe("skipped");
    expect(deliveryOutcome("sent", "sent")).toBe("accepted");
    expect(deliveryOutcome("sent", null)).toBe("accepted");
    expect(deliveryOutcome("pending", null)).toBe("pending");
    expect(deliveryOutcome("sending", null)).toBe("pending");
  });
});

describe("attributeReply", () => {
  it("is null when they never wrote after the send", () => {
    expect(attribute([{ kind: "in", at: h(-5), text: "earlier chat" }])).toBeNull();
  });

  it("is null when the first reply is outside the window", () => {
    expect(attribute([{ kind: "in", at: T0 + 8 * DAY_MS, text: "hi" }], { windowDays: 7 })).toBeNull();
    expect(attribute([{ kind: "in", at: T0 + 8 * DAY_MS, text: "hi" }], { windowDays: 14 })).not.toBeNull();
  });

  // Without the cut, a reply to campaign B would count for campaign A as well.
  it("stops at the next campaign sent to the same number", () => {
    expect(attribute([{ kind: "in", at: h(30), text: "hi" }], { nextSendAt: h(24) })).toBeNull();
    const r = attribute(
      [
        { kind: "in", at: h(2), text: "first" },
        { kind: "in", at: h(30), text: "answers the next campaign" },
      ],
      { nextSendAt: h(24) },
    );
    expect(r?.lastInboundAt).toBe(h(2));
    expect(r?.inboundCount).toBe(1);
  });

  it("is waiting until a person answers after the latest message", () => {
    const r = attribute([{ kind: "in", at: h(1), text: "What is the fee?" }]);
    expect(r?.state).toBe("waiting");
    expect(r?.firstResponseAt).toBeNull();
  });

  it("is answered by a WhatsApp reply or a logged call", () => {
    const wa = attribute([
      { kind: "in", at: h(1), text: "fee?" },
      { kind: "out", at: h(1.5), by: "u1" },
    ]);
    expect(wa?.state).toBe("answered");
    expect(wa?.answeredVia).toBe("whatsapp");
    expect(wa?.firstResponseAt! - wa!.firstReplyAt).toBe(0.5 * HOUR_MS);
    expect(wa?.firstResponseBy).toBe("u1");

    const call = attribute([
      { kind: "in", at: h(1), text: "call me" },
      { kind: "call", at: h(3), by: "u2" },
    ]);
    expect(call?.state).toBe("answered");
    expect(call?.answeredVia).toBe("call");
  });

  it("goes back to waiting when they write again after our answer", () => {
    const r = attribute([
      { kind: "in", at: h(1), text: "fee?" },
      { kind: "out", at: h(2), by: "u1" },
      { kind: "in", at: h(5), text: "any update?" },
    ]);
    expect(r?.state).toBe("waiting");
    expect(r?.firstResponseAt).toBe(h(2)); // response time still measured
    expect(r?.lastText).toBe("any update?");
    expect(r?.inboundCount).toBe(2);
  });

  it("does not count an answer sent before their message", () => {
    const r = attribute([
      { kind: "out", at: h(0.5), by: "u1" },
      { kind: "in", at: h(1), text: "hi" },
    ]);
    expect(r?.state).toBe("waiting");
  });

  it("treats an unanswered opt-out as needing no reply", () => {
    expect(attribute([{ kind: "in", at: h(1), text: "STOP" }])?.state).toBe("opted_out");
    // Answering it anyway is still an answer.
    expect(
      attribute([
        { kind: "in", at: h(1), text: "STOP" },
        { kind: "out", at: h(2), by: "u1" },
      ])?.state,
    ).toBe("answered");
    // A sentence containing "stop" is a real question.
    expect(attribute([{ kind: "in", at: h(1), text: "please stop calling, message instead" }])?.state).toBe("waiting");
  });
});

describe("stage changes", () => {
  const ev = (at: number, summary: string, actorId: string | null = "u1"): LeadEvent => ({
    at,
    type: "STATUS_CHANGED",
    summary,
    metadata: null,
    actorId,
  });

  it("parses the summary, falling back to metadata", () => {
    expect(parseStatusChange("Status changed: Follow Up → Pipeline", null)).toEqual({ from: "Follow Up", to: "Pipeline" });
    expect(parseStatusChange(null, { from: "New", to: "Follow Up" })).toEqual({ from: "New", to: "Follow Up" });
    expect(parseStatusChange("Something else", { to: "enrolled" })).toEqual({ from: null, to: "enrolled" });
  });

  it("reports the net move after the reply", () => {
    const events = [
      ev(h(-10), "Status changed: New → Follow Up"), // before the reply — ignored
      ev(h(3), "Status changed: Follow Up → Pipeline"),
      ev(h(9), "Status changed: Pipeline → Enrolled"),
    ];
    expect(stageMoveAfter(events, h(1))).toEqual({ from: "Follow Up", to: "Enrolled", auto: false });
  });

  it("is null when the lead moved and moved back", () => {
    expect(stageMoveAfter([ev(h(3), "Status changed: Follow Up → Pipeline"), ev(h(4), "Status changed: Pipeline → Follow Up")], h(1))).toBeNull();
  });

  it("marks a move made only by the system as auto", () => {
    expect(stageMoveAfter([ev(h(1), "Status changed: Re-marketing → Follow Up", null)], h(1))?.auto).toBe(true);
  });
});

describe("ownerChangeAfter", () => {
  const ev = (at: number, type: string, fromUserId: string | null, toUserId: string | null): LeadEvent => ({
    at,
    type,
    summary: null,
    metadata: { fromUserId, toUserId },
    actorId: "admin",
  });

  it("reads assign, reassign and unassign", () => {
    expect(ownerChangeAfter([ev(h(2), "ASSIGNED", null, "a")], h(1))).toEqual({ fromId: null, toId: "a" });
    expect(ownerChangeAfter([ev(h(2), "REASSIGNED", "a", "b"), ev(h(3), "REASSIGNED", "b", "c")], h(1))).toEqual({ fromId: "a", toId: "c" });
    expect(ownerChangeAfter([ev(h(2), "UNASSIGNED", "a", null)], h(1))).toEqual({ fromId: "a", toId: null });
  });

  it("ignores changes before the reply, round trips, and assignments without a target", () => {
    expect(ownerChangeAfter([ev(h(0.5), "ASSIGNED", null, "a")], h(1))).toBeNull();
    expect(ownerChangeAfter([ev(h(2), "REASSIGNED", "a", "b"), ev(h(3), "REASSIGNED", "b", "a")], h(1))).toBeNull();
    expect(ownerChangeAfter([{ at: h(2), type: "ASSIGNED", summary: null, metadata: {}, actorId: null }], h(1))).toBeNull();
  });
});

function row(over: Partial<ReplyRow>): ReplyRow {
  return {
    id: Math.random().toString(36).slice(2),
    campaignId: "c1",
    leadId: "l1",
    conversationId: "conv1",
    candidateName: "Test",
    phone: "+910000000000",
    ownerId: "a",
    stageNow: "Follow Up",
    delivery: "read",
    sentAt: T0,
    firstReplyAt: h(1),
    lastInboundAt: h(1),
    firstText: "hi",
    lastText: null,
    inboundCount: 1,
    state: "waiting",
    firstResponseAt: null,
    firstResponseBy: null,
    firstResponseVia: null,
    answeredVia: null,
    move: null,
    ownerChange: null,
    ...over,
  };
}

describe("summarise", () => {
  const groups: FunnelGroup[] = [
    { campaignId: "c1", ownerId: "a", outcome: "read", n: 10 },
    { campaignId: "c1", ownerId: "a", outcome: "delivered", n: 20 },
    { campaignId: "c1", ownerId: "a", outcome: "accepted", n: 5 },
    { campaignId: "c1", ownerId: null, outcome: "failed", n: 3 },
    { campaignId: "c1", ownerId: null, outcome: "skipped", n: 2 },
    { campaignId: "c2", ownerId: "b", outcome: "pending", n: 4 },
  ];
  const now = h(30);

  it("builds the funnel, counting a reply as proof of delivery and read", () => {
    const replies = [row({ delivery: "accepted" }), row({ delivery: "delivered" }), row({ delivery: "read" })];
    const s = summarise(groups, replies, 7, now);
    expect(s.sent).toBe(38); // 10 + 20 + 5 + 3 failed
    expect(s.delivered).toBe(31); // 30 + the accepted one that replied
    expect(s.read).toBe(12); // 10 + accepted + delivered that replied
    expect(s.failed).toBe(3);
    expect(s.skipped).toBe(2);
    expect(s.pending).toBe(4);
    expect(s.replied).toBe(3);
  });

  it("splits replies into answered, opted out and waiting", () => {
    const replies = [
      row({ state: "answered", answeredVia: "whatsapp", firstResponseAt: h(1.5) }),
      row({ state: "answered", answeredVia: "call", firstResponseAt: h(3) }),
      row({ state: "opted_out" }),
      row({ state: "waiting", lastInboundAt: h(20) }), // 10h ago: window open
      row({ state: "waiting", lastInboundAt: h(2), ownerId: null }), // 28h ago: closed, no owner
      row({ state: "waiting", firstReplyAt: T0 + 9 * DAY_MS, lastInboundAt: T0 + 9 * DAY_MS }), // outside 7 days
    ];
    const s = summarise(groups, replies, 7, now);
    expect(s.replied).toBe(5);
    expect(s.answered).toBe(2);
    expect(s.answeredByCall).toBe(1);
    expect(s.optedOut).toBe(1);
    expect(s.handled).toBe(3);
    expect(s.waiting).toBe(2);
    expect(s.waitingOpen).toBe(1);
    expect(s.waitingClosed).toBe(1);
    expect(s.waitingNoOwner).toBe(1);
    expect(s.oldestWaitingMs).toBe(28 * HOUR_MS);
    expect(s.medianFirstResponseMs).toBe(1.25 * HOUR_MS); // median of 0.5h and 2h
    expect(summarise(groups, replies, 14, now).replied).toBe(6);
  });

  it("counts lead outcomes", () => {
    const replies = [
      row({ move: { from: "Follow Up", to: "Pipeline", auto: false } }),
      row({ ownerChange: { fromId: null, toId: "a" } }),
      row({ move: { from: "Follow Up", to: "Pipeline", auto: false }, ownerChange: { fromId: "a", toId: "b" } }),
      row({}),
    ];
    const s = summarise([], replies, 7, now);
    expect(s.stageMoved).toBe(2);
    expect(s.ownerChanged).toBe(2);
    expect(s.noAction).toBe(1);
    expect(stageMoveCounts(replies)).toEqual([{ from: "Follow Up", to: "Pipeline", n: 2, auto: 0 }]);
    expect(ownerChangeCounts(replies)).toHaveLength(2);
  });

  it("filters by campaign and owner, with NO_OWNER for unassigned", () => {
    const replies = [row({ ownerId: null }), row({ ownerId: "a" }), row({ campaignId: "c2", ownerId: "b" })];
    const noOwner = applyFilter({ groups, replies }, { campaignIds: [], ownerKeys: [NO_OWNER] });
    expect(noOwner.replies).toHaveLength(1);
    expect(noOwner.groups.every((g) => g.ownerId === null)).toBe(true);
    const c2 = applyFilter({ groups, replies }, { campaignIds: ["c2"], ownerKeys: [] });
    expect(c2.replies).toHaveLength(1);
    expect(c2.groups).toHaveLength(1);
  });

  it("gives every owner with a send or a reply a row", () => {
    const keys = summariseByOwner(groups, [row({ ownerId: "z" })], 7, now).map((r) => r.key).sort();
    expect(keys).toEqual([NO_OWNER, "a", "b", "z"].sort());
  });
});

describe("worklist", () => {
  const a = row({ id: "a", state: "waiting", lastInboundAt: h(5) });
  const b = row({ id: "b", state: "waiting", lastInboundAt: h(1) });
  const c = row({ id: "c", state: "answered", lastInboundAt: h(9) });
  const d = row({ id: "d", state: "opted_out", lastInboundAt: h(2), ownerId: null });

  it("puts the longest-waiting first, then everything else newest first", () => {
    expect(worklist([a, b, c, d], "waiting").map((r) => r.id)).toEqual(["b", "a"]);
    expect(worklist([a, b, c, d], "all").map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    expect(worklist([a, b, c, d], "handled").map((r) => r.id)).toEqual(["c", "d"]);
    expect(worklist([a, b, c, d], "no_owner").map((r) => r.id)).toEqual(["d"]);
  });

  it("counts every tab", () => {
    expect(worklistCounts([a, b, c, d])).toEqual({ waiting: 2, no_owner: 1, handled: 2, all: 4 });
  });

  it("drills down from the outcome panels", () => {
    const moved = row({ move: { from: "A", to: "B", auto: false } });
    const reassigned = row({ ownerChange: { fromId: null, toId: "x" } });
    expect(matchesFocus(moved, { kind: "move", from: "A", to: "B" })).toBe(true);
    expect(matchesFocus(moved, { kind: "move", from: "A", to: "C" })).toBe(false);
    expect(matchesFocus(reassigned, { kind: "owner_change", fromId: null, toId: "x" })).toBe(true);
    expect(matchesFocus(row({}), { kind: "no_action" })).toBe(true);
    expect(matchesFocus(moved, { kind: "no_action" })).toBe(false);
  });
});

describe("resolveRange", () => {
  const now = new Date("2026-10-19T09:00:00Z"); // 14:30 IST

  it("reads the presets", () => {
    expect(resolveRange("7d", undefined, undefined, now).from.getTime()).toBe(now.getTime() - 7 * DAY_MS);
    expect(resolveRange("month", undefined, undefined, now).from.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    const last = resolveRange("last_month", undefined, undefined, now);
    expect(last.from.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(last.to?.toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  it("wraps last month across a year end", () => {
    const jan = resolveRange("last_month", undefined, undefined, new Date("2027-01-10T06:00:00Z"));
    expect(jan.from.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });

  it("takes inclusive IST custom days and falls back to 30 days when unreadable", () => {
    const c = resolveRange("custom", "2026-10-01", "2026-10-03", now);
    expect(c.key).toBe("custom");
    expect(c.from.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(c.to?.toISOString()).toBe("2026-10-03T18:30:00.000Z");
    expect(resolveRange("custom", "2026-10-05", "2026-10-01", now).key).toBe("30d");
    expect(resolveRange("custom", "nope", "2026-10-01", now).key).toBe("30d");
    expect(resolveRange(undefined, undefined, undefined, now).key).toBe("30d");
  });
});

describe("formatDuration", () => {
  it("reads at a glance", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(20_000)).toBe("1m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(3 * HOUR_MS + 20 * 60_000)).toBe("3h 20m");
    expect(formatDuration(2 * DAY_MS + 4 * HOUR_MS)).toBe("2d 4h");
  });
});
