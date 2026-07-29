import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest, notFound, conflict } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { prisma } from "@/lib/prisma";
import { isWabisWebhookUrl } from "@/lib/crm-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * CRUD for the per-consultant Wabis workflow endpoints (admin only).
 *
 * Deactivation is the normal way to retire an endpoint — the delivery log
 * references endpoints by label, so keeping the row keeps the history
 * explicable. Hard delete exists but is a separate, deliberate call.
 */

const BaseFields = {
  // Which flow this workflow serves; scopes all the uniqueness rules below so a
  // consultant can hold one intro endpoint AND one study-abroad endpoint.
  purpose: z.enum(["lead_assigned", "study_abroad"]).default("lead_assigned"),
  label: z.string().trim().min(1).max(120),
  consultantId: z.string().trim().min(1).nullable(),
  webhookUrl: z.string().trim().min(1).max(500),
  agentName: z.string().trim().max(120).optional().default(""),
  agentPhone: z.string().trim().max(40).optional().default(""),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
};

const CreateSchema = z.object({ action: z.literal("create"), ...BaseFields });
const UpdateSchema = z.object({ action: z.literal("update"), id: z.string().min(1), ...BaseFields });
const ToggleSchema = z.object({ action: z.literal("toggle"), id: z.string().min(1), isActive: z.boolean() });
const DeleteSchema = z.object({ action: z.literal("delete"), id: z.string().min(1) });

const PostSchema = z.discriminatedUnion("action", [CreateSchema, UpdateSchema, ToggleSchema, DeleteSchema]);

/** Shared validation for the two write paths. */
function validate(input: { webhookUrl: string; consultantId: string | null; isDefault: boolean }) {
  if (!isWabisWebhookUrl(input.webhookUrl)) {
    throw badRequest("Webhook URL must be an https:// Wabis workflow callback URL", "invalid_url");
  }
  // A default endpoint is the catch-all for *unmapped* consultants, so pinning
  // it to one consultant would contradict what it is for.
  if (input.isDefault && input.consultantId) {
    throw badRequest("The default endpoint can't also be mapped to one consultant", "default_with_consultant");
  }
  if (!input.isDefault && !input.consultantId) {
    throw badRequest("Choose a consultant, or mark this endpoint as the default", "consultant_required");
  }
}

/**
 * Retire any other live default before installing a new one. The partial unique
 * index is the real guarantee; this makes the common case a clean swap rather
 * than an error the admin has to resolve by hand.
 *
 * The superseded row is DEACTIVATED, not merely un-defaulted. Clearing only
 * `isDefault` would leave it active with no consultant and no default flag —
 * routing nothing, yet still listed and still offered for test sends, and
 * un-saveable because `validate()` rejects exactly that shape. Retiring it keeps
 * the row for the audit trail without leaving an unusable one behind.
 */
async function standDownOtherDefaults(tx: typeof prisma, purpose: string, exceptId?: string) {
  await tx.wabisWebhookEndpoint.updateMany({
    // Scoped by purpose: adding a study-abroad default must not disturb the
    // lead-assignment default (or vice-versa) — each purpose has its own.
    where: { isDefault: true, isActive: true, purpose, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false, isActive: false },
  });
}

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const body = PostSchema.parse(await req.json().catch(() => null));

  if (body.action === "toggle") {
    const row = await prisma.wabisWebhookEndpoint.findUnique({ where: { id: body.id } });
    if (!row) throw notFound();
    // Reactivating can collide with whatever took over while this was retired.
    // Checked against what the partial indexes actually enforce — a row that is
    // neither consultant-mapped nor default can't collide with anything, but it
    // also wouldn't route, so it's sent back to be edited rather than revived.
    if (body.isActive) {
      if (!row.consultantId && !row.isDefault) {
        throw conflict(
          "This endpoint was superseded — edit it to pick a consultant, or make it the default, before reactivating",
          "endpoint_unroutable",
        );
      }
      const clash = await prisma.wabisWebhookEndpoint.findFirst({
        where: {
          isActive: true,
          id: { not: row.id },
          purpose: row.purpose,
          ...(row.consultantId ? { consultantId: row.consultantId } : { isDefault: true }),
        },
        select: { label: true },
      });
      if (clash) {
        throw conflict(
          `"${clash.label}" is already the active endpoint for that ${row.consultantId ? "consultant" : "fallback"} — deactivate it first`,
          "endpoint_conflict",
        );
      }
    }
    await prisma.wabisWebhookEndpoint.update({
      where: { id: body.id },
      data: { isActive: body.isActive },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "delete") {
    // Deliberate and separately confirmed in the UI: this drops audit history.
    const row = await prisma.wabisWebhookEndpoint.findUnique({ where: { id: body.id }, select: { id: true } });
    if (!row) throw notFound();
    await prisma.wabisWebhookEndpoint.delete({ where: { id: body.id } });
    return NextResponse.json({ ok: true });
  }

  validate(body);

  const data = {
    purpose: body.purpose,
    label: body.label,
    consultantId: body.isDefault ? null : body.consultantId,
    webhookUrl: body.webhookUrl,
    agentName: body.agentName.trim() || null,
    agentPhone: body.agentPhone.trim() || null,
    isActive: body.isActive,
    isDefault: body.isDefault,
  };

  try {
    if (body.action === "create") {
      const created = await prisma.$transaction(async (tx) => {
        if (data.isDefault && data.isActive) await standDownOtherDefaults(tx as typeof prisma, data.purpose);
        return tx.wabisWebhookEndpoint.create({ data, select: { id: true } });
      });
      return NextResponse.json({ ok: true, id: created.id });
    }

    await prisma.$transaction(async (tx) => {
      if (data.isDefault && data.isActive) await standDownOtherDefaults(tx as typeof prisma, data.purpose, body.id);
      await tx.wabisWebhookEndpoint.update({ where: { id: body.id }, data });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    // The partial unique indexes surface as P2002 — translate rather than 500.
    if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") {
      throw conflict("That consultant already has an active endpoint — deactivate it first", "endpoint_conflict");
    }
    throw e;
  }
});
