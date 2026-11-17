import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireEnrollmentAccess, sendBack } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

// POST — send the enrollment back to the BDE with what to fix.
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireEnrollmentAccess("view");
  const { note } = z.object({ note: z.string() }).parse(await req.json().catch(() => null));
  return NextResponse.json(await sendBack(a, params.id, note));
});
