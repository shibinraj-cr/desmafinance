import { prisma } from "./prisma";
import { forbidden, notFound, unauthorized } from "./http-error";
import { getCurrentUserAndPermissions } from "./permissions";
import { fromPrismaDate, toPrismaDate } from "./lead-pulse-dates";
import { blankToNull, type MeetingInput, type MeetingRow } from "./meeting-notes-model";

/**
 * Executive Meeting Notes — server side.
 *
 * Admin-only like the rest of the Executive module, and shared across admins:
 * unlike the Wealth desk there is no owner filter, because a leadership
 * meeting's record belongs to everyone who was in it.
 */
export async function requireMeetingNotesAdmin(): Promise<string> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  if (!perms?.isAdmin) throw forbidden("Meeting Notes is admin-only.");
  return userId;
}

export async function listMeetings(): Promise<MeetingRow[]> {
  const rows = await prisma.execMeeting.findMany({
    orderBy: [{ meetingOn: "desc" }, { createdAt: "desc" }],
    include: { actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });

  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.createdById, r.updatedById]).filter((x): x is string => !!x)),
  );
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.username]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    meetingOn: fromPrismaDate(r.meetingOn),
    kind: r.kind,
    attendees: r.attendees,
    agenda: r.agenda,
    notes: r.notes,
    decisions: r.decisions,
    createdBy: r.createdById ? (nameOf.get(r.createdById) ?? null) : null,
    updatedBy: r.updatedById ? (nameOf.get(r.updatedById) ?? null) : null,
    updatedAt: r.updatedAt.toISOString(),
    actions: r.actions.map((a) => ({
      id: a.id,
      text: a.text,
      owner: a.owner,
      dueOn: a.dueOn ? fromPrismaDate(a.dueOn) : null,
      done: !!a.doneAt,
    })),
  }));
}

function meetingFields(body: MeetingInput) {
  return {
    title: body.title,
    meetingOn: toPrismaDate(body.meetingOn),
    kind: body.kind,
    attendees: blankToNull(body.attendees),
    agenda: blankToNull(body.agenda),
    notes: blankToNull(body.notes),
    decisions: blankToNull(body.decisions),
  };
}

export async function createMeeting(body: MeetingInput, userId: string): Promise<string> {
  const row = await prisma.execMeeting.create({
    data: {
      ...meetingFields(body),
      createdById: userId,
      updatedById: userId,
      actions: {
        create: body.actions.map((a, i) => ({
          text: a.text,
          owner: blankToNull(a.owner),
          dueOn: a.dueOn ? toPrismaDate(a.dueOn) : null,
          doneAt: a.done ? new Date() : null,
          sortOrder: i,
        })),
      },
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Saves the meeting and makes its action list match `body.actions` exactly:
 * listed ids are updated in place (keeping when they were ticked off), new
 * items are created, and items left out are deleted. One transaction, so a
 * half-applied edit can never leave the list out of step with the form.
 */
export async function updateMeeting(id: string, body: MeetingInput, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.execMeeting.findUnique({
      where: { id },
      select: { actions: { select: { id: true, doneAt: true } } },
    });
    if (!existing) throw notFound();

    const current = new Map(existing.actions.map((a) => [a.id, a]));
    const keep = new Set(body.actions.map((a) => a.id).filter((x): x is string => !!x && current.has(x)));

    await tx.execMeeting.update({
      where: { id },
      data: { ...meetingFields(body), updatedById: userId },
    });

    const removed = existing.actions.filter((a) => !keep.has(a.id)).map((a) => a.id);
    if (removed.length) await tx.execMeetingAction.deleteMany({ where: { id: { in: removed } } });

    for (const [i, a] of body.actions.entries()) {
      const fields = {
        text: a.text,
        owner: blankToNull(a.owner),
        dueOn: a.dueOn ? toPrismaDate(a.dueOn) : null,
        sortOrder: i,
      };
      const prior = a.id ? current.get(a.id) : undefined;
      if (prior) {
        await tx.execMeetingAction.update({
          where: { id: prior.id },
          data: { ...fields, doneAt: a.done ? (prior.doneAt ?? new Date()) : null },
        });
      } else {
        // An unknown id (stale form, or another admin deleted it) is treated as
        // a new item rather than an error — the text is what matters.
        await tx.execMeetingAction.create({
          data: { ...fields, meetingId: id, doneAt: a.done ? new Date() : null },
        });
      }
    }
  });
}
