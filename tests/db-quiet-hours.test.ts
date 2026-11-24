import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inDbQuietHours, istMinuteOfDay, QUIET_HEARTBEAT_MINUTES } from "@/lib/db-quiet-hours";
import { SHEET_LEADS_APPS_SCRIPT } from "@/lib/sheet-leads-apps-script";

describe("inDbQuietHours", () => {
  it("reads the clock in IST", () => {
    expect(istMinuteOfDay(new Date("2026-11-12T00:00:00Z"))).toBe(5 * 60 + 30);
    expect(istMinuteOfDay(new Date("2026-11-12T18:30:00Z"))).toBe(0);
  });

  it("covers 22:30 up to (not including) 06:30 IST", () => {
    expect(inDbQuietHours(new Date("2026-11-12T16:59:00Z"))).toBe(false); // 22:29
    expect(inDbQuietHours(new Date("2026-11-12T17:00:00Z"))).toBe(true); // 22:30
    expect(inDbQuietHours(new Date("2026-11-12T20:30:00Z"))).toBe(true); // 02:00
    expect(inDbQuietHours(new Date("2026-11-13T00:59:00Z"))).toBe(true); // 06:29
    expect(inDbQuietHours(new Date("2026-11-13T01:00:00Z"))).toBe(false); // 06:30
  });
});

/** Expand one cron field (minute or hour) — `*`, `*\/n`, `a-b`, `a-b/n`, `n`, comma lists. */
function expand(field: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    const [lo, hi] =
      range === "*" ? [0, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), stepRaw ? max : Number(range)];
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out];
}

describe("vercel.json crons respect the database's quiet hours", () => {
  const crons: { path: string; schedule: string }[] = JSON.parse(
    readFileSync(join(__dirname, "..", "vercel.json"), "utf8"),
  ).crons;

  it("parses every schedule as minute + hour with every day", () => {
    for (const c of crons) {
      const f = c.schedule.split(/\s+/);
      expect(f, c.path).toHaveLength(5);
      expect(f.slice(2), `${c.path} ${c.schedule}`).toEqual(["*", "*", "*"]);
    }
  });

  it("no cron fires more than once between 22:30 and 06:30 IST, so Neon can sleep", () => {
    // One nightly job costs the database ~5 awake minutes; anything that polls
    // through the night keeps it up (and billing) until morning.
    for (const c of crons) {
      const [min, hour] = c.schedule.split(/\s+/);
      let atNight = 0;
      for (const h of expand(hour, 23)) {
        for (const m of expand(min, 59)) {
          if (inDbQuietHours(new Date(Date.UTC(2026, 0, 1, h, m)))) atNight++;
        }
      }
      expect(atNight, `${c.path} (${c.schedule}) fires ${atNight}× in quiet hours`).toBeLessThanOrEqual(1);
    }
  });

  it("still runs the every-5-minute workers through the working day", () => {
    for (const path of ["/api/cron/crm-broadcasts", "/api/cron/lead-cutoff", "/api/cron/bank-statements"]) {
      const c = crons.find((x) => x.path === path);
      expect(c?.schedule, path).toBe("*/5 1-16 * * *"); // 06:30–22:25 IST
    }
  });
});

/**
 * Run the real Apps Script against stubbed Google services. It is pasted into
 * the lead sheets by hand, so a bug here means silently lost leads or a
 * database that never sleeps — worth exercising, not just reading.
 */
