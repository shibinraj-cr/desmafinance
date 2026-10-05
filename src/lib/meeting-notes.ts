import { prisma } from "./prisma";
import { forbidden, notFound, unauthorized } from "./http-error";
import { getCurrentUserAndPermissions } from "./permissions";
import { addDays, fromPrismaDate, toPrismaDate } from "./lead-pulse-dates";
import type { Prisma } from "@prisma/client";
import {
  blankToNull,
  isReminderDue,
  type MeetingInput,
  type MeetingRow,
  type OwnerActionUpdate,
  type ShareUser,
} from "./meeting-notes-model";

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

const MEETING_INCLUDE = {
  actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  shares: { select: { userId: true } },
} satisfies Prisma.ExecMeetingInclude;

/** Every meeting — the admin view. */
export async function listMeetings(): Promise<MeetingRow[]> {
  return toRows(
    await prisma.execMeeting.findMany({
      orderBy: [{ meetingOn: "desc" }, { createdAt: "desc" }],
      include: MEETING_INCLUDE,
    }),
  );
}

/**
 * The meetings this user may read in My Workspace: shared with them, or with
 * an action item they own (they need the context to act on it). The share list
 * itself is blanked — a reader learns what was discussed, not who else was
 * given the same notes.
 */
export async function listMeetingsSharedWith(userId: string): Promise<MeetingRow[]> {
  const rows = await toRows(
    await prisma.execMeeting.findMany({
      where: { OR: [{ shares: { some: { userId } } }, { actions: { some: { ownerUserId: userId } } }] },
      orderBy: [{ meetingOn: "desc" }, { createdAt: "desc" }],
      include: MEETING_INCLUDE,
    }),
  );
  return rows.map((r) => ({ ...r, sharedWith: [] }));
}

/** Active logins an admin can share with, alphabetical. */
export async function listShareableUsers(): Promise<ShareUser[]> {
  return prisma.user.findMany({
    where: { isActive: true },
    orderBy: { username: "asc" },
    select: { id: true, username: true },
  });
}

type MeetingWithRelations = Prisma.ExecMeetingGetPayload<{ include: typeof MEETING_INCLUDE }>;

async function toRows(rows: MeetingWithRelations[]): Promise<MeetingRow[]> {
  const userIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [
          r.createdById,
          r.updatedById,
          ...r.shares.map((s) => s.userId),
          ...r.actions.map((a) => a.ownerUserId),
        ])
        .filter((x): x is string => !!x),
    ),
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
      ownerUserId: a.ownerUserId,
      ownerName: a.ownerUserId ? (nameOf.get(a.ownerUserId) ?? null) : null,
      dueOn: a.dueOn ? fromPrismaDate(a.dueOn) : null,
      done: !!a.doneAt,
    })),
    // A share whose user no longer exists is dropped from view; it is inert.
    sharedWith: r.shares
      .filter((s) => nameOf.has(s.userId))
      .map((s) => ({ id: s.userId, username: nameOf.get(s.userId)! }))
      .sort((a, b) => a.username.localeCompare(b.username)),
  }));
}

/**
 * Keeps only ids of real, active users — a stale form or a deactivated login
 * must not leave a share row behind.
 */
