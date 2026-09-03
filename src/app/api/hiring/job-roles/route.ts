import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { SENIORITIES } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(2).max(140),
  department: z.string().trim().min(1).max(80),
  defaultSeniority: z.enum(SENIORITIES).default("mid"),
});

// The canonical titles the company hires for — every job-title picker reads
// from here so the same role is spelled the same way everywhere.
export const GET = withApiHandler(async () => {
  await requireHiring("job:read");
  const roles = await prisma.hiringJobRole.findMany({
    where: { isActive: true },
    orderBy: [{ department: "asc" }, { title: "asc" }],
  });
  return NextResponse.json({ roles });
});

export const POST = withApiHandler(async (req: Request) => {
  await requireHiring("job:write");
  const body = schema.parse(await req.json());
  const existing = await prisma.hiringJobRole.findUnique({ where: { title: body.title } });
  if (existing) throw conflict("That job title already exists.", "duplicate_role");

  const role = await prisma.hiringJobRole.create({ data: body });
  return NextResponse.json({ role }, { status: 201 });
});
