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

// GET /api/crm/leads/[id]/notes
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const notes = await prisma.leadNote.findMany({
    where: { leadId: params.id },
    orderBy: { createdAt: "desc" },
    include: noteInclude,
  });
  return NextResponse.json({ notes: notes.map(serializeNote) });
});

// POST /api/crm/leads/[id]/notes — add a note
const CreateSchema = z.object({ body: z.string().trim().min(1).max(5000) });

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { id: true, assignedToId: true } });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();

  const { body } = CreateSchema.parse(await req.json().catch(() => null));

  const note = await prisma.leadNote.create({
    data: { leadId: params.id, authorId: userId, body },
    include: noteInclude,
  });

  await recordLeadActivity({
    leadId: params.id,
    actorId: userId,
    type: "NOTE_ADDED",
    summary: "Added a note",
    metadata: { noteId: note.id },
  });

  return NextResponse.json({ note: serializeNote(note) }, { status: 201 });
});
