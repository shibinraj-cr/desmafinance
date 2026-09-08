import { prisma } from "@/lib/prisma";
import { normalizeEmail, normalizeCandidatePhone } from "./core";

/**
 * CSV import for the Candidates rail: column mapping, a dedupe preview, and an
 * error report — in that order, because an import that silently drops six rows
 * is worse than one that refuses them out loud.
 *
 * Nothing here writes until the user has SEEN the preview. `previewImport` and
 * `commitImport` read the same parsed rows, so what you approve is what lands.
 */

/** The fields an imported column can be mapped onto. */
export const IMPORT_FIELDS = [
  "fullName",
  "email",
  "phone",
  "currentTitle",
  "currentEmployer",
  "locationText",
  "linkedinUrl",
  "portfolioUrl",
  "noticePeriodDays",
  "expectedCtcLakh",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  fullName: "Name",
  email: "Email",
  phone: "Phone",
  currentTitle: "Current role",
  currentEmployer: "Current employer",
  locationText: "Location",
  linkedinUrl: "LinkedIn",
  portfolioUrl: "Portfolio",
  noticePeriodDays: "Notice period (days)",
  expectedCtcLakh: "Expected CTC (lakh)",
};

/** Header spellings we can map without asking. */
const HEADER_HINTS: Record<ImportField, string[]> = {
  fullName: ["name", "full name", "candidate", "candidate name"],
  email: ["email", "e-mail", "email address", "mail"],
  phone: ["phone", "mobile", "contact", "phone number", "mobile number", "whatsapp"],
  currentTitle: ["role", "title", "current role", "current title", "designation", "position"],
  currentEmployer: ["employer", "company", "current company", "organisation", "organization"],
  locationText: ["location", "city", "place", "based in"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedin profile"],
  portfolioUrl: ["portfolio", "website", "portfolio url"],
  noticePeriodDays: ["notice", "notice period", "notice period days"],
  expectedCtcLakh: ["expected ctc", "expected salary", "expectation", "expected"],
};

/** RFC4180-ish parse: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty };
}

/** Best-guess mapping from header text to field, for the mapping UI's defaults. */
export function guessMapping(headers: string[]): Record<number, ImportField | null> {
  const out: Record<number, ImportField | null> = {};
  const taken = new Set<ImportField>();
  headers.forEach((header, i) => {
    const key = header.trim().toLowerCase();
    const match = (IMPORT_FIELDS as readonly ImportField[]).find(
      (f) => !taken.has(f) && HEADER_HINTS[f].includes(key),
    );
    out[i] = match ?? null;
    if (match) taken.add(match);
  });
  return out;
}

export type ParsedRow = {
  rowNumber: number;
  values: Partial<Record<ImportField, string>>;
  fullName: string;
  email: string | null;
  phone: string | null;
};

export type RowProblem = { rowNumber: number; reason: string };

/** Apply the mapping and normalise. Rows that cannot be used are reported. */
export function mapRows(
  rows: string[][],
  mapping: Record<number, ImportField | null>,
): { parsed: ParsedRow[]; problems: RowProblem[] } {
  const parsed: ParsedRow[] = [];
  const problems: RowProblem[] = [];
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();

  rows.forEach((cells, i) => {
    // +2: one for the header row, one because humans count from 1.
    const rowNumber = i + 2;
    const values: Partial<Record<ImportField, string>> = {};
    for (const [colIdx, field] of Object.entries(mapping)) {
      if (!field) continue;
      const raw = cells[Number(colIdx)]?.trim();
      if (raw) values[field] = raw;
    }

    const fullName = values.fullName?.trim() ?? "";
    if (!fullName) {
      problems.push({ rowNumber, reason: "No name." });
      return;
    }

    const email = normalizeEmail(values.email ?? null);
    const phone = normalizeCandidatePhone(values.phone ?? null);
    if (values.email && !email) {
      problems.push({ rowNumber, reason: `"${values.email}" is not a usable email address.` });
      return;
    }
    if (!email && !phone) {
      problems.push({ rowNumber, reason: "No email and no phone — there would be no way to reach them." });
      return;
    }

    // Duplicates WITHIN the file, which a database constraint would only catch
    // one at a time and only after the first half had already been written.
    if (email && seenEmail.has(email)) {
      problems.push({ rowNumber, reason: `${email} appears earlier in this file.` });
      return;
    }
    if (phone && seenPhone.has(phone)) {
      problems.push({ rowNumber, reason: `${phone} appears earlier in this file.` });
      return;
    }
    if (email) seenEmail.add(email);
    if (phone) seenPhone.add(phone);

    parsed.push({ rowNumber, values, fullName, email, phone });
  });

  return { parsed, problems };
}

export type ImportPreview = {
  toCreate: ParsedRow[];
  /** Already in the system — the import attaches them rather than duplicating. */
  existing: (ParsedRow & { candidateId: string; alreadyOnThisJob: boolean })[];
  problems: RowProblem[];
};

export async function previewImport(
  parsed: ParsedRow[],
  problems: RowProblem[],
  jobId: string | null,
): Promise<ImportPreview> {
  const emails = parsed.map((r) => r.email).filter((e): e is string => !!e);
  const phones = parsed.map((r) => r.phone).filter((p): p is string => !!p);

  const known = await prisma.hiringCandidate.findMany({
    where: { OR: [{ email: { in: emails } }, { phone: { in: phones } }] },
    select: {
      id: true,
      email: true,
      phone: true,
      applications: jobId
        ? { where: { jobId, deletedAt: null }, select: { id: true } }
        : false,
    },
  });

  const byEmail = new Map(known.filter((k) => k.email).map((k) => [k.email!, k]));
  const byPhone = new Map(known.filter((k) => k.phone).map((k) => [k.phone!, k]));

  const toCreate: ParsedRow[] = [];
  const existing: ImportPreview["existing"] = [];
  for (const row of parsed) {
    const hit = (row.email ? byEmail.get(row.email) : undefined) ?? (row.phone ? byPhone.get(row.phone) : undefined);
    if (hit) {
      existing.push({
        ...row,
        candidateId: hit.id,
        alreadyOnThisJob: Array.isArray(hit.applications) && hit.applications.length > 0,
      });
    } else {
      toCreate.push(row);
    }
  }

  return { toCreate, existing, problems };
}

export function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
