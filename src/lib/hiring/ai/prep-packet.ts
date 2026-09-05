import { prisma } from "@/lib/prisma";
import { notFound, unprocessable } from "@/lib/http-error";
import { getAiProvider } from "./provider";
import { meter } from "./credits";
import { loadCompanyProfile, profilePreamble } from "./company-profile";
import { BIAS_GUARDRAIL_INSTRUCTION, scoringPayload } from "./redact";
import { formatHiringDate } from "../core";

/**
 * Interview prep packets and panel scorecard summaries (§4.5).
 *
 * A prep packet's job is to stop the fourth interviewer asking the same three
 * questions the first three asked — so it is built from what EARLIER stages
 * already covered, not just from the résumé.
 */

const PACKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["highlights", "gaps", "questions", "alreadyCovered"],
  properties: {
    highlights: { type: "array", items: { type: "string" }, maxItems: 6 },
    gaps: {
      type: "array",
      maxItems: 6,
      items: { type: "string", description: "Something to probe, and why it is worth probing." },
    },
    questions: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 8 },
    alreadyCovered: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
      description: "What earlier stages have already established, so this interview does not repeat it.",
    },
  },
} as const;

export async function generatePrepPacket(opts: {
  interviewId: string;
  userId: string;
}): Promise<string> {
  const provider = getAiProvider();
  if (!provider) {
    throw unprocessable("No AI key is configured, so prep packets cannot be generated.", "ai_disabled");
  }

  const interview = await prisma.hiringInterview.findUnique({
    where: { id: opts.interviewId },
    include: {
      template: true,
      application: {
        include: {
          candidate: true,
          job: { include: { questions: { orderBy: { position: "asc" } } } },
          events: { orderBy: { occurredAt: "asc" }, take: 100 },
          interviews: {
            where: { status: "completed" },
            include: { scorecards: { include: { reviewer: { select: { username: true } } } } },
          },
          notes: { where: { visibility: "team" }, orderBy: { createdAt: "asc" }, take: 20 },
        },
      },
    },
  });
  if (!interview) throw notFound("That interview no longer exists.");

  const app = interview.application;
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

  const priorRounds = app.interviews
    .filter((i) => i.id !== interview.id)
    .map((i) => ({
      kind: i.kind,
      verdicts: i.scorecards.map((s) => ({ by: s.reviewer.username, verdict: s.overall, notes: s.notesMd })),
    }));

  const result = await meter(
    { feature: "prep_packet", userId: opts.userId, entityType: "HiringInterview", entityId: interview.id },
    () =>
      provider.generateJson({
        system:
          "You prepare an interviewer for a conversation. Be specific and short. Every question you " +
          "propose must be answerable from experience, not from opinion. " +
          BIAS_GUARDRAIL_INSTRUCTION +
          profilePreamble(profile),
        user: JSON.stringify(
          {
            role: { title: app.job.title, mustHaves: app.job.mustHaves, niceToHaves: app.job.niceToHaves },
            interview: { kind: interview.kind, durationMin: interview.durationMin },
            templateQuestions: interview.template?.questionSet ?? null,
            application: payload,
            stageHistory: app.events
              .filter((e) => e.type === "stage_moved")
              .map((e) => ({ from: e.fromStage, to: e.toStage, on: formatHiringDate(e.occurredAt) })),
            priorRounds,
            teamNotes: app.notes.map((n) => n.bodyMd),
          },
          null,
          2,
        ),
        schema: PACKET_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 2000,
      }),
  );

  const d = result.data as {
    highlights?: string[];
    gaps?: string[];
    questions?: string[];
    alreadyCovered?: string[];
  };

  const md = [
    "## Highlights",
    ...(d.highlights ?? []).map((h) => `- ${h}`),
    "",
    "## Worth probing",
    ...(d.gaps ?? []).map((g) => `- ${g}`),
    "",
    "## Questions",
    ...(d.questions ?? []).map((q, i) => `${i + 1}. ${q}`),
    "",
    "## Already covered — don't ask again",
    ...(d.alreadyCovered ?? []).map((c) => `- ${c}`),
  ].join("\n");

  await prisma.hiringInterview.update({
    where: { id: interview.id },
    data: { prepPacketMd: md },
  });

  return md;
}

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summaryMd", "agreement", "openQuestions"],
  properties: {
    summaryMd: { type: "string", description: "What the panel collectively found. 120-200 words." },
    agreement: {
      type: "string",
      enum: ["unanimous", "leaning_yes", "split", "leaning_no"],
      description: "How much the panel agreed.",
    },
    openQuestions: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
} as const;

/**
 * Summarise a panel's scorecards. Reports DISAGREEMENT explicitly, because a
 * summary that smooths over a split panel is the one that gets somebody hired
 * by accident.
 */
export async function summariseScorecards(opts: {
  applicationId: string;
  userId: string;
}): Promise<{ summaryMd: string; agreement: string; openQuestions: string[] }> {
  const provider = getAiProvider();
  if (!provider) throw unprocessable("No AI key is configured.", "ai_disabled");

  const interviews = await prisma.hiringInterview.findMany({
    where: { applicationId: opts.applicationId, scorecards: { some: {} } },
    include: { scorecards: { include: { reviewer: { select: { username: true } } } } },
    orderBy: { scheduledAt: "asc" },
  });
  const cards = interviews.flatMap((i) =>
    i.scorecards.map((s) => ({
      round: i.kind,
      reviewer: s.reviewer.username,
      verdict: s.overall,
      ratings: s.ratings,
      notes: s.notesMd,
    })),
  );
  if (!cards.length) {
    throw unprocessable("There are no scorecards on this application yet.", "no_scorecards");
  }

  const result = await meter(
    {
      feature: "scorecard_summary",
      userId: opts.userId,
      entityType: "HiringApplication",
      entityId: opts.applicationId,
    },
    () =>
      provider.generateJson({
        system:
          "You summarise a hiring panel's scorecards for the person who has to make the call. " +
          "Where reviewers disagree, say so and say about what — do not average them into a view " +
          "nobody actually holds. " +
          BIAS_GUARDRAIL_INSTRUCTION,
        user: JSON.stringify({ scorecards: cards }, null, 2),
        schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 1500,
      }),
  );

  const d = result.data as { summaryMd?: string; agreement?: string; openQuestions?: string[] };
  return {
    summaryMd: d.summaryMd?.trim() ?? "",
    agreement: d.agreement ?? "split",
    openQuestions: d.openQuestions ?? [],
  };
}
