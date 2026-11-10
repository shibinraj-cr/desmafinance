import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { listParam, oneParam } from "@/lib/filter-params";
import {
  HANDOVER_CHANNEL_CODES,
  MAX_HANDOVER_ROWS,
  handoverListWhere,
} from "@/lib/crm-handover";
import { getHandoverAccess, listHandovers, saveHandovers } from "@/lib/crm-handover-data";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lead Handovers list. The Marketing Admin and CRM managers see every BDE's;
 * a BDE sees their own. Filters: `date` (IST day given), `open=1` (plus every
 * still-open one), repeatable `status`, `channel`, `bde`.
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getHandoverAccess(userId, perms);
  const sp = new URL(req.url).searchParams;
  const date = oneParam(sp.getAll("date"));
  const where = handoverListWhere(access, userId, {
    date: date && DAY_RE.test(date) ? date : undefined,
    withOpen: sp.get("open") === "1",
    statuses: listParam(sp.getAll("status")),
    channels: listParam(sp.getAll("channel")),
    bdeIds: listParam(sp.getAll("bde")),
  });
  if (!where) throw forbidden();
  return NextResponse.json({ handovers: await listHandovers(where), canManage: access.canManage });
});

const SaveSchema = z.object({
  channel: z.enum(HANDOVER_CHANNEL_CODES),
  assignedBdeId: z.string().min(1),
  rows: z
    .array(
      z.object({
        leadName: z.string().trim().max(200).optional().nullable(),
        phone: z.string().trim().min(1).max(60),
        note: z.string().trim().max(1000).optional().nullable(),
      }),
    )
    .min(1)
    .max(MAX_HANDOVER_ROWS),
});

/**
 * Log handovers — one row from the form, or many from the bulk paste (one
 * channel and one BDE for the lot). Rows that can't be saved come back in
 * `errors` with the reason; the rest are saved.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getHandoverAccess(userId, perms);
  if (!access.canManage) throw forbidden();
  const input = SaveSchema.parse(await req.json().catch(() => null));
  const result = await saveHandovers({ ...input, actorId: userId });
  return NextResponse.json(result, { status: result.saved.length ? 201 : 200 });
});
