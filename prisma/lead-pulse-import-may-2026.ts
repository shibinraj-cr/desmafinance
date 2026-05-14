/**
 * One-off import for "sales report may.xlsx" (May 2026 data).
 *
 * Differences from the historical importer:
 *   - Sheet names are bare "Name L1" / "Name L2" (no parentheses).
 *   - The date column is a string like "Fri, 1 May 26" — not an
 *     Excel serial. Parsed via month-name table + month/year columns.
 *
 * Usage:
 *   npx tsx prisma/lead-pulse-import-may-2026.ts --dry-run
 *   npx tsx prisma/lead-pulse-import-may-2026.ts
 *
 * Idempotent — upserts on (userId, entryDate, sourceId).
 */

import path from "path";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

type SourceCode =
  | "meta"
  | "wabis"
  | "voxbay"
  | "youtube"
  | "insta_fb"
  | "candidate_referral";

const SOURCE_LABEL: Record<SourceCode, string> = {
  meta: "Meta",
  wabis: "Wabis",
  voxbay: "Voxbay",
  youtube: "YouTube",
  insta_fb: "Insta/FB",
  candidate_referral: "Candidate Referral",
};

function classifyColumn(header: string): {
  kind: "leads" | "conversion" | "connected" | "disqualified" | "transfer" | "followups" | "skip";
  source?: SourceCode;
} {
  const h = header.toLowerCase().trim().replace(/\s+/g, " ");
  if (/connected calls/.test(h)) return { kind: "connected" };
  if (/diqualified|disqualified/.test(h)) return { kind: "disqualified" };
  if (/^l1 to l2|l1 → l2|l1->l2/.test(h)) return { kind: "transfer" };
  if (/total followups/.test(h)) return { kind: "followups" };
  if (/total leads/.test(h)) return { kind: "skip" };
  if (/study abroad/.test(h)) return { kind: "skip" };
  if (/busy|cancel|swith/.test(h)) return { kind: "skip" };

  const isConv = /(conversion|conv\b)/.test(h);
  let src: SourceCode | null = null;
  if (/insta|fb/.test(h)) src = "insta_fb";
  else if (/candidate( ref| referral)/.test(h)) src = "candidate_referral";
  else if (/wabi[sx]/.test(h)) src = "wabis";
  else if (/voxbay/.test(h)) src = "voxbay";
  else if (/(youtube|yt\b)/.test(h)) src = "youtube";
  else if (/meta/.test(h)) src = "meta";
  else if (/^referal$|^referral$/.test(h)) src = "candidate_referral"; // L1 stand-alone "Referal" conversion

  if (!src) return { kind: "skip" };
  return { kind: isConv ? "conversion" : "leads", source: src };
}

function cleanInt(v: unknown): { value: number; rounded: boolean } | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    const rounded = !Number.isInteger(v);
    return { value: Math.max(0, Math.round(v)), rounded };
  }
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const rounded = !Number.isInteger(n);
    return { value: Math.max(0, Math.round(n)), rounded };
  }
  return null;
}

