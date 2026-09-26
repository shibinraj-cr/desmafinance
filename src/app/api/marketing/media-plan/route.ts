import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { toPrismaDate } from "@/lib/lead-pulse-dates";
import {
  MEDIA_FORMAT_CODES,
  MEDIA_ITEM_STATUSES,
  MEDIA_DEFAULT_CHECKLIST,
  canUseMediaPlanner,
  mediaItemInclude,
  serializeMediaItem,
  type MediaFormat,
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

/**
 * GET /api/marketing/media-plan?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Everything the planner shows in one list: items publishing inside the
 * visible calendar range, plus every not-yet-published item regardless of
 * date (the production board and the task rail need those even when their
 * publish day is off-screen or unset).
 */
export const GET = withApiHandler(async (req: Request) => {
  await requirePlannerAccess();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !DATE_RX.test(from) || !DATE_RX.test(to)) {
    throw badRequest("from/to must be YYYY-MM-DD", "bad_range");
  }

  const items = await prisma.mediaPlanItem.findMany({
    where: {
      OR: [
        { publishDate: { gte: toPrismaDate(from), lte: toPrismaDate(to) } },
        { status: { not: "published" } },
      ],
    },
    orderBy: [{ publishDate: "asc" }, { createdAt: "asc" }],
    include: mediaItemInclude,
  });
  return NextResponse.json({ items: items.map(serializeMediaItem) });
});

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  format: z.enum(MEDIA_FORMAT_CODES),
  status: z.enum(MEDIA_ITEM_STATUSES).optional(),
  publishDate: z.string().regex(DATE_RX).optional().nullable(),
  publishTime: z.string().regex(TIME_RX).optional().nullable(),
  shootDate: z.string().regex(DATE_RX).optional().nullable(),
  hook: z.string().trim().max(2000).optional().nullable(),
  ownerId: z.string().optional().nullable(),
  // Seed the standard production checklist for the format (default on). The
  // Publish step inherits the publish date so the reminder cron can fire.
  seedChecklist: z.boolean().optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const userId = await requirePlannerAccess();
  const data = CreateSchema.parse(await req.json().catch(() => null));

  if (data.ownerId) {
    const owner = await prisma.user.findUnique({
      where: { id: data.ownerId },
      select: { isActive: true },
    });
    if (!owner?.isActive) throw badRequest("The selected owner is not an active user.", "bad_owner");
  }

  const seed = data.seedChecklist ?? true;
  const steps = seed ? MEDIA_DEFAULT_CHECKLIST[data.format as MediaFormat] : [];

  const item = await prisma.mediaPlanItem.create({
    data: {
      title: data.title,
      format: data.format,
      status: data.status ?? "idea",
      publishDate: data.publishDate ? toPrismaDate(data.publishDate) : null,
      publishTime: data.publishTime ?? null,
      shootDate: data.shootDate ? toPrismaDate(data.shootDate) : null,
      hook: data.hook?.trim() ? data.hook.trim() : null,
      ownerId: data.ownerId ?? userId,
      createdById: userId,
      tasks: steps.length
        ? {
            create: steps.map((name, i) => ({
              name,
              seq: i,
              dueDate:
                name === "Publish" && data.publishDate ? toPrismaDate(data.publishDate) : null,
              assignedToId: data.ownerId ?? userId,
            })),
          }
        : undefined,
    },
    include: mediaItemInclude,
  });

  await recordAudit({
    entityType: "MediaPlanItem",
    entityId: item.id,
    action: "CREATE",
    userId,
    changes: { title: item.title, format: item.format, publishDate: data.publishDate ?? null },
  });

  return NextResponse.json({ item: serializeMediaItem(item) }, { status: 201 });
});
