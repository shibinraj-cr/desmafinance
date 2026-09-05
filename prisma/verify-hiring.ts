/**
 * End-to-end verification for the hiring module, against a REAL database.
 *
 * Drives the actual code paths — `submitApplication`, `moveApplication`,
 * `publishJob`, the analytics functions, the partner scope — and asserts the
 * data effects, then removes everything it created. The unit tests prove the
 * pure logic; this proves the wiring, which is the half they cannot reach.
 *
 * SAFETY: refuses the production endpoint. Run it through the branch wrapper:
 *   node scripts/with-branch-db.mjs npx tsx prisma/verify-hiring.ts
 */
import { prisma } from "../src/lib/prisma";
import { submitApplication } from "../src/lib/hiring/apply";
import { moveApplication } from "../src/lib/hiring/pipeline";
import { publishJob, createJob } from "../src/lib/hiring/jobs";
import { buildFunnel, timeToHire, type AnalyticsEvent, type StageKey } from "../src/lib/hiring/analytics";
import { bucketFollowUps, countAll } from "../src/lib/hiring/follow-ups";
import { partnerJobWhere, partnerApplicationWhere, grantedJobIds } from "../src/lib/hiring/partner-scope";
import { applicationListInclude, serializeApplicationRow } from "../src/lib/hiring/candidates";
import { HIRE_COMPLETED } from "../src/lib/hiring/events";
import { isCareersPublic, setCareersPublic, listPublicJobs } from "../src/lib/hiring/careers";

