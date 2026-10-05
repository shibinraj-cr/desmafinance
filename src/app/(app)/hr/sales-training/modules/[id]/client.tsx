"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import { btnGhost, btnPrimary, inputCls, Pill, PublishPill } from "@/components/sales-training/ui";
import { parseBulkQuestions, parseYouTubeId, WATCH_THRESHOLD_PCT, type TrainingQuestion } from "@/lib/sales-training";

type Video = { id: string; title: string; url: string };
type ModuleData = {
  id: string;
  title: string;
  description: string;
  passMark: number;
  maxAttempts: number | null;
  requireWatch: boolean;
  status: string;
  videos: Video[];
};
type Result = { employeeId: string; name: string; empCode: string; attempts: number; best: number; passed: boolean; last: string };

const BULK_EXAMPLE = `What should you ask first when a lead says "it's too expensive"?
A) Offer a discount straight away
*B) What they are comparing the fee against
C) Whether they want to call back later
Explanation: Understand the objection before answering it.

Which documents are needed for the eligibility check? (tick all)
*A) Passport
B) Ration card
*C) Degree certificate
Points: 2`;

function blankQuestion(): TrainingQuestion {
  return { id: `new-${crypto.randomUUID()}`, kind: "single", prompt: "", options: ["", ""], correct: [0], points: 1, explanation: null };
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  const j = await res.json().catch(() => ({}));
  return j.error || `Request failed (${res.status})`;
}

