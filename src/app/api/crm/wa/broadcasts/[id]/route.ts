import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { drainBroadcasts, materialiseAudience, countSegment, headerMediaConsistent } from "@/lib/wa/broadcast";
import type { LeadFilterParams } from "@/lib/crm-leads";

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
      headerMediaType: true,
      headerMediaUrl: true,
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

const PatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("queue") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("send_now") }),
  // Edit a DRAFT: same fields as create. Recomputes the audience estimate.
  z.object({
    action: z.literal("update"),
    name: z.string().min(1).max(200),
    templateName: z.string().min(1).max(200),
    segment: z.record(z.string(), z.unknown()).default({}),
    variableMap: z.record(z.string(), z.string()).optional(),
    headerMediaType: z.enum(["image", "video", "document"]).nullable().optional(),
    headerMediaUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "Header media URL must be https")
      .nullable()
      .optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
  }),
]).superRefine(headerMediaConsistent);

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

  const body = PatchSchema.parse(await req.json().catch(() => null));
  const { action } = body;

  const broadcast = await prisma.waBroadcast.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  });
  if (!broadcast) throw notFound();

  if (body.action === "update") {
    // Only a draft is editable — once queued the recipient list is frozen and the
    // campaign is a record of what was sent, not a thing to rewrite.
    if (broadcast.status !== "draft") throw badRequest("Only a draft can be edited", "not_draft");
    const estimate = await countSegment(body.segment as LeadFilterParams);
    await prisma.waBroadcast.update({
      where: { id: params.id },
      data: {
        name: body.name,
        templateName: body.templateName,
        segment: body.segment as object,
        variableMap: body.variableMap ?? undefined,
        // Reflect the form's current header choice (cleared when switching to a
        // text/header-less template).
        headerMediaType: body.headerMediaType ?? null,
        headerMediaUrl: body.headerMediaUrl ?? null,
        // Only touch scheduledAt when the caller actually sent it — an edit that
        // omits it (the UI never sets one) must not silently clear a schedule.
        ...(body.scheduledAt !== undefined
          ? { scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null }
          : {}),
        // Keep the shown audience in step with the edited filter.
        totalRecipients: estimate,
      },
    });
    return NextResponse.json({ ok: true, estimate });
  }

  if (action === "queue") {
    if (broadcast.status !== "draft") throw badRequest("Only a draft can be queued", "not_draft");
    // Audience first, status second — the drain must never see a scheduled
    // campaign whose recipients are still being written, or it concludes the
    // empty campaign is finished and strands the audience.
    const { total, skipped } = await materialiseAudience(params.id);
    await prisma.waBroadcast.update({ where: { id: params.id }, data: { status: "scheduled" } });
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

/**
 * DELETE — remove a campaign. Only a DRAFT (never sent) or a CANCELLED one, so a
 * finished or in-flight send stays on the record. Recipient rows cascade.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const broadcast = await prisma.waBroadcast.findUnique({
    where: { id: params.id },
    select: { status: true },
  });
  if (!broadcast) throw notFound();
  if (broadcast.status !== "draft" && broadcast.status !== "cancelled") {
    throw badRequest("Only a draft or a cancelled campaign can be deleted", "not_deletable");
  }

  await prisma.waBroadcast.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
