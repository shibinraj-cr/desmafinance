import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { PARTNER_STATUSES } from "@/lib/hiring/constants";
import { normalizeEmail } from "@/lib/hiring/core";
import { badRequest } from "@/lib/http-error";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => {
  await requireHiring("sourcing:manage");
  const partners = await prisma.hiringPartner.findMany({
    include: {
      jobAccess: { select: { jobId: true, job: { select: { title: true } } } },
      submissions: {
        select: { id: true, placementStatus: true, submittedAt: true, application: { select: { status: true } } },
      },
    },
    orderBy: [{ status: "asc" }, { agencyName: "asc" }],
  });

  return NextResponse.json({
    partners: partners.map((p) => {
      const submitted = p.submissions.length;
      const placed = p.submissions.filter((s) => s.placementStatus === "placed").length;
      const inPipeline = p.submissions.filter((s) => s.application?.status === "active").length;
      return {
        id: p.id,
        agencyName: p.agencyName,
        primaryContactName: p.primaryContactName,
        contactEmail: p.contactEmail,
        contactPhone: p.contactPhone,
        focusAreas: p.focusAreas,
        feePercent: p.feePercent == null ? null : Number(p.feePercent),
        status: p.status,
        grantedJobs: p.jobAccess.map((a) => ({ id: a.jobId, title: a.job.title })),
        submitted,
        inPipeline,
        placed,
        // Fill rate is placements over submissions; with nothing submitted it
        // is not 0%, it is unknown — and saying 0% would libel a new partner.
        fillRate: submitted === 0 ? null : Math.round((placed / submitted) * 100),
        invitedAt: p.invitedAt?.toISOString() ?? null,
        activatedAt: p.activatedAt?.toISOString() ?? null,
      };
    }),
  });
});

const schema = z.object({
  agencyName: z.string().trim().min(2).max(140),
  primaryContactName: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().max(200),
  contactPhone: z.string().trim().max(30).optional(),
  focusAreas: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  feePercent: z.number().min(0).max(100).nullable().optional(),
  status: z.enum(PARTNER_STATUSES).default("invited"),
});

export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("sourcing:manage");
  const body = schema.parse(await req.json());

  const email = normalizeEmail(body.contactEmail);
  if (!email) throw badRequest("That contact email is not usable.", "bad_email");

  const existing = await prisma.hiringPartner.findUnique({ where: { contactEmail: email } });
  if (existing) throw conflict("An agency with that contact email already exists.", "duplicate_partner");

  const partner = await prisma.hiringPartner.create({
    data: {
      agencyName: body.agencyName,
      primaryContactName: body.primaryContactName ?? null,
      contactEmail: email,
      contactPhone: body.contactPhone ?? null,
      focusAreas: body.focusAreas,
      feePercent: body.feePercent ?? null,
      status: body.status,
      invitedById: access.userId,
      invitedAt: new Date(),
    },
  });

  await recordHiringAudit({
    actorId: access.userId,
    action: "partner.create",
    entityType: "HiringPartner",
    entityId: partner.id,
    after: { agencyName: partner.agencyName, feePercent: body.feePercent },
  });

  return NextResponse.json({ partner }, { status: 201 });
});
