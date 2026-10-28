/**
 * Monthly attendance sheet — the cycle-wide workbook HR used to build by hand
 * from the biometric report, now generated from HrAttendanceDay.
 *
 * Layout (one sheet, mirrors HR's existing "Attendance sheet Format"):
 *   A        SI No
 *   B        NAME
 *   C…       one 3-column block per cycle date (26th → 25th):
 *              IN TIME | OUT TIME | P/A      (row 1 = the date, merged ×3)
 *   then     Full Day Present | Half Day | Total Working Days |
 *            Full Day Absent | Total Leave    (live COUNTIF formulas)
 *
 * Cell conventions carried over from the hand-made sheet:
 *   - Times are 12-hour clock numbers h.mm (16:03 → 4.03), format 0.00.
 *   - Sunday / week-off → "S" "S" "P"; holiday → "H" "H" "P";
 *     leave → "CL" "CL" "P" (paid, so it counts as present).
 *   - Absent → blank blank "A". A Sunday/holiday turned absent by the sandwich
 *     rule keeps its S/H label with "A".
 *   - Days before joining / after relieving have no attendance row and show "A",
 *     matching how payroll treats them (loss of pay).
 *   - Fills: P green, HD blue (times light blue), A red, leave times red, late
 *     arrival (LCE grace used) times yellow.
 *
 * The P/A mark follows payroll, not the old hand formula `IF(in<=9.10,"P","A")`:
 * a present day flagged AL (late beyond the allowance) is docked as a half-day
 * in the salary run, so it is marked HD here. No DB access — the prisma assembly
 * lives in hr-attendance-report-data.ts.
 */
import * as XLSX from "xlsx-js-style";
import type { LateTag } from "./hr-data";

export type ReportDayInput = {
  date: Date;
  status: string;
  inTime: string | null;
  outTime: string | null;
  /// Late tag for this day from computeLateTags over the whole cycle.
  lateTag: LateTag;
};

export type ReportEmployeeInput = {
  name: string;
  joinDate: Date | null;
  relievingDate: Date | null;
  days: ReportDayInput[];
};

export type CellTone = "present" | "late" | "half" | "absent" | "leave" | "blank";

export type ReportCell = {
  in: string | number | null;
  out: string | number | null;
  /// "P" | "HD" | "A" — or the raw status for an unrecognised code, or null.
  mark: string | null;
  tone: CellTone;
};

export type ReportSummary = {
  present: number;
  halfDay: number;
  workingDays: number;
  absent: number;
  leave: number;
};

export type AttendanceReportRow = {
  siNo: number;
  name: string;
  cells: ReportCell[];
  summary: ReportSummary;
};

