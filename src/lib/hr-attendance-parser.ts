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
 * Half-day inference (the source format only emits P/A/WO, so we infer). The
 * worked duration is PUNCH-BASED: actual punch-in → out-time, with the out-time
 * capped at the shift end so overtime past the shift end never counts toward a
 * full day. Early punch-in counts as recorded. The Work+OT column is ignored.
 *   - Any day      P-day with capped duration <  3h  (180 min) → A  (too little
 *                  time worked to count — full absence, not a paid half-day)
 *   - Weekday (Mon–Fri) P-day with capped duration <  7h  (420 min) → HD
 *   - Saturday          P-day with capped duration < 5.5h (330 min) → HD
 *
 * The shift end is only known once the employee's shift is resolved from the DB,
 * so this parser applies the thresholds to the UNCAPPED punch span as a first
 * pass (capping can only shorten the span — i.e. only turn a full day into a
 * half-day, never the reverse). The upload route
 * (src/app/api/hr/attendance/upload/route.ts) then re-applies the rule with the
 * real cap — weekday: the resolved shift end (Shift A 17:30 / B 18:00);
 * Saturday: 16:00 — and is the authoritative classification.
 *
 * Saturday timing: 09:00 → 16:00 for everyone EXCEPT exempt employees
 *   (SATURDAY_RULE_EXEMPT, e.g. Nithya, who works a different schedule).
 *   Saturday late + early-out are RECOMPUTED against this window because the
 *   biometric computes them against the employee's weekday Shift A/B end-time,
 *   which is wrong for Saturdays. Late-coming (LCE/AL) therefore runs from 09:00.
 */

export const WEEKDAY_HD_THRESHOLD_MIN = 420;  // 7 h
export const SATURDAY_HD_THRESHOLD_MIN = 330; // 5.5 h
// Below this the worked span is too short to earn even a half-day — the day is a
// full absence (A), not HD. Flat 3 h across weekdays and Saturdays.
export const ABSENT_THRESHOLD_MIN = 180; // 3 h
// Company Saturday working hours: 09:00 → 16:00 for every employee EXCEPT those
// exempt below. Saturday late / early-out are recomputed against this window
// (the biometric computes them against the weekday shift, which is wrong for
// Saturday), and late-coming (LCE/AL) applies from 09:00.
const SATURDAY_START_MIN = 9 * 60; // 09:00
export const SATURDAY_END_MIN = 16 * 60; // 16:00 — Saturday shift end / out-time cap

// Employees who do NOT follow the standard 9:00–16:00 Saturday rule — their
// Saturday late / early-out are left as the biometric values (they work a
// different Saturday schedule). Matched loosely on the biometric name. Nithya
// is exempt; her specific Saturday hours can be applied here once configured.
const SATURDAY_RULE_EXEMPT = ["nithya"];
export function isSaturdayRuleExempt(rawName: string): boolean {
  const n = String(rawName ?? "").toLowerCase();
  return SATURDAY_RULE_EXEMPT.some((x) => n.includes(x));
}

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

/**
 * Worked minutes for the half-day rule: actual punch-in → the out-time capped
 * at the shift end (overtime past the shift end does NOT count toward a full
 * day). Early punch-in counts as recorded. Returns null when either punch is
 * missing or the resulting span is non-positive.
 *
 * `shiftEndMin` is minutes-since-midnight of the shift end (weekday: the
 * employee's resolved shift end; Saturday: 16:00 / SATURDAY_END_MIN). Pass null
 * to skip the cap — e.g. the parser's first pass, before the shift is resolved.
 */
export function workedMinutesForHalfDay(
  inTime: string | null,
  outTime: string | null,
  shiftEndMin: number | null,
): number | null {
  if (!inTime || !outTime) return null;
  const inMin = toMinutes(inTime);
  const outMin = toMinutes(outTime);
  if (inMin <= 0 || outMin <= 0) return null;
  const cappedOut = shiftEndMin != null ? Math.min(outMin, shiftEndMin) : outMin;
  const duration = cappedOut - inMin;
  return duration > 0 ? duration : null;
}

/** HD when the (capped) worked minutes fall under the weekday / Saturday bar. */
export function isHalfDayDuration(workedMinutes: number, isSaturday: boolean): boolean {
  const threshold = isSaturday ? SATURDAY_HD_THRESHOLD_MIN : WEEKDAY_HD_THRESHOLD_MIN;
  return workedMinutes < threshold;
}

