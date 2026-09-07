/**
 * Free, deterministic ranking of a parsed résumé against open requisitions.
 *
 * Deliberately NOT the AI rubric score, and the UI must never present it as
 * one. This is a cheap sort so a recruiter looks at the plausible ones first;
 * the rubric score is the thing with per-criterion evidence behind it, and it
 * costs credits. Conflating them would put an unexplainable number next to a
 * person's name.
 *
 * Because DESMA files résumés in a folder named for the role, the PRIMARY job
 * is already known. This exists for the secondary question — "who else in this
 * folder might suit the other opening?" — which is where a pile of CVs usually
 * hides its value.
 */

export type ParsedForMatch = {
  currentTitle: string | null;
  skills: string[];
  totalExperienceYears: number | null;
};

export type MatchableJob = {
  id: string;
  title: string;
  mustHaves: string[];
  niceToHaves: string[];
  seniority: string;
};

export type JobMatch = {
  jobId: string;
  title: string;
  /** 0-100. A ranking hint, not a rubric score. */
  fit: number;
  matchedMustHaves: string[];
  missingMustHaves: string[];
  matchedNiceToHaves: string[];
};

const STOP = new Set([
  "and","or","the","a","an","of","in","for","with","to","at","on","senior","junior","executive",
  "officer","associate","assistant","manager","lead","head","intern","sr","jr",
]);

/**
 * Words that carry no evidence on their own.
 *
 * Recruiters write "Communication Skill" and "client handling"; CVs say
 * "communication" and "client". Requiring every token meant a criterion phrased
 * the natural way could never be evidenced, so a strong candidate was reported
 * as missing four of five must-haves. These are stripped from a CRITERION
 * before matching — never from the résumé, where a real word is real evidence.
 */
const FILLER = new Set([
  "skill","skills","ability","abilities","knowledge","handling","management","experience",
  "good","strong","excellent","basic","working","proficiency","proficient","understanding",
  "hands","level","must","have","required","preferred",
]);

/** A criterion's content words — what actually has to appear in the résumé. */
export function criterionTokens(criterion: string): string[] {
  const all = [...tokenize(criterion)];
  const content = all.filter((t) => !FILLER.has(t));
  // If a criterion is ENTIRELY filler ("Good communication skills" is not, but
  // "Skills" alone is), fall back to the raw tokens rather than matching
  // everything by matching nothing.
  return content.length ? content : all;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      // A lone digit is kept for the same reason as in missingMustHaves: it is
      // often the entire requirement. Both sides must agree on this or a
      // criterion and a résumé tokenise differently.
      .filter((t) => (t.length > 1 || /\d/.test(t)) && !STOP.has(t)),
  );
}

/**
 * Does the résumé evidence a criterion? Same literal reading as
 * `missingMustHaves` in core.ts — every token of the criterion must appear
 * somewhere in the résumé's own words. A cleverer matcher that silently decides
 * is worse than an obvious one a recruiter can overrule.
 */
export function evidences(criterion: string, haystack: Set<string>): boolean {
  const needed = criterionTokens(criterion);
  if (!needed.length) return false;
  return needed.every((t) => haystack.has(t));
}

/**
 * Rank one résumé against several jobs.
 *
 * Weighting: must-haves carry most of it, because they are what a recruiter
 * screens on; nice-to-haves and a title resemblance break ties. A job with no
 * must-haves scores on title and nice-to-haves alone rather than a free 100 —
 * an empty rubric should not make everybody a perfect fit.
 */
export function rankJobs(parsed: ParsedForMatch, jobs: MatchableJob[]): JobMatch[] {
  const haystack = tokenize(
    [parsed.currentTitle ?? "", ...parsed.skills].join(" "),
  );

  return jobs
    .map((job) => {
      const matchedMust = job.mustHaves.filter((m) => evidences(m, haystack));
      const missingMust = job.mustHaves.filter((m) => !evidences(m, haystack));
      const matchedNice = job.niceToHaves.filter((m) => evidences(m, haystack));

      const mustScore = job.mustHaves.length
        ? matchedMust.length / job.mustHaves.length
        : 0;
      const niceScore = job.niceToHaves.length
        ? matchedNice.length / job.niceToHaves.length
        : 0;
      const titleScore = overlap(tokenize(job.title), haystack);

      // 60 / 25 / 15. A job with no must-haves tops out at 40, which is the
      // point: it has told us almost nothing to match on.
      const fit = Math.round(mustScore * 60 + niceScore * 25 + titleScore * 15);

      return {
        jobId: job.id,
        title: job.title,
        fit,
        matchedMustHaves: matchedMust,
        missingMustHaves: missingMust,
        matchedNiceToHaves: matchedNice,
      };
    })
    .sort((a, b) => b.fit - a.fit || a.title.localeCompare(b.title));
}

/** Fraction of `needle` present in `haystack`. */
function overlap(needle: Set<string>, haystack: Set<string>): number {
  if (!needle.size) return 0;
  let hits = 0;
  for (const t of needle) if (haystack.has(t)) hits++;
  return hits / needle.size;
}
