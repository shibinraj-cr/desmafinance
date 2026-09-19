import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, conflict } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { recordAudit } from "@/lib/audit";
import { slugifyStatusCode } from "@/lib/crm";

export const dynamic = "force-dynamic";

// Lead STATUS master — the cross-stage state the UI calls "Status". The pipeline
// STAGE master is CrmLeadStatus, edited elsewhere in CRM Settings; the two are
// separate axes. Mirrors the qualifications routes deliberately: same shape,
// same guards, so there is one pattern for CRM reference data rather than two.

export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const [rows, counts] = await Promise.all([
    prisma.crmLeadSubStatus.findMany({ orderBy: [{ displayOrder: "asc" }, { label: "asc" }] }),
    prisma.lead.groupBy({ by: ["subStatusId"], _count: true, where: { subStatusId: { not: null } } }),
  ]);
  const countMap = new Map(counts.map((c) => [c.subStatusId, c._count]));
  return NextResponse.json({
    subStatuses: rows.map((r) => ({ ...r, leadCount: countMap.get(r.id) ?? 0 })),
  });
});

const CreateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  group: z.string().trim().max(40).default(""),
  displayOrder: z.number().int().min(0).default(0),
  color: z.string().trim().max(9).nullable().default(null),
  active: z.boolean().default(true),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const d = CreateSchema.parse(await req.json().catch(() => null));
  const existing = await prisma.crmLeadSubStatus.findFirst({ where: { label: d.label } });
  if (existing) throw conflict("A status with that label already exists.", "label_taken");

  // `code` is the stable handle (labels get reworded); derived from the label so
  // an admin never has to think about it, de-duplicated with a suffix if that
  // slug is taken by a status that was since renamed.
  const base = slugifyStatusCode(d.label);
  let code = base;
  for (let n = 2; await prisma.crmLeadSubStatus.findUnique({ where: { code } }); n++) {
    code = `${base}_${n}`;
  }

  const created = await prisma.crmLeadSubStatus.create({
    data: {
      code,
      label: d.label,
      group: d.group,
      displayOrder: d.displayOrder,
      color: d.color,
      active: d.active,
    },
  });
  await recordAudit({
    entityType: "CrmLeadSubStatus",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { label: d.label, code },
  });
  return NextResponse.json({ subStatus: created }, { status: 201 });
});
