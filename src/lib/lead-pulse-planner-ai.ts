/**
 * AI layer for the Growth Planner. Claude turns the *already-computed*
 * deterministic plan into a readable recommendation and answers free-form
 * what-if questions. SERVER-ONLY (imports the Anthropic client).
 *
 * Hard rule baked into the prompt: the model must use the numbers it is given
 * verbatim and never recompute headcount/leads — the figures come from
 * computePlan() and are the source of truth. When no ANTHROPIC_API_KEY is set,
 * every entrypoint falls back to a deterministic rule-based narrative so the
 * feature works with zero configuration.
 */
import { getAnthropic, isAiEnabled, PLANNER_AI_MODEL } from "./anthropic";
import type { PlannerBaseline } from "./lead-pulse-metrics";
import type { PlannerOutput } from "./lead-pulse-planner";

export type PlannerAiResult = {
  markdown: string;
  aiEnabled: boolean;
  model: string | null;
};

const SYSTEM_PROMPT = `You are a growth-planning analyst for "Lead Pulse", the sales/admissions pipeline of an education company. The team runs a two-tier funnel: L1 BDEs generate and qualify leads, then hand off to L2 BDEs who quote and close enrollments.

You are given a DETERMINISTIC plan computed by the app's engine plus the historic baseline it was derived from. Your job is to explain and advise — NOT to do math.

Strict rules:
- Use the provided numbers EXACTLY as given. Never recompute or invent lead counts, headcount, or percentages.
- Be concise and concrete. Prefer short markdown with bold labels and tight bullets.
- Ground every recommendation in the baseline data (e.g. name the best/worst converting source by its actual %).
- Indian number formatting and the ₹ symbol are fine. No preamble like "Sure" — start with the substance.`;

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

/** Compact JSON the model reasons over — keeps tokens low and numbers exact. */
function planContext(baseline: PlannerBaseline, plan: PlannerOutput) {
  return {
    target_enrollments_per_month: plan.target,
    historic_window: baseline.windowLabel,
    months_analyzed: baseline.monthsAnalyzed,
    required: {
      total_leads_per_month: plan.requiredTotalLeads,
      l1_leads: plan.requiredL1Leads,
      l2_leads: plan.requiredL2Leads,
      direct_leads: plan.requiredDirect,
      l1_bdes: plan.requiredL1Bdes,
      l2_bdes: plan.requiredL2Bdes,
    },
    current_roster: baseline.roster,
    bde_gap: { l1: plan.l1Gap, l2: plan.l2Gap },
    rates_pct: baseline.rates,
    capacity: baseline.capacity,
    meta_budget: plan.meta
      ? {
          // Blended: cost per qualified (L2) lead = Meta spend ÷ qualified leads.
          cost_per_qualified_lead_inr: plan.meta.costPerQualifiedLead,
          required_qualified_leads_per_month: plan.meta.requiredQualifiedLeadsPerMonth,
          required_meta_budget_per_month_inr: plan.meta.requiredBudgetPerMonth,
          current_qualified_leads_per_month: plan.meta.currentQualifiedLeadsPerMonth,
          current_meta_spend_per_month_inr: plan.meta.currentSpendPerMonth,
          budget_delta_per_month_inr: plan.meta.budgetDeltaPerMonth,
        }
      : null,
    warnings: plan.warnings,
    sources: baseline.sources.map((s) => ({
      source: s.sourceLabel,
      avg_monthly_leads: s.avgMonthlyLeads,
      l2_conversion_pct: s.l2ConversionPct,
      avg_monthly_won: s.avgMonthlyWon,
    })),
  };
}

