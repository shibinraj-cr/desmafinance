import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { logger } from "@/lib/logger";
import { sanitizeUsageItems, type UsageItem } from "@/lib/usage-tracking";
import { todayIst, toPrismaDate } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";

/**
 * POST /api/telemetry/activity — ingest a batch of active-engagement time from
 * the client heartbeat (src/components/UsageTracker.tsx). Best-effort by design:
 * it always answers 204 and never throws at the caller, because it is called
 * from periodic fetch() and from navigator.sendBeacon() on tab close, where a
 * visible error would be pointless noise.
 *
 * The client only ever sends time it already judged "active" (visible tab +
 * recent interaction). The server independently sanitizes and caps every item
 * (see sanitizeUsageItems) so a broken or hostile client cannot inflate usage.
 * The day bucket is derived server-side in IST so it is stable regardless of the
 * runtime timezone (Vercel runs UTC) or a spoofed client clock.
 */
export const POST = withApiHandler(async (req: Request) => {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  // No session (or a signed-out beacon after logout): silently drop.
  if (!userId) return new NextResponse(null, { status: 204 });

  // sendBeacon sends text/plain (or a Blob); read raw and parse tolerantly so
  // both fetch(JSON) and beacon payloads work through one path.
  let payload: unknown;
  try {
    const body = await req.text();
    payload = body ? JSON.parse(body) : null;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const items = sanitizeUsageItems(payload);
  if (items.length === 0) return new NextResponse(null, { status: 204 });

  // Coalesce any buckets that share (moduleId, page) so we issue one upsert per
  // row and never race two increments against the same unique key in a flush.
  const merged = new Map<string, UsageItem>();
  for (const it of items) {
    const key = `${it.moduleId} ${it.page}`;
    const prev = merged.get(key);
    if (prev) prev.seconds += it.seconds;
    else merged.set(key, { ...it });
  }

  const day = toPrismaDate(todayIst());

  const writes = await Promise.allSettled(
    [...merged.values()].map((it) =>
      prisma.moduleUsageDaily.upsert({
        where: {
          userId_moduleId_page_day: { userId, moduleId: it.moduleId, page: it.page, day },
        },
        create: {
          userId,
          moduleId: it.moduleId,
          page: it.page,
          day,
          activeSeconds: it.seconds,
        },
        update: { activeSeconds: { increment: it.seconds } },
      }),
    ),
  );

  const failed = writes.filter((w) => w.status === "rejected").length;
  if (failed > 0) {
    logger.warn("usage_activity_partial_write", { userId, total: merged.size, failed });
  }

  return new NextResponse(null, { status: 204 });
});