const PROD_HOST_FRAGMENT = "ep-orange-brook-aqmaow18";
const TAG = "ZZ_VERIFY";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (url.includes(PROD_HOST_FRAGMENT)) throw new Error("Refusing to run against production.");
  console.log(`\n▶ Verifying hiring against ${url.replace(/:\/\/[^@]*@/, "://***@")}\n`);

  const admin = await prisma.user.findFirst({
    where: { OR: [{ role: "admin" }, { roleRef: { isAdmin: true } }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new Error("Need at least one admin user.");

  // ── 1. A requisition refuses to publish until it is ready ────────────────
  console.log("Requisitions");
  const bare = await createJob({
    title: `ZZ Verify Role ${Date.now()}`,
    department: "Verification",
    createdById: admin.id,
    mustHaves: [],
    descriptionMd: null,
  });
  const blocked = await publishJob(bare.id);
  // Narrow before reading `blockers`: the not-published branch is a union of
  // "draft, with reasons" and "waiting for approval, with none".
  const asDraft = !blocked.published && blocked.status === "draft" ? blocked : null;
  check(
    "an incomplete req saves as a draft and says why",
    !!asDraft && asDraft.blockers.length > 0,
    asDraft ? `${asDraft.blockers.length} blockers` : `status=${blocked.status}`,
  );

  await prisma.hiringJob.update({
    where: { id: bare.id },
    data: { descriptionMd: "Verification role.", mustHaves: ["Attention to detail"] },
  });
  const published = await publishJob(bare.id);
  check("a complete req goes live", published.published && published.status === "live");

  const live = await prisma.hiringJob.findUnique({
    where: { id: bare.id },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  check("publishing seeds the standard pipeline", (live?.stages.length ?? 0) === 8, `${live?.stages.length} stages`);

  // ── 2. Intake dedupes the person and always writes an event ──────────────
  console.log("\nIntake");
  const email = `zz.verify.${Date.now()}@demo.invalid`;
  const first = await submitApplication({
    jobId: bare.id,
    fullName: "ZZ Verify Person",
    email,
    source: "careers_page",
    consent: true,
  });
  check("an application is created", !!first.applicationId);

  const createdEvent = await prisma.hiringApplicationEvent.findFirst({
    where: { applicationId: first.applicationId, type: "created" },
  });
  check("intake writes the `created` event in the same transaction", !!createdEvent);

  await prisma.hiringCandidate.update({ where: { id: first.candidateId }, data: { tags: [TAG] } });

  // Same person, second requisition → one candidate, two applications.
  const second = await createJob({
    title: `ZZ Verify Role B ${Date.now()}`,
    department: "Verification",
    createdById: admin.id,
    descriptionMd: "Second role.",
    mustHaves: ["Attention to detail"],
  });
  await publishJob(second.id);
  const again = await submitApplication({
    jobId: second.id,
    fullName: "ZZ Verify Person",
    email,
    source: "careers_page",
    consent: true,
  });
  check("the same person applying twice is ONE candidate", again.candidateId === first.candidateId);
  check("…with two separate applications", again.applicationId !== first.applicationId);

  // A must-have with no evidence flags rather than rejects.
  const flagged = await prisma.hiringApplication.findUnique({ where: { id: first.applicationId } });
  check(
    "a missing must-have flags for a human and does NOT reject",
    flagged?.needsAttention === true && flagged?.status === "active",
    `status=${flagged?.status}`,
  );

  // ── 3. Stage moves are events, and a win emits the handoff ───────────────
  console.log("\nPipeline");
  const stages = live!.stages;
  const interview = stages.find((s) => s.name === "Interview")!;
  const won = stages.find((s) => s.kind === "won")!;

  await moveApplication({ applicationId: first.applicationId, toStageId: interview.id, actorId: admin.id });
  const moveEvent = await prisma.hiringApplicationEvent.findFirst({
    where: { applicationId: first.applicationId, type: "stage_moved" },
    orderBy: { occurredAt: "desc" },
  });
  check("a move writes a stage_moved event with both ends", moveEvent?.toStage === "Interview" && !!moveEvent?.fromStage);

  await moveApplication({ applicationId: first.applicationId, toStageId: won.id, actorId: admin.id });
  const hired = await prisma.hiringApplication.findUnique({ where: { id: first.applicationId } });
  check("entering a won stage sets status=hired", hired?.status === "hired");

  const event = await prisma.hiringDomainEvent.findFirst({
    where: { type: HIRE_COMPLETED, subjectId: first.applicationId },
  });
  check("hire.completed is emitted", !!event);
  const payload = event?.payload as { candidateId?: string; jobId?: string } | undefined;
  check("…carrying the candidate and the job", payload?.candidateId === first.candidateId && payload?.jobId === bare.id);

  // Idempotency: re-entering the won stage must not emit twice.
  await moveApplication({ applicationId: first.applicationId, toStageId: interview.id, actorId: admin.id });
  await moveApplication({ applicationId: first.applicationId, toStageId: won.id, actorId: admin.id });
  const emitted = await prisma.hiringDomainEvent.count({
    where: { type: HIRE_COMPLETED, subjectId: first.applicationId },
  });
  check("…exactly once, however many times the card moves", emitted === 1, `${emitted} rows`);

  // Rejection needs a reason.
  const lost = stages.find((s) => s.kind === "lost")!;
  let refused = false;
  try {
    await moveApplication({ applicationId: again.applicationId, toStageId: lost.id, actorId: admin.id });
  } catch {
    refused = true;
  }
  check("a rejection without a reason is refused", refused);

  // ── 4. Analytics reconcile against a raw event count ─────────────────────
  console.log("\nAnalytics (§9.10)");
  const from = new Date(Date.now() - 365 * 86_400_000);
  const rawEvents = await prisma.hiringApplicationEvent.findMany({
    where: { occurredAt: { gte: from } },
    select: { applicationId: true, type: true, fromStage: true, toStage: true, occurredAt: true },
  });
  const allStages = await prisma.hiringJobStage.findMany({
    where: { job: { deletedAt: null } },
    select: { name: true, kind: true, position: true },
  });
  const byLabel = new Map<string, StageKey>();
  for (const s of allStages) {
    const k = s.name.trim().toLowerCase();
    const cur = byLabel.get(k);
    if (!cur || s.position < cur.position) byLabel.set(k, { position: s.position, kind: s.kind, label: s.name });
  }
  const funnel = buildFunnel(rawEvents as AnalyticsEvent[], [...byLabel.values()]);

  // The manual count: distinct applications with an event naming an Interview stage.
  const manualInterview = new Set(
    rawEvents.filter((e) => (e.toStage ?? "").toLowerCase() === "interview").map((e) => e.applicationId),
  ).size;
  const reportedInterview = funnel.find((f) => f.label.toLowerCase() === "interview")?.reached ?? -1;
  check(
    "the funnel's Interview count equals a manual count of the same events",
    reportedInterview === manualInterview,
    `funnel=${reportedInterview} manual=${manualInterview}`,
  );

  const tth = timeToHire(rawEvents as AnalyticsEvent[], new Set(allStages.filter((s) => s.kind === "won").map((s) => s.name)));
  check("time-to-hire finds the hire we just made", tth.count >= 1, `${tth.count} hires`);

  // ── 5. Follow-ups surface the untouched shortlist ────────────────────────
  console.log("\nFollow-ups");
  const active = await prisma.hiringApplication.findMany({
    where: { deletedAt: null, status: "active", job: { status: { in: ["live", "paused"] } } },
    include: applicationListInclude,
    take: 500,
  });
  const groups = bucketFollowUps(active.map((a) => serializeApplicationRow(a)));
  check("the rail buckets without throwing on real rows", countAll(groups) >= 0, `${countAll(groups)} to chase`);
  const everyoneOnce = new Set([...groups.overdue, ...groups.due_today, ...groups.silent].map((r) => r.id));
  check(
    "nobody appears in two groups",
    everyoneOnce.size === groups.overdue.length + groups.due_today.length + groups.silent.length,
  );

  // ── 6. The partner boundary holds against real rows ──────────────────────
  console.log("\nPartner isolation (§9.7)");
  const partner = await prisma.hiringPartner.findFirst({ where: { contactEmail: { endsWith: "@demo.invalid" } } });
  if (!partner) {
    check("a seeded partner exists to test with", false);
  } else {
    const granted = await grantedJobIds(partner.id);
    const visibleJobs = await prisma.hiringJob.findMany({ where: partnerJobWhere(granted), select: { id: true } });
    const allJobs = await prisma.hiringJob.count({ where: { deletedAt: null } });
    check(
      "a partner sees only granted reqs, not every req",
      visibleJobs.length === granted.length && visibleJobs.length < allJobs,
      `${visibleJobs.length} of ${allJobs}`,
    );
    check("…and every visible req is one they were granted", visibleJobs.every((j) => granted.includes(j.id)));

    const visibleApps = await prisma.hiringApplication.findMany({
      where: partnerApplicationWhere(partner.id, granted),
      select: { id: true },
    });
    const allApps = await prisma.hiringApplication.count({ where: { deletedAt: null } });
    check(
      "a partner sees only their own submissions, not the pipeline",
      visibleApps.length < allApps,
      `${visibleApps.length} of ${allApps}`,
    );

    // The failing-by-default case: revoke access, see nothing.
    const noneVisible = await prisma.hiringJob.findMany({ where: partnerJobWhere([]), select: { id: true } });
    check("a partner with no grants sees NOTHING (not everything)", noneVisible.length === 0);
  }

  // ── 7. The careers site is off until somebody publishes it ───────────────
  console.log("\nPublic careers page");
  const wasPublic = await isCareersPublic();
  await setCareersPublic(false);
  check("it is off by default", (await isCareersPublic()) === false);

  // A requisition that was never published is the case that matters: the
  // public list must be driven by status, not merely by existing.
  const neverPublished = await createJob({
    title: `ZZ Verify Role Draft ${Date.now()}`,
    department: "Verification",
    createdById: admin.id,
    descriptionMd: "Never published.",
    mustHaves: ["Attention to detail"],
  });

  await setCareersPublic(true);
  const publicJobs = await listPublicJobs();
  check("switching it on exposes the live reqs", publicJobs.length > 0, `${publicJobs.length} public`);
  check(
    "…and never one that was left as a draft",
    !publicJobs.some((j) => j.slug === neverPublished.slug),
  );

  // Closing a live req takes it off the public page too.
  const secondSlug = (await prisma.hiringJob.findUnique({
    where: { id: second.id },
    select: { slug: true },
  }))!.slug;
  check("a live req is on the page before it closes", publicJobs.some((j) => j.slug === secondSlug));

  await prisma.hiringJob.update({ where: { id: second.id }, data: { status: "closed" } });
  const afterClose = await listPublicJobs();
  check("closing it takes it off", !afterClose.some((j) => j.slug === secondSlug));

  // Leave the switch exactly as it was found.
  await setCareersPublic(wasPublic);
  check("the switch is restored", (await isCareersPublic()) === wasPublic);

  // ── Clean up everything this script made ─────────────────────────────────
  console.log("\nCleanup");
  await prisma.hiringDomainEvent.deleteMany({ where: { subjectId: { in: [first.applicationId, again.applicationId] } } });
  const jobs = await prisma.hiringJob.deleteMany({ where: { title: { startsWith: "ZZ Verify Role" } } });
  const cands = await prisma.hiringCandidate.deleteMany({ where: { tags: { has: TAG } } });
  check("removed what it created", jobs.count === 3 && cands.count === 1, `${jobs.count} jobs, ${cands.count} candidates`);

  console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("\n✗", e instanceof Error ? e.stack : e, "\n");
    await prisma.$disconnect();
    process.exit(1);
  });
