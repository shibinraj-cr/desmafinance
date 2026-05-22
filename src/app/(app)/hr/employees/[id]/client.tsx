"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type ShiftLite = { id: string; code: string; name: string };

type EmpDraft = {
  id: string;
  empCode: string;
  name: string;
  dob: string;
  designation: string;
  department: string;
  email: string;
  officialEmail: string;
  phone: string;
  emergencyContact: string;
  officeNumber: string;
  address: string;
  highestEducation: string;
  maritalStatus: string;
  experienceNotes: string;
  yearsOfExperience: string;
  aadhar: string;
  pan: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch: string;
  joinDate: string;
  shiftId: string;
  halfHourConcession: boolean;
  active: boolean;
};

type Structure = {
  id: string;
  effectiveFrom: string;
  monthlySalary: number;
  basicPct: number;
  esiApplicable: boolean;
  pfApplicable: boolean;
  professionalTax: number;
  notes: string | null;
};

type Balance = {
  year: number;
  opening: number;
  accrued: number;
  used: number;
  balance: number;
};

export function EmployeeEditor({
  employee,
  shifts,
  structures,
  canEdit,
  currentBalance,
}: {
  employee: EmpDraft;
  shifts: ShiftLite[];
  structures: Structure[];
  canEdit: boolean;
  currentBalance: Balance | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"profile" | "salary" | "leave">("profile");
  const [draft, setDraft] = useState(employee);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function saveProfile() {
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/hr/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...draft,
        shiftId: draft.shiftId || null,
        dob: draft.dob || null,
        joinDate: draft.joinDate || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setSaved(true);
    start(() => router.refresh());
  }

  return (
    <>
      <div className="flex gap-sm border-b border-outline-variant mb-md">
        {(["profile", "salary", "leave"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-md py-sm capitalize border-b-2 -mb-[1px] " +
              (tab === t
                ? "border-primary text-on-surface font-semibold"
                : "border-transparent text-on-surface-variant")
            }
          >
            {t === "salary" ? "Salary Structure" : t === "leave" ? "Leave" : "Profile"}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <Section title="">
          <fieldset disabled={!canEdit} className="grid grid-cols-1 md:grid-cols-3 gap-sm">
            <Field label="Employee Code">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.empCode}
                onChange={(e) => setDraft({ ...draft, empCode: e.target.value })}
              />
            </Field>
            <Field label="Name">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="DOB (YYYY-MM-DD)">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.dob}
                onChange={(e) => setDraft({ ...draft, dob: e.target.value })}
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
            <Field label="Email">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </Field>
            <Field label="Official Email">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.officialEmail}
                onChange={(e) => setDraft({ ...draft, officialEmail: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </Field>
            <Field label="Emergency Contact">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.emergencyContact}
                onChange={(e) => setDraft({ ...draft, emergencyContact: e.target.value })}
              />
            </Field>
            <Field label="Office Number">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.officeNumber}
                onChange={(e) => setDraft({ ...draft, officeNumber: e.target.value })}
              />
            </Field>
            <Field label="Join Date (YYYY-MM-DD)">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.joinDate}
                onChange={(e) => setDraft({ ...draft, joinDate: e.target.value })}
              />
            </Field>
            <Field label="Address" className="md:col-span-3">
              <textarea
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                rows={2}
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
            </Field>
            <Field label="Education">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.highestEducation}
                onChange={(e) => setDraft({ ...draft, highestEducation: e.target.value })}
              />
            </Field>
            <Field label="Marital Status">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.maritalStatus}
                onChange={(e) => setDraft({ ...draft, maritalStatus: e.target.value })}
              />
            </Field>
            <Field label="Years of Experience">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.yearsOfExperience}
                onChange={(e) => setDraft({ ...draft, yearsOfExperience: e.target.value })}
              />
            </Field>
            <Field label="Experience Notes" className="md:col-span-3">
              <textarea
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                rows={2}
                value={draft.experienceNotes}
                onChange={(e) => setDraft({ ...draft, experienceNotes: e.target.value })}
              />
            </Field>
            <Field label="Aadhar">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.aadhar}
                onChange={(e) => setDraft({ ...draft, aadhar: e.target.value })}
              />
            </Field>
            <Field label="PAN">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.pan}
                onChange={(e) => setDraft({ ...draft, pan: e.target.value })}
              />
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
            <Field label="Bank Name">
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
            <label className="flex items-center gap-xs text-label-sm md:col-span-3">
              <input
                type="checkbox"
                checked={draft.halfHourConcession}
                onChange={(e) => setDraft({ ...draft, halfHourConcession: e.target.checked })}
              />
              Half-hour concession (3×/month)
            </label>
            <label className="flex items-center gap-xs text-label-sm md:col-span-3">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              Active
            </label>
          </fieldset>

          {canEdit && (
            <div className="mt-md flex items-center gap-sm">
              <button
                onClick={saveProfile}
                disabled={pending}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                Save profile
              </button>
              {saved && <span className="text-green-700 text-label-sm">Saved.</span>}
              {error && <span className="text-red-700 text-label-sm">{error}</span>}
            </div>
          )}
        </Section>
      )}

      {tab === "salary" && (
        <SalaryStructureTab
          employeeId={employee.id}
          structures={structures}
          canEdit={canEdit}
          monthlySalaryGuess={structures[0]?.monthlySalary ?? 0}
        />
      )}

      {tab === "leave" && <LeaveTab balance={currentBalance} />}
    </>
  );
}

