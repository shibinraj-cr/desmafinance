import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { isCareersPublic, getPublicJob } from "@/lib/hiring/careers";
import { verifyCareersToken } from "@/lib/hiring/careers-token";
import { rateLimit } from "@/lib/hiring/rate-limit";
import { clientIp } from "@/lib/hiring/audit";
import { parseResumeBytes } from "@/lib/hiring/ai/resume-parse";
import { publicParseAllowed, PUBLIC_PARSE_ENTITY } from "@/lib/hiring/ai/public-parse-budget";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/**
 * Deliberately lower than the apply route's 3s.
 *
 * That one times filling in a whole form, where three seconds is plainly
 * inhuman. This times PICKING A FILE, which happens near the start of the
 * visit — and refusing here is silent, so an applicant arriving from an ad with
 * their CV already to hand would simply get no autofill and never know why. A
 * script still posts in single-digit milliseconds.
 */
const MIN_DWELL_MS = 1200;

/**
 * POST /api/careers/parse-resume — read an uploaded CV and hand the fields back
 * to the applicant to check.
 *
 * Creates nothing and stores nothing. The file stays in the applicant's browser
 * until they actually submit, so a person who fills in half the form and leaves
 * has left nothing of themselves behind.
 *
 * A paid call on a public endpoint, so it is gated in this order — cheapest and
 * most certain first, and the credit is not spent until every one has passed:
 *
 *   1. the careers site is on, and the slug is a live role
 *   2. the honeypot is empty and the form was not posted instantly
 *   3. the page-issued token is valid for THIS job
 *   4. per-IP rate limit — a speed bump; the limiter is per-instance memory
 *   5. the daily public-parse budget, which is in the database and is the only
 *      ceiling all instances share
 *
 * Every refusal returns 200 with `{ parsed: null, reason }`. The form falls
 * back to being typed in by hand, and an applicant never sees an error for
 * something that is our cost problem rather than their mistake.
 */
export const POST = withApiHandler(async (req: Request) => {
  if (!(await isCareersPublic())) throw notFound();

  const form = await req.formData();
  const slug = String(form.get("slug") ?? "");
  const job = slug ? await getPublicJob(slug) : null;
  if (!job) throw notFound();

  // Bot checks first: free, and they cost an attacker more than they cost us.
  if (String(form.get("website") ?? "").trim()) return skip("honeypot");
  const dwellMs = Number(form.get("dwellMs") ?? 0);
  if (!Number.isFinite(dwellMs) || dwellMs < MIN_DWELL_MS) return skip("too_fast");

  const token = verifyCareersToken(String(form.get("token") ?? ""), slug);
  if (!token.ok) return skip(`token_${token.reason}`);

  const ip = clientIp() ?? "unknown";
  if (!rateLimit(`careers:parse:${ip}`, 3, 30 * 60_000).ok) return skip("rate_limited");

  if (!(await publicParseAllowed())) {
    // Not an error. The budget existing is what stops a bad day becoming an
    // expensive one, and the applicant should never know it was reached.
    logger.warn("careers_parse_budget_reached", { slug });
    return skip("budget_reached");
  }

  const file = form.get("resume");
  if (!(file instanceof File) || file.size === 0) throw badRequest("No file.", "no_file");
  if (file.size > MAX_RESUME_BYTES) return skip("too_large");
  if (!file.type.includes("pdf")) return skip("not_pdf");

  try {
    const parsed = await parseResumeBytes({
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
      // No account behind a public applicant; the ledger says so rather than
      // borrowing a recruiter's id.
      userId: null,
      entityType: PUBLIC_PARSE_ENTITY,
      entityId: job.slug,
    });

    return NextResponse.json({
      parsed: {
        fullName: parsed.fullName,
        email: parsed.email,
        phone: parsed.phone,
        currentTitle: parsed.currentTitle,
        locationText: parsed.locationText,
        noticePeriodDays: parsed.noticePeriodDays,
      },
      confidence: parsed.confidence,
    });
  } catch (e) {
    // A parse failure must never block an application. Fall back silently.
    logger.error("careers_parse_failed", {
      slug,
      message: e instanceof Error ? e.message : String(e),
    });
    return skip("parse_failed");
  }
});

/** Refuse without failing: the form types it in by hand instead. */
function skip(reason: string): NextResponse {
  return NextResponse.json({ parsed: null, reason });
}