const MONTH_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse "Fri, 1 May 26" or similar → YYYY-MM-DD. Falls back via (month, year) columns. */
function parseRowDate(
  rawDate: unknown,
  monthCell: unknown,
  yearCell: unknown,
): string | null {
  const yy = typeof yearCell === "number" ? yearCell : Number(yearCell);
  const mm = typeof monthCell === "number" ? monthCell : Number(monthCell);
  if (typeof rawDate === "string") {
    // Try to extract "<dow>, <day> <mon> <yy>"
    const m = rawDate.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})/);
    if (m) {
      const day = Number(m[1]);
      const mon = MONTH_NUM[m[2].slice(0, 3).toLowerCase()];
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      if (day && mon && year) {
        return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  // If we couldn't parse the string but we have month/year columns + a numeric day in rawDate? Skip.
  if (Number.isFinite(yy) && Number.isFinite(mm) && typeof rawDate === "number") {
    return `${yy}-${String(mm).padStart(2, "0")}-${String(rawDate).padStart(2, "0")}`;
  }
  return null;
}

function resolveBdeFromSheetName(name: string): { displayName: string; role: "l1" | "l2" } | null {
  const trimmed = name.trim();
  const m = trimmed.match(/^([A-Za-z][A-Za-z .]*?)[\s_]+(L\s*[12])$/i);
  if (!m) return null;
  const display = m[1].trim();
  const role = /2/.test(m[2]) ? "l2" : "l1";
  return { displayName: display, role };
}

type ImportSummary = {
  bdesSeen: string[];
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  fractionsRounded: number;
  unmappedHeaders: Set<string>;
  errors: string[];
  bdesMissing: string[];
};

async function importSheet(
  sheetName: string,
  aoa: (string | number | null)[][],
  identity: { displayName: string; role: "l1" | "l2" },
  sourceMap: Map<SourceCode, string>,
  userId: string,
  dryRun: boolean,
  summary: ImportSummary,
) {
  if (aoa.length < 2) return;
  const headerRow = aoa[0] ?? [];
  const classes = headerRow.map((h, i) => {
    if (i === 0) return { kind: "date" as const };
    if (i === 1 || i === 2) return { kind: "skip" as const }; // month/year cols
    if (typeof h !== "string" || !h.trim()) return { kind: "skip" as const };
    const c = classifyColumn(h);
    if (c.kind === "skip") summary.unmappedHeaders.add(`${sheetName}: ${h}`);
    return c;
  });

  type DayAcc = {
    perSource: Map<SourceCode, { leads: number; conversion: number }>;
    aggConnected: number;
    aggDisqualified: number;
    aggTransfer: number;
    aggFollowups: number;
  };
  const days = new Map<string, DayAcc>();

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.length === 0) continue;
    const dateStr = parseRowDate(row[0], row[1], row[2]);
    if (!dateStr) continue;
    let acc = days.get(dateStr);
    if (!acc) {
      acc = {
        perSource: new Map(),
        aggConnected: 0,
        aggDisqualified: 0,
        aggTransfer: 0,
        aggFollowups: 0,
      };
      days.set(dateStr, acc);
    }
    for (let c = 0; c < row.length; c++) {
      const cls = classes[c];
      if (!cls || cls.kind === "skip" || cls.kind === "date") continue;
      const cleaned = cleanInt(row[c]);
      if (!cleaned) continue;
      if (cleaned.rounded) summary.fractionsRounded += 1;
      const v = cleaned.value;
      if (v === 0) continue;
      switch (cls.kind) {
        case "leads": {
          const src = cls.source!;
          let s = acc.perSource.get(src);
          if (!s) {
            s = { leads: 0, conversion: 0 };
            acc.perSource.set(src, s);
          }
          s.leads += v;
          break;
        }
        case "conversion": {
          const src = cls.source!;
          let s = acc.perSource.get(src);
          if (!s) {
            s = { leads: 0, conversion: 0 };
            acc.perSource.set(src, s);
          }
          s.conversion += v;
          break;
        }
        case "connected":
          acc.aggConnected += v;
          break;
        case "disqualified":
          acc.aggDisqualified += v;
          break;
        case "transfer":
          acc.aggTransfer += v;
          break;
        case "followups":
          acc.aggFollowups += v;
          break;
      }
    }
  }

  // Today (UTC) for the lock decision below.
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  for (const [dateStr, acc] of days) {
    const dateValue = new Date(`${dateStr}T00:00:00.000Z`);
    // Only lock rows whose date is older than the 3-day editability window,
    // so BDEs can still correct yesterday/today after a re-run.
    const ageDays = Math.floor((todayUtc.getTime() - dateValue.getTime()) / 86400000);
    const shouldLock = ageDays > 3;
    let perSourceTotalLeads = 0;
    for (const s of acc.perSource.values()) perSourceTotalLeads += s.leads;
    let didWrite = false;

    for (const [code, s] of acc.perSource) {
      const sourceId = sourceMap.get(code);
      if (!sourceId) {
        summary.errors.push(`${sheetName} ${dateStr}: source code "${code}" not in DB`);
        continue;
      }
      if (s.leads === 0 && s.conversion === 0) continue;
      didWrite = true;
      const share = perSourceTotalLeads > 0 ? s.leads / perSourceTotalLeads : 0;
      const connectedShare = Math.round(acc.aggConnected * share);
      const disqualifiedShare = Math.round(acc.aggDisqualified * share);

      const data =
        identity.role === "l1"
          ? {
              leadsReceived: s.leads,
              connectedCalls: connectedShare,
              disqualified: disqualifiedShare,
              transferredToL2: s.conversion,
              receivedFromL1: null,
              directLeads: null,
              connected: null,
              quoteSent: null,
              closedWon: null,
              closedLost: null,
            }
          : {
              leadsReceived: null,
              connectedCalls: null,
              disqualified: null,
              transferredToL2: null,
              receivedFromL1: 0,
              directLeads: s.leads,
              connected: 0,
              quoteSent: 0,
              closedWon: s.conversion,
              closedLost: 0,
            };

      if (dryRun) {
        summary.rowsCreated += 1;
      } else {
        const existing = await prisma.leadPulseDailyEntry.findUnique({
          where: {
            userId_entryDate_sourceId: { userId, entryDate: dateValue, sourceId },
          },
          select: { id: true },
        });
        if (existing) {
          await prisma.leadPulseDailyEntry.update({
            where: { id: existing.id },
            data: {
              roleAtEntry: identity.role,
              status: "submitted",
              submittedAt: new Date(`${dateStr}T12:30:00.000Z`),
              locked: shouldLock,
              ...data,
            },
          });
          summary.rowsUpdated += 1;
        } else {
          await prisma.leadPulseDailyEntry.create({
            data: {
              userId,
              entryDate: dateValue,
              sourceId,
              roleAtEntry: identity.role,
              status: "submitted",
              submittedAt: new Date(`${dateStr}T12:30:00.000Z`),
              locked: shouldLock,
              ...data,
            },
          });
          summary.rowsCreated += 1;
        }
      }
    }

    if (didWrite || acc.aggFollowups > 0) {
      const metaPayload =
        identity.role === "l1"
          ? {
              totalFollowups: acc.aggFollowups,
              referredToDoc: null,
              referredToAbroad: 0,
            }
          : {
              totalFollowups: acc.aggFollowups || null,
              referredToDoc: 0,
              referredToAbroad: 0,
            };
      if (!dryRun) {
        await prisma.leadPulseDailyMeta.upsert({
          where: { userId_entryDate: { userId, entryDate: dateValue } },
          create: {
            userId,
            entryDate: dateValue,
            ...metaPayload,
            notes: null,
            status: "submitted",
            submittedAt: new Date(`${dateStr}T12:30:00.000Z`),
            locked: shouldLock,
          },
          update: { ...metaPayload, status: "submitted", locked: shouldLock },
        });
      }
    }
  }
}