function SalaryStructureTab({
  employeeId,
  structures,
  canEdit,
  monthlySalaryGuess,
}: {
  employeeId: string;
  structures: Structure[];
  canEdit: boolean;
  monthlySalaryGuess: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({
    effectiveFrom: new Date().toISOString().slice(0, 7),
    monthlySalary: monthlySalaryGuess || 0,
    basicPct: 50,
    esiApplicable: true,
    pfApplicable: true,
    professionalTax: 125,
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const res = await fetch(`/api/hr/employees/${employeeId}/salary-structure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    start(() => router.refresh());
  }

  return (
    <>
      {canEdit && (
        <Section title="Add / update structure" className="mb-lg">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-sm items-end">
            <Field label="Effective from (YYYY-MM)">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.effectiveFrom}
                onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
              />
            </Field>
            <Field label="Monthly Salary (₹)">
              <input
                type="number"
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.monthlySalary}
                onChange={(e) => setDraft({ ...draft, monthlySalary: Number(e.target.value) })}
              />
            </Field>
            <Field label="Basic %">
              <input
                type="number"
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.basicPct}
                onChange={(e) => setDraft({ ...draft, basicPct: Number(e.target.value) })}
              />
            </Field>
            <Field label="Professional Tax">
              <input
                type="number"
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.professionalTax}
                onChange={(e) => setDraft({ ...draft, professionalTax: Number(e.target.value) })}
              />
            </Field>
            <label className="flex items-center gap-xs text-label-sm">
              <input
                type="checkbox"
                checked={draft.esiApplicable}
                onChange={(e) => setDraft({ ...draft, esiApplicable: e.target.checked })}
              />
              ESI applicable
            </label>
            <label className="flex items-center gap-xs text-label-sm">
              <input
                type="checkbox"
                checked={draft.pfApplicable}
                onChange={(e) => setDraft({ ...draft, pfApplicable: e.target.checked })}
              />
              PF applicable
            </label>
            <Field label="Notes" className="md:col-span-6">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field>
            <div className="md:col-span-6 flex items-center gap-sm">
              <button
                onClick={save}
                disabled={pending || !draft.monthlySalary}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                Save structure
              </button>
              {error && <span className="text-red-700 text-label-sm">{error}</span>}
            </div>
          </div>
        </Section>
      )}

      <Section title="History">
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Effective from</th>
                <th className="py-sm pr-md">Monthly</th>
                <th className="py-sm pr-md">Basic %</th>
                <th className="py-sm pr-md">ESI</th>
                <th className="py-sm pr-md">PF</th>
                <th className="py-sm pr-md">PT</th>
                <th className="py-sm pr-md">Notes</th>
              </tr>
            </thead>
            <tbody>
              {structures.map((s) => (
                <tr key={s.id} className="border-b border-outline-variant last:border-0">
                  <td className="py-sm pr-md">{s.effectiveFrom}</td>
                  <td className="py-sm pr-md">₹{s.monthlySalary.toLocaleString("en-IN")}</td>
                  <td className="py-sm pr-md">{s.basicPct}%</td>
                  <td className="py-sm pr-md">{s.esiApplicable ? "Yes" : "No"}</td>
                  <td className="py-sm pr-md">{s.pfApplicable ? "Yes" : "No"}</td>
                  <td className="py-sm pr-md">₹{s.professionalTax}</td>
                  <td className="py-sm pr-md text-on-surface-variant">{s.notes ?? "—"}</td>
                </tr>
              ))}
              {structures.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-lg text-center text-on-surface-variant">
                    No salary structure on file. Add one to enable payroll for this employee.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function LeaveTab({ balance }: { balance: Balance | null }) {
  if (!balance) {
    return (
      <Section title="">
        <p className="text-on-surface-variant">
          No leave balance row for the current year yet. It will be created automatically when
          attendance is imported or the leave accrual job runs.
        </p>
      </Section>
    );
  }
  return (
    <Section title={`Leave balance · ${balance.year}`}>
      <div className="grid grid-cols-4 gap-base">
        {[
          { label: "Opening", value: balance.opening },
          { label: "Accrued", value: balance.accrued },
          { label: "Used", value: balance.used },
          { label: "Balance", value: balance.balance },
        ].map((c) => (
          <div key={c.label} className="bg-surface-container rounded p-md">
            <p className="text-caption text-on-surface-variant uppercase tracking-wider">{c.label}</p>
            <p className="text-h2 font-extrabold">{c.value.toFixed(1)}</p>
          </div>
        ))}
      </div>
    </Section>
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
