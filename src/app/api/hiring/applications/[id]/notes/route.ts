import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";

export const dynamic = "force-dynamic";

const schema = z.object({
  bodyMd: z.string().trim().min(1).max(10_000),
  visibility: z.enum(["team", "private"]).default("team"),
  mentions: z.array(z.string()).max(20).optional(),
});

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("candidate:write");
  const body = schema.parse(await req.json());

  const app = await prisma.hiringApplication.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, candidateId: true },
  });
  if (!app) throw notFound("That application no longer exists.");

  // The note and its timeline entry are written together: a note that does not
  // appear on the timeline is a note nobody will find again.
  const [note] = await prisma.$transaction([
    prisma.hiringNote.create({
      data: {
        applicationId: app.id,
        candidateId: app.candidateId,
        bodyMd: body.bodyMd,
        visibility: body.visibility,
        mentions: body.mentions ?? [],
        authorId: access.userId,
      },
    }),
    prisma.hiringApplicationEvent.create({
      data: {
        applicationId: app.id,
        type: "note",
        actorId: access.userId,
        payload: { visibility: body.visibility, preview: body.bodyMd.slice(0, 140) },
      },
    }),
  ]);

  return NextResponse.json({ note }, { status: 201 });
});
