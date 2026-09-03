import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict, notFound, forbidden } from "@/lib/http-error";
import { getHiringAccess, requireHiring } from "@/lib/hiring/access";
import { submitApplication } from "@/lib/hiring/apply";
import { can } from "@/lib/hiring/rbac";

export const dynamic = "force-dynamic";

/**
 * Referrals. Any employee may refer, and everyone sees their OWN referrals;
 * only the hiring team sees everybody's. That split is the access model here —
 * an employee-facing surface inside an internal tool still should not show one
 * colleague what another is doing.
 */
export const GET = withApiHandler(async () => {
  const access = await requireHiring("referral:manage");
  const seesAll = can(access, "candidate:read");
  const referrals = await prisma.hiringReferral.findMany({
    where: seesAll ? {} : { referrerId: access.userId },
    include: {
      job: { select: { id: true, title: true, department: true } },
      candidate: { select: { id: true, fullName: true } },
      referrer: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json({ referrals, seesAll });
});

const schema = z.object({
  jobId: z.string().min(1),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  relationship: z.string().trim().max(120).optional(),
  pitchMd: z.string().trim().max(4000).optional(),
  linkedinUrl: z.string().trim().max(500).optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const { access } = await getHiringAccess();
  if (!access) throw forbidden();
  if (!can(access, "referral:manage")) throw forbidden("Referrals are not available to you.");
  const body = schema.parse(await req.json());

  const job = await prisma.hiringJob.findFirst({
    where: { id: body.jobId, deletedAt: null, status: "live" },
    select: { id: true },
  });
  if (!job) throw notFound("That role is not open.");

  // The referred person enters the pipeline exactly like any other candidate —
  // the referral is attribution on top, not a separate pipeline.
  const result = await submitApplication({
    jobId: body.jobId,
    fullName: body.fullName,
    email: body.email ?? null,
    phone: body.phone ?? null,
    linkedinUrl: body.linkedinUrl ?? null,
    source: "referral",
    sourceDetail: `Referred by ${access.userId}`,
    sourceAttributionId: access.userId,
    createdById: access.userId,
    consent: false,
  });

  const existing = await prisma.hiringReferral.findUnique({
    where: { jobId_candidateId: { jobId: body.jobId, candidateId: result.candidateId } },
  });
  if (existing) {
    throw conflict("Somebody has already referred this person for that role.", "already_referred");
  }

  const referral = await prisma.hiringReferral.create({
    data: {
      jobId: body.jobId,
      referrerId: access.userId,
      candidateId: result.candidateId,
      relationship: body.relationship ?? null,
      pitchMd: body.pitchMd ?? null,
      status: "submitted",
    },
  });

  return NextResponse.json({ referral, applicationId: result.applicationId }, { status: 201 });
});
