import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { serializeMessageTemplate } from "@/lib/crm-message-templates";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().max(300).regex(/^[^\r\n]*$/, "Subject can't contain line breaks").nullable().optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const existing = await prisma.crmMessageTemplate.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const d = PatchSchema.parse(await req.json().catch(() => null));

  const updated = await prisma.crmMessageTemplate.update({
    where: { id: params.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      // Subject only applies to email; ignore any subject sent for a WhatsApp template.
      ...(d.subject !== undefined && existing.channel !== "whatsapp"
        ? { subject: d.subject?.trim() || null }
        : {}),
      ...(d.body !== undefined ? { body: d.body } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
    },
  });

  await recordAudit({
    entityType: "CrmMessageTemplate",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: { name: existing.name, isActive: existing.isActive }, after: d },
  });
  return NextResponse.json({ template: serializeMessageTemplate(updated) });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const existing = await prisma.crmMessageTemplate.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  await prisma.crmMessageTemplate.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "CrmMessageTemplate",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { channel: existing.channel, name: existing.name },
  });
  return NextResponse.json({ ok: true });
});
