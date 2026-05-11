import path from "path";
import fs from "fs";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";
// Many BDE sheets × hundreds of rows × DB roundtrips — keep generous.
export const maxDuration = 300;

/**
 * Admin/supervisor-only one-shot endpoint that imports the bundled
 * historical Excel (`public/data/lead-pulse-historical.xlsx`) into
 * LeadPulseDailyEntry + LeadPulseDailyMeta + LeadPulseRole.
 *
 * Mirrors `prisma/lead-pulse-import-historical.ts` (the CLI version)
 * — same column classifier, same dedup keys, same idempotency. Safe
 * to re-run; repeat invocations update rather than duplicate.
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

const SOURCE_LABEL: Record<SourceCode, string> = {
  meta: "Meta",
  wabis: "Wabis",
  voxbay: "Voxbay",
  youtube: "YouTube",
  insta_fb: "Insta/FB",
  website: "Website",
  candidate_referral: "Candidate Referral",
  agency_referral: "Agency Referral",
};

function classifyColumn(header: string): {
  kind: "leads" | "conversion" | "connected" | "disqualified" | "transfer" | "followups" | "skip";
  source?: SourceCode;
} {
  const h = header.toLowerCase().trim().replace(/\s+/g, " ");
  if (/connected calls/.test(h)) return { kind: "connected" };
  if (/diqualified|disqualified/.test(h)) return { kind: "disqualified" };
  if (/^l1 to l2|l1 → l2|l1->l2/.test(h)) return { kind: "transfer" };
  if (/total followups|^follow up( leads)?$/.test(h)) return { kind: "followups" };
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
  if (/total leads/.test(h)) return { kind: "skip" };
  if (/from report/.test(h)) return { kind: "skip" };
  return { kind: isConv ? "conversion" : "leads", source: src };
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 90000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
}

function toDateString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function cleanInt(v: unknown): { value: number; rounded: boolean } | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const m = v.match(/^(-?\d+(?:\.\d+)?)(?:\s*\+\s*(-?\d+(?:\.\d+)?))?$/);
    if (m) {
      const sum = Number(m[1]) + (m[2] ? Number(m[2]) : 0);
      return { value: Math.max(0, Math.round(sum)), rounded: !Number.isInteger(sum) };
    }
    const n = Number(v);
    if (Number.isFinite(n))
      return { value: Math.max(0, Math.round(n)), rounded: !Number.isInteger(n) };
    return null;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return { value: Math.max(0, Math.round(v)), rounded: !Number.isInteger(v) };
}

function resolveBdeFromSheetName(name: string): {
  displayName: string;
  role: "l1" | "l2";
} | null {
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

async function resolveOrCreateUser(displayName: string): Promise<string> {
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
  const username = displayName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  const placeholder = await prisma.user.create({
    data: {
      username,
      email: `${username}@desfin.local`,
      passwordHash: await bcrypt.hash(Math.random().toString(36).slice(2) + "X1!", 12),
      role: "user",
    },
    select: { id: true },
  });
  return placeholder.id;
}

async function ensureRole(userId: string, displayName: string, role: "l1" | "l2") {
  await prisma.leadPulseRole.upsert({
    where: { userId },
    create: { userId, role, displayName, regionFocus: [], active: true },
    update: { displayName },
  });
}

async function ensureSources(): Promise<Map<SourceCode, string>> {
  const map = new Map<SourceCode, string>();
  let order = 1;
  for (const code of Object.keys(SOURCE_LABEL) as SourceCode[]) {
    const s = await prisma.leadPulseSource.upsert({
      where: { code },
      create: { code, label: SOURCE_LABEL[code], displayOrder: order, active: true },
      update: {},
    });
    map.set(code, s.id);
    order++;
  }
  return map;
}

type Summary = {
  bdesSeen: string[];
  rowsCreated: number;
  rowsUpdated: number;
  fractionsRounded: number;
  errors: string[];
};

async function importSheet(
  sheetName: string,
  aoa: (string | number | null)[][],
  identity: { displayName: string; role: "l1" | "l2" },
  sourceMap: Map<SourceCode, string>,
  userId: string,
  summary: Summary,
) {
  if (aoa.length < 2) return;
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
  const dateCol = 0;
  const classes = headerRow.map((h, i) => {
    if (i === dateCol) return { kind: "date" as const };
    if (typeof h !== "string" || !h.trim()) return { kind: "skip" as const };
    return classifyColumn(h);
  });

  type DayAcc = {
    perSource: Map<SourceCode, { leads: number; conversion: number }>;
    aggConnected: number;
    aggDisqualified: number;
    aggTransfer: number;
    aggFollowups: number;
  };
  const days = new Map<string, DayAcc>();

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.length === 0) continue;
    const rawDate = row[dateCol];
    if (typeof rawDate !== "number") continue;
    const d = excelSerialToDate(rawDate);
    if (!d) continue;
    const dateStr = toDateString(d);
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
      if (cleaned.rounded) summary.fractionsRounded++;
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

  for (const [dateStr, acc] of days) {
    const dateValue = new Date(`${dateStr}T00:00:00.000Z`);
    let perSourceTotalLeads = 0;
    for (const s of acc.perSource.values()) perSourceTotalLeads += s.leads;
    let didWrite = false;

    for (const [code, s] of acc.perSource) {
      const sourceId = sourceMap.get(code);
      if (!sourceId) {
        summary.errors.push(`${sheetName} ${dateStr}: source ${code} missing`);
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
            locked: true,
            ...data,
          },
        });
        summary.rowsUpdated++;
      } else {
        await prisma.leadPulseDailyEntry.create({
          data: {
            userId,
            entryDate: dateValue,
            sourceId,
            roleAtEntry: identity.role,
            status: "submitted",
            submittedAt: new Date(`${dateStr}T12:30:00.000Z`),
            locked: true,
            ...data,
          },
        });
        summary.rowsCreated++;
      }
    }

    if (didWrite || acc.aggFollowups > 0) {
      const metaPayload =
        identity.role === "l1"
          ? { totalFollowups: acc.aggFollowups, referredToDoc: null, referredToAbroad: 0 }
          : { totalFollowups: null, referredToDoc: 0, referredToAbroad: 0 };
      await prisma.leadPulseDailyMeta.upsert({
        where: { userId_entryDate: { userId, entryDate: dateValue } },
        create: {
          userId,
          entryDate: dateValue,
          ...metaPayload,
          notes: null,
          status: "submitted",
          submittedAt: new Date(`${dateStr}T12:30:00.000Z`),
          locked: true,
        },
        update: { ...metaPayload, status: "submitted", locked: true },
      });
    }
  }
}

export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }

  // Read the bundled Excel from the deployment's filesystem. Next.js
  // copies `public/` alongside serverless lambdas, so this resolves.
  const filePath = path.join(process.cwd(), "public", "data", "lead-pulse-historical.xlsx");
  let wb: XLSX.WorkBook;
  try {
    const buf = fs.readFileSync(filePath);
    wb = XLSX.read(buf, { type: "buffer" });
  } catch (e) {
    return NextResponse.json(
      {
        error: "file_read_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  const sourceMap = await ensureSources();
  const bdes: { sheet: string; identity: { displayName: string; role: "l1" | "l2" } }[] = [];
  for (const sheet of wb.SheetNames) {
    const id = resolveBdeFromSheetName(sheet);
    if (id) bdes.push({ sheet, identity: id });
  }

  const summary: Summary = {
    bdesSeen: [],
    rowsCreated: 0,
    rowsUpdated: 0,
    fractionsRounded: 0,
    errors: [],
  };

  for (const { sheet, identity } of bdes) {
    try {
      const targetUserId = await resolveOrCreateUser(identity.displayName);
      summary.bdesSeen.push(identity.displayName);
      await ensureRole(targetUserId, identity.displayName, identity.role);
      const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(
        wb.Sheets[sheet]!,
        { header: 1, defval: null },
      );
      await importSheet(sheet, aoa, identity, sourceMap, targetUserId, summary);
    } catch (e) {
      summary.errors.push(
        `${sheet}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (summary.rowsCreated || summary.rowsUpdated) {
    await prisma.leadPulseAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "entry_edited",
        targetId: null,
        metadata: {
          import: "historical-ui-button",
          rowsCreated: summary.rowsCreated,
          rowsUpdated: summary.rowsUpdated,
          bdesSeen: summary.bdesSeen,
        },
      },
    });
  }

  return NextResponse.json({
    ok: true,
    summary: {
      bdesImported: summary.bdesSeen.length,
      rowsCreated: summary.rowsCreated,
      rowsUpdated: summary.rowsUpdated,
      fractionsRounded: summary.fractionsRounded,
      errors: summary.errors.length,
    },
    bdes: summary.bdesSeen,
    errors: summary.errors.slice(0, 30),
  });
}
