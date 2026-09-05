import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { generatePrepPacket } from "@/lib/hiring/ai/prep-packet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("interview:manage");
  const prepPacketMd = await generatePrepPacket({ interviewId: params.id, userId: access.userId });
  return NextResponse.json({ prepPacketMd });
});
