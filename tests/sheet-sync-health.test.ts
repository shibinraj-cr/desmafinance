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
    const c = contact({ at: minutesAgo(30), lastHeartbeatAt: minutesAgo(30) });
    expect(verdictFor({ contact: c, rejected: null })).toBe("stale");
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
