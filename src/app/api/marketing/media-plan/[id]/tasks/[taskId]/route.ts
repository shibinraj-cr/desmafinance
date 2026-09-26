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

async function requireTask(itemId: string, taskId: string) {
  const task = await prisma.mediaPlanTask.findUnique({ where: { id: taskId } });
  if (!task || task.itemId !== itemId) throw notFound();
  return task;
}

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  dueDate: z.string().regex(DATE_RX).optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  status: z.enum(["open", "done"]).optional(),
});

// PATCH /api/marketing/media-plan/[id]/tasks/[taskId] — edit or tick a step.
export const PATCH = withApiHandler(
  async (req: Request, { params }: { params: { id: string; taskId: string } }) => {
    const { userId, perms } = await getCurrentUserAndPermissions();
    if (!userId || !perms) throw unauthorized();
    if (!canUseMediaPlanner(perms)) throw forbidden();

    const existing = await requireTask(params.id, params.taskId);
    const data = PatchSchema.parse(await req.json().catch(() => null));

    const task = await prisma.mediaPlanTask.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.dueDate !== undefined
          ? { dueDate: data.dueDate ? toPrismaDate(data.dueDate) : null }
          : {}),
        ...(data.assignedToId !== undefined ? { assignedToId: data.assignedToId } : {}),
        ...(data.status !== undefined
          ? data.status === "done"
            ? { status: "done", doneAt: new Date(), doneById: userId }
            : { status: "open", doneAt: null, doneById: null }
          : {}),
      },
    });
    return NextResponse.json({ task: serializeMediaTask(task) });
  },
);

export const DELETE = withApiHandler(
  async (_req: Request, { params }: { params: { id: string; taskId: string } }) => {
    const { userId, perms } = await getCurrentUserAndPermissions();
    if (!userId || !perms) throw unauthorized();
    if (!canUseMediaPlanner(perms)) throw forbidden();

    const existing = await requireTask(params.id, params.taskId);
    await prisma.mediaPlanTask.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  },
);
