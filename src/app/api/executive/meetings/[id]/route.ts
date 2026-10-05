import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireMeetingEditor, requireMeetingNotesAdmin, updateMeeting } from "@/lib/meeting-notes";
import { MeetingInputSchema } from "@/lib/meeting-notes-model";

export const dynamic = "force-dynamic";

/** Admins, or users the meeting is shared with as editors (who can't re-share). */
export const PUT = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const actor = await requireMeetingEditor(params.id);
  const body = MeetingInputSchema.parse(await req.json());
  await updateMeeting(params.id, body, actor);
  return NextResponse.json({ ok: true });
});

/** Admin-only — sharing a meeting as an editor never grants delete. */
export const DELETE = withApiHandler(
  async (_req: Request, { params }: { params: { id: string } }) => {
    await requireMeetingNotesAdmin();
    // Hard delete; the cascade takes the action items with it.
    const { count } = await prisma.execMeeting.deleteMany({ where: { id: params.id } });
    if (!count) throw notFound();
    return NextResponse.json({ ok: true });
  },
);
