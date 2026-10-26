/**
 * Attendance sheet export (src/lib/hr-attendance-report.ts): the day → cell
 * mapping that reproduces HR's hand-made monthly sheet, the five totals, and the
 * workbook layout (date blocks, merges, formula columns). Names are synthetic.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx-js-style";
import {
  attendanceWorkbook,
  attendanceWorksheet,
  buildAttendanceReport,
  clockDecimal,
  reportCell,
  summarise,
  type ReportDayInput,
} from "@/lib/hr-attendance-report";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (date: string, status: string, inTime: string | null = null, outTime: string | null = null, lateTag: ReportDayInput["lateTag"] = null): ReportDayInput => ({
  date: d(date),
  status,
  inTime,
  outTime,
  lateTag,
});
const weekday = { date: d("2026-10-01"), holiday: false, employed: true }; // Thursday
const sunday = { date: d("2026-10-04"), holiday: false, employed: true };

/** The 2026-10 cycle: 26 Sep → 25 Oct, 30 days. */
const octCycle = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 26 + i)));

describe("clockDecimal", () => {
  it("renders 24h HH:MM as the sheet's 12-hour h.mm number", () => {
    expect(clockDecimal("09:03")).toBe(9.03);
    expect(clockDecimal("16:03")).toBe(4.03);
    expect(clockDecimal("13:20")).toBe(1.2);
    expect(clockDecimal("12:06")).toBe(12.06);
    expect(clockDecimal("09:10")).toBe(9.1);
  });
  it("is null when there is no punch", () => {
    expect(clockDecimal(null)).toBeNull();
    expect(clockDecimal("")).toBeNull();
  });
});

describe("reportCell", () => {
  it("present day: times + P", () => {
    expect(reportCell(day("2026-10-01", "P", "08:57", "17:33"), weekday)).toEqual({
      in: 8.57,
      out: 5.33,
      mark: "P",
      tone: "present",
    });
  });
  it("late within the LCE grace stays P, flagged late", () => {
    const c = reportCell(day("2026-10-01", "P", "09:58", "18:02", "LCE"), weekday);
    expect(c.mark).toBe("P");
    expect(c.tone).toBe("late");
  });
  it("late beyond the allowance (AL) is HD — payroll docks it as a half-day", () => {
    const c = reportCell(day("2026-10-01", "P", "10:07", "16:05", "AL"), weekday);
    expect(c).toEqual({ in: 10.07, out: 4.05, mark: "HD", tone: "half" });
  });
  it("half day keeps whatever punches exist", () => {
    expect(reportCell(day("2026-10-01", "HD", null, "16:03"), weekday)).toEqual({
      in: null,
      out: 4.03,
      mark: "HD",
      tone: "half",
    });
  });
  it("week-off, holiday and leave use the sheet's S / H / CL labels and count as P", () => {
    expect(reportCell(day("2026-10-04", "WO"), sunday)).toMatchObject({ in: "S", out: "S", mark: "P" });
    expect(reportCell(day("2026-10-02", "HL"), weekday)).toMatchObject({ in: "H", out: "H", mark: "P" });
    expect(reportCell(day("2026-10-01", "LV"), weekday)).toEqual({ in: "CL", out: "CL", mark: "P", tone: "leave" });
  });
  it("absent is blank / blank / A; a sandwiched Sunday or holiday keeps its label", () => {
    expect(reportCell(day("2026-10-01", "A"), weekday)).toEqual({ in: null, out: null, mark: "A", tone: "absent" });
    expect(reportCell(day("2026-10-04", "A"), sunday)).toMatchObject({ in: "S", out: "S", mark: "A" });
    expect(reportCell(day("2026-10-02", "A"), { ...weekday, holiday: true })).toMatchObject({ in: "H", mark: "A" });
  });
  it("on-duty and regularized days count as present", () => {
    expect(reportCell(day("2026-10-01", "OD"), weekday)).toMatchObject({ in: "OD", out: "OD", mark: "P" });
    expect(reportCell(day("2026-10-01", "REG", "09:00", "17:30"), weekday)).toMatchObject({ mark: "P" });
  });
  it("no row: absent when off the rolls, blank otherwise (not synced / future)", () => {
    expect(reportCell(undefined, { ...weekday, employed: false })).toMatchObject({ mark: "A", tone: "absent" });
    expect(reportCell(undefined, weekday)).toEqual({ in: null, out: null, mark: null, tone: "blank" });
  });
});

describe("summarise", () => {
  it("matches the sheet formulas: working = P + HD/2, leave = A + HD/2", () => {
    const cells = ["P", "P", "P", "HD", "A", null].map((mark) => ({ in: null, out: null, mark, tone: "blank" as const }));
    expect(summarise(cells)).toEqual({ present: 3, halfDay: 1, workingDays: 3.5, absent: 1, leave: 1.5 });
  });
});

