import path from "path";
import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read-only spot-check: replays the historical Excel through the same
 * classifier the importer uses and compares each (BDE, date, source)
 * to what's in the DB. Reports cells that match, mismatches with the
 * delta, and any (date, source) keys present on one side but missing
 * on the other.
 *
 * Optional `?bde=Sreeshma` narrows to a single BDE by display-name
 * substring match. No DB writes.
 */

type SourceCode =
  | "meta"
  | "wabis"
  | "voxbay"
  | "youtube"
  | "insta_fb"
  | "website"
  | "candidate_referral"
  | "agency_referral";

function classifyColumn(header: string): {
  kind: "leads" | "conversion" | "skip";
  source?: SourceCode;
} {
  const h = header.toLowerCase().trim().replace(/\s+/g, " ");
  if (/connected calls|diqualified|disqualified|^l1 to l2|^follow up|total followups|total leads|from report/.test(h))
    return { kind: "skip" };
  const isConv = /(conversion|conv\b|conv$|close|won)/.test(h);
  let src: SourceCode | null = null;
  if (/insta|fb/.test(h)) src = "insta_fb";
  else if (/website/.test(h)) src = "website";
  else if (/candidate( ref|s ref|s_ref)/.test(h)) src = "candidate_referral";
  else if (/agency( ref|_ref)/.test(h)) src = "agency_referral";
  else if (/wabi[sx]/.test(h)) src = "wabis";
  else if (/voxbay/.test(h)) src = "voxbay";
  else if (/(youtube|yt\b)/.test(h)) src = "youtube";
  else if (/meta/.test(h)) src = "meta";
  if (!src) return { kind: "skip" };
  return { kind: isConv ? "conversion" : "leads", source: src };
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 90000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
}

function toDateString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function cleanInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const m = v.match(/^(-?\d+(?:\.\d+)?)(?:\s*\+\s*(-?\d+(?:\.\d+)?))?$/);
    if (m) {
      const sum = Number(m[1]) + (m[2] ? Number(m[2]) : 0);
      return Math.max(0, Math.round(sum));
    }
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.round(v));
}

