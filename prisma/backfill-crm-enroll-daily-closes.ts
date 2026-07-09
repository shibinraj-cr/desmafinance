/**
 * One-off backfill — repair CRM enrollments recorded BEFORE the enroll→daily-close fix.
 *
 * Those enrollments flipped their mirrored LeadPulsePipeline to `closed_won`
 * (so the "already closed" revenue shows) but never wrote a LeadPulseDailyClose,
 * so the "Actual" count on the Lead Pulse Pipeline Forecast under-counts them.
 * The tell-tale of such a row is `status = "closed_won"` with `dailyCloseId = null`
 * (the manual pipeline-status route ALWAYS links a close, so a null link means the
 * pipeline was closed via CRM Enroll before the fix).
 *
 * This creates ONLY the missing daily-close rows (via the same `syncDailyClose`
 * the live enroll flow now uses) and links them back — purely additive. No
 * existing row is edited, moved, or deleted.
 *
 * Scope: the CURRENT calendar month by default (honouring "do not change old
 * data" — nothing outside the target month is touched). Override with
 * `--month=YYYY-MM` for a specific month.
 *
 * DRY RUN by default — prints what it would do and writes nothing. Pass `--apply`
 * to perform the writes.
 *
 *   npx tsx prisma/backfill-crm-enroll-daily-closes.ts            # dry run, current month
 *   npx tsx prisma/backfill-crm-enroll-daily-closes.ts --month=2026-07
 *   npx tsx prisma/backfill-crm-enroll-daily-closes.ts --apply    # write
 */
import { prisma } from "../src/lib/prisma";
import { syncDailyClose } from "../src/lib/crm-enroll";
import { fromPrismaDate } from "../src/lib/lead-pulse-dates";

const APPLY = process.argv.includes("--apply");
const monthArg = process.argv.find((a) => a.startsWith("--month="))?.split("=")[1];

function monthBounds(ym?: string): { start: Date; end: Date; label: string } {
  let y: number;
  let m: number; // 0-based
  if (ym && /^\d{4}-\d{2}$/.test(ym)) {
    y = Number(ym.slice(0, 4));
    m = Number(ym.slice(5, 7)) - 1;
  } else {
    const now = new Date();
    y = now.getUTCFullYear();
    m = now.getUTCMonth();
  }
  return {
    start: new Date(Date.UTC(y, m, 1)),
    end: new Date(Date.UTC(y, m + 1, 1)),
    label: `${y}-${String(m + 1).padStart(2, "0")}`,
  };
}

async function main() {
  const { start, end, label } = monthBounds(monthArg);
  console.log(`\nBackfill CRM-enroll daily closes — month ${label} — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);

  const pipelines = await prisma.leadPulsePipeline.findMany({
    where: {
      status: "closed_won",
      dailyCloseId: null,
      closedDate: { gte: start, lt: end },
    },
    select: {
      id: true,
      userId: true,
      sourceId: true,
      serviceId: true,
      closedDate: true,
      candidateName: true,
      user: { select: { username: true } },
      service: { select: { name: true } },
    },
    orderBy: { closedDate: "asc" },
  });

  console.log(`Found ${pipelines.length} closed_won pipeline(s) with no linked daily close in ${label}.\n`);

  let wrote = 0;
  let skipped = 0;
  for (const p of pipelines) {
    const who = p.user?.username ?? p.userId;
    const svc = p.service?.name ?? p.serviceId ?? "(no service)";
    const day = p.closedDate ? fromPrismaDate(p.closedDate) : "(no date)";
    if (!p.serviceId || !p.sourceId || !p.closedDate) {
      console.log(`  SKIP   ${p.candidateName} · ${who} — missing serviceId/sourceId/closedDate`);
      skipped++;
      continue;
    }
    console.log(`  ${APPLY ? "WRITE " : "would "} ${p.candidateName} · ${who} · ${svc} · ${day}`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        const closeId = await syncDailyClose(
          tx,
          { userId: p.userId, sourceId: p.sourceId!, serviceId: p.serviceId! },
          p.closedDate!,
        );
        await tx.leadPulsePipeline.update({ where: { id: p.id }, data: { dailyCloseId: closeId } });
      });
    }
    wrote++;
  }

  console.log(`\n${APPLY ? "Wrote" : "Would write"} ${wrote} daily close(s); skipped ${skipped}.`);
  if (!APPLY && wrote > 0) console.log("Re-run with --apply to write these rows.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
