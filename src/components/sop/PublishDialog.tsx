"use client";

import { useMemo, useState } from "react";
import type { EditorOptionsDTO, VersionDTO } from "@/lib/sop/editor-dto";
import { ErrorNote, Field, Icon, Modal, inputCls, primaryBtn, secondaryBtn, sopApi, taCls } from "./ui";

/**
 * The publish modal (§12).
 *
 * Publishing is the one irreversible action in the module — it freezes the
 * version, retires the previous one, and (when acknowledgement is required)
 * assigns a compliance obligation to real people. So the modal asks for every
 * decision explicitly rather than defaulting quietly:
 *
 *   • Effective date defaults to today, because that is nearly always right,
 *     but is editable for a policy that starts next month.
 *   • The audience does NOT default to everyone. Publishing to the whole
 *     company by accident is the failure mode worth designing against, so the
 *     departments/roles/employees lists all start empty and the Publish button
 *     refuses acknowledgement with no audience.
 */
export function PublishDialog({
  version,
  options,
  onClose,
  onPublished,
}: {
  version: VersionDTO;
  options: EditorOptionsDTO;
  onClose: () => void;
  onPublished: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [effectiveDate, setEffectiveDate] = useState(version.effectiveDate ?? today);
  const [nextReviewDate, setNextReviewDate] = useState(version.nextReviewDate ?? "");
  const [departmentIds, setDepartmentIds] = useState<string[]>(version.applicableDepartmentIds);
  const [roleIds, setRoleIds] = useState<string[]>(version.applicableRoleIds);
  const [employeeIds, setEmployeeIds] = useState<string[]>(version.applicableEmployeeIds);
  const [requiresAck, setRequiresAck] = useState(version.requiresAcknowledgement);
  const [deadline, setDeadline] = useState(version.acknowledgementDeadline ?? "");
  const [notes, setNotes] = useState(version.publishNotes ?? "");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAudience = departmentIds.length > 0 || roleIds.length > 0 || employeeIds.length > 0;

  const matchingEmployees = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    if (!q) return [];
    return options.employees
      .filter((e) => e.name.toLowerCase().includes(q) || e.empCode.toLowerCase().includes(q))
      .slice(0, 8);
  }, [employeeQuery, options.employees]);

  async function publish() {
    if (!effectiveDate) {
      setError("Choose an effective date.");
      return;
    }
    if (requiresAck && !hasAudience) {
      setError("Choose who must acknowledge this SOP before publishing.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await sopApi(`/api/sop/versions/${version.id}/publish`, "POST", {
      effectiveDate,
      nextReviewDate: nextReviewDate || null,
      applicableDepartmentIds: departmentIds,
      applicableRoleIds: roleIds,
      applicableEmployeeIds: employeeIds,
      requiresAcknowledgement: requiresAck,
      acknowledgementDeadline: deadline || null,
      publishNotes: notes.trim() || null,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onPublished();
  }

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  return (
    <Modal
      title={`Publish ${version.versionLabel}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={publish} disabled={busy}>
            {busy ? "Publishing…" : "Publish SOP"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-body-sm text-on-surface-variant">
        <Icon name="info" size={16} className="align-text-bottom mr-xs" />
        Once published, {version.versionLabel} becomes read-only. Any later change has to be a new
        revision, and the version now live will be moved into the version history.
      </div>

      <div className="grid sm:grid-cols-2 gap-md">
        <Field label="Effective date" required>
          <input
            type="date"
            className={inputCls}
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </Field>
        <Field
          label="Next review date"
          hint="Left blank, this is calculated from the review frequency."
        >
          <input
            type="date"
            className={inputCls}
            value={nextReviewDate}
            onChange={(e) => setNextReviewDate(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Applicable departments">
        <div className="flex flex-wrap gap-xs">
          {options.departments.map((d) => {
            const on = departmentIds.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(departmentIds, setDepartmentIds, d.id)}
                className={
                  "h-8 px-md rounded-full border text-label-sm transition " +
                  (on
                    ? "bg-primary text-on-primary border-primary"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
                }
              >
                {d.name}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Applicable roles">
        <div className="flex flex-wrap gap-xs">
          {options.hrRoles.length === 0 && (
            <span className="text-caption text-on-surface-variant">
              No roles in the HR role master yet.
            </span>
          )}
          {options.hrRoles.map((r) => {
            const on = roleIds.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(roleIds, setRoleIds, r.id)}
                className={
                  "h-8 px-md rounded-full border text-label-sm transition " +
                  (on
                    ? "bg-primary text-on-primary border-primary"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
                }
              >
                {r.name}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Named employees" hint="Optional — for people the departments and roles above miss.">
        <input
          className={inputCls}
          value={employeeQuery}
          onChange={(e) => setEmployeeQuery(e.target.value)}
          placeholder="Search by name or employee code…"
        />
        {matchingEmployees.length > 0 && (
          <ul className="mt-xs rounded-lg border border-outline-variant divide-y divide-outline-variant overflow-hidden">
            {matchingEmployees.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="w-full text-left px-md py-xs text-body-sm hover:bg-surface-container-low transition"
                  onClick={() => {
                    if (!employeeIds.includes(e.id)) setEmployeeIds([...employeeIds, e.id]);
                    setEmployeeQuery("");
                  }}
                >
                  {e.name} <span className="text-on-surface-variant">· {e.empCode}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {employeeIds.length > 0 && (
          <div className="flex flex-wrap gap-xs mt-xs">
            {employeeIds.map((id) => {
              const emp = options.employees.find((e) => e.id === id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-xs h-8 px-md rounded-full bg-surface-container-high text-label-sm"
                >
                  {emp?.name ?? id}
                  <button
                    type="button"
                    aria-label={`Remove ${emp?.name ?? "employee"}`}
                    onClick={() => setEmployeeIds(employeeIds.filter((x) => x !== id))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </Field>

      <label className="flex items-start gap-xs text-body-md text-on-surface">
        <input
          type="checkbox"
          className="mt-1"
          checked={requiresAck}
          onChange={(e) => setRequiresAck(e.target.checked)}
        />
        <span>
          Requires acknowledgement
          <span className="block text-caption text-on-surface-variant">
            Everyone selected above is asked to confirm they have read and understood it.
          </span>
        </span>
      </label>

      {requiresAck && (
        <Field
          label="Acknowledgement deadline"
          hint="After this date, outstanding acknowledgements show as overdue."
        >
          <input
            type="date"
            className={inputCls}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </Field>
      )}

      <Field label="Publish notes">
        <textarea
          rows={3}
          className={taCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What people should know about this release."
        />
      </Field>
    </Modal>
  );
}
