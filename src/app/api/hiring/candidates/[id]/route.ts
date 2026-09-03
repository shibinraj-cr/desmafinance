import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, conflict } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { normalizeEmail, normalizeCandidatePhone } from "@/lib/hiring/core";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  currentTitle: z.string().trim().max(120).nullable().optional(),
  currentEmployer: z.string().trim().max(120).nullable().optional(),
  locationText: z.string().trim().max(160).nullable().optional(),
  totalExperienceYears: z.number().min(0).max(60).nullable().optional(),
  noticePeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  currentCtcLakh: z.number().min(0).max(999).nullable().optional(),
  expectedCtcLakh: z.number().min(0).max(999).nullable().optional(),
  linkedinUrl: z.string().trim().max(500).nullable().optional(),
  portfolioUrl: z.string().trim().max(500).nullable().optional(),
  whatsappOptIn: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  ownerId: z.string().nullable().optional(),
});

/**
 * PATCH /api/hiring/candidates/[id] — edit the PERSON.
 *
 * Every field touched here is recorded in `humanEditedFields`, which is what
 * stops a later résumé re-parse or a second application quietly overwriting a
 * correction someone made by hand (§4.3).
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("candidate:write");
  const body = patchSchema.parse(await req.json());

  const before = await prisma.hiringCandidate.findFirst({
    where: { id: params.id, deletedAt: null },
  });
  if (!before) throw notFound("That candidate no longer exists.");

  const email = body.email === undefined ? undefined : normalizeEmail(body.email);
  const phone = body.phone === undefined ? undefined : normalizeCandidatePhone(body.phone);

  // The dedupe keys are unique; say which person already holds it rather than
  // letting a raw constraint error reach the UI.
  if (email && email !== before.email) {
    const clash = await prisma.hiringCandidate.findUnique({ where: { email } });
    if (clash) throw conflict("Another candidate already has that email address.", "duplicate_email");
  }
  if (phone && phone !== before.phone) {
    const clash = await prisma.hiringCandidate.findUnique({ where: { phone } });
    if (clash) throw conflict("Another candidate already has that phone number.", "duplicate_phone");
  }

  const edited = new Set(before.humanEditedFields);
  for (const key of Object.keys(body)) edited.add(key);

  const candidate = await prisma.hiringCandidate.update({
    where: { id: params.id },
    data: {
      fullName: body.fullName,
      email,
      phone,
      currentTitle: body.currentTitle,
      currentEmployer: body.currentEmployer,
      locationText: body.locationText,
      totalExperienceYears: body.totalExperienceYears,
      noticePeriodDays: body.noticePeriodDays,
      currentCtcLakh: body.currentCtcLakh,
      expectedCtcLakh: body.expectedCtcLakh,
      linkedinUrl: body.linkedinUrl,
      portfolioUrl: body.portfolioUrl,
      whatsappOptIn: body.whatsappOptIn,
      tags: body.tags,
      ownerId: body.ownerId,
      humanEditedFields: [...edited],
    },
  });

  return NextResponse.json({ candidate });
});

/** Soft delete — the person's pipeline history is kept for the funnel. */
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("candidate:write");
  const candidate = await prisma.hiringCandidate.findFirst({
    where: { id: params.id, deletedAt: null },
  });
  if (!candidate) throw notFound("That candidate no longer exists.");

  await prisma.$transaction([
    prisma.hiringCandidate.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), isActive: false },
    }),
    prisma.hiringApplication.updateMany({
      where: { candidateId: params.id, deletedAt: null },
      data: { deletedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
});