async function callClaude(userContent: string): Promise<string> {
  const client = getAnthropic();
  const msg = await client.messages.create({
    model: PLANNER_AI_MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  });
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

// ── Recommendation ────────────────────────────────────────────────────

export async function generatePlanNarrative(
  baseline: PlannerBaseline,
  plan: PlannerOutput,
): Promise<PlannerAiResult> {
  if (!isAiEnabled()) {
    return { markdown: heuristicNarrative(baseline, plan), aiEnabled: false, model: null };
  }
  try {
    const userContent = `Here is the computed plan and baseline:\n\n${JSON.stringify(
      planContext(baseline, plan),
      null,
      2,
    )}\n\nWrite a recommendation with these sections (markdown):\n**Bottom line** — one sentence restating the target and the total leads/month required.\n**Meta budget** — Meta is the controllable lever: state the ₹/month Meta ad budget needed (required_meta_budget_per_month_inr = required_qualified_leads_per_month × cost_per_qualified_lead_inr) and how it compares to current spend (budget_delta). If meta_budget is null or cost_per_qualified_lead_inr is null, say no Meta spend is recorded for the window yet and to enter this month's Meta spend in the planner.\n**Hiring** — L1 and L2 headcount needed vs current, and whether to hire or where there's headroom.\n**Where to focus** — beyond Meta, any non-Meta source worth scaling or a weak source to fix (name them + conversion %).\n**Risks** — the biggest assumption or gap that could break the plan. Keep the whole thing under ~190 words.`;
    const markdown = await callClaude(userContent);
    return { markdown: markdown || heuristicNarrative(baseline, plan), aiEnabled: true, model: PLANNER_AI_MODEL };
  } catch {
    // Network/key/billing failure → never break the page; fall back silently.
    return { markdown: heuristicNarrative(baseline, plan), aiEnabled: false, model: null };
  }
}

// ── What-if Q&A ───────────────────────────────────────────────────────

export async function answerWhatIf(
  baseline: PlannerBaseline,
  plan: PlannerOutput,
  question: string,
): Promise<PlannerAiResult> {
  const q = question.trim().slice(0, 600);
  if (!isAiEnabled()) {
    return { markdown: heuristicWhatIf(baseline, plan, q), aiEnabled: false, model: null };
  }
  try {
    const userContent = `Current scenario (already recomputed by the engine for any numbers in the question):\n\n${JSON.stringify(
      planContext(baseline, plan),
      null,
      2,
    )}\n\nThe user asks: "${q}"\n\nAnswer in 2–4 short sentences (markdown allowed). Use the numbers above; if the question implies a change the figures already reflect it. If it asks for something the data can't support, say so briefly.`;
    const markdown = await callClaude(userContent);
    return { markdown: markdown || heuristicWhatIf(baseline, plan, q), aiEnabled: true, model: PLANNER_AI_MODEL };
  } catch {
    return { markdown: heuristicWhatIf(baseline, plan, q), aiEnabled: false, model: null };
  }
}

// ── Deterministic fallbacks (no key / API failure) ────────────────────

/** Best converting source with a meaningful lead base. */
function pickBestSource(baseline: PlannerBaseline) {
  return baseline.sources
    .filter((s) => s.avgMonthlyLeads >= 5 && s.l2ConversionPct != null)
    .sort((a, b) => (b.l2ConversionPct ?? 0) - (a.l2ConversionPct ?? 0))[0];
}
function pickWeakSource(baseline: PlannerBaseline) {
  return baseline.sources
    .filter((s) => s.avgMonthlyLeads >= 5 && s.l2ConversionPct != null)
    .sort((a, b) => (a.l2ConversionPct ?? 0) - (b.l2ConversionPct ?? 0))[0];
}

export function heuristicNarrative(baseline: PlannerBaseline, plan: PlannerOutput): string {
  if (!plan.feasible || plan.target <= 0) {
    const why = plan.warnings[0] ?? "Set a target above zero to size the plan.";
    return `**Can't size this plan yet.** ${why}`;
  }
  const lines: string[] = [];
  lines.push(
    `**Bottom line** — To reach **${fmt(plan.target)} enrollments/month**, you need about **${fmt(
      plan.requiredTotalLeads,
    )} leads/month** (${fmt(plan.requiredL1Leads)} via L1 + ${fmt(plan.requiredDirect)} direct to L2), based on your ${baseline.windowLabel} rates.`,
  );

  if (plan.meta) {
    const m = plan.meta;
    if (m.costPerQualifiedLead == null) {
      lines.push(
        `**Meta budget** — Hitting this target needs **${fmt(m.requiredQualifiedLeadsPerMonth)} qualified leads/month**, but no Meta spend is recorded for the ${baseline.windowLabel} window yet, so the cost-per-qualified-lead can't be derived. Enter this month's Meta spend in the planner to size the budget.`,
      );
    } else {
      const delta =
        m.budgetDeltaPerMonth == null
          ? ""
          : m.budgetDeltaPerMonth > 0
            ? ` — **₹${fmt(m.budgetDeltaPerMonth)}/mo more** than today's ₹${fmt(m.currentSpendPerMonth)}`
            : m.budgetDeltaPerMonth < 0
              ? ` — ₹${fmt(Math.abs(m.budgetDeltaPerMonth))}/mo *less* than today's ₹${fmt(m.currentSpendPerMonth)}`
              : ` — about the same as today`;
      lines.push(
        `**Meta budget** — Meta is the lever: **${fmt(m.requiredQualifiedLeadsPerMonth)} qualified leads/month** at ₹${fmt(
          m.costPerQualifiedLead,
        )}/qualified lead ⇒ **₹${fmt(m.requiredBudgetPerMonth ?? 0)}/month** ad budget${delta}.`,
      );
    }
  }

  const hireLine = (gap: number, role: string, need: number, have: number) =>
    gap > 0
      ? `hire **${gap} more ${role}** (need ${need}, have ${have})`
      : gap < 0
        ? `you have headroom — ${have} ${role} on staff vs ${need} needed`
        : `your ${have} ${role} exactly cover it`;
  lines.push(
    `**Hiring** — L1: ${hireLine(plan.l1Gap, "L1 BDE(s)", plan.requiredL1Bdes, baseline.roster.activeL1)}. ` +
      `L2: ${hireLine(plan.l2Gap, "L2 BDE(s)", plan.requiredL2Bdes, baseline.roster.activeL2)}.`,
  );

  const best = pickBestSource(baseline);
  const weak = pickWeakSource(baseline);
  if (best) {
    let focus = `**Where to focus** — Scale **${best.sourceLabel}** — your strongest converter at ${best.l2ConversionPct?.toFixed(1)}% L2 (${fmt(best.avgMonthlyLeads)} leads/mo today).`;
    if (weak && weak.sourceCode !== best.sourceCode) {
      focus += ` Fix or trim **${weak.sourceLabel}**, lagging at ${weak.l2ConversionPct?.toFixed(1)}%.`;
    }
    lines.push(focus);
  }

  lines.push(
    `**Risks** — The plan assumes conversion holds at L1 ${baseline.rates.l1ToTransferPct.toFixed(1)}% and L2 ${baseline.rates.l2ConvPct.toFixed(1)}%. ` +
      `A few points of slippage materially raises the leads (and budget) required.`,
  );
  return lines.join("\n\n");
}

export function heuristicWhatIf(baseline: PlannerBaseline, plan: PlannerOutput, question: string): string {
  void question;
  return (
    `**AI is offline** (no API key) — here's the built-in read of the current scenario. ` +
    `Target **${fmt(plan.target)} enrollments** needs **${fmt(plan.requiredTotalLeads)} leads/month**, ` +
    `**${fmt(plan.requiredL1Bdes)} L1** and **${fmt(plan.requiredL2Bdes)} L2** BDEs ` +
    `(${plan.l1Gap > 0 ? `${plan.l1Gap} L1 short` : "L1 covered"}, ${plan.l2Gap > 0 ? `${plan.l2Gap} L2 short` : "L2 covered"}). ` +
    `Adjust the sliders to model conversion or target changes — the numbers above already reflect the current settings.`
  );
}
