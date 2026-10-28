import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  MARKETING_PER_WEEK,
  contactLimitNotBefore,
  localMinutes,
  quietHoursNotBefore,
  sendWindow,
  timezoneForPhone,
} from "@/lib/wa/send-policy";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("timezoneForPhone", () => {
  it("maps calling codes, longest prefix first", () => {
    expect(timezoneForPhone("+919876543210")).toBe("Asia/Kolkata");
    expect(timezoneForPhone("+971501234567")).toBe("Asia/Dubai");
    expect(timezoneForPhone("+966501234567")).toBe("Asia/Riyadh");
    expect(timezoneForPhone("+61412345678")).toBe("Australia/Sydney");
  });
  it("falls back to India for an unknown code", () => {
    expect(timezoneForPhone("+2348012345678")).toBe("Asia/Kolkata");
  });
});

describe("quiet hours", () => {
  it("+91 marketing goes out only between 10:00 and 19:30 IST", () => {
    expect(sendWindow("+919800000000", "marketing")).toMatchObject({ startMin: 600, endMin: 1170 });
    // 11:00 IST = 05:30 UTC → inside.
    expect(quietHoursNotBefore(new Date("2026-10-26T05:30:00Z"), "+919800000000", "marketing")).toBeNull();
    // 08:45 IST (the drip's morning run) → held until 10:00 IST = 04:30 UTC.
    expect(quietHoursNotBefore(new Date("2026-10-26T03:15:00Z"), "+919800000000", "marketing")).toEqual(
      new Date("2026-10-26T04:30:00Z"),
    );
    // 22:00 IST → next morning 10:00 IST.
    expect(quietHoursNotBefore(new Date("2026-10-26T16:30:00Z"), "+919800000000", "marketing")).toEqual(
      new Date("2026-10-27T04:30:00Z"),
    );
  });

  it("a Gulf number follows its own clock (09:00–20:00 local)", () => {
    // 21:00 in Dubai (17:00 UTC) — outside, even though it is only 22:30 IST.
    expect(quietHoursNotBefore(new Date("2026-10-26T17:00:00Z"), "+971500000000", "marketing")).not.toBeNull();
    // 10:00 in Dubai (06:00 UTC) — inside.
    expect(quietHoursNotBefore(new Date("2026-10-26T06:00:00Z"), "+971500000000", "marketing")).toBeNull();
  });

  it("service messages get the wider 09:00–20:00 window", () => {
    // 09:30 IST (04:00 UTC): too early for marketing, fine for a reminder.
    const t = new Date("2026-10-26T04:00:00Z");
    expect(quietHoursNotBefore(t, "+919800000000", "marketing")).not.toBeNull();
    expect(quietHoursNotBefore(t, "+919800000000", "service")).toBeNull();
  });

  it("localMinutes reads the wall clock in the given zone", () => {
    expect(localMinutes(new Date("2026-10-26T05:30:00Z"), "Asia/Kolkata")).toBe(11 * 60);
  });
});

describe("contactLimitNotBefore", () => {
  const now = new Date("2026-10-26T08:00:00Z");
  it("allows the first marketing message of the day", () => {
    expect(contactLimitNotBefore([new Date(now.getTime() - 30 * HOUR)], now)).toBeNull();
  });
  it("holds a second one until 24 hours after the first", () => {
    const first = new Date(now.getTime() - 5 * HOUR);
    expect(contactLimitNotBefore([first], now)).toEqual(new Date(first.getTime() + DAY));
  });
  it("holds the fourth in a rolling week until the oldest of the three ages out", () => {
    const sends = [now.getTime() - 6 * DAY, now.getTime() - 4 * DAY, now.getTime() - 2 * DAY].map((t) => new Date(t));
    expect(sends.length).toBe(MARKETING_PER_WEEK);
    expect(contactLimitNotBefore(sends, now)).toEqual(new Date(sends[0].getTime() + 7 * DAY));
  });
});
