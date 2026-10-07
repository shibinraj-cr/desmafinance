import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireBank } from "@/lib/bank/access";
import { automationStatus } from "@/lib/bank/status";

export const dynamic = "force-dynamic";

/** GET /api/finance/bank-automation/status?integrationId= — dashboard figures. */
export const GET = withApiHandler(async (req: Request) => {
  await requireBank("view");
  const id = new URL(req.url).searchParams.get("integrationId");
  if (!id) throw badRequest("integrationId is required");
  return NextResponse.json(await automationStatus(id));
});
