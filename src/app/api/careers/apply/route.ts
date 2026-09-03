import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, unprocessable } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { siteBaseUrl } from "@/lib/site-url";
import { getEmailConfig, sendEmail } from "@/lib/mailer";
import { uploadProof, isBlobConfigured } from "@/lib/ops-blob";
import { submitApplication } from "@/lib/hiring/apply";
import { rateLimit } from "@/lib/hiring/rate-limit";
import { clientIp } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/careers/apply — the PUBLIC application endpoint.
 *
 * Unauthenticated by design (see the middleware matcher). Everything a stranger
 * can reach is treated as hostile input: multipart is size-capped, the résumé's
 * type is checked, the honeypot and dwell-time gates run before any DB write,
 * and the response never reveals whether an email already exists in the system.
 */

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
/** A human takes longer than this to fill a form; a script does not. */
const MIN_DWELL_MS = 3000;

const bodySchema = z.object({
  jobId: z.string().min(1),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  portfolioUrl: z.string().trim().max(500).optional(),
  linkedinUrl: z.string().trim().max(500).optional(),
  locationText: z.string().trim().max(160).optional(),
  currentTitle: z.string().trim().max(120).optional(),
  currentEmployer: z.string().trim().max(120).optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  expectedCtcLakh: z.coerce.number().min(0).max(999).optional(),
  answers: z.record(z.union([z.string(), z.array(z.string())])).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "Consent is required to apply." }) }),
  /** Honeypot — a real applicant never sees this field. */
  website: z.string().max(0).optional(),
  /** Milliseconds the form was on screen before submit. */
  dwellMs: z.coerce.number().int().min(0).max(86_400_000).optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const ip = clientIp() ?? "unknown";
  const limited = rateLimit(`careers:apply:${ip}`, 5, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many applications from here. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  const form = await req.formData();
  const raw: Record<string, unknown> = {};
  const answers: Record<string, string | string[]> = {};
  const answerFiles: [string, File][] = [];
  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      // A `file` screening question posts its upload under the same key prefix
      // as a text answer; it is stored like the résumé and the answer becomes
      // the stored URL.
      if (key.startsWith("answer:") && value.size > 0) answerFiles.push([key.slice(7), value]);
      continue;
    }
    if (key.startsWith("answer:")) {
      const qid = key.slice("answer:".length);
      const prev = answers[qid];
      // A multi-select posts the same key more than once.
      if (prev === undefined) answers[qid] = String(value);
      else if (Array.isArray(prev)) prev.push(String(value));
      else answers[qid] = [prev, String(value)];
      continue;
    }
    raw[key] = value;
  }
  raw.answers = answers;
  raw.consent = raw.consent === "true" || raw.consent === "on" || raw.consent === true;

  const body = bodySchema.parse(raw);

  // Bot gates. Both answer "looks automated" with the same generic success as a
  // real submission would give — telling a script which gate caught it just
  // teaches it how to pass next time.
  const looksAutomated =
    (body.website ?? "") !== "" || (body.dwellMs != null && body.dwellMs < MIN_DWELL_MS);
  if (looksAutomated) {
    logger.warn("careers_apply_bot_gate", { jobId: body.jobId, ip });
    return NextResponse.json({ ok: true });
  }

  if (!body.email && !body.phone) {
    throw badRequest("An email address or a phone number is needed.", "no_contact");
  }

  const job = await prisma.hiringJob.findFirst({
    where: { id: body.jobId, status: "live", deletedAt: null },
    select: { id: true, title: true, slug: true, resumeMode: true },
  });
  if (!job) throw unprocessable("That role is no longer accepting applications.", "job_closed");

  // Résumé OR portfolio link — one of the two, when the job asks for it.
  const file = form.get("resume");
  const hasFile = file instanceof File && file.size > 0;
  if (job.resumeMode === "required" && !hasFile && !body.portfolioUrl?.trim()) {
    throw badRequest("Attach a résumé or give a portfolio link.", "resume_required");
  }

  let resumeUrl: string | null = null;
  if (hasFile) {
    const f = file as File;
    if (f.size > MAX_RESUME_BYTES) {
      throw badRequest("That file is over 5 MB. Attach a smaller one.", "resume_too_large");
    }
    if (f.type && !ALLOWED_RESUME_TYPES.has(f.type)) {
      throw badRequest("Résumés must be a PDF or Word document.", "resume_bad_type");
    }
    if (!isBlobConfigured()) {
      // Losing the file silently would be worse than saying so.
      throw unprocessable(
        "File uploads are not configured yet — apply with a portfolio or LinkedIn link instead.",
        "storage_unconfigured",
      );
    }
    const safeName = f.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "resume.pdf";
    resumeUrl = await uploadProof(
      `hiring/resumes/${job.slug}/${Date.now()}-${safeName}`,
      await f.arrayBuffer(),
      f.type || "application/octet-stream",
    );
  }

  // Per-question file answers, stored the same way and under the same caps.
  for (const [qid, f] of answerFiles) {
    if (f.size > MAX_RESUME_BYTES) {
      throw badRequest(`One of your uploads is over 5 MB.`, "answer_file_too_large");
    }
    if (!isBlobConfigured()) {
      throw unprocessable(
        "File uploads are not configured yet — answer without an attachment.",
        "storage_unconfigured",
      );
    }
    const safe = f.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "answer";
    body.answers = body.answers ?? {};
    body.answers[qid] = await uploadProof(
      `hiring/answers/${job.slug}/${Date.now()}-${safe}`,
      await f.arrayBuffer(),
      f.type || "application/octet-stream",
    );
  }

  const result = await submitApplication({
    jobId: job.id,
    fullName: body.fullName,
    email: body.email ?? null,
    phone: body.phone ?? null,
    resumeUrl,
    portfolioUrl: body.portfolioUrl || null,
    linkedinUrl: body.linkedinUrl || null,
    locationText: body.locationText || null,
    currentTitle: body.currentTitle || null,
    currentEmployer: body.currentEmployer || null,
    noticePeriodDays: body.noticePeriodDays ?? null,
    expectedCtcLakh: body.expectedCtcLakh ?? null,
    answers: body.answers,
    source: "careers_page",
    sourceDetail: `careers/${job.slug}`,
    consent: true,
  });

  await sendAcknowledgement({
    applicationId: result.applicationId,
    to: body.email ?? null,
    name: body.fullName,
    jobTitle: job.title,
    siteUrl: siteBaseUrl(req),
  });

  return NextResponse.json({ ok: true, applicationId: result.applicationId }, { status: 201 });
});

