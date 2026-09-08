import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, forbidden } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";

export const dynamic = "force-dynamic";

// A shared view can only be removed by its author or someone who manages the
// team — otherwise one person's tidy-up deletes everyone else's saved filter.
export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("self:write");
  const view = await prisma.hiringSavedView.findUnique({ where: { id: params.id } });
  if (!view) throw notFound("That view no longer exists.");
  if (view.userId !== access.userId && !can(access, "team:manage")) {
    throw forbidden("That view belongs to someone else.");
  }
  await prisma.hiringSavedView.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