export function ModuleEditor({
  module: initial,
  questions: initialQs,
  results,
  canEdit,
  hasAttempts,
}: {
  module: ModuleData;
  questions: TrainingQuestion[];
  results: Result[];
  canEdit: boolean;
  hasAttempts: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [m, setM] = useState(initial);
  const [qs, setQs] = useState(initialQs);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [qsDirty, setQsDirty] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState("");
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

  const patchM = (p: Partial<ModuleData>) => {
    setM({ ...m, ...p });
    setDetailsDirty(true);
  };
  const setQ = (i: number, p: Partial<TrainingQuestion>) => {
    const next = [...qs];
    next[i] = { ...next[i], ...p };
    setQs(next);
    setQsDirty(true);
  };
  const done = (err: string | null, ok: string) => {
    setMsg(err ? { tone: "err", text: err } : { tone: "ok", text: ok });
    if (!err) start(() => router.refresh());
    return !err;
  };

  async function saveDetails() {
    const err = await send(`/api/hr/sales-training/modules/${m.id}`, "PATCH", {
      title: m.title,
      description: m.description || null,
      passMark: m.passMark,
      maxAttempts: m.maxAttempts,
      requireWatch: m.requireWatch,
      videos: m.videos.filter((v) => v.url.trim()),
    });
    if (done(err, "Details & videos saved.")) setDetailsDirty(false);
  }

  async function saveQuestions() {
    const err = await send(`/api/hr/sales-training/modules/${m.id}/questions`, "PUT", {
      questions: qs.map((q) => ({ ...q, explanation: q.explanation || null })),
    });
    if (done(err, `${qs.length} question(s) saved.`)) setQsDirty(false);
  }

  async function setStatus(status: "draft" | "published" | "archived") {
    if (detailsDirty || qsDirty) return setMsg({ tone: "err", text: "Save your changes first." });
    const err = await send(`/api/hr/sales-training/modules/${m.id}`, "PATCH", { status });
    if (done(err, status === "published" ? "Published — learners have been notified." : `Moved to ${status}.`)) setM({ ...m, status });
  }

  async function remove() {
    if (!confirm(`Delete "${m.title}"? This can't be undone.`)) return;
    const err = await send(`/api/hr/sales-training/modules/${m.id}`, "DELETE");
    if (err) return setMsg({ tone: "err", text: err });
    router.push("/hr/sales-training/modules");
  }

  function importBulk() {
    const { questions, errors } = parseBulkQuestions(bulk);
    setBulkErrors(errors);
    if (questions.length === 0) return;
    setQs([...qs, ...questions.map((q) => ({ ...q, id: `new-${crypto.randomUUID()}` }))]);
    setQsDirty(true);
    if (errors.length === 0) {
      setBulk("");
      setBulkOpen(false);
    }
    setMsg({ tone: "ok", text: `${questions.length} question(s) added below — review, then Save questions.` });
  }

  const totalPoints = qs.reduce((n, q) => n + q.points, 0);
  const ro = !canEdit;

  return (
    <div className="space-y-lg">
      <div className="flex flex-wrap items-center gap-sm">
        <Link href="/hr/sales-training/modules" className="text-label-sm text-on-surface-variant hover:underline">
          ← All modules
        </Link>
        <PublishPill status={m.status} />
        <div className="flex-1" />
        {canEdit && m.status !== "published" && (
          <button className={btnPrimary} disabled={pending} onClick={() => setStatus("published")}>
            <span className="material-symbols-outlined text-[18px]">publish</span>
            Publish
          </button>
        )}
        {canEdit && m.status === "published" && (
          <button className={btnGhost} disabled={pending} onClick={() => setStatus("draft")}>
            Unpublish
          </button>
        )}
        {canEdit && m.status !== "archived" && (
          <button className={btnGhost} disabled={pending} onClick={() => setStatus("archived")}>
            Archive
          </button>
        )}
        {canEdit && !hasAttempts && (
          <button className={btnGhost + " text-red-700"} disabled={pending} onClick={remove}>
            Delete
          </button>
        )}
      </div>
      {msg && (
        <p className={"text-label-sm font-semibold " + (msg.tone === "ok" ? "text-green-700" : "text-red-700")}>{msg.text}</p>
      )}

      <Section
        title="Details & videos"
        action={
          canEdit ? (
            <button className={btnPrimary} disabled={pending || !detailsDirty || !m.title.trim()} onClick={saveDetails}>
              {detailsDirty ? "Save details" : "Saved"}
            </button>
          ) : undefined
        }
      >
        <fieldset disabled={ro} className="space-y-md">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-sm">
            <label className="flex flex-col gap-xs md:col-span-4">
              <span className="text-caption text-on-surface-variant">Title</span>
              <input className={inputCls} value={m.title} onChange={(e) => patchM({ title: e.target.value })} />
            </label>
            <label className="flex flex-col gap-xs md:col-span-4">
              <span className="text-caption text-on-surface-variant">What the consultant will learn</span>
              <textarea rows={2} className={inputCls} value={m.description} onChange={(e) => patchM({ description: e.target.value })} />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Pass mark %</span>
              <input
                type="number"
                min={0}
                max={100}
                className={inputCls}
                value={m.passMark}
                onChange={(e) => patchM({ passMark: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Max attempts (blank = unlimited)</span>
              <input
                type="number"
                min={1}
                className={inputCls}
                value={m.maxAttempts ?? ""}
                onChange={(e) => patchM({ maxAttempts: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
              />
            </label>
            <label className="flex items-center gap-xs text-label-sm md:col-span-2 md:mt-lg">
              <input type="checkbox" checked={m.requireWatch} onChange={(e) => patchM({ requireWatch: e.target.checked })} />
              Lock the quiz until each video is {WATCH_THRESHOLD_PCT}% watched
            </label>
          </div>

          <div>
            <p className="text-label-sm font-semibold mb-sm">Videos ({m.videos.length})</p>
            <p className="text-caption text-on-surface-variant mb-sm">
              Paste the unlisted YouTube link (watch, youtu.be or share link). Learners watch them in this order.
            </p>
            <div className="space-y-sm">
              {m.videos.map((v, i) => {
                const yt = parseYouTubeId(v.url);
                const set = (p: Partial<Video>) => patchM({ videos: m.videos.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <div key={v.id} className="flex flex-col md:flex-row gap-sm md:items-center border border-outline-variant rounded p-sm">
                    {yt ? (
                      <img src={`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`} alt="" className="w-32 aspect-video rounded object-cover bg-surface-container" />
                    ) : (
                      <div className="w-32 aspect-video rounded bg-surface-container flex items-center justify-center text-[11px] text-on-surface-variant text-center px-xs">
                        {v.url ? "Not a YouTube link" : "No link yet"}
                      </div>
                    )}
                    <div className="flex-1 grid grid-cols-1 gap-xs">
                      <input className={inputCls} placeholder={`Video ${i + 1} title`} value={v.title} onChange={(e) => set({ title: e.target.value })} />
                      <input className={inputCls} placeholder="https://youtu.be/…" value={v.url} onChange={(e) => set({ url: e.target.value })} />
                    </div>
                    {canEdit && (
                      <div className="flex md:flex-col gap-xs">
                        <button
                          aria-label="Move up"
                          disabled={i === 0}
                          className="text-on-surface-variant disabled:opacity-30"
                          onClick={() => {
                            const next = [...m.videos];
                            [next[i - 1], next[i]] = [next[i], next[i - 1]];
                            patchM({ videos: next });
                          }}
                        >
                          <span className="material-symbols-outlined text-[18px]">expand_less</span>
                        </button>
                        <button aria-label="Remove video" className="text-red-700" onClick={() => patchM({ videos: m.videos.filter((_, j) => j !== i) })}>
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {canEdit && (
              <button
                className={btnGhost + " mt-sm"}
                onClick={() => patchM({ videos: [...m.videos, { id: crypto.randomUUID(), title: "", url: "" }] })}
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add video
              </button>
            )}
          </div>
        </fieldset>
      </Section>

      <Section
        title={`Questions (${qs.length} · ${totalPoints} pts)`}
        action={
          canEdit ? (
            <div className="flex gap-sm">
              <button className={btnGhost} onClick={() => setBulkOpen(!bulkOpen)}>
                <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                Bulk add
              </button>
              <button className={btnPrimary} disabled={pending || !qsDirty} onClick={saveQuestions}>
                {qsDirty ? "Save questions" : "Saved"}
              </button>
            </div>
          ) : undefined
        }
      >
        {bulkOpen && (
          <div className="mb-lg border border-outline-variant rounded p-md bg-surface-container-low">
            <p className="text-label-sm mb-xs">
              Paste questions separated by a blank line. Options start with <code>A)</code>, <code>B)</code>…; put a{" "}
              <code>*</code> before every right option (two or more = tick-all-that-apply). <code>Explanation:</code> and{" "}
              <code>Points:</code> lines are optional.
            </p>
            <textarea
              rows={10}
              className={inputCls + " w-full font-mono text-label-sm"}
              placeholder={BULK_EXAMPLE}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
            />
            {bulkErrors.length > 0 && (
              <ul className="text-red-700 text-label-sm mt-xs list-disc pl-lg">
                {bulkErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            <div className="flex gap-sm mt-sm">
              <button className={btnPrimary} disabled={!bulk.trim()} onClick={importBulk}>
                Add to question list
              </button>
              <button className={btnGhost} onClick={() => setBulk(BULK_EXAMPLE)}>
                Load example
              </button>
            </div>
          </div>
        )}

        <fieldset disabled={ro} className="space-y-md">
          {qs.length === 0 && <p className="py-md text-center text-on-surface-variant">No questions yet.</p>}
          {qs.map((q, i) => (
            <div key={q.id} className="border border-outline-variant rounded p-md">
              <div className="flex items-start gap-sm">
                <span className="font-bold text-on-surface-variant pt-sm">Q{i + 1}</span>
                <textarea
                  rows={2}
                  className={inputCls + " flex-1"}
                  placeholder="Question"
                  value={q.prompt}
                  onChange={(e) => setQ(i, { prompt: e.target.value })}
                />
                {canEdit && (
                  <div className="flex flex-col">
                    <button
                      aria-label="Move up"
                      disabled={i === 0}
                      className="text-on-surface-variant disabled:opacity-30"
                      onClick={() => {
                        const next = [...qs];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        setQs(next);
                        setQsDirty(true);
                      }}
                    >
                      <span className="material-symbols-outlined text-[18px]">expand_less</span>
                    </button>
                    <button
                      aria-label="Remove question"
                      className="text-red-700"
                      onClick={() => {
                        setQs(qs.filter((_, j) => j !== i));
                        setQsDirty(true);
                      }}
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-md mt-sm text-label-sm">
                <label className="flex items-center gap-xs">
                  <input
                    type="radio"
                    checked={q.kind === "single"}
                    onChange={() => setQ(i, { kind: "single", correct: q.correct.slice(0, 1).length ? q.correct.slice(0, 1) : [0] })}
                  />
                  One right answer
                </label>
                <label className="flex items-center gap-xs">
                  <input type="radio" checked={q.kind === "multi"} onChange={() => setQ(i, { kind: "multi" })} />
                  Tick all that apply
                </label>
                <label className="flex items-center gap-xs">
                  Points
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className={inputCls + " w-16 py-xs"}
                    value={q.points}
                    onChange={(e) => setQ(i, { points: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                  />
                </label>
              </div>

              <div className="mt-sm space-y-xs">
                {q.options.map((opt, oi) => {
                  const right = q.correct.includes(oi);
                  return (
                    <div key={oi} className="flex items-center gap-xs">
                      <input
                        type={q.kind === "single" ? "radio" : "checkbox"}
                        name={`correct-${q.id}`}
                        title="Right answer"
                        checked={right}
                        onChange={() =>
                          setQ(i, {
                            correct:
                              q.kind === "single"
                                ? [oi]
                                : right
                                  ? q.correct.filter((c) => c !== oi)
                                  : [...q.correct, oi].sort((a, b) => a - b),
                          })
                        }
                      />
                      <input
                        className={inputCls + " flex-1 py-xs " + (right ? "border-green-600" : "")}
                        placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                        value={opt}
                        onChange={(e) => setQ(i, { options: q.options.map((o, j) => (j === oi ? e.target.value : o)) })}
                      />
                      {canEdit && q.options.length > 2 && (
                        <button
                          aria-label="Remove option"
                          className="text-on-surface-variant"
                          onClick={() =>
                            setQ(i, {
                              options: q.options.filter((_, j) => j !== oi),
                              correct: q.correct.filter((c) => c !== oi).map((c) => (c > oi ? c - 1 : c)),
                            })
                          }
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      )}
                    </div>
                  );
                })}
                {canEdit && q.options.length < 10 && (
                  <button className="text-blue-700 underline text-label-sm" onClick={() => setQ(i, { options: [...q.options, ""] })}>
                    + Add option
                  </button>
                )}
              </div>
              <input
                className={inputCls + " w-full mt-sm text-label-sm"}
                placeholder="Explanation shown after they pass (optional)"
                value={q.explanation ?? ""}
                onChange={(e) => setQ(i, { explanation: e.target.value })}
              />
            </div>
          ))}
        </fieldset>
        {canEdit && (
          <button
            className={btnGhost + " mt-md"}
            onClick={() => {
              setQs([...qs, blankQuestion()]);
              setQsDirty(true);
            }}
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add question
          </button>
        )}
      </Section>

      <Section title={`Results (${results.length})`}>
        {results.length === 0 ? (
          <p className="py-md text-center text-on-surface-variant">Nobody has attempted this module yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="py-sm pr-md">Consultant</th>
                  <th className="py-sm pr-md">Attempts</th>
                  <th className="py-sm pr-md">Best</th>
                  <th className="py-sm pr-md">Result</th>
                  <th className="py-sm pr-md">Last attempt</th>
                </tr>
              </thead>
              <tbody>
                {results
                  .sort((a, b) => b.best - a.best)
                  .map((r) => (
                    <tr key={r.employeeId} className="border-b border-outline-variant last:border-0">
                      <td className="py-sm pr-md">
                        <Link href={`/hr/sales-training/learners/${r.employeeId}`} className="hover:underline">
                          {r.empCode} · {r.name}
                        </Link>
                      </td>
                      <td className="py-sm pr-md">{r.attempts}</td>
                      <td className="py-sm pr-md font-semibold">{r.best}%</td>
                      <td className="py-sm pr-md">{r.passed ? <Pill tone="green">Passed</Pill> : <Pill tone="amber">Not yet</Pill>}</td>
                      <td className="py-sm pr-md text-on-surface-variant">{new Date(r.last).toLocaleDateString("en-IN")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
