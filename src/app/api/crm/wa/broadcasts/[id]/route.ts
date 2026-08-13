import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { drainBroadcasts, materialiseAudience } from "@/lib/wa/broadcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET — one campaign with a sample of its recipients and why any were skipped. */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const broadcast = await prisma.waBroadcast.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      templateName: true,
      segment: true,
      variableMap: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      completedAt: true,
      totalRecipients: true,
      sentCount: true,
      failedCount: true,
      skippedCount: true,
    },
  });
  if (!broadcast) throw notFound();

  // Failures first: a report exists to answer "who did not get this, and why",
  // and a page of successes buries that.
  const recipients = await prisma.waBroadcastRecipient.findMany({
    where: { broadcastId: params.id },
    orderBy: [{ status: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      phoneE164: true,
      status: true,
      skipReason: true,
      waStatus: true,
      waErrorCode: true,
      waErrorMessage: true,
      sentAt: true,
      lead: { select: { id: true, candidateName: true } },
    },
  });

  return NextResponse.json({ broadcast, recipients });
});

const PatchSchema = z.object({
  action: z.enum(["queue", "cancel", "send_now"]),
});

/**
 * PATCH — queue a draft, cancel, or drain immediately.
 *
 * `send_now` exists because Vercel's Hobby plan only allows a daily cron: without
 * a manual trigger a campaign queued at 10am would sit until the next nightly
 * tick. It drains one bounded chunk and returns, exactly like the cron does.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const { action } = PatchSchema.parse(await req.json().catch(() => null));

  const broadcast = await prisma.waBroadcast.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  });
  if (!broadcast) throw notFound();

  if (action === "queue") {
    if (broadcast.status !== "draft") throw badRequest("Only a draft can be queued", "not_draft");
    await prisma.waBroadcast.update({ where: { id: params.id }, data: { status: "scheduled" } });
    const { total, skipped } = await materialiseAudience(params.id);
    return NextResponse.json({ ok: true, totalRecipients: total, skipped });
  }

  if (action === "cancel") {
    // Anything already sent stays sent — cancelling stops what has not gone out,
    // it cannot recall what has.
    if (broadcast.status === "sent" || broadcast.status === "cancelled") {
      throw badRequest("This campaign has already finished", "already_finished");
    }
    await prisma.$transaction([
      prisma.waBroadcastRecipient.updateMany({
        where: { broadcastId: params.id, status: "pending" },
        data: { status: "skipped", skipReason: "cancelled" },
      }),
      prisma.waBroadcast.update({
        where: { id: params.id },
        data: { status: "cancelled", completedAt: new Date() },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  // send_now
  if (broadcast.status === "draft") throw badRequest("Queue the campaign first", "not_queued");
  const summary = await drainBroadcasts();
  return NextResponse.json({ ok: true, ...summary });
});
