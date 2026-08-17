"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import { CreateLoginPanel } from "@/components/CreateLoginPanel";

type ShiftLite = { id: string; code: string; name: string };
type LoginRole = { id: string; name: string };
type LoginStatus = { hasLogin: boolean; username: string | null };

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
  designationId: string;
  departments: { departmentId: string; isPrimary: boolean }[];
  roleIds: string[];
};
type DesignationLite = { id: string; name: string; level: number };
type DepartmentLite = { id: string; name: string };
type RoleLite = { id: string; name: string };

type Structure = {
  id: string;
  effectiveFrom: string;
  basic: number;
  hraPct: number;
  conveyancePct: number;
  medicalPct: number;
  specialPct: number;
  esiApplicable: boolean;
  pfApplicable: boolean;
  professionalTax: number;
  notes: string | null;
};

const DEFAULT_PCTS = { hraPct: 40, conveyancePct: 20, medicalPct: 25, specialPct: 15 };

function suggestPT(gross: number) {
  const halfYear = gross * 6;
  if (halfYear >= 125_000) return 208;
  if (halfYear >= 100_000) return 167;
  return 125;
}

type LeaveLedgerRow = {
  month: number;
  label: string;
  allocated: number;
  accrued: number;
  taken: number;
  unpaid: number;
  balance: number;
};

type LeaveTabData = {
  employeeId: string;
  year: number;
  availableYears: number[];
  opening: number;
  balanceAsOn: number;
  currentMonth: number; // cycle-month index within `year`: 0 = future year, 12 = past year
  rows: LeaveLedgerRow[];
};

