import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireMeetingNotesAdmin, updateMeeting } from "@/lib/meeting-notes";
import { MeetingInputSchema } from "@/lib/meeting-notes-model";

export const dynamic = "force-dynamic";

export const PUT = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const userId = await requireMeetingNotesAdmin();
  const body = MeetingInputSchema.parse(await req.json());
  await updateMeeting(params.id, body, userId);
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiHandler(
  async (_req: Request, { params }: { params: { id: string } }) => {
    await requireMeetingNotesAdmin();
    // Hard delete; the cascade takes the action items with it.
    const { count } = await prisma.execMeeting.deleteMany({ where: { id: params.id } });
    if (!count) throw notFound();
    return NextResponse.json({ ok: true });
  },
);
