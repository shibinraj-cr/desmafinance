import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { CANDIDATE_IMPORT_ROWS } from "@/lib/import-candidates-data";

export const dynamic = "force-dynamic";
// Generous timeout since we batch ~100 candidates + their services.
export const maxDuration = 60;

/**
 * Admin-only one-shot endpoint that imports the bundled
 * `Candidate list.xlsx` (snapshotted into `import-candidates-data.ts`)
 * into the Party / PartyService tables.
 *
 * Behaviour:
 *  - Groups rows by candidate name (after trim + whitespace collapse).
 *  - For each candidate: upserts a Party row with group='Candidate'.
 *    Existing parties are matched by name and their scalar fields are
 *    left untouched (so any source/email/phone you've already filled
 *    in is preserved). New parties land with sourceId=null — the
 *    user will fill in source manually per the prior discussion.
 *  - For each candidate's services: **replaces** the candidate's
 *    PartyService set with the Excel set. This is the "overwrite"
 *    semantics the user asked for. totalAmount = Excel value, or 0
 *    when missing.
 *  - Services missing from the Service master are created on the fly
 *    (so e.g. "GCAN" and "Attestation" don't block the import).
 *
 * Idempotent: re-running with the same data is a no-op.
 */
export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  const log: string[] = [];

  // Group rows by candidate name. Multiple rows with the same name in
  // the Excel = same candidate enrolled in multiple services.
  const byCandidate = new Map<string, Array<{ service: string; totalAmount: number }>>();
  for (const row of CANDIDATE_IMPORT_ROWS) {
    const key = row.name.trim().replace(/\s+/g, " ");
    if (!key) continue;
    let bucket = byCandidate.get(key);
    if (!bucket) {
      bucket = [];
      byCandidate.set(key, bucket);
    }
    // Deduplicate when the SAME service appears twice for the SAME
    // candidate: take the larger totalAmount so we don't lose info.
    const existing = bucket.find((b) => b.service === row.service);
    if (existing) {
      existing.totalAmount = Math.max(existing.totalAmount, row.totalAmount);
    } else {
      bucket.push({ service: row.service, totalAmount: row.totalAmount });
    }
  }

  // Service-name alias map (Excel label → Service master canonical name).
  const SERVICE_ALIAS: Record<string, string> = {
    "PTE Registration": "PTE Coaching",
    "Study Abroad Registration": "Study Abroad - Registration Fee",
    "Attestation Charge": "Attestation",
  };

  function canonicalServiceName(excelName: string): string {
    return SERVICE_ALIAS[excelName] ?? excelName;
  }

  // Resolve / create every distinct service up-front so we can map
  // names → ids in the candidate loop without re-querying.
  const allServiceNames = new Set<string>();
  for (const services of byCandidate.values()) {
    for (const s of services) allServiceNames.add(canonicalServiceName(s.service));
  }
  const serviceIdByName = new Map<string, string>();
  let servicesCreated = 0;
  for (const name of allServiceNames) {
    const existing = await prisma.service.findUnique({ where: { name } });
    if (existing) {
      serviceIdByName.set(name, existing.id);
      continue;
    }
    const created = await prisma.service.create({
      data: { name, isActive: true },
    });
    serviceIdByName.set(name, created.id);
    servicesCreated++;
    log.push(`+ Service created: ${name}`);
  }

  let partiesCreated = 0;
  let partiesUpdated = 0;
  let partyServicesCreated = 0;
  let partyServicesReplaced = 0;

  for (const [name, services] of byCandidate) {
    let party = await prisma.party.findUnique({ where: { name } });
    if (party) {
      partiesUpdated++;
      // Don't mutate scalar fields on an existing party — preserve any
      // sourceId / email / phone the user has already set.
    } else {
      party = await prisma.party.create({
        data: {
          name,
          group: "Candidate",
          txTypes: "Both",
          isActive: true,
          // sourceId left null — DB column is nullable; UI form will
          // require it for new edits but the import skips that gate.
        },
      });
      partiesCreated++;
      log.push(`+ Party created: ${name}`);
    }

    // Overwrite semantics: drop existing PartyService rows that aren't
    // in the new set, then upsert each from the Excel.
    const wantedServiceIds = new Set(
      services.map((s) => serviceIdByName.get(canonicalServiceName(s.service))!),
    );
    const existing = await prisma.partyService.findMany({
      where: { partyId: party.id },
    });
    const toRemove = existing.filter((e) => !wantedServiceIds.has(e.serviceId));
    if (toRemove.length > 0) {
      await prisma.partyService.deleteMany({
        where: { id: { in: toRemove.map((r) => r.id) } },
      });
      partyServicesReplaced += toRemove.length;
    }
    for (const s of services) {
      const serviceId = serviceIdByName.get(canonicalServiceName(s.service))!;
      await prisma.partyService.upsert({
        where: { partyId_serviceId: { partyId: party.id, serviceId } },
        create: { partyId: party.id, serviceId, totalAmount: s.totalAmount },
        update: { totalAmount: s.totalAmount },
      });
      partyServicesCreated++;
    }
  }

  const summary = {
    candidatesInSheet: byCandidate.size,
    partiesCreated,
    partiesUpdated,
    servicesCreated,
    partyServicesUpserted: partyServicesCreated,
    partyServicesRemovedDuringOverwrite: partyServicesReplaced,
  };

  await recordAudit({
    entityType: "Party",
    entityId: "__candidate_bulk_import__",
    action: "UPDATE",
    userId,
    changes: { kind: "candidate_bulk_import", ...summary },
  });

  return NextResponse.json({ ok: true, summary, log });
}
