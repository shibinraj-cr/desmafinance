import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { normalizePhone, computeDedupeKey, phoneMatchKeys } from "@/lib/crm";
import { resolveDefaultStatus } from "@/lib/crm-leads";
import {
  recordReInquiry,
  resolveReInquiryContext,
  notifySupervisorOfReInquiries,
  type ReInquiryOutcome,
} from "@/lib/crm-reinquiry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VOXBAY_RECONCILE_PAGE = "/crm/voxbay-reconcile";

const CallerSchema = z.object({
  sourceNumber: z.string(),
  contactName: z.string().nullable().optional(),
  callCount: z.number().optional(),
  lastCallAt: z.string().nullable().optional(),
  agents: z.array(z.string()).optional(),
});
const BodySchema = z.object({
  fileName: z.string().nullable().optional(),
  callers: z.array(CallerSchema).min(1).max(20000),
});

// POST /api/crm/voxbay-reconcile/import — create phone-only leads for the
// selected missing callers. Any that already exist (defensively) fold into a
// re-inquiry rather than duplicating.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canSeePage(perms, VOXBAY_RECONCILE_PAGE)) throw forbidden();

  const body = BodySchema.parse(await req.json().catch(() => null));

  const [defStatus, voxbaySource] = await Promise.all([
    resolveDefaultStatus(),
    prisma.leadPulseSource.upsert({
      where: { code: "voxbay" },
      create: { code: "voxbay", label: "Voxbay", displayOrder: 6, active: true },
      update: {},
    }),
  ]);
  if (!defStatus) throw badRequest("No lead statuses configured — run db:seed-crm", "no_status_configured");

  type Parsed = {
    candidateName: string;
    phone: string;
    phoneE164: string;
    dedupeKey: string | null;
    extra: Record<string, string> | null;
  };
  const parsed: Parsed[] = [];
  const parsedPhones: string[] = [];
  let errorRows = 0;
  const errors: string[] = [];

  body.callers.forEach((c, i) => {
    const phoneE164 = normalizePhone(c.sourceNumber);
    if (!phoneE164) {
      errorRows++;
      if (errors.length < 20) errors.push(`Row ${i + 1}: “${c.sourceNumber}” is not a valid phone number`);
      return;
    }
    const extra: Record<string, string> = { "Voxbay caller": c.sourceNumber };
    if (c.callCount) extra["Voxbay calls"] = String(c.callCount);
    if (c.lastCallAt) extra["Voxbay last call"] = c.lastCallAt;
    if (c.agents && c.agents.length) extra["Voxbay agent"] = c.agents.join(", ");

    parsedPhones.push(...phoneMatchKeys(phoneE164, null));
    parsed.push({
      candidateName: (c.contactName ?? "").trim() || "Voxbay Caller",
      phone: c.sourceNumber,
      phoneE164,
      dedupeKey: computeDedupeKey(null, phoneE164),
      extra: Object.keys(extra).length ? extra : null,
    });
  });

  if (parsed.length === 0) throw badRequest("None of the selected callers have a valid phone number.", "no_valid_rows");

  // Defensive dedup against existing leads (the CRM may have changed since the
  // preview) — a collision folds onto the canonical lead as a re-inquiry.
  const existing = parsedPhones.length
    ? await prisma.lead.findMany({
        where: { OR: [{ phoneE164: { in: parsedPhones } }, { altPhoneE164: { in: parsedPhones } }] },
        select: { id: true, phoneE164: true, altPhoneE164: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const existingByPhone = new Map<string, string>();
  for (const e of existing) {
    for (const ph of phoneMatchKeys(e.phoneE164, e.altPhoneE164)) {
      if (!existingByPhone.has(ph)) existingByPhone.set(ph, e.id);
    }
  }

  const seenPhones = new Set<string>();
  const toCreate: Prisma.LeadCreateManyInput[] = [];
  const reInquiriesExisting: { leadId: string }[] = [];
  const reInquiriesWithinFile: { phoneE164: string }[] = [];

  for (const p of parsed) {
    const phoneKeys = phoneMatchKeys(p.phoneE164, null);
    const existingId = phoneKeys.map((ph) => existingByPhone.get(ph)).find(Boolean) || null;
    if (existingId) {
      reInquiriesExisting.push({ leadId: existingId });
      continue;
    }
    if (phoneKeys.some((ph) => seenPhones.has(ph))) {
      reInquiriesWithinFile.push({ phoneE164: p.phoneE164 });
      continue;
    }
    for (const ph of phoneKeys) seenPhones.add(ph);
    toCreate.push({
      candidateName: p.candidateName,
      phone: p.phone,
      phoneE164: p.phoneE164,
      dedupeKey: p.dedupeKey,
      sourceId: voxbaySource.id,
      campaign: "Voxbay call",
      statusId: defStatus.id,
      extra: p.extra ?? Prisma.JsonNull,
      createdById: userId,
    });
  }

  const insertedRows = toCreate.length;
  const duplicateRows = reInquiriesExisting.length + reInquiriesWithinFile.length;
  const totalRows = parsed.length + errorRows;
  const importedAt = new Date();

  const batch = await prisma.leadImportBatch.create({
    data: {
      fileName: body.fileName ? `Voxbay reconcile — ${body.fileName}` : "Voxbay reconcile",
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
    select: { id: true, phoneE164: true, altPhoneE164: true },
  });
  if (created.length) {
    await prisma.leadActivity.createMany({
      data: created.map((l) => ({
        leadId: l.id,
        actorId: userId,
        type: "LEAD_IMPORTED",
        summary: body.fileName ? `Created from Voxbay reconciliation (${body.fileName})` : "Created from Voxbay reconciliation",
      })),
    });
  }

  const reInquiryOutcomes: ReInquiryOutcome[] = [];
  if (duplicateRows > 0) {
    const ctx = await resolveReInquiryContext();
    const createdByPhone = new Map<string, string>();
    for (const l of created) {
      for (const ph of phoneMatchKeys(l.phoneE164, l.altPhoneE164)) {
        if (!createdByPhone.has(ph)) createdByPhone.set(ph, l.id);
      }
    }
    const source = "Voxbay reconciliation";
    for (const r of reInquiriesExisting) {
      const o = await recordReInquiry({ leadId: r.leadId, source, actorId: userId, occurredAt: importedAt }, ctx);
      if (o) reInquiryOutcomes.push(o);
    }
    for (const r of reInquiriesWithinFile) {
      const leadId = phoneMatchKeys(r.phoneE164, null).map((ph) => createdByPhone.get(ph)).find(Boolean) || null;
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
    errorRows,
    errors,
  });
});
