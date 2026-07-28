/**
 * READ-ONLY scan — find every enrollment whose Party links point at a Vendor
 * instead of a Candidate (the `findOrCreateParty` group-filter bug; fixed in
 * src/lib/crm-enroll.ts).
 *
 * A vendor party should never own candidate-side records. This lists, per
 * offending vendor party, the Leads / PartyServices / closed_won pipelines /
 * Revenue drafts that wrongly reference it — and prints the LEAD_IDs to feed
 * into prisma/repair-enroll-party-mislink.ts.
 *
 * Writes NOTHING.
 *
 *   npx tsx prisma/scan-vendor-party-mislinks.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  log(`[scan] READ-ONLY — enrollment records linked to group="Vendor" parties.\n`);

  const [leads, partyServices, pipelines, drafts, txns] = await Promise.all([
    prisma.lead.findMany({
      where: { party: { group: "Vendor" } },
      select: { id: true, candidateName: true, serviceId: true, pipelineId: true, party: { select: { id: true, name: true } } },
    }),
    prisma.partyService.findMany({
      where: { party: { group: "Vendor" } },
      select: { id: true, serviceId: true, party: { select: { id: true, name: true } } },
    }),
    prisma.leadPulsePipeline.findMany({
      where: { status: "closed_won", party: { group: "Vendor" } },
      select: { id: true, candidateName: true, party: { select: { id: true, name: true } } },
    }),
    prisma.transactionDraft.findMany({
      where: { type: "Revenue", party: { group: "Vendor" } },
      select: { id: true, description: true, amount: true, party: { select: { id: true, name: true } } },
    }),
    prisma.transaction.findMany({
      where: { type: "Revenue", party: { group: "Vendor" } },
      select: { id: true, description: true, amount: true, party: { select: { id: true, name: true } } },
    }),
  ]);

  // Group everything by the offending vendor party.
  type Bucket = {
    name: string;
    leads: typeof leads;
    partyServices: typeof partyServices;
    pipelines: typeof pipelines;
    drafts: typeof drafts;
    txns: typeof txns;
  };
  const byVendor = new Map<string, Bucket>();
  const bucket = (id: string, name: string) => {
    let b = byVendor.get(id);
    if (!b) { b = { name, leads: [], partyServices: [], pipelines: [], drafts: [], txns: [] }; byVendor.set(id, b); }
    return b;
  };
  for (const x of leads) if (x.party) bucket(x.party.id, x.party.name).leads.push(x);
  for (const x of partyServices) if (x.party) bucket(x.party.id, x.party.name).partyServices.push(x);
  for (const x of pipelines) if (x.party) bucket(x.party.id, x.party.name).pipelines.push(x);
  for (const x of drafts) if (x.party) bucket(x.party.id, x.party.name).drafts.push(x);
  for (const x of txns) if (x.party) bucket(x.party.id, x.party.name).txns.push(x);

  if (byVendor.size === 0) {
    log(`[scan] ✅ nothing found — no enrollment records point at a Vendor party.`);
    return;
  }

  const repairLeadIds: string[] = [];
  log(`[scan] ${byVendor.size} vendor part${byVendor.size === 1 ? "y" : "ies"} with candidate-side links:\n`);
  for (const [vid, b] of byVendor) {
    log(`── vendor "${b.name}" (${vid})`);
    for (const l of b.leads) { log(`    Lead ${l.id}  candidate="${l.candidateName}"  serviceId=${l.serviceId ?? "—"}`); repairLeadIds.push(l.id); }
    for (const p of b.partyServices) log(`    PartyService ${p.id}  serviceId=${p.serviceId}`);
    for (const p of b.pipelines) log(`    Pipeline(closed_won) ${p.id}  candidate="${p.candidateName}"`);
    for (const x of b.drafts) log(`    RevenueDraft ${x.id}  ₹${x.amount}  "${x.description ?? ""}"`);
    for (const x of b.txns) log(`    RevenueTxn ${x.id}  ₹${x.amount}  "${x.description ?? ""}"  ⚠ posted`);
    log("");
  }

  const uniqueLeadIds = [...new Set(repairLeadIds)];
  log(`[scan] ${uniqueLeadIds.length} lead(s) to repair. Run per lead:`);
  for (const id of uniqueLeadIds) log(`    LEAD_ID=${id} VENDOR_EMAIL=… VENDOR_PHONE=… COMMIT=1 npx tsx prisma/repair-enroll-party-mislink.ts`);
  log(`\n[scan] Note: any vendor with candidate-side links but NO Lead row (e.g. only a`);
  log(`       PartyService / draft) needs manual review — there's no lead to drive the repair.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
