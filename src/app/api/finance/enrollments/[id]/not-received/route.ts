import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { markNotReceived, requireEnrollmentAccess } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

// POST — Finance found no money: an un-enroll request to the sales head.
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireEnrollmentAccess("view");
  const { note } = z.object({ note: z.string() }).parse(await req.json().catch(() => null));
  return NextResponse.json(await markNotReceived(a, params.id, note));
});
