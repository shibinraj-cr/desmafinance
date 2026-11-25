import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { FinancePatchSchema } from "@/lib/crm-enroll-confirm";
import { approveEnrollment, requireEnrollmentAccess } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

const Body = z.object({
  patch: FinancePatchSchema.nullable().optional(),
  // The version Finance opened: refused if the enrollment changed since.
  expectedUpdatedAt: z.string().nullable().optional(),
});

// POST — Finance approves: the first payment is posted to the ledger and the
// balance plan becomes the collection plan. Approving never issues the
// invoice: a payment into Axis, HDFC or Wio then waits in Invoices › To
// invoice, where the Finance Manager sees its number and issues it. (An older
// page still sending `invoice` has it dropped by the schema.)
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireEnrollmentAccess("approve");
  const d = Body.parse(await req.json().catch(() => null));
  const approved = await approveEnrollment(a, params.id, d.patch ?? null, d.expectedUpdatedAt);
  return NextResponse.json({ ok: true, transactionId: approved.transactionId });
});
