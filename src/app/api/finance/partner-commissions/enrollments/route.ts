import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { createEnrollment, requireAccess } from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

const Body = z.object({
  program: z.string(),
  candidateName: z.string().max(200),
  leadId: z.string().max(60).nullish(),
  studentId: z.string().max(60).nullish(),
  courseName: z.string().max(120).nullish(),
  intakeMonth: z.string().max(10),
  courseFee: z.number(),
  commissionPct: z.number().nullish(),
  commissionFlat: z.number().nullable().optional(),
  installmentPlan: z.number().int().nullish(),
  notes: z.string().max(1000).nullish(),
  firstPayment: z
    .object({ amount: z.number(), paidOn: z.string().max(10), reference: z.string().max(120).nullish() })
    .nullish(),
});

/** Add an enrollment. Finance may add any program; BDEs and granted people only theirs. */
export const POST = withApiHandler(async (req: Request) => {
  const a = await requireAccess("any");
  const body = Body.parse(await req.json());
  const e = await createEnrollment(a, body);
  return NextResponse.json({ id: e.id });
});