async function validShareIds(db: Prisma.TransactionClient | typeof prisma, ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return [];
  const users = await db.user.findMany({
    where: { id: { in: unique }, isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
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

/** Every user id the form names (shares + action owners) that is a real, active login. */
async function validUserIds(db: Prisma.TransactionClient | typeof prisma, body: MeetingInput): Promise<Set<string>> {
  const owners = body.actions.map((a) => a.ownerUserId).filter((x): x is string => !!x);
  return new Set(await validShareIds(db, [...body.sharedWith, ...owners]));
}

export async function createMeeting(body: MeetingInput, userId: string): Promise<string> {
  const valid = await validUserIds(prisma, body);
  const shareIds = body.sharedWith.filter((id, i, all) => valid.has(id) && all.indexOf(id) === i);
  const row = await prisma.execMeeting.create({
    data: {
      ...meetingFields(body),
      createdById: userId,
      updatedById: userId,
      actions: {
        create: body.actions.map((a, i) => ({
          text: a.text,
          owner: blankToNull(a.owner),
          ownerUserId: a.ownerUserId && valid.has(a.ownerUserId) ? a.ownerUserId : null,
          dueOn: a.dueOn ? toPrismaDate(a.dueOn) : null,
          doneAt: a.done ? new Date() : null,
          sortOrder: i,
        })),
      },
      shares: { create: shareIds.map((id) => ({ userId: id, sharedById: userId })) },
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
      select: {
        actions: { select: { id: true, doneAt: true, dueOn: true } },
        shares: { select: { userId: true } },
      },
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

    // Shares: drop the ones left out, add the new ones. Existing rows are kept
    // so their sharedById/createdAt still say who shared first, and when.
    const valid = await validUserIds(tx, body);
    const wanted = new Set(body.sharedWith.filter((u) => valid.has(u)));
    const had = new Set(existing.shares.map((s) => s.userId));
    const unshare = Array.from(had).filter((u) => !wanted.has(u));
    if (unshare.length) {
      await tx.execMeetingShare.deleteMany({ where: { meetingId: id, userId: { in: unshare } } });
    }
    const share = Array.from(wanted).filter((u) => !had.has(u));
    if (share.length) {
      await tx.execMeetingShare.createMany({
        data: share.map((u) => ({ meetingId: id, userId: u, sharedById: userId })),
      });
    }

    for (const [i, a] of body.actions.entries()) {
      const fields = {
        text: a.text,
        owner: blankToNull(a.owner),
        ownerUserId: a.ownerUserId && valid.has(a.ownerUserId) ? a.ownerUserId : null,
        dueOn: a.dueOn ? toPrismaDate(a.dueOn) : null,
        sortOrder: i,
      };
      const prior = a.id ? current.get(a.id) : undefined;
      if (prior) {
        await tx.execMeetingAction.update({
          where: { id: prior.id },
          data: {
            ...fields,
            doneAt: a.done ? (prior.doneAt ?? new Date()) : null,
            // A new due date is a new reminder; an old "remind me tomorrow" no longer applies.
            ...((prior.dueOn ? fromPrismaDate(prior.dueOn) : null) !== (a.dueOn ?? null)
              ? { snoozedUntil: null }
              : {}),
          },
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

// ── Owner reminders ─────────────────────────────────────────────────────────

export type DueReminder = {
  id: string;
  text: string;
  /** YYYY-MM-DD */
  dueOn: string;
  meetingId: string;
  meetingTitle: string;
};

/**
 * The open action items this user owns that should pop up today (IST). Called
 * from the app layout on every full page load, so it is one indexed query and
 * swallows its own errors — a reminder must never take the app shell down.
 */
export async function dueRemindersFor(userId: string, today: string): Promise<DueReminder[]> {
  try {
    const rows = await prisma.execMeetingAction.findMany({
      where: { ownerUserId: userId, doneAt: null, dueOn: { lte: toPrismaDate(today) } },
      orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
      take: 20,
      select: {
        id: true,
        text: true,
        dueOn: true,
        snoozedUntil: true,
        meeting: { select: { id: true, title: true } },
      },
    });
    return rows
      .filter((r) =>
        isReminderDue(
          {
            done: false,
            dueOn: r.dueOn ? fromPrismaDate(r.dueOn) : null,
            snoozedUntil: r.snoozedUntil ? fromPrismaDate(r.snoozedUntil) : null,
          },
          today,
        ),
      )
      .map((r) => ({
        id: r.id,
        text: r.text,
        dueOn: fromPrismaDate(r.dueOn!),
        meetingId: r.meeting.id,
        meetingTitle: r.meeting.title,
      }));
  } catch {
    return [];
  }
}

/**
 * The owner's (or an admin's) update to one action item. Anyone else gets a
 * 404 rather than a 403, so the endpoint does not confirm an item exists.
 */
export async function applyOwnerUpdate(
  actionId: string,
  user: { id: string; isAdmin: boolean },
  body: OwnerActionUpdate,
  today: string,
): Promise<void> {
  const row = await prisma.execMeetingAction.findUnique({
    where: { id: actionId },
    select: { ownerUserId: true, doneAt: true },
  });
  if (!row || (!user.isAdmin && row.ownerUserId !== user.id)) throw notFound();

  const data: Prisma.ExecMeetingActionUpdateInput =
    body.action === "done"
      ? { doneAt: row.doneAt ?? new Date(), snoozedUntil: null }
      : body.action === "reopen"
        ? { doneAt: null }
        : body.action === "snooze"
          ? { snoozedUntil: toPrismaDate(addDays(today, 1)) }
          : { dueOn: toPrismaDate(body.dueOn), snoozedUntil: null };
  await prisma.execMeetingAction.update({ where: { id: actionId }, data });
}
