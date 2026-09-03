import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { TRIGGER_TYPES, ACTION_TYPES } from "@/lib/hiring/automations";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  trigger: z.object({ type: z.enum(TRIGGER_TYPES), params: z.record(z.unknown()).optional() }).optional(),
  actions: z
    .array(z.object({ type: z.enum(ACTION_TYPES), params: z.record(z.unknown()).optional() }))
    .min(1)
    .max(10)
    .optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("automation:manage");
  const body = schema.parse(await req.json());

  const existing = await prisma.hiringAutomation.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound("That recipe no longer exists.");

  const automation = await prisma.hiringAutomation.update({
    where: { id: params.id },
    data: {
      name: body.name,
      description: body.description,
      trigger: body.trigger as never,
      actions: body.actions as never,
      isActive: body.isActive,
      // Switching a paused recipe back on clears the streak: it is being
      // re-armed deliberately, and carrying two old failures forward would pause
      // it again on the first hiccup.
      ...(body.isActive === true ? { errorStreak: 0, pausedAt: null, pauseReason: null } : {}),
    },
  });

  return NextResponse.json({ automation });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("automation:manage");
  // Runs cascade with the recipe; the application events they wrote stay, since
  // those are history and this is configuration.
  await prisma.hiringAutomation.delete({ where: { id: params.id } }).catch(() => undefined);
  return NextResponse.json({ ok: true });
});
