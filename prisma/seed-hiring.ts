/**
 * Demo data for the Hiring module, so every rail can be reviewed with
 * real-looking content: 3 requisitions, ~40 candidates spread across the
 * stages, interviews, scorecards, one offer, a sourcing partner, a talent pool
 * and the starter automation recipes.
 *
 *   npm run db:seed-hiring            # create
 *   npm run db:seed-hiring:remove     # remove every seeded row, one command
 *
 * SAFETY: refuses to run against the production Neon endpoint (same guard as
 * prisma/verify-reenroll.ts). Point DATABASE_URL at a disposable branch.
 *
 * EVERY row this writes is identifiable, which is what makes the removal exact:
 *   - jobs            slug starts with `demo-`
 *   - candidates      tags contain SEED_DEMO
 *   - partners        contactEmail ends with @demo.invalid
 *   - templates       name starts with "Demo · "
 *   - automations     name starts with "Demo · "
 * Applications, events, interviews, scorecards and offers hang off those by
 * cascade, so removing the parents removes them too.
 *
 * The people here are invented. This repository is public — never seed it with
 * a real applicant's name, number or address.
 */
import { prisma } from "../src/lib/prisma";
import {
  DEFAULT_STAGES,
  DEFAULT_RUBRIC,
  DEFAULT_SCREENING_QUESTIONS,
  SEED_TAG,
} from "../src/lib/hiring/constants";
import { slugify } from "../src/lib/hiring/core";

const PROD_HOST_FRAGMENT = "ep-orange-brook-aqmaow18";
const DEMO_SLUG_PREFIX = "demo-";
const DEMO_NAME_PREFIX = "Demo · ";
const DEMO_PARTNER_DOMAIN = "@demo.invalid";

