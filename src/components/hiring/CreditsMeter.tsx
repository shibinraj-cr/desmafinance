"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The AI credits meter (§4.8): budget, spend, what is left, and where it went.
 *
 * The bar is the point — a number alone does not tell you that you are about to
 * run out. The hard stop happens server-side before each call, so this is a
 * readout of a real limit, not a warning that can be ignored.
 */
export function CreditsMeter({
  budget,
  spent,
  remaining,
  byFeature,
  labels,
  costs,
  canEdit,
}: {
  budget: number;
  spent: number;
  remaining: number;
  byFeature: { feature: string; credits: number; calls: number }[];
  labels: Record<string, string>;
  costs: Record<string, number>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(budget));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const low = remaining <= Math.max(...Object.values(costs), 0) * 3;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/hiring/ai/credits", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ budget: Number(value) }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("That budget did not save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div>
          <h3 className="text-h3 text-on-surface">AI credits</h3>
          <p className="text-body-sm text-on-surface-variant">
            Every AI call is metered before it runs. At zero, the feature stops and says so — it
            does not quietly keep spending.
          </p>
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition"
            onClick={() => setEditing(true)}
          >
            Change budget
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-sm text-on-error-container">
          {error}
        </div>
      )}

      {editing ? (
        <div className="flex flex-wrap items-end gap-sm">
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">Workspace budget (credits)</span>
            <input
              className="h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md w-40"
              type="number"
              min={0}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60"
            disabled={busy}
            onClick={save}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="h-10 px-md rounded-lg border border-outline-variant text-on-surface-variant"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-baseline justify-between gap-md mb-xs">
            <span className={"text-h2 tabular-nums " + (low ? "text-error" : "text-on-surface")}>
              {remaining.toLocaleString("en-IN")}
            </span>
            <span className="text-body-sm text-on-surface-variant">
              left of {budget.toLocaleString("en-IN")}
            </span>
          </div>
          <div
            className="h-2 rounded-full bg-surface-container overflow-hidden"
            role="meter"
            aria-valuenow={spent}
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-label="AI credits used"
          >
            <div className={"h-full " + (low ? "bg-error" : "bg-primary")} style={{ width: `${used}%` }} />
          </div>
          {low && (
            <p className="text-body-sm text-error mt-sm">
              Nearly out. Raise the budget, or the AI features will stop and ask you to do those
              steps by hand.
            </p>
          )}
        </div>
      )}

      <div>
        <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-sm">
          Where it went
        </h4>
        {byFeature.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Nothing spent yet.</p>
        ) : (
          <ul className="space-y-xs">
            {byFeature
              .slice()
              .sort((a, b) => b.credits - a.credits)
              .map((f) => (
                <li key={f.feature} className="flex items-baseline justify-between gap-md text-body-md">
                  <span className="text-on-surface-variant">
                    {labels[f.feature] ?? f.feature}
                    <span className="text-caption ml-xs">
                      · {f.calls} {f.calls === 1 ? "call" : "calls"} at {costs[f.feature] ?? "?"} each
                    </span>
                  </span>
                  <span className="text-on-surface tabular-nums">{f.credits.toLocaleString("en-IN")}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
