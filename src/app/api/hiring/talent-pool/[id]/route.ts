import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { TALENT_POOL_STATES } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

const schema = z.object({
  state: z.enum(TALENT_POOL_STATES).optional(),
  interestAreas: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  notesMd: z.string().trim().max(4000).nullable().optional(),
  nextTouchAt: z.string().datetime().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  /** Set when the move is a "touch" — records that someone reached out. */
  touched: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("candidate:write");
  const body = schema.parse(await req.json());

  const existing = await prisma.hiringTalentPool.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound("That prospect is no longer in the pool.");

  const prospect = await prisma.hiringTalentPool.update({
    where: { id: params.id },
    data: {
      state: body.state,
      interestAreas: body.interestAreas,
      notesMd: body.notesMd,
      ownerId: body.ownerId,
      nextTouchAt:
        body.nextTouchAt === undefined ? undefined : body.nextTouchAt ? new Date(body.nextTouchAt) : null,
      ...(body.touched ? { lastTouchAt: new Date() } : {}),
    },
  });

  return NextResponse.json({ prospect });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("candidate:write");
  // Only the pool membership goes; the person stays, with their history.
  await prisma.hiringTalentPool.delete({ where: { id: params.id } }).catch(() => undefined);
  return NextResponse.json({ ok: true });
});
