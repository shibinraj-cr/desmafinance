/**
 * Every upload reader, against files a spreadsheet program wrote (not SheetJS):
 * what each one gets out of a real date, time, phone and text cell. Written for
 * the SheetJS 0.18.5 → 0.20.3 upgrade, which changed how dates are interpreted,
 * so it pins the behaviour each reader depends on.
 *
 * SheetJS hands over date cells as Dates whose LOCAL reading is the calendar
 * day and time typed in the sheet. The server runs in UTC and the browser in
 * IST, so every assertion here reads Dates with local getters and passes in
 * any time zone (CI runs UTC; run `TZ=Asia/Kolkata npx vitest run` too).
 *
 * Fixtures: tests/fixtures/spreadsheets (synthetic; make_fixtures.py rebuilds
 * the .xlsx files). HTML and CSV inputs are built inline.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAttendanceWorkbook } from "@/lib/hr-attendance-parser";
import { parseDobCell } from "@/lib/age";
import { parseMetaWorkbook } from "@/lib/crm-meta-reconcile";
import { date as wealthDate, parseHoldings, readSheet } from "@/lib/wealth-import";

const FIX = path.join(__dirname, "fixtures", "spreadsheets");
const fixture = (name: string) => readFileSync(path.join(FIX, name));
const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const localYmdHm = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** The grid the lead and employee import routes read: dates as shown, numbers as numbers. */
const importGrid = (buf: Buffer) => {
  const wb = XLSX.read(buf, { cellDates: true });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, rawNumbers: true, defval: "" });
};
const cells = (row: unknown[]) => row.map((c) => String(c ?? "").trim());

// The biometric periodic report as the device's portal downloads it: an HTML
// table saved with an .xls name, every cell text.
const ATTENDANCE_HTML = Buffer.from(
  `<html><body><table>
<tr><td>Weekly Periodic Report</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>01/11/2026 To 07/11/2026</td></tr>
<tr><td>Test Company Pvt Ltd</td></tr>
<tr><td>Dept. Name</td><td></td><td>Default</td></tr>
<tr><td>Empcode</td><td>0001</td><td></td><td>Name</td><td>Test Employee One</td></tr>
<tr><td>Date</td><td>Shift</td><td>INTime</td><td>Late In</td><td>Erl Out</td><td>OUTTime</td><td>Work+OT</td><td>Over Time</td><td>Status</td><td>Remark</td></tr>
<tr><td>02/11/2026</td><td>A</td><td>09:04</td><td>00:00</td><td>00:00</td><td>17:35</td><td>08:00</td><td>00:00</td><td>P</td><td>--</td></tr>
<tr><td>03/11/2026</td><td>A</td><td>09:00</td><td>00:00</td><td>00:00</td><td>13:32</td><td>08:00</td><td>00:00</td><td>P</td><td>--</td></tr>
<tr><td>07/11/2026</td><td>A</td><td>09:01</td><td>00:00</td><td>00:00</td><td>16:02</td><td>08:00</td><td>00:00</td><td>P</td><td>--</td></tr>
<tr><td>Empcode</td><td>0002</td><td></td><td>Name</td><td>Test Employee Two</td></tr>
<tr><td>Date</td><td>Shift</td><td>INTime</td><td>Late In</td><td>Erl Out</td><td>OUTTime</td><td>Work+OT</td><td>Over Time</td><td>Status</td><td>Remark</td></tr>
<tr><td>02/11/2026</td><td>B</td><td>--:--</td><td>00:00</td><td>00:00</td><td>--:--</td><td>08:00</td><td>00:00</td><td>A</td><td>--</td></tr>
<tr><td>03/11/2026</td><td>B</td><td>09:30</td><td>00:00</td><td>00:00</td><td>--:--</td><td>08:00</td><td>00:00</td><td>P</td><td>--</td></tr>
</table></body></html>`,
);

describe("HR attendance upload (biometric periodic report)", () => {
  const summary = (buf: Buffer) =>
    parseAttendanceWorkbook(buf).rows.map((r) => [r.rawName, ymd(r.date), r.inTime, r.outTime, r.status].join(" | "));
  const EXPECTED = [
    "Test Employee One | 2026-11-02 | 09:04 | 17:35 | P",
    "Test Employee One | 2026-11-03 | 09:00 | 13:32 | HD",
    "Test Employee One | 2026-11-07 | 09:01 | 16:02 | P",
    "Test Employee Two | 2026-11-02 | null | null | A",
    "Test Employee Two | 2026-11-03 | 09:30 | null | HD",
  ].map((s) => s.replace(/null/g, ""));

  it("reads the portal's HTML-table .xls day for day, dates day-first", () => {
    expect(summary(ATTENDANCE_HTML)).toEqual(EXPECTED);
    const res = parseAttendanceWorkbook(ATTENDANCE_HTML);
    expect(ymd(res.rangeStart!)).toBe("2026-11-02");
    expect(ymd(res.rangeEnd!)).toBe("2026-11-07");
  });

  it("reads the same report after Excel re-saves it with real date and time cells", () => {
    expect(summary(fixture("attendance.xlsx"))).toEqual(EXPECTED);
  });
});

