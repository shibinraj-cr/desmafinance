import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { resendScopeWhere } from "@/lib/wa/broadcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  scope: z.enum(["not_delivered", "failed_only"]).default("not_delivered"),
});

/**
 * POST /api/crm/wa/broadcasts/[id]/resend — create a DRAFT that re-sends this
 * campaign's template to the recipients who did not get it.
 *
 * The draft carries `resendOfId` (+ scope); its audience is NOT a lead segment —
 * at queue time materialiseAudience seeds it from THIS campaign's recipients
 * matching the delivery scope, re-rendering merge variables against current lead
 * data. So a corrected template/merge reaches exactly the people the first send
 * missed, without re-messaging those it confirmed delivered/read. Born a draft so
 * it is reviewed and queued explicitly — this endpoint never sends.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const { scope } = BodySchema.parse(await req.json().catch(() => ({})));

  const source = await prisma.waBroadcast.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      templateName: true,
      variableMap: true,
      segment: true,
      headerMediaType: true,
      headerMediaUrl: true,
      status: true,
    },
  });
  if (!source) throw notFound();
  // Only a FINISHED campaign can be re-sent. While it is still scheduled/sending
  // its pending recipients (waStatus null) match the "not delivered" scope AND
  // are about to be sent by the source's own drain — re-sending now would double
  // up. A draft never materialised an audience at all.
  if (source.status !== "sent" && source.status !== "cancelled") {
    throw badRequest("Re-send is available once the campaign has finished (sent or cancelled)", "not_finished");
  }

  // Upper-bound estimate for the draft's list row (dedup + live opt-out/dead-number
  // skips are applied when the draft is queued, exactly like a normal campaign).
  const estimate = await prisma.waBroadcastRecipient.count({
    where: { broadcastId: source.id, leadId: { not: null }, ...resendScopeWhere(scope) },
  });

  const draft = await prisma.waBroadcast.create({
    data: {
      name: `${source.name} · re-send`,
      templateName: source.templateName,
      segment: source.segment as Prisma.InputJsonValue,
      ...(source.variableMap != null ? { variableMap: source.variableMap as Prisma.InputJsonValue } : {}),
      headerMediaType: source.headerMediaType,
      headerMediaUrl: source.headerMediaUrl,
      status: "draft",
      resendOfId: source.id,
      resendScope: scope,
      totalRecipients: estimate,
      createdById: userId,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: draft.id, estimate });
});
