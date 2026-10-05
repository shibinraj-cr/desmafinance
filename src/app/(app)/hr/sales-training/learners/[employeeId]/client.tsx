"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KpiCard, Section } from "@/components/Cards";
import { ModuleStatusPill, Pill } from "@/components/sales-training/ui";
import type { GradedQuestion, ModuleStatus } from "@/lib/sales-training";

type Attempt = {
  id: string;
  submittedAt: string;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  voided: boolean;
  graded: GradedQuestion[];
};
type ModuleRow = {
  id: string;
  title: string;
  archived: boolean;
  passMark: number;
  maxAttempts: number | null;
  status: ModuleStatus;
  attemptsUsed: number;
  bestPercent: number | null;
  videosDone: number;
  videosTotal: number;
  attempts: Attempt[];
};

export function AttemptReview({ graded }: { graded: GradedQuestion[] }) {
  return (
    <ol className="space-y-sm mt-sm">
      {graded.map((q, i) => (
        <li key={q.id} className="border border-outline-variant rounded p-sm">
          <div className="flex items-start gap-sm">
            <span className={"material-symbols-outlined text-[18px] " + (q.isCorrect ? "text-green-700" : "text-red-700")}>
              {q.isCorrect ? "check_circle" : "cancel"}
            </span>
            <p className="flex-1 font-semibold text-label-sm">
              Q{i + 1}. {q.prompt}
            </p>
            <span className="text-[11px] text-on-surface-variant whitespace-nowrap">
              {q.earned}/{q.points} pt
            </span>
          </div>
          <ul className="mt-xs pl-lg space-y-[2px] text-label-sm">
            {q.options.map((o, oi) => {
              const right = q.correct.includes(oi);
              const chose = q.chosen.includes(oi);
              return (
                <li key={oi} className={right ? "text-green-800 font-semibold" : chose ? "text-red-700" : "text-on-surface-variant"}>
                  {chose ? "●" : "○"} {o}
                  {right && " ✓"}
                </li>
              );
            })}
          </ul>
          {q.chosen.length === 0 && <p className="pl-lg text-[11px] text-red-700">Not answered</p>}
        </li>
      ))}
    </ol>
  );
}

export function LearnerDetail({
  employeeId,
  canEdit,
  enrolment,
  summary,
  modules,
}: {
  employeeId: string;
  canEdit: boolean;
  enrolment: { active: boolean; enrolledAt: string; dueDate: string | null } | null;
  summary: { passed: number; total: number; completionPct: number; avgScore: number | null; lastActivity: string | null };
  modules: ModuleRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reset(m: ModuleRow) {
    if (!confirm(`Reset "${m.title}" for this learner? Their ${m.attemptsUsed} attempt(s) stay on record but stop counting, so they can retake it.`)) return;
    const res = await fetch(`/api/hr/sales-training/learners/${employeeId}/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moduleId: m.id }),
    });
    setMsg(res.ok ? `${m.title} reset.` : "Reset failed.");
    if (res.ok) start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      <Link href="/hr/sales-training/learners" className="text-label-sm text-on-surface-variant hover:underline">
        ← All learners
      </Link>
      {!enrolment?.active && (
        <p className="text-label-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-sm">
          {enrolment ? "Removed from the programme — history below is kept." : "Not enrolled in Sales Training."}
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
        <KpiCard label="Modules passed" value={`${summary.passed}/${summary.total}`} tone={summary.total > 0 && summary.passed === summary.total ? "success" : "default"} />
        <KpiCard label="Avg best score" value={summary.avgScore != null ? `${summary.avgScore}%` : "—"} tone="primary" />
        <KpiCard label="Complete by" value={enrolment?.dueDate ?? "—"} hint={enrolment ? `enrolled ${new Date(enrolment.enrolledAt).toLocaleDateString("en-IN")}` : undefined} />
        <KpiCard label="Last activity" value={summary.lastActivity ? new Date(summary.lastActivity).toLocaleDateString("en-IN") : "never"} />
      </div>
      {msg && <p className="text-label-sm font-semibold text-green-700">{msg}</p>}

      <Section title="Modules">
        <ul className="divide-y divide-outline-variant">
          {modules.length === 0 && <li className="py-md text-center text-on-surface-variant">No live modules.</li>}
          {modules.map((m) => (
            <li key={m.id} className="py-md">
              <div className="flex flex-wrap items-center gap-sm">
                <Link href={`/hr/sales-training/modules/${m.id}`} className="font-semibold hover:underline">
                  {m.title}
                </Link>
                <ModuleStatusPill status={m.status} />
                {m.archived && <Pill tone="grey">archived module</Pill>}
                <div className="flex-1" />
                <span className="text-label-sm text-on-surface-variant">
                  videos {m.videosDone}/{m.videosTotal} · attempts {m.attemptsUsed}
                  {m.maxAttempts ? `/${m.maxAttempts}` : ""} · best {m.bestPercent != null ? `${m.bestPercent}%` : "—"} (pass {m.passMark}%)
                </span>
                {m.attempts.length > 0 && (
                  <button className="text-label-sm text-blue-700 underline" onClick={() => setOpen(open === m.id ? null : m.id)}>
                    {open === m.id ? "Hide answers" : "Review answers"}
                  </button>
                )}
                {canEdit && m.attemptsUsed > 0 && (
                  <button className="text-label-sm text-on-surface-variant hover:underline" disabled={pending} onClick={() => reset(m)}>
                    Reset
                  </button>
                )}
              </div>
              {open === m.id && (
                <div className="mt-sm space-y-md">
                  {m.attempts.map((a, i) => (
                    <details key={a.id} open={i === 0} className={a.voided ? "opacity-60" : ""}>
                      <summary className="cursor-pointer text-label-sm">
                        <span className={a.voided ? "line-through" : ""}>
                          Attempt {m.attempts.length - i} · {new Date(a.submittedAt).toLocaleString("en-IN")} · {a.score}/{a.maxScore} ({a.percent}%)
                        </span>{" "}
                        {a.voided ? <Pill tone="grey">reset</Pill> : a.passed ? <Pill tone="green">passed</Pill> : <Pill tone="red">below pass</Pill>}
                      </summary>
                      <AttemptReview graded={a.graded} />
                    </details>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
