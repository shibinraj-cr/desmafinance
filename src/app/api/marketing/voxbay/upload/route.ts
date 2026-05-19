import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/marketing/voxbay/upload
 * Multipart form: `file` = CSV from Voxbay's incoming-call export.
 *
 * Supervisor-gated. Each upload **wipes** all existing VoxbayCall rows
 * and replaces them with the parsed contents — the user explicitly
 * asked for overwrite semantics so re-uploading the same export
 * (with corrections) is idempotent.
 */
export async function POST(req: NextRequest) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return NextResponse.json({ error: "forbidden_supervisor_only" }, { status: 403 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "bad_form" }, { status: 400 });
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  const raw = await file.text();
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    return NextResponse.json({ error: "empty_csv" }, { status: 400 });
  }

  // Header → column index map. Voxbay sometimes emits a BOM on the
  // first header cell — strip it.
  const header = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  const idx = (name: string) => header.indexOf(name);
  const required = [
    "Sl No.",
    "contact_name",
    "sourceNumber",
    "didNumber",
    "callStartTime",
    "call_status",
    "user_status",
    "totalDuration",
    "answeredDuration",
  ];
  for (const r of required) {
    if (idx(r) < 0) {
      return NextResponse.json(
        { error: "missing_column", column: r, header },
        { status: 400 },
      );
    }
  }

  const parsed: Prisma.VoxbayCallCreateManyInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 0 || r.every((c) => !c.trim())) continue;
    const get = (name: string) => {
      const j = idx(name);
      return j < 0 ? "" : (r[j] ?? "").trim();
    };
    const startStr = get("callStartTime");
    const connStr = get("call_connected_time");
    const totalDispl = get("totalDuration") || null;
    const ansDispl = get("answeredDuration") || null;
    parsed.push({
      slNo: parseIntOrNull(get("Sl No.")),
      contactName: get("contact_name") || null,
      sourceNumber: get("sourceNumber") || null,
      didNumber: get("didNumber") || null,
      cost: parseFloatOrNull(get("cost")),
      dtmfSeq: get("dtmfSeq") || null,
      callStartTime: parseDateTimeOrNull(startStr),
      callConnectedTime: parseDateTimeOrNull(connStr),
      callStatus: get("call_status") || null,
      userStatus: get("user_status") || null,
      stickyStatus: get("sticky_status") || null,
      holdTime: get("hold_time") || null,
      callRecordFile: get("callRecordFile") || null,
      application: get("application") || null,
      extNumber: get("extNumber") || null,
      appName: get("appName") || null,
      agentName: get("agentName") || null,
      lastTriedName: get("last_tried_name") || null,
      firstTriedName: get("first_tried_name") || null,
      totalDurationSec: hmsToSeconds(totalDispl),
      totalDurationDisplay: totalDispl,
      answeredDurationSec: hmsToSeconds(ansDispl),
      answeredDurationDisplay: ansDispl,
      deptName: get("deptName") || null,
      disposition: get("disposition") || null,
      latestComment: get("latestComment") || null,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.voxbayCall.deleteMany({});
    // Bulk insert in chunks (Prisma's createMany handles a few thousand
    // rows comfortably; we still chunk to be safe on Neon).
    const chunk = 500;
    for (let i = 0; i < parsed.length; i += chunk) {
      await tx.voxbayCall.createMany({ data: parsed.slice(i, i + chunk) });
    }
    await tx.voxbayUpload.create({
      data: {
        uploadedById: userId,
        filename:
          typeof (file as File).name === "string" ? (file as File).name : null,
        rowCount: parsed.length,
      },
    });
  });

  return NextResponse.json({ ok: true, rowCount: parsed.length });
}

/** RFC-4180-ish CSV parser. Handles quoted fields with embedded commas and CRLF lines. */
function parseCsv(input: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        out.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // swallow — next \n closes the row
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

function parseIntOrNull(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function parseFloatOrNull(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDateTimeOrNull(s: string): Date | null {
  if (!s) return null;
  // Voxbay format: "YYYY-MM-DD HH:MM:SS" in IST. Parse as IST → UTC.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  // IST is UTC+5:30. Construct a UTC instant offset by -5:30.
  const utcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
  );
  const istOffset = (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMs - istOffset);
}

function hmsToSeconds(s: string | null): number {
  if (!s) return 0;
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
