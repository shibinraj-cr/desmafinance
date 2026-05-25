"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Row = {
  id: string;
  name: string;
  description: string | null;
  headEmployeeId: string | null;
  headLabel: string | null;
  active: boolean;
  members: number;
};
type EmpLite = { id: string; empCode: string; name: string };

export function DepartmentsEditor({
  rows,
  employees,
  canEdit,
}: {
  rows: Row[];
  employees: EmpLite[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ name: "", description: "", headEmployeeId: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editVals, setEditVals] = useState({ name: "", description: "", headEmployeeId: "" });
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const res = await fetch("/api/hr/departments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...draft,
        description: draft.description || null,
        headEmployeeId: draft.headEmployeeId || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "add failed");
      return;
    }
    setDraft({ name: "", description: "", headEmployeeId: "" });
    start(() => router.refresh());
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/hr/departments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...editVals,
        description: editVals.description || null,
        headEmployeeId: editVals.headEmployeeId || null,
      }),
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
    if (!confirm("Delete this department? (If employees use it, it will be deactivated.)")) return;
    const res = await fetch(`/api/hr/departments/${id}`, { method: "DELETE" });
    if (res.ok) start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {canEdit && (
        <Section title="Add department">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-sm items-end">
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Name</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Sales"
              />
            </label>
            <label className="flex flex-col gap-xs md:col-span-2">
              <span className="text-caption text-on-surface-variant">Description (optional)</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Head (optional)</span>
              <select
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.headEmployeeId}
                onChange={(e) => setDraft({ ...draft, headEmployeeId: e.target.value })}
              >
                <option value="">—</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.empCode} · {e.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={add}
              disabled={pending || !draft.name}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50 md:col-span-4 md:w-fit"
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
              <th className="py-sm pr-md">Head</th>
              <th className="py-sm pr-md text-right">Members</th>
              <th className="py-sm pr-md">Status</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-outline-variant last:border-0 align-top">
                <td className="py-sm pr-md font-semibold">
                  {editing === r.id ? (
                    <div className="flex flex-col gap-xs">
                      <input
                        className="px-xs py-xs rounded border border-outline-variant bg-surface"
                        value={editVals.name}
                        onChange={(e) => setEditVals({ ...editVals, name: e.target.value })}
                      />
                      <input
                        placeholder="Description"
                        className="px-xs py-xs rounded border border-outline-variant bg-surface text-caption"
                        value={editVals.description}
                        onChange={(e) =>
                          setEditVals({ ...editVals, description: e.target.value })
                        }
                      />
                    </div>
                  ) : (
                    <>
                      {r.name}
                      {r.description && (
                        <div className="text-caption text-on-surface-variant">{r.description}</div>
                      )}
                    </>
                  )}
                </td>
                <td className="py-sm pr-md">
                  {editing === r.id ? (
                    <select
                      className="px-xs py-xs rounded border border-outline-variant bg-surface text-label-sm"
                      value={editVals.headEmployeeId}
                      onChange={(e) =>
                        setEditVals({ ...editVals, headEmployeeId: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.empCode} · {e.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-on-surface-variant">{r.headLabel ?? "—"}</span>
                  )}
                </td>
                <td className="py-sm pr-md text-right">{r.members}</td>
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
                            setEditVals({
                              name: r.name,
                              description: r.description ?? "",
                              headEmployeeId: r.headEmployeeId ?? "",
                            });
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
                  No departments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
