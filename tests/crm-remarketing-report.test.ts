import { describe, it, expect } from "vitest";
import {
  addDays,
  buildFunnel,
  buildTouchSchedule,
  nextDueTouch,
  repliedAfterTouch,
} from "@/lib/crm-remarketing-report";
import { dueTouchIndex } from "@/lib/crm-remarketing";

/**
 * The report must agree with the scheduler. A page that says touch 2 is due
 * tonight while the scheduler disagrees is worse than no page — somebody would
 * act on it. The first block asserts that agreement directly rather than trusting
 * that the two day-arithmetics happen to match.
 */

const START = new Date("2026-08-01T09:00:00.000Z");
const OFFSETS = [5, 19, 33, 45];
const NONE = [null, null, null, null];

describe("buildTouchSchedule", () => {
  it("dates every unsent touch from the campaign start", () => {
    const cells = buildTouchSchedule({
      startedAt: START,
      offsets: OFFSETS,
      sentAt: NONE,
      now: START,
      });
    expect(cells).toHaveLength(4);
    expect(cells[1].index).toBe(2);
    // Day 19 from 1 Aug — the answer to "when does touch 2 go out for this lead",
    // which nothing in the CRM could previously say.
    expect(cells[1].at?.toISOString()).toBe(addDays(START, 19).toISOString());
    expect(cells[1].state).toBe("scheduled");
  });

  it("shows a sent touch with the date it actually went", () => {
    const sent = new Date("2026-08-07T04:00:00.000Z");
    const cells = buildTouchSchedule({
      startedAt: START,
      offsets: OFFSETS,
      sentAt: [sent, null, null, null],
      delivery: [{ status: "read", errorCode: null }, null, null, null],
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(cells[0].state).toBe("sent");
    expect(cells[0].at).toEqual(sent);
    expect(cells[0].delivery).toBe("read");
  });

  it("calls a touch DUE once its day has arrived and it has not gone", () => {
    // The state that matters operationally: either tonight's run takes it, or
    // something is stopping it, and those look identical from the outside.
    const cells = buildTouchSchedule({
      startedAt: START,
      offsets: OFFSETS,
      sentAt: NONE,
      now: addDays(START, 20),
    });
    expect(cells[0].state).toBe("due");
    expect(cells[1].state).toBe("due");
    expect(cells[2].state).toBe("scheduled");
  });

  it("is due on the day itself, not the day after", () => {
    const cells = buildTouchSchedule({
      startedAt: START,
      offsets: OFFSETS,
      sentAt: NONE,
      now: addDays(START, 5),
    });
    expect(cells[0].state).toBe("due");
  });

  it("marks a touch with no offset as unconfigured rather than pending forever", () => {
    // Three configured offsets means a fourth touch will never fire. An empty
    // cell would read as "not yet".
    const cells = buildTouchSchedule({
      startedAt: START,
      offsets: [5, 19, 33],
      sentAt: NONE,
      now: START,
    });
    expect(cells[3].state).toBe("unconfigured");
    expect(cells[3].at).toBeNull();
  });

  // The whole point of the module: do not disagree with the engine.
  it("agrees with the scheduler about what is due, across the schedule", () => {
    for (const day of [0, 4, 5, 6, 18, 19, 33, 44, 45, 60]) {
      const now = addDays(START, day);
      const sentAt = NONE;
      const fromEngine = dueTouchIndex({
        startedAt: START,
        now,
        offsets: OFFSETS,
        sent: [false, false, false, false],
      });
      const fromReport = nextDueTouch(
        buildTouchSchedule({ startedAt: START, offsets: OFFSETS, sentAt, now }),
      );
      expect(fromReport?.index ?? null).toBe(fromEngine);
    }
  });

  it("agrees with the scheduler when earlier touches are already sent", () => {
    const now = addDays(START, 34);
    const sentAt = [addDays(START, 5), addDays(START, 19), null, null];
    const fromEngine = dueTouchIndex({
      startedAt: START,
      now,
      offsets: OFFSETS,
      sent: [true, true, false, false],
    });
    const fromReport = nextDueTouch(buildTouchSchedule({ startedAt: START, offsets: OFFSETS, sentAt, now }));
    expect(fromReport?.index).toBe(3);
    expect(fromReport?.index).toBe(fromEngine);
  });
});

describe("repliedAfterTouch", () => {
  it("credits the last touch sent before the reply", () => {
    expect(
      repliedAfterTouch({
        sentAt: [addDays(START, 5), addDays(START, 19), null, null],
        endedAt: addDays(START, 21),
        status: "responded",
      }),
    ).toBe(2);
  });

  it("credits nothing when the campaign did not end in a reply", () => {
    expect(
      repliedAfterTouch({
        sentAt: [addDays(START, 5), null, null, null],
        endedAt: addDays(START, 60),
        status: "completed",
      }),
    ).toBeNull();
  });

  it("credits nothing when the reply came before any touch went out", () => {
    // Somebody answering an older conversation of their own accord is not
    // evidence that the drip worked.
    expect(
      repliedAfterTouch({ sentAt: NONE, endedAt: addDays(START, 2), status: "responded" }),
    ).toBeNull();
  });

  it("credits a touch sent the same day as the reply", () => {
    const at = addDays(START, 5);
    expect(repliedAfterTouch({ sentAt: [at, null, null, null], endedAt: at, status: "responded" })).toBe(1);
  });
});

describe("buildFunnel", () => {
  const campaign = (
    sentAt: (Date | null)[],
    delivery: ({ status: string | null; errorCode: string | null } | null)[],
    status = "running",
    endedAt: Date | null = null,
  ) => ({ sentAt, delivery, status, endedAt });

  it("counts sends and outcomes per touch", () => {
    const rows = buildFunnel([
      campaign(
        [addDays(START, 5), addDays(START, 19), null, null],
        [{ status: "read", errorCode: null }, { status: "delivered", errorCode: null }, null, null],
      ),
      campaign(
        [addDays(START, 5), null, null, null],
        [{ status: "failed", errorCode: "131026" }, null, null, null],
      ),
    ]);
    expect(rows[0].sent).toBe(2);
    expect(rows[0].read).toBe(1);
    expect(rows[0].failed).toBe(1);
    expect(rows[1].sent).toBe(1);
  });

  it("counts a read message as delivered too", () => {
    // It cannot have been read without arriving. Treating them as separate
    // populations would show the funnel leaking where it did not.
    const rows = buildFunnel([
      campaign([addDays(START, 5), null, null, null], [{ status: "read", errorCode: null }, null, null, null]),
    ]);
    expect(rows[0].delivered).toBe(1);
    expect(rows[0].read).toBe(1);
  });

  it("attributes a reply to the touch that preceded it and computes the rate", () => {
    const rows = buildFunnel([
      campaign(
        [addDays(START, 5), addDays(START, 19), null, null],
        [null, null, null, null],
        "responded",
        addDays(START, 20),
      ),
      campaign([addDays(START, 5), addDays(START, 19), null, null], [null, null, null, null]),
    ]);
    expect(rows[0].replied).toBe(0);
    expect(rows[1].replied).toBe(1);
    expect(rows[1].sent).toBe(2);
    expect(rows[1].replyRate).toBeCloseTo(0.5);
  });

  it("reports a zero rate rather than dividing by nothing", () => {
    const rows = buildFunnel([]);
    expect(rows).toHaveLength(4);
    expect(rows[0].replyRate).toBe(0);
  });
});
