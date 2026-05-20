// Data-driven coaching loop for the BDE performance page. Generates a
// markdown analysis + a small list of targeted questions based on the
// BDE's current month numbers (target, actuals, leads, pipeline). Once
// the BDE submits answers, generates follow-up feedback by inspecting
// the answer text for known signals.
//
// Today the analysis + feedback are deterministic templates that
// concatenate real metrics — no LLM call. The function shape mirrors
// what a Claude completion would return so we can swap the brain to
// an actual model later without touching callers.

import { prisma } from "./prisma";
import {
  getFunnelTotals,
  getPipelineForecast,
  monthBounds,
} from "./lead-pulse-metrics";

export type InsightQuestion = {
  id: string;
  question: string;
  hint?: string;
};

export type BdeInsightSnapshot = {
  /** Markdown analysis the BDE reads before answering. */
  analysis: string;
  /** 3-5 targeted questions, keyed by a stable id. */
  questions: InsightQuestion[];
  /** Numbers the helper used — surfaced so the UI / audit can show them. */
  metrics: {
    role: "l1" | "l2";
    totalLeads: number;
    won: number;
    target: number;
    conversionPct: number | null;
    openPipelineCount: number;
    openPipelineRevenue: number;
    gap: number; // target - forecastCount; positive means behind
  };
};

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

function inr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/**
 * Build a fresh insight snapshot for the given (BDE, year, month).
 * Pulls live metrics from the funnel + pipeline helpers. The caller
 * persists the returned shape into LeadPulseBdeInsight.
 */
