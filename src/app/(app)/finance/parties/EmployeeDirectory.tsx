"use client";

import { useMemo, useState } from "react";
import type { EmployeeDirectoryRow } from "@/lib/hr-data";

/**
 * Read-only employee directory shown inside the Finance "Parties" tab. By
 * design it exposes ONLY name, designation, and department — no contact, bank,
 * salary, or join details — and offers no create/edit/delete. Employee records
 * are managed exclusively in the HR module.
 */
export function EmployeeDirectory({ employees }: { employees: EmployeeDirectoryRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.designation ?? "").toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q),
    );
  }, [employees, search]);

  return (
    <div className="space-y-md">
      <div className="flex flex-wrap items-center gap-base">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employees…"
          className="h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary"
        />
        <span className="text-caption text-on-surface-variant">
          {filtered.length} of {employees.length}
        </span>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-body-md">
          <thead className="bg-surface-container-low text-on-surface-variant">
            <tr className="text-left">
              <th className="px-md py-sm font-semibold">Name</th>
              <th className="px-md py-sm font-semibold">Designation</th>
              <th className="px-md py-sm font-semibold">Department</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-t border-outline-variant">
                <td className="px-md py-sm font-medium text-on-surface">{e.name}</td>
                <td className="px-md py-sm text-on-surface-variant">{e.designation ?? "—"}</td>
                <td className="px-md py-sm text-on-surface-variant">{e.department ?? "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-md py-lg text-center text-on-surface-variant text-label-sm"
                >
                  No employees match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-caption text-on-surface-variant">
        Read-only. Employee records are created and managed in the HR module.
      </p>
    </div>
  );
}
