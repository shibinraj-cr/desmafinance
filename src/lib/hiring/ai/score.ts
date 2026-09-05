import { prisma } from "@/lib/prisma";
import { unprocessable, notFound } from "@/lib/http-error";
import { getAiProvider } from "./provider";
import { meter } from "./credits";
import { loadCompanyProfile, profilePreamble } from "./company-profile";
import { scoringPayload, BIAS_GUARDRAIL_INSTRUCTION } from "./redact";
import { rubricWeightsValid } from "../core";

/**
 * Rubric scoring (§4.4).
 *
 * Three rules this file exists to enforce:
 *   1. Output is STRUCTURED — per criterion: score, weight applied, and a
 *      one-line evidence quote. A score with no evidence is a bug, so a
 *      criterion that comes back without one is rejected here rather than
 *      stored and shown as if it meant something.
 *   2. The prompt is built ONLY from `scoringPayload()`, which cannot carry a
 *      protected attribute (see ./redact).
 *   3. It NEVER rejects. It writes a number and a breakdown; a human moves
 *      every stage.
 */

export type CriterionScore = {
  criterion: string;
  weight: number;
  /** 1–4, as the rubric is scored. */
  score: number;
  evidence: string;
};

export type ScoreResult = {
  total: number;
  breakdown: CriterionScore[];
  model: string;
  promptVersion: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["criteria"],
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "score", "evidence"],
        properties: {
          criterion: { type: "string" },
          score: {
            type: "integer",
            minimum: 1,
            maximum: 4,
            description: "1 = no evidence, 2 = weak, 3 = solid, 4 = strong.",
          },
          evidence: {
            type: "string",
            description:
              "One short line quoting or closely paraphrasing what in the application supports this score. " +
              "If there is nothing to point at, say so plainly and score 1.",
          },
        },
      },
    },
  },
} as const;

/**
 * Weighted total out of 100. Each criterion is scored 1–4, so a 1 across the
 * board is 25 rather than 0 — "no evidence" is the floor of the scale, not an
 * absence of one, and a 0 would imply a certainty the model does not have.
 */
export function weightedTotal(breakdown: CriterionScore[]): number {
  const total = breakdown.reduce((sum, c) => sum + (c.score / 4) * c.weight, 0);
  return Math.round(total);
}

/** Score one application against its job's rubric, and store the breakdown. */
export async function scoreApplication(opts: {
  applicationId: string;
  userId: string;
}): Promise<ScoreResult> {
  const provider = getAiProvider();
  if (!provider) {
    throw unprocessable(
      "No AI key is configured, so applications cannot be scored automatically. " +
        "Everything else — stages, notes, interviews — works without it.",
      "ai_disabled",
    );
  }

  const app = await prisma.hiringApplication.findFirst({
    where: { id: opts.applicationId, deletedAt: null },
    include: {
      candidate: true,
      job: {
        include: {
          rubrics: { orderBy: { position: "asc" } },
          questions: { orderBy: { position: "asc" } },
        },
      },
    },
  });
  if (!app) throw notFound("That application no longer exists.");

  const rubrics = app.job.rubrics;
  if (!rubricWeightsValid(rubrics)) {
    throw unprocessable(
      "This requisition's rubric weights do not total 100%, so a score would not mean anything. " +
        "Fix the rubric first.",
      "bad_rubric",
    );
  }

  // The ONLY thing the prompt is built from.
  const rawAnswers = (app.answers ?? {}) as Record<string, string | string[]>;
  const answers = Object.entries(rawAnswers).map(([qid, value]) => ({
    question: app.job.questions.find((q) => q.id === qid)?.prompt ?? "Answer",
    answer: Array.isArray(value) ? value.join(", ") : String(value ?? ""),
  }));
  const payload = scoringPayload(
    {
      currentTitle: app.candidate.currentTitle,
      currentEmployer: app.candidate.currentEmployer,
      totalExperienceYears:
        app.candidate.totalExperienceYears == null ? null : Number(app.candidate.totalExperienceYears),
      noticePeriodDays: app.candidate.noticePeriodDays,
      resumeText: null,
    },
    answers,
  );

  const profile = await loadCompanyProfile();

  const result = await meter(
    {
      feature: "rubric_score",
      userId: opts.userId,
      entityType: "HiringApplication",
      entityId: app.id,
    },
    () =>
      provider.generateJson({
        system:
          "You score a job application against a weighted rubric for an Indian nursing-migration " +
          "consultancy. Score each criterion 1-4 and give one line of evidence for each, drawn " +
          "from what the application actually says. Do not reward confident writing over " +
          "demonstrated experience. " +
          BIAS_GUARDRAIL_INSTRUCTION +
          profilePreamble(profile),
        user: JSON.stringify(
          {
            role: { title: app.job.title, seniority: app.job.seniority },
            mustHaves: app.job.mustHaves,
            niceToHaves: app.job.niceToHaves,
            rubric: rubrics.map((r) => ({ criterion: r.criterion, meaning: r.description, weight: r.weight })),
            application: payload,
          },
          null,
          2,
        ),
        schema: SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 2000,
      }),
  );

  const parsed = (result.data as { criteria?: { criterion: string; score: number; evidence: string }[] })
    .criteria ?? [];

  // Re-attach the weights from OUR rubric rather than trusting the model's copy
  // of them, and drop anything it invented that is not on the rubric.
  const breakdown: CriterionScore[] = rubrics.map((r) => {
    const hit = parsed.find((p) => p.criterion.trim().toLowerCase() === r.criterion.trim().toLowerCase());
    return {
      criterion: r.criterion,
      weight: r.weight,
      score: clampScore(hit?.score),
      evidence: hit?.evidence?.trim() || "The model gave no evidence for this criterion.",
    };
  });

  if (breakdown.every((b) => b.evidence.startsWith("The model gave no evidence"))) {
    throw unprocessable(
      "The scoring came back with no evidence for any criterion, so it has not been saved. Try again.",
      "no_evidence",
    );
  }

  const total = weightedTotal(breakdown);

  await prisma.$transaction([
    prisma.hiringApplication.update({
      where: { id: app.id },
      data: {
        aiScore: total,
        aiScoreBreakdown: breakdown as never,
        aiScoredAt: new Date(),
        aiModel: result.model,
        aiPromptVersion: result.promptVersion,
      },
    }),
    prisma.hiringApplicationEvent.create({
      data: {
        applicationId: app.id,
        type: "scored",
        // Null actor: this was the model, not the person who pressed the button.
        actorId: null,
        payload: { total, model: result.model, promptVersion: result.promptVersion, requestedBy: opts.userId },
      },
    }),
  ]);

  return { total, breakdown, model: result.model, promptVersion: result.promptVersion };
}

function clampScore(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  return Math.min(4, Math.max(1, Math.round(v)));
}
