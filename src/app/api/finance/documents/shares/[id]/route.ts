import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireFinanceDocsUser } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/finance/documents/shares/[id] — revoke a link now. Kept as a row
 * (not deleted) so the Shared links list still shows who had what, and when.
 */
export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireFinanceDocsUser();
  const share = await prisma.financeDocShare.findUnique({ where: { id: params.id }, select: { revokedAt: true } });
  if (!share) throw notFound("That link no longer exists");
  if (!share.revokedAt) {
    await prisma.financeDocShare.update({ where: { id: params.id }, data: { revokedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
});
