"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The Meta pixel for the careers site.
 *
 * Takes the ID, not the script block — marketing is invariably sent the whole
 * `<script>` snippet, so the field says which part of it is wanted and the API
 * rejects the rest with the same explanation rather than storing something
 * inert.
 */
export function MetaPixelSetting({
  pixelId,
  careersPublic,
}: {
  pixelId: string | null;
  careersPublic: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(pixelId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: string) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/hiring/meta-pixel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pixelId: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That didn't save.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div>
          <h3 className="text-h3 text-on-surface">Meta pixel (Facebook &amp; Instagram ads)</h3>
          <p className="text-body-sm text-on-surface-variant max-w-prose">
            Measures who reached the careers page from an ad and who went on to apply. It loads on{" "}
            <code className="text-caption">/careers/desma</code> only — never inside Desgro, where
            the pages show salaries, résumés and client records.
          </p>
        </div>
        <span
          className={
            "inline-flex items-center h-7 px-md rounded-full text-label-sm whitespace-nowrap " +
            (pixelId ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant")
          }
        >
          {pixelId ? "Tracking" : "Not set"}
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-sm text-on-error-container">
          {error}
        </div>
      )}
      {saved && !error && (
        <p className="text-body-sm text-on-surface-variant">Saved.</p>
      )}

      <label className="block max-w-sm">
        <span className="block text-label-sm text-on-surface-variant mb-xs">
          Pixel ID — the number inside <code className="text-caption">fbq(&apos;init&apos;, &apos;…&apos;)</code>
        </span>
        <input
          className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md tabular-nums"
          inputMode="numeric"
          placeholder="1234567890123456"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold transition hover:bg-primary-container disabled:opacity-60"
          disabled={busy || value.trim() === (pixelId ?? "")}
          onClick={() => save(value.trim())}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {pixelId && (
          <button
            type="button"
            className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60"
            disabled={busy}
            onClick={() => {
              setValue("");
              void save("");
            }}
          >
            Stop tracking
          </button>
        )}
      </div>

      {pixelId && !careersPublic && (
        <p className="text-body-sm text-error">
          The careers page is switched off, so the pixel has nothing to fire on and your ad would
          land on a 404. Publish it above before the ad goes live.
        </p>
      )}

      <div className="text-body-sm text-on-surface-variant border-t border-outline-variant pt-sm space-y-xs max-w-prose">
        <p>
          <strong className="text-on-surface">PageView</strong> fires on the careers list and each
          job page. <strong className="text-on-surface">Lead</strong> fires when somebody submits an
          application, tagged with the job title — so one pixel serves every role and still reports
          them separately.
        </p>
        <p>
          Job ads are a Meta <strong className="text-on-surface">Special Ad Category</strong>: set
          that in Ads Manager, and expect age, gender and detailed targeting to be unavailable.
        </p>
      </div>
    </section>
  );
}
