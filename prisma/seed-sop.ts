/**
 * SOP module seed: the category master, plus the demo SOP from §27.
 *
 * Idempotent — re-running updates rather than duplicating, so it is safe on an
 * install that already has SOPs. The demo SOP is keyed on its SOP number, and
 * the script REFUSES to touch it once it has been published and revised, so a
 * seed run can never overwrite a document someone has been working on.
 *
 *   npm run db:seed-sop            (or: npx tsx prisma/seed-sop.ts)
 *   npm run db:seed-sop -- --demo  also creates OPS-SOP-001
 *
 * The demo needs an Operations department and at least one active employee to
 * own the SOP; it says what is missing and exits cleanly rather than half
 * creating things.
 */
import { PrismaClient } from "@prisma/client";
import { deriveDeptCode, formatSopNumber, slaToMinutes } from "../src/lib/sop/constants";

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Process", description: "How a recurring operational process is run.", sortOrder: 10 },
  { name: "Policy", description: "A rule the company operates under.", sortOrder: 20 },
  { name: "Compliance", description: "Procedures driven by a regulator or an external authority.", sortOrder: 30 },
  { name: "Quality", description: "Checks and standards that protect service quality.", sortOrder: 40 },
  { name: "Onboarding", description: "Bringing a candidate, client or employee on board.", sortOrder: 50 },
  { name: "Finance", description: "Money handling, billing and reconciliation procedures.", sortOrder: 60 },
];

async function seedCategories() {
  let created = 0;
  for (const c of CATEGORIES) {
    const existing = await prisma.sopCategory.findUnique({ where: { name: c.name } });
    if (existing) continue;
    await prisma.sopCategory.create({ data: c });
    created++;
  }
  console.log(`categories: ${created} created, ${CATEGORIES.length - created} already present`);
}

const DEMO_STEPS = [
  {
    title: "Check the mandatory document list",
    instruction:
      "Open the candidate's file and confirm every document on the mandatory list has been uploaded. Record anything missing before going further — a partial check that is redone later costs more than doing it once.",
    role: "Documentation Executive",
    sla: 4,
    unit: "hours" as const,
    requiredInput: "Candidate file with uploaded documents",
    expectedOutput: "Confirmed list of documents received and missing",
    evidence: "Document checklist completed in the candidate file",
    checklist: [
      "Passport uploaded",
      "Nursing registration certificate uploaded",
      "Degree / diploma certificate uploaded",
      "Experience letters uploaded",
      "Photograph meeting the specification uploaded",
    ],
  },
  {
    title: "Verify candidate personal details",
    instruction:
      "Check that name, date of birth and nationality are identical across the passport, the registration certificate and the application. A mismatch here is the single most common cause of a rejected submission.",
    role: "Documentation Executive",
    sla: 2,
    unit: "hours" as const,
    requiredInput: "Passport, registration certificate, application record",
    expectedOutput: "Personal details verified or a discrepancy raised",
    evidence: "Verification fields completed in the candidate file",
    checklist: [
      "Name matches the passport exactly",
      "Date of birth consistent across documents",
      "Nationality consistent across documents",
      "Passport is valid for the full processing period",
    ],
  },
  {
    title: "Check certificates and registration documents",
    instruction:
      "Confirm each certificate is legible, complete (all pages), correctly signed and within any validity period the authority requires.",
    role: "Documentation Executive",
    sla: 4,
    unit: "hours" as const,
    requiredInput: "Scanned certificates",
    expectedOutput: "Certificates accepted, or a re-scan requested",
    evidence: "Certificate review recorded against each document",
    checklist: [
      "Every page present and in order",
      "Scan is clearly readable at full size",
      "Required signatures and seals present",
      "Issuing authority and date visible",
    ],
  },
  {
    title: "Resolve discrepancies",
    instruction:
      "Where a document is missing, illegible or inconsistent, contact the candidate with a single consolidated request rather than several separate ones, and track it to closure.",
    role: "Operations Team Lead",
    sla: 24,
    unit: "hours" as const,
    requiredInput: "List of discrepancies from steps 1–3",
    expectedOutput: "Discrepancies closed, or the case escalated",
    evidence: "Correspondence logged against the candidate",
    checklist: [
      "Consolidated request sent to the candidate",
      "Response received and filed",
      "Re-check completed against the original finding",
    ],
  },
  {
    title: "Approve documentation",
    instruction:
      "Confirm the file is complete and consistent, and mark it approved for submission to the registration authority.",
    role: "Operations Manager",
    sla: 1,
    unit: "days" as const,
    requiredInput: "Verified candidate file",
    expectedOutput: "File approved and ready for submission",
    evidence: "Approval recorded in the candidate file",
    checklist: ["All earlier steps complete", "No open discrepancies", "Approval recorded with date and approver"],
  },
];

