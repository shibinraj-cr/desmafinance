import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, conflict } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// POST /api/crm/report/[id]/unlock — a system admin reopens a submitted day so
// the BDE can correct and submit it again (which locks it again). A reviewed
// report stays closed: its sign-off would no longer describe what it says.
export const POST = withApiHandler(async (_req: Request, ctx: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!perms.isAdmin) throw forbidden();

  const report = await prisma.crmDailyReport.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, status: true, locked: true },
  });
  if (!report) throw notFound();
  if (report.status === "reviewed") throw conflict("A reviewed report can't be unlocked.", "already_reviewed");
  if (!report.locked) return NextResponse.json({ ok: true });

  await prisma.crmDailyReport.update({
    where: { id: report.id },
    data: { locked: false, unlockedById: userId, unlockedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
});
