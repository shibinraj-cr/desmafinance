import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";

export const dynamic = "force-dynamic";

const RAILS = ["jobs", "candidates", "pipeline", "follow-ups", "interviews", "talent-pool", "partners"] as const;

const schema = z.object({
  rail: z.enum(RAILS),
  name: z.string().trim().min(1).max(60),
  filters: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  sort: z.string().trim().max(60).nullable().optional(),
  isShared: z.boolean().optional(),
});

// GET /api/hiring/saved-views?rail=jobs — your views plus the shared ones.
export const GET = withApiHandler(async (req: Request) => {
  const access = await requireHiring("self:read");
  const rail = new URL(req.url).searchParams.get("rail");
  const views = await prisma.hiringSavedView.findMany({
    where: {
      ...(rail ? { rail } : {}),
      OR: [{ userId: access.userId }, { isShared: true }],
    },
    orderBy: [{ isShared: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ views });
});

export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("self:write");
  const body = schema.parse(await req.json());
  const view = await prisma.hiringSavedView.create({
    data: {
      userId: access.userId,
      rail: body.rail,
      name: body.name,
      filters: body.filters as never,
      sort: body.sort ?? null,
      isShared: body.isShared ?? false,
    },
  });
  return NextResponse.json({ view }, { status: 201 });
});
