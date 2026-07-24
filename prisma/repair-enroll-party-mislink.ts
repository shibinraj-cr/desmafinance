/**
 * REPAIR — re-point an enrollment's Party links from a wrongly-matched Vendor
 * back to the enrolled Candidate, then restore the vendor's overwritten contact
 * details.
 *
 * Root cause (fixed in src/lib/crm-enroll.ts `findOrCreateParty`): the enroll
 * party lookup matched by email / phone / name WITHOUT a `group = "Candidate"`
 * filter. Because Party.email / Party.phone are non-unique and the Party master
 * mixes Candidates AND Vendors, a candidate that shared a contact value with an
 * existing Vendor resolved to — and then MUTATED — the vendor's row. The
 * enrollment's PartyService, pipeline, TransactionDraft and OpsProject all
 * linked to the vendor instead of the candidate.
 *
 * This script identifies the vendor via the lead's current `partyId` (NO names
 * in source — this repo is public), finds-or-creates the correct Candidate
 * party, re-points every enrollment record to it, and restores the vendor's
 * email / phone from VENDOR_EMAIL / VENDOR_PHONE (supply the vendor's real
 * values — the bad enroll overwrote them with the candidate's).
 *
 * DRY-RUN by default — writes only with COMMIT=1.
 *
 *   LEAD_ID=<leadId> npx tsx prisma/repair-enroll-party-mislink.ts
 *   LEAD_ID=<leadId> VENDOR_EMAIL=<real> VENDOR_PHONE=<real> COMMIT=1 \
 *     npx tsx prisma/repair-enroll-party-mislink.ts
 *
 * IMPORTANT: your .env DATABASE_URL is PRODUCTION. Read the dry-run output in
 * full before setting COMMIT=1.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const LEAD_ID = process.env.LEAD_ID ?? "cmrx50oby00i2lc04lw3x4yi3";
const COMMIT = process.env.COMMIT === "1";
const VENDOR_EMAIL = process.env.VENDOR_EMAIL ?? null; // vendor's real email to restore
const VENDOR_PHONE = process.env.VENDOR_PHONE ?? null; // vendor's real phone to restore
const CLEAR_VENDOR_CONTACT = process.env.CLEAR_VENDOR_CONTACT === "1"; // blank instead of restore

const log = (...a: unknown[]) => console.log(...a);
const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "—");

async function main() {
  log(`[repair] ${COMMIT ? "*** COMMIT ***" : "DRY-RUN"} — lead ${LEAD_ID}\n`);

  const lead = await prisma.lead.findUnique({
    where: { id: LEAD_ID },
    select: {
      id: true, candidateName: true, email: true, phone: true,
      sourceId: true, serviceId: true, partyId: true, pipelineId: true,
      assignedToId: true,
      party: {
        select: {
          id: true, name: true, group: true, email: true, phone: true,
          sourceId: true, assignedL2BdeId: true, isActive: true,
        },
      },
    },
  });
  if (!lead) throw new Error(`Lead ${LEAD_ID} not found.`);
  log(`  candidate (from lead): "${lead.candidateName}"  email=${lead.email ?? "—"}  phone=${lead.phone ?? "—"}  serviceId=${lead.serviceId ?? "—"}`);

  if (!lead.partyId || !lead.party) throw new Error("Lead has no linked party — nothing to repair.");
  const vendor = lead.party;
  log(`  lead.partyId → "${vendor.name}"  group=${vendor.group}  email=${vendor.email ?? "—"}  phone=${vendor.phone ?? "—"}`);

  if (vendor.group !== "Vendor") {
    log(`\n[repair] Linked party is group="${vendor.group}", not "Vendor" — not the mislink this repairs. Aborting.`);
    return;
  }
  if (vendor.name === lead.candidateName) {
    log(`\n[repair] Vendor name equals the candidate name — ambiguous. Aborting for manual review.`);
    return;
  }
  const serviceId = lead.serviceId;
  if (!serviceId) throw new Error("Lead has no serviceId — cannot resolve the enrollment's PartyService.");
  const wrongId = vendor.id;

  // ── Resolve the correct Candidate party (mirrors the FIXED findOrCreateParty:
  //    email → phone → name, all constrained to group "Candidate"). ──────────
  let candidate =
    (lead.email ? await prisma.party.findFirst({ where: { email: lead.email, group: "Candidate" }, select: { id: true, name: true } }) : null) ??
    (lead.phone ? await prisma.party.findFirst({ where: { phone: lead.phone, group: "Candidate" }, select: { id: true, name: true } }) : null) ??
    (await prisma.party.findFirst({ where: { name: lead.candidateName, group: "Candidate" }, select: { id: true, name: true } }));

  const willCreate = !candidate;
  if (candidate) {
    log(`\n[candidate] existing Candidate party found → "${candidate.name}" (${candidate.id})`);
  } else {
    // Names are unique per (name, group) now, so a same-named Vendor does NOT
    // block creating a Candidate party. (Requires the party_name_unique_per_group
    // migration to be applied first.) Sanity-check the Candidate slot is free.
    const clash = await prisma.party.findUnique({ where: { name_group: { name: lead.candidateName, group: "Candidate" } }, select: { id: true } });
    if (clash) throw new Error(`Unexpected: a Candidate named "${lead.candidateName}" already exists (${clash.id}) but wasn't matched by email/phone/name. Resolve manually.`);
    log(`\n[candidate] no Candidate party — will CREATE one named "${lead.candidateName}".`);
  }

  // ── Discover the enrollment records still pinned to the vendor. ────────────
  const partyServices = await prisma.partyService.findMany({ where: { partyId: wrongId }, select: { id: true, serviceId: true } });
  const psForService = partyServices.find((p) => p.serviceId === serviceId) ?? null;
  const otherPs = partyServices.filter((p) => p.serviceId !== serviceId);
  const opsProject = psForService ? await prisma.opsProject.findUnique({ where: { partyServiceId: psForService.id }, select: { id: true, partyId: true } }) : null;
  const pipeline = lead.pipelineId
    ? await prisma.leadPulsePipeline.findUnique({ where: { id: lead.pipelineId }, select: { id: true, partyId: true, status: true, candidateName: true } })
    : null;
  const drafts = await prisma.transactionDraft.findMany({
    where: { partyId: wrongId, type: "Revenue", description: { contains: lead.candidateName } },
    select: { id: true, description: true, amount: true, date: true },
  });
  const txns = await prisma.transaction.findMany({
    where: { partyId: wrongId, type: "Revenue", description: { contains: lead.candidateName } },
    select: { id: true, description: true, amount: true, date: true },
  });

  log(`\n[scan] records linked to vendor "${vendor.name}" (${wrongId}) for this enrollment:`);
  log(`  PartyService (service ${serviceId}): ${psForService?.id ?? "none"}`);
  log(`  OpsProject:                          ${opsProject?.id ?? "none"}`);
  log(`  Pipeline (lead.pipelineId):          ${pipeline ? `${pipeline.id} [${pipeline.status}] partyId=${pipeline.partyId ?? "—"}` : "none"}`);
  log(`  Revenue drafts (name match):         ${drafts.map((x) => `${x.id} ₹${x.amount} ${d(x.date)}`).join(" | ") || "none"}`);
  log(`  Revenue transactions (name match):   ${txns.map((x) => `${x.id} ₹${x.amount} ${d(x.date)}`).join(" | ") || "none"}`);
  if (otherPs.length) log(`  ⚠ vendor also holds OTHER PartyServices (separate mislinks?): ${otherPs.map((p) => `${p.id}/${p.serviceId}`).join(", ")}`);

  // Conflict guard: if the candidate already has this service, moving the
  // vendor's PartyService would violate @@unique([partyId, serviceId]).
  if (candidate && psForService) {
    const dupe = await prisma.partyService.findUnique({
      where: { partyId_serviceId: { partyId: candidate.id, serviceId } },
      select: { id: true },
    });
    if (dupe) throw new Error(`Candidate already has a PartyService for service ${serviceId} (${dupe.id}). Manual merge required — aborting.`);
  }

  // The vendor's assignedL2BdeId was overwritten with the candidate's owner by
  // the bad enroll — carry it to the new candidate party, fall back to the lead.
  const ownerForCandidate = vendor.assignedL2BdeId ?? lead.assignedToId ?? null;

  // Will the vendor be fully clean after this lead's records move? (Residual
  // candidate-side links = another mislink; block the contact restore if so.)
  const vendorFullyClean = otherPs.length === 0;

  log(`\n[plan]`);
  log(`  → ${willCreate ? "CREATE" : "reuse"} Candidate party${candidate ? ` ${candidate.id}` : ""}`);
  if (psForService) log(`  → PartyService ${psForService.id}: partyId ${wrongId} → candidate`);
  if (opsProject) log(`  → OpsProject ${opsProject.id}: partyId ${wrongId} → candidate`);
  if (pipeline) log(`  → Pipeline ${pipeline.id}: partyId → candidate`);
  log(`  → Lead ${lead.id}: partyId → candidate`);
  for (const x of drafts) log(`  → TransactionDraft ${x.id}: partyId → candidate`);
  for (const x of txns) log(`  → Transaction ${x.id}: partyId → candidate  (⚠ posted finance record)`);
  if (vendorFullyClean) {
    if (CLEAR_VENDOR_CONTACT) log(`  → Vendor ${wrongId}: email/phone → BLANK, sourceId/assignedL2Bde → null`);
    else log(`  → Vendor ${wrongId}: email → ${VENDOR_EMAIL ?? "(unset)"}, phone → ${VENDOR_PHONE ?? "(unset)"}, sourceId/assignedL2Bde → null`);
  } else {
    log(`  → Vendor contact restore SKIPPED — vendor still holds other candidate links; re-run per lead first.`);
  }

  if (!COMMIT) {
    log(`\n[dry-run] no writes. Re-run with COMMIT=1${vendorFullyClean && !CLEAR_VENDOR_CONTACT ? " VENDOR_EMAIL=… VENDOR_PHONE=…" : ""} to apply.`);
    return;
  }

  // Guard the vendor-contact restore inputs before we touch anything.
  if (vendorFullyClean && !CLEAR_VENDOR_CONTACT && !VENDOR_EMAIL && !VENDOR_PHONE) {
    throw new Error("COMMIT set but VENDOR_EMAIL / VENDOR_PHONE not provided (and CLEAR_VENDOR_CONTACT!=1). Refusing to leave the candidate's contact on the vendor row.");
  }

  await prisma.$transaction(async (tx) => {
    const candidateId = candidate
      ? candidate.id
      : (await tx.party.create({
          data: {
            name: lead.candidateName,
            group: "Candidate",
            email: lead.email,
            phone: lead.phone,
            sourceId: lead.sourceId,
            assignedL2BdeId: ownerForCandidate,
            isActive: true,
          },
          select: { id: true },
        })).id;

    if (psForService) await tx.partyService.update({ where: { id: psForService.id }, data: { partyId: candidateId } });
    if (opsProject) await tx.opsProject.update({ where: { id: opsProject.id }, data: { partyId: candidateId } });
    if (pipeline) await tx.leadPulsePipeline.update({ where: { id: pipeline.id }, data: { partyId: candidateId } });
    await tx.lead.update({ where: { id: lead.id }, data: { partyId: candidateId } });
    for (const x of drafts) await tx.transactionDraft.update({ where: { id: x.id }, data: { partyId: candidateId } });
    for (const x of txns) await tx.transaction.update({ where: { id: x.id }, data: { partyId: candidateId } });

    if (vendorFullyClean) {
      await tx.party.update({
        where: { id: wrongId },
        data: {
          email: CLEAR_VENDOR_CONTACT ? null : VENDOR_EMAIL ?? undefined,
          phone: CLEAR_VENDOR_CONTACT ? null : VENDOR_PHONE ?? undefined,
          sourceId: null,
          assignedL2BdeId: null,
        },
      });
    }

    log(`\n[commit] done — enrollment re-pointed to candidate ${candidateId}.`);
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
