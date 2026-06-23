/**
 * Seeds the CRM master tables: lead statuses (pipeline stages / dispositions)
 * and qualifications. Idempotent — upserts by unique key, and intentionally
 * does NOT overwrite `active`, so a manually-deactivated row stays deactivated
 * on re-run.
 *
 *   npm run db:seed-crm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// The pipeline stage model. `kind`: 'active' shows on the stage bar; 'won' /
// 'lost' are terminal pills. `pipeline` and `enrolled` are set ONLY by the
// Set-deal / Enroll actions (see ACTION_ONLY_STATUS_CODES) — never the manual
// dropdown. `duplicate` is kept for the importer's dedup flagging.
const STATUSES = [
  { code: "not_yet_started", label: "Not Yet Started", kind: "active", displayOrder: 0, color: "#9aa0a6", isDefault: true },
  { code: "qualify", label: "Qualify", kind: "active", displayOrder: 1, color: "#3b82f6", isDefault: false },
  { code: "follow_up", label: "Follow-Up", kind: "active", displayOrder: 2, color: "#f59e0b", isDefault: false },
  { code: "re_marketing", label: "Re-marketing", kind: "active", displayOrder: 3, color: "#a855f7", isDefault: false },
  { code: "pipeline", label: "Pipeline", kind: "active", displayOrder: 4, color: "#6366f1", isDefault: false },
  { code: "enrolled", label: "Enrolled", kind: "won", displayOrder: 5, color: "#16a34a", isDefault: false },
  { code: "already_processing_elsewhere", label: "Already Processing Elsewhere", kind: "lost", displayOrder: 6, color: "#64748b", isDefault: false },
  { code: "not_eligible", label: "Not Eligible", kind: "lost", displayOrder: 7, color: "#fb923c", isDefault: false },
  { code: "not_interested", label: "Not Interested", kind: "lost", displayOrder: 8, color: "#ef4444", isDefault: false },
  { code: "duplicate", label: "Duplicate", kind: "lost", displayOrder: 9, color: "#6b7280", isDefault: false },
];

const QUALIFICATIONS = [
  { label: "10th", displayOrder: 1 },
  { label: "12th", displayOrder: 2 },
  { label: "Diploma", displayOrder: 3 },
  { label: "Bachelor's", displayOrder: 4 },
  { label: "Master's", displayOrder: 5 },
  { label: "PhD", displayOrder: 6 },
  { label: "Other", displayOrder: 7 },
];

async function main() {
  console.log("Seeding CRM lead statuses…");
  for (const s of STATUSES) {
    await prisma.crmLeadStatus.upsert({
      where: { code: s.code },
      update: {
        label: s.label,
        kind: s.kind,
        displayOrder: s.displayOrder,
        color: s.color,
        isDefault: s.isDefault,
      },
      create: { ...s, active: true },
    });
    console.log(`  ✓ ${s.label}`);
  }

  console.log("\nSeeding CRM qualifications…");
  for (const q of QUALIFICATIONS) {
    await prisma.crmQualification.upsert({
      where: { label: q.label },
      update: { displayOrder: q.displayOrder },
      create: { ...q, active: true },
    });
    console.log(`  ✓ ${q.label}`);
  }

  // Default the re-inquiry supervisor to "suhaina" if not already configured, so
  // re-inquiry oversight tasks + digests have a recipient out of the box. Never
  // overwrites an explicit choice.
  const SUPERVISOR_KEY = "crm_reinquiry_supervisor_user_id";
  const existing = await prisma.appSetting.findUnique({ where: { key: SUPERVISOR_KEY }, select: { value: true } });
  if (!existing?.value) {
    const sup = await prisma.user.findFirst({ where: { username: "suhaina" }, select: { id: true } });
    if (sup) {
      await prisma.appSetting.upsert({
        where: { key: SUPERVISOR_KEY },
        create: { key: SUPERVISOR_KEY, value: sup.id },
        update: { value: sup.id },
      });
      console.log(`\n  ✓ re-inquiry supervisor → suhaina (${sup.id})`);
    } else {
      console.log("\n  • no 'suhaina' user — set the re-inquiry supervisor on CRM → Settings.");
    }
  }

  console.log("\nDone.");
  console.log({
    statuses: await prisma.crmLeadStatus.count(),
    qualifications: await prisma.crmQualification.count(),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