export function EmployeeEditor({
  employee,
  shifts,
  structures,
  designationName,
  departmentName,
  roleNames,
  designations,
  departmentsList,
  rolesList,
  loginRoles,
  login,
  canEdit,
  leaveTab,
}: {
  employee: EmpDraft;
  shifts: ShiftLite[];
  structures: Structure[];
  designationName: string;
  departmentName: string;
  roleNames: string[];
  designations: DesignationLite[];
  departmentsList: DepartmentLite[];
  rolesList: RoleLite[];
  loginRoles: LoginRole[];
  login: LoginStatus;
  canEdit: boolean;
  leaveTab: LeaveTabData;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"profile" | "org" | "salary" | "leave">("profile");
  const [draft, setDraft] = useState(employee);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showLoginPanel, setShowLoginPanel] = useState(false);

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
      {canEdit && (
        <Section title="Login">
          {login.hasLogin ? (
            <p className="text-label-sm text-on-surface-variant">
              Has a login — username <span className="font-mono">{login.username}</span>.{" "}
              {!showLoginPanel && (
                <button
                  type="button"
                  onClick={() => setShowLoginPanel(true)}
                  className="text-blue-700 underline"
                >
                  Reset password / change role
                </button>
              )}
            </p>
          ) : showLoginPanel ? null : (
            <div className="flex items-center justify-between gap-sm">
              <p className="text-label-sm text-on-surface-variant">No login yet.</p>
              <button
                type="button"
                onClick={() => setShowLoginPanel(true)}
                className="px-md py-sm rounded border border-outline-variant text-label-sm"
              >
                Create login
              </button>
            </div>
          )}
          {showLoginPanel && (
            <div className="mt-sm">
              <CreateLoginPanel
                employeeId={employee.id}
                defaultDisplayName={employee.name}
                defaultPhone={employee.phone || null}
                roles={loginRoles}
                onDone={() => {
                  setShowLoginPanel(false);
                  start(() => router.refresh());
                }}
                onCancel={() => setShowLoginPanel(false)}
              />
            </div>
          )}
        </Section>
      )}
      <div className="flex gap-sm border-b border-outline-variant mb-md">
        {(["profile", "org", "salary", "leave"] as const).map((t) => (
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
            {t === "salary"
              ? "Salary Structure"
              : t === "leave"
                ? "Leave"
                : t === "org"
                  ? "Designation & Departments"
                  : "Profile"}
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
              <MirrorValue value={designationName} />
            </Field>
            <Field label="Department">
              <MirrorValue value={departmentName} />
            </Field>
            <Field label="Role">
              <MirrorValue value={roleNames.join(", ")} />
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
            <label className="flex items-start gap-xs text-label-sm md:col-span-3">
              <input
                type="checkbox"
                className="mt-[3px]"
                checked={draft.halfHourConcession}
                onChange={(e) => setDraft({ ...draft, halfHourConcession: e.target.checked })}
              />
              <span>
                <span className="font-semibold">Late Coming Eligibility</span>
                <span className="block text-caption text-on-surface-variant">
                  When enabled, this employee can arrive up to <strong>30 minutes late on
                  up to 3 days per salary cycle (26th → 25th)</strong> without it being treated
                  as a late offence. Applies regardless of the assigned shift.
                </span>
              </span>
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

          <p className="text-caption text-on-surface-variant mt-sm">
            Designation, department &amp; role mirror the{" "}
            <button
              type="button"
              onClick={() => setTab("org")}
              className="underline text-primary"
            >
              Designation &amp; Departments
            </button>{" "}
            tab — edit them there.
          </p>

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

      {tab === "org" && (
        <OrgTab
          employeeId={employee.id}
          initialDesignationId={employee.designationId}
          initialDepartments={employee.departments}
          initialRoleIds={employee.roleIds}
          designations={designations}
          departmentsList={departmentsList}
          rolesList={rolesList}
          canEdit={canEdit}
        />
      )}

      {tab === "salary" && (
        <SalaryStructureTab
          employeeId={employee.id}
          structures={structures}
          canEdit={canEdit}
          basicGuess={structures[0]?.basic ?? 0}
        />
      )}

      {tab === "leave" && <LeaveTab data={leaveTab} canEdit={canEdit} />}
    </>
  );
}

function SalaryStructureTab({
  employeeId,
  structures,
  canEdit,
  basicGuess,
}: {
  employeeId: string;
  structures: Structure[];
  canEdit: boolean;
  basicGuess: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({
    effectiveFrom: new Date().toISOString().slice(0, 7),
    basic: basicGuess || 0,
    hraPct: DEFAULT_PCTS.hraPct,
    conveyancePct: DEFAULT_PCTS.conveyancePct,
    medicalPct: DEFAULT_PCTS.medicalPct,
    specialPct: DEFAULT_PCTS.specialPct,
    esiApplicable: true,
    pfApplicable: true,
    professionalTax: 125,
    notes: "",
    autoPT: true,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live breakdown
  const basic = Number(draft.basic) || 0;
  const hra = Math.round((basic * Number(draft.hraPct)) / 100);
  const conveyance = Math.round((basic * Number(draft.conveyancePct)) / 100);
  const medical = Math.round((basic * Number(draft.medicalPct)) / 100);
  const special = Math.round((basic * Number(draft.specialPct)) / 100);
  const gross = basic + hra + conveyance + medical + special;
  const ptSlab = suggestPT(gross);
  const ptToUse = draft.autoPT ? ptSlab : draft.professionalTax;
  const esiEligible = gross > 0 && gross <= 21000 && draft.esiApplicable;
  const esiEmp = esiEligible ? Math.round(gross * 0.0075) : 0;
  // PF capped at ₹15,000 wage ceiling → max ₹1,800.
  const pfEmp = draft.pfApplicable ? Math.round(Math.min(basic, 15000) * 0.12) : 0;
  const netTakeHome = gross - esiEmp - pfEmp - ptToUse;

  async function save() {
    setError(null);
    const body = {
      effectiveFrom: draft.effectiveFrom,
      basic: draft.basic,
      hraPct: draft.hraPct,
      conveyancePct: draft.conveyancePct,
      medicalPct: draft.medicalPct,
      specialPct: draft.specialPct,
      esiApplicable: draft.esiApplicable,
      pfApplicable: draft.pfApplicable,
      professionalTax: ptToUse,
      notes: draft.notes || null,
    };
    const res = await fetch(`/api/hr/employees/${employeeId}/salary-structure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-sm items-end">
            <Field label="Effective from (YYYY-MM)">
              <input
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.effectiveFrom}
                onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
              />
            </Field>
            <Field label="Basic (₹ / month) *">
              <input
                type="number"
                className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.basic || ""}
                onChange={(e) => setDraft({ ...draft, basic: Number(e.target.value) })}
              />
            </Field>
            <div className="text-label-sm text-on-surface-variant">
              All allowances default to % of Basic — change in Advanced.
            </div>
          </div>

          <div className="mt-md">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-blue-700 underline text-label-sm"
            >
              {showAdvanced ? "Hide" : "Advanced"} — allowance %s, ESI/PF/PT overrides
            </button>
          </div>

          {showAdvanced && (
            <div className="mt-md grid grid-cols-2 md:grid-cols-4 gap-sm">
              <Field label="HRA % of Basic">
                <input
                  type="number"
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.hraPct}
                  onChange={(e) => setDraft({ ...draft, hraPct: Number(e.target.value) })}
                />
              </Field>
              <Field label="Conveyance % of Basic">
                <input
                  type="number"
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.conveyancePct}
                  onChange={(e) => setDraft({ ...draft, conveyancePct: Number(e.target.value) })}
                />
              </Field>
              <Field label="Medical % of Basic">
                <input
                  type="number"
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.medicalPct}
                  onChange={(e) => setDraft({ ...draft, medicalPct: Number(e.target.value) })}
                />
              </Field>
              <Field label="Special % of Basic">
                <input
                  type="number"
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.specialPct}
                  onChange={(e) => setDraft({ ...draft, specialPct: Number(e.target.value) })}
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
              <label className="flex items-center gap-xs text-label-sm">
                <input
                  type="checkbox"
                  checked={draft.autoPT}
                  onChange={(e) => setDraft({ ...draft, autoPT: e.target.checked })}
                />
                Auto Professional Tax (Kerala slab)
              </label>
              <Field label="PT override (₹/mo)">
                <input
                  type="number"
                  disabled={draft.autoPT}
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface disabled:opacity-50"
                  value={draft.autoPT ? ptSlab : draft.professionalTax}
                  onChange={(e) => setDraft({ ...draft, professionalTax: Number(e.target.value) })}
                />
              </Field>
              <Field label="Notes" className="col-span-2 md:col-span-4">
                <input
                  className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </Field>
            </div>
          )}

          {/* Live breakdown */}
          <div className="mt-lg rounded-lg border border-outline-variant bg-surface-container p-md">
            <p className="text-label-sm font-bold mb-sm">Live preview · auto-calculated</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-sm text-label-sm">
              <Stat label="Basic" value={`₹${basic.toLocaleString("en-IN")}`} />
              <Stat label={`HRA ${draft.hraPct}%`} value={`₹${hra.toLocaleString("en-IN")}`} />
              <Stat label={`Conveyance ${draft.conveyancePct}%`} value={`₹${conveyance.toLocaleString("en-IN")}`} />
              <Stat label={`Medical ${draft.medicalPct}%`} value={`₹${medical.toLocaleString("en-IN")}`} />
              <Stat label={`Special ${draft.specialPct}%`} value={`₹${special.toLocaleString("en-IN")}`} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-sm text-label-sm mt-md">
              <Stat label="Gross (CTC monthly)" value={`₹${gross.toLocaleString("en-IN")}`} hero />
              <Stat label="ESI (E) 0.75%" value={`₹${esiEmp.toLocaleString("en-IN")}`} />
              <Stat
                label={
                  basic > 15000
                    ? "PF (E) capped at ₹1,800"
                    : "PF (E) 12% of Basic"
                }
                value={`₹${pfEmp.toLocaleString("en-IN")}`}
              />
              <Stat label="Professional Tax" value={`₹${ptToUse}`} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-sm text-label-sm mt-md">
              <Stat
                label="Net take-home (no leave)"
                value={`₹${netTakeHome.toLocaleString("en-IN")}`}
                hero
              />
              <p className="text-on-surface-variant text-caption md:text-label-sm self-center">
                {esiEligible
                  ? `ESI active (gross ≤ ₹21,000).`
                  : `ESI inactive (gross > ₹21,000 or disabled).`}{" "}
                PT slab suggested: ₹{ptSlab}.
              </p>
            </div>
          </div>

          <div className="mt-md flex items-center gap-sm">
            <button
              onClick={save}
              disabled={pending || !draft.basic}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
            >
              Save structure
            </button>
            {error && <span className="text-red-700 text-label-sm">{error}</span>}
          </div>
        </Section>
      )}

      <Section title="History">
        <div className="overflow-x-auto">
          <table className="w-full text-label-sm">
            <thead className="text-left text-on-surface-variant border-b border-outline-variant">
              <tr>
                <th className="py-sm pr-md">Effective from</th>
                <th className="py-sm pr-md">Basic</th>
                <th className="py-sm pr-md">HRA / Conv / Med / Spl %</th>
                <th className="py-sm pr-md">Gross</th>
                <th className="py-sm pr-md">ESI / PF</th>
                <th className="py-sm pr-md">PT</th>
                <th className="py-sm pr-md">Notes</th>
              </tr>
            </thead>
            <tbody>
              {structures.map((s) => {
                const g =
                  s.basic *
                  (1 + (s.hraPct + s.conveyancePct + s.medicalPct + s.specialPct) / 100);
                return (
                  <tr key={s.id} className="border-b border-outline-variant last:border-0">
                    <td className="py-sm pr-md">{s.effectiveFrom}</td>
                    <td className="py-sm pr-md">₹{s.basic.toLocaleString("en-IN")}</td>
                    <td className="py-sm pr-md text-on-surface-variant">
                      {s.hraPct} / {s.conveyancePct} / {s.medicalPct} / {s.specialPct}
                    </td>
                    <td className="py-sm pr-md font-bold">
                      ₹{Math.round(g).toLocaleString("en-IN")}
                    </td>
                    <td className="py-sm pr-md text-on-surface-variant">
                      {s.esiApplicable ? "ESI" : "—"} /{" "}
                      {s.pfApplicable ? "PF" : "—"}
                    </td>
                    <td className="py-sm pr-md">₹{s.professionalTax}</td>
                    <td className="py-sm pr-md text-on-surface-variant">{s.notes ?? "—"}</td>
                  </tr>
                );
              })}
              {structures.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-lg text-center text-on-surface-variant">
                    No salary structure on file. Enter Basic above to enable payroll.
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

function Stat({ label, value, hero = false }: { label: string; value: string; hero?: boolean }) {
  return (
    <div
      className={
        "rounded p-sm " +
        (hero ? "bg-primary/10 border border-primary/30" : "bg-surface")
      }
    >
      <p className="text-caption text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className={"font-bold " + (hero ? "text-h3" : "text-label-sm")}>{value}</p>
    </div>
  );
}

function OrgTab({
  employeeId,
  initialDesignationId,
  initialDepartments,
  initialRoleIds,
  designations,
  departmentsList,
  rolesList,
  canEdit,
}: {
  employeeId: string;
  initialDesignationId: string;
  initialDepartments: { departmentId: string; isPrimary: boolean }[];
  initialRoleIds: string[];
  designations: DesignationLite[];
  departmentsList: DepartmentLite[];
  rolesList: RoleLite[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [designationId, setDesignationId] = useState(initialDesignationId);
  const [departments, setDepartments] = useState(initialDepartments);
  const [roleIds, setRoleIds] = useState(initialRoleIds);
  const [error, setError] = useState<string | null>(null);
  const [savedFlag, setSavedFlag] = useState<string | null>(null);

  async function saveDesignation() {
    setError(null);
    const res = await fetch(`/api/hr/employees/${employeeId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ designationId: designationId || null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setSavedFlag("designation");
    start(() => router.refresh());
  }

  async function saveDepartments() {
    setError(null);
    const res = await fetch(`/api/hr/employees/${employeeId}/departments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberships: departments }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setSavedFlag("departments");
    start(() => router.refresh());
  }

  async function saveRoles() {
    setError(null);
    const res = await fetch(`/api/hr/employees/${employeeId}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleIds }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setSavedFlag("roles");
    start(() => router.refresh());
  }

  function toggleDept(id: string) {
    if (departments.some((d) => d.departmentId === id)) {
      setDepartments(departments.filter((d) => d.departmentId !== id));
    } else {
      setDepartments([
        ...departments,
        { departmentId: id, isPrimary: departments.length === 0 },
      ]);
    }
  }
  function setPrimary(id: string) {
    setDepartments(departments.map((d) => ({ ...d, isPrimary: d.departmentId === id })));
  }
  function toggleRole(id: string) {
    if (roleIds.includes(id)) setRoleIds(roleIds.filter((r) => r !== id));
    else setRoleIds([...roleIds, id]);
  }

  return (
    <div className="space-y-lg">
      {error && <p className="text-red-700 text-label-sm">{error}</p>}

      <Section
        title="Designation"
        action={
          canEdit && (
            <button
              onClick={saveDesignation}
              disabled={pending}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50 text-label-sm"
            >
              Save
            </button>
          )
        }
      >
        <fieldset disabled={!canEdit}>
          <select
            className="w-full md:w-1/2 px-sm py-sm rounded border border-outline-variant bg-surface"
            value={designationId}
            onChange={(e) => setDesignationId(e.target.value)}
          >
            <option value="">— None —</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} {d.level > 0 ? `· L${d.level}` : ""}
              </option>
            ))}
          </select>
        </fieldset>
        {savedFlag === "designation" && (
          <p className="text-green-700 text-label-sm mt-sm">Saved.</p>
        )}
        <p className="text-caption text-on-surface-variant mt-sm">
          Drives the employee&apos;s tier in the Org Chart. Manage tiers in{" "}
          <Link href="/hr/masters/designations" className="underline">
            Masters → Designations
          </Link>
          .
        </p>
      </Section>

      <Section
        title="Departments"
        action={
          canEdit && (
            <button
              onClick={saveDepartments}
              disabled={pending}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50 text-label-sm"
            >
              Save
            </button>
          )
        }
      >
        <p className="text-caption text-on-surface-variant mb-sm">
          Tick every department this employee belongs to. Mark one as <strong>Primary</strong>{" "}
          — that&apos;s where they appear in the Org Chart and for any payroll cost-centre work.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-xs">
          {departmentsList.map((d) => {
            const m = departments.find((x) => x.departmentId === d.id);
            const checked = !!m;
            return (
              <label
                key={d.id}
                className={
                  "flex items-center gap-sm px-sm py-xs rounded border " +
                  (checked
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant bg-surface")
                }
              >
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={checked}
                  onChange={() => toggleDept(d.id)}
                />
                <span className="flex-1 text-label-sm">{d.name}</span>
                {checked && (
                  <label className="flex items-center gap-xs text-caption">
                    <input
                      type="radio"
                      name="primary-dept"
                      disabled={!canEdit}
                      checked={m?.isPrimary ?? false}
                      onChange={() => setPrimary(d.id)}
                    />
                    Primary
                  </label>
                )}
              </label>
            );
          })}
          {departmentsList.length === 0 && (
            <p className="text-on-surface-variant py-md">
              No departments yet. Add them in{" "}
              <Link href="/hr/masters/departments" className="underline">
                Masters → Departments
              </Link>
              .
            </p>
          )}
        </div>
        {savedFlag === "departments" && (
          <p className="text-green-700 text-label-sm mt-sm">Saved.</p>
        )}
      </Section>

      <Section
        title="Roles"
        action={
          canEdit && (
            <button
              onClick={saveRoles}
              disabled={pending}
              className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50 text-label-sm"
            >
              Save
            </button>
          )
        }
      >
        <p className="text-caption text-on-surface-variant mb-sm">
          Functional roles (e.g. BDE L2, Counsellor, Voxbay Admin). An employee can have any
          number.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-xs">
          {rolesList.map((r) => {
            const checked = roleIds.includes(r.id);
            return (
              <label
                key={r.id}
                className={
                  "flex items-center gap-sm px-sm py-xs rounded border text-label-sm " +
                  (checked
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant bg-surface")
                }
              >
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={checked}
                  onChange={() => toggleRole(r.id)}
                />
                <span className="flex-1">{r.name}</span>
              </label>
            );
          })}
          {rolesList.length === 0 && (
            <p className="text-on-surface-variant py-md">
              No roles yet. Add them in{" "}
              <Link href="/hr/masters/roles" className="underline">
                Masters → Roles
              </Link>
              .
            </p>
          )}
        </div>
        {savedFlag === "roles" && (
          <p className="text-green-700 text-label-sm mt-sm">Saved.</p>
        )}
      </Section>
    </div>
  );
}

function LeaveTab({ data, canEdit }: { data: LeaveTabData; canEdit: boolean }) {
  const [year, setYear] = useState(data.year);
  const [rows, setRows] = useState<LeaveLedgerRow[]>(data.rows);
  const [opening, setOpening] = useState(data.opening);
  const [balanceAsOn, setBalanceAsOn] = useState(data.balanceAsOn);
  const [currentMonth, setCurrentMonth] = useState(data.currentMonth);
  // Edited paid-leave values, keyed by month. "" clears the override.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // `currentMonth` (0..12) is the cycle month `balanceAsOn` is measured at — the
  // same figure the headline is labelled with, so the two never disagree. 0 = a
  // future year (nothing accrued yet), 12 = a fully-elapsed past year.
  const currentMonthLabel = rows.find((r) => r.month === currentMonth)?.label;
  const headlineLabel =
    currentMonth === 0
      ? `Opening balance · ${year}`
      : currentMonthLabel
        ? `Balance as on ${currentMonthLabel}`
        : `Balance · ${year}`;

  function applyPayload(p: {
    rows: LeaveLedgerRow[];
    opening: number;
    balanceAsOn: number;
    currentMonth: number;
  }) {
    setRows(p.rows);
    setOpening(p.opening);
    setBalanceAsOn(p.balanceAsOn);
    setCurrentMonth(p.currentMonth);
    setEdits({});
  }

  function changeYear(nextYear: number) {
    setYear(nextYear);
    setSaved(false);
    setError(null);
    setEdits({});
    start(async () => {
      const res = await fetch(
        `/api/hr/employees/${data.employeeId}/leave-allocation?year=${nextYear}`,
      );
      if (!res.ok) {
        setError("Failed to load that year.");
        return;
      }
      applyPayload(await res.json());
    });
  }

  function save() {
    setError(null);
    setSaved(false);
    const months = Object.entries(edits).map(([month, raw]) => ({
      month: Number(month),
      paidLeaves: raw.trim() === "" ? null : Number(raw),
    }));
    if (months.length === 0) return;
    if (months.some((m) => m.paidLeaves !== null && !Number.isFinite(m.paidLeaves))) {
      setError("Paid leaves must be a number.");
      return;
    }
    start(async () => {
      const res = await fetch(`/api/hr/employees/${data.employeeId}/leave-allocation`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year, months }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Save failed.");
        return;
      }
      applyPayload(await res.json());
      setSaved(true);
    });
  }

  const dirty = Object.keys(edits).length > 0;

  return (
    <Section title="">
      <div className="flex items-end justify-between gap-base flex-wrap mb-md">
        <div className="bg-surface-container rounded p-md min-w-[14rem]">
          <p className="text-caption text-on-surface-variant uppercase tracking-wider">
            {headlineLabel}
          </p>
          <p className="text-h2 font-extrabold">{balanceAsOn.toFixed(1)}</p>
          <p className="text-caption text-on-surface-variant mt-xs">
            Opening {opening.toFixed(1)} · salary-cycle months (26th → 25th)
          </p>
        </div>
        <label className="flex flex-col gap-xs">
          <span className="text-caption text-on-surface-variant">Year</span>
          <select
            value={year}
            onChange={(e) => changeYear(Number(e.target.value))}
            disabled={pending}
            className="px-sm py-sm rounded border border-outline-variant bg-surface min-w-[7rem]"
          >
            {data.availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!canEdit && (
        <p className="text-caption text-on-surface-variant mb-sm">
          You can view the ledger. Editing the monthly paid-leave allocation needs HR Manager or
          Admin rights.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-label-sm">
          <thead>
            <tr className="text-on-surface-variant text-left">
              <th className="px-sm py-xs font-medium">Month</th>
              <th className="px-sm py-xs font-medium text-right">Paid leaves</th>
              <th className="px-sm py-xs font-medium text-right">Paid taken</th>
              <th className="px-sm py-xs font-medium text-right">Unpaid taken</th>
              <th className="px-sm py-xs font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isFuture = currentMonth > 0 && r.month > currentMonth;
              const editValue = edits[r.month];
              const displayPaid =
                editValue !== undefined ? editValue : r.allocated ? String(r.allocated) : "";
              return (
                <tr key={r.month} className="border-t border-outline-variant">
                  <td className="px-sm py-xs">{r.label}</td>
                  <td className="px-sm py-xs text-right">
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        max={31}
                        step={0.5}
                        value={displayPaid}
                        placeholder="0"
                        onChange={(e) =>
                          setEdits((prev) => ({ ...prev, [r.month]: e.target.value }))
                        }
                        className="w-20 px-sm py-xs rounded border border-outline-variant bg-surface text-right"
                      />
                    ) : r.allocated ? (
                      r.allocated.toFixed(1)
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-sm py-xs text-right">{r.taken ? r.taken.toFixed(1) : "—"}</td>
                  <td className="px-sm py-xs text-right">{r.unpaid ? r.unpaid.toFixed(1) : "—"}</td>
                  <td className="px-sm py-xs text-right font-semibold">
                    {isFuture ? "—" : r.balance.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex items-center gap-md mt-md">
          <button
            onClick={save}
            disabled={pending || !dirty}
            className="px-base py-sm rounded bg-primary text-on-primary text-label-sm font-medium disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save allocation"}
          </button>
          {saved && <span className="text-green-700 text-label-sm">Saved.</span>}
          {error && <span className="text-red-700 text-label-sm">{error}</span>}
        </div>
      )}
      {!canEdit && error && <p className="text-red-700 text-label-sm mt-sm">{error}</p>}
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

/** Read-only display of a value mirrored from the Designation & Departments tab. */
function MirrorValue({ value }: { value: string }) {
  return (
    <div className="w-full px-sm py-sm rounded border border-outline-variant bg-surface-container min-h-[2.625rem] flex items-center">
      {value ? value : <span className="text-on-surface-variant">—</span>}
    </div>
  );
}
