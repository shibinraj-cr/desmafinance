/**
 * Seed Lead Pulse master data:
 *  - 8 sources (per BUILD_SPEC §3.2)
 *  - 4 regions (per BUILD_SPEC §3.3)
 *
 * Idempotent. Run via:  npm run db:seed-lead-pulse
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCES = [
  { code: "meta", label: "Meta", displayOrder: 1 },
  { code: "wabis", label: "Wabis", displayOrder: 2 },
  { code: "voxbay", label: "Voxbay", displayOrder: 3 },
  { code: "youtube", label: "YouTube", displayOrder: 4 },
  { code: "insta_fb", label: "Insta / FB", displayOrder: 5 },
  { code: "website", label: "Website", displayOrder: 6 },
  { code: "candidate_referral", label: "Candidate Referral", displayOrder: 7 },
  { code: "agency_referral", label: "Agency Referral", displayOrder: 8 },
  // Repeat business: an already-enrolled candidate enrolling in a further
  // service. The re-enrollment flow stamps a new lead's primary source with this
  // (preserving the original channel in Lead.originalSource) so repeat revenue
  // shows as its own bucket in the source funnel.
  { code: "existing_candidate", label: "Existing Candidate", displayOrder: 9 },
  // A number we have never seen messaging our WhatsApp. The conversation mirror
  // creates the lead (see src/lib/wa/mirror.ts), so these arrive without anyone
  // filling a form — worth its own bucket rather than being lost in "Other".
  { code: "whatsapp_inbound", label: "WhatsApp Inbound", displayOrder: 10 },
];

const REGIONS = [
  { code: "gcc", label: "GCC" },
  { code: "australia", label: "Australia" },
  { code: "kerala", label: "Kerala" },
  { code: "other_india", label: "Other India" },
];

async function main() {
  console.log("Seeding Lead Pulse sources…");
  for (const s of SOURCES) {
    await prisma.leadPulseSource.upsert({
      where: { code: s.code },
      update: {
        label: s.label,
        displayOrder: s.displayOrder,
      },
      create: { ...s, active: true },
    });
    console.log(`  ✓ ${s.label}`);
  }

  console.log("\nSeeding Lead Pulse regions…");
  for (const r of REGIONS) {
    await prisma.leadPulseRegion.upsert({
      where: { code: r.code },
      update: { label: r.label },
      create: { ...r, active: true },
    });
    console.log(`  ✓ ${r.label}`);
  }

  console.log("\nDone.");
  console.log({
    sources: await prisma.leadPulseSource.count(),
    regions: await prisma.leadPulseRegion.count(),
    leadPulseRoles: await prisma.leadPulseRole.count(),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
