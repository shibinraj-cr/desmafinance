"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Q = { id: string; prompt: string; choices: string[] };

export function TrainingPlayer({
  trainingId,
  quiz,
  alreadyPassed,
}: {
  trainingId: string;
  quiz: Q[];
  alreadyPassed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const res = await fetch(`/api/me/trainings/${trainingId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers, watchedPct: 100 }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "submit failed");
      return;
    }
    const j = await res.json();
    setResult({ score: j.score, passed: j.passed });
    start(() => router.refresh());
  }

  return (
    <div className="space-y-md">
      {quiz.map((q, i) => (
        <div key={q.id} className="border border-outline-variant rounded p-sm">
          <p className="font-semibold mb-xs">
            Q{i + 1}. {q.prompt}
          </p>
          {q.choices.map((c, ci) => (
            <label key={ci} className="flex items-center gap-xs text-label-sm py-xs">
              <input
                type="radio"
                name={q.id}
                checked={answers[q.id] === ci}
                onChange={() => setAnswers({ ...answers, [q.id]: ci })}
                disabled={alreadyPassed}
              />
              {c}
            </label>
          ))}
        </div>
      ))}
      {!alreadyPassed && (
        <button
          onClick={submit}
          disabled={pending || Object.keys(answers).length < quiz.length}
          className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
        >
          Submit answers
        </button>
      )}
      {result && (
        <p
          className={
            "text-label-sm font-bold " + (result.passed ? "text-green-700" : "text-red-700")
          }
        >
          You scored {result.score}%.{" "}
          {result.passed ? "Passed — well done!" : "Below passing — review the material and retry."}
        </p>
      )}
      {error && <p className="text-red-700 text-label-sm">{error}</p>}
    </div>
  );
}
