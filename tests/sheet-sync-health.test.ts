import { describe, it, expect } from "vitest";
import { verdictFor, explainVerdict, type SheetContact } from "@/lib/sheet-sync-health";

const contact = (over: Partial<SheetContact> = {}): SheetContact => ({
  at: new Date().toISOString(),
  rows: 0,
  inserted: 0,
  reInquiries: 0,
  skipped: 0,
  errorRows: 0,
  campaign: null,
  ...over,
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/** A sheet on the heartbeating script whose last call was `ago` minutes before `now`. */
const heartbeating = (now: Date, ago: number): SheetContact => {
  const at = new Date(now.getTime() - ago * 60_000).toISOString();
  return contact({ at, lastHeartbeatAt: at });
};

describe("verdictFor", () => {
  it("calls a sheet that never reached us 'never'", () => {
    expect(verdictFor({ contact: null, rejected: null })).toBe("never");
  });

  it("reports a rejection streak ahead of everything else", () => {
    // The sheet IS calling — it just disagrees with us about the secret. That
    // must not read as "working" because a stale success is still on file.
    expect(
      verdictFor({
        contact: contact({ at: minutesAgo(1), inserted: 3 }),
        rejected: { at: minutesAgo(1), reason: "invalid_secret", count: 40 },
      }),
    ).toBe("rejected");
  });

  it("separates 'importing' from 'connected with nothing to send'", () => {
    expect(verdictFor({ contact: contact({ inserted: 2 }), rejected: null })).toBe("ok");
    expect(verdictFor({ contact: contact({ inserted: 0 }), rejected: null })).toBe("idle");
  });

  it("goes stale fast for a heartbeating sheet — silence there means a dead trigger", () => {
    // 15:00 IST: daytime, when the sheet checks in every minute.
    const now = new Date("2026-11-12T09:30:00Z");
    expect(verdictFor({ contact: heartbeating(now, 30), rejected: null, now })).toBe("stale");
    expect(verdictFor({ contact: heartbeating(now, 10), rejected: null, now })).toBe("idle");
  });

  describe("overnight quiet hours (22:30–06:30 IST), when the sheet checks in every half hour", () => {
    it("lets a half-hour gap through at night", () => {
      const now = new Date("2026-11-12T20:30:00Z"); // 02:00 IST
      expect(verdictFor({ contact: heartbeating(now, 31), rejected: null, now })).toBe("idle");
      expect(verdictFor({ contact: heartbeating(now, 44), rejected: null, now })).toBe("idle");
    });

    it("still calls a sheet silent for more than 45 minutes at night stale", () => {
      const now = new Date("2026-11-12T20:30:00Z"); // 02:00 IST
      expect(verdictFor({ contact: heartbeating(now, 46), rejected: null, now })).toBe("stale");
    });

    it("does not flag the morning hand-over, when the last call was the night's last check-in", () => {
      // 06:35 IST, last call 06:10 IST — inside quiet hours, so the 45-minute limit holds.
      const now = new Date("2026-11-12T01:05:00Z");
      expect(verdictFor({ contact: heartbeating(now, 25), rejected: null, now })).toBe("idle");
    });

    it("goes back to the 15-minute limit once now and the last call are both outside quiet hours", () => {
      const now = new Date("2026-11-12T01:30:00Z"); // 07:00 IST, last call 06:40 IST
      expect(verdictFor({ contact: heartbeating(now, 20), rejected: null, now })).toBe("stale");
    });
  });

  it("is patient with a sheet too old to heartbeat, which only calls when it has rows", () => {
    const c = contact({ at: minutesAgo(30) });
    expect(verdictFor({ contact: c, rejected: null })).toBe("idle");
    expect(verdictFor({ contact: contact({ at: minutesAgo(13 * 60) }), rejected: null })).toBe("stale");
  });
});

describe("explainVerdict", () => {
  it("names the secret mismatch as the thing to fix", () => {
    const msg = explainVerdict("rejected", null, { at: minutesAgo(1), reason: "invalid_secret", count: 12 });
    expect(msg).toContain("CRM_WEBHOOK_SECRET");
    expect(msg).toContain("12");
  });

  it("points a stale sheet at the Apps Script trigger", () => {
    expect(explainVerdict("stale", contact(), null)).toContain("Triggers");
  });
});
