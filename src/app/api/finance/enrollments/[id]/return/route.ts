import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireEnrollmentAccess, returnToChecker } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

// POST — the Finance Manager hands a submitted enrollment back to the
// executive unapproved, saying what to look at.
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireEnrollmentAccess("approve");
  const { note, expectedUpdatedAt } = z
    .object({ note: z.string(), expectedUpdatedAt: z.string().nullable().optional() })
    .parse(await req.json().catch(() => null));
  return NextResponse.json(await returnToChecker(a, params.id, note, expectedUpdatedAt));
});
