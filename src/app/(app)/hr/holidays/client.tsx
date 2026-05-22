"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Holiday = { id: string; date: string; label: string; paid: boolean };

export function HolidaysEditor({ holidays, canEdit }: { holidays: Holiday[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ date: "", label: "", paid: true });
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const res = await fetch("/api/hr/holidays", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "add failed");
      return;
    }
    setDraft({ date: "", label: "", paid: true });
    start(() => router.refresh());
  }
  async function remove(id: string) {
    if (!confirm("Delete this holiday?")) return;
    const res = await fetch(`/api/hr/holidays/${id}`, { method: "DELETE" });
    if (res.ok) start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {canEdit && (
        <Section title="Add holiday">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-sm items-end">
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Date</span>
              <input
                type="date"
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs md:col-span-2">
              <span className="text-caption text-on-surface-variant">Label</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-xs text-label-sm">
              <input
                type="checkbox"
                checked={draft.paid}
                onChange={(e) => setDraft({ ...draft, paid: e.target.checked })}
              />
              Paid
            </label>
            <button
              onClick={add}
              disabled={pending || !draft.date || !draft.label}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50 md:col-span-4 md:w-fit"
            >
              Add
            </button>
            {error && <p className="text-red-700 text-label-sm md:col-span-4">{error}</p>}
          </div>
        </Section>
      )}
      <Section title="Holidays">
        <table className="w-full text-label-sm">
          <thead className="text-left text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-sm pr-md">Date</th>
              <th className="py-sm pr-md">Label</th>
              <th className="py-sm pr-md">Paid</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.id} className="border-b border-outline-variant last:border-0">
                <td className="py-sm pr-md">{h.date}</td>
                <td className="py-sm pr-md">{h.label}</td>
                <td className="py-sm pr-md">{h.paid ? "Yes" : "No"}</td>
                {canEdit && (
                  <td className="py-sm pr-md text-right">
                    <button onClick={() => remove(h.id)} className="text-red-700 underline">
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {holidays.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 4 : 3} className="py-lg text-center text-on-surface-variant">
                  No holidays.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