const DEMO_QUALITY = [
  { criterion: "Document completeness", target: "100% of mandatory documents present", isMandatory: true },
  { criterion: "Name consistency", target: "Must match the passport exactly", isMandatory: true },
  { criterion: "Image quality", target: "Clearly readable at full size", isMandatory: true },
  { criterion: "Verification fields", target: "All fields completed", isMandatory: true },
];

const DEMO_EXCEPTIONS = [
  {
    issue: "Passport name differs from the nursing registration",
    condition: "Names do not match exactly across the two documents.",
    requiredAction:
      "Request supporting proof from the candidate — an affidavit, a marriage certificate, or a gazette notification.",
    escalateToRoleName: "Operations Team Lead",
    escalationSla: 24,
    escalationUnit: "hours" as const,
    priority: "critical",
    notifyProcessOwner: true,
    notifyDepartmentHead: false,
  },
  {
    issue: "Certificate scan is not readable",
    condition: "Any page is blurred, cropped or too low-resolution to read.",
    requiredAction: "Ask the candidate for a fresh scan at 300 dpi or better, in colour.",
    escalateToRoleName: "Documentation Executive",
    escalationSla: 8,
    escalationUnit: "hours" as const,
    priority: "medium",
    notifyProcessOwner: false,
    notifyDepartmentHead: false,
  },
  {
    issue: "Passport expires before the process completes",
    condition: "Passport validity is shorter than the expected processing period.",
    requiredAction: "Advise the candidate to renew immediately and hold the submission until the new passport is filed.",
    escalateToRoleName: "Operations Manager",
    escalationSla: 2,
    escalationUnit: "days" as const,
    priority: "high",
    notifyProcessOwner: true,
    notifyDepartmentHead: true,
  },
];

const DEMO_KPIS = [
  {
    name: "Document verification turnaround",
    description: "Time from documents submitted to documentation approved.",
    target: "< 24",
    unit: "hours",
    measurementMethod: "Median across all files verified in the period.",
    dataSource: "Candidate file timestamps",
    reviewFrequency: "monthly",
  },
  {
    name: "First-time accuracy",
    description: "Files approved without a discrepancy being raised.",
    target: "> 95",
    unit: "%",
    measurementMethod: "Files with no discrepancy ÷ files verified.",
    dataSource: "Discrepancy log",
    reviewFrequency: "monthly",
  },
  {
    name: "Escalation rate",
    description: "Files that needed an escalation to close.",
    target: "< 5",
    unit: "%",
    measurementMethod: "Escalated files ÷ files verified.",
    dataSource: "Escalation records",
    reviewFrequency: "monthly",
  },
  {
    name: "Candidate complaints",
    description: "Complaints attributed to the verification stage.",
    target: "< 2",
    unit: "%",
    measurementMethod: "Complaints ÷ candidates processed.",
    dataSource: "CRM complaint log",
    reviewFrequency: "quarterly",
  },
];

