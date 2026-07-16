import { describe, it, expect } from "vitest";
import {
  mapPunchRecord,
  extractRecords,
  parseEtimeDate,
  toEtimeDate,
  buildAuthHeader,
  type EtimeConfig,
} from "@/lib/etimeoffice";

const baseCfg: EtimeConfig = {
  baseUrl: "https://api.etimeoffice.com/api/",
  corpId: "DESMA",
  username: "admin",
  password: "secret",
  empcode: "ALL",
  authMode: "corp-user-pass",
  authRaw: null,
  authHeader: null,
};

describe("date helpers", () => {
  it("formats a UTC date as dd/MM/yyyy", () => {
    expect(toEtimeDate(new Date(Date.UTC(2026, 6, 1)))).toBe("01/07/2026");
    expect(toEtimeDate(new Date(Date.UTC(2026, 11, 25)))).toBe("25/12/2026");
  });

  it("parses dd/MM/yyyy, dd-MM-yyyy and ISO to UTC midnight", () => {
    expect(parseEtimeDate("01/07/2026")?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(parseEtimeDate("01-07-2026")?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(parseEtimeDate("2026-07-01")?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(parseEtimeDate("--")).toBeNull();
    expect(parseEtimeDate("")).toBeNull();
  });
});

describe("buildAuthHeader", () => {
  it("defaults to Basic base64(corp:user:pass:True) — the doc'd 4-part format", () => {
    const h = buildAuthHeader(baseCfg);
    expect(h).toBe(`Basic ${Buffer.from("DESMA:admin:secret:True").toString("base64")}`);
  });

  it("supports plain user:pass mode", () => {
    const h = buildAuthHeader({ ...baseCfg, authMode: "user-pass" });
    expect(h).toBe(`Basic ${Buffer.from("admin:secret").toString("base64")}`);
  });

  it("base64-encodes a raw credential override", () => {
    const h = buildAuthHeader({ ...baseCfg, authRaw: "some|weird|creds" });
    expect(h).toBe(`Basic ${Buffer.from("some|weird|creds").toString("base64")}`);
  });

  it("uses a fully-formed header verbatim", () => {
    const h = buildAuthHeader({ ...baseCfg, authHeader: "Basic ABC123==" });
    expect(h).toBe("Basic ABC123==");
  });
});

describe("extractRecords", () => {
  it("unwraps the common response envelopes", () => {
    expect(extractRecords([{ a: 1 }])).toHaveLength(1);
    expect(extractRecords({ InOutPunchData: [{ a: 1 }, { b: 2 }] })).toHaveLength(2);
    expect(extractRecords({ Data: [{ a: 1 }] })).toHaveLength(1);
    expect(extractRecords({ Error: true, Msg: "bad" })).toHaveLength(0);
  });
});

describe("mapPunchRecord", () => {
  it("maps a normal present day with both punches", () => {
    // Wednesday 01 Jul 2026, 09:03 → 18:10.
    const row = mapPunchRecord({
      Empcode: "12",
      Name: "Vishnu Raj C R",
      DateString: "01/07/2026",
      INTime: "09:03",
      OUTTime: "18:10",
      Status: "P",
      Late_In: "00:03",
      Erl_Out: "00:00",
      WorkTime: "09:07",
      OverTime: "00:00",
      Shift: "A",
      Remark: "",
    });
    expect(row).not.toBeNull();
    expect(row!.date.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(row!.inTime).toBe("09:03");
    expect(row!.outTime).toBe("18:10");
    expect(row!.rawName).toBe("Vishnu Raj C R");
    // 09:03 → 18:10 is a full day (uncapped first pass); ingest re-caps later.
    expect(row!.status).toBe("P");
  });

  it("infers a half-day from a short punch span (punch-based, ignores Work field)", () => {
    // 09:04 → 13:32 = 268 min < 420 → HD on a weekday.
    const row = mapPunchRecord({
      Empcode: "5",
      Name: "Aswathi",
      DateString: "02/07/2026",
      INTime: "09:04",
      OUTTime: "13:32",
      Status: "P",
      WorkTime: "08:00",
    });
    expect(row!.status).toBe("HD");
  });

  it("treats a single punch on a COMPLETED (past) day as a half-day pending regularization", () => {
    const row = mapPunchRecord(
      { Empcode: "7", Name: "Sivapriya", DateString: "03/07/2026", INTime: "", OUTTime: "17:40", Status: "--:--" },
      new Date("2026-07-16T09:00:00Z"), // "now" — 03 Jul is in the past → complete
    );
    expect(row!.status).toBe("HD");
    expect(row!.inTime).toBeNull();
    expect(row!.outTime).toBe("17:40");
  });

  it("keeps an IN-only punch on the CURRENT (in-progress) day as Present, not HD", () => {
    // Today's row: clocked in this morning, out-punch is still in the future.
    const row = mapPunchRecord(
      { Empcode: "3", Name: "Greeshma", DateString: "16/07/2026", INTime: "08:58", OUTTime: "--:--", Status: "P" },
      new Date("2026-07-16T09:30:00Z"), // same day → in progress
    );
    expect(row!.status).toBe("P");
    expect(row!.inTime).toBe("08:58");
    expect(row!.outTime).toBeNull();
  });

  it("still docks a genuinely incomplete PAST day even if eTimeOffice reports P", () => {
    const row = mapPunchRecord(
      { Empcode: "3", Name: "Greeshma", DateString: "10/07/2026", INTime: "09:05", OUTTime: "--:--", Status: "P" },
      new Date("2026-07-16T09:30:00Z"), // 10 Jul < 16 Jul → complete → HD
    );
    expect(row!.status).toBe("HD");
  });

  it("recomputes Saturday late against the 09:00 window", () => {
    // Saturday 04 Jul 2026, in 09:25 → late 25 min from 09:00 (not the weekday shift).
    const row = mapPunchRecord({
      Empcode: "3",
      Name: "Greeshma",
      DateString: "04/07/2026",
      INTime: "09:25",
      OUTTime: "16:00",
      Status: "P",
      Late_In: "00:00",
    });
    expect(row!.date.getUTCDay()).toBe(6);
    expect(row!.lateMinutes).toBe(25);
  });

  it("tolerates alternate key casings", () => {
    const row = mapPunchRecord({
      empcode: "9",
      employeename: "Nithya",
      date: "05/07/2026",
      intime: "09:00",
      outtime: "18:00",
      status: "P",
    });
    expect(row).not.toBeNull();
    expect(row!.empCode).toBe("9");
    expect(row!.rawName).toBe("Nithya");
  });

  it("returns null for a record with no usable date", () => {
    expect(mapPunchRecord({ Empcode: "1", Name: "x", INTime: "09:00" })).toBeNull();
  });
});
