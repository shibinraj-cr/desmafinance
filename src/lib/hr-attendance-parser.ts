import * as XLSX from "xlsx";

/**
 * Biometric attendance "Weekly Periodic Report" / date-wise report
 * parser. Reference file: `periodicdatewise23052026102316.xls`.
 *
 * Sheet layout (one large sheet, repeating per employee):
 *
 *   R1   Weekly Periodic Report   ...   01/03/2026 To 30/04/2026
 *   R2   DESMA International Pvt Ltd
 *   R3   Dept. Name | · | Default
 *   R4   Empcode | 0001 | · | Name | Vishnu Raj C R | · | · | Total Work+OT | … | Total OT | …
 *   R5   Date | Shift | INTime | Late In | Erl Out | OUTTime | Work+OT | Over Time | Status | Remark
 *   R6+  01/03/2026 | X | --:-- | 00:00 | 00:00 | --:-- | 00:00 | 00:00 | WO | --
 *   …    (one row per date for the employee, then next Empcode block)
 *
 * We walk the sheet, anchor on every Empcode row, then consume the
 * subsequent data rows (which start with a DD/MM/YYYY date) until the
 * next Empcode anchor (or EOF). Each consumed row produces one
 * ParsedDay.
 *
 * Status is normalised + a half-day rule applied:
 *   if status == "P" and (work + ot) < 240 minutes (4h) → "HD".
 * This compensates for the source format only emitting P/A/WO and lets
 * the salary engine treat short days as half-days without HR having to
 * mark them manually.
 */

export type ParsedDay = {
  empCode: string;
  rawName: string;
  date: Date;
  shiftCode: string | null;
  inTime: string | null;
  outTime: string | null;
  workMinutes: number;
  otMinutes: number;
  lateMinutes: number;
  earlyOutMinutes: number;
  status: string;
  remark: string | null;
};

export type ParseResult = {
  /** ISO date range covered. */
  rangeStart: Date | null;
  rangeEnd: Date | null;
  rows: ParsedDay[];
  warnings: string[];
};

function toMinutes(hhmm: string | undefined | null): number {
  if (!hhmm) return 0;
  const s = String(hhmm).trim();
  if (!s || s === "--:--" || s === "0" || s === "0:00" || s === "00:00") return 0;
  const m = s.match(/^(\d+):(\d{2})$/);
  if (!m) return 0;
  return +m[1] * 60 + +m[2];
}

function cleanTime(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "--:--") return null;
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  return null;
}

function parseDdMmYyyy(s: string): Date | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = +m[1];
  const mm = +m[2] - 1;
  const yy = +m[3];
  const d = new Date(Date.UTC(yy, mm, dd));
  if (isNaN(d.getTime())) return null;
  return d;
}

function findEmpHeader(row: unknown[]): { empCode: string; name: string } | null {
  // Look for "Empcode" cell, value in next non-empty, then "Name" cell, value after.
  let codeIdx = -1;
  for (let i = 0; i < row.length; i++) {
    if (String(row[i] ?? "").trim().toLowerCase() === "empcode") {
      codeIdx = i;
      break;
    }
  }
  if (codeIdx < 0) return null;
  let empCode = "";
  for (let i = codeIdx + 1; i < row.length; i++) {
    const v = String(row[i] ?? "").trim();
    if (v) {
      empCode = v;
      break;
    }
  }
  if (!empCode) return null;

  let nameLabelIdx = -1;
  for (let i = codeIdx + 1; i < row.length; i++) {
    if (String(row[i] ?? "").trim().toLowerCase() === "name") {
      nameLabelIdx = i;
      break;
    }
  }
  let name = "";
  if (nameLabelIdx >= 0) {
    for (let i = nameLabelIdx + 1; i < row.length; i++) {
      const v = String(row[i] ?? "").trim();
      if (v) {
        name = v;
        break;
      }
    }
  }
  return { empCode, name };
}

/** Normalised attendance status used downstream by the salary engine. */
function normaliseStatus(raw: string, workMinutes: number, otMinutes: number): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s || s === "--") return "A";
  if (s === "WO" || s === "W") return "WO";
  if (s === "HL" || s === "HOL" || s === "H") return "HL";
  if (s === "LV" || s === "L" || s === "CL" || s === "SL" || s === "PL") return "LV";
  if (s === "A" || s === "AB") return "A";
  if (s === "HD" || s === "H/D") return "HD";
  if (s === "P" || s === "PR") {
    // Heuristic: P with very short workday → half day.
    if (workMinutes + otMinutes > 0 && workMinutes + otMinutes < 240) return "HD";
    return "P";
  }
  return s;
}

export function parseAttendanceWorkbook(buffer: Buffer | ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

  const out: ParsedDay[] = [];
  const warnings: string[] = [];
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;

  let current: { empCode: string; name: string } | null = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const hdr = findEmpHeader(r);
    if (hdr) {
      current = hdr;
      continue;
    }
    // Skip column-header row: "Date | Shift | INTime | ..."
    if (String(r[0] ?? "").trim().toLowerCase() === "date") continue;
    // Day row: first cell is DD/MM/YYYY
    const c0 = String(r[0] ?? "").trim();
    const date = parseDdMmYyyy(c0);
    if (!date) continue;
    if (!current) {
      warnings.push(`Row ${i + 1}: date ${c0} found before any Empcode block — skipped`);
      continue;
    }

    const shiftCode = (() => {
      const v = String(r[1] ?? "").trim();
      return v && v !== "--" ? v : null;
    })();
    const inTime = cleanTime(r[2]);
    const lateMinutes = toMinutes(String(r[3] ?? ""));
    const earlyOutMinutes = toMinutes(String(r[4] ?? ""));
    const outTime = cleanTime(r[5]);
    const workPlusOt = toMinutes(String(r[6] ?? ""));
    const otMinutes = toMinutes(String(r[7] ?? ""));
    const workMinutes = Math.max(0, workPlusOt - otMinutes);
    const statusRaw = String(r[8] ?? "").trim();
    const remarkRaw = String(r[9] ?? "").trim();
    const remark = !remarkRaw || remarkRaw === "--" ? null : remarkRaw;
    const status = normaliseStatus(statusRaw, workMinutes, otMinutes);

    out.push({
      empCode: current.empCode,
      rawName: current.name,
      date,
      shiftCode,
      inTime,
      outTime,
      workMinutes,
      otMinutes,
      lateMinutes,
      earlyOutMinutes,
      status,
      remark,
    });

    if (!rangeStart || date < rangeStart) rangeStart = date;
    if (!rangeEnd || date > rangeEnd) rangeEnd = date;
  }

  return { rangeStart, rangeEnd, rows: out, warnings };
}
