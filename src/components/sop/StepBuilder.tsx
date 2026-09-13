"use client";

import { useState } from "react";
import type { StepDTO, EditorOptionsDTO } from "@/lib/sop/editor-dto";
import { SLA_UNITS, SLA_UNIT_LABELS, formatSla, type SlaUnit } from "@/lib/sop/constants";
import { RichTextInput } from "./RichTextInput";
import {
  ConfirmDialog,
  Empty,
  ErrorNote,
  Field,
  Icon,
  Modal,
  Pill,
  chipBtn,
  inputCls,
  primaryBtn,
  secondaryBtn,
  sopApi,
  taCls,
} from "./ui";

/**
 * The dynamic step builder (§6) — the part of the module everything else is
 * arranged around.
 *
 * Steps are stored as ROWS with typed columns, never as one blob of prose, so a
 * later phase can mint a task from `(responsibleRoleId, slaValue, slaUnit)`
 * without re-parsing an instruction paragraph. That is the whole reason the
 * form below has so many small fields instead of one big one.
 *
 * Reordering is drag-and-drop with keyboard-reachable Move up / Move down
 * buttons alongside — HTML5 drag events are mouse-only, and a numbered list
 * whose order can only be changed by dragging is unusable for anyone who is
 * not. Both paths post the same `orderedIds` payload; the server renumbers.
 */
