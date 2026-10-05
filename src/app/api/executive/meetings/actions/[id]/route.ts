import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireMeetingNotesAdmin } from "@/lib/meeting-notes";
import { ActionToggleSchema } from "@/lib/meeting-notes-model";

export const dynamic = "force-dynamic";

/** Tick an action item off (or reopen it) without opening the meeting editor. */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireMeetingNotesAdmin();
  const { done } = ActionToggleSchema.parse(await req.json());
  const { count } = await prisma.execMeetingAction.updateMany({
    where: { id: params.id },
    data: { doneAt: done ? new Date() : null },
  });
  if (!count) throw notFound();
  return NextResponse.json({ ok: true });
});
