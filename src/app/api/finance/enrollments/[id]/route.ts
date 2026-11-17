import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { FinancePatchSchema } from "@/lib/crm-enroll-confirm";
import { enrollmentDetail, financeSave, requireEnrollmentAccess } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

// GET — one enrollment and its history, for Finance's review panel.
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireEnrollmentAccess("view");
  return NextResponse.json(await enrollmentDetail(params.id));
});

// PATCH — Finance corrects an enrollment still waiting for it. Logged, and the BDE is told.
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireEnrollmentAccess("view");
  const patch = FinancePatchSchema.parse(await req.json().catch(() => null));
  return NextResponse.json(await financeSave(a, params.id, patch));
});
