"use client";

import { useState } from "react";
import { Section } from "@/components/Cards";

/**
 * The employee's own switch for the celebration band and greeting.
 *
 * Deliberately self-service rather than an HR field: a date of birth is on file
 * because payroll needs it, not because the person agreed to have it announced
 * to the company. Opting out covers both surfaces — no band entry, no greeting —
 * because "leave me out of it" is the only reading of this that does not need
 * a paragraph of explanation.
 */
export function CelebrationOptOutClient({ optedOut }: { optedOut: boolean }) {
  const [value, setValue] = useState(optedOut);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function change(next: boolean) {
    setBusy(true);
    setErr(null);
    setOk(null);
    // Optimistic: the switch is cosmetic and reverting on failure is clearer
    // than a control that ignores the click for a second.
    setValue(next);
    try {
      const res = await fetch("/api/me/celebration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ celebrationOptOut: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save that. Try again.");
      setOk(next ? "You're off the celebration band." : "You're back on the celebration band.");
    } catch (e) {
      setValue(!next);
      setErr(e instanceof Error ? e.message : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Celebrations">
      <label className="flex items-start gap-sm py-xs">
        <input
          type="checkbox"
          className="mt-[3px]"
          checked={value}
          disabled={busy}
          onChange={(e) => change(e.target.checked)}
        />
        <span>
          <span className="font-semibold">Keep my birthday and work anniversary private</span>
          <span className="block text-caption text-on-surface-variant">
            Nobody sees them on the band under the header, and you won&apos;t get the greeting
            either. Your dates stay on file for HR and payroll as normal.
          </span>
        </span>
      </label>
      {err && <p className="mt-sm text-label-sm font-semibold text-error">{err}</p>}
      {ok && <p className="mt-sm text-label-sm font-semibold">{ok}</p>}
    </Section>
  );
}
