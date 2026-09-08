import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { HIRING_TIMEZONE } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).default("India"),
});

export const GET = withApiHandler(async () => {
  await requireHiring("job:read");
  const locations = await prisma.hiringLocation.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ locations });
});

export const POST = withApiHandler(async (req: Request) => {
  await requireHiring("job:write");
  const body = schema.parse(await req.json());
  const existing = await prisma.hiringLocation.findUnique({ where: { name: body.name } });
  if (existing) throw conflict("There is already a place with that name.", "duplicate_location");

  const location = await prisma.hiringLocation.create({
    data: { ...body, timezone: HIRING_TIMEZONE },
  });
  return NextResponse.json({ location }, { status: 201 });
});
