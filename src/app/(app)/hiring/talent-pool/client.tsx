"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { TALENT_POOL_STATES, TALENT_POOL_STATE_LABELS } from "@/lib/hiring/constants";
import type { TalentPoolState } from "@/lib/hiring/constants";
import { formatHiringDate } from "@/lib/hiring/core";

type Prospect = {
  id: string; candidateId: string; fullName: string; email: string | null; phone: string | null;
  currentTitle: string | null; tags: string[]; state: string; interestAreas: string[];
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
  canWrite,
  loadedAt,
}: {
  prospects: Prospect[];
  counts: Record<string, number>;
  activeState: string;
  canWrite: boolean;
  loadedAt: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
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
            href="/hiring/talent-pool"
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
              href={`/hiring/talent-pool?state=${s}`}
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
        <div className="flex items-center gap-xs">
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
            <li key={p.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
              <div>
                <div className="text-body-lg font-semibold text-on-surface">{p.fullName}</div>
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

              <div className="text-caption text-on-surface-variant">
                Last touched {p.lastTouchAt ? formatHiringDate(p.lastTouchAt) : "never"}
                {p.nextTouchAt ? ` · next ${formatHiringDate(p.nextTouchAt)}` : ""}
                {p.ownerName ? ` · ${p.ownerName}` : ""}
              </div>

              {canWrite && (
                <div className="flex flex-wrap items-center gap-xs">
                  <label className="sr-only" htmlFor={`state-${p.id}`}>
                    State for {p.fullName}
                  </label>
                  <select
                    id={`state-${p.id}`}
                    className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-sm"
                    value={p.state}
                    disabled={busy !== null}
                    onChange={(e) => patch(p.id, { state: e.target.value })}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
