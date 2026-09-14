/**
 * End-to-end verification of the SOP lifecycle against a real database.
 *
 *   SOP_DATABASE_URL="postgresql://…scratch-branch…" npm run db:verify-sop
 *
 * It drives the module's OWN functions — createSop, requestReview, decideReview,
 * decideApproval, publishVersion, createRevision, archiveSop — rather than a
 * reimplementation of them, so what passes here is the code the app runs.
 *
 * WHAT IT DOES TO YOUR DATA
 * Creates one SOP, walks it through the whole lifecycle, then deletes it (the
 * FK cascade takes its versions, steps, acknowledgements, audit rows and
 * notifications with it). Everything else is read-only. Pass `--keep` to leave
 * the SOP behind for a browser walk-through.
 *
 * The one thing it cannot give back is the sequence number: SOP numbers are
 * permanent by design, and deleting the row does not return `HR-SOP-001` to the
 * pool. That is exactly why it refuses to run against production.
 *
 * ── Why the URL is resolved before anything is imported ────────────────────
 * Importing `@prisma/client` loads `.env`, and in this repo `.env` is
 * PRODUCTION. The lib functions this drives share the `@/lib/prisma` singleton,
 * built from `process.env.DATABASE_URL` at import time. So the URL is checked
 * FIRST, assigned to `process.env`, and every value is pulled in by dynamic
 * import afterwards — inside `main`, because this file compiles to CommonJS and
 * top-level await is not available there.
 *
 * `.env.local` is a Next.js convention that a tsx script never reads, so
 * pointing this at a scratch branch means passing the variable, not editing
 * that file.
 */

// Type-only imports are erased at compile time: they pull in no module and
// cannot trigger the `.env` load described above.
import type { Permissions } from "../src/lib/rbac";
import type { SopAccess } from "../src/lib/sop/rbac";

/** The production endpoint. This script writes, so it refuses to touch it. */
const PROD_HOST_FRAGMENT = "ep-orange-brook-aqmaow18";

const KEEP = process.argv.includes("--keep");

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Assert that a call is REFUSED. A guard nobody tests is a guard that rots. */
async function refuses(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "it was ALLOWED");
  } catch {
    check(label, true);
  }
}

const perms = (o: Partial<Permissions> = {}): Permissions => ({
  isAdmin: false,
  canApprove: false,
  needsApproval: true,
  draftFirst: false,
  pages: [],
  roleName: "Test",
  ...o,
});

/** Resolve and vet the target database before a single module is loaded. */
function resolveUrl(): string {
  const url = (process.env.SOP_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    console.error(
      "No database URL given.\n\n" +
        "Point this at a scratch Neon branch:\n" +
        '  SOP_DATABASE_URL="postgresql://…" npm run db:verify-sop\n\n' +
        "Editing .env.local will NOT work — a tsx script does not read it.",
    );
    process.exit(1);
  }
  if (url.includes(PROD_HOST_FRAGMENT)) {
    console.error(
      "REFUSING TO RUN: that URL is the production database.\n\n" +
        "This script creates and deletes SOP records, and SOP numbers are never\n" +
        "reissued. Create a Neon branch and pass its URL as SOP_DATABASE_URL.",
    );
    process.exit(1);
  }
  return url;
}

