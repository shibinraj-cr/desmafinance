import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject } from "@/lib/ops-rbac";
import { opsProjectDetailInclude, serializeProjectDetail } from "@/lib/ops-queries";
import { updateCandidateFromOps } from "@/lib/ops-candidate";
import { QUALIFICATION_OTHER_MAX } from "@/lib/crm";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

// Only the fields the user changed are sent; "" / null clears an optional one.
const PatchSchema = z.object({
  candidateName: z.string().trim().min(2, "Name must be at least 2 characters").max(160).optional(),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address")
    .nullable()
    .optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  altPhone: z.string().trim().max(60).nullable().optional(),
  dob: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Date of birth must be YYYY-MM-DD")
    .nullable()
    .optional(),
  country: z.string().trim().max(100).nullable().optional(),
  qualificationId: z.string().nullable().optional(),
  qualificationOther: z.string().trim().max(QUALIFICATION_OTHER_MAX).nullable().optional(),
});

/**
 * PATCH /api/operations/projects/[id]/candidate — correct the candidate's
 * name / contact / profile from the Operations project. Written through to the
 * Finance Party and every CRM lead of the candidate (see ops-candidate.ts).
 * Same gate as every other project mutation: the owner, or an ops manager.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);

  const project = await prisma.opsProject.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true },
  });
  if (!project) throw notFound();
  if (!canEditProject(access, project, userId)) throw forbidden();

  const patch = PatchSchema.parse(await req.json().catch(() => null));
  const result = await updateCandidateFromOps({ projectId: project.id, actorId: userId, patch });

  const updated = await prisma.opsProject.findUnique({ where: { id: project.id }, include: opsProjectDetailInclude });
  return NextResponse.json({ ...result, project: updated ? serializeProjectDetail(updated) : null });
});
