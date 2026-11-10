import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { siteBaseUrl } from "@/lib/site-url";
import { QUALIFICATION_OTHER_MAX } from "@/lib/crm";
import { INVALID_PHONE_MESSAGE, findReferralLink, submitReferral } from "@/lib/crm-referral";
// Generic despite the folder: the careers endpoint's limiter and IP reader.
import { rateLimit } from "@/lib/hiring/rate-limit";
import { clientIp } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/referral/[code] — the PUBLIC referral form.
 *
 * Unauthenticated by design (see the middleware matcher): the person filling it
 * is a friend of a candidate, with no Desgro login. Treated as hostile input
 * like the careers form — honeypot and time-on-form gates before any DB work, a
 * per-IP limit, and one answer for every outcome, so it can't be used to find
 * out whether a number already belongs to a DESMA candidate.
 */

/** A human takes longer than this to fill five fields; a script does not. */
const MIN_DWELL_MS = 3000;

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());

const bodySchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(120),
  phone: z.string().trim().min(6, INVALID_PHONE_MESSAGE).max(30),
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(200).email("Check the email address.").optional(),
  ),
  qualificationId: optionalText(64),
  qualificationOther: optionalText(QUALIFICATION_OTHER_MAX),
  serviceId: optionalText(64),
  consent: z.literal(true, { errorMap: () => ({ message: "Please tick the box to let DESMA contact you." }) }),
  /**
   * Honeypot — a real visitor never sees this field. Any length is accepted
   * here so a filled one reaches the quiet bot gate below instead of a
   * validation error that names the field.
   */
  website: z.string().max(500).optional(),
  /** Milliseconds the form was on screen before submit. */
  dwellMs: z.coerce.number().int().min(0).max(86_400_000).optional(),
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { code: string } }) => {
  const ip = clientIp() ?? "unknown";
  const limited = rateLimit(`referral:submit:${ip}`, 5, 10 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many forms from this connection. Please try again shortly." },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  const body = bodySchema.parse(await req.json().catch(() => null));

  // Bot gates answer with the same success a real submission gets — telling a
  // script which gate caught it only teaches it how to pass.
  if ((body.website ?? "") !== "" || (body.dwellMs != null && body.dwellMs < MIN_DWELL_MS)) {
    logger.warn("referral_bot_gate", { code: params.code, ip });
    return NextResponse.json({ ok: true });
  }

  const link = await findReferralLink(params.code);
  if (!link) throw notFound("This referral link doesn't exist.");

  const { outcome } = await submitReferral(link, body, { baseUrl: siteBaseUrl(req) });
  logger.info("referral_submitted", { linkId: link.id, outcome });
  return NextResponse.json({ ok: true });
});