async function seedDemoSop() {
  const department =
    (await prisma.hrDepartment.findFirst({ where: { name: { contains: "Operation", mode: "insensitive" } } })) ??
    (await prisma.hrDepartment.findFirst({ where: { active: true }, orderBy: { name: "asc" } }));

  if (!department) {
    console.log("demo SOP: skipped — no HR department exists yet. Seed HR first (npm run db:seed-hr).");
    return;
  }

  const owner = await prisma.employee.findFirst({ where: { active: true }, orderBy: { name: "asc" } });
  if (!owner) {
    console.log("demo SOP: skipped — no active employee exists to own it. Seed HR first.");
    return;
  }

  const deptCode = deriveDeptCode(department.name);
  const sopNumber = formatSopNumber(deptCode, 1);

  const existing = await prisma.sop.findUnique({
    where: { sopNumber },
    include: { versions: { select: { id: true } } },
  });
  if (existing) {
    // Never rewrite an SOP that has been worked on. Re-seeding is for a fresh
    // install, not for resetting someone's document.
    console.log(`demo SOP: ${sopNumber} already exists (${existing.versions.length} version(s)) — left alone.`);
    return;
  }

  const category = await prisma.sopCategory.findUnique({ where: { name: "Process" } });
  const creator = await prisma.user.findFirst({
    where: { isActive: true, roleRef: { isAdmin: true } },
    orderBy: { createdAt: "asc" },
  });

  const purpose = [
    "Ensure all candidate documents are verified for completeness, consistency and readability before submission to the relevant registration authority.",
    "",
    "A file that reaches the authority with a mismatch or an unreadable scan is returned, and the candidate waits weeks for a problem that takes minutes to catch here. This process exists to catch it here.",
  ].join("\n");

  await prisma.$transaction(async (tx) => {
    const sop = await tx.sop.create({
      data: {
        sopNumber,
        deptCode,
        seq: 1,
        title: "Candidate Document Verification Process",
        departmentId: department.id,
        categoryId: category?.id ?? null,
        processFunction: "Candidate onboarding",
        ownerEmployeeId: owner.id,
        confidentiality: "general",
        status: "draft",
        createdById: creator?.id ?? null,
      },
    });

    const version = await tx.sopVersion.create({
      data: {
        sopId: sop.id,
        versionLabel: "V1.0",
        major: 1,
        minor: 0,
        status: "draft",
        title: sop.title,
        departmentId: department.id,
        categoryId: category?.id ?? null,
        processFunction: "Candidate onboarding",
        ownerEmployeeId: owner.id,
        confidentiality: "general",
        purpose,
        triggerDescription:
          "Candidate submits all mandatory documents and the application status changes to Documents Submitted.",
        triggerType: "status_change",
        triggerSource: "Candidate application record",
        triggerCondition: "status = Documents Submitted",
        qualityStandard:
          "A file is correctly verified when every mandatory document is present, the candidate's details are identical across all of them, every scan is readable, and each verification field has been completed by a named person.",
        reviewFrequency: "half_yearly",
        reviewReminderDays: 15,
        changeSummary: "Initial SOP.",
        createdById: creator?.id ?? null,
      },
    });

    for (const [i, step] of DEMO_STEPS.entries()) {
      await tx.sopStep.create({
        data: {
          versionId: version.id,
          seq: i + 1,
          title: step.title,
          instruction: step.instruction,
          responsibleRoleName: step.role,
          responsibleDepartmentId: department.id,
          slaValue: step.sla,
          slaUnit: step.unit,
          slaMinutes: slaToMinutes(step.sla, step.unit),
          requiredInput: step.requiredInput,
          expectedOutput: step.expectedOutput,
          evidence: step.evidence,
          checklists: {
            create: step.checklist.map((text, j) => ({ seq: j + 1, text, isMandatory: true })),
          },
        },
      });
    }

    await tx.sopQualityCriterion.createMany({
      data: DEMO_QUALITY.map((q, i) => ({ versionId: version.id, seq: i + 1, ...q })),
    });

    await tx.sopException.createMany({
      data: DEMO_EXCEPTIONS.map((x, i) => ({
        versionId: version.id,
        seq: i + 1,
        issue: x.issue,
        condition: x.condition,
        requiredAction: x.requiredAction,
        escalateToRoleName: x.escalateToRoleName,
        escalationSla: x.escalationSla,
        escalationUnit: x.escalationUnit,
        escalationMinutes: slaToMinutes(x.escalationSla, x.escalationUnit),
        priority: x.priority,
        notifyProcessOwner: x.notifyProcessOwner,
        notifyDepartmentHead: x.notifyDepartmentHead,
      })),
    });

    await tx.sopKpi.createMany({
      data: DEMO_KPIS.map((k, i) => ({ versionId: version.id, seq: i + 1, ...k, kpiOwnerEmployeeId: owner.id })),
    });

    await tx.sop.update({ where: { id: sop.id }, data: { draftVersionId: version.id } });

    await tx.sopAuditLog.create({
      data: {
        sopId: sop.id,
        versionId: version.id,
        versionLabel: "V1.0",
        userId: creator?.id ?? null,
        action: "SOP_CREATED",
        newValue: sopNumber,
        metadata: { seeded: true },
      },
    });
  });

  console.log(
    `demo SOP: created ${sopNumber} — "Candidate Document Verification Process" ` +
      `(${DEMO_STEPS.length} steps, ${DEMO_QUALITY.length} quality criteria, ` +
      `${DEMO_EXCEPTIONS.length} exceptions, ${DEMO_KPIS.length} KPIs), owned by ${owner.name}, as a V1.0 draft.`,
  );
  console.log("   Take it through Request review → Approve → Publish to exercise the full lifecycle.");
}

async function main() {
  await seedCategories();
  if (process.argv.includes("--demo")) await seedDemoSop();
  else console.log("demo SOP: not requested (pass --demo to create it)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
