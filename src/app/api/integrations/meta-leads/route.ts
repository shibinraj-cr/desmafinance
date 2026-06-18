import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { HttpError, unauthorized } from "@/lib/http-error";
import { computeDedupeKey } from "@/lib/crm";
import { mapMetaRow } from "@/lib/crm-meta-ingest";
import { resolveDefaultStatus, getDuplicateStatus } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto + Buffer

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const BodySchema = z.object({
  campaign: z.string().trim().min(1).max(200),
  rows: z.array(z.record(z.unknown())).min(1).max(500),
});

// POST /api/integrations/meta-leads
// Shared-secret webhook called by the Google Apps Script bound to the Meta
// lead-ads spreadsheet. One request = one campaign tab's new rows.
export const POST = withApiHandler(async (req: Request) => {
  const expected = process.env.META_LEADS_WEBHOOK_SECRET;
  if (!expected) throw new HttpError(503, "Meta leads webhook not configured", "not_configured");
  if (!secretMatches(req.headers.get("x-webhook-secret"), expected)) throw unauthorized("invalid_secret");

  const { campaign, rows } = BodySchema.parse(await req.json().catch(() => null));

  // Map rows; a row with no candidate name is counted as an error.
  const mapped = [];
  let errorRows = 0;
  for (const row of rows) {
    const m = mapMetaRow(campaign, row);
    if (!m) errorRows++;
    else mapped.push(m);
  }

  const empty = (extra: Record<string, number>) =>
    NextResponse.json({ received: rows.length, inserted: 0, duplicatesFlagged: 0, skippedAlreadyImported: 0, errorRows, ...extra });
  if (mapped.length === 0) return empty({});

  const [defStatus, dupStatus, metaSource] = await Promise.all([
    resolveDefaultStatus(),
    getDuplicateStatus(),
    prisma.leadPulseSource.findUnique({ where: { code: "meta" }, select: { id: true } }),
  ]);
  if (!defStatus) throw new HttpError(500, "No lead statuses configured — run db:seed-crm", "no_status_configured");

  const externalKeys = mapped.map((m) => m.externalKey);
  const emailKeys = mapped.map((m) => m.emailKey).filter(Boolean) as string[];
  const phones = mapped.map((m) => m.phoneE164).filter(Boolean) as string[];

  const dupWhere: Prisma.LeadWhereInput[] = [];
  if (emailKeys.length) dupWhere.push({ emailKey: { in: emailKeys } });
  if (phones.length) dupWhere.push({ phoneE164: { in: phones } });

  const [existingExt, existingDup] = await Promise.all([
    prisma.lead.findMany({ where: { externalKey: { in: externalKeys } }, select: { externalKey: true } }),
    dupWhere.length
      ? prisma.lead.findMany({ where: { OR: dupWhere }, select: { emailKey: true, phoneE164: true } })
      : Promise.resolve([] as { emailKey: string | null; phoneE164: string | null }[]),
  ]);
  const alreadyImported = new Set(existingExt.map((e) => e.externalKey).filter(Boolean) as string[]);
  const existingEmailKeys = new Set(existingDup.map((e) => e.emailKey).filter(Boolean) as string[]);
  const existingPhones = new Set(existingDup.map((e) => e.phoneE164).filter(Boolean) as string[]);

  const seenExternal = new Set<string>();
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  let skippedAlreadyImported = 0;
  let duplicatesFlagged = 0;
  const toCreate: Prisma.LeadCreateManyInput[] = [];

  for (const m of mapped) {
    // Idempotency — skip rows already ingested or repeated within this batch.
    if (alreadyImported.has(m.externalKey) || seenExternal.has(m.externalKey)) {
      skippedAlreadyImported++;
      continue;
    }
    seenExternal.add(m.externalKey);

    // Duplicate flagging — collision on email OR phone (DB or earlier in batch).
    const emailDup = !!m.emailKey && (existingEmailKeys.has(m.emailKey) || seenEmail.has(m.emailKey));
    const phoneDup = !!m.phoneE164 && (existingPhones.has(m.phoneE164) || seenPhone.has(m.phoneE164));
    const isDup = emailDup || phoneDup;
    if (m.emailKey) seenEmail.add(m.emailKey);
    if (m.phoneE164) seenPhone.add(m.phoneE164);
    if (isDup) duplicatesFlagged++;

    toCreate.push({
      candidateName: m.candidateName,
      email: m.email,
      phone: m.phone,
      phoneE164: m.phoneE164,
      emailKey: m.emailKey,
      dedupeKey: computeDedupeKey(m.email, m.phoneE164),
      externalKey: m.externalKey,
      sourceId: metaSource?.id ?? null,
      statusId: isDup && dupStatus && dupStatus.active ? dupStatus.id : defStatus.id,
      extra: m.extra,
      ...(m.createdAt ? { createdAt: m.createdAt, lastActivityAt: m.createdAt } : {}),
    });
  }

  if (toCreate.length === 0) return empty({ skippedAlreadyImported });

  const batch = await prisma.leadImportBatch.create({
    data: {
      fileName: `Meta: ${campaign}`,
      totalRows: rows.length,
      duplicateRows: duplicatesFlagged,
      errorRows,
      status: "completed",
    },
  });

  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const res = await prisma.lead.createMany({
      data: toCreate.slice(i, i + CHUNK).map((d) => ({ ...d, importBatchId: batch.id })),
      skipDuplicates: true, // race-safe against the unique externalKey
    });
    inserted += res.count;
  }

  // Timeline entry per newly-inserted lead (read back by batch — skipped rows
  // were never created, so this is exactly the inserted set).
  const created = await prisma.lead.findMany({ where: { importBatchId: batch.id }, select: { id: true } });
  if (created.length) {
    await prisma.leadActivity.createMany({
      data: created.map((l) => ({ leadId: l.id, type: "LEAD_IMPORTED", summary: `Imported from Meta — ${campaign}` })),
    });
  }
  await prisma.leadImportBatch.update({ where: { id: batch.id }, data: { insertedRows: inserted } });

  return NextResponse.json({ received: rows.length, inserted, duplicatesFlagged, skippedAlreadyImported, errorRows });
});