describe("CRM lead import (.xlsx / .csv)", () => {
  it("keeps a real DOB cell's day and a phone typed as a number", () => {
    const grid = importGrid(fixture("leads.xlsx"));
    // Excel shows 919876543210 as "9.19877E+11" in General format; the import
    // needs the number, not the display.
    expect(cells(grid[1])).toEqual(["Test Lead One", "919876543210", "one@example.test", "10/11/1995"]);
    expect(ymd(parseDobCell(grid[1][3])!)).toBe("1995-11-10");
    expect(ymd(parseDobCell(grid[2][3])!)).toBe("1990-12-25");
  });

  it("reads a CSV's day-first date as typed, not month-first", () => {
    // 0.18.5 turned "10/11/1995" into 11 Oct and printed it "10/11/95", which
    // the DOB reader then dropped. The text now arrives as typed.
    const grid = importGrid(Buffer.from("Candidate Name,Phone,DOB\nTest Lead,919876543210,10/11/1995\nTest Lead 2,9876543211,1990-12-25\n"));
    expect(cells(grid[1])).toEqual(["Test Lead", "919876543210", "10/11/1995"]);
    expect(ymd(parseDobCell(grid[1][2])!)).toBe("1995-11-10");
    expect(ymd(parseDobCell(grid[2][2])!)).toBe("1990-12-25");
  });
});

describe("HR employee import (.xls / .xlsx)", () => {
  it("reads phone, Aadhaar and account numbers digit for digit", () => {
    const grid = importGrid(fixture("employees.xlsx"));
    expect(cells(grid[1])).toEqual(["7", "Test Employee Seven", "9876543210", "123456789012", "912010012345678", "01-Apr-2026"]);
  });
});

describe("CRM Meta reconcile (parsed in the browser)", () => {
  it("keeps an Excel date-time cell's wall-clock time and the phone's digits", () => {
    const [sheet] = parseMetaWorkbook(fixture("meta.xlsx")).sheets;
    expect(sheet.rows.map((r) => [r.candidateName, r.phone, localYmdHm(new Date(r.createdAt!))])).toEqual([
      ["Test Meta One", "919876543210", "2026-11-10 23:15"],
      ["Test Meta Two", "919876543211", "2026-11-01 00:05"],
    ]);
  });

  it("still reads Meta's own CSV export, ISO time with an offset", () => {
    const csv = "Created Time,Full Name,Phone Number\n2026-11-10T23:15:00+05:30,Test Meta,+919876543210\n";
    const [sheet] = parseMetaWorkbook(Buffer.from(csv)).sheets;
    expect(sheet.rows[0].createdAt).toBe("2026-11-10T17:45:00.000Z");
    expect(sheet.rows[0].phoneE164).toBe("+919876543210");
  });
});

describe("Personal wealth import", () => {
  it("dates a valuation by the day typed in the sheet, in any time zone", () => {
    const wb = XLSX.read(fixture("wealth.xlsx"), { cellDates: true });
    const [fd] = parseHoldings(readSheet(wb, "Money"));
    expect(fd).toMatchObject({ name: "Test Fixed Deposit", value: 100000, valuedOn: "2026-10-10" });
  });

  it("reads a date cell by its local calendar day, which is how SheetJS hands it over", () => {
    expect(wealthDate(new Date(2026, 9, 10))).toBe("2026-10-10");
    expect(wealthDate(new Date(2026, 9, 10, 23, 59))).toBe("2026-10-10");
  });
});

describe("Lead Pulse history import (bundled workbook)", () => {
  it("reads the bundled file cell for cell as it always has", () => {
    // Same options as /api/marketing/lead-pulse/import-historical and
    // reconcile-historical. The digest was taken under 0.18.5, before the upgrade.
    const wb = XLSX.read(readFileSync(path.join(process.cwd(), "public", "data", "lead-pulse-historical.xlsx")), { type: "buffer" });
    const all = wb.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, defval: null })]);
    const digest = createHash("sha256").update(JSON.stringify(all)).digest("hex");
    expect(wb.SheetNames.length).toBe(LEAD_PULSE_SHEETS);
    expect(digest).toBe(LEAD_PULSE_DIGEST);
  });
});

// Taken with 0.18.5 and 0.20.3, in UTC and IST: all four agree.
const LEAD_PULSE_SHEETS = 32;
const LEAD_PULSE_DIGEST = "eb75477c5385d1df45660235b94532d8b3c7c69c6eacb1b7a77fc8d0cd3c5946";
