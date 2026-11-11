/**
 * One-off backfill — Qualification from the Meta form answer, for leads that
 * arrived blank before the ingest started copying it.
 *
 * The 10 Nov 2026 backfills filled every blank lead up to that morning. Leads
 * synced since then (until this change deployed) still sit blank even though
 * their "What is your qualification?" answer is in Lead.extra. This fills them
 * with exactly what a newly created lead now gets — see qualificationFromForm
 * in src/lib/crm-form-qualification.ts. Only BLANK leads are touched; a
 * Qualification a BDE set is never overwritten.
 *
 * Each filled lead gets one FIELD_UPDATED timeline entry with no actor (so it
 * is not credited to any BDE) and metadata.backfill = "meta-form-qualification";
 * lastActivityAt is left alone.
 *
 * DRY RUN by default — prints what it would do and writes nothing. Pass
 * `--apply` to perform the writes. Safe to re-run: a filled lead is no longer blank.
 *
 *   npx tsx prisma/backfill-meta-form-qualification.ts            # dry run
 *   npx tsx prisma/backfill-meta-form-qualification.ts --apply    # write
 */
import { prisma } from "../src/lib/prisma";
import { isFormQualificationQuestion, qualificationFromFormAnswer } from "../src/lib/crm-form-qualification";

const APPLY = process.argv.includes("--apply");

async function main() {
  const quals = await prisma.crmQualification.findMany({ where: { active: true }, select: { id: true, label: true } });

  // Blank leads carrying any qualification-ish column; the pure matcher decides.
  const rows = await prisma.$queryRaw<{ id: string; createdAt: Date; key: string; value: string }[]>`
    SELECT l.id, l."createdAt", kv.key, kv.value
    FROM "Lead" l
    CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(l.extra) = 'object' THEN l.extra ELSE '{}'::jsonb END) kv
    WHERE l."qualificationId" IS NULL AND kv.key ILIKE '%qualification%'`;

  const byLead = new Map<string, { createdAt: Date; extra: Record<string, string> }>();
  for (const r of rows) {
    if (!isFormQualificationQuestion(r.key)) continue;
    const l = byLead.get(r.id) ?? { createdAt: r.createdAt, extra: {} };
    l.extra[r.key] = r.value;
    byLead.set(r.id, l);
  }

  const plan: { leadId: string; createdAt: Date; qualId: string; label: string; formKey: string; formAnswer: string }[] = [];
  const unmapped = new Map<string, number>();
  for (const [leadId, l] of byLead) {
    const answers = Object.entries(l.extra).map(([formKey, formAnswer]) => ({
      formKey,
      formAnswer,
      q: qualificationFromFormAnswer(formAnswer, quals),
    }));
    const hit = answers.find((a) => a.q);
    if (hit?.q) {
      plan.push({ leadId, createdAt: l.createdAt, qualId: hit.q.id, label: hit.q.label, formKey: hit.formKey, formAnswer: hit.formAnswer });
      continue;
    }
    for (const a of answers) {
      const k = a.formAnswer.trim().toLowerCase();
      unmapped.set(k, (unmapped.get(k) ?? 0) + 1);
    }
  }

  const byLabel = new Map<string, number>();
  for (const p of plan) byLabel.set(p.label, (byLabel.get(p.label) ?? 0) + 1);
  const byMonth = new Map<string, number>();
  for (const p of plan) {
    const m = p.createdAt.toISOString().slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }

  console.log(APPLY ? "APPLYING" : "DRY RUN — nothing written (pass --apply to write)");
  console.log(`${byLead.size} blank lead(s) answered the qualification question; ${plan.length} map to a qualification.`);
  console.log(`  by qualification: ${JSON.stringify(Object.fromEntries(byLabel))}`);
  console.log(`  by month created: ${JSON.stringify(Object.fromEntries([...byMonth].sort()))}`);
  console.log(`  left blank (answer names no qualification): ${JSON.stringify(Object.fromEntries(unmapped))}`);
  if (!APPLY || plan.length === 0) return;

  let updated = 0;
  for (const [qualId, label] of new Map(plan.map((p) => [p.qualId, p.label]))) {
    const mine = plan.filter((p) => p.qualId === qualId);
    updated += await prisma.$transaction(async (tx) => {
      // Re-checked here: a lead someone filled in meanwhile is left alone.
      const still = await tx.lead.findMany({
        where: { id: { in: mine.map((p) => p.leadId) }, qualificationId: null },
        select: { id: true },
      });
      const ids = new Set(still.map((l) => l.id));
      if (ids.size === 0) return 0;
      await tx.lead.updateMany({ where: { id: { in: [...ids] } }, data: { qualificationId: qualId, qualificationOther: null } });
      await tx.leadActivity.createMany({
        data: mine
          .filter((p) => ids.has(p.leadId))
          .map((p) => ({
            leadId: p.leadId,
            actorId: null,
            type: "FIELD_UPDATED",
            summary: `Qualification filled from the lead form: ${label} ("${p.formAnswer}")`,
            metadata: {
              qualificationId: { from: null, to: qualId },
              backfill: "meta-form-qualification",
              formKey: p.formKey,
              formAnswer: p.formAnswer,
            },
          })),
      });
      return ids.size;
    });
  }
  console.log(`APPLIED — ${updated} lead(s) updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
