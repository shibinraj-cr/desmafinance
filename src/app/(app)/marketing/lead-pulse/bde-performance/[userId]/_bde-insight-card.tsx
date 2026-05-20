"use client";

import { useState, useTransition } from "react";

type Question = { id: string; question: string; hint?: string };

type InsightRow = {
  id: string;
  userId: string;
  year: number;
  month: number;
  analysis: string;
  questions: Question[];
  answers: Record<string, string> | null;
  feedback: string | null;
  status: "draft" | "answered";
  answeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function BdeInsightCard({
  initial,
  bdeUserId,
  bdeDisplayName,
  isSelf,
  canSupervise,
  year,
  month,
}: {
  initial: InsightRow | null;
  bdeUserId: string;
  bdeDisplayName: string;
  isSelf: boolean;
  canSupervise: boolean;
  year: number;
  month: number;
}) {
  const [row, setRow] = useState<InsightRow | null>(initial);
  const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers ?? {});
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/marketing/lead-pulse/bde-insights/${bdeUserId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year, month }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Could not generate insight.");
        return;
      }
      const data = (await res.json()) as { row: InsightRow };
      setRow(data.row);
      setAnswers(data.row.answers ?? {});
    });
  }

  async function submit() {
    setError(null);
    if (!row) return;
    const filled = row.questions.filter((q) => (answers[q.id] ?? "").trim().length > 0);
    if (filled.length === 0) {
      setError("Answer at least one question before submitting.");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/marketing/lead-pulse/bde-insights/${bdeUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year, month, answers }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Submission failed.");
        return;
      }
      const data = (await res.json()) as { row: InsightRow };
      setRow(data.row);
    });
  }

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  if (!row) {
    return (
      <Card>
        <Header label={`AI Insight · ${monthLabel}`} />
        <p className="text-[13px] mb-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          {isSelf
            ? "Tap below to generate a personalised insight from your numbers — target, leads, pipeline. The system will also ask 3-4 quick questions and store your answers so Suhaina can support you better."
            : `No insight has been generated for ${bdeDisplayName} this month yet.`}
        </p>
        {(isSelf || canSupervise) && (
          <button
            onClick={generate}
            disabled={busy}
            className="h-[34px] px-[16px] rounded-[8px] text-[13px] font-semibold"
            style={{
              backgroundColor: "var(--lp-primary)",
              color: "var(--lp-on-primary)",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? "Generating…" : "Generate insight"}
          </button>
        )}
        {error && <ErrorBanner text={error} onDismiss={() => setError(null)} />}
      </Card>
    );
  }

  return (
    <Card>
      <Header
        label={`AI Insight · ${monthLabel}`}
        right={
          row.status === "answered" ? (
            <span
              className="text-[10px] font-bold uppercase tracking-widest px-[8px] py-[2px] rounded-full"
              style={{ backgroundColor: "rgba(51, 228, 255, 0.18)", color: "var(--lp-cyan)" }}
            >
              Answered{row.answeredAt ? ` · ${row.answeredAt.slice(0, 10)}` : ""}
            </span>
          ) : null
        }
      />

      <Markdown text={row.analysis} />

      <div className="mt-[16px]">
        <p
          className="text-[11px] uppercase tracking-widest font-semibold mb-[8px]"
          style={{ color: "var(--lp-on-surface-variant)" }}
        >
          {row.status === "answered" ? "Your answers" : "Reply below — Suhaina sees these on her dashboard"}
        </p>
        <div className="space-y-[12px]">
          {row.questions.map((q) => {
            const a = answers[q.id] ?? "";
            const readonly = row.status === "answered" || !isSelf;
            return (
              <div key={q.id}>
                <p className="text-[13px] font-semibold mb-[2px]" style={{ color: "var(--lp-on-surface)" }}>
                  {q.question}
                </p>
                {q.hint && (
                  <p
                    className="text-[11px] italic mb-[4px]"
                    style={{ color: "var(--lp-on-surface-variant)" }}
                  >
                    {q.hint}
                  </p>
                )}
                <textarea
                  value={a}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  readOnly={readonly}
                  rows={2}
                  placeholder={readonly ? "—" : "Your answer…"}
                  className="w-full px-[10px] py-[6px] rounded-[8px] text-[13px] outline-none resize-none"
                  style={{
                    backgroundColor: readonly ? "transparent" : "var(--lp-surface-container-low)",
                    border: "1px solid var(--lp-outline-variant)",
                    color: "var(--lp-on-surface)",
                    cursor: readonly ? "default" : "text",
                  }}
                />
              </div>
            );
          })}
        </div>

        {row.status !== "answered" && isSelf && (
          <div className="mt-[12px] flex justify-end">
            <button
              onClick={submit}
              disabled={busy}
              className="h-[34px] px-[16px] rounded-[8px] text-[13px] font-semibold"
              style={{
                backgroundColor: "var(--lp-primary)",
                color: "var(--lp-on-primary)",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {busy ? "Saving…" : "Submit answers"}
            </button>
          </div>
        )}

        {row.feedback && (
          <div
            className="mt-[16px] rounded-[10px] border-l-4 p-[12px]"
            style={{
              backgroundColor: "var(--lp-surface-container-low)",
              borderColor: "var(--lp-primary)",
            }}
          >
            <p
              className="text-[11px] uppercase tracking-widest font-semibold mb-[6px]"
              style={{ color: "var(--lp-primary)" }}
            >
              Coach feedback
            </p>
            <Markdown text={row.feedback} />
          </div>
        )}

        {(isSelf || canSupervise) && row.status !== "answered" && (
          <button
            onClick={generate}
            disabled={busy}
            className="mt-[12px] text-[12px] underline"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Regenerate with fresh numbers
          </button>
        )}
      </div>

      {error && <ErrorBanner text={error} onDismiss={() => setError(null)} />}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[12px] border p-[16px]"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      {children}
    </div>
  );
}

function Header({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-[10px]">
      <div className="flex items-center gap-[8px]">
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: "var(--lp-primary)" }}
          aria-hidden
        >
          auto_awesome
        </span>
        <span
          className="text-[11px] uppercase tracking-widest font-semibold"
          style={{ color: "var(--lp-primary)" }}
        >
          {label}
        </span>
      </div>
      {right}
    </div>
  );
}

function ErrorBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div
      className="mt-[12px] rounded-[8px] px-[12px] py-[8px] text-[12px] flex items-start gap-[8px]"
      style={{
        backgroundColor: "rgba(255, 180, 171, 0.15)",
        color: "var(--lp-error)",
        border: "1px solid var(--lp-error)",
      }}
    >
      <span className="flex-1">{text}</span>
      <button onClick={onDismiss} className="underline text-[11px]">
        Dismiss
      </button>
    </div>
  );
}

/** Tiny markdown renderer: only handles bold (**) and paragraphs / list items.
 *  Keeps the bundle slim — no react-markdown dep just for two formats. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/);
  return (
    <div className="space-y-[8px] text-[13px]" style={{ color: "var(--lp-on-surface)" }}>
      {blocks.map((b, i) => {
        const isList = b.split(/\n/).every((line) => /^\s*-\s/.test(line));
        if (isList) {
          return (
            <ul key={i} className="list-disc pl-[20px] space-y-[4px]">
              {b
                .split(/\n/)
                .map((line) => line.replace(/^\s*-\s/, ""))
                .map((line, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
                ))}
            </ul>
          );
        }
        return <p key={i} dangerouslySetInnerHTML={{ __html: renderInline(b) }} />;
      })}
    </div>
  );
}

function renderInline(s: string): string {
  // bold
  let out = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic single-* (avoid clashing with bold by running second)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}
