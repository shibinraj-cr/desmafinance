/**
 * One-off / catch-up import of WhatsApp staff scores into Team Performance.
 *
 * Takes the "DESMA WhatsApp Staff Scores" Sheet downloaded as .xlsx (sheets
 * "Daily Scores" and "Unanswered"), or a single CSV of either sheet.
 * Re-runnable: rows upsert on (date, staff) and (group, query time).
 *
 *   npm run db:import-wa-scores -- "/path/DESMA WhatsApp Staff Scores.xlsx"
 */
import * as XLSX from "xlsx";
import { ingestScores, type IngestPayload } from "../src/lib/team-performance-ingest";
import { prisma } from "../src/lib/prisma";

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

function toDay(v: unknown): string {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(+d)) return d.toISOString().slice(0, 10);
  throw new Error(`Unreadable date: ${s}`);
}

function scoreRows(rows: Row[]): IngestPayload["scores"] {
  return rows
    .filter((r) => r["Staff"])
    .map((r) => {
      const [done, needed] = String(r["Closures done/needed"] ?? "0/0").replace(/^'/, "").split("/").map((x) => Number(x) || 0);
      const sun = String(r["Sun/holiday active"] ?? "").trim().toUpperCase();
      const notes = r["Notes"] == null ? null : String(r["Notes"]);
      return {
        date: toDay(r["Date"]),
        staff: String(r["Staff"]).trim(),
        queriesAnswered: num(r["Queries answered"]) ?? 0,
        medianResponseMin: num(r["Median response (min)"]),
        avgAccuracy: num(r["Avg accuracy"]),
        avgCompleteness: num(r["Avg completeness"]),
        avgTone: num(r["Avg tone"]),
        avgNextStep: num(r["Avg next-step"]),
        closuresDone: done,
        closuresNeeded: needed,
        sundayHolidayActive: sun === "Y" ? true : sun === "N" ? false : null,
        source: notes && /^manual/i.test(notes) ? ("manual" as const) : ("auto" as const),
        notes,
      };
    });
}

function unansweredRows(rows: Row[]): IngestPayload["unanswered"] {
  return rows
    .filter((r) => r["Group"])
    .map((r) => ({
      date: toDay(r["Date"]),
      groupName: String(r["Group"]).trim(),
      queryAt: String(r["Query time (IST)"] ?? "").trim(),
      summary: String(r["Query (paraphrased)"] ?? "").trim(),
      status: String(r["Status at check"] ?? "").trim(),
    }));
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run db:import-wa-scores -- <file.xlsx|file.csv>");
  const wb = XLSX.readFile(file, { cellDates: true });
  const payload: IngestPayload = { scores: [], unanswered: [] };
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { defval: null });
    if (!rows.length) continue;
    if ("Staff" in rows[0]) payload.scores.push(...scoreRows(rows));
    else if ("Group" in rows[0]) payload.unanswered.push(...unansweredRows(rows));
  }
  const res = await ingestScores(payload);
  console.log(`imported ${res.scores} score rows, ${res.unanswered} unanswered rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
