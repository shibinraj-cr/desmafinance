"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { TALENT_POOL_STATES, TALENT_POOL_STATE_LABELS } from "@/lib/hiring/constants";
import type { TalentPoolState } from "@/lib/hiring/constants";
import { formatHiringDate } from "@/lib/hiring/core";

type Prospect = {
  id: string; candidateId: string; fullName: string; email: string | null; phone: string | null;
  currentTitle: string | null; tags: string[]; state: string; interestAreas: string[];
  matches: { jobId: string; title: string; fit: number }[];
  lastTouchAt: string | null; nextTouchAt: string | null; ownerName: string | null; notesMd: string | null;
};

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";

export function TalentPoolClient({
  prospects,
  counts,
  activeState,
  jobs,
  activeJobId,
  sort,
  hiddenZeroCount,
  showingAll,
  canWrite,
  loadedAt,
}: {
  prospects: Prospect[];
  counts: Record<string, number>;
  activeState: string;
  jobs: { id: string; title: string }[];
  activeJobId: string;
  sort: string;
  hiddenZeroCount: number;
  showingAll: boolean;
  canWrite: boolean;
  loadedAt: string;
}) {
  const router = useRouter();

  /**
   * Build a URL that changes ONE filter and leaves the rest alone. The state
   * chips used to hard-code `?state=`, which silently dropped a chosen job the
   * moment somebody clicked a stage.
   */
  function href(next: Partial<{ state: string; job: string; sort: string; all: string }>): string {
    const q = new URLSearchParams();
    const merged = { state: activeState, job: activeJobId, sort, all: showingAll ? "1" : "", ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const qs = q.toString();
    return qs ? `/hiring/talent-pool?${qs}` : "/hiring/talent-pool";
  }
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** Which card is asking for a note, and what has been typed into it. */
  const [noting, setNoting] = useState<{ id: string; state: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [interestAreas, setInterestAreas] = useState("");

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/hiring/talent-pool/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      setError("That didn't save.");
      return;
    }
    router.refresh();
  }

  async function add() {
    setBusy("add");
    setError(null);
    const res = await fetch("/api/hiring/talent-pool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName,
        email,
        phone,
        currentTitle,
        interestAreas: interestAreas.split(",").map((s) => s.trim()).filter(Boolean),
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That prospect could not be added.");
      return;
    }
    setAdding(false);
    setFullName("");
    setEmail("");
    setPhone("");
    setCurrentTitle("");
    setInterestAreas("");
    router.refresh();
  }

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-md">
        <nav className="flex flex-wrap gap-xs" aria-label="Filter by state">
          <a
            href={href({ state: "" })}
            aria-current={activeState === "" ? "page" : undefined}
            className={
              "h-8 inline-flex items-center px-md rounded-full text-label-sm border transition " +
              (activeState === ""
                ? "bg-primary text-on-primary border-primary"
                : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
            }
          >
            All {prospects.length > 0 && <span className="ml-xs opacity-70">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>}
          </a>
          {TALENT_POOL_STATES.map((s) => (
            <a
              key={s}
              href={href({ state: s })}
              aria-current={activeState === s ? "page" : undefined}
              className={
                "h-8 inline-flex items-center px-md rounded-full text-label-sm border transition " +
                (activeState === s
                  ? "bg-primary text-on-primary border-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {TALENT_POOL_STATE_LABELS[s]}
              {counts[s] ? <span className="ml-xs opacity-70">{counts[s]}</span> : null}
            </a>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-xs">
          {jobs.length > 0 && (
            <>
              <label className="sr-only" htmlFor="pool-job">Filter by job</label>
              <select
                id="pool-job"
                className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-sm"
                value={activeJobId}
                onChange={(e) => router.push(href({ job: e.target.value, all: "" }))}
              >
                <option value="">All jobs</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
            </>
          )}
          <label className="sr-only" htmlFor="pool-sort">Sort by</label>
          <select
            id="pool-sort"
            className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-sm"
            value={sort}
            onChange={(e) => router.push(href({ sort: e.target.value }))}
          >
            <option value="fit">Best fit first</option>
            <option value="due">Follow-up due</option>
            <option value="recent">Recently added</option>
            <option value="name">Name</option>
          </select>
          <RefreshBar loadedAt={loadedAt} />
          {canWrite && (
            <button type="button" className={primaryBtn} onClick={() => setAdding((v) => !v)}>
              Add prospect
            </button>
          )}
        </div>
      </div>

      {adding && canWrite && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-low p-lg space-y-md">
          <h3 className="text-h3 text-on-surface">Someone worth keeping warm</h3>
          <div className="grid gap-md sm:grid-cols-2">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Name</span>
              <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Current role</span>
              <input className={inputCls} value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-md sm:grid-cols-3">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Email</span>
              <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Phone</span>
              <input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">
                Interest areas (comma separated)
              </span>
              <input className={inputCls} value={interestAreas} onChange={(e) => setInterestAreas(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-xs">
            <button
              type="button"
              className={primaryBtn}
              disabled={busy === "add" || fullName.trim().length < 2 || (!email.trim() && !phone.trim())}
              onClick={add}
            >
              {busy === "add" ? "Adding…" : "Add to the pool"}
            </button>
            <button type="button" className={btn} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {hiddenZeroCount > 0 && (
        <p className="text-body-sm text-on-surface-variant">
          {hiddenZeroCount} {hiddenZeroCount === 1 ? "person is" : "people are"} hidden with no
          keyword match for this role.{" "}
          <a href={href({ all: "1" })} className="text-primary hover:underline">
            Show them anyway
          </a>
          {" — "}a must-have worded so nothing can evidence it, like “Language” or “Degree”, scores
          everyone zero.
        </p>
      )}
      {showingAll && activeJobId && (
        <p className="text-body-sm text-on-surface-variant">
          Showing everyone, including no-match.{" "}
          <a href={href({ all: "" })} className="text-primary hover:underline">
            Hide no-match
          </a>
        </p>
      )}

      {prospects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
          <div className="text-body-lg text-on-surface mb-xs">
            {activeState ? "Nobody in that state" : "The pool is empty"}
          </div>
          <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
            Strong candidates you could not hire this time belong here — so that the next time a
            matching role opens, you are not starting from nothing.
          </p>
        </div>
      ) : (
        <ul className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
          {prospects.map((p) => (
            <li
              key={p.id}
              className="relative rounded-xl border border-outline-variant bg-surface-container-lowest p-md space-y-sm transition hover:border-primary focus-within:border-primary"
            >
              <div>
                <Link
                  href={`/hiring/candidates/${p.candidateId}`}
                  className="text-body-lg font-semibold text-on-surface before:absolute before:inset-0 before:rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {p.fullName}
                </Link>
                <div className="text-caption text-on-surface-variant">
                  {p.currentTitle ?? p.email ?? p.phone ?? "—"}
                </div>
              </div>

              {p.interestAreas.length > 0 && (
                <div className="flex flex-wrap gap-xs">
                  {p.interestAreas.map((a) => (
                    <span key={a} className="h-6 inline-flex items-center px-sm rounded-full bg-surface-container text-label-sm">
                      {a}
                    </span>
                  ))}
                </div>
              )}

              <Fit matches={p.matches} activeJobId={activeJobId} />

              <div className="text-caption text-on-surface-variant">
                Last touched {p.lastTouchAt ? formatHiringDate(p.lastTouchAt) : "never"}
                {p.nextTouchAt ? ` · next ${formatHiringDate(p.nextTouchAt)}` : ""}
                {p.ownerName ? ` · ${p.ownerName}` : ""}
              </div>

              {canWrite && (
                <div className="relative flex flex-wrap items-center gap-xs">
                  <label className="sr-only" htmlFor={`state-${p.id}`}>
                    State for {p.fullName}
                  </label>
                  <select
                    id={`state-${p.id}`}
                    className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-sm"
                    value={noting?.id === p.id ? noting.state : p.state}
                    disabled={busy !== null}
                    // Moving a stage asks for the reason before saving. Typing it
                    // afterwards is the step everyone skips, and then a timeline
                    // is a list of moves nobody can explain.
                    onChange={(e) => setNoting({ id: p.id, state: e.target.value, text: "" })}
                  >
                    {TALENT_POOL_STATES.map((s) => (
                      <option key={s} value={s}>
                        {TALENT_POOL_STATE_LABELS[s as TalentPoolState]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={btn}
                    disabled={busy !== null}
                    onClick={() =>
                      patch(p.id, {
                        touched: true,
                        nextTouchAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
                      })
                    }
                  >
                    Touched today
                  </button>
                </div>
              )}

              {canWrite && noting?.id === p.id && (
                <div className="relative space-y-xs rounded-lg border border-outline-variant p-sm">
                  <label className="text-label-sm text-on-surface-variant" htmlFor={`note-${p.id}`}>
                    Moving to {TALENT_POOL_STATE_LABELS[noting.state as TalentPoolState] ?? noting.state} — why?
                  </label>
                  <textarea
                    id={`note-${p.id}`}
                    rows={2}
                    autoFocus
                    className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-sm text-body-sm"
                    placeholder="Optional"
                    value={noting.text}
                    onChange={(e) => setNoting({ ...noting, text: e.target.value })}
                  />
                  <div className="flex items-center gap-xs">
                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={busy !== null}
                      onClick={async () => {
                        const { state, text } = noting;
                        setNoting(null);
                        await patch(p.id, { state, note: text.trim() || undefined });
                      }}
                    >
                      Save
                    </button>
                    <button type="button" className={btn} onClick={() => setNoting(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Fit against each open role, on the card.
 *
 * Same number as the profile page and the same caveat: this is the free keyword
 * matcher, not the AI rubric. There is no room on a card for the matched and
 * missing must-haves that make a number defensible, so the card is deliberately
 * quiet about it — small, grey, under the skills — and the profile page one
 * click away carries the evidence.
 */
function Fit({
  matches,
  activeJobId,
}: {
  matches: { jobId: string; title: string; fit: number }[];
  activeJobId: string;
}) {
  if (matches.length === 0) return null;
  // Filtering to a job makes that row the point of the card; the others stay
  // visible underneath, because "who else might this person suit?" is the
  // question a pool is for.
  const ordered = activeJobId
    ? [...matches].sort((a, b) => Number(b.jobId === activeJobId) - Number(a.jobId === activeJobId))
    : matches;
  return (
    <div className="space-y-2xs">
      <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">
        Keyword fit
      </div>
      {ordered.map((m) => (
        <div
          key={m.jobId}
          className={
            "flex items-center gap-sm " +
            (activeJobId && m.jobId === activeJobId ? "text-on-surface font-medium" : "")
          }
        >
          <span className="text-caption text-on-surface-variant truncate flex-1 min-w-0" title={m.title}>
            {m.title}
          </span>
          <span className="h-1 w-16 rounded-full bg-surface-container overflow-hidden shrink-0">
            <span className="block h-full bg-primary" style={{ width: `${m.fit}%` }} />
          </span>
          <span className="text-caption tabular-nums text-on-surface w-9 text-right shrink-0">
            {m.fit}%
          </span>
        </div>
      ))}
    </div>
  );
}
