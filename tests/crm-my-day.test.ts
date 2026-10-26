import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { firstLeadId, formatWait, windowHoursLeft, type MyDay } from "@/lib/crm-my-day";

const now = new Date("2026-10-26T10:00:00Z");
const HOUR = 3_600_000;

describe("windowHoursLeft", () => {
  it("whole hours left in the reply window", () => {
    expect(windowHoursLeft(new Date(now.getTime() + 5.5 * HOUR), now)).toBe(5);
  });
  it("null once it has closed, or when there never was one", () => {
    expect(windowHoursLeft(new Date(now.getTime() - HOUR), now)).toBeNull();
    expect(windowHoursLeft(null, now)).toBeNull();
  });
});

describe("formatWait", () => {
  it("reads hours, then days and hours", () => {
    expect(formatWait(new Date(now.getTime() - 20 * 60_000), now)).toBe("<1h");
    expect(formatWait(new Date(now.getTime() - 3 * HOUR), now)).toBe("3h");
    expect(formatWait(new Date(now.getTime() - 52 * HOUR), now)).toBe("2d 4h");
    expect(formatWait(new Date(now.getTime() - 48 * HOUR), now)).toBe("2d");
  });
});

describe("firstLeadId — the order the page lists the work", () => {
  const empty: MyDay = {
    waiting: [], waitingTotal: 0, uncontacted: [], uncontactedTotal: 0,
    tasks: [], tasksOverdue: 0, tasksToday: 0, quality: [], qualityTotal: 0,
  };
  it("a waiting WhatsApp reply comes before everything else", () => {
    const day: MyDay = {
      ...empty,
      waiting: [{ conversationId: "c", leadId: "L-wa", candidateName: "A", phoneE164: "+91", waitingSince: null, windowHoursLeft: 3 }],
      tasks: [{ taskId: "t", leadId: "L-task", candidateName: "B", phone: null, subject: "s", dueAt: now.toISOString(), overdue: true }],
    };
    expect(firstLeadId(day)).toBe("L-wa");
  });
  it("falls through to tasks, and is null with nothing to do", () => {
    expect(
      firstLeadId({ ...empty, tasks: [{ taskId: "t", leadId: "L-task", candidateName: "B", phone: null, subject: "s", dueAt: now.toISOString(), overdue: false }] }),
    ).toBe("L-task");
    expect(firstLeadId(empty)).toBeNull();
  });
});
