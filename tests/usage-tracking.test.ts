import { describe, it, expect } from "vitest";
import {
  creditForTick,
  sanitizeUsageItems,
  resolvePathUsage,
  formatActiveTime,
  activeHours,
  USAGE_TICK_MS,
  USAGE_IDLE_MS,
  USAGE_MAX_TICK_CREDIT_MS,
  USAGE_MAX_ITEM_SECONDS,
  USAGE_MAX_ITEMS_PER_FLUSH,
} from "@/lib/usage-tracking";

// All logic under test is pure (usage-tracking imports only modules → rbac,
// neither of which touches prisma), so no mocks are needed.

const T0 = 1_000_000_000_000; // arbitrary fixed clock

describe("creditForTick — the active-vs-open rule", () => {
  it("credits elapsed seconds when visible and recently active", () => {
    const secs = creditForTick({
      nowMs: T0 + USAGE_TICK_MS,
      lastTickMs: T0,
      lastInteractionMs: T0 + USAGE_TICK_MS - 1_000, // interacted 1s ago
      visible: true,
    });
    expect(secs).toBe(USAGE_TICK_MS / 1000);
  });

  it("credits nothing when the tab is hidden (open but not looked at)", () => {
    expect(
      creditForTick({
        nowMs: T0 + USAGE_TICK_MS,
        lastTickMs: T0,
        lastInteractionMs: T0 + USAGE_TICK_MS - 1_000,
        visible: false,
      }),
    ).toBe(0);
  });

  it("credits nothing once idle past the threshold (open but walked away)", () => {
    expect(
      creditForTick({
        nowMs: T0 + USAGE_TICK_MS,
        lastTickMs: T0,
        lastInteractionMs: T0 - USAGE_IDLE_MS, // last input well over a minute ago
        visible: true,
      }),
    ).toBe(0);
  });

  it("counts a tick exactly at the idle boundary as active", () => {
    const now = T0 + USAGE_TICK_MS;
    expect(
      creditForTick({
        nowMs: now,
        lastTickMs: T0,
        lastInteractionMs: now - USAGE_IDLE_MS, // exactly at the edge (<=)
        visible: true,
      }),
    ).toBeGreaterThan(0);
  });

  it("returns 0 for zero or negative elapsed", () => {
    expect(creditForTick({ nowMs: T0, lastTickMs: T0, lastInteractionMs: T0, visible: true })).toBe(0);
    expect(creditForTick({ nowMs: T0 - 5, lastTickMs: T0, lastInteractionMs: T0, visible: true })).toBe(0);
  });

  it("caps the credit so a sleep/wake gap can't bank hours", () => {
    const secs = creditForTick({
      nowMs: T0 + 3 * 60 * 60 * 1000, // 3h later (laptop woke)
      lastTickMs: T0,
      lastInteractionMs: T0 + 3 * 60 * 60 * 1000, // and just interacted
      visible: true,
    });
    expect(secs).toBe(USAGE_MAX_TICK_CREDIT_MS / 1000);
  });
});

describe("sanitizeUsageItems — server-side validation", () => {
  it("passes through valid items and floors fractional seconds", () => {
    expect(sanitizeUsageItems([{ moduleId: "crm", page: "/crm/leads", seconds: 42.9 }])).toEqual([
      { moduleId: "crm", page: "/crm/leads", seconds: 42 },
    ]);
  });

  it("accepts the { items: [...] } envelope form", () => {
    expect(sanitizeUsageItems({ items: [{ moduleId: "hr", page: "/hr/dashboard", seconds: 5 }] })).toEqual([
      { moduleId: "hr", page: "/hr/dashboard", seconds: 5 },
    ]);
  });

  it("folds an unknown module id to 'unknown'", () => {
    expect(sanitizeUsageItems([{ moduleId: "totally-made-up", page: "/x", seconds: 5 }])[0].moduleId).toBe(
      "unknown",
    );
  });

  it("drops sub-second, zero, negative and non-finite seconds", () => {
    expect(
      sanitizeUsageItems([
        { moduleId: "crm", page: "/crm/leads", seconds: 0 },
        { moduleId: "crm", page: "/crm/leads", seconds: -5 },
        { moduleId: "crm", page: "/crm/leads", seconds: 0.4 },
        { moduleId: "crm", page: "/crm/leads", seconds: Number.NaN },
      ]),
    ).toEqual([]);
  });

  it("caps seconds per item and the number of items", () => {
    expect(sanitizeUsageItems([{ moduleId: "crm", page: "/crm/leads", seconds: 10 ** 9 }])[0].seconds).toBe(
      USAGE_MAX_ITEM_SECONDS,
    );
    const many = Array.from({ length: USAGE_MAX_ITEMS_PER_FLUSH + 20 }, () => ({
      moduleId: "crm",
      page: "/crm/leads",
      seconds: 5,
    }));
    expect(sanitizeUsageItems(many)).toHaveLength(USAGE_MAX_ITEMS_PER_FLUSH);
  });

  it("normalizes the page (leading slash) and drops empty pages", () => {
    expect(sanitizeUsageItems([{ moduleId: "crm", page: "crm/leads", seconds: 5 }])[0].page).toBe("/crm/leads");
    expect(sanitizeUsageItems([{ moduleId: "crm", page: "", seconds: 5 }])).toEqual([]);
  });

  it("returns [] for non-array garbage", () => {
    expect(sanitizeUsageItems(null)).toEqual([]);
    expect(sanitizeUsageItems("nope")).toEqual([]);
    expect(sanitizeUsageItems(42)).toEqual([]);
  });
});

describe("resolvePathUsage — path → module + registered sub-page", () => {
  it("folds a lead detail view into the /crm/leads bucket", () => {
    expect(resolvePathUsage("/crm/leads/clx123abc")).toEqual({ moduleId: "crm", page: "/crm/leads" });
  });

  it("resolves the CRM dashboard", () => {
    expect(resolvePathUsage("/crm/team")).toEqual({ moduleId: "crm", page: "/crm/team" });
  });

  it("resolves a finance page", () => {
    expect(resolvePathUsage("/finance/overview")).toEqual({ moduleId: "finance", page: "/finance/overview" });
  });

  it("resolves a System page whose module has an empty basePath", () => {
    expect(resolvePathUsage("/users")).toEqual({ moduleId: "system", page: "/users" });
  });

  it("buckets an unmatched path under 'unknown' with a normalized page", () => {
    expect(resolvePathUsage("/nowhere/at/all")).toEqual({ moduleId: "unknown", page: "/nowhere/at/all" });
  });
});

describe("formatActiveTime", () => {
  it("formats seconds into compact time", () => {
    expect(formatActiveTime(0)).toBe("0");
    expect(formatActiveTime(30)).toBe("<1m");
    expect(formatActiveTime(90)).toBe("2m");
    expect(formatActiveTime(3600)).toBe("1.0h");
    expect(formatActiveTime(5400)).toBe("1.5h");
    expect(formatActiveTime(36_000)).toBe("10h");
    expect(formatActiveTime(64_800)).toBe("18h");
  });

  it("activeHours converts seconds to hours", () => {
    expect(activeHours(3600)).toBe(1);
    expect(activeHours(1800)).toBe(0.5);
  });
});
