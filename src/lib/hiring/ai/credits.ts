import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/app-settings";
import { unprocessable } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import type { AiUsage } from "./provider";

/**
 * The AI credits meter (§4.8): a workspace budget, a per-feature cost, a
 * per-call ledger, and a HARD stop with a clear message when it is exhausted.
 *
 * The stop is deliberately before the call, not after: a budget you only
 * discover you have blown is not a budget.
 */

export const HIRING_AI_BUDGET_KEY = "hiring_ai_credit_budget";
export const DEFAULT_AI_BUDGET = 20_000;

export const AI_FEATURES = [
  "company_profile",
  "job_description",
  "resume_parse",
  "rubric_score",
  "prep_packet",
  "scorecard_summary",
  "outreach",
  "prescreen",
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** What one run of each feature costs. Roughly proportional to typical spend. */
export const FEATURE_COSTS: Record<AiFeature, number> = {
  company_profile: 40,
  job_description: 30,
  resume_parse: 15,
  rubric_score: 20,
  prep_packet: 25,
  scorecard_summary: 20,
  outreach: 10,
  prescreen: 15,
};

export const FEATURE_LABELS: Record<AiFeature, string> = {
  company_profile: "Company profile",
  job_description: "Job description draft",
  resume_parse: "Résumé parsing",
  rubric_score: "Rubric scoring",
  prep_packet: "Interview prep packet",
  scorecard_summary: "Scorecard summary",
  outreach: "Outreach draft",
  prescreen: "Async pre-screen",
};

export type CreditsState = { budget: number; spent: number; remaining: number };

export async function getBudget(): Promise<number> {
  const raw = await getSetting(HIRING_AI_BUDGET_KEY);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AI_BUDGET;
}

export async function setBudget(credits: number, userId?: string | null): Promise<void> {
  await setSetting(HIRING_AI_BUDGET_KEY, String(Math.max(0, Math.floor(credits))), userId);
}

/** Only successful calls are billed — a failed call costs the workspace nothing. */
export async function getSpent(): Promise<number> {
  const agg = await prisma.hiringAiCall.aggregate({
    where: { status: "ok" },
    _sum: { credits: true },
  });
  return agg._sum.credits ?? 0;
}

export async function getCreditsState(): Promise<CreditsState> {
  const [budget, spent] = await Promise.all([getBudget(), getSpent()]);
  return { budget, spent, remaining: Math.max(0, budget - spent) };
}

/**
 * Run one metered AI call.
 *
 * Checks the budget first and refuses with a message a recruiter can act on;
 * records the ledger row either way, so "why did nothing happen" always has an
 * answer in the data. A provider failure is recorded as an error and rethrown —
 * never swallowed, and never billed.
 */
export async function meter<T extends AiUsage>(
  opts: {
    feature: AiFeature;
    userId?: string | null;
    entityType?: string;
    entityId?: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  const cost = FEATURE_COSTS[opts.feature];
  const state = await getCreditsState();

  if (state.remaining < cost) {
    await prisma.hiringAiCall
      .create({
        data: {
          feature: opts.feature,
          credits: 0,
          userId: opts.userId ?? null,
          entityType: opts.entityType,
          entityId: opts.entityId,
          status: "blocked_no_credits",
          error: `Needs ${cost} credits, ${state.remaining} left of ${state.budget}.`,
        },
      })
      .catch(() => undefined);
    throw unprocessable(
      `AI credits are used up — this needs ${cost} and ${state.remaining} of ${state.budget} remain. ` +
        `Raise the budget in Hiring settings, or do this step by hand.`,
      "ai_credits_exhausted",
    );
  }

  try {
    const result = await run();
    await prisma.hiringAiCall
      .create({
        data: {
          feature: opts.feature,
          credits: cost,
          model: result.model,
          promptVersion: result.promptVersion,
          userId: opts.userId ?? null,
          entityType: opts.entityType,
          entityId: opts.entityId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          status: "ok",
        },
      })
      .catch((e) => logger.error("hiring_ai_ledger_failed", { feature: opts.feature, message: String(e) }));
    return result;
  } catch (e) {
    await prisma.hiringAiCall
      .create({
        data: {
          feature: opts.feature,
          credits: 0,
          userId: opts.userId ?? null,
          entityType: opts.entityType,
          entityId: opts.entityId,
          status: "error",
          error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
        },
      })
      .catch(() => undefined);
    throw e;
  }
}
