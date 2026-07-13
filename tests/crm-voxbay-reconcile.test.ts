import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseVoxbayDate,
  hmsToSeconds,
  parseVoxbayCsv,
  aggregateCallers,
  collectCallerPhoneKeys,
  reconcileCallers,
  parseSinceDate,
} from "@/lib/crm-voxbay-reconcile";

// Only imports the pure crm helpers — no prisma — so no DB mocking needed.

const HEADER =
  "Sl No.,contact_name,sourceNumber,didNumber,cost,dtmfSeq,callStartTime,call_connected_time,call_status,user_status,sticky_status,hold_time,callRecordFile,application,extNumber,appName,agentName,last_tried_name,first_tried_name,totalDuration,answeredDuration,deptName,disposition,latestComment";

function csvRow(over: Partial<Record<string, string>>): string {
  const cols: Record<string, string> = {
    "Sl No.": "1", contact_name: "", sourceNumber: "", didNumber: "918069255938", cost: "0",
    dtmfSeq: "", callStartTime: "", call_connected_time: "", call_status: "ANSWERED", user_status: "FAILED",
    sticky_status: "0", hold_time: "", callRecordFile: "", application: "callflow", extNumber: "",
    appName: "New incoming", agentName: "", last_tried_name: "", first_tried_name: "", totalDuration: "00:00:16",
    answeredDuration: "00:00:00", deptName: "", disposition: "", latestComment: "", ...over,
  };
  return HEADER.split(",").map((h) => cols[h] ?? "").join(",");
}

describe("parseCsv", () => {
  it("handles quoted fields with embedded commas and CRLF", () => {
    const grid = parseCsv('a,b,c\r\n1,"x, y",3\r\n');
    expect(grid[0]).toEqual(["a", "b", "c"]);
    expect(grid[1]).toEqual(["1", "x, y", "3"]);
  });
});

describe("parseVoxbayDate", () => {
  it("parses 'YYYY-MM-DD HH:mm:ss' as IST", () => {
    expect(parseVoxbayDate("2026-07-12 18:50:05")?.toISOString()).toBe("2026-07-12T13:20:05.000Z");
  });
  it("returns null on blank/garbage", () => {
    expect(parseVoxbayDate("")).toBeNull();
    expect(parseVoxbayDate(null)).toBeNull();
  });
});

describe("hmsToSeconds", () => {
  it("converts HH:MM:SS", () => {
    expect(hmsToSeconds("00:02:06")).toBe(126);
    expect(hmsToSeconds("00:00:00")).toBe(0);
    expect(hmsToSeconds("")).toBe(0);
  });
});

describe("parseVoxbayCsv", () => {
  it("maps caller number, IST time, agent fallback, and strips a BOM", () => {
    const text =
      "﻿" + HEADER + "\n" +
      csvRow({ sourceNumber: "918075356754", callStartTime: "2026-07-12 18:50:05", last_tried_name: "Shency", answeredDuration: "00:00:12" });
    const { rows, header } = parseVoxbayCsv(text);
    expect(header[2]).toBe("sourceNumber"); // BOM stripped from first cell, alignment intact
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceNumber).toBe("918075356754");
    expect(rows[0].phoneE164).toBe("+918075356754");
    expect(rows[0].callStartTime).toBe("2026-07-12T13:20:05.000Z");
    expect(rows[0].agent).toBe("Shency"); // agentName empty → last_tried_name
    expect(rows[0].answeredDurationSec).toBe(12);
  });
});

describe("aggregateCallers", () => {
  const since = parseSinceDate("2026-07-12")!;
  it("collapses repeat calls into one caller with count + last call + agents", () => {
    const text =
      HEADER + "\n" +
      csvRow({ sourceNumber: "919633740397", callStartTime: "2026-07-12 14:42:40", last_tried_name: "Hissana", answeredDuration: "00:01:31" }) + "\n" +
      csvRow({ sourceNumber: "919633740397", callStartTime: "2026-07-12 14:44:20", agentName: "Reena", answeredDuration: "00:00:00" }) + "\n" +
      csvRow({ sourceNumber: "917012011394", callStartTime: "2026-07-11 10:00:00" }); // before the date
    const { rows } = parseVoxbayCsv(text);
    const { callers, beforeSince } = aggregateCallers(rows, since);
    expect(beforeSince).toBe(1);
    expect(callers).toHaveLength(1);
    const c = callers[0];
    expect(c.phoneE164).toBe("+919633740397");
    expect(c.callCount).toBe(2);
    expect(c.connectedCount).toBe(1); // only the 00:01:31 call connected
    expect(c.lastCallAt).toBe("2026-07-12T09:14:20.000Z"); // 14:44 IST
    expect(c.agents.sort()).toEqual(["Hissana", "Reena"]);
  });

  it("buckets rows with no usable number", () => {
    const text = HEADER + "\n" + csvRow({ sourceNumber: "123", callStartTime: "2026-07-12 10:00:00" });
    const { rows } = parseVoxbayCsv(text);
    const { callers, noNumber } = aggregateCallers(rows, since);
    expect(callers).toHaveLength(0);
    expect(noNumber).toBe(1); // "123" doesn't normalise to a phone
  });
});

describe("reconcileCallers", () => {
  const since = parseSinceDate("2026-07-12")!;
  const text =
    HEADER + "\n" +
    csvRow({ sourceNumber: "918075356754", callStartTime: "2026-07-12 18:50:05" }) +
    "\n" +
    csvRow({ sourceNumber: "917012011394", callStartTime: "2026-07-12 18:41:14" });
  const { rows } = parseVoxbayCsv(text);
  const { callers } = aggregateCallers(rows, since);

  it("splits callers by CRM phone presence", () => {
    const keys = collectCallerPhoneKeys(callers);
    expect(keys.sort()).toEqual(["+917012011394", "+918075356754"]);
    const existing = new Set(["+918075356754"]); // this one is already a lead
    const { missing, inCrm } = reconcileCallers(callers, existing);
    expect(inCrm.map((c) => c.phoneE164)).toEqual(["+918075356754"]);
    expect(missing.map((c) => c.phoneE164)).toEqual(["+917012011394"]);
  });
});
