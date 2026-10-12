import { describe, it, expect } from "vitest";
import {
  UNCONTACTED_AFTER_MINUTES,
  UNCONTACTED_REMIND_EVERY_MINUTES,
  uncontactedAlarmScope,
  uncontactedCutoff,
  shouldPopUp,
} from "@/lib/crm-uncontacted-alarm";

const MIN = 60_000;
const user = { isAdmin: false, roleName: "Executive" };
const admin = { isAdmin: true, roleName: "Admin" };

describe("policy constants", () => {
  it("alarms after 2 hours and repeats every 20 minutes", () => {
    expect(UNCONTACTED_AFTER_MINUTES).toBe(120);
    expect(UNCONTACTED_REMIND_EVERY_MINUTES).toBe(20);
  });
});

describe("uncontactedAlarmScope", () => {
  it("gives an active BDE their own leads", () => {
    expect(uncontactedAlarmScope(user, { role: "l1", active: true })).toBe("own");
    expect(uncontactedAlarmScope(user, { role: "l2", active: true })).toBe("own");
  });

  it("gives the Marketing Admin the whole team, by role name or supervisor seat", () => {
    expect(uncontactedAlarmScope({ isAdmin: false, roleName: "Marketing Admin" }, null)).toBe("team");
    expect(uncontactedAlarmScope(user, { role: "supervisor", active: true })).toBe("team");
  });

  it("never interrupts system admins, even ones holding a supervisor seat", () => {
    expect(uncontactedAlarmScope(admin, { role: "supervisor", active: true })).toBeNull();
    expect(uncontactedAlarmScope(admin, null)).toBeNull();
  });

  it("still alarms an admin who is also a working BDE about their own leads", () => {
    expect(uncontactedAlarmScope(admin, { role: "l2", active: true })).toBe("own");
  });

  it("ignores deactivated Lead Pulse roles and users outside sales", () => {
    expect(uncontactedAlarmScope(user, { role: "l2", active: false })).toBeNull();
    expect(uncontactedAlarmScope(user, { role: "supervisor", active: false })).toBeNull();
    expect(uncontactedAlarmScope(user, null)).toBeNull();
    expect(uncontactedAlarmScope(null, { role: "l1", active: true })).toBeNull();
  });
});

describe("uncontactedCutoff", () => {
  it("is exactly two hours before now", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    expect(uncontactedCutoff(now).toISOString()).toBe("2026-10-12T08:00:00.000Z");
  });
});

describe("shouldPopUp", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");

  it("stays quiet when nothing is overdue", () => {
    expect(shouldPopUp({ now, lastShownAt: null, overdueCount: 0 })).toBe(false);
  });

  it("pops at once the first time something is overdue", () => {
    expect(shouldPopUp({ now, lastShownAt: null, overdueCount: 1 })).toBe(true);
  });

  it("waits 20 minutes after it was last shown or dismissed", () => {
    expect(shouldPopUp({ now, lastShownAt: now - 19 * MIN, overdueCount: 3 })).toBe(false);
    expect(shouldPopUp({ now, lastShownAt: now - 20 * MIN, overdueCount: 3 })).toBe(true);
  });

  it("pops straight away when the last reminder was long ago", () => {
    expect(shouldPopUp({ now, lastShownAt: now - 6 * 60 * MIN, overdueCount: 1 })).toBe(true);
  });
});
