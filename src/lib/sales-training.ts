// Sales Consultant Training & Development — pure helpers (no Prisma), shared by
// the HR authoring pages, the learner pages and the API routes.

/** A video counts as watched once this share of its length has actually played. */
export const WATCH_THRESHOLD_PCT = 90;

export type TrainingVideo = { id: string; title: string; youtubeId: string };

export type QuestionKind = "single" | "multi";

export type TrainingQuestion = {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  correct: number[];
  points: number;
  explanation: string | null;
};

/** One question as graded inside an attempt — the frozen snapshot. */
export type GradedQuestion = TrainingQuestion & {
  chosen: number[];
  earned: number;
  isCorrect: boolean;
};

export type GradeResult = {
  graded: GradedQuestion[];
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
};

/**
 * Pull the 11-char video id out of any YouTube link people paste: watch?v=,
 * youtu.be/, /embed/, /shorts/, /live/, youtube-nocookie, or a bare id.
 */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v");
    if (!id) {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      id = m ? m[1] : null;
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

/**
 * Score a submission. All-or-nothing per question: a multi-select question
 * earns its points only when exactly the right options are ticked — partial
 * credit would reward ticking everything.
 */
export function gradeAttempt(
  questions: TrainingQuestion[],
  answers: Record<string, number[]>,
  passMark: number,
): GradeResult {
  let score = 0;
  let maxScore = 0;
  const graded = questions.map((q) => {
    const chosen = [...new Set(answers[q.id] ?? [])]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length)
      .sort((a, b) => a - b);
    const isCorrect = chosen.length > 0 && sameSet(chosen, q.correct);
    const earned = isCorrect ? q.points : 0;
    score += earned;
    maxScore += q.points;
    return { ...q, chosen, earned, isCorrect };
  });
  const percent = maxScore === 0 ? 0 : Math.round((score * 100) / maxScore);
  return { graded, score, maxScore, percent, passed: maxScore > 0 && percent >= passMark };
}

export type Range = [number, number];

/** Union of second-ranges, sorted and merged (touching spans join up). */
export function mergeRanges(ranges: Range[]): Range[] {
  const clean = ranges
    .filter((r) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]))
    .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.max(0, Math.max(a, b))] as Range)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function watchedPct(ranges: Range[], durationSec: number): number {
  if (durationSec <= 0) return 0;
  const covered = mergeRanges(ranges).reduce((sum, [a, b]) => sum + (Math.min(b, durationSec) - Math.min(a, durationSec)), 0);
  return Math.min(100, Math.floor((covered * 100) / durationSec));
}

/**
 * Bulk question import. Blocks separated by a blank line:
 *
 *   What is the first step when a lead says "too expensive"?
 *   A) Offer a discount
 *   *B) Ask what they are comparing against
 *   C) End the call
 *   Explanation: Understand the objection before answering it.
 *   Points: 2
 *
 * A leading `*` marks a right option; two or more right options make the
 * question multi-select. `Explanation:` and `Points:` lines are optional.
 */
export function parseBulkQuestions(text: string): { questions: Omit<TrainingQuestion, "id">[]; errors: string[] } {
  const questions: Omit<TrainingQuestion, "id">[] = [];
  const errors: string[] = [];
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  blocks.forEach((block, bi) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const promptLines: string[] = [];
    const options: string[] = [];
    const correct: number[] = [];
    let explanation: string | null = null;
    let points = 1;
    for (const line of lines) {
      const opt = line.match(/^(\*)?\s*([A-Za-z]|\d{1,2})[).:]\s+(.+)$/);
      const exp = line.match(/^explanation\s*:\s*(.+)$/i);
      const pts = line.match(/^points?\s*:\s*(\d+)$/i);
      if (exp) explanation = exp[1].trim();
      else if (pts) points = Math.max(1, Math.min(100, Number(pts[1])));
      else if (opt && (options.length > 0 || promptLines.length > 0)) {
        if (opt[1]) correct.push(options.length);
        options.push(opt[3].trim());
      } else if (options.length === 0) {
        promptLines.push(line.replace(/^(q(uestion)?\s*\d*\s*[.:)]\s*|\d+\s*[.)]\s*)/i, ""));
      } else {
        errors.push(`Question ${bi + 1}: unexpected line after the options — "${line}"`);
      }
    }
    const prompt = promptLines.join(" ").trim();
    if (!prompt) return void errors.push(`Question ${bi + 1}: no question text.`);
    if (options.length < 2) return void errors.push(`Question ${bi + 1}: needs at least two options (A) … B) …).`);
    if (correct.length === 0) return void errors.push(`Question ${bi + 1}: mark the right option with a leading *.`);
    questions.push({
      kind: correct.length > 1 ? "multi" : "single",
      prompt,
      options,
      correct,
      points,
      explanation,
    });
  });
  return { questions, errors };
}

/** Learner-facing status of one module. */
export type ModuleStatus = "not_started" | "in_progress" | "passed" | "failed";

export function moduleStatus(opts: {
  attempts: number;
  bestPassed: boolean;
  maxAttempts: number | null;
  anyWatchProgress: boolean;
}): ModuleStatus {
  if (opts.bestPassed) return "passed";
  if (opts.maxAttempts != null && opts.attempts >= opts.maxAttempts) return "failed";
  if (opts.attempts > 0 || opts.anyWatchProgress) return "in_progress";
  return "not_started";
}

export const MODULE_STATUS_LABEL: Record<ModuleStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  passed: "Passed",
  failed: "Out of attempts",
};
