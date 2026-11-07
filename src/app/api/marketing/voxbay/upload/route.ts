import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { normalizePhone } from "@/lib/crm";
import { CALL_MATCH_TOLERANCE_MS, indexExistingCalls, voxbayCallSignature } from "@/lib/voxbay-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/marketing/voxbay/upload
 * Multipart form: `file` = CSV from Voxbay's incoming-call export.
 *
 * Supervisor-gated. Each upload **merges** the parsed rows into
 * VoxbayCall using a deterministic signature (sourceNumber, didNumber,
 * callStartTime) as the unique key. Rows already on file are skipped;
 * rows missing from the new CSV are preserved. A partial Voxbay export
 * therefore never wipes history.
 *
 * Since the live webhook (/api/crm/voxbay/webhook) files calls as they end,
 * a report row may describe a call that is already on file from it. Such a row
 * is matched by Voxbay call id (the report's `callUniqueId`), by signature, or
 * by the same number starting within a couple of seconds, and instead of
 * being inserted again it fills in the columns only the report carries:
 * `user_status`, cost, disposition and the like.
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
  //
  // Voxbay added a new channel and the export schema shifted: `Sl No.`
  // and `contact_name` are gone, columns were re-ordered, and four new
  // ones appeared (`last_tried_user`, `first_tried_user`, `appId`,
  // `callUniqueId`). The parser is header-keyed already, so column
  // re-ordering is fine. We only require the fields we actually act
  // on; the old-format extras (Sl No., contact_name) drop to null when
  // absent, and the new-format extras are simply ignored unless we
  // later want to surface them.
  const header = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  const idx = (name: string) => header.indexOf(name);
  const required = [
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
    const sourceNumber = get("sourceNumber") || null;
    const didNumber = get("didNumber") || null;
    const callStartTime = parseDateTimeOrNull(startStr);
    parsed.push({
      signature: voxbayCallSignature(sourceNumber, didNumber, callStartTime),
      voxbayCallId: get("callUniqueId") || null,
      phoneE164: normalizePhone(sourceNumber),
      slNo: parseIntOrNull(get("Sl No.")),
      contactName: get("contact_name") || null,
      sourceNumber,
      didNumber,
      cost: parseFloatOrNull(get("cost")),
      dtmfSeq: get("dtmfSeq") || null,
      callStartTime,
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

  // De-dup within the CSV by signature — a single export occasionally
  // includes a row twice (e.g. CRM sync glitches). createMany's
  // skipDuplicates only protects against existing-row conflicts.
  const seen = new Set<string>();
  const dedupedNamed = parsed.filter((row) => {
    if (!row.signature) return true; // null signature → can't dedup, let it through
    if (seen.has(row.signature)) return false;
    seen.add(row.signature);
    return true;
  });

  // Calls the webhook already filed. Report rows that match one enrich it
  // below rather than being inserted (where they'd either duplicate it, or be
  // skipped on the signature and lose the report's columns).
  const webhookRows = await findWebhookCalls(dedupedNamed);
  const findWebhookCall = indexExistingCalls(webhookRows);
  const toInsert: Prisma.VoxbayCallCreateManyInput[] = [];
  const toEnrich: { id: string; row: Prisma.VoxbayCallCreateManyInput }[] = [];
  const claimed = new Set<string>();
  for (const row of dedupedNamed) {
    const hit = findWebhookCall({
      voxbayCallId: row.voxbayCallId ?? null,
      signature: row.signature ?? null,
      phoneE164: row.phoneE164 ?? null,
      callStartTime: (row.callStartTime as Date | null | undefined) ?? null,
    });
    if (hit && !claimed.has(hit.id)) {
      claimed.add(hit.id);
      toEnrich.push({ id: hit.id, row });
    } else if (!hit) {
      toInsert.push(row);
    }
  }

  let inserted = 0;
  await prisma.$transaction(async (tx) => {
    const chunk = 500;
    for (let i = 0; i < toInsert.length; i += chunk) {
      const result = await tx.voxbayCall.createMany({
        data: toInsert.slice(i, i + chunk),
        skipDuplicates: true,
      });
      inserted += result.count;
    }
    await tx.voxbayUpload.create({
      data: {
        uploadedById: userId,
        filename:
          typeof (file as File).name === "string" ? (file as File).name : null,
        rowCount: dedupedNamed.length,
      },
    });
  });

  // Outside the transaction: a month's report can match thousands of webhook
  // rows, more updates than an interactive transaction's timeout allows. Each
  // update is idempotent, so a partial run is finished by uploading again.
  const ENRICH_BATCH = 20;
  for (let i = 0; i < toEnrich.length; i += ENRICH_BATCH) {
    await Promise.all(
      toEnrich.slice(i, i + ENRICH_BATCH).map(({ id, row }) =>
        prisma.voxbayCall.update({ where: { id }, data: reportOnlyColumns(row) }),
      ),
    );
  }

  const skipped = dedupedNamed.length - inserted - toEnrich.length;
  return NextResponse.json({
    ok: true,
    rowCount: dedupedNamed.length,
    inserted,
    skipped,
    enriched: toEnrich.length,
  });
}

const WEBHOOK_CALL_SELECT = {
  id: true,
  voxbayCallId: true,
  signature: true,
  phoneE164: true,
  callStartTime: true,
  source: true,
} satisfies Prisma.VoxbayCallSelect;
type WebhookCall = Prisma.VoxbayCallGetPayload<{ select: typeof WEBHOOK_CALL_SELECT }>;

/** The webhook-filed calls any of these report rows could be, by id, signature or number + time. */
async function findWebhookCalls(rows: Prisma.VoxbayCallCreateManyInput[]): Promise<WebhookCall[]> {
  const ids = [...new Set(rows.map((r) => r.voxbayCallId).filter((v): v is string => !!v))];
  const sigs = [...new Set(rows.map((r) => r.signature).filter((v): v is string => !!v))];
  const phones = [...new Set(rows.map((r) => r.phoneE164).filter((v): v is string => !!v))];
  // A loop, not Math.min(...times): a large report would overflow the argument limit.
  let first = Infinity;
  let last = -Infinity;
  for (const r of rows) {
    const t = (r.callStartTime as Date | null | undefined)?.getTime();
    if (t == null) continue;
    if (t < first) first = t;
    if (t > last) last = t;
  }
  const range =
    first <= last
      ? { gte: new Date(first - CALL_MATCH_TOLERANCE_MS), lte: new Date(last + CALL_MATCH_TOLERANCE_MS) }
      : null;

  const out = new Map<string, WebhookCall>();
  const CHUNK = 1000;
  const n = Math.max(ids.length, sigs.length, phones.length);
  for (let i = 0; i < n; i += CHUNK) {
    const idPart = ids.slice(i, i + CHUNK);
    const sigPart = sigs.slice(i, i + CHUNK);
    const phonePart = phones.slice(i, i + CHUNK);
    const or: Prisma.VoxbayCallWhereInput[] = [];
    if (idPart.length) or.push({ voxbayCallId: { in: idPart } });
    if (sigPart.length) or.push({ signature: { in: sigPart } });
    if (phonePart.length && range) or.push({ phoneE164: { in: phonePart }, callStartTime: range });
    if (!or.length) continue;
    // The report is incoming calls only.
    const found = await prisma.voxbayCall.findMany({
      where: { source: "webhook", direction: "incoming", OR: or },
      select: WEBHOOK_CALL_SELECT,
    });
    for (const f of found) out.set(f.id, f);
  }
  return [...out.values()];
}

/**
 * What a report row adds to a call the webhook already filed: the columns the
 * webhook doesn't carry. `user_status` among them, and it overwrites, because
 * the report's is Voxbay's own verdict where the webhook's was derived. The
 * call's identity, times, agent and recording stay as the webhook gave them.
 */
function reportOnlyColumns(row: Prisma.VoxbayCallCreateManyInput): Prisma.VoxbayCallUpdateInput {
  const pick = <T>(v: T | null | undefined) => (v == null || v === "" ? undefined : v);
  return {
    slNo: pick(row.slNo),
    cost: pick(row.cost),
    dtmfSeq: pick(row.dtmfSeq),
    userStatus: pick(row.userStatus),
    stickyStatus: pick(row.stickyStatus),
    holdTime: pick(row.holdTime),
    application: pick(row.application),
    appName: pick(row.appName),
    lastTriedName: pick(row.lastTriedName),
    firstTriedName: pick(row.firstTriedName),
    disposition: pick(row.disposition),
    latestComment: pick(row.latestComment),
  };
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
