import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, conflict, notFound } from "@/lib/http-error";
import { cleanName } from "@/lib/finance-docs";
import { requireFinanceDocsUser, siblingNamed } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(500),
  parentId: z.string().min(1).nullable(),
  /**
   * Hand back a same-named folder instead of refusing. Folder uploads use this
   * so dropping "FY 2025-26" twice fills one folder rather than failing.
   */
  reuse: z.boolean().optional(),
});

/** POST /api/finance/documents/folders — create a folder. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireFinanceDocsUser();
  const body = Body.parse(await req.json());
  const name = cleanName(body.name);
  if (!name) throw badRequest("The folder needs a name");

  if (body.parentId) {
    const parent = await prisma.financeDocFolder.findUnique({ where: { id: body.parentId }, select: { id: true } });
    if (!parent) throw notFound("The parent folder no longer exists");
  }

  const clash = await siblingNamed(name, body.parentId);
  if (clash) {
    if (body.reuse) return NextResponse.json({ folder: clash });
    throw conflict(`A folder called "${clash.name}" is already here`, "duplicate_name");
  }

  const folder = await prisma.financeDocFolder.create({
    data: { name, parentId: body.parentId, createdById: userId },
  });
  return NextResponse.json({ folder });
});
