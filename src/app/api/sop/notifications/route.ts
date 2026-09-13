import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireSopAccess } from "@/lib/sop/access";

export const dynamic = "force-dynamic";

/** GET — the signed-in user's SOP notifications, newest first. */
export const GET = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";

  const [rows, unread] = await Promise.all([
    prisma.sopNotification.findMany({
      where: { userId: access.userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.sopNotification.count({ where: { userId: access.userId, readAt: null } }),
  ]);
  return NextResponse.json({ rows, unread });
});

const MarkSchema = z.object({
  /** Omit to mark everything read. */
  ids: z.array(z.string().min(1)).max(200).optional(),
});

/**
 * PATCH — mark notifications read.
 *
 * Scoped to the caller's own rows in the WHERE clause, so passing someone
 * else's notification id marks nothing rather than reaching into their inbox.
 */
export const PATCH = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  const d = MarkSchema.parse(await req.json().catch(() => ({})));

  const res = await prisma.sopNotification.updateMany({
    where: { userId: access.userId, readAt: null, ...(d.ids?.length ? { id: { in: d.ids } } : {}) },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, marked: res.count });
});
