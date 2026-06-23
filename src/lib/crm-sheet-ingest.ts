// Generic Google-Sheets → CRM lead ingestion, shared by every spreadsheet
// source (Meta lead-ads, Website/SEO form, …). Each source declares its own
// column aliases; the core (dedupe + create + activity) is identical.
//
// Column headers vary wildly between sources ("Name" vs "Full Name" vs the
// Contact-Form-7 tag "your-name"; "Phone" vs "phonetext-354"), so fields are
// resolved by a per-source, case-insensitive alias list rather than fixed
// indexes. Phone often arrives as a number from Sheets — normalizePhone digests it.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { badRequest, HttpError } from "./http-error";
import { normalizePhone, emailKeyOf, computeDedupeKey, phoneMatchKeys } from "./crm";
import { resolveDefaultStatus } from "./crm-leads";
import {
  recordReInquiry,
  resolveReInquiryContext,
  notifySupervisorOfReInquiries,
  type ReInquiryOutcome,
} from "./crm-reinquiry";

const GENERIC_NAME = ["name", "full name", "candidate name", "candidate", "fullname"];
const GENERIC_EMAIL = ["email", "email address", "e-mail", "mail", "email id"];
const GENERIC_PHONE = ["phone", "phone number", "phone no", "mobile", "mobile number", "contact", "contact number", "number", "whatsapp"];
const GENERIC_DATE = ["date", "created", "created time", "created_time", "lead date", "timestamp"];

export type SheetSourceConfig = {
  /** Payload key (what the Apps Script sends as `source`). */
  key: string;
  /** LeadPulseSource.code to stamp on created leads. */
  sourceCode: string;
  /** Human label for the timeline summary. */
  label: string;
  nameKeys: string[];
  emailKeys: string[];
  phoneKeys: string[];
  dateKeys: string[];
};

export const SHEET_SOURCES: Record<string, SheetSourceConfig> = {
  meta: {
    key: "meta",
    sourceCode: "meta",
    label: "Meta",
    nameKeys: GENERIC_NAME,
    emailKeys: GENERIC_EMAIL,
    phoneKeys: GENERIC_PHONE,
    dateKeys: GENERIC_DATE,
  },
  website: {
    key: "website",
    sourceCode: "website",
    label: "Website (SEO)",
    // WordPress / Contact Form 7 field tags first, then generic fallbacks.
    nameKeys: ["your-name", ...GENERIC_NAME],
    emailKeys: ["your-email", ...GENERIC_EMAIL],
    phoneKeys: ["phonetext-354", "your-phone", ...GENERIC_PHONE],
    dateKeys: GENERIC_DATE,
  },
};

export type SheetRow = Record<string, unknown>;

export type MappedLead = {
  candidateName: string;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  emailKey: string | null;
  createdAt: Date | null;
  extra: Record<string, string>;
  externalKey: string;
};

function cell(row: SheetRow, lowerToActual: Map<string, string>, keys: string[]): string {
  for (const k of keys) {
    const actual = lowerToActual.get(k);
    if (actual !== undefined) {
      const v = row[actual];
      const s = v == null ? "" : String(v).trim();
      if (s) return s;
    }
  }
  return "";
}

/** Parse a sheet date — ISO ("2026-05-27T05:47:32+0000") or human ("October 14, 2025"). */
export function parseSheetDate(raw: string): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Stable idempotency key for a sheet row, namespaced by source + campaign so the
 * same row always hashes the same (re-sends skip), while the same person in a
 * different campaign/source yields a new lead (then flagged duplicate by email/phone).
 */
export function computeExternalKey(parts: {
  source: string;
  campaign: string;
  dateISO: string | null;
  emailKey: string | null;
  phoneE164: string | null;
  name: string;
}): string {
  const basis = [
    parts.source,
    parts.campaign.trim().toLowerCase(),
    parts.dateISO ?? "",
    parts.emailKey ?? "",
    parts.phoneE164 ?? "",
    parts.name.trim().toLowerCase().replace(/\s+/g, " "),
  ].join("|");
  return parts.source + "_" + createHash("sha1").update(basis).digest("hex");
}

