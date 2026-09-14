import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireSopAccess } from "@/lib/sop/access";
import { listSops, type SopFilters, type SopSort } from "@/lib/sop/queries";
import { CreateSopSchema } from "@/lib/sop/schemas";
import { createSop } from "@/lib/sop/create";

export const dynamic = "force-dynamic";

/** GET /api/sop/sops — the filtered, visibility-checked list. */
export const GET = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  const url = new URL(req.url);
  const q = url.searchParams;

  const filters: SopFilters = {
    search: q.get("q") ?? undefined,
    departmentIds: q.getAll("department"),
    ownerEmployeeIds: q.getAll("owner"),
    statuses: q.getAll("status"),
    categoryIds: q.getAll("category"),
    createdByIds: q.getAll("createdBy"),
    reviewDue: q.get("reviewDue") ?? undefined,
    archived: q.get("archived") === "1",
    requiresAcknowledgement: q.get("requiresAck") === "1",
    publishedOnly: q.get("published") === "1",
  };

  const { rows, total } = await listSops(access, filters, {
    sort: (q.get("sort") as SopSort | null) ?? "recent",
    take: Number(q.get("take") ?? 200),
  });
  return NextResponse.json({ rows, total });
});

/**
 * POST /api/sop/sops — create an SOP and its V1.0 draft.
 *
 * Validation, number minting and the transaction all live in `createSop`, so
 * this route and the lifecycle verification script exercise the same path.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  const input = CreateSopSchema.parse(await req.json().catch(() => null));
  return NextResponse.json(await createSop(input, access), { status: 201 });
});
