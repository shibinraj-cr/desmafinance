import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { countSegment, materialiseAudience } from "@/lib/wa/broadcast";
import { getWaProvider } from "@/lib/wa/registry";
import type { LeadFilterParams } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/crm/wa/broadcasts — the campaign list.
 *
 * Gated on canBulkEmail, the CRM's existing "may message many people at once"
 * capability, rather than a new marker. Sending WhatsApp marketing to a segment
 * is the same authority as sending a bulk email to one, and a second permission
 * for the same power is a second thing to get wrong.
 */
export const GET = withApiHandler(async (_req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const broadcasts = await prisma.waBroadcast.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      templateName: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      completedAt: true,
      totalRecipients: true,
      sentCount: true,
      failedCount: true,
      skippedCount: true,
      createdAt: true,
      createdBy: { select: { username: true, leadPulseRole: { select: { displayName: true } } } },
    },
  });

  return NextResponse.json({
    broadcasts: broadcasts.map((b) => ({
      ...b,
      createdByName: b.createdBy?.leadPulseRole?.displayName ?? b.createdBy?.username ?? null,
      createdBy: undefined,
    })),
  });
});

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  templateName: z.string().min(1).max(200),
  /** LeadFilterParams — the same shape the leads list already speaks. */
  segment: z.record(z.string(), z.unknown()).default({}),
  variableMap: z.record(z.string(), z.string()).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  /** Materialise + queue immediately. False leaves it as a draft to review. */
  queue: z.boolean().default(false),
});

/**
 * POST /api/crm/wa/broadcasts — create a campaign, optionally queuing it.
 *
 * Queuing FREEZES the audience into recipient rows (see materialiseAudience).
 * That is the point at which "everyone matching this filter" stops being a live
 * query and becomes a list, which is what makes the campaign reportable and
 * resumable afterwards.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const data = CreateSchema.parse(await req.json().catch(() => null));

  // Refuse up front on a transport that cannot address templates by name —
  // otherwise the campaign materialises thousands of rows that can only fail.
  const provider = await getWaProvider();
  if (!provider.supports("sendTemplate")) {
    throw badRequest(
      `${provider.label} cannot send templates from the CRM — broadcasts need the WhatsApp Cloud API`,
      "provider_cannot_broadcast",
    );
  }

  // Estimate the audience up front so a DRAFT shows a real count in the list
  // instead of a bare 0 (which reads as "no one matched"). It is a live upper
  // bound — the exact, skip-adjusted total is frozen by materialiseAudience at
  // queue time, which overwrites this. Skipped for the queue path, which
  // materialises immediately anyway.
  const estimate = data.queue ? 0 : await countSegment(data.segment as LeadFilterParams);

  const broadcast = await prisma.waBroadcast.create({
    data: {
      name: data.name,
      templateName: data.templateName,
      segment: data.segment as object,
      variableMap: data.variableMap ?? undefined,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      // Always born a draft — see below.
      status: "draft",
      totalRecipients: estimate,
      createdById: userId,
    },
    select: { id: true },
  });

  if (data.queue) {
    // Materialise BEFORE flipping to `scheduled`. The drain picks up anything
    // scheduled, and a campaign marked scheduled while its recipients are still
    // being written looks like an empty one — the drain would find nothing
    // pending, conclude it was complete, and strand the whole audience.
    const { total, skipped } = await materialiseAudience(broadcast.id);
    await prisma.waBroadcast.update({ where: { id: broadcast.id }, data: { status: "scheduled" } });
    return NextResponse.json({ id: broadcast.id, totalRecipients: total, skipped });
  }

  return NextResponse.json({ id: broadcast.id, estimate });
});
