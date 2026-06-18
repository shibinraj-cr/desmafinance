import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadActivity } from "@/lib/crm-activity";
import { noteInclude, serializeNote } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; noteId: string } };

// PATCH /api/crm/leads/[id]/notes/[noteId] — edit a note
const PatchSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const note = await prisma.leadNote.findUnique({
    where: { id: params.noteId },
    include: { ...noteInclude, lead: { select: { id: true, assignedToId: true } } },
  });
  if (!note || note.leadId !== params.id) throw notFound();
  if (!canEditLead(access, note.lead, userId)) throw forbidden();

  const { body } = PatchSchema.parse(await req.json().catch(() => null));
  if (body === note.body) {
    return NextResponse.json({ note: serializeNote(note) });
  }

  const updated = await prisma.leadNote.update({
    where: { id: params.noteId },
    data: { body, editedAt: new Date() },
    include: noteInclude,
  });

  await recordLeadActivity({
    leadId: params.id,
    actorId: userId,
    type: "NOTE_EDITED",
    summary: "Edited a note",
    metadata: { noteId: note.id, before: note.body, after: body },
  });

  return NextResponse.json({ note: serializeNote(updated) });
});

// DELETE /api/crm/leads/[id]/notes/[noteId] — author or admin
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const note = await prisma.leadNote.findUnique({
    where: { id: params.noteId },
    select: { id: true, leadId: true, authorId: true, body: true },
  });
  if (!note || note.leadId !== params.id) throw notFound();
  if (!access.isAdmin && note.authorId !== userId) throw forbidden();

  await prisma.leadNote.delete({ where: { id: params.noteId } });
  await recordLeadActivity({
    leadId: params.id,
    actorId: userId,
    type: "NOTE_DELETED",
    summary: "Deleted a note",
    metadata: { noteId: note.id, before: note.body },
  });

  return NextResponse.json({ ok: true });
});