export async function buildBdeInsightSnapshot(opts: {
  userId: string;
  displayName: string;
  role: "l1" | "l2";
  year: number;
  month: number;
}): Promise<BdeInsightSnapshot> {
  const { userId, displayName, role, year, month } = opts;
  const { start, end } = monthBounds(year, month);

  const totals = await getFunnelTotals({ start, end, userId });
  const totalLeads = role === "l1" ? totals.l1Leads : totals.l2Leads;
  const won = role === "l1" ? totals.l1Won : totals.l2Won;
  const conversionPct = role === "l1" ? totals.l1ConversionPct : totals.l2ConversionPct;

  // L2 BDEs have a real pipeline + target line; L1 BDEs don't have a
  // pipeline view yet, so we degrade gracefully for them.
  let openPipelineCount = 0;
  let openPipelineRevenue = 0;
  let target = 0;
  let forecastCount = won;
  if (role === "l2") {
    const f = await getPipelineForecast(year, month, { userId });
    const bde = f.byBde.find((b) => b.userId === userId);
    if (bde) {
      openPipelineCount = bde.totals.openCount;
      openPipelineRevenue = bde.totals.expectedRevenue;
      target = bde.totals.targetCount;
      forecastCount = bde.totals.forecastCount;
    }
  } else {
    // L1's target lives on the same LeadPulseTarget rows but at the
    // service level — and L1s don't have a per-BDE service target in
    // most installs. Try to read any target row this BDE has for the
    // month; fall back to 0.
    const t = await prisma.leadPulseTarget.aggregate({
      where: { userId, year, month },
      _sum: { target: true },
    });
    target = t._sum.target ?? 0;
  }

  const gap = target - forecastCount;
  const onTrack = target === 0 ? null : forecastCount >= target;

  // Build the analysis paragraphs. Each `push` adds a small section so
  // we can re-order easily if priorities shift.
  const para: string[] = [];
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric" });

  para.push(`**${displayName} · ${monthName}** — here's where you stand and what to focus on.`);

  // Headline numbers
  const headBits: string[] = [];
  headBits.push(`**${totalLeads}** ${role === "l1" ? "leads received" : "leads handled"}`);
  headBits.push(`**${won}** ${role === "l1" ? "transferred to L2" : "closed-won"}`);
  if (conversionPct != null) headBits.push(`**${conversionPct.toFixed(1)}%** conversion`);
  if (role === "l2") headBits.push(`**${openPipelineCount}** open in pipeline (${inr(openPipelineRevenue)} expected)`);
  para.push(headBits.join(" · "));

  // Target verdict
  if (target > 0 && role === "l2") {
    if (onTrack) {
      para.push(
        `You're **on track** to hit your ${target}-deal target this month — forecast is ${forecastCount} (${won} already closed + ${openPipelineCount} in pipeline). Keep the open deals warm: a quick weekly nudge converts more than a last-week push.`,
      );
    } else {
      para.push(
        `You're **behind** the ${target}-deal target by **${gap}**. With ${won} closed and ${openPipelineCount} open in pipeline, the gap won't close on autopilot — you need ${gap} more closes (or to add ${gap} solid candidates to pipeline) this month.`,
      );
    }
  } else if (target === 0 && role === "l2") {
    para.push(
      `No service target was set for you this month yet. Ask Suhaina to fill in your L2 Targets — without one, the dashboard can't show forecast vs goal.`,
    );
  } else if (role === "l1") {
    para.push(
      `As an L1, your job this month: keep the funnel **full** for L2 BDEs and disqualify fast. The conversion number above is L1→L2 transfer rate.`,
    );
  }

  // Conversion-rate diagnosis
  if (conversionPct != null) {
    if (role === "l2" && conversionPct < 5 && totalLeads > 10) {
      para.push(
        `Your L2 conversion is **low (${conversionPct.toFixed(1)}%)** for the lead volume you're handling. The bottleneck is usually between *quote sent* and *close* — review whether your last 10 quote-sent leads got a follow-up call within 48 hours.`,
      );
    } else if (role === "l1" && conversionPct < 30 && totalLeads > 20) {
      para.push(
        `L1→L2 transfer rate is **${conversionPct.toFixed(1)}%**, below the team's target of 60%. Look at your disqualified column: if it's high, the source quality is the issue (escalate to Suhaina). If it's low, you may be sitting on leads instead of routing them.`,
      );
    }
  }

  // Pipeline depth diagnosis (L2 only)
  if (role === "l2" && target > 0) {
    const desiredPipeline = Math.max(target * 2, 8);
    if (openPipelineCount < desiredPipeline) {
      para.push(
        `Your pipeline depth (**${openPipelineCount}** open) is below the **~${desiredPipeline}** typically needed to confidently hit a ${target}-close month. Spend time this week converting connected calls into expected-close entries on the Pipeline page.`,
      );
    }
  }

  const analysis = para.join("\n\n");

  // Build the questions. We pick from a pool keyed by which signal is
  // the biggest issue, so the BDE answers questions that actually move
  // the needle for them.
  const questions: InsightQuestion[] = [];
  if (target > 0 && role === "l2" && !onTrack) {
    questions.push({
      id: "top3_likely",
      question: `Which 3 candidates in your current pipeline are most likely to close before month-end? Name them and what's pending.`,
      hint: "If you can't list 3 confidently, that's the gap.",
    });
    questions.push({
      id: "main_blocker",
      question: `What's the single biggest thing blocking you from closing ${gap} more deals this month?`,
      hint: "Budget? Document delays? Specific service confusion? Be specific.",
    });
  }
  if (role === "l2" && (conversionPct ?? 0) < 8 && totalLeads > 10) {
    questions.push({
      id: "quote_to_close",
      question: `Of the last 5 candidates you sent a quote to, how many followed up within 48 hours? What's stopping the others?`,
      hint: "Most slipped deals die in the 'quote sent' → silence gap.",
    });
  }
  if (role === "l2" && openPipelineCount < Math.max(target * 2, 6) && target > 0) {
    questions.push({
      id: "pipeline_depth",
      question: `Looking at your connected calls this week — which 2 will you promise to add to Pipeline before end of day?`,
      hint: "A pipeline thinner than ~2× target almost always misses.",
    });
  }
  if (role === "l1") {
    questions.push({
      id: "l1_disqualified_quality",
      question: `Out of every 10 leads you got this week, roughly how many felt unqualified before you even called? What's the common pattern?`,
      hint: "Helps Suhaina decide whether to tighten ad targeting.",
    });
    questions.push({
      id: "l1_handoff_speed",
      question: `What's slowing you down from transferring qualified leads to L2 the same day they land?`,
      hint: "Tool friction? Waiting for documents? Be candid.",
    });
  }
  // Always-on closing question
  questions.push({
    id: "ask_for_help",
    question: `What's one thing you'd like Suhaina (or the team) to do for you this week to help you hit target?`,
    hint: "If nothing — say so. We'll know things are running clean.",
  });

  // Cap at 4 to keep the form quick.
  return {
    analysis,
    questions: questions.slice(0, 4),
    metrics: {
      role,
      totalLeads,
      won,
      target,
      conversionPct,
      openPipelineCount,
      openPipelineRevenue,
      gap: Math.max(0, gap),
    },
  };
}

