import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { newShareToken, sharePath, sharePeriod } from "@/lib/finance-docs";
import { requireFinanceDocsUser } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    documentId: z.string().min(1).optional(),
    folderId: z.string().min(1).optional(),
    label: z.string().max(200).optional(),
    /** IST calendar days, "YYYY-MM-DD", both inclusive. */
    from: z.string(),
    until: z.string(),
  })
  .refine((b) => !!b.documentId !== !!b.folderId, "Share exactly one document or one folder");

/**
 * POST /api/finance/documents/shares — create a download-only public link to
 * one document or one folder (and everything under it) for a date range.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireFinanceDocsUser();
  const body = Body.parse(await req.json());

  const period = sharePeriod(body.from, body.until, new Date());
  if ("error" in period) throw badRequest(period.error);

  if (body.documentId) {
    const doc = await prisma.financeDocument.findUnique({ where: { id: body.documentId }, select: { id: true } });
    if (!doc) throw notFound("That document no longer exists");
  } else {
    const folder = await prisma.financeDocFolder.findUnique({ where: { id: body.folderId! }, select: { id: true } });
    if (!folder) throw notFound("That folder no longer exists");
  }

  const share = await prisma.financeDocShare.create({
    data: {
      token: newShareToken(),
      label: body.label?.trim() || null,
      documentId: body.documentId ?? null,
      folderId: body.folderId ?? null,
      validFrom: period.validFrom,
      expiresAt: period.expiresAt,
      createdById: userId,
    },
  });
  return NextResponse.json({ share: { id: share.id, path: sharePath(share.token) } });
});
