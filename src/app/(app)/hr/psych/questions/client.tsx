"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Q = {
  id: string;
  order: number;
  dimension: string;
  textEn: string;
  textMl: string | null;
  reverseScored: boolean;
  active: boolean;
};

const DIM_LABEL: Record<string, string> = {
  O: "Openness",
  C: "Conscientiousness",
  E: "Extraversion",
  A: "Agreeableness",
  N: "Neuroticism",
  VALIDITY: "Validity check",
};

const DIM_FILTERS = ["ALL", "O", "C", "E", "A", "N", "VALIDITY"] as const;

export function QuestionsClient({
  questions,
  canEdit,
}: {
  questions: Q[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [filter, setFilter] = useState<(typeof DIM_FILTERS)[number]>("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ textEn: "", textMl: "", reverseScored: false, active: true });
  const [error, setError] = useState<string | null>(null);

  const visible = questions.filter((q) => filter === "ALL" || q.dimension === filter);
  const counts = questions.reduce<Record<string, number>>((acc, q) => {
    acc[q.dimension] = (acc[q.dimension] ?? 0) + 1;
    return acc;
  }, {});

  function beginEdit(q: Q) {
    setEditingId(q.id);
    setDraft({
      textEn: q.textEn,
      textMl: q.textMl ?? "",
      reverseScored: q.reverseScored,
      active: q.active,
    });
    setError(null);
  }

  async function save(id: string) {
    setError(null);
    const res = await fetch(`/api/hr/psych/questions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        textEn: draft.textEn,
        textMl: draft.textMl || null,
        reverseScored: draft.reverseScored,
        active: draft.active,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setEditingId(null);
    start(() => router.refresh());
  }

  return (
    <Section
      title=""
      action={
        <div className="flex gap-xs flex-wrap">
          {DIM_FILTERS.map((d) => (
            <button
              key={d}
              onClick={() => setFilter(d)}
              className={
                "px-sm py-xs rounded border text-label-sm " +
                (filter === d
                  ? "bg-primary text-on-primary border-primary font-bold"
                  : "border-outline-variant text-on-surface-variant")
              }
            >
              {d === "ALL" ? `All ${questions.length}` : `${d} ${counts[d] ?? 0}`}
            </button>
          ))}
        </div>
      }
    >
      {error && <div className="mb-md text-error text-label-sm">{error}</div>}
      <table className="w-full text-label-sm">
        <thead className="text-left text-on-surface-variant border-b border-outline-variant">
          <tr>
            <th className="py-sm pr-md w-12">#</th>
            <th className="py-sm pr-md w-32">Dimension</th>
            <th className="py-sm pr-md">English</th>
            <th className="py-sm pr-md">Malayalam</th>
            <th className="py-sm pr-md w-20">Reverse?</th>
            <th className="py-sm pr-md w-20">Active</th>
            {canEdit && <th className="w-20" />}
          </tr>
        </thead>
        <tbody>
          {visible.map((q) => {
            const editing = editingId === q.id;
            return (
              <tr key={q.id} className="border-b border-outline-variant last:border-0 align-top">
                <td className="py-sm pr-md text-on-surface-variant">{q.order}</td>
                <td className="py-sm pr-md">
                  <span
                    className={
                      "px-xs py-[2px] rounded text-caption " +
                      (q.dimension === "VALIDITY"
                        ? "bg-amber-50 text-amber-800"
                        : "bg-blue-50 text-blue-800")
                    }
                  >
                    {DIM_LABEL[q.dimension] ?? q.dimension}
                  </span>
                </td>
                <td className="py-sm pr-md">
                  {editing ? (
                    <textarea
                      className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                      rows={2}
                      value={draft.textEn}
                      onChange={(e) => setDraft({ ...draft, textEn: e.target.value })}
                    />
                  ) : (
                    q.textEn
                  )}
                </td>
                <td className="py-sm pr-md font-malayalam text-[16px]">
                  {editing ? (
                    <textarea
                      className="w-full px-sm py-sm rounded border border-outline-variant bg-surface font-malayalam text-[16px]"
                      rows={2}
                      value={draft.textMl}
                      onChange={(e) => setDraft({ ...draft, textMl: e.target.value })}
                      placeholder="(translation pending)"
                    />
                  ) : q.textMl ? (
                    q.textMl
                  ) : (
                    <span className="text-on-surface-variant italic font-sans">pending</span>
                  )}
                </td>
                <td className="py-sm pr-md text-center">
                  {editing ? (
                    <input
                      type="checkbox"
                      checked={draft.reverseScored}
                      onChange={(e) => setDraft({ ...draft, reverseScored: e.target.checked })}
                    />
                  ) : q.reverseScored ? (
                    "↺"
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-sm pr-md text-center">
                  {editing ? (
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                    />
                  ) : q.active ? (
                    <span className="text-green-700">Yes</span>
                  ) : (
                    <span className="text-on-surface-variant">No</span>
                  )}
                </td>
                {canEdit && (
                  <td className="py-sm pr-md text-right whitespace-nowrap">
                    {editing ? (
                      <>
                        <button
                          onClick={() => save(q.id)}
                          className="text-green-700 underline mr-sm"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-on-surface-variant underline"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button onClick={() => beginEdit(q)} className="text-blue-700 underline">
                        Edit
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 7 : 6} className="py-lg text-center text-on-surface-variant">
                No questions in this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Section>
  );
}
