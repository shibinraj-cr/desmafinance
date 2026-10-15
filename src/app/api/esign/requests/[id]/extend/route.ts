import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { agreementContext, extendAgreement } from "@/lib/esign/send";

export const dynamic = "force-dynamic";

/** POST /api/esign/requests/[id]/extend — new last day to sign (IST date, YYYY-MM-DD). */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const ctx = await agreementContext(req);
  const { until } = z.object({ until: z.string() }).parse(await req.json().catch(() => null));
  return NextResponse.json(await extendAgreement(params.id, until, ctx));
});
