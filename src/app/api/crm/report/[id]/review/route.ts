import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { canReviewReports } from "@/lib/crm-daily-report";

export const dynamic = "force-dynamic";

// POST /api/crm/report/[id]/review — a manager signs off on a submitted report.
// Idempotent: re-reviewing just updates the reviewer note + timestamp.
const ReviewSchema = z.object({ reviewerNote: z.string().trim().max(2000).optional() });

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!canReviewReports(access)) throw forbidden();

  const { reviewerNote } = ReviewSchema.parse(await req.json().catch(() => ({})));

  const existing = await prisma.crmDailyReport.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) throw notFound();

  const report = await prisma.crmDailyReport.update({
    where: { id: params.id },
    data: {
      status: "reviewed",
      reviewedById: userId,
      reviewedAt: new Date(),
      reviewerNote: reviewerNote || null,
    },
    select: { id: true, status: true, reviewedAt: true },
  });

  return NextResponse.json({ ok: true, report });
});
