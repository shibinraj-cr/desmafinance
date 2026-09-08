/**
 * Bias guardrails (§4, non-negotiable).
 *
 * Name, age, gender, marital status, religion, caste, photo and address are
 * excluded from EVERY scoring prompt. Scoring reads experience, skills and the
 * candidate's own answers — nothing else.
 *
 * This is enforced by construction: `scoringPayload()` is the only thing a
 * scoring prompt is allowed to be built from, so a protected attribute cannot
 * be included by forgetting to strip it. Adding a field to the candidate record
 * does not silently add it to the prompt.
 */

export type ScoringCandidate = {
  currentTitle: string | null;
  currentEmployer: string | null;
  totalExperienceYears: number | null;
  noticePeriodDays: number | null;
  resumeText?: string | null;
  portfolioUrl?: string | null;
  linkedinUrl?: string | null;
};

export type ScoringPayload = {
  currentTitle: string | null;
  currentEmployer: string | null;
  totalExperienceYears: number | null;
  noticePeriodDays: number | null;
  resumeText: string | null;
  answers: { question: string; answer: string }[];
};

/**
 * Everything a scoring prompt may see, and nothing else. Free text is scrubbed
 * of the obvious identity lines a résumé header carries, because a CV's first
 * three lines are exactly the attributes we must not read.
 */
export function scoringPayload(
  candidate: ScoringCandidate,
  answers: { question: string; answer: string }[],
): ScoringPayload {
  return {
    currentTitle: candidate.currentTitle,
    currentEmployer: candidate.currentEmployer,
    totalExperienceYears: candidate.totalExperienceYears,
    noticePeriodDays: candidate.noticePeriodDays,
    resumeText: scrubIdentity(candidate.resumeText ?? null),
    answers: answers.map((a) => ({ question: a.question, answer: scrubIdentity(a.answer) ?? "" })),
  };
}

/** Attribute labels a résumé or answer commonly spells out. */
const IDENTITY_LINE = new RegExp(
  String.raw`^\s*(name|full name|father'?s name|mother'?s name|age|d\.?o\.?b\.?|date of birth|` +
    String.raw`sex|gender|marital status|religion|caste|community|nationality|photo|photograph|` +
    String.raw`address|permanent address|residential address|house name|pin ?code)\s*[:\-]\s*.*$`,
  "gim",
);

/**
 * Remove the labelled identity lines from free text. Deliberately conservative:
 * it strips lines that ANNOUNCE a protected attribute rather than trying to
 * detect one, because a clever detector that guesses at a name would fail on
 * exactly the names it matters most for.
 */
export function scrubIdentity(text: string | null): string | null {
  if (!text) return text;
  return text.replace(IDENTITY_LINE, "[redacted]").trim();
}

/** The instruction every scoring prompt carries, so the rule is also stated. */
export const BIAS_GUARDRAIL_INSTRUCTION =
  "Score only demonstrated experience, skills and the candidate's own answers. " +
  "You have not been given the candidate's name, age, gender, marital status, religion, " +
  "caste, photo or address, and you must not infer, guess at, or comment on any of them. " +
  "If a piece of evidence you would cite depends on one of those, omit it.";
