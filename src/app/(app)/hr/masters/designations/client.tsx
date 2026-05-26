"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Row = { id: string; name: string; level: number; active: boolean; count: number };

export function DesignationsEditor({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ name: "", level: 30 });
  const [editing, setEditing] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<{ name: string; level: number }>({ name: "", level: 0 });
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const res = await fetch("/api/hr/designations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "add failed");
      return;
    }
    setDraft({ name: "", level: 30 });
    start(() => router.refresh());
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/hr/designations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(editVals),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setEditing(null);
    start(() => router.refresh());
  }

  async function remove(id: string) {
    if (!confirm("Delete this designation? (If employees use it, it will be deactivated.)")) return;
    const res = await fetch(`/api/hr/designations/${id}`, { method: "DELETE" });
    if (res.ok) start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {canEdit && (
        <Section title="Add designation">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-sm items-end">
            <label className="flex flex-col gap-xs md:col-span-2">
              <span className="text-caption text-on-surface-variant">Name</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Senior Manager"
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">
                Level (higher = more senior)
              </span>
              <input
                type="number"
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.level}
                onChange={(e) => setDraft({ ...draft, level: Number(e.target.value) })}
              />
            </label>
            <button
              onClick={add}
              disabled={pending || !draft.name}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
            >
              Add
            </button>
            {error && <p className="text-red-700 text-label-sm md:col-span-4">{error}</p>}
          </div>
        </Section>
      )}
      <Section title="">
        <table className="w-full text-label-sm">
          <thead className="text-left text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-sm pr-md">Name</th>
              <th className="py-sm pr-md text-right">Level</th>
              <th className="py-sm pr-md text-right">Employees</th>
              <th className="py-sm pr-md">Status</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-outline-variant last:border-0">
                <td className="py-sm pr-md font-semibold">
                  {editing === r.id ? (
                    <input
                      className="px-xs py-xs rounded border border-outline-variant bg-surface w-full"
                      value={editVals.name}
                      onChange={(e) => setEditVals({ ...editVals, name: e.target.value })}
                    />
                  ) : (
                    r.name
                  )}
                </td>
                <td className="py-sm pr-md text-right">
                  {editing === r.id ? (
                    <input
                      type="number"
                      className="w-20 px-xs py-xs rounded border border-outline-variant bg-surface text-right"
                      value={editVals.level}
                      onChange={(e) => setEditVals({ ...editVals, level: Number(e.target.value) })}
                    />
                  ) : (
                    r.level
                  )}
                </td>
                <td className="py-sm pr-md text-right text-on-surface-variant">{r.count}</td>
                <td className="py-sm pr-md">
                  {r.active ? (
                    <span className="text-green-700">Active</span>
                  ) : (
                    <span className="text-on-surface-variant">Inactive</span>
                  )}
                </td>
                {canEdit && (
                  <td className="py-sm pr-md text-right whitespace-nowrap">
                    {editing === r.id ? (
                      <>
                        <button
                          onClick={() => saveEdit(r.id)}
                          className="text-green-700 underline mr-sm"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="text-on-surface-variant underline"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditing(r.id);
                            setEditVals({ name: r.name, level: r.level });
                          }}
                          className="text-blue-700 underline mr-sm"
                        >
                          Edit
                        </button>
                        <button onClick={() => remove(r.id)} className="text-red-700 underline">
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="py-lg text-center text-on-surface-variant">
                  No designations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
