import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import {
  addFeePayment,
  deleteEnrollment,
  requireAccess,
  setInstallmentPlan,
  setWithdrawn,
  undoLastFeePayment,
  updateEnrollment,
} from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    candidateName: z.string().max(200).optional(),
    studentId: z.string().max(60).nullable().optional(),
    intakeMonth: z.string().max(10).optional(),
    courseFee: z.number().optional(),
    commissionPct: z.number().optional(),
    commissionFlat: z.number().nullable().optional(),
    courseName: z.string().max(120).optional(),
    leadId: z.string().max(60).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  }),
  z.object({ action: z.literal("pay"), amount: z.number(), paidOn: z.string().max(10), reference: z.string().max(120).nullish() }),
  z.object({ action: z.literal("undo-pay") }),
  z.object({ action: z.literal("set-plan"), plan: z.number().int() }),
  z.object({ action: z.literal("withdraw") }),
  z.object({ action: z.literal("reinstate") }),
  z.object({ action: z.literal("delete") }),
]);

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireAccess("any");
  const body = Body.parse(await req.json());
  switch (body.action) {
    case "update": {
      const { action: _a, ...patch } = body;
      void _a;
      await updateEnrollment(a, params.id, patch);
      break;
    }
    case "pay":
      await addFeePayment(a, params.id, body);
      break;
    case "undo-pay":
      await undoLastFeePayment(a, params.id);
      break;
    case "set-plan":
      await setInstallmentPlan(a, params.id, body.plan);
      break;
    case "withdraw":
    case "reinstate":
      await setWithdrawn(a, params.id, body.action === "withdraw");
      break;
    case "delete":
      await deleteEnrollment(a, params.id);
      break;
  }
  return NextResponse.json({ ok: true });
});
