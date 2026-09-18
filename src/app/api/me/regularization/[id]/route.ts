import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";

/**
 * Recovery paths for the employee's OWN request.
 *
 * Neither existed. The collection route exposed only GET and POST, so a wrong
 * date or a typo left the employee stuck: they could not correct the request,
 * and could not file a replacement because the overlap guard refused a second
 * one for the same dates. They had to ask HR to reject it first.
 *
 * "Clarification" was the same trap from the other side — HR could ask a
 * question, and the employee had no way to answer or resubmit.
 *
 * Both verbs are strictly scoped to the caller's own request, and only while it
 * is still open (pending / clarification). A decided request is history and is
 * never editable from here.
 */

const OPEN_STATUSES = ["pending", "clarification"];

const PatchSchema = z.object({
  reason: z.string().min(5).max(500),
  /// Leave requests only: move the dates. Omitted values are left as they are.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/** Load the request and confirm it belongs to the caller and is still open. */
async function loadOwnOpenRequest(userId: string, id: string) {
  const emp = await employeeForUser(userId);
  if (!emp) return { error: "your login is not linked to an employee record — ask HR" as const };
  const reg = await prisma.hrAttendanceRegularization.findUnique({ where: { id } });
  if (!reg || reg.employeeId !== emp.id) return { error: "not found" as const };
  if (!OPEN_STATUSES.includes(reg.status)) {
    return { error: "This request has already been decided and can no longer be changed." as const };
  }
  return { emp, reg };
}

/**
 * Edit an open request — and, from "clarification", resubmit it.
 *
 * Answering HR's question puts the request back to pending, which is the whole
 * point: clarification used to be a terminal state with no way forward.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const loaded = await loadOwnOpenRequest(userId, params.id);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.error === "not found" ? 404 : 400 });
  }
  const { emp, reg } = loaded;

  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  // Only a leave request carries dates the employee may move; a punch fix and a
  // note are anchored to the day they are about.
  const isLeave = reg.requestType === "leave";
  const date = isLeave && parsed.data.date ? new Date(parsed.data.date) : reg.date;
  const toDate = isLeave
    ? parsed.data.toDate === undefined
      ? reg.toDate
      : parsed.data.toDate
        ? new Date(parsed.data.toDate)
        : null
    : null;
  if (toDate && toDate < date) {
    return NextResponse.json({ error: "The end date is before the start date." }, { status: 400 });
  }

  // Re-check the overlap against OTHER open requests, so an edit cannot be used
  // to slide onto dates another request already covers.
  const rangeEnd = toDate ?? date;
  const others = await prisma.hrAttendanceRegularization.findMany({
    where: {
      employeeId: emp.id,
      id: { not: reg.id },
      status: { in: OPEN_STATUSES },
      date: { lte: rangeEnd },
    },
    select: { date: true, toDate: true },
  });
  const clash = others.find((r) => (r.toDate ?? r.date) >= date);
  if (clash) {
    const span = clash.toDate
      ? `${clash.date.toISOString().slice(0, 10)} → ${clash.toDate.toISOString().slice(0, 10)}`
      : clash.date.toISOString().slice(0, 10);
    return NextResponse.json(
      { error: `Another request covering ${span} is already under review.` },
      { status: 409 },
    );
  }

  const wasClarification = reg.status === "clarification";
  const updated = await prisma.hrAttendanceRegularization.update({
    where: { id: reg.id },
    data: {
      reason: parsed.data.reason,
      date,
      toDate,
      // Answering a clarification sends it back for review. HR's note is kept
      // as the record of what was asked.
      status: "pending",
    },
  });

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: wasClarification ? "regularization_resubmitted" : "regularization_edited",
      entityType: "HrAttendanceRegularization",
      entityId: reg.id,
      metadata: {
        employeeId: emp.id,
        date: date.toISOString().slice(0, 10),
        toDate: toDate ? toDate.toISOString().slice(0, 10) : null,
      },
    },
  });

  return NextResponse.json({ request: updated });
}

/**
 * Withdraw an open request.
 *
 * The row is kept and marked withdrawn rather than deleted: it is part of the
 * employee's record, and the audit trail should show that a request existed and
 * was taken back. Withdrawn rows are outside the open set, so the dates are
 * immediately free to request again.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const loaded = await loadOwnOpenRequest(userId, params.id);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.error === "not found" ? 404 : 400 });
  }
  const { emp, reg } = loaded;

  const updated = await prisma.hrAttendanceRegularization.update({
    where: { id: reg.id },
    data: { status: "withdrawn", reviewedAt: new Date() },
  });

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "regularization_withdrawn",
      entityType: "HrAttendanceRegularization",
      entityId: reg.id,
      metadata: {
        employeeId: emp.id,
        date: reg.date.toISOString().slice(0, 10),
        requestType: reg.requestType,
      },
    },
  });

  return NextResponse.json({ request: updated });
}