async function resolveUser(displayName: string): Promise<string | null> {
  const candidates = [
    displayName.toLowerCase().replace(/\s+/g, "."),
    displayName.toLowerCase().replace(/\s+/g, ""),
    displayName.split(/\s+/)[0]!.toLowerCase(),
  ];
  for (const c of candidates) {
    const u = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: c, mode: "insensitive" } },
          { email: { startsWith: c + "@", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (u) return u.id;
  }
  return null;
}

async function ensureSources(): Promise<Map<SourceCode, string>> {
  const map = new Map<SourceCode, string>();
  for (const code of Object.keys(SOURCE_LABEL) as SourceCode[]) {
    const s = await prisma.leadPulseSource.findUnique({ where: { code } });
    if (s) map.set(code, s.id);
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileArg = args.find((a) => a.startsWith("--file="));
  const file =
    (fileArg ? fileArg.slice("--file=".length) : null) ||
    path.resolve(
      __dirname,
      "..",
      "..",
      "Lead_Pulse_Package",
      "lead_pulse_spec",
      "historical_data",
      "sales report may.xlsx",
    );

  console.log(`[may-import] file: ${file}`);
  console.log(`[may-import] dry-run: ${dryRun}`);

  const wb = XLSX.readFile(file);
  const sourceMap = await ensureSources();
  const summary: ImportSummary = {
    bdesSeen: [],
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    fractionsRounded: 0,
    unmappedHeaders: new Set(),
    errors: [],
    bdesMissing: [],
  };

  for (const sheetName of wb.SheetNames) {
    const identity = resolveBdeFromSheetName(sheetName);
    if (!identity) {
      console.warn(`[may-import] skipping sheet "${sheetName}" — can't parse role`);
      continue;
    }
    const userId = await resolveUser(identity.displayName);
    if (!userId) {
      summary.bdesMissing.push(`${identity.displayName} (${identity.role})`);
      console.warn(`[may-import] no DB user for "${identity.displayName}" — skipping ${sheetName}`);
      continue;
    }
    summary.bdesSeen.push(`${identity.displayName} (${identity.role})`);
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
    });
    await importSheet(sheetName, aoa, identity, sourceMap, userId, dryRun, summary);
  }

  console.log("--- SUMMARY ---");
  console.log("BDEs imported:", summary.bdesSeen);
  console.log("BDEs missing in DB:", summary.bdesMissing);
  console.log(`Rows created: ${summary.rowsCreated}`);
  console.log(`Rows updated: ${summary.rowsUpdated}`);
  console.log(`Rows skipped: ${summary.rowsSkipped}`);
  console.log(`Fractions rounded: ${summary.fractionsRounded}`);
  if (summary.unmappedHeaders.size > 0) {
    console.log("Unmapped headers:");
    for (const h of summary.unmappedHeaders) console.log(`  - ${h}`);
  }
  if (summary.errors.length > 0) {
    console.log("Errors:");
    for (const e of summary.errors) console.log(`  - ${e}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