async function main() {
  const url = resolveUrl();
  // Every Prisma-touching module is loaded after this assignment, so the shared
  // client is built from the scratch URL and never from `.env`.
  process.env.DATABASE_URL = url;

  const { PrismaClient } = await import("@prisma/client");
  const { getSopAccess } = await import("../src/lib/sop/rbac");
  const { createSop } = await import("../src/lib/sop/create");
  const {
    archiveSop,
    assertVersionEditable,
    createRevision,
    decideApproval,
    decideReview,
    publishVersion,
    requestReview,
    unarchiveSop,
  } = await import("../src/lib/sop/workflow");
  const { acknowledgementRegister, dashboardCounts, mySopCounts, versionHistory } = await import(
    "../src/lib/sop/queries"
  );
  const { slaToMinutes } = await import("../src/lib/sop/constants");
  const { today } = await import("../src/lib/sop/review-dates");

  const prisma = new PrismaClient();
  const v = (id: string) => prisma.sopVersion.findUniqueOrThrow({ where: { id } });
  const s = (id: string) => prisma.sop.findUniqueOrThrow({ where: { id } });

  async function accessFor(userId: string, employeeId: string | null, admin: boolean): Promise<SopAccess> {
    if (!employeeId) return getSopAccess(userId, perms({ isAdmin: admin }));
    const e = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { departments: { select: { departmentId: true } }, headOfDepartments: { select: { id: true } } },
    });
    return getSopAccess(userId, perms({ isAdmin: admin }), {
      employeeId,
      departmentIds: e?.departments.map((d) => d.departmentId) ?? [],
      headOfDepartmentIds: e?.headOfDepartments.map((d) => d.id) ?? [],
    });
  }

  try {
    console.log(`Database: ${url.replace(/\/\/[^@]*@/, "//***@").split("?")[0]}\n`);

    // ── Cast ──────────────────────────────────────────────────────────────
    const department =
      (await prisma.hrDepartment.findFirst({
        where: { active: true, name: { contains: "Operation", mode: "insensitive" } },
      })) ?? (await prisma.hrDepartment.findFirst({ where: { active: true }, orderBy: { name: "asc" } }));
    const owner = await prisma.employee.findFirst({
      where: { active: true, userId: { not: null } },
      orderBy: { name: "asc" },
    });
    const users = await prisma.user.findMany({ where: { isActive: true }, take: 3, orderBy: { username: "asc" } });
    if (!department || !owner || users.length < 3) {
      console.error("Not enough master data: need a department, an employee with a login, and 3 active users.");
      process.exitCode = 1;
      return;
    }
    const [authorU, reviewerU, approverU] = users;

    const ownerDepts = await prisma.employee.findUnique({
      where: { id: owner.id },
      select: { departments: { select: { departmentId: true } }, headOfDepartments: { select: { id: true } } },
    });
    // The author holds the /sop/create grant, the way a real role would.
    const author = getSopAccess(authorU!.id, perms({ pages: ["/sop/create"] }), {
      employeeId: owner.id,
      departmentIds: ownerDepts?.departments.map((d) => d.departmentId) ?? [],
      headOfDepartmentIds: ownerDepts?.headOfDepartments.map((d) => d.id) ?? [],
    });
    const reviewer = await accessFor(reviewerU!.id, null, false);
    const approver = await accessFor(approverU!.id, null, false);
    const admin = await accessFor(authorU!.id, owner.id, true);

    console.log(`Department: ${department.name}   Owner: ${owner.name}`);
    console.log(
      `Author: ${authorU!.username}   Reviewer: ${reviewerU!.username}   Approver: ${approverU!.username}\n`,
    );

    // ── 1. Create ─────────────────────────────────────────────────────────
    console.log("1. Create");
    const created = await createSop(
      {
        title: "Lifecycle verification SOP",
        departmentId: department.id,
        categoryId: null,
        processFunction: "Automated verification",
        ownerEmployeeId: owner.id,
        supportingRoleIds: [],
        confidentiality: "general",
        reviewerId: reviewerU!.id,
        approverId: approverU!.id,
      },
      author,
    );
    const sopId = created.sop.id;
    const versionId = created.version.id;
    check(`SOP number minted (${created.sop.sopNumber})`, /^[A-Z]+-SOP-\d{3,}$/.test(created.sop.sopNumber));
    check("first version is V1.0", created.version.versionLabel === "V1.0");

    const afterCreate = await s(sopId);
    check("draft slot points at V1.0", afterCreate.draftVersionId === versionId);
    check("no published version yet", afterCreate.currentVersionId === null);

    await refuses("a user without the create grant is refused", () =>
      createSop(
        {
          title: "Should not exist",
          departmentId: department.id,
          categoryId: null,
          processFunction: null,
          ownerEmployeeId: owner.id,
          supportingRoleIds: [],
          confidentiality: "general",
          reviewerId: null,
          approverId: null,
        },
        reviewer,
      ),
    );

    // ── 2. Content ────────────────────────────────────────────────────────
    console.log("\n2. Content");
    await refuses("review cannot be requested with no purpose and no steps", () =>
      requestReview(versionId, author, null),
    );

    await prisma.sopVersion.update({
      where: { id: versionId },
      data: {
        purpose: "Verify that the whole SOP lifecycle works end to end.",
        triggerDescription: "The verification script runs.",
        triggerType: "manual",
        reviewFrequency: "quarterly",
      },
    });
    for (const [i, title] of ["First step", "Second step", "Third step"].entries()) {
      await prisma.sopStep.create({
        data: {
          versionId,
          seq: i + 1,
          title,
          instruction: `Instruction for ${title.toLowerCase()}.`,
          responsibleRoleName: "Verifier",
          slaValue: (i + 1) * 2,
          slaUnit: "hours",
          slaMinutes: slaToMinutes((i + 1) * 2, "hours"),
          checklists: { create: [{ seq: 1, text: `Check ${i + 1}`, isMandatory: true }] },
        },
      });
    }
    await prisma.sopQualityCriterion.create({
      data: { versionId, seq: 1, criterion: "Everything verified", target: "100%", isMandatory: true },
    });
    await prisma.sopException.create({
      data: {
        versionId,
        seq: 1,
        issue: "Verification fails",
        requiredAction: "Investigate",
        priority: "critical",
        escalationSla: 24,
        escalationUnit: "hours",
        escalationMinutes: slaToMinutes(24, "hours"),
      },
    });
    await prisma.sopKpi.create({
      data: { versionId, seq: 1, name: "Verification pass rate", target: "> 99", unit: "%", reviewFrequency: "monthly" },
    });
    const steps = await prisma.sopStep.findMany({ where: { versionId }, orderBy: { seq: "asc" } });
    check("3 steps stored with contiguous seq", steps.map((x) => x.seq).join(",") === "1,2,3");
    check("SLA stored as value + unit AND comparable minutes", steps[0]!.slaValue === 2 && steps[0]!.slaMinutes === 120);

    // ── 3. Review ─────────────────────────────────────────────────────────
    console.log("\n3. Review");
    await refuses("the approver cannot review before it is sent", () =>
      decideReview(versionId, approver, "approve", null),
    );
    await requestReview(versionId, author, null);
    check("status is review_requested", (await v(versionId)).status === "review_requested");
    check("SOP row tracks the draft (never published yet)", (await s(sopId)).status === "review_requested");
    await refuses("the author cannot approve their own review", () =>
      decideReview(versionId, author, "approve", null),
    );

    await decideReview(versionId, reviewer, "request_changes", "Needs a clearer purpose.");
    check("send-back lands in changes_requested", (await v(versionId)).status === "changes_requested");
    await requestReview(versionId, author, null);
    await decideReview(versionId, reviewer, "approve", "Looks right.");
    check("review approval moves it to approval_pending", (await v(versionId)).status === "approval_pending");

    // ── 4. Approval ───────────────────────────────────────────────────────
    console.log("\n4. Approval");
    await refuses("the reviewer cannot also give final approval", () =>
      decideApproval(versionId, reviewer, "approve", null),
    );
    await decideApproval(versionId, approver, "approve", "Approved.");
    check("status is approved", (await v(versionId)).status === "approved");

    // ── 5. Publish ────────────────────────────────────────────────────────
    console.log("\n5. Publish");
    const publishSettings = {
      effectiveDate: today(),
      nextReviewDate: null,
      applicableDepartmentIds: [department.id],
      applicableRoleIds: [] as string[],
      applicableEmployeeIds: [owner.id],
      requiresAcknowledgement: true,
      acknowledgementDeadline: null as Date | null,
      publishNotes: "Published by the verification script.",
    };
    await refuses("a non-admin cannot publish", () => publishVersion(versionId, author, publishSettings));
    await refuses("acknowledgement with no audience is refused", () =>
      publishVersion(versionId, admin, {
        ...publishSettings,
        applicableDepartmentIds: [],
        applicableEmployeeIds: [],
      }),
    );

    const deadline = new Date(today());
    deadline.setUTCDate(deadline.getUTCDate() + 7);
    await publishVersion(versionId, admin, { ...publishSettings, acknowledgementDeadline: deadline });

    const published = await v(versionId);
    const sopAfterPublish = await s(sopId);
    check("version is published and LOCKED", published.status === "published" && published.isLocked);
    check("next review derived from the quarterly frequency", published.nextReviewDate !== null);
    check("SOP points at the live version", sopAfterPublish.currentVersionId === versionId);
    check("draft slot cleared", sopAfterPublish.draftVersionId === null);
    check("SOP reads as published", sopAfterPublish.status === "published");

    const register = await acknowledgementRegister(versionId);
    check(`acknowledgements assigned (${register.summary.total})`, register.summary.total > 0);
    check("none acknowledged yet", register.summary.acknowledged === 0);

    await refuses("a published version cannot be edited", () => assertVersionEditable(versionId, admin));
    await refuses("a published version cannot be published again", () =>
      publishVersion(versionId, admin, publishSettings),
    );

    // ── 6. Acknowledge ────────────────────────────────────────────────────
    console.log("\n6. Acknowledge");
    const myAck = await prisma.sopAcknowledgement.findUnique({
      where: { versionId_employeeId: { versionId, employeeId: owner.id } },
    });
    check("the owner was assigned an acknowledgement", !!myAck);
    if (myAck) {
      await prisma.sopAcknowledgement.update({
        where: { id: myAck.id },
        data: { acknowledgedAt: new Date(), viewedAt: new Date(), status: "acknowledged", userId: owner.userId },
      });
      const after = await acknowledgementRegister(versionId);
      check("register counts the acknowledgement", after.summary.acknowledged === 1);
      check("viewed count includes it", after.summary.viewed >= 1);
      check("pending drops by one", after.summary.pending === register.summary.total - 1);
    }

    // ── 7. Revision ───────────────────────────────────────────────────────
    console.log("\n7. Revision");
    const rev = await createRevision(sopId, admin, { bump: "minor", changeSummary: "SLA updated." });
    check("revision is V1.1", rev.versionLabel === "V1.1");
    const sopDuringRev = await s(sopId);
    check("SOP still reads as published during the revision", sopDuringRev.status === "published");
    check("live version unchanged", sopDuringRev.currentVersionId === versionId);
    check("draft slot holds the revision", sopDuringRev.draftVersionId === rev.versionId);

    const copied = await prisma.sopStep.findMany({ where: { versionId: rev.versionId }, orderBy: { seq: "asc" } });
    const copiedChecks = await prisma.sopStepChecklist.count({ where: { step: { versionId: rev.versionId } } });
    const copiedKpis = await prisma.sopKpi.count({ where: { versionId: rev.versionId } });
    check("steps deep-copied into the revision", copied.length === 3);
    check("checklists deep-copied", copiedChecks === 3);
    check("KPI definitions deep-copied", copiedKpis === 1);
    check("copies are separate rows, not shared", copied[0]!.id !== steps[0]!.id);

    await refuses("a second concurrent revision is refused", () =>
      createRevision(sopId, admin, { bump: "minor", changeSummary: null }),
    );

    // Publish V1.1 and confirm V1.0 becomes history.
    await requestReview(rev.versionId, admin, null);
    await decideReview(rev.versionId, reviewer, "approve", null);
    await decideApproval(rev.versionId, approver, "approve", null);
    await publishVersion(rev.versionId, admin, {
      ...publishSettings,
      applicableEmployeeIds: [],
      requiresAcknowledgement: false,
    });
    check("V1.0 retired to archived", (await v(versionId)).status === "archived");
    check("V1.0 is still locked and readable", (await v(versionId)).isLocked);
    check("SOP now points at V1.1", (await s(sopId)).currentVersionId === rev.versionId);

    const history = await versionHistory(sopId);
    check("version history holds both versions", history.length === 2);
    check("history is newest first", history[0]!.versionLabel === "V1.1");
    check("revision chain links back to V1.0", history[0]!.previousVersionId === versionId);

    // ── 8. Archive ────────────────────────────────────────────────────────
    console.log("\n8. Archive");
    await refuses("a non-admin cannot archive", () =>
      archiveSop(sopId, author, { reason: "no", replacementSopId: null, archiveDate: null }),
    );
    await refuses("an SOP cannot replace itself", () =>
      archiveSop(sopId, admin, { reason: "x", replacementSopId: sopId, archiveDate: null }),
    );
    await archiveSop(sopId, admin, { reason: "Verification complete.", replacementSopId: null, archiveDate: null });
    const archived = await s(sopId);
    check("SOP is archived", archived.isArchived && archived.status === "archived");
    check("archive reason recorded", archived.archiveReason === "Verification complete.");
    await unarchiveSop(sopId, admin);
    const restored = await s(sopId);
    check("restore brings it back as published", !restored.isArchived && restored.status === "published");

    // ── 9. Trail ──────────────────────────────────────────────────────────
    console.log("\n9. Audit, notifications, dashboards");
    const auditRows = await prisma.sopAuditLog.findMany({ where: { sopId }, select: { action: true } });
    const actions = new Set(auditRows.map((a) => a.action));
    check(`audit trail written (${auditRows.length} rows)`, auditRows.length > 0);
    for (const a of [
      "SOP_CREATED",
      "REVIEW_REQUESTED",
      "CHANGES_REQUESTED",
      "REVIEW_APPROVED",
      "APPROVED",
      "PUBLISHED",
      "REVISION_CREATED",
      "ARCHIVED",
      "UNARCHIVED",
    ]) {
      check(`audit records ${a}`, actions.has(a));
    }
    const notifs = await prisma.sopNotification.count({ where: { sopId } });
    check(`notifications written (${notifs})`, notifs > 0);

    const counts = await dashboardCounts(admin);
    check("dashboard counts the published SOP", counts.published >= 1);
    const mine = await mySopCounts(admin);
    check("My SOPs counts it as owned", mine.owned >= 1);

    // ── Cleanup ───────────────────────────────────────────────────────────
    console.log("");
    if (KEEP) {
      console.log(`Kept ${created.sop.sopNumber} (${sopId}) for a browser walk-through — delete it when done.`);
    } else {
      // Clear the self-referencing pointers first, then let the cascade take
      // the versions, steps, checklists, acknowledgements, audit rows and
      // notifications.
      await prisma.sop.update({ where: { id: sopId }, data: { currentVersionId: null, draftVersionId: null } });
      await prisma.sop.delete({ where: { id: sopId } });
      const leftVersions = await prisma.sopVersion.count({ where: { sopId } });
      const leftAudit = await prisma.sopAuditLog.count({ where: { sopId } });
      check("cleanup removed the SOP and everything under it", leftVersions === 0 && leftAudit === 0);
    }

    console.log(`\n${passed} checks passed, ${failures.length} failed.`);
    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) console.log("  -", f);
      process.exitCode = 1;
      return;
    }
    console.log("SOP lifecycle verified end to end.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
