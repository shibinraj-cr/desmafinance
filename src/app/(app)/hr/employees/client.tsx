"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Section } from "@/components/Cards";

type ShiftLite = { id: string; code: string; name: string };

type Employee = {
  id: string;
  empCode: string;
  name: string;
  designation: string | null;
  department: string | null;
  shiftName: string | null;
  shiftCode: string | null;
  email: string | null;
  officialEmail: string | null;
  phone: string | null;
  joinDate: Date | null;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  branch: string | null;
  halfHourConcession: boolean;
  active: boolean;
  userId: string | null;
  hasCurrentStructure: boolean;
};

function fmtDate(d: Date | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function EmployeesTable({
  employees,
  canEdit,
}: {
  employees: Employee[];
  canEdit: boolean;
  shifts: ShiftLite[];
}) {
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const filtered = employees.filter((e) => {
    if (!showInactive && !e.active) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      e.empCode.toLowerCase().includes(q) ||
      (e.department ?? "").toLowerCase().includes(q) ||
      (e.designation ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <Section title="">
      <div className="flex flex-wrap items-center gap-sm mb-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, code, dept…"
          className="flex-1 min-w-[200px] px-sm py-sm rounded border border-outline-variant bg-surface"
        />
        <label className="flex items-center gap-xs text-label-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-label-sm">
          <thead className="text-left text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-sm pr-md">#</th>
              <th className="py-sm pr-md">Name</th>
              <th className="py-sm pr-md">Designation</th>
              <th className="py-sm pr-md">Department</th>
              <th className="py-sm pr-md">Shift</th>
              <th className="py-sm pr-md">Join Date</th>
              <th className="py-sm pr-md">Bank</th>
              <th className="py-sm pr-md">Salary</th>
              <th className="py-sm pr-md">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container">
                <td className="py-sm pr-md text-on-surface-variant">{e.empCode}</td>
                <td className="py-sm pr-md font-semibold">
                  <Link href={`/hr/employees/${e.id}`} className="hover:underline">
                    {e.name}
                  </Link>
                </td>
                <td className="py-sm pr-md">{e.designation ?? "—"}</td>
                <td className="py-sm pr-md">{e.department ?? "—"}</td>
                <td className="py-sm pr-md">
                  {e.shiftCode ? (
                    <span className="px-xs py-[2px] rounded bg-surface-container text-label-sm">
                      {e.shiftCode}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-sm pr-md">{fmtDate(e.joinDate)}</td>
                <td className="py-sm pr-md text-on-surface-variant">
                  {e.bankName ? `${e.bankName} · ${e.accountNumber}` : "—"}
                </td>
                <td className="py-sm pr-md">
                  {e.hasCurrentStructure ? (
                    <span className="text-green-700">Set</span>
                  ) : (
                    <span className="text-red-700">Missing</span>
                  )}
                </td>
                <td className="py-sm pr-md">
                  {e.active ? (
                    <span className="text-green-700">Active</span>
                  ) : (
                    <span className="text-on-surface-variant">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-lg text-center text-on-surface-variant">
                  No employees match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function NewEmployeeButton({ shifts }: { shifts: ShiftLite[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    empCode: "",
    name: "",
    designation: "",
    department: "",
    email: "",
    phone: "",
    joinDate: "",
    shiftId: "",
    halfHourConcession: false,
    accountNumber: "",
    ifsc: "",
    bankName: "",
    branch: "",
  });
  async function save() {
    setError(null);
    const res = await fetch("/api/hr/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, shiftId: draft.shiftId || null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "create failed");
      return;
    }
    setOpen(false);
    start(() => router.refresh());
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-md py-sm rounded bg-primary text-on-primary font-bold"
      >
        + Add employee
      </button>
      {open && (
        <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-md" onClick={() => setOpen(false)}>
          <div
            className="bg-surface rounded-xl shadow-2xl max-w-2xl w-full p-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-h3 mb-md">New employee</h3>
            <div className="grid grid-cols-2 gap-sm">
              <Field label="Employee Code *">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.empCode}
                  onChange={(e) => setDraft({ ...draft, empCode: e.target.value })}
                />
              </Field>
              <Field label="Name *">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Designation">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.designation}
                  onChange={(e) => setDraft({ ...draft, designation: e.target.value })}
                />
              </Field>
              <Field label="Department">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.department}
                  onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              </Field>
              <Field label="Join Date (any text)">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  placeholder="11 Nov 2024"
                  value={draft.joinDate}
                  onChange={(e) => setDraft({ ...draft, joinDate: e.target.value })}
                />
              </Field>
              <Field label="Shift">
                <select
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.shiftId}
                  onChange={(e) => setDraft({ ...draft, shiftId: e.target.value })}
                >
                  <option value="">—</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Account No.">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.accountNumber}
                  onChange={(e) => setDraft({ ...draft, accountNumber: e.target.value })}
                />
              </Field>
              <Field label="IFSC">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.ifsc}
                  onChange={(e) => setDraft({ ...draft, ifsc: e.target.value })}
                />
              </Field>
              <Field label="Bank">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.bankName}
                  onChange={(e) => setDraft({ ...draft, bankName: e.target.value })}
                />
              </Field>
              <Field label="Branch">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.branch}
                  onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
                />
              </Field>
              <label className="col-span-2 flex items-start gap-xs text-label-sm">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  checked={draft.halfHourConcession}
                  onChange={(e) => setDraft({ ...draft, halfHourConcession: e.target.checked })}
                />
                <span>
                  <span className="font-semibold">Late Coming Eligibility</span>
                  <span className="block text-caption text-on-surface-variant">
                    Allows 30-min late arrival on up to 3 days per cycle.
                  </span>
                </span>
              </label>
            </div>
            {error && <p className="text-red-700 text-label-sm mt-sm">{error}</p>}
            <div className="flex justify-end gap-sm mt-md">
              <button onClick={() => setOpen(false)} className="px-md py-sm rounded border border-outline-variant">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={pending || !draft.empCode || !draft.name}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ImportEmployeesButton() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setStatus("Uploading…");
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/hr/employees/import", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(`Failed: ${j.error || res.statusText}`);
      return;
    }
    setStatus(
      `Imported ${j.created ?? 0} created, ${j.updated ?? 0} updated, ${j.skipped ?? 0} skipped`,
    );
    start(() => router.refresh());
  }
  return (
    <div className="flex items-center gap-sm">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="px-md py-sm rounded border border-outline-variant"
        disabled={pending}
      >
        Import from Excel
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xls,.xlsx"
        className="hidden"
        onChange={onPick}
      />
      {status && <span className="text-caption text-on-surface-variant">{status}</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-xs">
      <span className="text-caption text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}
