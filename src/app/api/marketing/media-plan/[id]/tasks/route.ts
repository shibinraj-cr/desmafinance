import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import { canUseMediaPlanner, serializeMediaTask } from "@/lib/media-plan";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  dueDate: z.string().regex(DATE_RX).optional().nullable(),
  assignedToId: z.string().optional().nullable(),
});

// POST /api/marketing/media-plan/[id]/tasks — add a production step.
export const POST = withApiHandler(
  async (req: Request, { params }: { params: { id: string } }) => {
    const { userId, perms } = await getCurrentUserAndPermissions();
    if (!userId || !perms) throw unauthorized();
    if (!canUseMediaPlanner(perms)) throw forbidden();

    const item = await prisma.mediaPlanItem.findUnique({
      where: { id: params.id },
      select: { id: true, ownerId: true },
    });
    if (!item) throw notFound();

    const data = CreateSchema.parse(await req.json().catch(() => null));
    const last = await prisma.mediaPlanTask.aggregate({
      where: { itemId: item.id },
      _max: { seq: true },
    });

    const task = await prisma.mediaPlanTask.create({
      data: {
        itemId: item.id,
        name: data.name,
        seq: (last._max.seq ?? -1) + 1,
        dueDate: data.dueDate ? toPrismaDate(data.dueDate) : null,
        assignedToId: data.assignedToId ?? item.ownerId ?? userId,
      },
    });
    return NextResponse.json({ task: serializeMediaTask(task) }, { status: 201 });
  },
);
