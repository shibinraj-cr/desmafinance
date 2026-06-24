/**
 * Backfill operations projects for already-enrolled candidates — every
 * PartyService that predates the Operations module (or was enrolled while its
 * service had no template) and therefore has no OpsProject yet.
 *
 * Idempotent: keyed 1:1 on PartyService, so re-running never duplicates. Skips
 * candidate-services whose service still has no active template.
 *
 *   npm run db:backfill-ops-projects            (apply)
 *   npm run db:backfill-ops-projects -- --dry-run
 */
import { PrismaClient } from "@prisma/client";
import { getActiveTemplateForService } from "../src/lib/ops-templates";
import { createProjectForEnrollment, resolveDefaultOpsAssignee } from "../src/lib/ops-projects";
import { loadHolidaySet } from "../src/lib/ops-dates";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry-run");

type Template = Awaited<ReturnType<typeof getActiveTemplateForService>>;

async function main() {
  const holidays = await loadHolidaySet(prisma);
  const assigneeId = await resolveDefaultOpsAssignee(prisma);

  const partyServices = await prisma.partyService.findMany({
    where: { opsProject: null },
    select: { id: true, partyId: true, serviceId: true },
  });
  console.log(`${partyServices.length} PartyService rows without an operations project${DRY ? " (dry-run)" : ""}\n`);

  const templateCache = new Map<string, Template>();
  let created = 0;
  let skippedNoTemplate = 0;

  for (const ps of partyServices) {
    let template = templateCache.get(ps.serviceId);
    if (template === undefined) {
      template = await getActiveTemplateForService(prisma, ps.serviceId);
      templateCache.set(ps.serviceId, template);
    }
    if (!template) {
      skippedNoTemplate++;
      continue;
    }
    // Provenance: the enrolled lead for this (party, service), if any.
    const lead = await prisma.lead.findFirst({
      where: { partyId: ps.partyId, serviceId: ps.serviceId },
      select: { id: true },
    });

    if (DRY) {
      created++;
      continue;
    }

    const res = await prisma.$transaction((tx) =>
      createProjectForEnrollment(tx, {
        partyServiceId: ps.id,
        partyId: ps.partyId,
        serviceId: ps.serviceId,
        leadId: lead?.id ?? null,
        actorId: null,
        template,
        holidays,
        assigneeId,
      }),
    );
    if (res?.created) created++;
  }

  console.log(
    `${DRY ? "[dry-run] would create" : "created"} ${created} projects; ${skippedNoTemplate} skipped (service has no active template).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
