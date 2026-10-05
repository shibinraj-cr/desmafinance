"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import { Bar, btnGhost, btnPrimary, Pill } from "@/components/sales-training/ui";
import { YouTubeTracker } from "@/components/sales-training/YouTubeTracker";
import { WATCH_THRESHOLD_PCT, type QuestionKind } from "@/lib/sales-training";
import type { LearnerGradedQuestion } from "@/lib/sales-training-db";

type Video = { id: string; title: string; youtubeId: string; pct: number; completed: boolean };
type Q = { id: string; kind: QuestionKind; prompt: string; options: string[]; points: number };
type Review = {
  percent: number;
  score: number;
  maxScore: number;
  passed: boolean;
  submittedAt?: string;
  questions: LearnerGradedQuestion[];
};

function ReviewList({ questions }: { questions: LearnerGradedQuestion[] }) {
  return (
    <ol className="space-y-sm">
      {questions.map((q, i) => (
        <li key={q.id} className={"border rounded p-sm " + (q.isCorrect ? "border-green-300 bg-green-50/40" : "border-red-300 bg-red-50/40")}>
          <div className="flex items-start gap-sm">
            <span className={"material-symbols-outlined text-[18px] " + (q.isCorrect ? "text-green-700" : "text-red-700")}>
              {q.isCorrect ? "check_circle" : "cancel"}
            </span>
            <p className="flex-1 font-semibold text-label-sm">
              {i + 1}. {q.prompt}
            </p>
          </div>
          <ul className="pl-lg mt-xs space-y-[2px] text-label-sm">
            {q.options.map((o, oi) => {
              const chose = q.chosen.includes(oi);
              const right = q.correct?.includes(oi);
              return (
                <li key={oi} className={right ? "text-green-800 font-semibold" : chose ? (q.isCorrect ? "" : "text-red-700") : "text-on-surface-variant"}>
                  {chose ? "●" : "○"} {o}
                  {right ? " ✓" : ""}
                </li>
              );
            })}
          </ul>
          {q.explanation && <p className="pl-lg mt-xs text-label-sm text-on-surface-variant italic">{q.explanation}</p>}
        </li>
      ))}
    </ol>
  );
}

