import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { TALENT_POOL_STATES } from "@/lib/hiring/constants";
import { normalizeEmail, normalizeCandidatePhone } from "@/lib/hiring/core";
import { badRequest } from "@/lib/http-error";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (req: Request) => {
  await requireHiring("candidate:read");
  const state = new URL(req.url).searchParams.get("state");
  const rows = await prisma.hiringTalentPool.findMany({
    where: state ? { state } : {},
    include: {
      candidate: {
        select: { id: true, fullName: true, email: true, phone: true, currentTitle: true, tags: true },
      },
      owner: { select: { id: true, username: true } },
    },
    orderBy: [{ nextTouchAt: "asc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return NextResponse.json({ prospects: rows });
});

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  currentTitle: z.string().trim().max(120).optional(),
  interestAreas: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  notesMd: z.string().trim().max(4000).optional(),
  state: z.enum(TALENT_POOL_STATES).default("new"),
});

/** Add a prospect by hand — someone worth keeping warm who never applied. */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("candidate:write");
  const body = schema.parse(await req.json());

  const email = normalizeEmail(body.email ?? null);
  const phone = normalizeCandidatePhone(body.phone ?? null);
  if (!email && !phone) throw badRequest("An email address or a phone number is needed.", "no_contact");

  const existing =
    (email ? await prisma.hiringCandidate.findUnique({ where: { email } }) : null) ??
    (phone ? await prisma.hiringCandidate.findUnique({ where: { phone } }) : null);

  const candidate =
    existing ??
    (await prisma.hiringCandidate.create({
      data: {
        fullName: body.fullName,
        email,
        phone,
        currentTitle: body.currentTitle ?? null,
        source: "talent_pool",
        ownerId: access.userId,
        createdById: access.userId,
      },
    }));

  const prospect = await prisma.hiringTalentPool.upsert({
    where: { candidateId: candidate.id },
    create: {
      candidateId: candidate.id,
      state: body.state,
      interestAreas: body.interestAreas,
      notesMd: body.notesMd ?? null,
      ownerId: access.userId,
      lastTouchAt: new Date(),
    },
    update: {
      state: body.state,
      interestAreas: body.interestAreas,
      notesMd: body.notesMd ?? undefined,
    },
  });

  return NextResponse.json({ prospect, matchedExisting: !!existing }, { status: 201 });
});
