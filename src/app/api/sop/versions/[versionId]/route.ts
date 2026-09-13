import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, forbidden, notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { UpdateVersionSchema } from "@/lib/sop/schemas";
import { assertVersionEditable, loadFullVersion, sectionCompleteness } from "@/lib/sop/workflow";
import { recordSopFieldChanges, recordSopAudit } from "@/lib/sop/audit";
import { computeNextReviewDate } from "@/lib/sop/review-dates";
import { canViewVersion } from "@/lib/sop/rbac";
import { versionDetailInclude } from "@/lib/sop/queries";

export const dynamic = "force-dynamic";

type Ctx = { params: { versionId: string } };

/** GET /api/sop/versions/[versionId] — one version, in full, for the editor. */
export const GET = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await prisma.sopVersion.findUnique({
    where: { id: params.versionId },
    include: { ...versionDetailInclude, sop: true },
  });
  if (!version || version.sop.deletedAt) throw notFound("SOP version not found.");
  if (!canViewVersion(access, version.sop, version)) throw forbidden();

  return NextResponse.json({
    version,
    completeness: sectionCompleteness(version),
  });
});

/**
 * PATCH /api/sop/versions/[versionId] — save draft content.
 *
 * `assertVersionEditable` is the gate: it refuses a locked (published) version
 * and anyone without authority over the draft, so neither the editor's UI state
 * nor a hand-rolled request can rewrite a published SOP.
 *
 * The next review date is recomputed whenever the schedule changes and the
 * caller did not set a date explicitly — the author picks a frequency, the
 * system does the arithmetic (§10).
 */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const d = UpdateVersionSchema.parse(await req.json().catch(() => null));

  await validateReferences(d);

  const data: Record<string, unknown> = { ...d };

  // Derive nextReviewDate when the schedule moved but no explicit date came in.
  const scheduleTouched =
    "reviewFrequency" in d || "reviewIntervalDays" in d || "lastReviewDate" in d;
  if (scheduleTouched && d.nextReviewDate === undefined) {
    const frequency = d.reviewFrequency !== undefined ? d.reviewFrequency : version.reviewFrequency;
    const interval =
      d.reviewIntervalDays !== undefined ? d.reviewIntervalDays : version.reviewIntervalDays;
    const from = (d.lastReviewDate ?? version.lastReviewDate ?? version.effectiveDate) ?? new Date();
    const computed = computeNextReviewDate(from, frequency, interval);
    if (computed) data.nextReviewDate = computed;
  }

  const updated = await prisma.sopVersion.update({ where: { id: version.id }, data });

  // An unpublished SOP's list row should track its draft, or the library shows
  // a title nobody uses any more. Once published, the Sop row mirrors the
  // PUBLISHED version and a draft edit must not disturb it.
  if (!version.sop.currentVersionId) {
    await prisma.sop.update({
      where: { id: version.sopId },
      data: {
        title: updated.title,
        departmentId: updated.departmentId,
        categoryId: updated.categoryId,
        processFunction: updated.processFunction,
        ownerEmployeeId: updated.ownerEmployeeId,
        confidentiality: updated.confidentiality,
      },
    });
  }

  const before = Object.fromEntries(
    Object.keys(d).map((k) => [k, (version as Record<string, unknown>)[k]]),
  );
  await recordSopFieldChanges(
    {
      sopId: version.sopId,
      versionId: version.id,
      versionLabel: version.versionLabel,
      userId: access.userId,
    },
    before,
    d as Record<string, unknown>,
  );
  // Reviewer/approver changes get their own audit action — §16 lists them
  // separately, and they are the two edits that change who holds the SOP.
  if (d.reviewerId !== undefined && d.reviewerId !== version.reviewerId) {
    await recordSopAudit({
      sopId: version.sopId,
      versionId: version.id,
      versionLabel: version.versionLabel,
      userId: access.userId,
      action: "REVIEWER_CHANGED",
      oldValue: version.reviewerId,
      newValue: d.reviewerId,
    });
  }
  if (d.approverId !== undefined && d.approverId !== version.approverId) {
    await recordSopAudit({
      sopId: version.sopId,
      versionId: version.id,
      versionLabel: version.versionLabel,
      userId: access.userId,
      action: "APPROVER_CHANGED",
      oldValue: version.approverId,
      newValue: d.approverId,
    });
  }

  const full = await loadFullVersion(version.id);
  return NextResponse.json({
    version: updated,
    completeness: full ? sectionCompleteness(full) : null,
  });
});

/**
 * Every id in the payload must point at a live row in the master it claims to
 * come from. Doing this here rather than trusting the picker is what stops a
 * hand-rolled request from attaching an SOP to a deactivated employee or a
 * department that no longer exists.
 */
async function validateReferences(d: {
  ownerEmployeeId?: string;
  reviewOwnerEmployeeId?: string | null;
  departmentId?: string | null;
  categoryId?: string | null;
  reviewerId?: string | null;
  approverId?: string | null;
  supportingRoleIds?: string[];
}) {
  const checks: Promise<void>[] = [];

  const employeeIds = [d.ownerEmployeeId, d.reviewOwnerEmployeeId].filter(
    (v): v is string => !!v,
  );
  if (employeeIds.length) {
    checks.push(
      prisma.employee
        .count({ where: { id: { in: employeeIds }, active: true } })
        .then((n) => {
          if (n !== new Set(employeeIds).size) {
            throw badRequest("An employee on this SOP is not an active employee.", "bad_employee");
          }
        }),
    );
  }
  if (d.departmentId) {
    checks.push(
      prisma.hrDepartment.count({ where: { id: d.departmentId, active: true } }).then((n) => {
        if (n === 0) throw badRequest("The department was not found.", "bad_department");
      }),
    );
  }
  if (d.categoryId) {
    checks.push(
      prisma.sopCategory.count({ where: { id: d.categoryId, isActive: true } }).then((n) => {
        if (n === 0) throw badRequest("The category was not found.", "bad_category");
      }),
    );
  }
  const userIds = [d.reviewerId, d.approverId].filter((v): v is string => !!v);
  if (userIds.length) {
    checks.push(
      prisma.user.count({ where: { id: { in: userIds }, isActive: true } }).then((n) => {
        if (n !== new Set(userIds).size) {
          throw badRequest("The reviewer or approver is not an active user.", "bad_user");
        }
      }),
    );
  }
  if (d.supportingRoleIds?.length) {
    checks.push(
      prisma.hrRole.count({ where: { id: { in: d.supportingRoleIds }, active: true } }).then((n) => {
        if (n !== new Set(d.supportingRoleIds).size) {
          throw badRequest("One of the supporting roles was not found.", "bad_role");
        }
      }),
    );
  }

  await Promise.all(checks);
}