describe("buildAttendanceReport", () => {
  it("marks days before joining as A and numbers rows in order", () => {
    const report = buildAttendanceReport({
      dates: octCycle,
      holidays: new Set(["2026-10-02"]),
      employees: [
        { name: "Employee One", joinDate: null, relievingDate: null, days: [day("2026-09-26", "P", "09:03", "16:03")] },
        { name: "Employee Two", joinDate: d("2026-10-05"), relievingDate: null, days: [day("2026-10-05", "P", "08:45", "17:30")] },
      ],
    });
    expect(report.rows.map((r) => [r.siNo, r.name])).toEqual([
      [1, "Employee One"],
      [2, "Employee Two"],
    ]);
    const two = report.rows[1];
    expect(two.cells.slice(0, 9).every((c) => c.mark === "A")).toBe(true); // 26 Sep – 4 Oct
    expect(two.cells[9]).toMatchObject({ in: 8.45, out: 5.3, mark: "P" }); // 5 Oct
    expect(two.cells[10].mark).toBeNull(); // 6 Oct, no row yet
    expect(two.summary).toMatchObject({ present: 1, absent: 9 });
  });
});

describe("attendanceWorksheet", () => {
  const report = buildAttendanceReport({
    dates: octCycle,
    holidays: new Set(),
    employees: [
      {
        name: "Employee One",
        joinDate: null,
        relievingDate: null,
        days: [day("2026-09-26", "P", "09:03", "16:03"), day("2026-09-27", "WO"), day("2026-09-28", "HD", "13:16", "18:20")],
      },
    ],
  });
  const ws = attendanceWorksheet(report);

  it("lays out SI No, NAME, a 3-column block per date, then the five totals", () => {
    expect(ws.A1.v).toBe("SI No ");
    expect(ws.B1.v).toBe("NAME");
    expect([ws.C2.v, ws.D2.v, ws.E2.v]).toEqual(["IN TIME", "OUT TIME", "P/A"]);
    // 30 dates × 3 = columns C..CN; totals in CO..CS, as in HR's sheet.
    expect([ws.CO1.v, ws.CP1.v, ws.CQ1.v, ws.CR1.v, ws.CS1.v]).toEqual([
      "Full Day Present",
      "Half Day",
      "Total Working Days",
      "Full Day Absent",
      "Total Leave",
    ]);
    expect(ws["!ref"]).toBe("A1:CS3");
    expect(ws["!merges"]).toContainEqual({ s: { r: 0, c: 2 }, e: { r: 0, c: 4 } }); // C1:E1 date
    expect(ws["!merges"]).toContainEqual({ s: { r: 0, c: 92 }, e: { r: 1, c: 92 } }); // CO1:CO2
  });

  it("writes the date header as an Excel date and the day cells as the sheet does", () => {
    expect(ws.C1).toMatchObject({ t: "n", v: 46291 }); // 2026-09-26
    expect([ws.C3.v, ws.D3.v, ws.E3.v]).toEqual([9.03, 4.03, "P"]);
    expect([ws.F3.v, ws.G3.v, ws.H3.v]).toEqual(["S", "S", "P"]);
    expect([ws.I3.v, ws.J3.v, ws.K3.v]).toEqual([1.16, 6.2, "HD"]);
  });

  it("colours P green, HD blue and A red", () => {
    const fill = (ref: string) => (ws[ref].s as XLSX.CellStyle).fill?.fgColor?.rgb;
    expect(fill("E3")).toBe("70AD47");
    expect(fill("K3")).toBe("4472C4");
    expect(fill("I3")).toBe("4A86E8");
  });

  it("totals are live formulas with cached values", () => {
    expect(ws.CO3).toMatchObject({ f: 'COUNTIF(C3:CN3,"P")', v: 2 });
    expect(ws.CP3).toMatchObject({ f: 'COUNTIF(C3:CN3,"HD")', v: 1 });
    expect(ws.CQ3).toMatchObject({ f: "CO3+CP3/2", v: 2.5 });
    expect(ws.CR3).toMatchObject({ f: 'COUNTIF(C3:CN3,"A")', v: 0 });
    expect(ws.CS3).toMatchObject({ f: "CR3+CP3/2", v: 0.5 });
  });

  it("round-trips through a real .xlsx", () => {
    const back = XLSX.read(attendanceWorkbook(report), { type: "array", cellFormula: true });
    const sheet = back.Sheets[back.SheetNames[0]];
    expect(sheet.B3.v).toBe("Employee One");
    expect(sheet.CO3.f).toBe('COUNTIF(C3:CN3,"P")');
    expect(sheet.CQ3.v).toBe(2.5);
  });
});