/** Map one spreadsheet row to a lead, or null when it has no candidate name. */
export function mapSheetRow(config: SheetSourceConfig, campaign: string, row: SheetRow): MappedLead | null {
  const lowerToActual = new Map<string, string>();
  for (const key of Object.keys(row)) {
    const norm = key.trim().toLowerCase();
    if (norm && !lowerToActual.has(norm)) lowerToActual.set(norm, key);
  }

  const candidateName = cell(row, lowerToActual, config.nameKeys);
  if (!candidateName) return null;

  const email = cell(row, lowerToActual, config.emailKeys) || null;
  const phone = cell(row, lowerToActual, config.phoneKeys) || null;
  const phoneE164 = normalizePhone(phone);
  const emailKey = emailKeyOf(email);
  const dateRaw = cell(row, lowerToActual, config.dateKeys);
  const createdAt = parseSheetDate(dateRaw);

  // Core fields are folded into first-class columns; everything else (the
  // questionnaire answers, message, campaign/adset, the sheet's own status
  // columns, etc.) is kept as context on the lead.
  const coreLower = new Set([...config.nameKeys, ...config.emailKeys, ...config.phoneKeys]);
  const extra: Record<string, string> = { campaign };
  for (const key of Object.keys(row)) {
    const norm = key.trim().toLowerCase();
    if (!norm || coreLower.has(norm)) continue;
    const v = row[key];
    const s = v == null ? "" : String(v).trim();
    if (s) extra[key.trim()] = s;
  }

  const externalKey = computeExternalKey({
    source: config.key,
    campaign,
    dateISO: createdAt ? createdAt.toISOString() : dateRaw || null,
    emailKey,
    phoneE164,
    name: candidateName,
  });

  return { candidateName, email, phone, phoneE164, emailKey, createdAt, extra, externalKey };
}

export type IngestResult = {
  received: number;
  inserted: number;
  /** Existing candidates who re-submitted — folded onto their canonical lead. */
  reInquiries: number;
  /** How many of those re-inquiries revived a lost lead to Re-marketing. */
  revived: number;
  skippedAlreadyImported: number;
  errorRows: number;
};

/**
 * Ingest a batch of spreadsheet rows for one source + campaign: map → dedupe on
 * email OR phone → create unassigned leads (source-stamped, original date
 * preserved) → write a timeline entry each. Idempotent via Lead.externalKey.
 */
