/**
 * READ-ONLY audit: CRM lead deal/enrollment vs Marketing (LeadPulsePipeline).
 * Performs NO writes. Reports drift between the two modules.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "—");
const n = (x: unknown) => (x == null ? 0 : Number(x));

async function main() {
  const statuses = await prisma.crmLeadStatus.findMany({ select: { id: true, code: true, label: true } });
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const enrolledIds = statuses.filter((s) => s.code === "enrolled").map((s) => s.id);

  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { expectedCloseDate: { not: null } },
        { expectedValue: { not: null } },
        { pipelineId: { not: null } },
        { statusId: { in: enrolledIds } },
      ],
    },
    select: {
      id: true,
      candidateName: true,
      statusId: true,
      serviceId: true,
      assignedToId: true,
      expectedValue: true,
      expectedCloseDate: true,
      pipelineId: true,
      createdAt: true,
      pipeline: {
        select: {
          id: true,
          userId: true,
          status: true,
          serviceId: true,
          expectedCloseDate: true,
          expectedFirstInstallment: true,
          closedDate: true,
          dailyCloseId: true,
        },
      },
    },
  });

  console.log(`\nLeads in scope (have a deal, a pipeline link, or Enrolled): ${leads.length}\n`);

  const isEnrolled = (l: (typeof leads)[number]) => byId.get(l.statusId)?.code === "enrolled";

  // 1. Deal set in CRM but no pipeline row at all → invisible to Marketing.
  const dealNoPipeline = leads.filter((l) => (l.expectedCloseDate || l.expectedValue) && !l.pipelineId);
  // 1b. pipelineId set but the row is gone (deleted in Marketing).
  const danglingPipeline = leads.filter((l) => l.pipelineId && !l.pipeline);

  // 2. Expected close date drift between the two modules.
  const dateDrift = leads.filter(
    (l) => l.pipeline && d(l.expectedCloseDate) !== d(l.pipeline.expectedCloseDate),
  );
  // 3. Expected value drift.
  const valueDrift = leads.filter(
    (l) => l.pipeline && Math.abs(n(l.expectedValue) - n(l.pipeline.expectedFirstInstallment)) > 0.005,
  );
  // 3b. Service drift.
  const serviceDrift = leads.filter((l) => l.pipeline && l.serviceId && l.serviceId !== l.pipeline.serviceId);

  // 4. Enrolled in CRM but no pipeline row → never shows as Won in Marketing.
  const enrolledNoPipeline = leads.filter((l) => isEnrolled(l) && !l.pipeline);
  // 5. Enrolled in CRM but pipeline still open / lost.
  const enrolledNotWon = leads.filter((l) => isEnrolled(l) && l.pipeline && l.pipeline.status !== "closed_won");
  // 6. Won pipeline with no LeadPulseDailyClose → missing from Actual / Targets matrix.
  const wonNoDailyClose = leads.filter(
    (l) => l.pipeline?.status === "closed_won" && !l.pipeline.dailyCloseId,
  );
  // 7. Reverse: Marketing says won, CRM lead is not Enrolled.
  const wonNotEnrolled = leads.filter((l) => l.pipeline?.status === "closed_won" && !isEnrolled(l));
  // 8. Owner drift: pipeline owner ≠ lead assignee.
  const ownerDrift = leads.filter(
    (l) => l.pipeline && l.assignedToId && l.pipeline.userId !== l.assignedToId,
  );

  const section = (title: string, rows: typeof leads, extra?: (l: (typeof leads)[number]) => string) => {
    console.log(`${"─".repeat(78)}\n${title}: ${rows.length}`);
    for (const l of rows.slice(0, 12)) {
      const st = byId.get(l.statusId)?.label ?? "?";
      console.log(
        `   ${l.id.slice(0, 8)}  [${st}]  lead:${d(l.expectedCloseDate)}/₹${n(l.expectedValue)}` +
          (l.pipeline
            ? `  pipe:${d(l.pipeline.expectedCloseDate)}/₹${n(l.pipeline.expectedFirstInstallment)}/${l.pipeline.status}`
            : `  pipe:none`) +
          (extra ? `  ${extra(l)}` : ""),
      );
    }
    if (rows.length > 12) console.log(`   … +${rows.length - 12} more`);
  };

  section("A. CRM deal set but NO marketing pipeline row (invisible to forecast)", dealNoPipeline);
  section("A2. lead.pipelineId points at a deleted pipeline row", danglingPipeline);
  section("B. Expected CLOSE DATE differs between CRM lead and marketing pipeline", dateDrift);
  section("C. Expected VALUE differs between CRM lead and marketing pipeline", valueDrift);
  section("C2. SERVICE differs between CRM lead and marketing pipeline", serviceDrift);
  section("D. Enrolled in CRM but NO pipeline row (never shows as Won)", enrolledNoPipeline);
  section("E. Enrolled in CRM but pipeline NOT closed_won", enrolledNotWon, (l) => `pipeStatus=${l.pipeline?.status}`);
  section("F. Pipeline closed_won but NO LeadPulseDailyClose (missing from Actual/Targets)", wonNoDailyClose);
  section("G. Marketing shows Won but CRM lead is NOT Enrolled", wonNotEnrolled);
  section("H. Pipeline owner ≠ lead assignee (attribution drift)", ownerDrift);

  // Standalone marketing pipeline rows with no CRM lead behind them.
  const totalPipe = await prisma.leadPulsePipeline.count();
  const linkedPipe = await prisma.leadPulsePipeline.count({ where: { leadLink: { isNot: null } } });
  const wonPipe = await prisma.leadPulsePipeline.count({ where: { status: "closed_won" } });
  const wonUnlinked = await prisma.leadPulsePipeline.count({
    where: { status: "closed_won", leadLink: null },
  });
  const wonNoClose = await prisma.leadPulsePipeline.count({
    where: { status: "closed_won", dailyCloseId: null },
  });
  const openPipe = await prisma.leadPulsePipeline.count({ where: { status: "open" } });
  const lostPipe = await prisma.leadPulsePipeline.count({ where: { status: "lost" } });
  const totalCloses = await prisma.leadPulseDailyClose.count();
  const enrolledTotal = await prisma.lead.count({ where: { statusId: { in: enrolledIds } } });

  console.log(`\n${"═".repeat(78)}\nTOTALS`);
  console.log(`  LeadPulsePipeline rows          : ${totalPipe}  (open ${openPipe} / won ${wonPipe} / lost ${lostPipe})`);
  console.log(`  …linked to a CRM lead           : ${linkedPipe}   (unlinked ${totalPipe - linkedPipe})`);
  console.log(`  Won rows with NO CRM lead behind: ${wonUnlinked}`);
  console.log(`  Won rows with NO daily close    : ${wonNoClose}`);
  console.log(`  LeadPulseDailyClose rows total  : ${totalCloses}`);
  console.log(`  CRM leads with status Enrolled  : ${enrolledTotal}`);

  // Month-by-month: enrolled-in-CRM vs won-in-marketing, last 6 months.
  console.log(`\n${"═".repeat(78)}\nPER-MONTH: CRM enrollments vs Marketing wons vs daily closes`);
  const wonRows = await prisma.leadPulsePipeline.findMany({
    where: { status: "closed_won" },
    select: { closedDate: true, leadLink: { select: { id: true, statusId: true } } },
  });
  const closes = await prisma.leadPulseDailyClose.findMany({
    select: { entry: { select: { entryDate: true } } },
  });
  const key = (x: Date | null) => (x ? x.toISOString().slice(0, 7) : "null");
  const months = new Map<string, { won: number; wonLinked: number; closes: number }>();
  const get = (k: string) => {
    let m = months.get(k);
    if (!m) months.set(k, (m = { won: 0, wonLinked: 0, closes: 0 }));
    return m;
  };
  for (const r of wonRows) {
    const m = get(key(r.closedDate));
    m.won++;
    if (r.leadLink) m.wonLinked++;
  }
  for (const c of closes) get(key(c.entry.entryDate)).closes++;
  console.log(`  month     wonPipeline  ofWhichLinked  dailyCloses`);
  for (const k of [...months.keys()].sort()) {
    const m = months.get(k)!;
    console.log(`  ${k.padEnd(9)} ${String(m.won).padStart(6)}       ${String(m.wonLinked).padStart(6)}       ${String(m.closes).padStart(6)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
