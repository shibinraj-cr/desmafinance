import * as XLSX from "xlsx";

/**
 * Biometric attendance export parser. Reference file is the "essl"-style
 * monthly report. The sheet is laid out in repeating ~10-row blocks, one
 * per employee:
 *
 *   header block:  Empcode | … | <code> | … | Name | <name> | Present | N | WO | N | HL | N | LV | N | Absent | N
 *   day-num row:   1 2 3 … 30
 *   weekday row:   Wed Thu Fri …
 *   IN / OUT / WORK / Break / OT / Status rows
 *
 * The parser scans for an "Empcode" cell to anchor each block, then walks
 * downward for the known row labels until it hits the next block.
 */

export type ParsedRow = {
  empCode: string;
  rawName: string;
  daysCovered: number;
  summary: { present?: number; wo?: number; hl?: number; lv?: number; absent?: number };
  days: ParsedDay[];
};

export type ParsedDay = {
  day: number;
  status: string;
  inTime: string | null;
  outTime: string | null;
  workMinutes: number | null;
  breakMinutes: number | null;
  otMinutes: number | null;
};

export type ParseResult = {
  monthKey: string | null;
  rows: ParsedRow[];
  warnings: string[];
};

function toMinutes(hhmm: string | undefined | null): number | null {
  if (!hhmm) return null;
  const s = String(hhmm).trim();
  if (!s || s === "--:--" || s === "0" || s === "0:00" || s === "00:00") return 0;
  const m = s.match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

function cleanTime(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "--:--") return null;
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  const n = Number(s);
  if (!Number.isNaN(n) && n >= 0 && n < 1) {
    const total = Math.round(n * 24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  return null;
}

function findKeyCell(row: unknown[]): { label: string; idx: number } | null {
  for (let i = 0; i < row.length; i++) {
    const cell = String(row[i] ?? "").trim().toLowerCase();
    if (!cell) continue;
    if (["in", "out", "work", "break", "ot", "status"].includes(cell)) {
      return { label: cell, idx: i };
    }
  }
  return null;
}

function findEmpHeader(row: unknown[]): { empCode: string; name: string; summary: ParsedRow["summary"] } | null {
  let codeIdx = -1;
  for (let i = 0; i < row.length; i++) {
    const cell = String(row[i] ?? "").trim().toLowerCase();
    if (cell === "empcode" || cell === "emp code" || cell === "employee code") {
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

  let name = "";
  let nameLabelIdx = -1;
  for (let i = codeIdx + 1; i < row.length; i++) {
    if (String(row[i] ?? "").trim().toLowerCase() === "name") {
      nameLabelIdx = i;
      break;
    }
  }
  if (nameLabelIdx >= 0) {
    for (let i = nameLabelIdx + 1; i < row.length; i++) {
      const v = String(row[i] ?? "").trim();
      if (v) {
        name = v;
        break;
      }
    }
  }

  const summary: ParsedRow["summary"] = {};
  const pickNumberAfter = (label: string): number | undefined => {
    for (let i = 0; i < row.length; i++) {
      if (String(row[i] ?? "").trim().toLowerCase() === label.toLowerCase()) {
        for (let j = i + 1; j < row.length; j++) {
          const v = String(row[j] ?? "").trim();
          if (!v) continue;
          const n = Number(v);
          if (Number.isFinite(n)) return n;
          break;
        }
      }
    }
    return undefined;
  };
  summary.present = pickNumberAfter("Present");
  summary.wo = pickNumberAfter("WO");
  summary.hl = pickNumberAfter("HL");
  summary.lv = pickNumberAfter("LV");
  summary.absent = pickNumberAfter("Absent");

  return { empCode, name, summary };
}

function detectDayRow(row: unknown[]): { dayCols: number[]; days: number[] } | null {
  const dayCols: number[] = [];
  const days: number[] = [];
  for (let i = 0; i < row.length; i++) {
    const v = String(row[i] ?? "").trim();
    if (!v) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1 && n <= 31) {
      dayCols.push(i);
      days.push(n);
    }
  }
  if (days.length < 15) return null;
  let monotonic = true;
  for (let i = 1; i < days.length; i++) {
    if (days[i] <= days[i - 1]) {
      monotonic = false;
      break;
    }
  }
  if (!monotonic) return null;
  return { dayCols, days };
}

export function parseAttendanceWorkbook(buffer: Buffer | ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheet = wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

  const out: ParsedRow[] = [];
  const warnings: string[] = [];

  let i = 0;
  const monthKey: string | null = null;
  while (i < rows.length) {
    const row = rows[i];
    const emp = findEmpHeader(row);
    if (!emp) {
      i++;
      continue;
    }
    let dayMeta: ReturnType<typeof detectDayRow> | null = null;
    let dayRowIdx = -1;
    for (let j = i + 1; j < Math.min(i + 6, rows.length); j++) {
      const d = detectDayRow(rows[j]);
      if (d) {
        dayMeta = d;
        dayRowIdx = j;
        break;
      }
    }
    if (!dayMeta || dayRowIdx < 0) {
      warnings.push(`No day-number row found for empCode=${emp.empCode}`);
      i++;
      continue;
    }
    const labelRows: Record<string, unknown[]> = {};
    let scanTo = rows.length;
    for (let j = dayRowIdx + 1; j < rows.length; j++) {
      if (findEmpHeader(rows[j])) {
        scanTo = j;
        break;
      }
    }
    for (let j = dayRowIdx + 1; j < scanTo; j++) {
      const k = findKeyCell(rows[j]);
      if (k) labelRows[k.label] = rows[j];
    }

    const statusRow = labelRows.status;
    const inRow = labelRows.in;
    const outRow = labelRows.out;
    const workRow = labelRows.work;
    const breakRow = labelRows.break;
    const otRow = labelRows.ot;

    const days: ParsedDay[] = [];
    for (let d = 0; d < dayMeta.dayCols.length; d++) {
      const col = dayMeta.dayCols[d];
      const dayN = dayMeta.days[d];
      const statusRaw = String(statusRow?.[col] ?? "").trim().toUpperCase();
      if (!statusRaw) continue;
      days.push({
        day: dayN,
        status: statusRaw,
        inTime: cleanTime(inRow?.[col]),
        outTime: cleanTime(outRow?.[col]),
        workMinutes: toMinutes(String(workRow?.[col] ?? "")),
        breakMinutes: toMinutes(String(breakRow?.[col] ?? "")),
        otMinutes: toMinutes(String(otRow?.[col] ?? "")),
      });
    }

    out.push({
      empCode: emp.empCode,
      rawName: emp.name,
      daysCovered: dayMeta.days.length,
      summary: emp.summary,
      days,
    });

    i = scanTo;
  }

  return { monthKey, rows: out, warnings };
}
