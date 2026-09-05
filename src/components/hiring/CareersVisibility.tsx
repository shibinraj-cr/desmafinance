"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The switch that puts the public careers site on the internet.
 *
 * Deliberately worded as what it does rather than as a setting name — this is
 * the one control in the module whose effect is visible outside the company.
 */
export function CareersVisibility({
  isPublic,
  liveJobCount,
}: {
  isPublic: boolean;
  liveJobCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/hiring/careers-visibility", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("That didn't save.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div>
          <h3 className="text-h3 text-on-surface">Public careers page</h3>
          <p className="text-body-sm text-on-surface-variant max-w-prose">
            {isPublic ? (
              <>
                Live at <code className="text-caption">/careers/desma</code>, showing{" "}
                <strong className="text-on-surface">
                  {liveJobCount} {liveJobCount === 1 ? "role" : "roles"}
                </strong>
                . Anyone can find it, and search engines may index it.
              </>
            ) : (
              <>
                Switched off. <code className="text-caption">/careers/desma</code> returns a 404 to
                everyone, and applications are refused — so nothing is reachable or indexable until
                you turn it on. Everything inside Hiring works either way.
              </>
            )}
          </p>
        </div>
        <span
          className={
            "inline-flex items-center h-7 px-md rounded-full text-label-sm whitespace-nowrap " +
            (isPublic ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant")
          }
        >
          {isPublic ? "Live" : "Off"}
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-sm text-on-error-container">
          {error}
        </div>
      )}

      {isPublic && liveJobCount === 0 && (
        <p className="text-body-sm text-error">
          It is live with nothing on it — visitors see &ldquo;No open roles right now&rdquo;. Publish
          a requisition, or switch this back off.
        </p>
      )}

      <button
        type="button"
        className={
          "h-10 px-lg rounded-lg font-semibold transition disabled:opacity-60 " +
          (isPublic
            ? "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
            : "bg-primary text-on-primary hover:bg-primary-container")
        }
        disabled={busy}
        onClick={() => toggle(!isPublic)}
      >
        {busy ? "Saving…" : isPublic ? "Take it offline" : "Publish the careers page"}
      </button>
    </section>
  );
}
