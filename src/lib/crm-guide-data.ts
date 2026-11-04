// Server half of the BDE CRM guide (see crm-guide.ts): reads the facts the
// guide quotes from the same tables and constants the CRM runs on, and keeps
// the guide's knowledge-check training module in step with the guide.
import { prisma } from "./prisma";
import { ABANDONED_DAYS, FIRST_RESPONSE_SLA_HOURS, SLA_THRESHOLD_DAYS, STUCK_DAYS, UPCOMING_TASK_MAX_DAYS } from "./crm-team";
import { FOLLOW_UP_CAP_DAYS, FOLLOW_UP_REVIEW_DAYS, REMARKETING_CAP_DAYS, getLifecycleConfig } from "./crm-lifecycle";
import { getRemarketingConfig } from "./crm-remarketing";
import { activeQualityReasons } from "./crm-lead-quality-data";
import { LOST_STATUS_CODES } from "./crm-reinquiry";
import { CRM_GUIDE_MODULE_ID, crmGuideQuiz, type GuideFacts } from "./crm-guide";

export async function loadCrmGuideFacts(): Promise<GuideFacts> {
  const [stages, statuses, reasons, lifecycle, remarketing] = await Promise.all([
    prisma.crmLeadStatus.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { code: true, label: true, kind: true, parked: true, pacedByTask: true, isDefault: true },
    }),
    prisma.crmLeadSubStatus.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
      select: { label: true, group: true, isDefault: true },
    }),
    activeQualityReasons(),
    getLifecycleConfig(),
    getRemarketingConfig(),
  ]);

  const statusGroups: GuideFacts["statusGroups"] = [];
  for (const s of statuses) {
    const group = s.group || "Other";
    const g = statusGroups.find((x) => x.group === group);
    if (g) g.labels.push(s.label);
    else statusGroups.push({ group, labels: [s.label] });
  }

  return {
    stages: stages.map((s) => ({
      code: s.code,
      label: s.label,
      kind: s.kind === "won" || s.kind === "lost" ? s.kind : "active",
      parked: s.parked,
      pacedByTask: s.pacedByTask,
      isDefault: s.isDefault,
      slaDays: SLA_THRESHOLD_DAYS[s.code] ?? null,
    })),
    statusGroups,
    defaultStatus: statuses.find((s) => s.isDefault)?.label ?? null,
    qualityReasons: reasons.map((r) => r.label),
    revivedFromLost: stages.filter((s) => (LOST_STATUS_CODES as readonly string[]).includes(s.code)).map((s) => s.label),
    abandonedDays: ABANDONED_DAYS,
    stuckDays: STUCK_DAYS,
    firstResponseHours: FIRST_RESPONSE_SLA_HOURS,
    upcomingTaskDays: UPCOMING_TASK_MAX_DAYS,
    followUpCapDays: FOLLOW_UP_CAP_DAYS,
    followUpReviewDays: FOLLOW_UP_REVIEW_DAYS,
    remarketingCapDays: REMARKETING_CAP_DAYS,
    followUpCapOn: lifecycle.followUpEnabled,
    remarketingCapOn: lifecycle.remarketingEnabled,
    remarketingOn: remarketing.enabled,
    remarketingOffsets: remarketing.offsets,
  };
}

const quizQuestionId = (key: string) => `${CRM_GUIDE_MODULE_ID}-${key}`;

/**
 * Rewrite the guide module's question bank from crmGuideQuiz(facts) when it
 * has drifted — a new question, a reworded one, or a fact (a stage name, a
 * day count) that changed underneath one. No-op until HR has created the
 * module, and when nothing differs. Past attempts keep their own snapshot, so
 * a rewrite never changes an old score.
 */
export async function syncCrmGuideQuiz(facts: GuideFacts): Promise<void> {
  const mod = await prisma.salesTrainingModule.findUnique({
    where: { id: CRM_GUIDE_MODULE_ID },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!mod) return;
  const want = crmGuideQuiz(facts).map((q, i) => ({
    id: quizQuestionId(q.key),
    sortOrder: i + 1,
    kind: q.correct.length > 1 ? "multi" : "single",
    prompt: q.prompt,
    options: q.options,
    correct: [...q.correct].sort((a, b) => a - b),
    points: 1,
    explanation: q.explanation as string | null,
  }));
  const fingerprint = (qs: typeof want) => JSON.stringify(qs.map((q) => [q.id, q.sortOrder, q.kind, q.prompt, q.options, q.correct, q.points, q.explanation]));
  const have = mod.questions.map((q) => ({
    id: q.id,
    sortOrder: q.sortOrder,
    kind: q.kind,
    prompt: q.prompt,
    options: q.options as string[],
    correct: q.correct as number[],
    points: q.points,
    explanation: q.explanation,
  }));
  if (fingerprint(have) === fingerprint(want)) return;

  try {
    await prisma.$transaction([
      prisma.salesTrainingQuestion.deleteMany({ where: { moduleId: mod.id, id: { notIn: want.map((q) => q.id) } } }),
      ...want.map(({ id, ...data }) =>
        prisma.salesTrainingQuestion.upsert({ where: { id }, create: { id, moduleId: mod.id, ...data }, update: data }),
      ),
    ]);
  } catch (e) {
    // Two page loads syncing at once can collide on the same new id; the other
    // one wrote the same rows, so there is nothing to repair.
    console.warn("[crm-guide] quiz sync skipped:", e instanceof Error ? e.message : e);
  }
}

/**
 * HR's one-click "make this a training module". Created as a draft so HR
 * publishes it (and so learners see it) on their own schedule, through the
 * normal module editor.
 */
export async function createCrmGuideModule(userId: string | null, facts: GuideFacts) {
  const last = await prisma.salesTrainingModule.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  await prisma.salesTrainingModule.upsert({
    where: { id: CRM_GUIDE_MODULE_ID },
    create: {
      id: CRM_GUIDE_MODULE_ID,
      title: "How to use the CRM",
      description:
        "Read the CRM Guide first (My Workspace → CRM Guide), then take this quiz.\n" +
        "The guide and these questions follow the CRM as it changes, so they always match the screens you use.",
      sortOrder: (last?.sortOrder ?? 0) + 1,
      videos: [],
      passMark: 80,
      requireWatch: false,
      status: "draft",
      createdById: userId,
    },
    update: {},
  });
  await syncCrmGuideQuiz(facts);
}
