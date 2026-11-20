import { NextResponse } from "next/server";
import { z } from "zod";
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
  // { patch, expectedUpdatedAt }: only the fields Finance changed, and the
  // version it opened, so a stale screen can't overwrite a newer change.
  const body = z
    .object({ patch: FinancePatchSchema, expectedUpdatedAt: z.string().nullable().optional() })
    .parse(await req.json().catch(() => null));
  return NextResponse.json(await financeSave(a, params.id, body.patch, body.expectedUpdatedAt));
});
