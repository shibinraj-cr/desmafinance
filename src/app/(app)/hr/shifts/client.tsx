"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Shift = {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayCutoffTime: string | null;
  active: boolean;
};

const BLANK: Omit<Shift, "id"> = {
  code: "",
  name: "",
  startTime: "09:00",
  endTime: "17:30",
  graceMinutes: 10,
  halfDayCutoffTime: null,
  active: true,
};

export function ShiftsEditor({ shifts, canEdit }: { shifts: Shift[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<typeof BLANK>(BLANK);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    start(() => router.refresh());
  }

  async function create() {
    setError(null);
    const res = await fetch("/api/hr/shifts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "create failed");
      return;
    }
    setDraft(BLANK);
    refresh();
  }

  async function patch(id: string, body: Partial<Shift>) {
    const res = await fetch(`/api/hr/shifts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "update failed");
      return;
    }
    refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this shift? (If employees are using it, it will be deactivated instead.)")) return;
    const res = await fetch(`/api/hr/shifts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("delete failed");
      return;
    }
    refresh();
  }

  return (
    <div className="space-y-lg">
      {canEdit && (
        <Section title="Add shift">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-sm items-end">
            <Field label="Code">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Name" className="md:col-span-2">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Start (HH:mm)">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.startTime}
                onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
              />
            </Field>
            <Field label="End (HH:mm)">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.endTime}
                onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
              />
            </Field>
            <Field label="Grace mins">
              <input
                type="number"
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.graceMinutes}
                onChange={(e) =>
                  setDraft({ ...draft, graceMinutes: Math.max(0, Number(e.target.value || 0)) })
                }
              />
            </Field>
            <div className="md:col-span-6 flex gap-sm">
              <button
                disabled={pending || !draft.code || !draft.name}
                onClick={create}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                Add shift
              </button>
              {error && <span className="text-red-700 text-label-sm">{error}</span>}
            </div>
          </div>
        </Section>
      )}

      <Section title="Shifts">
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Code</th>
                <th className="py-sm pr-md">Name</th>
                <th className="py-sm pr-md">Start</th>
                <th className="py-sm pr-md">End</th>
                <th className="py-sm pr-md">Grace</th>
                <th className="py-sm pr-md">Active</th>
                {canEdit && <th className="py-sm pr-md text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} className="border-b border-outline-variant last:border-0">
                  <td className="py-sm pr-md font-bold">{s.code}</td>
                  <td className="py-sm pr-md">{s.name}</td>
                  <td className="py-sm pr-md">{s.startTime}</td>
                  <td className="py-sm pr-md">{s.endTime}</td>
                  <td className="py-sm pr-md">{s.graceMinutes} min</td>
                  <td className="py-sm pr-md">
                    {s.active ? (
                      <span className="text-green-700">Active</span>
                    ) : (
                      <span className="text-on-surface-variant">Inactive</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="py-sm pr-md text-right">
                      <button
                        onClick={() => patch(s.id, { active: !s.active })}
                        className="text-label-sm underline mr-sm"
                      >
                        {s.active ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => remove(s.id)} className="text-label-sm text-red-700 underline">
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="py-lg text-center text-on-surface-variant">
                    No shifts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"flex flex-col gap-xs " + className}>
      <span className="text-caption text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}
