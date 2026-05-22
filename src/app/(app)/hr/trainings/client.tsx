"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Q = { id: string; prompt: string; choices: string[]; correctIndex: number };

type Training = {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  passingScore: number;
  status: string;
  quiz: Q[];
  progress: { empCode: string; name: string; score: number | null; passed: boolean; attempts: number; completedAt: string | null }[];
};

const BLANK = {
  title: "",
  description: "",
  videoUrl: "",
  passingScore: 70,
  publish: false,
  quiz: [] as Q[],
};

function newQ(): Q {
  return { id: crypto.randomUUID(), prompt: "", choices: ["", ""], correctIndex: 0 };
}

export function TrainingsClient({ trainings, canEdit }: { trainings: Training[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const res = await fetch("/api/hr/trainings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setDraft(BLANK);
    start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {canEdit && (
        <Section title="New training">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-sm">
            <label className="flex flex-col gap-xs md:col-span-2">
              <span className="text-caption text-on-surface-variant">Title</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs md:col-span-2">
              <span className="text-caption text-on-surface-variant">YouTube URL</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.videoUrl}
                onChange={(e) => setDraft({ ...draft, videoUrl: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs md:col-span-3">
              <span className="text-caption text-on-surface-variant">Description</span>
              <textarea
                rows={2}
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Passing score %</span>
              <input
                type="number"
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.passingScore}
                onChange={(e) => setDraft({ ...draft, passingScore: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="mt-md">
            <p className="text-label-sm font-semibold mb-sm">Quiz</p>
            {draft.quiz.map((q, qi) => (
              <div key={q.id} className="border border-outline-variant rounded p-sm mb-sm">
                <label className="flex flex-col gap-xs mb-xs">
                  <span className="text-caption text-on-surface-variant">Question {qi + 1}</span>
                  <input
                    className="px-sm py-sm rounded border border-outline-variant bg-surface"
                    value={q.prompt}
                    onChange={(e) => {
                      const copy = [...draft.quiz];
                      copy[qi] = { ...q, prompt: e.target.value };
                      setDraft({ ...draft, quiz: copy });
                    }}
                  />
                </label>
                {q.choices.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-xs mb-xs">
                    <input
                      type="radio"
                      name={`correct-${qi}`}
                      checked={q.correctIndex === ci}
                      onChange={() => {
                        const copy = [...draft.quiz];
                        copy[qi] = { ...q, correctIndex: ci };
                        setDraft({ ...draft, quiz: copy });
                      }}
                    />
                    <input
                      placeholder={`Choice ${ci + 1}`}
                      className="flex-1 px-sm py-xs rounded border border-outline-variant bg-surface text-label-sm"
                      value={c}
                      onChange={(e) => {
                        const copy = [...draft.quiz];
                        const choicesCopy = [...q.choices];
                        choicesCopy[ci] = e.target.value;
                        copy[qi] = { ...q, choices: choicesCopy };
                        setDraft({ ...draft, quiz: copy });
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const copy = [...draft.quiz];
                        const choicesCopy = q.choices.filter((_, i) => i !== ci);
                        copy[qi] = { ...q, choices: choicesCopy, correctIndex: Math.min(q.correctIndex, choicesCopy.length - 1) };
                        setDraft({ ...draft, quiz: copy });
                      }}
                      className="text-red-700 text-label-sm"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-blue-700 text-label-sm underline"
                  onClick={() => {
                    const copy = [...draft.quiz];
                    copy[qi] = { ...q, choices: [...q.choices, ""] };
                    setDraft({ ...draft, quiz: copy });
                  }}
                >
                  + Add choice
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDraft({ ...draft, quiz: [...draft.quiz, newQ()] })}
              className="text-blue-700 underline text-label-sm"
            >
              + Add question
            </button>
          </div>
          <label className="flex items-center gap-xs text-label-sm mt-md">
            <input
              type="checkbox"
              checked={draft.publish}
              onChange={(e) => setDraft({ ...draft, publish: e.target.checked })}
            />
            Publish to all employees
          </label>
          <div className="mt-sm flex items-center gap-sm">
            <button
              onClick={save}
              disabled={pending || !draft.title}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
            >
              Save training
            </button>
            {error && <span className="text-red-700 text-label-sm">{error}</span>}
          </div>
        </Section>
      )}

      {trainings.map((t) => (
        <Section
          key={t.id}
          title={`${t.title} · ${t.status}`}
          action={<span className="text-label-sm text-on-surface-variant">{t.quiz.length} Qs · Pass ≥ {t.passingScore}%</span>}
        >
          {t.description && <p className="text-on-surface-variant mb-md">{t.description}</p>}
          {t.videoUrl && (
            <a href={t.videoUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">
              {t.videoUrl}
            </a>
          )}
          <table className="w-full text-label-sm mt-md">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Employee</th>
                <th className="py-sm pr-md">Score</th>
                <th className="py-sm pr-md">Attempts</th>
                <th className="py-sm pr-md">Status</th>
                <th className="py-sm pr-md">Completed</th>
              </tr>
            </thead>
            <tbody>
              {t.progress.map((p, i) => (
                <tr key={i} className="border-b border-outline-variant last:border-0">
                  <td className="py-sm pr-md">
                    {p.empCode} · {p.name}
                  </td>
                  <td className="py-sm pr-md">{p.score ?? "—"}</td>
                  <td className="py-sm pr-md">{p.attempts}</td>
                  <td className="py-sm pr-md">
                    {p.passed ? (
                      <span className="text-green-700">Passed</span>
                    ) : p.attempts > 0 ? (
                      <span className="text-red-700">Failed</span>
                    ) : (
                      <span className="text-on-surface-variant">Not started</span>
                    )}
                  </td>
                  <td className="py-sm pr-md text-on-surface-variant">
                    {p.completedAt ? new Date(p.completedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
              {t.progress.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-md text-center text-on-surface-variant">
                    No attempts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Section>
      ))}
    </div>
  );
}