/**
 * Classify a worked day (both punches present) from its (capped) worked minutes:
 *   < 3h  (ABSENT_THRESHOLD_MIN)     → "A"  — too little time to count, full LOP
 *   < weekday/Saturday HD threshold  → "HD" — half day
 *   otherwise                        → "P"  — full present day
 * Applies the same 3h absence floor on weekdays and Saturdays.
 */
export function classifyWorkedDay(workedMinutes: number, isSaturday: boolean): "A" | "HD" | "P" {
  if (workedMinutes < ABSENT_THRESHOLD_MIN) return "A";
  if (isHalfDayDuration(workedMinutes, isSaturday)) return "HD";
  return "P";
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
export function normaliseStatus(
  raw: string,
  date: Date,
  inTime: string | null,
  outTime: string | null,
): string {
  const raw0 = String(raw ?? "").trim().toUpperCase();
  // Treat biometric placeholders ("--", "--:--") as "no status reported".
  const s = raw0 === "--" || raw0 === "--:--" ? "" : raw0;
  // Decided / off codes pass through untouched (a stray punch on a week-off or
  // holiday must NOT turn it into a worked half-day).
  if (s === "WO" || s === "W") return "WO";
  if (s === "HL" || s === "HOL" || s === "H") return "HL";
  if (s === "LV" || s === "L" || s === "CL" || s === "SL" || s === "PL") return "LV";
  if (s === "HD" || s === "H/D") return "HD";

  const hasIn = !!inTime;
  const hasOut = !!outTime;
  // Exactly one punch (the other missing): a full day can't be verified, so it
  // counts as a half-day pending a punch regularization. Covers biometric P / A
  // / blank-placeholder rows alike (e.g. Sivapriya 17 Apr 2026: out-only, status
  // "--:--" — previously ignored entirely by payroll).
  if (hasIn !== hasOut) return "HD";

  if (s === "A" || s === "AB") return "A";
  if (s === "P" || s === "PR" || s === "") {
    if (!hasIn && !hasOut) {
      // No punch at all: an explicit biometric "P" is trusted; a blank is absent.
      return s === "" ? "A" : "P";
    }
    // Both punches present (a single punch is handled above). The half-day rule
    // is punch-based: actual in → out. The out-time cap at the shift end can't be
    // applied here (the shift isn't resolved yet), so this is the UNCAPPED first
    // pass — the upload route re-applies the rule with the real cap and is
    // authoritative. Work+OT is not consulted (e.g. Aswathi 23 Apr 2026,
    // 09:04–13:32 → 268 min < 420 → HD). A span under 3h → A (full absence).
    const worked = workedMinutesForHalfDay(inTime, outTime, null);
    if (worked != null) return classifyWorkedDay(worked, date.getUTCDay() === 6);
    return "P";
  }
  return s || "A";
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
    let lateMinutes = toMinutes(String(r[3] ?? ""));
    let earlyOutMinutes = toMinutes(String(r[4] ?? ""));
    const outTime = cleanTime(r[5]);
    const workPlusOt = toMinutes(String(r[6] ?? ""));
    const otMinutes = toMinutes(String(r[7] ?? ""));
    const workMinutes = Math.max(0, workPlusOt - otMinutes);
    const statusRaw = String(r[8] ?? "").trim();
    const remarkRaw = String(r[9] ?? "").trim();
    const remark = !remarkRaw || remarkRaw === "--" ? null : remarkRaw;
    const status = normaliseStatus(statusRaw, date, inTime, outTime);

    // Saturday: the biometric computes late + early-out against the employee's
    // assigned weekday shift (A=09:00–17:30 / B=09:30–18:00), which is wrong for
    // Saturday. Recompute against the company Saturday window 09:00 → 16:00 so
    // late-coming (LCE/AL) applies from 09:00. Exempt employees (e.g. Nithya)
    // work a different Saturday schedule and keep their biometric values.
    if (date.getUTCDay() === 6 && !isSaturdayRuleExempt(current.name)) {
      lateMinutes = inTime ? Math.max(0, toMinutes(inTime) - SATURDAY_START_MIN) : 0;
      earlyOutMinutes = outTime ? Math.max(0, SATURDAY_END_MIN - toMinutes(outTime)) : 0;
    }

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
