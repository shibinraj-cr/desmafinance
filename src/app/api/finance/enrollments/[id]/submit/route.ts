import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { FinancePatchSchema } from "@/lib/crm-enroll-confirm";
import { requireEnrollmentAccess, submitForApproval } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

const Body = z.object({
  patch: FinancePatchSchema.nullable().optional(),
  // The version Finance opened: refused if the enrollment changed since.
  expectedUpdatedAt: z.string().nullable().optional(),
});

// POST — the Finance Executive has checked the enrollment: any last edits are
// saved, and it waits for the Finance Manager in Approvals › Revenue.
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireEnrollmentAccess("view");
  const d = Body.parse(await req.json().catch(() => null));
  return NextResponse.json(await submitForApproval(a, params.id, d.patch ?? null, d.expectedUpdatedAt));
});