/**
 * After the BDE submits answers, build a follow-up feedback markdown
 * by skimming the answers for known signals. Like the analysis above,
 * this is deterministic — pattern-match on keywords and link each match
 * to a concrete next step.
 */
export function buildBdeInsightFeedback(opts: {
  displayName: string;
  questions: InsightQuestion[];
  answers: Record<string, string>;
  metrics: BdeInsightSnapshot["metrics"];
}): string {
  const { displayName, questions, answers, metrics } = opts;
  const lines: string[] = [];
  lines.push(`**Got it, ${displayName}. Here's what I'm picking up from your answers and what I'd do next:**`);

  const allAnswerText = Object.values(answers).join(" ").toLowerCase();

  // Signal: budget / payment plan
  if (/budget|cost|fees?|price|expensive|cannot afford|can'?t afford|emi|installment/i.test(allAnswerText)) {
    lines.push(
      `- **Budget came up.** Offer a structured installment (₹X today + balance in 30 days). Confirm with Suhaina that the service supports the split, then propose it in writing — most "cost" objections fold when the payment shape changes.`,
    );
  }
  // Signal: documents / paperwork
  if (/document|paperwork|attestation|passport|certificate|degree|transcript/i.test(allAnswerText)) {
    lines.push(
      `- **Documents are stuck.** Send a one-page checklist with deadlines today; ping again on day 2 and day 4. Candidates who get a clear list close ~30% faster than those left to figure it out.`,
    );
  }
  // Signal: follow-up missed
  if (/follow.?up|callback|no answer|not picking|did not respond|did not answer|hasn'?t replied/i.test(allAnswerText)) {
    lines.push(
      `- **Follow-up cadence is leaking deals.** Block 30 minutes tomorrow morning to call every "quote sent" candidate from the past 7 days who hasn't replied. WhatsApp + voice — voice converts twice as well.`,
    );
  }
  // Signal: language / explanation / confusion
  if (/explain|confuse|understand|not clear|process|how to/i.test(allAnswerText)) {
    lines.push(
      `- **Candidates are confused on process.** Record a 90-second voice note explaining the next 3 steps and reuse it. Saves time and resets expectations the same day.`,
    );
  }
  // Signal: source quality / unqualified
  if (/unqualified|not interested|wrong|spam|fake|bad lead/i.test(allAnswerText)) {
    lines.push(
      `- **Lead quality flag.** Note the source and pattern (e.g. "Meta after 8pm, ages 18-21") — Suhaina can adjust the audience or send the trend to the agency.`,
    );
  }
  // Signal: help request to Suhaina / team
  if (/suhaina|help|need|support|stuck/i.test(allAnswerText)) {
    lines.push(
      `- **You asked for help.** Suhaina sees this dashboard — leave the ask specific and concrete and you'll get a response within the day.`,
    );
  }

  // If no signal matched, fall back to a generic but data-anchored push.
  if (lines.length === 1) {
    lines.push(
      `- No specific signal jumped out, but the math is the math: you need ${Math.max(1, metrics.gap)} more close${metrics.gap === 1 ? "" : "s"} this month. Pick your top-3 pipeline candidates and put a concrete next-step + date next to each before end of day.`,
    );
  }

  // Closing nudge based on overall position
  if (metrics.target > 0 && metrics.won + metrics.openPipelineCount < metrics.target) {
    lines.push(
      `\n**Bottom line:** you're ${metrics.gap} short of forecast. Even one extra close this week resets the trajectory — pick the warmest open deal and don't let the day end without a status update from them.`,
    );
  } else if (metrics.target > 0) {
    lines.push(
      `\n**Bottom line:** forecast clears target. Don't ease off — pipeline drops fast once focus moves elsewhere. Keep one new candidate going into pipeline every day this week.`,
    );
  }

  // Acknowledge each non-empty answer briefly so the BDE knows the
  // system actually read what they wrote.
  const acknowledged = questions.filter((q) => (answers[q.id] ?? "").trim().length > 0);
  if (acknowledged.length > 0) {
    lines.push(`\n*Logged your answers to ${acknowledged.length} question${acknowledged.length === 1 ? "" : "s"} — Suhaina sees them on her dashboard.*`);
  }

  return lines.join("\n");
}
