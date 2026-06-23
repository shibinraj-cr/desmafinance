import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest, conflict } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";
import { listTemplates, serializeTemplate, opsTemplateInclude } from "@/lib/ops-templates";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  return NextResponse.json({ templates: await listTemplates() });
});

const CreateSchema = z.object({
  serviceId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  const d = CreateSchema.parse(await req.json().catch(() => null));

  const service = await prisma.service.findUnique({ where: { id: d.serviceId } });
  if (!service) throw badRequest("Service not found.", "service_not_found");

  // New template = next version for this service, made the active one (only one
  // active per service). Old versions are retained so in-flight projects keep
  // their snapshot reference.
  const agg = await prisma.processTemplate.aggregate({
    where: { serviceId: d.serviceId },
    _max: { version: true },
  });
  const version = (agg._max.version ?? 0) + 1;

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await tx.processTemplate.updateMany({ where: { serviceId: d.serviceId }, data: { isActive: false } });
      return tx.processTemplate.create({
        data: {
          serviceId: d.serviceId,
          name: d.name,
          description: d.description ?? null,
          version,
          isActive: true,
          createdById: userId,
        },
        include: opsTemplateInclude,
      });
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      throw conflict("A template version conflict occurred — please retry.", "version_taken");
    }
    throw e;
  }

  await recordAudit({
    entityType: "ProcessTemplate",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { serviceId: d.serviceId, name: d.name, version },
  });
  return NextResponse.json({ template: serializeTemplate(created) }, { status: 201 });
});
