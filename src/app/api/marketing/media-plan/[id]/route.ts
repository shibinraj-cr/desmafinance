import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import {
  MEDIA_FORMAT_CODES,
  MEDIA_ITEM_STATUSES,
  canUseMediaPlanner,
  mediaItemInclude,
  serializeMediaItem,
} from "@/lib/media-plan";

export const dynamic = "force-dynamic";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RX = /^\d{2}:\d{2}$/;

async function requirePlannerAccess() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canUseMediaPlanner(perms)) throw forbidden();
  return userId;
}

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  format: z.enum(MEDIA_FORMAT_CODES).optional(),
  status: z.enum(MEDIA_ITEM_STATUSES).optional(),
  publishDate: z.string().regex(DATE_RX).optional().nullable(),
  publishTime: z.string().regex(TIME_RX).optional().nullable(),
  shootDate: z.string().regex(DATE_RX).optional().nullable(),
  hook: z.string().trim().max(2000).optional().nullable(),
  ownerId: z.string().optional().nullable(),
});

export const PATCH = withApiHandler(
  async (req: Request, { params }: { params: { id: string } }) => {
    const userId = await requirePlannerAccess();
    const data = PatchSchema.parse(await req.json().catch(() => null));

    const existing = await prisma.mediaPlanItem.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!existing) throw notFound();

    if (data.ownerId) {
      const owner = await prisma.user.findUnique({
        where: { id: data.ownerId },
        select: { isActive: true },
      });
      if (!owner?.isActive) {
        throw badRequest("The selected owner is not an active user.", "bad_owner");
      }
    }

    const item = await prisma.mediaPlanItem.update({
      where: { id: params.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.format !== undefined ? { format: data.format } : {}),
        ...(data.status !== undefined
          ? {
              status: data.status,
              // publishedAt tracks the status flip, both ways — un-publishing
              // an accidental "Mark published" must not leave a timestamp that
              // still counts the item as shipped.
              publishedAt:
                data.status === "published"
                  ? existing.status === "published"
                    ? undefined
                    : new Date()
                  : null,
            }
          : {}),
        ...(data.publishDate !== undefined
          ? { publishDate: data.publishDate ? toPrismaDate(data.publishDate) : null }
          : {}),
        ...(data.publishTime !== undefined ? { publishTime: data.publishTime } : {}),
        ...(data.shootDate !== undefined
          ? { shootDate: data.shootDate ? toPrismaDate(data.shootDate) : null }
          : {}),
        ...(data.hook !== undefined ? { hook: data.hook?.trim() ? data.hook.trim() : null } : {}),
        ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}),
      },
      include: mediaItemInclude,
    });

    await recordAudit({
      entityType: "MediaPlanItem",
      entityId: item.id,
      action: "UPDATE",
      userId,
      changes: data,
    });

    return NextResponse.json({ item: serializeMediaItem(item) });
  },
);

export const DELETE = withApiHandler(
  async (_req: Request, { params }: { params: { id: string } }) => {
    const userId = await requirePlannerAccess();
    const existing = await prisma.mediaPlanItem.findUnique({
      where: { id: params.id },
      select: { id: true, title: true, format: true },
    });
    if (!existing) throw notFound();

    await prisma.mediaPlanItem.delete({ where: { id: params.id } });
    await recordAudit({
      entityType: "MediaPlanItem",
      entityId: existing.id,
      action: "DELETE",
      userId,
      changes: { title: existing.title, format: existing.format },
    });
    return NextResponse.json({ ok: true });
  },
);