function resolveBde(name: string): { displayName: string; role: "l1" | "l2" } | null {
  const trimmed = name.trim();
  if (/\(doc\)/i.test(trimmed)) return null;
  const isMarketing = /\(marketing\)/i.test(trimmed);
  const isL2 = /\(\s*l\s*2\s*\)/i.test(trimmed);
  const isL1 = /\(\s*l\s*1\s*\)/i.test(trimmed) || isMarketing;
  if (!isL1 && !isL2) return null;
  const display = trimmed
    .replace(/\(\s*l\s*[12]\s*\)/gi, "")
    .replace(/\(marketing\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return { displayName: display, role: isMarketing ? "l1" : isL2 ? "l2" : "l1" };
}

type ExcelBucket = Map<string, { leads: number; conversion: number }>; // key = "YYYY-MM-DD|sourceCode"

export async function GET(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise)
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });

  const url = new URL(req.url);
  const bdeFilter = url.searchParams.get("bde")?.trim().toLowerCase() ?? "";

  let wb: XLSX.WorkBook;
  try {
    const buf = fs.readFileSync(
      path.join(process.cwd(), "public", "data", "lead-pulse-historical.xlsx"),
    );
    wb = XLSX.read(buf, { type: "buffer" });
  } catch (e) {
    return NextResponse.json(
      { error: "file_read_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Resolve the DB source-id → code map once.
  const sources = await prisma.leadPulseSource.findMany();
  const sourceCodeById = new Map(sources.map((s) => [s.id, s.code as SourceCode]));

  // Index DB rows by (userId, date, sourceCode) for fast lookup.
  // We pull only the rows we'll compare against — first build the BDE list
  // from the Excel, then load their DB rows in bulk.
  type SheetParse = {
    sheetName: string;
    displayName: string;
    role: "l1" | "l2";
    excelBucket: ExcelBucket;
  };
  const sheets: SheetParse[] = [];
  for (const name of wb.SheetNames) {
    const id = resolveBde(name);
    if (!id) continue;
    if (bdeFilter && !id.displayName.toLowerCase().includes(bdeFilter)) continue;
    const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[name]!, {
      header: 1,
      defval: null,
    });
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(3, aoa.length); i++) {
      const stringCount = (aoa[i] ?? []).filter(
        (c) => typeof c === "string" && c.length > 0,
      ).length;
      if (stringCount >= 3) {
        headerRowIdx = i;
        break;
      }
    }
    const headerRow = aoa[headerRowIdx] ?? [];
    const classes = headerRow.map((h, i) => {
      if (i === 0) return { kind: "date" as const };
      if (typeof h !== "string" || !h.trim()) return { kind: "skip" as const };
      return classifyColumn(h);
    });
    const bucket: ExcelBucket = new Map();
    for (let r = headerRowIdx + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row || row.length === 0) continue;
      const rawDate = row[0];
      if (typeof rawDate !== "number") continue;
      const d = excelSerialToDate(rawDate);
      if (!d) continue;
      const dateStr = toDateString(d);
      for (let c = 0; c < row.length; c++) {
        const cls = classes[c];
        if (!cls || cls.kind !== "leads" && cls.kind !== "conversion") continue;
        const v = cleanInt(row[c]);
        if (v == null || v === 0) continue;
        const key = `${dateStr}|${cls.source!}`;
        const cur = bucket.get(key) ?? { leads: 0, conversion: 0 };
        if (cls.kind === "leads") cur.leads += v;
        else cur.conversion += v;
        bucket.set(key, cur);
      }
    }
    sheets.push({ sheetName: name, displayName: id.displayName, role: id.role, excelBucket: bucket });
  }

  // Resolve each BDE's user-id by matching against the existing
  // LeadPulseRole table (created during import).
  const allRoles = await prisma.leadPulseRole.findMany({
    where: { role: { in: ["l1", "l2"] } },
    include: { user: { select: { id: true, username: true } } },
  });
  const userByDisplayName = new Map<string, { userId: string; username: string }>();
  for (const r of allRoles) {
    userByDisplayName.set(r.displayName.toLowerCase(), {
      userId: r.userId,
      username: r.user.username,
    });
  }

  type Mismatch = {
    bde: string;
    date: string;
    source: string;
    excelLeads: number;
    dbLeads: number;
    excelConversion: number;
    dbConversion: number;
  };
  type PerBdeReport = {
    bde: string;
    sheet: string;
    role: "l1" | "l2";
    excelDays: number;
    dbDays: number;
    cellsChecked: number;
    cellsMatching: number;
    cellsMismatching: number;
    missingFromDb: number;
    extraInDb: number;
    sampleMismatches: Mismatch[];
  };

  const perBde: PerBdeReport[] = [];
  let totalChecked = 0;
  let totalMatching = 0;
  let totalMismatching = 0;

  for (const s of sheets) {
    const u = userByDisplayName.get(s.displayName.toLowerCase());
    if (!u) {
      perBde.push({
        bde: s.displayName,
        sheet: s.sheetName,
        role: s.role,
        excelDays: 0,
        dbDays: 0,
        cellsChecked: 0,
        cellsMatching: 0,
        cellsMismatching: 0,
        missingFromDb: 0,
        extraInDb: 0,
        sampleMismatches: [
          {
            bde: s.displayName,
            date: "(no roster)",
            source: "—",
            excelLeads: 0,
            dbLeads: 0,
            excelConversion: 0,
            dbConversion: 0,
          },
        ],
      });
      continue;
    }
    const dbRows = await prisma.leadPulseDailyEntry.findMany({
      where: { userId: u.userId },
      select: {
        entryDate: true,
        sourceId: true,
        roleAtEntry: true,
        leadsReceived: true,
        transferredToL2: true,
        receivedFromL1: true,
        directLeads: true,
        closedWon: true,
      },
    });
    const dbBucket: ExcelBucket = new Map();
    for (const e of dbRows) {
      const code = sourceCodeById.get(e.sourceId);
      if (!code) continue;
      const dateStr = e.entryDate.toISOString().slice(0, 10);
      const isL1 = e.roleAtEntry === "l1";
      const leads = isL1
        ? e.leadsReceived ?? 0
        : (e.receivedFromL1 ?? 0) + (e.directLeads ?? 0);
      const conversion = isL1 ? e.transferredToL2 ?? 0 : e.closedWon ?? 0;
      dbBucket.set(`${dateStr}|${code}`, { leads, conversion });
    }
    const excelKeys = new Set(s.excelBucket.keys());
    const dbKeys = new Set(dbBucket.keys());
    const allKeys = new Set([...excelKeys, ...dbKeys]);

    let cellsChecked = 0;
    let cellsMatching = 0;
    let cellsMismatching = 0;
    let missingFromDb = 0;
    let extraInDb = 0;
    const sampleMismatches: Mismatch[] = [];

    for (const key of allKeys) {
      const ex = s.excelBucket.get(key);
      const db = dbBucket.get(key);
      const [date, source] = key.split("|");
      if (!ex && db) {
        extraInDb++;
        continue;
      }
      if (ex && !db) {
        missingFromDb++;
        if (sampleMismatches.length < 30) {
          sampleMismatches.push({
            bde: s.displayName,
            date,
            source,
            excelLeads: ex.leads,
            dbLeads: 0,
            excelConversion: ex.conversion,
            dbConversion: 0,
          });
        }
        continue;
      }
      if (!ex || !db) continue;
      cellsChecked++;
      const match = ex.leads === db.leads && ex.conversion === db.conversion;
      if (match) cellsMatching++;
      else {
        cellsMismatching++;
        if (sampleMismatches.length < 30) {
          sampleMismatches.push({
            bde: s.displayName,
            date,
            source,
            excelLeads: ex.leads,
            dbLeads: db.leads,
            excelConversion: ex.conversion,
            dbConversion: db.conversion,
          });
        }
      }
    }

    totalChecked += cellsChecked;
    totalMatching += cellsMatching;
    totalMismatching += cellsMismatching;

    perBde.push({
      bde: s.displayName,
      sheet: s.sheetName,
      role: s.role,
      excelDays: new Set(Array.from(excelKeys).map((k) => k.split("|")[0])).size,
      dbDays: new Set(Array.from(dbKeys).map((k) => k.split("|")[0])).size,
      cellsChecked,
      cellsMatching,
      cellsMismatching,
      missingFromDb,
      extraInDb,
      sampleMismatches,
    });
  }

  return NextResponse.json({
    ok: true,
    filter: bdeFilter || null,
    totals: {
      bdes: sheets.length,
      cellsChecked: totalChecked,
      cellsMatching: totalMatching,
      cellsMismatching: totalMismatching,
    },
    perBde,
  });
}