function loadScript(opts: { lastRow: () => number; status?: number }) {
  const docProps = new Map<string, string>();
  const posts: { rows: unknown[]; campaign?: string }[] = [];
  let clock = 0;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(value?: number | string) {
      super(value ?? clock);
    }
    static now() {
      return clock;
    }
  }
  const sheet = {
    getName: () => "Leads",
    getLastRow: opts.lastRow,
    getLastColumn: () => 2,
    getRange: (row: number, _c: number, n: number) => ({
      getValues: () =>
        row === 1 ? [["Name", "Phone"]] : Array.from({ length: n }, (_, i) => [`Lead ${row + i}`, `9${row + i}`]),
    }),
  };
  const globals = {
    Date: FakeDate,
    PropertiesService: {
      getDocumentProperties: () => ({
        getProperty: (k: string) => docProps.get(k) ?? null,
        setProperty: (k: string, v: string) => void docProps.set(k, v),
      }),
      getScriptProperties: () => ({
        getProperty: (k: string) => ({ CRM_WEBHOOK_URL: "https://x/api", CRM_WEBHOOK_SECRET: "s", CRM_SOURCE: "meta" })[k] ?? null,
      }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [sheet] }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    UrlFetchApp: {
      fetch: (_url: string, o: { payload: string }) => {
        posts.push(JSON.parse(o.payload));
        return { getResponseCode: () => opts.status ?? 200, getContentText: () => "" };
      },
    },
  };
  const api = new Function(
    ...Object.keys(globals),
    `${SHEET_LEADS_APPS_SCRIPT}\nreturn { syncNewLeads: syncNewLeads, initBaseline: initBaseline };`,
  )(...Object.values(globals)) as { syncNewLeads: () => void; initBaseline: () => void };
  return {
    api,
    posts,
    at(iso: string) {
      clock = new RealDate(iso).getTime();
    },
  };
}

describe("lead-sheet Apps Script", () => {
  it("checks in on every run by day", () => {
    const s = loadScript({ lastRow: () => 1 });
    for (const t of ["2026-11-12T09:30:00Z", "2026-11-12T09:31:00Z", "2026-11-12T09:32:00Z"]) {
      s.at(t);
      s.api.syncNewLeads();
    }
    expect(s.posts).toHaveLength(3);
    expect(s.posts.every((p) => p.rows.length === 0)).toBe(true);
  });

  it(`checks in only every ${QUIET_HEARTBEAT_MINUTES} minutes overnight`, () => {
    const s = loadScript({ lastRow: () => 1 });
    s.at("2026-11-12T20:30:00Z"); // 02:00 IST — nothing on file yet, so it calls
    s.api.syncNewLeads();
    s.at("2026-11-12T20:31:00Z");
    s.api.syncNewLeads();
    s.at("2026-11-12T20:59:00Z");
    s.api.syncNewLeads();
    expect(s.posts).toHaveLength(1);
    s.at("2026-11-12T21:00:00Z"); // 30 minutes on
    s.api.syncNewLeads();
    expect(s.posts).toHaveLength(2);
  });

  it("checks in on the clock half-hour overnight, so both sheets wake the database together", () => {
    let last = 1;
    const s = loadScript({ lastRow: () => last });
    s.at("2026-11-12T20:44:00Z"); // 02:14 IST — a lead arrives
    last = 2;
    s.api.syncNewLeads();
    s.at("2026-11-12T20:59:00Z");
    s.api.syncNewLeads(); // same half-hour as the lead: nothing
    s.at("2026-11-12T21:00:00Z"); // 02:30 IST: new half-hour, not 02:44
    s.api.syncNewLeads();
    expect(s.posts.map((p) => p.rows.length)).toEqual([1, 0]);
  });

  it("sends a new lead the minute it appears, even overnight", () => {
    let last = 1;
    const s = loadScript({ lastRow: () => last });
    s.at("2026-11-12T20:30:00Z");
    s.api.syncNewLeads(); // heartbeat
    last = 2; // a lead lands one minute later
    s.at("2026-11-12T20:31:00Z");
    s.api.syncNewLeads();
    expect(s.posts).toHaveLength(2);
    expect(s.posts[1].rows).toEqual([{ Name: "Lead 2", Phone: "92" }]);
    expect(s.posts[1].campaign).toBe("Leads");
  });

  it("does not count a rejected call as contact, so it keeps trying overnight", () => {
    const s = loadScript({ lastRow: () => 1, status: 500 });
    s.at("2026-11-12T20:30:00Z");
    s.api.syncNewLeads();
    s.at("2026-11-12T20:31:00Z");
    s.api.syncNewLeads();
    expect(s.posts).toHaveLength(2);
  });
});
