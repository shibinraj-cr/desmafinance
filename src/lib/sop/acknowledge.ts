/**
 * Publication audience + employee acknowledgement (§13).
 *
 * The audience is resolved ONCE, at publish time, and written out as
 * `SopAcknowledgement` rows. It is deliberately not recomputed on read: "who
 * was told about V1.2" is a fact of that publication, and a roster that has
 * moved on since must not be able to rewrite it. Someone who joins the
 * department next month is covered by the next publication, not retroactively
 * by this one.
 *
 * "Overdue" is the one state that IS derived, from the deadline at read time —
 * a stored overdue flag is wrong the moment the job that maintains it stops.
 */

import { prisma } from "@/lib/prisma";
import type { AckState } from "./constants";
import { isAckOverdue } from "./review-dates";

/** The three audience selectors from the Publish modal. */
export type AudienceSpec = {
  departmentIds: string[];
  /** HR role master ids (HrRole) — the same role vocabulary SOP steps use. */
  roleIds: string[];
  employeeIds: string[];
};

/**
 * Every ACTIVE employee the spec covers, de-duplicated.
 *
 * Inactive employees are excluded: assigning a leaver an acknowledgement they
 * can never complete would leave the compliance dashboard permanently red for
 * a reason that is not a compliance problem.
 *
 * An empty spec resolves to nobody — publishing to "everyone" has to be an
 * explicit choice (tick the departments), never the accidental default of
 * leaving the modal blank.
 */
export async function resolveAudience(spec: AudienceSpec): Promise<string[]> {
  const ids = new Set<string>();

  if (spec.departmentIds.length > 0) {
    const rows = await prisma.hrEmployeeDepartment.findMany({
      where: { departmentId: { in: spec.departmentIds }, employee: { active: true } },
      select: { employeeId: true },
    });
    for (const r of rows) ids.add(r.employeeId);
  }

  if (spec.roleIds.length > 0) {
    const rows = await prisma.hrEmployeeRole.findMany({
      where: { roleId: { in: spec.roleIds }, employee: { active: true } },
      select: { employeeId: true },
    });
    for (const r of rows) ids.add(r.employeeId);
  }

  if (spec.employeeIds.length > 0) {
    // Named individuals are still filtered on active — the same reasoning.
    const rows = await prisma.employee.findMany({
      where: { id: { in: spec.employeeIds }, active: true },
      select: { id: true },
    });
    for (const r of rows) ids.add(r.id);
  }

  return [...ids];
}

/**
 * Materialise the acknowledgement rows for a freshly published version.
 *
 * Idempotent (`skipDuplicates` on the `(versionId, employeeId)` unique key), so
 * a retried publish cannot double-assign anyone.
 */
export async function assignAcknowledgements(opts: {
  sopId: string;
  versionId: string;
  employeeIds: string[];
  deadline: Date | null;
}): Promise<number> {
  if (opts.employeeIds.length === 0) return 0;

  // Pre-fill the login where the employee has one, so an acknowledgement made
  // from the ESS side already knows which account it belongs to.
  const employees = await prisma.employee.findMany({
    where: { id: { in: opts.employeeIds } },
    select: { id: true, userId: true },
  });

  const res = await prisma.sopAcknowledgement.createMany({
    data: employees.map((e) => ({
      sopId: opts.sopId,
      versionId: opts.versionId,
      employeeId: e.id,
      userId: e.userId,
      deadline: opts.deadline,
      status: "not_viewed",
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/** The row's effective state, with "overdue" derived from the deadline. */
export function acknowledgementState(
  row: { deadline: Date | null; viewedAt: Date | null; acknowledgedAt: Date | null },
  now: Date = new Date(),
): AckState {
  if (row.acknowledgedAt) return "acknowledged";
  // Overdue outranks viewed: someone who opened the SOP and never confirmed it
  // is the case the compliance dashboard exists to surface.
  if (isAckOverdue(row.deadline, row.acknowledgedAt, now)) return "overdue";
  return row.viewedAt ? "viewed" : "not_viewed";
}

export type AckSummary = {
  /** Everyone the version was published to. */
  total: number;
  /** Opened the SOP at least once — acknowledged ones included, since they
   *  necessarily read it. */
  viewed: number;
  acknowledged: number;
  /** Not yet acknowledged. `viewed` and `overdue` are further detail on this
   *  same set, not slices carved out of it. */
  pending: number;
  overdue: number;
};

export type AckRow = {
  deadline: Date | null;
  viewedAt: Date | null;
  acknowledgedAt: Date | null;
};

/** The five numbers the acknowledgement dashboard shows. */
export function summariseAcknowledgements(rows: AckRow[], now: Date = new Date()): AckSummary {
  const summary: AckSummary = { total: rows.length, viewed: 0, acknowledged: 0, pending: 0, overdue: 0 };
  for (const r of rows) {
    if (r.viewedAt || r.acknowledgedAt) summary.viewed++;
    if (r.acknowledgedAt) {
      summary.acknowledged++;
      continue;
    }
    summary.pending++;
    if (isAckOverdue(r.deadline, r.acknowledgedAt, now)) summary.overdue++;
  }
  return summary;
}

/** Mark that an employee opened the SOP. First view only — never overwritten. */
export async function markViewed(ackId: string, userId: string | null): Promise<void> {
  try {
    await prisma.sopAcknowledgement.updateMany({
      where: { id: ackId, viewedAt: null },
      data: { viewedAt: new Date(), status: "viewed", ...(userId ? { userId } : {}) },
    });
  } catch (e) {
    console.error("[sop-ack] failed to mark viewed:", e);
  }
}
