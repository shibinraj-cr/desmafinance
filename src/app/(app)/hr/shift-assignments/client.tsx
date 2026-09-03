"use client";

import { useMemo, useState } from "react";
import { MultiSelect } from "@/components/MultiSelect";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Employee = { id: string; empCode: string; name: string; shiftId: string | null };
type Shift = {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
};
type Assignment = {
  id: string;
  employeeId: string;
  empCode: string;
  name: string;
  shiftId: string;
  shiftCode: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  status: string;
  reviewNote: string | null;
};

export function ShiftAssignmentsClient({
  canApprove,
  employees,
  shifts,
  assignments,
  filter,
}: {
  canApprove: boolean;
  employees: Employee[];
  shifts: Shift[];
  assignments: Assignment[];
  filter: { employeeId: string[]; status: string[] };
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    // Pre-fill from the filter when it names exactly one employee.
    employeeId: filter.employeeId[0] ?? employees[0]?.id ?? "",
    shiftId: shifts[0]?.id ?? "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const byEmployee = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const arr = m.get(a.employeeId) ?? [];
      arr.push(a);
      m.set(a.employeeId, arr);
    }
    return m;
  }, [assignments]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/hr/shift-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: form.employeeId,
          shiftId: form.shiftId,
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || null,
          reason: form.reason || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add assignment");
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, status: "approved" | "rejected") {
    setBusy(true);
    setErr(null);
    try {
      const note = status === "rejected" ? prompt("Reason for rejection?") ?? "" : "";
      const res = await fetch(`/api/hr/shift-assignments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reviewNote: note || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update");
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this shift assignment? This cannot be undone.")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/hr/shift-assignments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete");
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="Add new assignment">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-base">
          <Field label="Employee">
            <select
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.empCode} · {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shift">
            <select
              value={form.shiftId}
              onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            >
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name} ({s.startTime}–{s.endTime})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Effective from">
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </Field>
          <Field label="Effective to (optional)">
            <input
              type="date"
              value={form.effectiveTo}
              onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </Field>
          <Field label="Reason">
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. Moved to evening floor"
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </Field>
        </div>
        <div className="mt-base flex items-center justify-between">
          {err ? <p className="text-error text-label-sm">{err}</p> : <span />}
          <button
            type="button"
            onClick={submit}
            disabled={busy || !form.employeeId || !form.shiftId || !form.effectiveFrom}
            className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
          >
            {busy ? "Saving…" : canApprove ? "Add assignment" : "Submit for review"}
          </button>
        </div>
        {!canApprove && (
          <p className="mt-sm text-caption text-on-surface-variant">
            Your role can submit shift change requests — an HR Manager must approve before the new
            shift takes effect.
          </p>
        )}
      </Section>

      <Section
        title="Assignment history"
        action={
          <FilterBar
            filter={filter}
            employees={employees}
            onChange={(next) => {
              const params = new URLSearchParams();
              for (const id of next.employeeId) params.append("employeeId", id);
              for (const st of next.status) params.append("status", st);
              router.push(`/hr/shift-assignments${params.toString() ? "?" + params.toString() : ""}`);
            }}
          />
        }
      >
        {byEmployee.size === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No assignments to show.</p>
        ) : (
          <div className="space-y-base">
            {[...byEmployee.entries()].map(([empId, rows]) => (
              <div
                key={empId}
                className="border border-outline-variant rounded-lg overflow-hidden"
              >
                <div className="px-md py-sm bg-surface-container flex items-center justify-between">
                  <p className="font-semibold text-on-surface">
                    {rows[0].empCode} · {rows[0].name}
                  </p>
                  <p className="text-caption text-on-surface-variant">{rows.length} period(s)</p>
                </div>
                <table className="w-full text-label-sm">
                  <thead className="bg-surface-container-low text-on-surface-variant uppercase tracking-wider text-caption">
                    <tr>
                      <th className="px-sm py-xs text-left">Shift</th>
                      <th className="px-sm py-xs text-left">From</th>
                      <th className="px-sm py-xs text-left">To</th>
                      <th className="px-sm py-xs text-left">Reason</th>
                      <th className="px-sm py-xs text-left">Status</th>
                      <th className="px-sm py-xs text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id} className="border-t border-outline-variant">
                        <td className="px-sm py-xs">
                          <span className="font-semibold">{a.shiftCode}</span> · {a.shiftName} (
                          {a.startTime}–{a.endTime})
                        </td>
                        <td className="px-sm py-xs">{a.effectiveFrom}</td>
                        <td className="px-sm py-xs">{a.effectiveTo ?? "—"}</td>
                        <td className="px-sm py-xs text-on-surface-variant">
                          {a.reason ?? "—"}
                          {a.reviewNote && a.status === "rejected" && (
                            <span className="block text-error text-caption">
                              Rejected: {a.reviewNote}
                            </span>
                          )}
                        </td>
                        <td className="px-sm py-xs">
                          <StatusPill status={a.status} />
                        </td>
                        <td className="px-sm py-xs text-right">
                          {canApprove && a.status === "pending" && (
                            <span className="inline-flex gap-xs">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => review(a.id, "approved")}
                                className="px-sm py-[2px] rounded bg-green-600 text-white text-caption"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => review(a.id, "rejected")}
                                className="px-sm py-[2px] rounded bg-red-600 text-white text-caption"
                              >
                                Reject
                              </button>
                            </span>
                          )}
                          {canApprove && a.status !== "pending" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => remove(a.id)}
                              className="px-sm py-[2px] rounded bg-surface-container-high text-on-surface-variant text-caption"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-xs text-label-sm">
      <span className="text-caption text-on-surface-variant uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "approved"
      ? "bg-green-100 text-green-800"
      : status === "pending"
        ? "bg-yellow-100 text-yellow-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={`px-xs py-[1px] rounded text-caption font-semibold uppercase ${cls}`}>
      {status}
    </span>
  );
}

function FilterBar({
  filter,
  employees,
  onChange,
}: {
  filter: { employeeId: string[]; status: string[] };
  employees: Employee[];
  onChange: (next: { employeeId: string[]; status: string[] }) => void;
}) {
  return (
    <div className="flex items-center gap-sm">
      <MultiSelect
        placeholder="All employees"
        options={employees.map((e) => ({ value: e.id, label: `${e.empCode} · ${e.name}` }))}
        selected={filter.employeeId}
        onChange={(next) => onChange({ ...filter, employeeId: next })}
      />
      <MultiSelect
        placeholder="All statuses"
        options={[
          { value: "approved", label: "Approved" },
          { value: "pending", label: "Pending" },
          { value: "rejected", label: "Rejected" },
        ]}
        selected={filter.status}
        onChange={(next) => onChange({ ...filter, status: next })}
      />
    </div>
  );
}