/**
 * Best-effort acknowledgement. A failure here must never fail the application —
 * the candidate is already in the pipeline, and telling them "something went
 * wrong" would invite a duplicate submission.
 */
async function sendAcknowledgement(opts: {
  applicationId: string;
  to: string | null;
  name: string;
  jobTitle: string;
  siteUrl: string;
}): Promise<void> {
  if (!opts.to) return;
  try {
    const cfg = await getEmailConfig();
    if (!cfg) return;
    const firstName = opts.name.trim().split(/\s+/)[0] ?? opts.name;
    await sendEmail(cfg, {
      to: opts.to,
      subject: `We have your application — ${opts.jobTitle}`,
      text:
        `Hi ${firstName},\n\n` +
        `Thank you for applying for the ${opts.jobTitle} role at DESMA International. ` +
        `Your application is with our hiring team.\n\n` +
        `We read every application. If your experience lines up with what the role needs, ` +
        `someone from the team will contact you — usually within a week.\n\n` +
        `— DESMA International\n${opts.siteUrl}/careers/desma`,
    });
    await prisma.hiringApplicationEvent.create({
      data: {
        applicationId: opts.applicationId,
        type: "email_sent",
        payload: { kind: "application_acknowledgement", to: opts.to },
      },
    });
  } catch (e) {
    logger.error("careers_ack_failed", {
      applicationId: opts.applicationId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
