// The Meta lead form asks "What is your qualification?" as a multiple choice,
// and the answer reaches us as the option KEY ("bsn", "gnm", "pbsc", "msn",
// "others") inside Lead.extra. Nothing used to copy it into the lead's
// Qualification, so every Meta lead arrived blank and a BDE had to re-ask.
//
// This maps that one answer onto the CRM's own qualification list at the
// moment the lead is created. Pure — the caller loads the active list.
//
// Only the Meta question family is read ("What is your qualification?",
// "What is your current qualification?" and Meta's snake_case spelling of it).
// The plus-two campaign's "Educational Qualification?" is deliberately left
// out: its free-typed answers ("2", "12", "plus 2") disagreed with what BDEs
// later set on most leads.
import { isOtherQualification } from "./crm";
import { normalizeForMatch, type QualOption } from "./ig/extract";

const QUESTION = /^what is your (current )?qualification$/;

/** Is this lead-form column the Meta qualification question? */
export function isFormQualificationQuestion(key: string): boolean {
  return QUESTION.test(normalizeForMatch(key));
}

// Answer (normalised) → qualification label. Meta sends the option keys; the
// spelled-out forms are there in case a form is ever built with labels instead.
// "pbsc" is Post BSc, which the CRM records as PBSN (decided 10 Nov 2026).
const ANSWER_LABEL: Record<string, string> = {
  bsn: "BSN",
  "bsc nursing": "BSN",
  "b sc nursing": "BSN",
  pbsc: "PBSN",
  pbsn: "PBSN",
  "post bsc": "PBSN",
  "post bsc nursing": "PBSN",
  "post basic bsc nursing": "PBSN",
  msn: "MSN",
  "msc nursing": "MSN",
  "m sc nursing": "MSN",
  gnm: "GNM",
  "general nursing": "GNM",
  "general nursing and midwifery": "GNM",
  other: "Other",
  others: "Other",
};

/**
 * The qualification one answer names, from the CRM's list — or null.
 *
 * A known Meta option maps through ANSWER_LABEL; anything else must equal a
 * label on the list outright (so a new option such as "ahpra_rn" works once the
 * list has "AHPRA RN"). Never a guess: "yes", "not_sure" or a sentence stays blank.
 */
export function qualificationFromFormAnswer(answer: string | null | undefined, options: QualOption[]): QualOption | null {
  const norm = normalizeForMatch(answer ?? "");
  if (!norm) return null;
  const label = ANSWER_LABEL[norm];
  if (label && isOtherQualification(label)) return options.find((o) => isOtherQualification(o.label)) ?? null;
  const want = normalizeForMatch(label ?? norm);
  return options.find((o) => normalizeForMatch(o.label) === want) ?? null;
}

/** The qualification a lead's form answers name, read from its `extra` columns. */
export function qualificationFromForm(
  extra: Record<string, unknown> | null | undefined,
  options: QualOption[],
): QualOption | null {
  if (!extra) return null;
  for (const [key, value] of Object.entries(extra)) {
    if (!isFormQualificationQuestion(key)) continue;
    const found = qualificationFromFormAnswer(value == null ? null : String(value), options);
    if (found) return found;
  }
  return null;
}
