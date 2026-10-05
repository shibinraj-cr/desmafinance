import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { createMeeting, requireMeetingNotesAdmin } from "@/lib/meeting-notes";
import { MeetingInputSchema } from "@/lib/meeting-notes-model";

export const dynamic = "force-dynamic";

export const POST = withApiHandler(async (req: Request) => {
  const userId = await requireMeetingNotesAdmin();
  const body = MeetingInputSchema.parse(await req.json());
  const id = await createMeeting(body, userId);
  return NextResponse.json({ ok: true, id }, { status: 201 });
});
