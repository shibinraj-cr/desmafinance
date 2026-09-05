import { unprocessable } from "@/lib/http-error";
import { getAiProvider } from "./provider";
import { meter } from "./credits";
import { loadCompanyProfile, profilePreamble } from "./company-profile";
import { SENIORITY_LABELS, WORK_TYPE_LABELS, EMPLOYMENT_TYPE_LABELS } from "../constants";
import type { Seniority, WorkType, EmploymentType } from "../constants";
import { compBandLabel } from "../core";

/**
 * Job-description drafting (§4.2). Produces a markdown JD plus must-haves and
 * nice-to-haves as STRUCTURED lists — the recruiter edits them as chips in the
 * wizard, and the must-haves become what screening reads. A prose blob the UI
 * then has to parse would put the screening criteria at the mercy of a regex.
 */

export type JobDraft = {
  descriptionMd: string;
  mustHaves: string[];
  niceToHaves: string[];
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["descriptionMd", "mustHaves", "niceToHaves"],
  properties: {
    descriptionMd: {
      type: "string",
      description:
        "The job description in markdown. Sections: what the role is, what the week looks like, " +
        "what good looks like at six months. 250-400 words. No emoji, no exclamation marks.",
    },
    mustHaves: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: { type: "string", description: "A short screen-out criterion, 2-5 words." },
    },
    niceToHaves: {
      type: "array",
      maxItems: 6,
      items: { type: "string", description: "A short bonus criterion, 2-5 words." },
    },
  },
} as const;

export async function draftJobDescription(input: {
  title: string;
  department: string;
  seniority: string;
  workType: string;
  employmentType: string;
  locationName?: string | null;
  compMinLakh?: number | null;
  compMaxLakh?: number | null;
  outline?: string | null;
  userId: string;
}): Promise<JobDraft> {
  const provider = getAiProvider();
  if (!provider) {
    throw unprocessable(
      "No AI key is configured. Write the first draft yourself — everything else about the job still works.",
      "ai_disabled",
    );
  }

  const profile = await loadCompanyProfile();
  const comp = compBandLabel(input.compMinLakh ?? null, input.compMaxLakh ?? null);

  const facts = [
    `Title: ${input.title}`,
    `Department: ${input.department}`,
    `Seniority: ${SENIORITY_LABELS[input.seniority as Seniority] ?? input.seniority}`,
    `Work type: ${WORK_TYPE_LABELS[input.workType as WorkType] ?? input.workType}`,
    `Employment type: ${EMPLOYMENT_TYPE_LABELS[input.employmentType as EmploymentType] ?? input.employmentType}`,
    input.locationName ? `Location: ${input.locationName}` : null,
    comp ? `Compensation band: ${comp}` : null,
    input.outline?.trim() ? `The recruiter's outline to work from:\n${input.outline.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await meter({ feature: "job_description", userId: input.userId }, () =>
    provider.generateJson({
      system:
        "You write job descriptions for an Indian nursing-migration consultancy hiring its own " +
        "staff. Write plainly and concretely: what the person will actually do in a week, and " +
        "what good looks like. Never invent benefits, equity, headcount or claims you were not " +
        "given. Never mention age, gender, marital status, religion, caste or appearance, and " +
        "never write a requirement that screens on them. Salary is in lakh per year." +
        profilePreamble(profile),
      user: facts,
      schema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 3000,
    }),
  );

  const data = result.data as Partial<JobDraft>;
  if (!data.descriptionMd?.trim()) {
    throw unprocessable("The draft came back empty. Try again.", "empty_draft");
  }
  return {
    descriptionMd: data.descriptionMd.trim(),
    mustHaves: dedupeChips(data.mustHaves ?? []),
    niceToHaves: dedupeChips(data.niceToHaves ?? []),
  };
}

/** Trim, drop blanks, and fold case-insensitive duplicates. */
export function dedupeChips(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const v = item.trim().replace(/\s+/g, " ");
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 12);
}
