import { prisma } from "@/lib/prisma";
import { unprocessable, notFound, badRequest } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { getAiProvider } from "./provider";
import { meter } from "./credits";
import { normalizeEmail, normalizeCandidatePhone } from "../core";

/**
 * Résumé parsing (§4.3): PDF → structured fields, written to the candidate
 * record with a confidence flag, and NEVER silently overwriting a field a human
 * has edited.
 *
 * The PDF goes to the model as a document rather than as text we extracted
 * first, because a two-column CV's text layer interleaves the columns and the
 * "parsed" result is then confidently wrong — which is worse than not parsing.
 */

const MAX_RESUME_BYTES = 8 * 1024 * 1024;

export type ParsedResume = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  currentEmployer: string | null;
  locationText: string | null;
  totalExperienceYears: number | null;
  noticePeriodDays: number | null;
  skills: string[];
  education: string[];
  /** The model's own confidence, 0-1 — surfaced in the UI, never hidden. */
  confidence: number;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["confidence", "skills", "education"],
  properties: {
    fullName: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    currentTitle: { type: ["string", "null"], description: "Their most recent job title." },
    currentEmployer: { type: ["string", "null"] },
    locationText: { type: ["string", "null"], description: "City and state as written." },
    totalExperienceYears: { type: ["number", "null"] },
    noticePeriodDays: { type: ["integer", "null"] },
    skills: { type: "array", items: { type: "string" }, maxItems: 30 },
    education: { type: "array", items: { type: "string" }, maxItems: 10 },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "How legible this document was. Low when it is a scan, or mostly images.",
    },
  },
} as const;

/**
 * Parse a candidate's stored résumé and fill in the blanks on their record.
 *
 * Returns what it read AND what it actually wrote, because "we parsed it but
 * changed nothing, because a human had already filled those in" is a real and
 * common outcome that the UI needs to be able to say out loud.
 */
export async function parseResume(opts: {
  candidateId: string;
  userId: string;
}): Promise<{ parsed: ParsedResume; applied: string[]; skipped: string[] }> {
  const provider = getAiProvider();
  if (!provider) {
    throw unprocessable("No AI key is configured, so résumés cannot be parsed.", "ai_disabled");
  }

  const candidate = await prisma.hiringCandidate.findFirst({
    where: { id: opts.candidateId, deletedAt: null },
  });
  if (!candidate) throw notFound("That candidate no longer exists.");
  if (!candidate.resumeUrl) {
    throw badRequest("There is no résumé on file for this candidate.", "no_resume");
  }

  const { base64, contentType } = await fetchResume(candidate.resumeUrl);
  if (!contentType.includes("pdf")) {
    throw unprocessable(
      "Only PDF résumés can be parsed automatically. Ask for a PDF, or type the details in — " +
        "the fields are all editable.",
      "unsupported_resume_type",
    );
  }

  const result = await meter(
    { feature: "resume_parse", userId: opts.userId, entityType: "HiringCandidate", entityId: candidate.id },
    () =>
      provider.generateJson({
        system:
          "You read a résumé and return the facts it states. Do not infer, estimate or fill in " +
          "anything the document does not say — a null is correct and useful, an invention is not. " +
          "Report low confidence for a scanned or image-heavy document.",
        user: "Read this résumé and return its fields.",
        schema: SCHEMA as unknown as Record<string, unknown>,
        documents: [{ mediaType: "application/pdf", base64 }],
        maxTokens: 2000,
      }),
  );

  const raw = result.data as Partial<ParsedResume>;
  const parsed: ParsedResume = {
    fullName: str(raw.fullName),
    email: normalizeEmail(raw.email ?? null),
    phone: normalizeCandidatePhone(raw.phone ?? null),
    currentTitle: str(raw.currentTitle),
    currentEmployer: str(raw.currentEmployer),
    locationText: str(raw.locationText),
    totalExperienceYears: numOrNull(raw.totalExperienceYears),
    noticePeriodDays: raw.noticePeriodDays == null ? null : Math.round(raw.noticePeriodDays),
    skills: (raw.skills ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 30),
    education: (raw.education ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 10),
    confidence: typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0,
  };

  // Fill blanks only, and never touch a human-edited field.
  const edited = new Set(candidate.humanEditedFields);
  const applied: string[] = [];
  const skipped: string[] = [];
  const data: Record<string, unknown> = {};

  const consider = (field: keyof ParsedResume & string, currentValue: unknown) => {
    const value = parsed[field];
    if (value == null || value === "") return;
    if (edited.has(field)) {
      skipped.push(field);
      return;
    }
    if (currentValue != null && currentValue !== "") {
      skipped.push(field);
      return;
    }
    data[field] = value;
    applied.push(field);
  };

  consider("currentTitle", candidate.currentTitle);
  consider("currentEmployer", candidate.currentEmployer);
  consider("locationText", candidate.locationText);
  consider("totalExperienceYears", candidate.totalExperienceYears);
  consider("noticePeriodDays", candidate.noticePeriodDays);

  // Contact details are dedupe keys, so a clash must not throw here — the
  // candidate already exists and is fine; the parsed value is simply not used.
  if (parsed.email && !candidate.email && !edited.has("email")) {
    const clash = await prisma.hiringCandidate.findUnique({ where: { email: parsed.email } });
    if (clash) skipped.push("email");
    else {
      data.email = parsed.email;
      applied.push("email");
    }
  }
  if (parsed.phone && !candidate.phone && !edited.has("phone")) {
    const clash = await prisma.hiringCandidate.findUnique({ where: { phone: parsed.phone } });
    if (clash) skipped.push("phone");
    else {
      data.phone = parsed.phone;
      applied.push("phone");
    }
  }

  // Skills become tags, which is what the rest of the module can actually
  // filter on. Existing tags are kept.
  if (parsed.skills.length) {
    const merged = new Set([...candidate.tags, ...parsed.skills]);
    data.tags = [...merged].slice(0, 40);
    applied.push("tags");
  }

  if (Object.keys(data).length) {
    await prisma.hiringCandidate.update({ where: { id: candidate.id }, data });
  }

  logger.info("hiring_resume_parsed", {
    candidateId: candidate.id,
    confidence: parsed.confidence,
    applied: applied.length,
    skipped: skipped.length,
  });

  return { parsed, applied, skipped };
}

async function fetchResume(url: string): Promise<{ base64: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw unprocessable(`The résumé could not be fetched (${res.status}).`, "fetch_failed");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_RESUME_BYTES) {
      throw unprocessable("That résumé is too large to parse.", "resume_too_large");
    }
    return {
      base64: Buffer.from(buf).toString("base64"),
      contentType: res.headers.get("content-type") ?? guessTypeFromUrl(url),
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw unprocessable("Fetching the résumé timed out.", "fetch_timeout");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function guessTypeFromUrl(url: string): string {
  return /\.pdf(\?|$)/i.test(url) ? "application/pdf" : "application/octet-stream";
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