export async function ingestSheetLeads(opts: {
  sourceKey: string;
  campaign: string;
  rows: SheetRow[];
}): Promise<IngestResult> {
  const config = SHEET_SOURCES[opts.sourceKey];
  if (!config) throw badRequest(`Unknown source "${opts.sourceKey}"`, "unknown_source");

  const received = opts.rows.length;
  const mapped: MappedLead[] = [];
  let errorRows = 0;
  for (const row of opts.rows) {
    const m = mapSheetRow(config, opts.campaign, row);
    if (!m) errorRows++;
    else mapped.push(m);
  }
  if (mapped.length === 0) {
    return { received, inserted: 0, reInquiries: 0, revived: 0, skippedAlreadyImported: 0, errorRows };
  }

  const [defStatus, source] = await Promise.all([
    resolveDefaultStatus(),
    prisma.leadPulseSource.findUnique({ where: { code: config.sourceCode }, select: { id: true } }),
  ]);
  if (!defStatus) throw new HttpError(500, "No lead statuses configured — run db:seed-crm", "no_status_configured");

  const externalKeys = mapped.map((m) => m.externalKey);
  const emailKeys = mapped.map((m) => m.emailKey).filter(Boolean) as string[];
  const phones = mapped.map((m) => m.phoneE164).filter(Boolean) as string[];

  // Incoming sheet rows only carry a primary number, but it must still match an
  // existing lead's ALTERNATE number — so we look the incoming phones up against
  // both phone fields, and register both of each existing lead's numbers.
  const dupWhere: Prisma.LeadWhereInput[] = [];
  if (emailKeys.length) dupWhere.push({ emailKey: { in: emailKeys } });
  if (phones.length) {
    dupWhere.push({ phoneE164: { in: phones } });
    dupWhere.push({ altPhoneE164: { in: phones } });
  }

  const [existingExt, existingDup] = await Promise.all([
    prisma.lead.findMany({ where: { externalKey: { in: externalKeys } }, select: { externalKey: true } }),
    dupWhere.length
      ? prisma.lead.findMany({
          where: { OR: dupWhere },
          select: { id: true, emailKey: true, phoneE164: true, altPhoneE164: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([] as { id: string; emailKey: string | null; phoneE164: string | null; altPhoneE164: string | null }[]),
  ]);
  const alreadyImported = new Set(existingExt.map((e) => e.externalKey).filter(Boolean) as string[]);
  // Oldest existing lead per key = the canonical lead a re-inquiry folds onto.
  const existingByEmail = new Map<string, string>();
  const existingByPhone = new Map<string, string>();
  for (const e of existingDup) {
    if (e.emailKey && !existingByEmail.has(e.emailKey)) existingByEmail.set(e.emailKey, e.id);
    for (const ph of phoneMatchKeys(e.phoneE164, e.altPhoneE164)) {
      if (!existingByPhone.has(ph)) existingByPhone.set(ph, e.id);
    }
  }

  const seenExternal = new Set<string>();
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  let skippedAlreadyImported = 0;
  const toCreate: Prisma.LeadCreateManyInput[] = [];
  const reInquiriesExisting: { leadId: string; occurredAt: Date | null }[] = [];
  const reInquiriesWithinBatch: { emailKey: string | null; phoneE164: string | null; occurredAt: Date | null }[] = [];

  for (const m of mapped) {
    if (alreadyImported.has(m.externalKey) || seenExternal.has(m.externalKey)) {
      skippedAlreadyImported++;
      continue;
    }
    seenExternal.add(m.externalKey);

    // Existing candidate → re-inquiry on their canonical lead (no new row).
    const existingId =
      (m.emailKey && existingByEmail.get(m.emailKey)) || (m.phoneE164 && existingByPhone.get(m.phoneE164)) || null;
    if (existingId) {
      reInquiriesExisting.push({ leadId: existingId, occurredAt: m.createdAt });
      continue;
    }
    // Same person twice in this payload → re-inquiry on the row we're creating.
    const withinBatchDup = (!!m.emailKey && seenEmail.has(m.emailKey)) || (!!m.phoneE164 && seenPhone.has(m.phoneE164));
    if (withinBatchDup) {
      reInquiriesWithinBatch.push({ emailKey: m.emailKey, phoneE164: m.phoneE164, occurredAt: m.createdAt });
      continue;
    }
    if (m.emailKey) seenEmail.add(m.emailKey);
    if (m.phoneE164) seenPhone.add(m.phoneE164);

    toCreate.push({
      candidateName: m.candidateName,
      email: m.email,
      phone: m.phone,
      phoneE164: m.phoneE164,
      emailKey: m.emailKey,
      dedupeKey: computeDedupeKey(m.email, m.phoneE164),
      externalKey: m.externalKey,
      sourceId: source?.id ?? null,
      statusId: defStatus.id,
      campaign: opts.campaign,
      extra: m.extra,
      ...(m.createdAt ? { createdAt: m.createdAt, lastActivityAt: m.createdAt } : {}),
    });
  }

  const reInquiryTotal = reInquiriesExisting.length + reInquiriesWithinBatch.length;
  if (toCreate.length === 0 && reInquiryTotal === 0) {
    return { received, inserted: 0, reInquiries: 0, revived: 0, skippedAlreadyImported, errorRows };
  }

  let inserted = 0;
  const createdByEmail = new Map<string, string>();
  const createdByPhone = new Map<string, string>();
  if (toCreate.length > 0) {
    const batch = await prisma.leadImportBatch.create({
      data: {
        fileName: `${config.label}: ${opts.campaign}`,
        totalRows: received,
        duplicateRows: reInquiryTotal,
        errorRows,
        status: "completed",
      },
    });

    const CHUNK = 500;
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const res = await prisma.lead.createMany({
        data: toCreate.slice(i, i + CHUNK).map((d) => ({ ...d, importBatchId: batch.id })),
        skipDuplicates: true, // race-safe against the unique externalKey
      });
      inserted += res.count;
    }

    const created = await prisma.lead.findMany({
      where: { importBatchId: batch.id },
      select: { id: true, emailKey: true, phoneE164: true },
    });
    if (created.length) {
      await prisma.leadActivity.createMany({
        data: created.map((l) => ({ leadId: l.id, type: "LEAD_IMPORTED", summary: `Imported from ${config.label} — ${opts.campaign}` })),
      });
    }
    for (const l of created) {
      if (l.emailKey && !createdByEmail.has(l.emailKey)) createdByEmail.set(l.emailKey, l.id);
      if (l.phoneE164 && !createdByPhone.has(l.phoneE164)) createdByPhone.set(l.phoneE164, l.id);
    }
    await prisma.leadImportBatch.update({ where: { id: batch.id }, data: { insertedRows: inserted } });
  }

  // Fold the re-inquiries onto their canonical leads.
  const outcomes: ReInquiryOutcome[] = [];
  if (reInquiryTotal > 0) {
    const ctx = await resolveReInquiryContext();
    for (const r of reInquiriesExisting) {
      const o = await recordReInquiry({ leadId: r.leadId, source: config.label, campaign: opts.campaign, occurredAt: r.occurredAt }, ctx);
      if (o) outcomes.push(o);
    }
    for (const r of reInquiriesWithinBatch) {
      const leadId = (r.emailKey && createdByEmail.get(r.emailKey)) || (r.phoneE164 && createdByPhone.get(r.phoneE164)) || null;
      if (!leadId) continue;
      const o = await recordReInquiry({ leadId, source: config.label, campaign: opts.campaign, occurredAt: r.occurredAt }, ctx);
      if (o) outcomes.push(o);
    }
    await notifySupervisorOfReInquiries(outcomes, ctx, process.env.NEXTAUTH_URL);
  }

  return {
    received,
    inserted,
    reInquiries: reInquiryTotal,
    revived: outcomes.filter((o) => o.revived).length,
    skippedAlreadyImported,
    errorRows,
  };
}
