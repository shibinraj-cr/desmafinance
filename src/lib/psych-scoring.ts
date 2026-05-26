import { archetypes, type ArchetypeKey } from "./psych-archetypes";

export type Dim = "O" | "C" | "E" | "A" | "N";
export const DIMS: Dim[] = ["O", "C", "E", "A", "N"];

/** Seeded population norms used until we have enough live reports to derive our own. */
export const DEFAULT_NORMS: Record<Dim, { mean: number; sd: number }> = {
  O: { mean: 50, sd: 15 },
  C: { mean: 50, sd: 15 },
  E: { mean: 50, sd: 15 },
  A: { mean: 50, sd: 15 },
  N: { mean: 50, sd: 15 },
};

export type QuestionMeta = {
  id: string;
  dimension: "O" | "C" | "E" | "A" | "N" | "VALIDITY";
  reverseScored: boolean;
  validityPairId?: string | null;
};

export type RiskFlag = {
  code: string;
  label: string;
  severity: "info" | "warn" | "high";
  hrAction: string;
};

export type ScoreResult = {
  oceanRaw: Record<Dim, number>;
  oceanNormalized: Record<Dim, number>;
  oceanPercentile: Record<Dim, number>;
  attitudeIndex: number;
  attitudeClass: "Needs Attention" | "Moderate" | "Positive Attitude";
  profileType: ArchetypeKey;
  profileLabel: string;
  riskFlags: RiskFlag[];
  recommendations: string[];
  validityPassed: boolean;
  validityNotes: string | null;
};

/**
 * Standard normal CDF — used to translate a z-score into a percentile rank.
 * Abramowitz & Stegun 26.2.17 approximation; good to 5 decimals.
 */
function normalCdf(z: number): number {
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z);
  const t = 1 / (1 + p * x);
  const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-(x * x) / 2);
  const cdf = 1 - phi * (b1 * t + b2 * t ** 2 + b3 * t ** 3 + b4 * t ** 4 + b5 * t ** 5);
  return sign === 1 ? cdf : 1 - cdf;
}

function classifyAttitude(idx: number) {
  if (idx <= 40) return "Needs Attention" as const;
  if (idx <= 70) return "Moderate" as const;
  return "Positive Attitude" as const;
}

function pickArchetype(s: Record<Dim, number>): ArchetypeKey {
  const high = (v: number) => v >= 60;
  const low = (v: number) => v <= 40;

  if (high(s.C) && high(s.A) && !high(s.N)) return "COLLABORATIVE_DEPENDABLE";
  if (high(s.E) && low(s.A)) return "ASSERTIVE_CHALLENGER";
  if (high(s.N) && low(s.C)) return "AT_RISK_BURNOUT";
  if (high(s.O) && high(s.E)) return "INNOVATIVE_DRIVER";
  if (high(s.C) && low(s.N)) return "STEADY_ANCHOR";
  if (high(s.A) && high(s.E)) return "EMPATHETIC_HARMONISER";
  if (high(s.O) && low(s.E)) return "INDEPENDENT_THINKER";
  if (high(s.E) && low(s.N)) return "RESILIENT_CONNECTOR";
  if (high(s.C) && low(s.E)) return "RESERVED_PRECISIONIST";
  if (high(s.O) && !high(s.C)) return "ADAPTIVE_EXPLORER";
  if (high(s.C)) return "DISCIPLINED_EXECUTOR";
  return "CAUTIOUS_OBSERVER";
}