export type AttendanceReport = {
  dates: Date[];
  rows: AttendanceReportRow[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** "16:03" → 4.03, "09:10" → 9.1, "12:06" → 12.06 — the sheet's 12-hour h.mm numbers. */
export function clockDecimal(hhmm: string | null): number | null {
  const m = String(hhmm ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h12 = +m[1] % 12 || 12;
  return Number((h12 + +m[2] / 100).toFixed(2));
}

/** Whether the employee was on the rolls on `date` (date-only, inclusive). */
function employedOn(date: Date, joinDate: Date | null, relievingDate: Date | null): boolean {
  if (joinDate && iso(date) < iso(joinDate)) return false;
  if (relievingDate && iso(date) > iso(relievingDate)) return false;
  return true;
}

/** Map one employee-day to its IN / OUT / P/A cells. */
export function reportCell(
  day: ReportDayInput | undefined,
  opts: { date: Date; holiday: boolean; employed: boolean },
): ReportCell {
  if (!day) {
    // No row: off the rolls that day (shown absent, as payroll docks it), or
    // simply not synced yet / a future date — leave it blank.
    return opts.employed
      ? { in: null, out: null, mark: null, tone: "blank" }
      : { in: null, out: null, mark: "A", tone: "absent" };
  }
  const tIn = clockDecimal(day.inTime);
  const tOut = clockDecimal(day.outTime);
  const punched = tIn != null || tOut != null;
  const label = (text: string): ReportCell => ({ in: text, out: text, mark: "P", tone: "present" });

  switch (day.status) {
    case "WO":
      return punched ? { in: tIn, out: tOut, mark: "P", tone: "present" } : label("S");
    case "HL":
      return punched ? { in: tIn, out: tOut, mark: "P", tone: "present" } : label("H");
    case "LV":
      return { in: "CL", out: "CL", mark: "P", tone: "leave" };
    case "HD":
      return { in: tIn, out: tOut, mark: "HD", tone: "half" };
    case "A": {
      const off = opts.date.getUTCDay() === 0 ? "S" : opts.holiday ? "H" : null;
      return { in: tIn ?? off, out: tOut ?? off, mark: "A", tone: "absent" };
    }
    case "P":
    case "OD":
    case "REG": {
      if (day.lateTag === "AL") return { in: tIn, out: tOut, mark: "HD", tone: "half" };
      const noPunch = day.status === "OD" ? "OD" : null;
      return {
        in: tIn ?? noPunch,
        out: tOut ?? noPunch,
        mark: "P",
        tone: day.lateTag === "LCE" ? "late" : "present",
      };
    }
    default:
      return { in: tIn, out: tOut, mark: day.status, tone: "blank" };
  }
}

/** The five summary columns, exactly as the sheet's formulas compute them. */
export function summarise(cells: ReportCell[]): ReportSummary {
  const count = (m: string) => cells.filter((c) => c.mark === m).length;
  const present = count("P");
  const halfDay = count("HD");
  const absent = count("A");
  return {
    present,
    halfDay,
    workingDays: present + halfDay / 2,
    absent,
    leave: absent + halfDay / 2,
  };
}

export function buildAttendanceReport(input: {
  dates: Date[];
  holidays: Set<string>;
  employees: ReportEmployeeInput[];
}): AttendanceReport {
  const rows = input.employees.map((emp, i) => {
    const byDate = new Map(emp.days.map((d) => [iso(d.date), d]));
    const cells = input.dates.map((date) =>
      reportCell(byDate.get(iso(date)), {
        date,
        holiday: input.holidays.has(iso(date)),
        employed: employedOn(date, emp.joinDate, emp.relievingDate),
      }),
    );
    return { siNo: i + 1, name: emp.name, cells, summary: summarise(cells) };
  });
  return { dates: input.dates, rows };
}

// ── Workbook ────────────────────────────────────────────────────────────────

const FILL = {
  white: "FFFFFF",
  green: "70AD47",
  blue: "4472C4",
  lightBlue: "4A86E8",
  red: "FF0000",
  yellow: "FFFF00",
} as const;

const THIN = { style: "thin", color: { rgb: "000000" } } as const;
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

function style(opts: { fill?: string; bold?: boolean; sz?: number; wrap?: boolean; numFmt?: string }): XLSX.CellStyle {
  return {
    font: { name: "Times New Roman", sz: opts.sz ?? 11, bold: opts.bold ?? false },
    alignment: { horizontal: "center", vertical: "center", wrapText: opts.wrap ?? false },
    border: BORDER,
    ...(opts.fill ? { fill: { patternType: "solid", fgColor: { rgb: opts.fill } } } : {}),
    ...(opts.numFmt ? { numFmt: opts.numFmt } : {}),
  };
}

const TIME_FILL: Record<CellTone, string | undefined> = {
  present: undefined,
  late: FILL.yellow,
  half: FILL.lightBlue,
  absent: FILL.red,
  leave: FILL.red,
  blank: undefined,
};

const MARK_FILL: Record<CellTone, string | undefined> = {
  present: FILL.green,
  late: FILL.green,
  half: FILL.blue,
  absent: FILL.red,
  leave: FILL.green,
  blank: undefined,
};

const SUMMARY_HEADERS = [
  "Full Day Present",
  "Half Day",
  "Total Working Days",
  "Full Day Absent",
  "Total Leave",
] as const;

/** Excel serial date for a UTC date-only value. */
function excelSerial(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000 + 25_569;
}

function valueCell(v: string | number | null, s: XLSX.CellStyle): XLSX.CellObject {
  if (v == null) return { t: "s", v: "", s };
  return typeof v === "number" ? { t: "n", v, s } : { t: "s", v, s };
}

export function attendanceWorksheet(report: AttendanceReport): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const put = (r: number, c: number, cell: XLSX.CellObject) => {
    ws[XLSX.utils.encode_cell({ r, c })] = cell;
  };
  const col = (c: number) => XLSX.utils.encode_col(c);

  const head = style({ bold: true, fill: FILL.white });
  const headWrap = style({ bold: true, fill: FILL.white, wrap: true });
  const nDays = report.dates.length;
  const firstSummaryCol = 2 + nDays * 3;
  const lastCol = firstSummaryCol + SUMMARY_HEADERS.length - 1;

  // Rows 1–2: SI No / NAME span both rows; each date spans its 3 sub-columns.
  put(0, 0, { t: "s", v: "SI No ", s: style({ bold: true, fill: FILL.white, sz: 12 }) });
  put(1, 0, { t: "s", v: "", s: head });
  put(0, 1, { t: "s", v: "NAME", s: head });
  put(1, 1, { t: "s", v: "", s: head });
  merges.push({ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } });
  report.dates.forEach((date, i) => {
    const c = 2 + i * 3;
    put(0, c, { t: "n", v: excelSerial(date), s: style({ bold: true, fill: FILL.white, numFmt: "dd-mm-yyyy" }) });
    put(0, c + 1, { t: "s", v: "", s: head });
    put(0, c + 2, { t: "s", v: "", s: head });
    merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 2 } });
    put(1, c, { t: "s", v: "IN TIME", s: head });
    put(1, c + 1, { t: "s", v: "OUT TIME", s: head });
    put(1, c + 2, { t: "s", v: "P/A", s: head });
  });
  SUMMARY_HEADERS.forEach((label, i) => {
    const c = firstSummaryCol + i;
    put(0, c, { t: "s", v: label, s: headWrap });
    put(1, c, { t: "s", v: "", s: headWrap });
    merges.push({ s: { r: 0, c }, e: { r: 1, c } });
  });

  // One row per employee from row 3.
  report.rows.forEach((row, i) => {
    const r = 2 + i;
    const excelRow = r + 1;
    put(r, 0, { t: "n", v: row.siNo, s: style({ sz: 12 }) });
    put(r, 1, { t: "s", v: row.name, s: style({ sz: 12 }) });
    row.cells.forEach((cell, d) => {
      const c = 2 + d * 3;
      const timeStyle = style({ fill: TIME_FILL[cell.tone], numFmt: "0.00" });
      put(r, c, valueCell(cell.in, timeStyle));
      put(r, c + 1, valueCell(cell.out, timeStyle));
      put(r, c + 2, valueCell(cell.mark, style({ fill: MARK_FILL[cell.tone] })));
    });
    // Live formulas (so a hand-corrected P/A recounts), with cached values so
    // the numbers show even where nothing recalculates.
    const range = `${col(2)}${excelRow}:${col(firstSummaryCol - 1)}${excelRow}`;
    const [cP, cHD, , cA] = [0, 1, 2, 3].map((k) => `${col(firstSummaryCol + k)}${excelRow}`);
    const formulas: [string, number][] = [
      [`COUNTIF(${range},"P")`, row.summary.present],
      [`COUNTIF(${range},"HD")`, row.summary.halfDay],
      [`${cP}+${cHD}/2`, row.summary.workingDays],
      [`COUNTIF(${range},"A")`, row.summary.absent],
      [`${cA}+${cHD}/2`, row.summary.leave],
    ];
    formulas.forEach(([f, v], k) => {
      put(r, firstSummaryCol + k, { t: "n", v, f, s: style({ fill: FILL.white }) });
    });
  });

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 1 + report.rows.length, c: lastCol } });
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 6 },
    { wch: 22 },
    ...Array.from({ length: nDays * 3 }, () => ({ wch: 9 })),
    ...SUMMARY_HEADERS.map(() => ({ wch: 13 })),
  ];
  return ws;
}

/** The finished .xlsx as a byte array, ready for a download response. */
export function attendanceWorkbook(report: AttendanceReport): Uint8Array<ArrayBuffer> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, attendanceWorksheet(report), "Attendance");
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}
