"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Policy = {
  id: string;
  departmentId: string | null;
  departmentName: string | null;
  enabled: boolean;
  includeHolidays: boolean;
  includeWeekOffs: boolean;
  maxGapDays: number;
  notes: string | null;
};

export function SandwichPolicyClient({
  canEdit,
  policies,
  departments,
}: {
  canEdit: boolean;
  policies: Policy[];
  departments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    departmentId: "",
    enabled: true,
    includeHolidays: true,
    includeWeekOffs: true,
    maxGapDays: 7,
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/hr/sandwich-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          departmentId: form.departmentId || null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this sandwich policy?")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/hr/sandwich-policy/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed");
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
      <Section title="How it works">
        <p className="text-label-sm text-on-surface-variant">
          When an employee takes leave on the day BEFORE and AFTER a stretch of intermediate
          week-offs / holidays, those intermediate days are counted as leave (LOP) too.
          Configure a company-wide default policy (no department), or override per department.
        </p>
      </Section>

      <Section title="Add / update policy">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-base">
          <Field label="Scope">
            <select
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            >
              <option value="">Company-wide (default)</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max gap days between leaves">
            <input
              type="number"
              min={1}
              max={31}
              value={form.maxGapDays}
              onChange={(e) => setForm({ ...form, maxGapDays: Number(e.target.value) })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </Field>
          <Field label="Notes">
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </Field>
        </div>
        <div className="mt-base flex flex-wrap items-center gap-base">
          <label className="flex items-center gap-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>Enabled</span>
          </label>
          <label className="flex items-center gap-sm">
            <input
              type="checkbox"
              checked={form.includeHolidays}
              onChange={(e) => setForm({ ...form, includeHolidays: e.target.checked })}
            />
            <span>Include holidays</span>
          </label>
          <label className="flex items-center gap-sm">
            <input
              type="checkbox"
              checked={form.includeWeekOffs}
              onChange={(e) => setForm({ ...form, includeWeekOffs: e.target.checked })}
            />
            <span>Include week-offs</span>
          </label>
          <div className="ml-auto">
            {err && <span className="text-error text-label-sm mr-base">{err}</span>}
            <button
              type="button"
              onClick={save}
              disabled={!canEdit || busy}
              className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save policy"}
            </button>
          </div>
        </div>
      </Section>

      <Section title="Existing policies">
        {policies.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No policies configured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
                <tr>
                  <th className="px-sm py-xs text-left">Scope</th>
                  <th className="px-sm py-xs text-left">Status</th>
                  <th className="px-sm py-xs text-right">Max gap</th>
                  <th className="px-sm py-xs text-left">Includes</th>
                  <th className="px-sm py-xs text-left">Notes</th>
                  <th className="px-sm py-xs text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className="border-t border-outline-variant">
                    <td className="px-sm py-sm font-semibold">
                      {p.departmentName ?? "Company-wide"}
                    </td>
                    <td className="px-sm py-sm">
                      {p.enabled ? (
                        <span className="px-xs py-[1px] bg-green-100 text-green-800 rounded text-caption font-semibold uppercase">
                          On
                        </span>
                      ) : (
                        <span className="px-xs py-[1px] bg-surface-container-high text-on-surface-variant rounded text-caption font-semibold uppercase">
                          Off
                        </span>
                      )}
                    </td>
                    <td className="px-sm py-sm text-right tabular-nums">{p.maxGapDays}</td>
                    <td className="px-sm py-sm text-on-surface-variant">
                      {p.includeHolidays ? "Holidays" : ""}
                      {p.includeHolidays && p.includeWeekOffs ? ", " : ""}
                      {p.includeWeekOffs ? "Week-offs" : ""}
                    </td>
                    <td className="px-sm py-sm text-on-surface-variant">{p.notes ?? "—"}</td>
                    <td className="px-sm py-sm text-right">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => remove(p.id)}
                          className="px-sm py-[2px] rounded bg-red-100 text-red-800 text-caption font-semibold"
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
        )}
      </Section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-xs block">
      <span className="text-caption uppercase tracking-wider text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}