function buildRiskFlags(s: Record<Dim, number>, validityPassed: boolean, suspiciousFlags: string[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (s.N >= 75) {
    flags.push({
      code: "HIGH_NEUROTICISM",
      label: "Elevated stress response",
      severity: "warn",
      hrAction: "Consider a 1:1 wellbeing check-in and review workload.",
    });
  }
  if (s.N >= 60 && s.C <= 40) {
    flags.push({
      code: "BURNOUT_RISK",
      label: "Burnout risk profile",
      severity: "high",
      hrAction: "Pair with a structured manager; introduce clearer scope and shorter feedback loops.",
    });
  }
  if (s.A <= 30) {
    flags.push({
      code: "LOW_AGREEABLENESS",
      label: "Low agreeableness",
      severity: "info",
      hrAction: "Coach on stakeholder communication; suitable for roles needing firm negotiation.",
    });
  }
  if (s.C <= 30) {
    flags.push({
      code: "LOW_CONSCIENTIOUSNESS",
      label: "Low conscientiousness",
      severity: "warn",
      hrAction: "Set up shorter check-in cadence and clearer task definitions.",
    });
  }
  if (!validityPassed) {
    flags.push({
      code: "CONSISTENCY_FAILED",
      label: "Consistency check failed",
      severity: "warn",
      hrAction: "Treat results as low-confidence; consider re-administering with proctoring.",
    });
  }
  if (suspiciousFlags.includes("RUSHED")) {
    flags.push({
      code: "RUSHED",
      label: "Assessment completed unusually fast",
      severity: "info",
      hrAction: "Verify the response with a short follow-up conversation.",
    });
  }
  return flags;
}

function buildRecommendations(s: Record<Dim, number>): string[] {
  const recs: string[] = [];
  if (s.O <= 40) recs.push("Expose to cross-functional projects to broaden problem framings.");
  if (s.O >= 70) recs.push("Channel exploratory instinct into a defined R&D or innovation track.");
  if (s.C <= 40) recs.push("Introduce a shared task tracker and weekly delivery review.");
  if (s.C >= 70) recs.push("Trust with planning ownership and process design opportunities.");
  if (s.E <= 40) recs.push("Provide written-first communication channels and structured 1:1s.");
  if (s.E >= 70) recs.push("Surface in client-facing or stage presentation moments.");
  if (s.A <= 40) recs.push("Offer negotiation training; useful in deal-closing roles.");
  if (s.A >= 70) recs.push("Coach on giving direct feedback when stakes are high.");
  if (s.N >= 60) recs.push("Set up regular wellbeing check-ins and review workload distribution.");
  if (s.N <= 30) recs.push("Strong candidate for high-pressure or escalation roles.");
  // Always return 3–5; pad with a generic if needed.
  if (recs.length < 3) {
    recs.push("Use these results as a conversation starter, not a final verdict — review with the employee.");
  }
  return recs.slice(0, 5);
}

export function scoreAssignment(args: {
  responses: { questionId: string; value: number }[];
  questions: QuestionMeta[];
  populationNorms?: Record<Dim, { mean: number; sd: number }>;
  durationSeconds?: number | null;
}): ScoreResult {
  const norms = args.populationNorms ?? DEFAULT_NORMS;
  const valueByQ = new Map(args.responses.map((r) => [r.questionId, r.value]));

  // Per-dimension raw sums + per-dimension item count (in case the question
  // bank ever drifts from exactly 10 items per dimension).
  const raw: Record<Dim, number> = { O: 0, C: 0, E: 0, A: 0, N: 0 };
  const count: Record<Dim, number> = { O: 0, C: 0, E: 0, A: 0, N: 0 };

  for (const q of args.questions) {
    if (q.dimension === "VALIDITY") continue;
    const v = valueByQ.get(q.id);
    if (v == null) continue;
    const eff = q.reverseScored ? 6 - v : v;
    raw[q.dimension] += eff;
    count[q.dimension] += 1;
  }

  const normalized: Record<Dim, number> = { O: 0, C: 0, E: 0, A: 0, N: 0 };
  const percentile: Record<Dim, number> = { O: 0, C: 0, E: 0, A: 0, N: 0 };
  for (const d of DIMS) {
    const maxRaw = count[d] * 5;
    normalized[d] = maxRaw === 0 ? 0 : Math.round((raw[d] / maxRaw) * 100);
    const { mean, sd } = norms[d];
    const z = sd === 0 ? 0 : (normalized[d] - mean) / sd;
    percentile[d] = Math.round(normalCdf(z) * 100);
  }

  // Validity: average absolute difference across paired items. Pair members
  // are linked by validityPairId. We expect a small number of pairs (~3).
  const pairs = new Map<string, number[]>();
  for (const q of args.questions) {
    if (q.dimension !== "VALIDITY" || !q.validityPairId) continue;
    const v = valueByQ.get(q.id);
    if (v == null) continue;
    if (!pairs.has(q.validityPairId)) pairs.set(q.validityPairId, []);
    pairs.get(q.validityPairId)!.push(v);
  }
  let diffSum = 0;
  let diffN = 0;
  for (const arr of pairs.values()) {
    if (arr.length !== 2) continue;
    diffSum += Math.abs(arr[0] - arr[1]);
    diffN += 1;
  }
  const avgDiff = diffN === 0 ? 0 : diffSum / diffN;
  const validityPassed = diffN === 0 ? true : avgDiff <= 1.0;
  const validityNotes =
    diffN === 0
      ? null
      : `Avg paired difference: ${avgDiff.toFixed(2)} of 5 (pass ≤ 1.00).`;

  const suspiciousFlags: string[] = [];
  if (args.durationSeconds != null && args.durationSeconds < 4 * 60) {
    suspiciousFlags.push("RUSHED");
  }

  const profileType = pickArchetype(normalized);
  const profileLabel = archetypes[profileType].label;

  const attitudeIndex = Math.round(
    (normalized.A + normalized.C + (100 - normalized.N)) / 3,
  );
  const attitudeClass = classifyAttitude(attitudeIndex);

  const riskFlags = buildRiskFlags(normalized, validityPassed, suspiciousFlags);
  const recommendations = buildRecommendations(normalized);

  return {
    oceanRaw: raw,
    oceanNormalized: normalized,
    oceanPercentile: percentile,
    attitudeIndex,
    attitudeClass,
    profileType,
    profileLabel,
    riskFlags,
    recommendations,
    validityPassed,
    validityNotes,
  };
}

/** Exported separately so the submit handler can stash this on PsychReport.suspiciousFlags. */
export function computeSuspiciousFlags(durationSeconds: number | null | undefined): string[] {
  const flags: string[] = [];
  if (durationSeconds != null && durationSeconds < 4 * 60) flags.push("RUSHED");
  return flags;
}
