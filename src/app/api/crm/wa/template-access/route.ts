import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { getWaProvider } from "@/lib/wa/registry";
import { templateKey } from "@/lib/wa/template-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Who may send which approved WhatsApp template.
 *
 * Gated on canManageTemplates — the same capability that governs the CRM's own
 * message templates, so a marketing supervisor can assign WhatsApp templates
 * without being made a full CRM admin.
 *
 * GET returns the live catalogue joined to its grants, because the two only mean
 * something together: a grant naming a template Meta has since removed is dead,
 * and a template with no grants is invisible to everyone but admins. Showing
 * them side by side is what makes both states obvious.
 */
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageTemplates) throw forbidden();

  const provider = await getWaProvider();
  const [templates, grants, bdes] = await Promise.all([
    provider.listTemplates().catch(() => []),
    prisma.waTemplateGrant.findMany({
      select: { id: true, templateKey: true, userId: true, leadPulseRole: true },
    }),
    prisma.leadPulseRole.findMany({
      where: { active: true, role: { in: ["l1", "l2", "supervisor"] } },
      orderBy: { displayName: "asc" },
      select: { userId: true, displayName: true, role: true },
    }),
  ]);

  return NextResponse.json({
    supported: provider.supports("listTemplates"),
    providerLabel: provider.label,
    templates: templates
      .filter((t) => t.status === "APPROVED")
      .map((t) => ({
        key: templateKey(t.name, t.language),
        name: t.name,
        language: t.language,
        category: t.category,
        body: t.body,
        variableCount: t.variableCount,
      })),
    grants,
    bdes,
  });
});

const Schema = z.object({
  templateKey: z.string().min(1).max(200),
  /** Exactly one of these. */
  userId: z.string().nullable().optional(),
  leadPulseRole: z.enum(["l1", "l2", "supervisor"]).nullable().optional(),
  grant: z.boolean(),
});

/** POST — grant or revoke one template for one user or one role tier. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageTemplates) throw forbidden();

  const data = Schema.parse(await req.json().catch(() => null));
  const target = data.userId?.trim() || null;
  const tier = data.leadPulseRole ?? null;

  // Exactly one subject. Both would be ambiguous — is it the user, or everyone
  // in the tier? — and neither grants nothing at all.
  if (!!target === !!tier) {
    throw badRequest("Name either a person or a role, not both", "ambiguous_subject");
  }

  if (data.grant) {
    // createMany + skipDuplicates rather than create: the partial unique indexes
    // make a repeat grant a no-op instead of a 500 on double-click.
    await prisma.waTemplateGrant.createMany({
      data: [{ templateKey: data.templateKey, userId: target, leadPulseRole: tier, createdById: userId }],
      skipDuplicates: true,
    });
  } else {
    await prisma.waTemplateGrant.deleteMany({
      where: { templateKey: data.templateKey, userId: target, leadPulseRole: tier },
    });
  }

  return NextResponse.json({ ok: true });
});
