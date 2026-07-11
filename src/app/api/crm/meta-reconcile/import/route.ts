import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { normalizePhone, computeDedupeKey, emailKeyOf, phoneMatchKeys } from "@/lib/crm";
import { resolveDefaultStatus } from "@/lib/crm-leads";
import {
  recordReInquiry,
  resolveReInquiryContext,
  notifySupervisorOfReInquiries,
  type ReInquiryOutcome,
} from "@/lib/crm-reinquiry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const META_RECONCILE_PAGE = "/crm/meta-reconcile";

const RowSchema = z.object({
  candidateName: z.string().optional().default(""),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  altPhone: z.string().nullable().optional(),
  campaign: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  extra: z.record(z.string()).nullable().optional(),
});
const BodySchema = z.object({
  fileName: z.string().nullable().optional(),
  rows: z.array(RowSchema).min(1).max(20000),
});

// POST /api/crm/meta-reconcile/import — create the selected missing leads. Rows
// that (defensively) turn out to already exist fold onto the canonical lead as a
// re-inquiry, so a duplicate is never created.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canSeePage(perms, META_RECONCILE_PAGE)) throw forbidden();

  const json = await req.json().catch(() => null);
  const body = BodySchema.parse(json);

  const [defStatus, metaSource] = await Promise.all([
    resolveDefaultStatus(),
    prisma.leadPulseSource.upsert({
      where: { code: "meta" },
      create: { code: "meta", label: "Meta", displayOrder: 1, active: true },
      update: {},
    }),
  ]);
  if (!defStatus) throw badRequest("No lead statuses configured — run db:seed-crm", "no_status_configured");

  // Re-derive the match keys server-side (never trust client-computed ones).
  type Parsed = {
    candidateName: string;
    email: string | null;
    phone: string | null;
    phoneE164: string | null;
    altPhone: string | null;
    altPhoneE164: string | null;
    emailKey: string | null;
    dedupeKey: string | null;
    campaign: string | null;
    extra: Record<string, string> | null;
  };
  const parsed: Parsed[] = [];
  const parsedEmailKeys: string[] = [];
  const parsedPhones: string[] = [];
  let errorRows = 0;
  const errors: string[] = [];

  body.rows.forEach((row, i) => {
    const email = (row.email ?? "").trim() || null;
    const phone = (row.phone ?? "").trim() || null;
    const altPhone = (row.altPhone ?? "").trim() || null;
    const phoneE164 = normalizePhone(phone);
    const altPhoneE164 = normalizePhone(altPhone);
    const emailKey = emailKeyOf(email);
    // A row with no contact key can't be matched or usefully worked — skip it.
    if (!emailKey && !phoneE164 && !altPhoneE164) {
      errorRows++;
      if (errors.length < 20) errors.push(`Row ${i + 1}: no phone or email`);
      return;
    }
    const extra: Record<string, string> = { ...(row.extra ?? {}) };
    if (row.city) extra.City = row.city;
    if (row.createdAt) extra["Meta Date"] = row.createdAt;

    if (emailKey) parsedEmailKeys.push(emailKey);
    for (const ph of phoneMatchKeys(phoneE164, altPhoneE164)) parsedPhones.push(ph);

    parsed.push({
      candidateName: (row.candidateName ?? "").trim() || "Meta Lead",
      email,
      phone,
      phoneE164,
      altPhone,
      altPhoneE164,
      emailKey,
      dedupeKey: computeDedupeKey(email, phoneE164),
      campaign: (row.campaign ?? "").trim() || null,
      extra: Object.keys(extra).length ? extra : null,
    });
  });

  if (parsed.length === 0) throw badRequest("None of the selected rows have a phone or email.", "no_valid_rows");

  // Existing leads colliding on email OR phone (defensive — the CRM may have
  // changed since the reconcile preview). A collision folds onto the canonical
  // lead as a re-inquiry instead of inserting a duplicate.
  const dupWhere: Prisma.LeadWhereInput[] = [];
  if (parsedEmailKeys.length) dupWhere.push({ emailKey: { in: parsedEmailKeys } });
  if (parsedPhones.length) {
    dupWhere.push({ phoneE164: { in: parsedPhones } });
    dupWhere.push({ altPhoneE164: { in: parsedPhones } });
  }
  const existing = dupWhere.length
    ? await prisma.lead.findMany({
        where: { OR: dupWhere },
        select: { id: true, emailKey: true, phoneE164: true, altPhoneE164: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const existingByEmail = new Map<string, string>();
  const existingByPhone = new Map<string, string>();
  for (const e of existing) {
    if (e.emailKey && !existingByEmail.has(e.emailKey)) existingByEmail.set(e.emailKey, e.id);
    for (const ph of phoneMatchKeys(e.phoneE164, e.altPhoneE164)) {
      if (!existingByPhone.has(ph)) existingByPhone.set(ph, e.id);
    }
  }

  const seenEmailKeys = new Set<string>();
  const seenPhones = new Set<string>();
  const toCreate: Prisma.LeadCreateManyInput[] = [];
  const reInquiriesExisting: { leadId: string }[] = [];
  const reInquiriesWithinFile: { emailKey: string | null; phoneE164: string | null; altPhoneE164: string | null }[] = [];
  const importedAt = new Date();

  for (const p of parsed) {
    const phoneKeys = phoneMatchKeys(p.phoneE164, p.altPhoneE164);
    const existingId =
      (p.emailKey && existingByEmail.get(p.emailKey)) ||
      phoneKeys.map((ph) => existingByPhone.get(ph)).find(Boolean) ||
      null;
    if (existingId) {
      reInquiriesExisting.push({ leadId: existingId });
      continue;
    }
    const withinFileDup =
      (!!p.emailKey && seenEmailKeys.has(p.emailKey)) || phoneKeys.some((ph) => seenPhones.has(ph));
    if (withinFileDup) {
      reInquiriesWithinFile.push({ emailKey: p.emailKey, phoneE164: p.phoneE164, altPhoneE164: p.altPhoneE164 });
      continue;
    }
    if (p.emailKey) seenEmailKeys.add(p.emailKey);
    for (const ph of phoneKeys) seenPhones.add(ph);
    toCreate.push({
      candidateName: p.candidateName,
      email: p.email,
      phone: p.phone,
      phoneE164: p.phoneE164,
      altPhone: p.altPhone,
      altPhoneE164: p.altPhoneE164,
      emailKey: p.emailKey,
      dedupeKey: p.dedupeKey,
      sourceId: metaSource.id,
      campaign: p.campaign,
      statusId: defStatus.id,
      extra: p.extra ?? Prisma.JsonNull,
      createdById: userId,
    });
  }

  const insertedRows = toCreate.length;
  const duplicateRows = reInquiriesExisting.length + reInquiriesWithinFile.length;
  const totalRows = parsed.length + errorRows;

  const batch = await prisma.leadImportBatch.create({
    data: {
      fileName: body.fileName ? `Meta reconcile — ${body.fileName}` : "Meta reconcile",
      uploadedById: userId,
      totalRows,
      insertedRows,
      duplicateRows,
      errorRows,
      status: "completed",
    },
  });

  const CHUNK = 500;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    await prisma.lead.createMany({
      data: toCreate.slice(i, i + CHUNK).map((d) => ({ ...d, importBatchId: batch.id })),
    });
  }

  const created = await prisma.lead.findMany({
    where: { importBatchId: batch.id },
    select: { id: true, emailKey: true, phoneE164: true, altPhoneE164: true },
  });
  if (created.length) {
    await prisma.leadActivity.createMany({
      data: created.map((l) => ({
        leadId: l.id,
        actorId: userId,
        type: "LEAD_IMPORTED",
        summary: body.fileName ? `Imported via Meta reconciliation from ${body.fileName}` : "Imported via Meta reconciliation",
      })),
    });
  }

  // Fold re-inquiries (existing-DB matches + later sightings within this batch).
  const reInquiryOutcomes: ReInquiryOutcome[] = [];
  if (duplicateRows > 0) {
    const ctx = await resolveReInquiryContext();
    const createdByEmail = new Map<string, string>();
    const createdByPhone = new Map<string, string>();
    for (const l of created) {
      if (l.emailKey && !createdByEmail.has(l.emailKey)) createdByEmail.set(l.emailKey, l.id);
      for (const ph of phoneMatchKeys(l.phoneE164, l.altPhoneE164)) {
        if (!createdByPhone.has(ph)) createdByPhone.set(ph, l.id);
      }
    }
    const source = "Meta reconciliation";
    for (const r of reInquiriesExisting) {
      const o = await recordReInquiry({ leadId: r.leadId, source, actorId: userId, occurredAt: importedAt }, ctx);
      if (o) reInquiryOutcomes.push(o);
    }
    for (const r of reInquiriesWithinFile) {
      const leadId =
        (r.emailKey && createdByEmail.get(r.emailKey)) ||
        phoneMatchKeys(r.phoneE164, r.altPhoneE164).map((ph) => createdByPhone.get(ph)).find(Boolean) ||
        null;
      if (!leadId) continue;
      const o = await recordReInquiry({ leadId, source, actorId: userId, occurredAt: importedAt }, ctx);
      if (o) reInquiryOutcomes.push(o);
    }
    await notifySupervisorOfReInquiries(reInquiryOutcomes, ctx, new URL(req.url).origin);
  }

  return NextResponse.json({
    batchId: batch.id,
    totalRows,
    insertedRows,
    reInquiryRows: duplicateRows,
    revivedRows: reInquiryOutcomes.filter((o) => o.revived).length,
    errorRows,
    errors,
  });
});
