/**
 * Seed the CRM lead STATUS vocabulary — the cross-stage state ("Call connected",
 * "Details given", "Waiting for English test"). Idempotent: upserts by `code`,
 * and intentionally does NOT overwrite `active`, so a status an admin retired
 * stays retired on a re-run.
 *
 * Matches the rows the 20260919160000_lead_sub_status migration inserts; this
 * script exists so a fresh/branch database can be brought up to the same list
 * without replaying migrations.
 *
 *   npm run db:seed-crm-sub-statuses
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Ordered as one journey. `group` only drives the headings in the picker — a
// flat list of two dozen is unreadable in a dropdown.
//
// Every "we sent / we asked" action carries the Awaiting vs Not Responding
// split: the same action splits into a healthy chase and a stalled one, and
// telling those two apart is the whole reason to read the list. The Not
// Responding rows are red because they are the work queue.
//
// Nothing here duplicates a STAGE: Not Interested, Not Eligible, Already
// Processing Elsewhere, Enrolled and Duplicate are stages and stay stages.
const SUB_STATUSES = [
  { code: "not_contacted", label: "Not Contacted", group: "Not reached", displayOrder: 10, color: "#9aa0a6", isDefault: true },
  { code: "not_answering_call", label: "Not Answering Call", group: "Not reached", displayOrder: 20, color: "#94a3b8" },
  { code: "wrong_invalid_number", label: "Wrong / Invalid Number", group: "Not reached", displayOrder: 30, color: "#64748b" },
  { code: "call_back_requested", label: "Call Back Requested", group: "Not reached", displayOrder: 40, color: "#60a5fa" },

  { code: "connected_on_call", label: "Connected On Call", group: "Reached", displayOrder: 50, color: "#3b82f6" },
  { code: "clarification_pending", label: "Clarification Pending", group: "Reached", displayOrder: 60, color: "#6366f1" },
  { code: "counselling_done", label: "Counselling Done", group: "Reached", displayOrder: 70, color: "#818cf8" },

  { code: "details_sent_awaiting_confirmation", label: "Details Sent and Awaiting Confirmation", group: "Details", displayOrder: 80, color: "#f59e0b" },
  { code: "details_sent_not_responding", label: "Details Sent and Not Responding", group: "Details", displayOrder: 90, color: "#ef4444" },

  { code: "documents_requested_awaiting", label: "Documents Requested and Awaiting", group: "Documents", displayOrder: 100, color: "#f59e0b" },
  { code: "documents_requested_not_responding", label: "Documents Requested and Not Responding", group: "Documents", displayOrder: 110, color: "#ef4444" },
  { code: "documents_received", label: "Documents Received", group: "Documents", displayOrder: 120, color: "#16a34a" },

  { code: "payment_link_sent_awaiting", label: "Payment Link Sent and Awaiting", group: "Payment", displayOrder: 130, color: "#f59e0b" },
  { code: "payment_link_sent_not_responding", label: "Payment Link Sent and Not Responding", group: "Payment", displayOrder: 140, color: "#ef4444" },
  { code: "part_payment_received", label: "Part Payment Received", group: "Payment", displayOrder: 150, color: "#22c55e" },
  { code: "confirmed_awaiting_enrollment", label: "Confirmed — Awaiting Enrollment", group: "Payment", displayOrder: 160, color: "#16a34a" },

  { code: "awaiting_english_test", label: "Awaiting English Test (OET / IELTS)", group: "Waiting on an external event", displayOrder: 170, color: "#fbbf24" },
  { code: "awaiting_exam_result", label: "Awaiting Exam Result (NCLEX / CGFNS)", group: "Waiting on an external event", displayOrder: 180, color: "#fbbf24" },
  { code: "awaiting_experience_completion", label: "Awaiting Experience Completion", group: "Waiting on an external event", displayOrder: 190, color: "#fcd34d" },
  { code: "arranging_funds", label: "Arranging Funds", group: "Waiting on an external event", displayOrder: 200, color: "#f97316" },
  { code: "family_decision_pending", label: "Family Decision Pending", group: "Waiting on an external event", displayOrder: 210, color: "#fb923c" },
  { code: "comparing_other_consultancies", label: "Comparing Other Consultancies", group: "Waiting on an external event", displayOrder: 220, color: "#fdba74" },

  { code: "postponed_by_candidate", label: "Postponed by Candidate", group: "Dormant", displayOrder: 230, color: "#a1a1aa" },
  { code: "unreachable_after_multiple_attempts", label: "Unreachable After Multiple Attempts", group: "Dormant", displayOrder: 240, color: "#71717a" },
];

async function main() {
  console.log("Seeding CRM lead statuses (cross-stage)…");
  for (const s of SUB_STATUSES) {
    await prisma.crmLeadSubStatus.upsert({
      where: { code: s.code },
      update: {
        label: s.label,
        group: s.group,
        displayOrder: s.displayOrder,
        color: s.color,
        isDefault: s.isDefault ?? false,
      },
      create: { ...s, isDefault: s.isDefault ?? false, active: true },
    });
    console.log(`  ✓ ${s.group} · ${s.label}`);
  }
  console.log(`\nDone — ${SUB_STATUSES.length} statuses.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
