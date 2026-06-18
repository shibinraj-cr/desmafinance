import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { normalizePhone, computeDedupeKey, emailKeyOf } from "@/lib/crm";
import { resolveDefaultStatus, getDuplicateStatus, getAssignableBdes } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // xlsx + Buffer need the Node runtime

const HEADER_MAP: Record<string, string> = {
  "candidate name": "candidateName",
  name: "candidateName",
  candidate: "candidateName",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone no": "phone",
  "phone number": "phone",
  mobile: "phone",
  contact: "phone",
  source: "source",
  "lead source": "source",
  service: "service",
  qualification: "qualification",
  education: "qualification",
  consultant: "consultant",
  bde: "consultant",
  "assigned to": "consultant",
  notes: "notes",
  note: "notes",
  remarks: "notes",
};
const KNOWN_KEYS = new Set(Object.values(HEADER_MAP));

// POST /api/crm/leads/import — bulk upload .xlsx / .csv (admin only)
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkImport) throw forbidden();

  const formData = await req.formData().catch(() => null);
  if (!formData) throw badRequest("Could not read the upload", "bad_form");
  const file = formData.get("file");
  if (!file || typeof file === "string") throw badRequest("No file provided", "no_file");

  const buf = Buffer.from(await (file as File).arrayBuffer());
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw badRequest("The spreadsheet has no sheets", "empty_file");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  if (rows.length < 2) throw badRequest("The sheet has no data rows", "empty_sheet");

  // Header → canonical-key index map, and a list of unmapped headers (→ extra).
  const headerRow = (rows[0] as unknown[]).map((h) => String(h ?? "").trim());
  const idx: Record<string, number> = {};
  const extraCols: { header: string; col: number }[] = [];
  headerRow.forEach((h, i) => {
    const norm = h.toLowerCase();
    const mapped = HEADER_MAP[norm];
    if (mapped) {
      if (idx[mapped] === undefined) idx[mapped] = i;
    } else if (h) {
      extraCols.push({ header: h, col: i });
    }
  });
  if (idx.candidateName === undefined) {
    throw badRequest('The spreadsheet is missing a "Candidate Name" column.', "missing_column");
  }

  // Master lookups (lowercased label/name → id), and BDE displayName/username → userId.
  const [sources, services, qualifications, bdes, defStatus, dupStatus] = await Promise.all([
    prisma.leadPulseSource.findMany({ where: { active: true }, select: { id: true, label: true } }),
    prisma.service.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.crmQualification.findMany({ where: { active: true }, select: { id: true, label: true } }),
    getAssignableBdes(),
    resolveDefaultStatus(),
    getDuplicateStatus(),
  ]);
  if (!defStatus) throw badRequest("No lead statuses configured — run db:seed-crm", "no_status_configured");

  const sourceMap = new Map(sources.map((s) => [s.label.toLowerCase(), s.id]));
  const serviceMap = new Map(services.map((s) => [s.name.toLowerCase(), s.id]));
  const qualMap = new Map(qualifications.map((q) => [q.label.toLowerCase(), q.id]));
  const bdeMap = new Map<string, string>();
  for (const b of bdes) {
    bdeMap.set(b.displayName.toLowerCase(), b.userId);
    bdeMap.set(b.username.toLowerCase(), b.userId);
  }

  // Candidate match keys gathered across the file, for cross-upload duplicate
  // flagging against existing leads. Email and phone are matched independently.
  const parsedEmailKeys: string[] = [];
  const parsedPhones: string[] = [];

  type Parsed = {
    candidateName: string;
    email: string | null;
    phone: string | null;
    phoneE164: string | null;
    emailKey: string | null;
    dedupeKey: string | null;
    sourceId: string | null;
    serviceId: string | null;
    qualificationId: string | null;
    assignedToId: string | null;
    extra: Record<string, string> | null;
  };

  const parsed: Parsed[] = [];
  let errorRows = 0;
  const errors: string[] = [];

  const get = (row: unknown[], key: string) =>
    idx[key] === undefined ? "" : String(row[idx[key]] ?? "").trim();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (row.every((c) => !String(c ?? "").trim())) continue; // blank row
    const candidateName = get(row, "candidateName");
    if (!candidateName) {
      errorRows++;
      if (errors.length < 20) errors.push(`Row ${r + 1}: missing candidate name`);
      continue;
    }
    const email = get(row, "email") || null;
    const phone = get(row, "phone") || null;
    const phoneE164 = normalizePhone(phone);
    const emailKey = emailKeyOf(email);
    const dedupeKey = computeDedupeKey(email, phoneE164); // legacy provenance key
    if (emailKey) parsedEmailKeys.push(emailKey);
    if (phoneE164) parsedPhones.push(phoneE164);

    const extra: Record<string, string> = {};
    const noteVal = get(row, "notes");
    if (noteVal) extra.notes = noteVal;
    for (const { header, col } of extraCols) {
      const v = String(row[col] ?? "").trim();
      if (v) extra[header] = v;
    }

    parsed.push({
      candidateName,
      email,
      phone,
      phoneE164,
      emailKey,
      dedupeKey,
      sourceId: sourceMap.get(get(row, "source").toLowerCase()) ?? null,
      serviceId: serviceMap.get(get(row, "service").toLowerCase()) ?? null,
      qualificationId: qualMap.get(get(row, "qualification").toLowerCase()) ?? null,
      assignedToId: bdeMap.get(get(row, "consultant").toLowerCase()) ?? null,
      extra: Object.keys(extra).length > 0 ? extra : null,
    });
  }

  // Existing leads that collide on email OR phone (matched independently).
  const dupWhere: Prisma.LeadWhereInput[] = [];
  if (parsedEmailKeys.length) dupWhere.push({ emailKey: { in: parsedEmailKeys } });
  if (parsedPhones.length) dupWhere.push({ phoneE164: { in: parsedPhones } });
  const existing = dupWhere.length
    ? await prisma.lead.findMany({ where: { OR: dupWhere }, select: { emailKey: true, phoneE164: true } })
    : [];
  const existingEmailKeys = new Set(existing.map((e) => e.emailKey).filter(Boolean) as string[]);
  const existingPhones = new Set(existing.map((e) => e.phoneE164).filter(Boolean) as string[]);

  // Decide new vs duplicate (collision on email OR phone, against the DB or an
  // earlier row in this same file).
  const seenEmailKeys = new Set<string>();
  const seenPhones = new Set<string>();
  let duplicateRows = 0;
  let insertedRows = 0;
  const toCreate: Prisma.LeadCreateManyInput[] = [];

  for (const p of parsed) {
    const emailDup = !!p.emailKey && (existingEmailKeys.has(p.emailKey) || seenEmailKeys.has(p.emailKey));
    const phoneDup = !!p.phoneE164 && (existingPhones.has(p.phoneE164) || seenPhones.has(p.phoneE164));
    const isDup = emailDup || phoneDup;
    if (p.emailKey) seenEmailKeys.add(p.emailKey);
    if (p.phoneE164) seenPhones.add(p.phoneE164);
    const statusId = isDup && dupStatus && dupStatus.active ? dupStatus.id : defStatus.id;
    if (isDup) duplicateRows++;
    else insertedRows++;
    toCreate.push({
      candidateName: p.candidateName,
      email: p.email,
      phone: p.phone,
      phoneE164: p.phoneE164,
      emailKey: p.emailKey,
      dedupeKey: p.dedupeKey,
      sourceId: p.sourceId,
      serviceId: p.serviceId,
      qualificationId: p.qualificationId,
      assignedToId: p.assignedToId,
      statusId,
      extra: p.extra ?? Prisma.JsonNull,
      createdById: userId,
    });
  }

  const totalRows = parsed.length + errorRows;

  // Persist: batch row + leads (chunked) + one LEAD_IMPORTED activity per lead.
  const batch = await prisma.leadImportBatch.create({
    data: {
      fileName: typeof (file as File).name === "string" ? (file as File).name : null,
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

  // Per-lead timeline entry. createMany doesn't return ids, so read them back.
  // Pre-assigned leads also get an ASSIGNED activity so the History reflects
  // who became the owner at import time.
  const created = await prisma.lead.findMany({
    where: { importBatchId: batch.id },
    select: { id: true, assignedToId: true },
  });
  if (created.length) {
    const acts: Prisma.LeadActivityCreateManyInput[] = [];
    for (const l of created) {
      acts.push({
        leadId: l.id,
        actorId: userId,
        type: "LEAD_IMPORTED",
        summary: batch.fileName ? `Imported from ${batch.fileName}` : "Imported",
      });
      if (l.assignedToId) {
        acts.push({
          leadId: l.id,
          actorId: userId,
          type: "ASSIGNED",
          summary: "Assigned on import",
          metadata: { toUserId: l.assignedToId },
        });
      }
    }
    await prisma.leadActivity.createMany({ data: acts });
  }

  return NextResponse.json({
    batchId: batch.id,
    totalRows,
    insertedRows,
    duplicateRows,
    errorRows,
    errors,
  });
});
