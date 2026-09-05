import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";

const schema = z.object({ jobIds: z.array(z.string().min(1)).max(100) });

/**
 * PUT /api/hiring/partners/[id]/jobs — set which requisitions this agency can
 * see. This list IS the boundary (see partner-scope.ts): revoking a job here
 * immediately hides it and every candidate they submitted to it.
 */
export const PUT = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("sourcing:manage");
  const { jobIds } = schema.parse(await req.json());

  const partner = await prisma.hiringPartner.findUnique({ where: { id: params.id } });
  if (!partner) throw notFound("That partner no longer exists.");

  const before = await prisma.hiringPartnerJobAccess.findMany({
    where: { partnerId: params.id },
    select: { jobId: true },
  });

  await prisma.$transaction([
    prisma.hiringPartnerJobAccess.deleteMany({
      where: { partnerId: params.id, jobId: { notIn: jobIds.length ? jobIds : ["__none__"] } },
    }),
    ...jobIds.map((jobId) =>
      prisma.hiringPartnerJobAccess.upsert({
        where: { partnerId_jobId: { partnerId: params.id, jobId } },
        create: { partnerId: params.id, jobId, grantedById: access.userId },
        update: {},
      }),
    ),
  ]);

  await recordHiringAudit({
    actorId: access.userId,
    action: "partner.job_access",
    entityType: "HiringPartner",
    entityId: params.id,
    before: { jobIds: before.map((b) => b.jobId) },
    after: { jobIds },
  });

  return NextResponse.json({ ok: true, jobIds });
});