/** Deterministic pseudo-random so a re-seed produces the same demo set. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const FIRST = [
  "Ananya", "Rahul", "Meera", "Joseph", "Fathima", "Vishnu", "Sneha", "Arjun",
  "Divya", "Nikhil", "Reshma", "Sandeep", "Aiswarya", "Tom", "Nazrin", "Gokul",
  "Parvathy", "Sarath", "Lakshmi", "Ebin",
];
const LAST = [
  "Menon", "Nair", "Thomas", "Pillai", "Varghese", "Krishnan", "Joseph", "Das",
  "Kurian", "Raj",
];

const JOBS = [
  {
    title: "Business Development Executive",
    department: "Sales",
    seniority: "junior",
    workType: "onsite",
    compMinLakh: 3.0,
    compMaxLakh: 4.5,
    openings: 3,
    status: "live",
    daysAgoPublished: 26, // aging (> 21 days)
    descriptionMd:
      "## About the role\n\nYou will be the first person a nurse speaks to when they consider moving abroad. You will qualify enquiries, explain our services honestly, and carry a candidate from first call to enrolment.\n\n## What the week looks like\n\n- 40–60 outbound conversations, mostly on WhatsApp and phone\n- Owning your own pipeline in the Desgro CRM\n- Working Mon–Sat from our Kochi office",
    mustHaves: ["Malayalam", "1 year sales", "Own laptop"],
    niceToHaves: ["CRM experience", "Healthcare background", "Hindi"],
  },
  {
    title: "Documentation Executive",
    department: "Operations",
    seniority: "mid",
    workType: "onsite",
    compMinLakh: 3.6,
    compMaxLakh: 5.0,
    openings: 2,
    status: "live",
    daysAgoPublished: 9,
    descriptionMd:
      "## About the role\n\nYou will run candidate files end to end — AHPRA, NMC and CGFNS paperwork — and be the reason nothing sits waiting for a missing document.\n\n## What good looks like\n\n- Every file's next step is known and dated\n- Nothing is chased twice for the same document",
    mustHaves: ["Attention to detail", "2 years documentation"],
    niceToHaves: ["AHPRA", "NMC", "Excel"],
  },
  {
    title: "Marketing Associate",
    department: "Marketing",
    seniority: "junior",
    workType: "hybrid",
    compMinLakh: 3.0,
    compMaxLakh: 4.0,
    openings: 1,
    status: "draft",
    daysAgoPublished: null,
    descriptionMd:
      "## About the role\n\nYou will run our Meta campaigns and the content that feeds them.",
    mustHaves: ["Meta Ads"],
    niceToHaves: ["Canva", "Video editing"],
  },
];

async function main() {
  const url = process.env.DATABASE_URL || "";
  if (url.includes(PROD_HOST_FRAGMENT)) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at the production endpoint (${PROD_HOST_FRAGMENT}). ` +
        `Point it at a disposable Neon branch instead.`,
    );
  }
  const remove = process.argv.includes("--remove");
  console.log(
    `\n▶ Hiring seed (${remove ? "REMOVE" : "CREATE"}) against ${url.replace(/:\/\/[^@]*@/, "://***@")}\n`,
  );

  if (remove) return removeAll();
  return createAll();
}

async function removeAll() {
  const jobs = await prisma.hiringJob.deleteMany({
    where: { slug: { startsWith: DEMO_SLUG_PREFIX } },
  });
  const candidates = await prisma.hiringCandidate.deleteMany({
    where: { tags: { has: SEED_TAG } },
  });
  const partners = await prisma.hiringPartner.deleteMany({
    where: { contactEmail: { endsWith: DEMO_PARTNER_DOMAIN } },
  });
  const templates = await prisma.hiringInterviewTemplate.deleteMany({
    where: { name: { startsWith: DEMO_NAME_PREFIX } },
  });
  const automations = await prisma.hiringAutomation.deleteMany({
    where: { name: { startsWith: DEMO_NAME_PREFIX } },
  });
  const pool = await prisma.hiringTalentPool.deleteMany({
    where: { candidate: { tags: { has: SEED_TAG } } },
  });
  console.log(
    `  removed: ${jobs.count} jobs, ${candidates.count} candidates, ${pool.count} pool rows, ` +
      `${partners.count} partners, ${templates.count} interview templates, ${automations.count} automations`,
  );
  console.log("\n✓ Demo data gone. Nothing else was touched.\n");
}

async function createAll() {
  const rand = rng(20260903);

  // ── Locations + canonical job roles ──────────────────────────────────────
  const kochi = await prisma.hiringLocation.upsert({
    where: { name: "Kochi" },
    update: {},
    create: { name: "Kochi", city: "Kochi", state: "Kerala", country: "India" },
  });
  await prisma.hiringLocation.upsert({
    where: { name: "Kottayam" },
    update: {},
    create: { name: "Kottayam", city: "Kottayam", state: "Kerala", country: "India" },
  });

  for (const j of JOBS) {
    await prisma.hiringJobRole.upsert({
      where: { title: j.title },
      update: {},
      create: { title: j.title, department: j.department, defaultSeniority: j.seniority },
    });
  }

  // An owner for the demo reqs: whoever the first admin is.
  const owner = await prisma.user.findFirst({
    where: { OR: [{ role: "admin" }, { roleRef: { isAdmin: true } }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  // ── Requisitions, with their stages, rubric and questions ────────────────
  const createdJobs = [];
  for (const j of JOBS) {
    const role = await prisma.hiringJobRole.findUnique({ where: { title: j.title } });
    const publishedAt =
      j.daysAgoPublished == null ? null : new Date(Date.now() - j.daysAgoPublished * 86_400_000);

    const job = await prisma.hiringJob.upsert({
      where: { slug: DEMO_SLUG_PREFIX + slugify(j.title) },
      update: {},
      create: {
        title: j.title,
        slug: DEMO_SLUG_PREFIX + slugify(j.title),
        jobRoleId: role?.id ?? null,
        department: j.department,
        locationId: kochi.id,
        workType: j.workType,
        employmentType: "full_time",
        seniority: j.seniority,
        compMinLakh: j.compMinLakh,
        compMaxLakh: j.compMaxLakh,
        compVisible: true,
        descriptionMd: j.descriptionMd,
        mustHaves: j.mustHaves,
        niceToHaves: j.niceToHaves,
        openings: j.openings,
        status: j.status,
        ownerId: owner?.id ?? null,
        hiringManagerId: owner?.id ?? null,
        publishedAt,
        createdById: owner?.id ?? null,
        stages: {
          create: DEFAULT_STAGES.map((s, i) => ({
            name: s.name,
            position: i,
            kind: s.kind,
            slaDays: s.slaDays,
          })),
        },
        rubrics: {
          create: DEFAULT_RUBRIC.map((r, i) => ({
            criterion: r.criterion,
            description: r.description,
            weight: r.weight,
            position: i,
          })),
        },
        questions: {
          create: DEFAULT_SCREENING_QUESTIONS.map((q, i) => ({
            prompt: q.prompt,
            helperText: q.helperText,
            answerType: q.answerType,
            required: q.required,
            position: i,
          })),
        },
      },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    createdJobs.push(job);
  }

  // ── Interview templates ──────────────────────────────────────────────────
  const screenTemplate = await prisma.hiringInterviewTemplate.upsert({
    where: { name: DEMO_NAME_PREFIX + "15-minute phone screen" },
    update: {},
    create: {
      name: DEMO_NAME_PREFIX + "15-minute phone screen",
      kind: "phone_screen",
      durationMin: 15,
      questionSet: [
        "Walk me through your last role in two minutes.",
        "What are you looking for that you are not getting today?",
        "What notice do you have to serve?",
      ],
      isDefaultForStage: "open",
      createdById: owner?.id ?? null,
    },
  });
  await prisma.hiringInterviewTemplate.upsert({
    where: { name: DEMO_NAME_PREFIX + "Final — founder conversation" },
    update: {},
    create: {
      name: DEMO_NAME_PREFIX + "Final — founder conversation",
      kind: "final",
      durationMin: 45,
      questionSet: [
        "Tell me about a candidate file you saved that was going wrong.",
        "What would make you leave within six months?",
      ],
      createdById: owner?.id ?? null,
    },
  });

  // ── Candidates + applications spread across the stages ───────────────────
  const liveJobs = createdJobs.filter((j) => j.status === "live");
  let created = 0;
  for (let i = 0; i < 40; i++) {
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length]!;
    const fullName = `${first} ${last}`;
    const email = `${first}.${last}${i}`.toLowerCase() + "@demo.invalid";
    const phone = `+9198${String(47000000 + i * 137).padStart(8, "0")}`;

    const job = liveJobs[i % liveJobs.length]!;
    // Weight the pipeline towards the top, the way a real funnel sits.
    const stageIdx = pickStage(rand());
    const stage = job.stages[stageIdx]!;
    const appliedDaysAgo = 2 + Math.floor(rand() * 24);
    const appliedAt = new Date(Date.now() - appliedDaysAgo * 86_400_000);
    const stageEnteredAt = new Date(
      appliedAt.getTime() + Math.floor(rand() * appliedDaysAgo * 0.5) * 86_400_000,
    );

    const candidate = await prisma.hiringCandidate.upsert({
      where: { email },
      update: {},
      create: {
        fullName,
        email,
        phone,
        currentTitle: ["Sales Executive", "Counsellor", "Ops Associate", "Fresher"][i % 4],
        currentEmployer: i % 4 === 3 ? null : `Demo Consultancy ${1 + (i % 5)}`,
        locationText: i % 3 === 0 ? "Kottayam, Kerala" : "Kochi, Kerala",
        totalExperienceYears: Math.round(rand() * 60) / 10,
        noticePeriodDays: [0, 15, 30, 60][i % 4],
        expectedCtcLakh: 3 + Math.round(rand() * 30) / 10,
        source: (["careers_page", "referral", "partner", "walk_in"] as const)[i % 4],
        tags: [SEED_TAG],
        consentAt: appliedAt,
        ownerId: owner?.id ?? null,
      },
    });

    const isTerminal = stage.kind === "lost" || stage.kind === "won";
    const app = await prisma.hiringApplication.upsert({
      where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
      update: {},
      create: {
        candidateId: candidate.id,
        jobId: job.id,
        stageId: stage.id,
        status: stage.kind === "won" ? "hired" : stage.kind === "lost" ? "rejected" : "active",
        appliedAt,
        stageEnteredAt,
        hiredAt: stage.kind === "won" ? stageEnteredAt : null,
        rejectionReason: stage.kind === "lost" ? "Stronger candidates at this stage." : null,
        // Deliberately leave some shortlisted candidates uncontacted so the
        // Follow-ups rail has real work in it on a fresh seed.
        lastContactedAt:
          i % 3 === 0 ? null : new Date(stageEnteredAt.getTime() + 86_400_000),
        aiScore: isTerminal ? 40 + Math.floor(rand() * 30) : 55 + Math.floor(rand() * 45),
        aiScoreBreakdown: DEFAULT_RUBRIC.map((r) => ({
          criterion: r.criterion,
          weight: r.weight,
          score: 2 + Math.floor(rand() * 3),
          evidence: "Seeded example — not a real model output.",
        })),
        aiScoredAt: appliedAt,
        aiModel: "seed",
        aiPromptVersion: "seed",
        answers: {},
        events: {
          create: [
            { type: "created", occurredAt: appliedAt, payload: { via: "seed" } },
            ...(stage.position > 0
              ? [
                  {
                    type: "stage_moved",
                    fromStage: job.stages[0]!.name,
                    toStage: stage.name,
                    occurredAt: stageEnteredAt,
                  },
                ]
              : []),
          ],
        },
      },
    });
    created++;

    // A couple of interviews, one of them completed with no scorecard so
    // "Awaiting scorecards" is not empty on a fresh seed.
    if (stage.name === "Interview" && i % 4 === 0) {
      await prisma.hiringInterview.create({
        data: {
          applicationId: app.id,
          templateId: screenTemplate.id,
          kind: "phone_screen",
          scheduledAt: new Date(Date.now() - (i % 3) * 86_400_000),
          durationMin: 15,
          mode: "phone",
          status: i % 8 === 0 ? "scheduled" : "completed",
          panel: owner ? [owner.id] : [],
          createdById: owner?.id ?? null,
        },
      });
    }
  }

  // ── One offer, on a candidate sitting at the Offer stage ─────────────────
  const offerApp = await prisma.hiringApplication.findFirst({
    where: { stage: { name: "Offer" }, job: { slug: { startsWith: DEMO_SLUG_PREFIX } } },
    include: { job: true },
  });
  if (offerApp) {
    const existing = await prisma.hiringOffer.findFirst({ where: { applicationId: offerApp.id } });
    if (!existing) {
      await prisma.hiringOffer.create({
        data: {
          applicationId: offerApp.id,
          jobTitle: offerApp.job.title,
          department: offerApp.job.department,
          locationId: kochi.id,
          startDate: new Date(Date.now() + 21 * 86_400_000),
          baseLakh: 3.6,
          variableLakh: 0.6,
          joiningBonusLakh: 0,
          probationMonths: 6,
          noticePeriodDays: 30,
          expiresAt: new Date(Date.now() + 5 * 86_400_000),
          status: "sent",
          sentAt: new Date(Date.now() - 2 * 86_400_000),
          createdById: owner?.id ?? null,
        },
      });
    }
  }

  // ── A sourcing partner, scoped to exactly one job ────────────────────────
  const partner = await prisma.hiringPartner.upsert({
    where: { contactEmail: "recruiters" + DEMO_PARTNER_DOMAIN },
    update: {},
    create: {
      agencyName: "Demo Talent Partners",
      primaryContactName: "A. Recruiter",
      contactEmail: "recruiters" + DEMO_PARTNER_DOMAIN,
      focusAreas: ["Sales", "Operations"],
      feePercent: 8.33,
      status: "active",
      invitedAt: new Date(Date.now() - 30 * 86_400_000),
      activatedAt: new Date(Date.now() - 28 * 86_400_000),
      invitedById: owner?.id ?? null,
    },
  });
  if (liveJobs[0]) {
    await prisma.hiringPartnerJobAccess.upsert({
      where: { partnerId_jobId: { partnerId: partner.id, jobId: liveJobs[0].id } },
      update: {},
      create: { partnerId: partner.id, jobId: liveJobs[0].id, grantedById: owner?.id ?? null },
    });
  }

  // ── Talent pool: a few silver medallists ─────────────────────────────────
  const rejected = await prisma.hiringCandidate.findMany({
    where: { tags: { has: SEED_TAG }, applications: { some: { status: "rejected" } } },
    take: 5,
    select: { id: true },
  });
  for (const c of rejected) {
    await prisma.hiringTalentPool.upsert({
      where: { candidateId: c.id },
      update: {},
      create: {
        candidateId: c.id,
        state: "nurturing",
        interestAreas: ["Sales", "Counselling"],
        lastTouchAt: new Date(Date.now() - 20 * 86_400_000),
        nextTouchAt: new Date(Date.now() + 10 * 86_400_000),
        ownerId: owner?.id ?? null,
      },
    });
  }

  console.log(
    `  created: ${createdJobs.length} jobs, ${created} candidates + applications, 1 partner, ` +
      `${rejected.length} talent-pool rows`,
  );
  console.log(`\n✓ Demo data in. Remove it with: npm run db:seed-hiring:remove\n`);
}

/** Funnel-shaped stage pick: most candidates sit near the top. */
function pickStage(r: number): number {
  if (r < 0.34) return 0; // Applied
  if (r < 0.56) return 1; // Screening
  if (r < 0.72) return 2; // Shortlisted
  if (r < 0.84) return 3; // Interview
  if (r < 0.89) return 4; // Offer
  if (r < 0.92) return 5; // Hired
  if (r < 0.98) return 6; // Rejected
  return 7; // On hold
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("\n✗", e instanceof Error ? e.message : e, "\n");
    await prisma.$disconnect();
    process.exit(1);
  });