export function StepBuilder({
  versionId,
  steps,
  options,
  readOnly,
  onChanged,
}: {
  versionId: string;
  steps: StepDTO[];
  options: EditorOptionsDTO;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ step: StepDTO | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StepDTO | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  async function run(p: Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await p;
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "That did not work.");
      return false;
    }
    onChanged();
    return true;
  }

  async function reorder(orderedIds: string[]) {
    await run(sopApi(`/api/sop/versions/${versionId}/steps`, "PUT", { orderedIds }));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const order = steps.map((s) => s.id);
    [order[index], order[target]] = [order[target]!, order[index]!];
    void reorder(order);
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const order = steps.map((s) => s.id);
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(to, 0, ...order.splice(from, 1));
    setDragId(null);
    setDragOverId(null);
    void reorder(order);
  }

  return (
    <div className="space-y-md">
      {error && <ErrorNote>{error}</ErrorNote>}

      {steps.length === 0 ? (
        <Empty
          icon="format_list_numbered"
          title="No steps yet"
          hint="Add the first step of the process. Each step names who does it and how long it should take."
        />
      ) : (
        <ol className="space-y-sm">
          {steps.map((step, i) => (
            <li
              key={step.id}
              draggable={!readOnly && !busy}
              onDragStart={() => setDragId(step.id)}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDragOverId(step.id);
              }}
              onDragLeave={() => setDragOverId((id) => (id === step.id ? null : id))}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(step.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDragOverId(null);
              }}
              className={
                "rounded-xl border bg-surface-container-lowest transition " +
                (dragOverId === step.id ? "border-primary ring-2 ring-primary/20 " : "border-outline-variant ") +
                (dragId === step.id ? "opacity-50 " : "")
              }
            >
              <div className="flex items-start gap-sm p-md">
                {!readOnly && (
                  <span
                    className="mt-px text-outline cursor-grab active:cursor-grabbing shrink-0"
                    title="Drag to reorder"
                    aria-hidden
                  >
                    <Icon name="drag_indicator" size={18} />
                  </span>
                )}
                <span className="shrink-0 h-7 w-7 grid place-items-center rounded-full bg-primary text-on-primary text-label-sm font-semibold">
                  {step.seq}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="text-body-lg font-medium text-on-surface">{step.title}</div>
                  <div className="flex flex-wrap items-center gap-xs mt-xs">
                    {(step.responsibleRole || step.responsibleRoleName) && (
                      <Pill className="bg-surface-container-high text-on-surface-variant">
                        <Icon name="badge" size={12} className="mr-px" />
                        {step.responsibleRole ?? step.responsibleRoleName}
                      </Pill>
                    )}
                    {step.responsibleDepartment && (
                      <Pill className="bg-surface-container-high text-on-surface-variant">
                        <Icon name="domain" size={12} className="mr-px" />
                        {step.responsibleDepartment}
                      </Pill>
                    )}
                    {step.assignedEmployee && (
                      <Pill className="bg-surface-container-high text-on-surface-variant">
                        <Icon name="person" size={12} className="mr-px" />
                        {step.assignedEmployee}
                      </Pill>
                    )}
                    {step.slaValue != null && step.slaUnit && (
                      <Pill className="bg-primary-fixed text-on-primary">
                        <Icon name="schedule" size={12} className="mr-px" />
                        SLA {formatSla(step.slaValue, step.slaUnit)}
                      </Pill>
                    )}
                    {step.checklist.length > 0 && (
                      <Pill className="bg-surface-container-high text-on-surface-variant">
                        <Icon name="checklist" size={12} className="mr-px" />
                        {step.checklist.length} check{step.checklist.length === 1 ? "" : "s"}
                      </Pill>
                    )}
                  </div>

                  {step.instruction && (
                    <p className="text-body-sm text-on-surface-variant mt-xs line-clamp-2">{step.instruction}</p>
                  )}
                </div>

                <div className="flex items-center gap-px shrink-0">
                  <IconBtn
                    icon="keyboard_arrow_up"
                    label={`Move step ${step.seq} up`}
                    disabled={readOnly || busy || i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <IconBtn
                    icon="keyboard_arrow_down"
                    label={`Move step ${step.seq} down`}
                    disabled={readOnly || busy || i === steps.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <IconBtn
                    icon="edit"
                    label={readOnly ? `View step ${step.seq}` : `Edit step ${step.seq}`}
                    onClick={() => setEditing({ step })}
                  />
                  {!readOnly && (
                    <>
                      <IconBtn
                        icon="content_copy"
                        label={`Duplicate step ${step.seq}`}
                        disabled={busy}
                        onClick={() =>
                          run(sopApi(`/api/sop/versions/${versionId}/steps/${step.id}`, "POST"))
                        }
                      />
                      <IconBtn
                        icon="delete"
                        label={`Delete step ${step.seq}`}
                        disabled={busy}
                        onClick={() => setConfirmDelete(step)}
                      />
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!readOnly && (
        <button
          type="button"
          className={primaryBtn + " inline-flex items-center gap-xs"}
          disabled={busy}
          onClick={() => setEditing({ step: null })}
        >
          <Icon name="add" /> Add step
        </button>
      )}

      {editing && (
        <StepDialog
          versionId={versionId}
          step={editing.step}
          options={options}
          readOnly={readOnly}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this step?"
          tone="danger"
          confirmLabel="Delete step"
          busy={busy}
          message={
            <>
              Step {confirmDelete.seq} — <strong>{confirmDelete.title}</strong> will be removed and the
              remaining steps renumbered. This cannot be undone.
            </>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const ok = await run(
              sopApi(`/api/sop/versions/${versionId}/steps/${confirmDelete.id}`, "DELETE"),
            );
            if (ok) setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

// ── Step dialog ─────────────────────────────────────────────────────────────

type ChecklistDraft = { text: string; isMandatory: boolean };

function StepDialog({
  versionId,
  step,
  options,
  readOnly,
  onClose,
  onSaved,
}: {
  versionId: string;
  step: StepDTO | null;
  options: EditorOptionsDTO;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(step?.title ?? "");
  const [instruction, setInstruction] = useState(step?.instruction ?? "");
  const [responsibleRoleId, setResponsibleRoleId] = useState(step?.responsibleRoleId ?? "");
  const [responsibleRoleName, setResponsibleRoleName] = useState(step?.responsibleRoleName ?? "");
  const [responsibleDepartmentId, setResponsibleDepartmentId] = useState(
    step?.responsibleDepartmentId ?? "",
  );
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(step?.assignedEmployeeId ?? "");
  const [slaValue, setSlaValue] = useState(step?.slaValue != null ? String(step.slaValue) : "");
  const [slaUnit, setSlaUnit] = useState<SlaUnit | "">((step?.slaUnit as SlaUnit) ?? "hours");
  const [requiredInput, setRequiredInput] = useState(step?.requiredInput ?? "");
  const [expectedOutput, setExpectedOutput] = useState(step?.expectedOutput ?? "");
  const [evidence, setEvidence] = useState(step?.evidence ?? "");
  const [supportingDocument, setSupportingDocument] = useState(step?.supportingDocument ?? "");
  const [templateRef, setTemplateRef] = useState(step?.templateRef ?? "");
  const [linkUrl, setLinkUrl] = useState(step?.linkUrl ?? "");
  const [notes, setNotes] = useState(step?.notes ?? "");
  const [checklist, setChecklist] = useState<ChecklistDraft[]>(
    step?.checklist.map((c) => ({ text: c.text, isMandatory: c.isMandatory })) ?? [],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) {
      setError("Give the step a title.");
      return;
    }
    setBusy(true);
    setError(null);

    const body = {
      title: title.trim(),
      instruction: instruction.trim() || null,
      responsibleRoleId: responsibleRoleId || null,
      responsibleRoleName: responsibleRoleName.trim() || null,
      responsibleDepartmentId: responsibleDepartmentId || null,
      assignedEmployeeId: assignedEmployeeId || null,
      // An SLA needs both halves to mean anything, so a value with no unit (or
      // the reverse) is sent as no SLA rather than as a half-set one.
      slaValue: slaValue.trim() && slaUnit ? Number(slaValue) : null,
      slaUnit: slaValue.trim() && slaUnit ? slaUnit : null,
      requiredInput: requiredInput.trim() || null,
      expectedOutput: expectedOutput.trim() || null,
      evidence: evidence.trim() || null,
      supportingDocument: supportingDocument.trim() || null,
      templateRef: templateRef.trim() || null,
      linkUrl: linkUrl.trim() || null,
      notes: notes.trim() || null,
      checklist: checklist.filter((c) => c.text.trim()).map((c) => ({ ...c, text: c.text.trim() })),
    };

    const r = step
      ? await sopApi(`/api/sop/versions/${versionId}/steps/${step.id}`, "PATCH", body)
      : await sopApi(`/api/sop/versions/${versionId}/steps`, "POST", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={step ? `Step ${step.seq}` : "New step"}
      wide
      onClose={onClose}
      footer={
        readOnly ? (
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={primaryBtn} onClick={save} disabled={busy}>
              {busy ? "Saving…" : step ? "Save step" : "Add step"}
            </button>
          </>
        )
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <Field label="Step title" required>
        <input
          className={inputCls}
          value={title}
          disabled={readOnly}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Verify candidate documents"
        />
      </Field>

      <Field label="Detailed instruction / activity">
        <RichTextInput
          value={instruction}
          disabled={readOnly}
          onChange={setInstruction}
          rows={5}
          placeholder="What exactly does the responsible person do?"
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-md">
        <Field label="Responsible role" hint="From the HR role master.">
          <select
            className={inputCls}
            value={responsibleRoleId}
            disabled={readOnly}
            onChange={(e) => setResponsibleRoleId(e.target.value)}
          >
            <option value="">Not from the role master</option>
            {options.hrRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Role (free text)"
          hint="Use when the role master has no matching row yet."
        >
          <input
            className={inputCls}
            value={responsibleRoleName}
            disabled={readOnly}
            onChange={(e) => setResponsibleRoleName(e.target.value)}
            placeholder="e.g. Documentation Executive"
          />
        </Field>

        <Field label="Responsible department">
          <select
            className={inputCls}
            value={responsibleDepartmentId}
            disabled={readOnly}
            onChange={(e) => setResponsibleDepartmentId(e.target.value)}
          >
            <option value="">Any department</option>
            {options.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Assigned employee" hint="Optional — most steps name a role, not a person.">
          <select
            className={inputCls}
            value={assignedEmployeeId}
            disabled={readOnly}
            onChange={(e) => setAssignedEmployeeId(e.target.value)}
          >
            <option value="">Nobody in particular</option>
            {options.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="SLA / expected completion time">
          <div className="flex gap-xs">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={slaValue}
              disabled={readOnly}
              onChange={(e) => setSlaValue(e.target.value)}
              placeholder="4"
            />
            <select
              className={inputCls + " w-36"}
              value={slaUnit}
              disabled={readOnly}
              onChange={(e) => setSlaUnit(e.target.value as SlaUnit)}
              aria-label="SLA unit"
            >
              {SLA_UNITS.map((u) => (
                <option key={u} value={u}>
                  {SLA_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <Field label="Required input">
          <input
            className={inputCls}
            value={requiredInput}
            disabled={readOnly}
            onChange={(e) => setRequiredInput(e.target.value)}
            placeholder="What must be in hand before starting?"
          />
        </Field>

        <Field label="Expected output">
          <input
            className={inputCls}
            value={expectedOutput}
            disabled={readOnly}
            onChange={(e) => setExpectedOutput(e.target.value)}
            placeholder="What exists afterwards that did not before?"
          />
        </Field>

        <Field label="Evidence / proof of completion">
          <input
            className={inputCls}
            value={evidence}
            disabled={readOnly}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="e.g. Verification checklist signed"
          />
        </Field>

        <Field label="Supporting document">
          <input
            className={inputCls}
            value={supportingDocument}
            disabled={readOnly}
            onChange={(e) => setSupportingDocument(e.target.value)}
          />
        </Field>

        <Field label="Template">
          <input
            className={inputCls}
            value={templateRef}
            disabled={readOnly}
            onChange={(e) => setTemplateRef(e.target.value)}
          />
        </Field>

        <Field label="Link / URL">
          <input
            className={inputCls}
            value={linkUrl}
            disabled={readOnly}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          rows={2}
          className={taCls}
          value={notes}
          disabled={readOnly}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {/* Checklist — rows, not free text, so a future task instance can tick
          each item individually. */}
      <div>
        <div className="flex items-center justify-between mb-xs">
          <span className="text-label-sm text-on-surface-variant">Checklist</span>
          {!readOnly && (
            <button
              type="button"
              className={chipBtn}
              onClick={() => setChecklist((c) => [...c, { text: "", isMandatory: true }])}
            >
              <Icon name="add" size={16} /> Add item
            </button>
          )}
        </div>

        {checklist.length === 0 ? (
          <p className="text-caption text-on-surface-variant">
            No checklist on this step. Add one for steps where the reader needs to confirm several
            specific things.
          </p>
        ) : (
          <ul className="space-y-xs">
            {checklist.map((c, i) => (
              <li key={i} className="flex items-center gap-xs">
                <Icon name="check_box_outline_blank" size={18} className="text-outline shrink-0" />
                <input
                  className={inputCls}
                  value={c.text}
                  disabled={readOnly}
                  placeholder="e.g. Passport available"
                  onChange={(e) =>
                    setChecklist((list) =>
                      list.map((item, j) => (j === i ? { ...item, text: e.target.value } : item)),
                    )
                  }
                />
                <label className="flex items-center gap-xs text-label-sm text-on-surface-variant whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={c.isMandatory}
                    disabled={readOnly}
                    onChange={(e) =>
                      setChecklist((list) =>
                        list.map((item, j) =>
                          j === i ? { ...item, isMandatory: e.target.checked } : item,
                        ),
                      )
                    }
                  />
                  Mandatory
                </label>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label="Remove checklist item"
                    className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container transition"
                    onClick={() => setChecklist((list) => list.filter((_, j) => j !== i))}
                  >
                    <Icon name="close" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {readOnly && (
        <p className="text-caption text-on-surface-variant">
          This version is published, so its steps are read-only. Create a revision to change them.
        </p>
      )}
    </Modal>
  );
}
