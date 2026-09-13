import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireSopAccess } from "@/lib/sop/access";
import { ArchiveSchema } from "@/lib/sop/schemas";
import { archiveSop, unarchiveSop } from "@/lib/sop/workflow";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** POST — archive an obsolete SOP with a reason and an optional replacement. */
export const POST = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const d = ArchiveSchema.parse(await req.json().catch(() => null));
  await archiveSop(params.id, access, {
    reason: d.reason,
    replacementSopId: d.replacementSopId ?? null,
    archiveDate: d.archiveDate ?? null,
  });
  return NextResponse.json({ ok: true });
});

/** DELETE — undo the archive (SOP admins only, same as archiving). */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  await unarchiveSop(params.id, access);
  return NextResponse.json({ ok: true });
});