export function ModulePlayer({
  moduleId,
  nextModuleId,
  passMark,
  maxAttempts,
  requireWatch,
  videos: initialVideos,
  questions,
  attemptsUsed,
  state,
  review,
}: {
  moduleId: string;
  nextModuleId: string | null;
  passMark: number;
  maxAttempts: number | null;
  requireWatch: boolean;
  videos: Video[];
  questions: Q[];
  attemptsUsed: number;
  state: "open" | "passed" | "out";
  review: Review | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [videos, setVideos] = useState(initialVideos);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [result, setResult] = useState<(Review & { attemptsUsed: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const allWatched = videos.every((v) => v.completed);
  const locked = requireWatch && !allWatched;
  const answered = questions.filter((q) => (answers[q.id] ?? []).length > 0).length;
  const used = result?.attemptsUsed ?? attemptsUsed;
  const left = maxAttempts != null ? Math.max(0, maxAttempts - used) : null;

  function pick(q: Q, oi: number) {
    const cur = answers[q.id] ?? [];
    const next = q.kind === "single" ? [oi] : cur.includes(oi) ? cur.filter((x) => x !== oi) : [...cur, oi];
    setAnswers({ ...answers, [q.id]: next });
  }

  async function submit() {
    if (answered < questions.length && !confirm(`${questions.length - answered} question(s) unanswered — they'll count as wrong. Submit anyway?`)) return;
    setError(null);
    setSubmitting(true);
    const res = await fetch(`/api/me/sales-training/${moduleId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    setSubmitting(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.error || "Couldn't submit — try again.");
    setResult(j);
    window.scrollTo({ top: document.getElementById("quiz")?.offsetTop ?? 0, behavior: "smooth" });
    // A pass or a final failure changes what the page shows on reload.
    if (j.passed || (maxAttempts != null && j.attemptsUsed >= maxAttempts)) start(() => router.refresh());
  }

  return (
    <>
      {videos.length > 0 && (
        <Section title={`Watch (${videos.filter((v) => v.completed).length}/${videos.length})`}>
          <div className="space-y-lg">
            {videos.map((v, i) => (
              <div key={v.id}>
                <div className="flex items-center gap-sm mb-sm">
                  <span className="font-semibold text-on-surface">
                    {i + 1}. {v.title}
                  </span>
                  {v.completed ? <Pill tone="green">Watched</Pill> : <Pill tone="grey">{v.pct}% watched</Pill>}
                </div>
                <div className="max-w-3xl">
                  <YouTubeTracker
                    videoId={v.id}
                    youtubeId={v.youtubeId}
                    watchUrl={`/api/me/sales-training/${moduleId}/watch`}
                    onProgress={(pct, completed) =>
                      setVideos((vs) => vs.map((x) => (x.id === v.id ? { ...x, pct: Math.max(x.pct, pct), completed: x.completed || completed } : x)))
                    }
                  />
                  {!v.completed && (
                    <div className="mt-xs">
                      <Bar pct={(v.pct * 100) / WATCH_THRESHOLD_PCT} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div id="quiz">
        <Section
          title="Quiz"
          action={
            <span className="text-label-sm text-on-surface-variant">
              {questions.length} questions · pass {passMark}%{left != null ? ` · ${left} attempt(s) left` : ""}
            </span>
          }
        >
          {state === "passed" && review ? (
            <div className="space-y-md">
              <div className="flex flex-wrap items-center gap-sm">
                <span className="material-symbols-outlined text-green-700">verified</span>
                <p className="font-bold text-green-800">
                  Passed with {review.percent}% ({review.score}/{review.maxScore})
                </p>
                <div className="flex-1" />
                {nextModuleId ? (
                  <Link href={`/me/sales-training/${nextModuleId}`} className={btnPrimary}>
                    Next module →
                  </Link>
                ) : (
                  <Link href="/me/sales-training" className={btnGhost}>
                    Back to all modules
                  </Link>
                )}
              </div>
              <ReviewList questions={review.questions} />
            </div>
          ) : state === "out" && review ? (
            <div className="space-y-md">
              <p className="font-bold text-red-700">
                You&apos;ve used all {maxAttempts} attempts — best was {review.percent}%. Ask HR to reset the module so you can try again.
              </p>
              <ReviewList questions={review.questions} />
            </div>
          ) : result ? (
            <div className="space-y-md">
              <p className={"font-bold " + (result.passed ? "text-green-800" : "text-red-700")}>
                You scored {result.percent}% ({result.score}/{result.maxScore}).{" "}
                {result.passed ? "Passed — well done!" : `You need ${passMark}% to pass.`}
              </p>
              {!result.passed && (
                <p className="text-label-sm text-on-surface-variant">
                  Wrong answers are marked below; the right ones are shown once you pass
                  {maxAttempts ? " or run out of attempts" : ""}. Re-watch the videos if you need to.
                </p>
              )}
              <ReviewList questions={result.questions} />
              {!result.passed && (left == null || left > 0) && (
                <button
                  className={btnPrimary}
                  onClick={() => {
                    setResult(null);
                    setAnswers({});
                  }}
                >
                  Try again
                </button>
              )}
            </div>
          ) : locked ? (
            <div className="py-lg text-center text-on-surface-variant">
              <span className="material-symbols-outlined text-[32px]">lock</span>
              <p className="mt-xs">
                Watch every video (at least {WATCH_THRESHOLD_PCT}% of each) to unlock the quiz. Skipping ahead doesn&apos;t count.
              </p>
            </div>
          ) : (
            <div className="space-y-md">
              {review && !review.passed && (
                <p className="text-label-sm text-on-surface-variant">
                  Last attempt: {review.percent}% on {new Date(review.submittedAt!).toLocaleDateString("en-IN")}.
                </p>
              )}
              {questions.map((q, i) => (
                <fieldset key={q.id} className="border border-outline-variant rounded p-md">
                  <legend className="px-xs text-[11px] text-on-surface-variant">
                    {q.kind === "multi" ? "Tick all that apply" : "Choose one"} · {q.points} pt
                  </legend>
                  <p className="font-semibold mb-sm">
                    {i + 1}. {q.prompt}
                  </p>
                  <div className="space-y-xs">
                    {q.options.map((o, oi) => (
                      <label key={oi} className="flex items-start gap-sm text-body-md cursor-pointer rounded px-xs py-[2px] hover:bg-surface-container">
                        <input
                          className="mt-[5px]"
                          type={q.kind === "multi" ? "checkbox" : "radio"}
                          name={q.id}
                          checked={(answers[q.id] ?? []).includes(oi)}
                          onChange={() => pick(q, oi)}
                        />
                        {o}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div className="flex items-center gap-sm">
                <button className={btnPrimary} disabled={submitting || pending || answered === 0} onClick={submit}>
                  {submitting ? "Submitting…" : "Submit answers"}
                </button>
                <span className="text-label-sm text-on-surface-variant">
                  {answered}/{questions.length} answered
                </span>
              </div>
              {error && <p className="text-red-700 text-label-sm">{error}</p>}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
