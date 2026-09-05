import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, conflict } from "@/lib/http-error";
import { submitApplication } from "@/lib/hiring/apply";
import { rateLimit } from "@/lib/hiring/rate-limit";
import { clientIp } from "@/lib/hiring/audit";
import { PARTNER_COOKIE, resolvePartnerSession, grantedJobIds } from "@/lib/hiring/partner-scope";

export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.string().min(1),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  currentTitle: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/partners/submit — the ONLY write an external partner can make.
 *
 * The job id is checked against THEIR grant list, not merely against "is this a
 * real job": a partner submitting into a requisition they were never given is
 * the exact boundary this module has to hold.
 */
export const POST = withApiHandler(async (req: Request) => {
  const partnerId = await resolvePartnerSession(cookies().get(PARTNER_COOKIE)?.value);
  if (!partnerId) throw unauthorized("Your portal session has expired. Ask us for a fresh link.");

  const ip = clientIp() ?? "unknown";
  const limited = rateLimit(`partner:submit:${partnerId}:${ip}`, 30, 60 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "That is a lot of submissions in an hour. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  const body = schema.parse(await req.json());

  const granted = await grantedJobIds(partnerId);
  if (!granted.includes(body.jobId)) {
    throw forbidden("That role is not open to you.");
  }

  const partner = await prisma.hiringPartner.findUnique({
    where: { id: partnerId },
    select: { feePercent: true, agencyName: true },
  });

  const result = await submitApplication({
    jobId: body.jobId,
    fullName: body.fullName,
    email: body.email ?? null,
    phone: body.phone ?? null,
    currentTitle: body.currentTitle ?? null,
    source: "partner",
    sourceDetail: partner?.agencyName ?? "Sourcing partner",
    sourceAttributionId: partnerId,
    consent: false,
  });

  const existing = await prisma.hiringPartnerSubmission.findUnique({
    where: {
      partnerId_jobId_candidateId: {
        partnerId,
        jobId: body.jobId,
        candidateId: result.candidateId,
      },
    },
  });
  if (existing) throw conflict("You have already submitted this candidate for that role.", "already_submitted");

  await prisma.hiringPartnerSubmission.create({
    data: {
      partnerId,
      jobId: body.jobId,
      candidateId: result.candidateId,
      applicationId: result.applicationId,
      // The fee is snapshotted now, so a later rate change cannot rewrite what
      // was agreed for this candidate.
      feePercentAtSubmission: partner?.feePercent ?? null,
      placementStatus: "submitted",
    },
  });

  if (body.notes?.trim()) {
    await prisma.hiringNote.create({
      data: {
        applicationId: result.applicationId,
        candidateId: result.candidateId,
        bodyMd: `**Submitted by ${partner?.agencyName ?? "a sourcing partner"}:**\n\n${body.notes.trim()}`,
        visibility: "team",
      },
    });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
});
