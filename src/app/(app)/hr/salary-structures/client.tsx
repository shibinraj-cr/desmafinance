"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Row = {
  id: string;
  empCode: string;
  name: string;
  designation: string | null;
  effectiveFrom: string | null;
  basic: number;
  hraPct: number;
  conveyancePct: number;
  medicalPct: number;
  specialPct: number;
  gross: number;
  esiApplicable: boolean;
  pfApplicable: boolean;
  professionalTax: number;
  esiEmployee: number;
  pfEmployee: number;
  netTakeHome: number;
  hasStructure: boolean;
};

function inr(n: number) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export function SalaryStructuresClient({
  rows,
  canEdit,
}: {
  rows: Row[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "missing">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [editBasic, setEditBasic] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const filtered = rows.filter((r) => {
    if (filter === "missing" && r.hasStructure) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.empCode.toLowerCase().includes(q) ||
      (r.designation ?? "").toLowerCase().includes(q)
    );
  });

  async function saveBasic(empId: string) {
    setError(null);
    const basic = Number(editBasic);
    if (!basic || basic <= 0) {
      setError("Enter a valid Basic amount");
      return;
    }
    const res = await fetch(`/api/hr/employees/${empId}/salary-structure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        effectiveFrom: new Date().toISOString().slice(0, 7),
        basic,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setEditing(null);
    setEditBasic("");
    start(() => router.refresh());
  }

  return (
    <Section title="">
      <div className="flex flex-wrap items-center gap-sm mb-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, code, designation…"
          className="flex-1 min-w-[200px] px-sm py-sm rounded border border-outline-variant bg-surface"
        />
        <div className="flex gap-xs">
          {(["all", "missing"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "px-sm py-xs rounded text-label-sm capitalize " +
                (filter === f
                  ? "bg-primary text-on-primary font-bold"
                  : "bg-surface-container text-on-surface-variant")
              }
            >
              {f === "missing" ? "Missing only" : "All"}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-red-700 text-label-sm mb-sm">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-label-sm">
          <thead className="text-left text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-sm pr-md">Employee</th>
              <th className="py-sm pr-md">Effective</th>
              <th className="py-sm pr-md text-right">Basic</th>
              <th className="py-sm pr-md text-right">HRA</th>
              <th className="py-sm pr-md text-right">Conv</th>
              <th className="py-sm pr-md text-right">Med</th>
              <th className="py-sm pr-md text-right">Spl</th>
              <th className="py-sm pr-md text-right">Gross</th>
              <th className="py-sm pr-md text-right">PF(E)</th>
              <th className="py-sm pr-md text-right">ESI(E)</th>
              <th className="py-sm pr-md text-right">PT</th>
              <th className="py-sm pr-md text-right">Net Take-home</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const hra = Math.round((r.basic * r.hraPct) / 100);
              const conv = Math.round((r.basic * r.conveyancePct) / 100);
              const med = Math.round((r.basic * r.medicalPct) / 100);
              const spl = Math.round((r.basic * r.specialPct) / 100);
              const isEditing = editing === r.id;
              return (
                <tr
                  key={r.id}
                  className={
                    "border-b border-outline-variant last:border-0 " +
                    (r.hasStructure ? "" : "bg-yellow-50/40")
                  }
                >
                  <td className="py-sm pr-md font-semibold whitespace-nowrap">
                    <Link href={`/hr/employees/${r.id}`} className="hover:underline">
                      {r.empCode} · {r.name}
                    </Link>
                    {r.designation && (
                      <div className="text-caption text-on-surface-variant">{r.designation}</div>
                    )}
                  </td>
                  <td className="py-sm pr-md text-on-surface-variant">
                    {r.effectiveFrom ?? <span className="text-red-700">not set</span>}
                  </td>
                  <td className="py-sm pr-md text-right">
                    {isEditing ? (
                      <input
                        autoFocus
                        type="number"
                        className="w-24 px-xs py-xs rounded border border-outline-variant bg-surface text-right"
                        value={editBasic}
                        onChange={(e) => setEditBasic(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveBasic(r.id);
                          if (e.key === "Escape") {
                            setEditing(null);
                            setEditBasic("");
                          }
                        }}
                      />
                    ) : (
                      <span className="font-bold">{r.hasStructure ? inr(r.basic) : "—"}</span>
                    )}
                  </td>
                  <td className="py-sm pr-md text-right">{r.hasStructure ? inr(hra) : "—"}</td>
                  <td className="py-sm pr-md text-right">{r.hasStructure ? inr(conv) : "—"}</td>
                  <td className="py-sm pr-md text-right">{r.hasStructure ? inr(med) : "—"}</td>
                  <td className="py-sm pr-md text-right">{r.hasStructure ? inr(spl) : "—"}</td>
                  <td className="py-sm pr-md text-right font-bold">
                    {r.hasStructure ? inr(r.gross) : "—"}
                  </td>
                  <td className="py-sm pr-md text-right">
                    {r.hasStructure ? inr(r.pfEmployee) : "—"}
                  </td>
                  <td className="py-sm pr-md text-right">
                    {r.hasStructure ? inr(r.esiEmployee) : "—"}
                  </td>
                  <td className="py-sm pr-md text-right">
                    {r.hasStructure ? inr(r.professionalTax) : "—"}
                  </td>
                  <td className="py-sm pr-md text-right font-bold">
                    {r.hasStructure ? inr(r.netTakeHome) : "—"}
                  </td>
                  {canEdit && (
                    <td className="py-sm pr-md text-right">
                      {isEditing ? (
                        <>
                          <button
                            disabled={pending}
                            onClick={() => saveBasic(r.id)}
                            className="text-green-700 underline mr-sm"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditing(null);
                              setEditBasic("");
                            }}
                            className="text-on-surface-variant underline"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setEditing(r.id);
                            setEditBasic(r.hasStructure ? String(r.basic) : "");
                          }}
                          className="text-blue-700 underline"
                        >
                          {r.hasStructure ? "Update Basic" : "Set Basic"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 13 : 12} className="py-lg text-center text-on-surface-variant">
                  No employees match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-on-surface-variant mt-md">
        Edit Basic inline to push a new structure with today&apos;s effective month using default
        50 / 25 / 35 / 40 allowance %s. For advanced overrides (allowance %s, PF/ESI toggle, PT
        override), open the employee profile &rarr; Salary Structure tab.
      </p>
    </Section>
  );
}
