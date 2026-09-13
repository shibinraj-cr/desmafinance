"use client";

import { useState } from "react";
import type {
  AttachmentDTO,
  EditorOptionsDTO,
  ExceptionDTO,
  KpiDTO,
  QualityDTO,
} from "@/lib/sop/editor-dto";
import {
  ATTACHMENT_TYPES,
  ATTACHMENT_TYPE_LABELS,
  EXCEPTION_PRIORITIES,
  EXCEPTION_PRIORITY_CLASSES,
  EXCEPTION_PRIORITY_LABELS,
  KPI_STATUS_CLASSES,
  KPI_STATUS_LABELS,
  REVIEW_FREQUENCIES,
  REVIEW_FREQUENCY_LABELS,
  SLA_UNITS,
  SLA_UNIT_LABELS,
  formatSla,
  type AttachmentType,
  type ExceptionPriority,
  type KpiStatus,
} from "@/lib/sop/constants";
import {
  ConfirmDialog,
  Empty,
  ErrorNote,
  Field,
  Icon,
  Modal,
  Pill,
  Td,
  Th,
  formatDate,
  inputCls,
  primaryBtn,
  secondaryBtn,
  sopApi,
  sopUpload,
  taCls,
} from "./ui";

type Busy = { busy: boolean; error: string | null };

function useCollection(onChanged: () => void) {
  const [state, setState] = useState<Busy>({ busy: false, error: null });
  async function run(p: Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    setState({ busy: true, error: null });
    const r = await p;
    setState({ busy: false, error: r.ok ? null : (r.error ?? "That did not work.") });
    if (r.ok) onChanged();
    return r.ok;
  }
  return { ...state, run, clearError: () => setState((s) => ({ ...s, error: null })) };
}

// ── Quality standards (§7) ──────────────────────────────────────────────────

export function QualitySection({
  versionId,
  criteria,
  readOnly,
  onChanged,
}: {
  versionId: string;
  criteria: QualityDTO[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const c = useCollection(onChanged);
  const [editing, setEditing] = useState<{ item: QualityDTO | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QualityDTO | null>(null);

  return (
    <div className="space-y-md">
      {c.error && <ErrorNote>{c.error}</ErrorNote>}

      {criteria.length === 0 ? (
        <Empty
          icon="verified"
          title="No quality criteria yet"
          hint="Add the measurable conditions that make this process 'done properly'."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant">
          <table className="w-full min-w-[36rem] border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <Th className="w-10">#</Th>
                <Th>Criterion</Th>
                <Th className="w-56">Target / standard</Th>
                <Th className="w-28">Mandatory</Th>
                {!readOnly && <Th className="w-24 text-right">Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {criteria.map((q) => (
                <tr key={q.id} className="border-b border-outline-variant last:border-0">
                  <Td className="text-on-surface-variant">{q.seq}</Td>
                  <Td className="text-on-surface">{q.criterion}</Td>
                  <Td className="text-on-surface-variant">{q.target ?? "—"}</Td>
                  <Td>
                    {q.isMandatory ? (
                      <Pill className="bg-primary text-on-primary">Yes</Pill>
                    ) : (
                      <Pill className="bg-surface-container-high text-on-surface-variant">No</Pill>
                    )}
                  </Td>
                  {!readOnly && (
                    <Td className="text-right whitespace-nowrap">
                      <RowActions
                        onEdit={() => setEditing({ item: q })}
                        onDelete={() => setConfirmDelete(q)}
                        disabled={c.busy}
                      />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <button
          type="button"
          className={primaryBtn + " inline-flex items-center gap-xs"}
          onClick={() => setEditing({ item: null })}
        >
          <Icon name="add" /> Add criterion
        </button>
      )}

      {editing && (
        <QualityDialog
          versionId={versionId}
          item={editing.item}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this criterion?"
          tone="danger"
          confirmLabel="Delete"
          busy={c.busy}
          message={<>&ldquo;{confirmDelete.criterion}&rdquo; will be removed from the quality standard.</>}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const ok = await c.run(
              sopApi(`/api/sop/versions/${versionId}/quality/${confirmDelete.id}`, "DELETE"),
            );
            if (ok) setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function QualityDialog({
  versionId,
  item,
  onClose,
  onSaved,
}: {
  versionId: string;
  item: QualityDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [criterion, setCriterion] = useState(item?.criterion ?? "");
  const [target, setTarget] = useState(item?.target ?? "");
  const [isMandatory, setIsMandatory] = useState(item?.isMandatory ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!criterion.trim()) {
      setError("Describe the criterion.");
      return;
    }
    setBusy(true);
    setError(null);
    const body = { criterion: criterion.trim(), target: target.trim() || null, isMandatory };
    const r = item
      ? await sopApi(`/api/sop/versions/${versionId}/quality/${item.id}`, "PATCH", body)
      : await sopApi(`/api/sop/versions/${versionId}/quality`, "POST", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={item ? "Edit quality criterion" : "Add quality criterion"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <Field label="Criterion" required>
        <input
          className={inputCls}
          value={criterion}
          onChange={(e) => setCriterion(e.target.value)}
          placeholder="e.g. Document completeness"
        />
      </Field>
      <Field label="Target / standard" hint="Written as it should be judged — '100%', 'Must match passport'.">
        <input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <label className="flex items-center gap-xs text-body-md text-on-surface-variant">
        <input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} />
        Mandatory
      </label>
    </Modal>
  );
}

// ── Exceptions & escalations (§8) ───────────────────────────────────────────

export function ExceptionSection({
  versionId,
  exceptions,
  options,
  readOnly,
  onChanged,
}: {
  versionId: string;
  exceptions: ExceptionDTO[];
  options: EditorOptionsDTO;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const c = useCollection(onChanged);
  const [editing, setEditing] = useState<{ item: ExceptionDTO | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExceptionDTO | null>(null);

  return (
    <div className="space-y-md">
      {c.error && <ErrorNote>{c.error}</ErrorNote>}

      {exceptions.length === 0 ? (
        <Empty
          icon="warning"
          title="No exceptions defined"
          hint="Add the things that go wrong, what to do, and who to escalate to."
        />
      ) : (
        <ul className="space-y-sm">
          {exceptions.map((x) => (
            <li
              key={x.id}
              className={
                "rounded-xl border p-md " +
                // Critical rows are visually highlighted (§8) — a red left edge
                // and tinted ground, not just a differently-coloured pill.
                (x.priority === "critical"
                  ? "border-error bg-error-container/30 border-l-4"
                  : "border-outline-variant bg-surface-container-lowest")
              }
            >
              <div className="flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-xs">
                    <Pill className={EXCEPTION_PRIORITY_CLASSES[x.priority as ExceptionPriority]}>
                      {EXCEPTION_PRIORITY_LABELS[x.priority as ExceptionPriority] ?? x.priority}
                    </Pill>
                    <span className="text-body-lg font-medium text-on-surface">{x.issue}</span>
                  </div>
                  {x.condition && (
                    <p className="text-body-sm text-on-surface-variant mt-xs">
                      <span className="font-medium text-on-surface">When: </span>
                      {x.condition}
                    </p>
                  )}
                  {x.requiredAction && (
                    <p className="text-body-sm text-on-surface-variant mt-xs">
                      <span className="font-medium text-on-surface">Do: </span>
                      {x.requiredAction}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-xs mt-sm">
                    {(x.escalateToRole || x.escalateToEmployee) && (
                      <Pill className="bg-surface-container-high text-on-surface-variant">
                        <Icon name="escalator_warning" size={12} className="mr-px" />
                        {[x.escalateToRole, x.escalateToEmployee].filter(Boolean).join(" · ")}
                      </Pill>
                    )}
                    {x.escalationSla != null && x.escalationUnit && (
                      <Pill className="bg-primary-fixed text-on-primary">
                        <Icon name="timer" size={12} className="mr-px" />
                        {formatSla(x.escalationSla, x.escalationUnit)}
                      </Pill>
                    )}
                    {x.notifyProcessOwner && (
                      <Pill className="bg-surface-container-high text-on-surface-variant">
                        Notifies process owner
                      </Pill>
                    )}
                    {x.notifyDepartmentHead && (
                      <Pill className="bg-surface-container-high text-on-surface-variant">
                        Notifies department head
                      </Pill>
                    )}
                  </div>
                </div>
                {!readOnly && (
                  <RowActions
                    onEdit={() => setEditing({ item: x })}
                    onDelete={() => setConfirmDelete(x)}
                    disabled={c.busy}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <button
          type="button"
          className={primaryBtn + " inline-flex items-center gap-xs"}
          onClick={() => setEditing({ item: null })}
        >
          <Icon name="add" /> Add exception
        </button>
      )}

      {editing && (
        <ExceptionDialog
          versionId={versionId}
          item={editing.item}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this exception?"
          tone="danger"
          confirmLabel="Delete"
          busy={c.busy}
          message={<>&ldquo;{confirmDelete.issue}&rdquo; will be removed from the escalation matrix.</>}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const ok = await c.run(
              sopApi(`/api/sop/versions/${versionId}/exceptions/${confirmDelete.id}`, "DELETE"),
            );
            if (ok) setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function ExceptionDialog({
  versionId,
  item,
  options,
  onClose,
  onSaved,
}: {
  versionId: string;
  item: ExceptionDTO | null;
  options: EditorOptionsDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [issue, setIssue] = useState(item?.issue ?? "");
  const [condition, setCondition] = useState(item?.condition ?? "");
  const [requiredAction, setRequiredAction] = useState(item?.requiredAction ?? "");
  const [escalateToRoleId, setEscalateToRoleId] = useState(item?.escalateToRoleId ?? "");
  const [escalateToRoleName, setEscalateToRoleName] = useState(item?.escalateToRoleName ?? "");
  const [escalateToEmployeeId, setEscalateToEmployeeId] = useState(item?.escalateToEmployeeId ?? "");
  const [escalationSla, setEscalationSla] = useState(
    item?.escalationSla != null ? String(item.escalationSla) : "",
  );
  const [escalationUnit, setEscalationUnit] = useState(item?.escalationUnit ?? "hours");
  const [priority, setPriority] = useState<ExceptionPriority>(
    (item?.priority as ExceptionPriority) ?? "medium",
  );
  const [notifyProcessOwner, setNotifyProcessOwner] = useState(item?.notifyProcessOwner ?? false);
  const [notifyDepartmentHead, setNotifyDepartmentHead] = useState(item?.notifyDepartmentHead ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!issue.trim()) {
      setError("Describe the exception.");
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      issue: issue.trim(),
      condition: condition.trim() || null,
      requiredAction: requiredAction.trim() || null,
      escalateToRoleId: escalateToRoleId || null,
      escalateToRoleName: escalateToRoleName.trim() || null,
      escalateToEmployeeId: escalateToEmployeeId || null,
      escalationSla: escalationSla.trim() ? Number(escalationSla) : null,
      escalationUnit: escalationSla.trim() ? escalationUnit : null,
      priority,
      notifyProcessOwner,
      notifyDepartmentHead,
    };
    const r = item
      ? await sopApi(`/api/sop/versions/${versionId}/exceptions/${item.id}`, "PATCH", body)
      : await sopApi(`/api/sop/versions/${versionId}/exceptions`, "POST", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={item ? "Edit exception" : "Add exception"}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <Field label="Exception / issue" required>
        <input
          className={inputCls}
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="e.g. Passport name differs from nursing registration"
        />
      </Field>
      <Field label="Condition">
        <textarea
          rows={2}
          className={taCls}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="When exactly does this apply?"
        />
      </Field>
      <Field label="Required action">
        <textarea
          rows={2}
          className={taCls}
          value={requiredAction}
          onChange={(e) => setRequiredAction(e.target.value)}
          placeholder="e.g. Request supporting proof from the candidate"
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-md">
        <Field label="Escalate to role">
          <select
            className={inputCls}
            value={escalateToRoleId}
            onChange={(e) => setEscalateToRoleId(e.target.value)}
          >
            <option value="">Not from the role master</option>
            {options.hrRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Escalate to role (free text)">
          <input
            className={inputCls}
            value={escalateToRoleName}
            onChange={(e) => setEscalateToRoleName(e.target.value)}
            placeholder="e.g. Operations Team Lead"
          />
        </Field>
        <Field label="Escalate to employee" hint="Optional.">
          <select
            className={inputCls}
            value={escalateToEmployeeId}
            onChange={(e) => setEscalateToEmployeeId(e.target.value)}
          >
            <option value="">Nobody in particular</option>
            {options.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Escalation SLA">
          <div className="flex gap-xs">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={escalationSla}
              onChange={(e) => setEscalationSla(e.target.value)}
              placeholder="24"
            />
            <select
              className={inputCls + " w-36"}
              value={escalationUnit}
              onChange={(e) => setEscalationUnit(e.target.value)}
              aria-label="Escalation SLA unit"
            >
              {SLA_UNITS.map((u) => (
                <option key={u} value={u}>
                  {SLA_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Priority">
          <select
            className={inputCls}
            value={priority}
            onChange={(e) => setPriority(e.target.value as ExceptionPriority)}
          >
            {EXCEPTION_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {EXCEPTION_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-md">
        <label className="flex items-center gap-xs text-body-md text-on-surface-variant">
          <input
            type="checkbox"
            checked={notifyProcessOwner}
            onChange={(e) => setNotifyProcessOwner(e.target.checked)}
          />
          Notify process owner
        </label>
        <label className="flex items-center gap-xs text-body-md text-on-surface-variant">
          <input
            type="checkbox"
            checked={notifyDepartmentHead}
            onChange={(e) => setNotifyDepartmentHead(e.target.checked)}
          />
          Notify department head
        </label>
      </div>
    </Modal>
  );
}

// ── KPIs (§9) ───────────────────────────────────────────────────────────────

export function KpiSection({
  versionId,
  kpis,
  options,
  readOnly,
  canRecord,
  onChanged,
}: {
  versionId: string;
  kpis: KpiDTO[];
  options: EditorOptionsDTO;
  readOnly: boolean;
  /** Recording a RESULT is allowed on a published SOP; editing the definition is not. */
  canRecord?: boolean;
  onChanged: () => void;
}) {
  const c = useCollection(onChanged);
  const [editing, setEditing] = useState<{ item: KpiDTO | null } | null>(null);
  const [recording, setRecording] = useState<KpiDTO | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<KpiDTO | null>(null);

  return (
    <div className="space-y-md">
      {c.error && <ErrorNote>{c.error}</ErrorNote>}

      {kpis.length === 0 ? (
        <Empty
          icon="monitoring"
          title="No KPIs defined"
          hint="Add the measures that say whether this process is working."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant">
          <table className="w-full min-w-[46rem] border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <Th>KPI</Th>
                <Th className="w-28">Target</Th>
                <Th className="hidden md:table-cell w-32">Frequency</Th>
                <Th className="hidden lg:table-cell w-40">Owner</Th>
                <Th className="w-44">Latest result</Th>
                <Th className="w-28 text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((k) => (
                <tr key={k.id} className="border-b border-outline-variant last:border-0 align-top">
                  <Td>
                    <div className="text-on-surface font-medium">{k.name}</div>
                    {k.description && (
                      <div className="text-caption text-on-surface-variant mt-px">{k.description}</div>
                    )}
                    {k.measurementMethod && (
                      <div className="text-caption text-on-surface-variant mt-px">
                        Measured by: {k.measurementMethod}
                      </div>
                    )}
                    {k.dataSource && (
                      <div className="text-caption text-on-surface-variant mt-px">
                        Source: {k.dataSource}
                      </div>
                    )}
                  </Td>
                  <Td className="text-on-surface-variant whitespace-nowrap">
                    {[k.target, k.unit].filter(Boolean).join(" ") || "—"}
                  </Td>
                  <Td className="hidden md:table-cell text-on-surface-variant">
                    {k.reviewFrequency
                      ? (REVIEW_FREQUENCY_LABELS[
                          k.reviewFrequency as keyof typeof REVIEW_FREQUENCY_LABELS
                        ] ?? k.reviewFrequency)
                      : "—"}
                  </Td>
                  <Td className="hidden lg:table-cell text-on-surface-variant">{k.kpiOwner ?? "—"}</Td>
                  <Td>
                    {k.latestActual ? (
                      <div className="flex flex-col gap-px">
                        <span className="text-on-surface font-medium">{k.latestActual}</span>
                        {k.latestStatus && (
                          <Pill className={KPI_STATUS_CLASSES[k.latestStatus as KpiStatus]}>
                            {KPI_STATUS_LABELS[k.latestStatus as KpiStatus] ?? k.latestStatus}
                          </Pill>
                        )}
                        <span className="text-caption text-on-surface-variant">
                          {formatDate(k.latestReviewedAt)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-on-surface-variant">Not measured yet</span>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {canRecord && (
                      <button
                        type="button"
                        title="Record result"
                        aria-label={`Record a result for ${k.name}`}
                        className="h-8 w-8 grid place-items-center rounded-lg text-accent hover:bg-surface-container transition"
                        onClick={() => setRecording(k)}
                      >
                        <Icon name="add_chart" size={18} />
                      </button>
                    )}
                    {!readOnly && (
                      <RowActions
                        onEdit={() => setEditing({ item: k })}
                        onDelete={() => setConfirmDelete(k)}
                        disabled={c.busy}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <button
          type="button"
          className={primaryBtn + " inline-flex items-center gap-xs"}
          onClick={() => setEditing({ item: null })}
        >
          <Icon name="add" /> Add KPI
        </button>
      )}

      {editing && (
        <KpiDialog
          versionId={versionId}
          item={editing.item}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      {recording && (
        <KpiReviewDialog
          kpi={recording}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this KPI?"
          tone="danger"
          confirmLabel="Delete KPI"
          busy={c.busy}
          message={
            <>
              &ldquo;{confirmDelete.name}&rdquo; and every result recorded against it on this version
              will be removed. This cannot be undone.
            </>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const ok = await c.run(
              sopApi(`/api/sop/versions/${versionId}/kpis/${confirmDelete.id}`, "DELETE"),
            );
            if (ok) setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function KpiDialog({
  versionId,
  item,
  options,
  onClose,
  onSaved,
}: {
  versionId: string;
  item: KpiDTO | null;
  options: EditorOptionsDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [target, setTarget] = useState(item?.target ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [measurementMethod, setMeasurementMethod] = useState(item?.measurementMethod ?? "");
  const [dataSource, setDataSource] = useState(item?.dataSource ?? "");
  const [reviewFrequency, setReviewFrequency] = useState(item?.reviewFrequency ?? "monthly");
  const [kpiOwnerEmployeeId, setKpiOwnerEmployeeId] = useState(item?.kpiOwnerEmployeeId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setError("Give the KPI a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      target: target.trim() || null,
      unit: unit.trim() || null,
      measurementMethod: measurementMethod.trim() || null,
      dataSource: dataSource.trim() || null,
      reviewFrequency: reviewFrequency || null,
      kpiOwnerEmployeeId: kpiOwnerEmployeeId || null,
    };
    const r = item
      ? await sopApi(`/api/sop/versions/${versionId}/kpis/${item.id}`, "PATCH", body)
      : await sopApi(`/api/sop/versions/${versionId}/kpis`, "POST", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={item ? "Edit KPI" : "Add KPI"}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <Field label="KPI name" required>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Document verification turnaround"
        />
      </Field>
      <Field label="Description">
        <textarea
          rows={2}
          className={taCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-md">
        <Field
          label="Target"
          hint="Written with its comparison — '< 24', '> 95'. Free text, because the direction matters."
        >
          <input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label="Unit">
          <input
            className={inputCls}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="hours / % / count"
          />
        </Field>
        <Field label="Measurement method">
          <input
            className={inputCls}
            value={measurementMethod}
            onChange={(e) => setMeasurementMethod(e.target.value)}
          />
        </Field>
        <Field
          label="Data source"
          hint="Where the number comes from — the anchor an automatic actual would read later."
        >
          <input className={inputCls} value={dataSource} onChange={(e) => setDataSource(e.target.value)} />
        </Field>
        <Field label="Review frequency">
          <select
            className={inputCls}
            value={reviewFrequency}
            onChange={(e) => setReviewFrequency(e.target.value)}
          >
            {REVIEW_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {REVIEW_FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="KPI owner">
          <select
            className={inputCls}
            value={kpiOwnerEmployeeId}
            onChange={(e) => setKpiOwnerEmployeeId(e.target.value)}
          >
            <option value="">Same as the process owner</option>
            {options.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/** Record a measured result for one KPI period (§9's KPI Review screen). */
export function KpiReviewDialog({
  kpi,
  onClose,
  onSaved,
}: {
  kpi: KpiDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [actual, setActual] = useState("");
  const [status, setStatus] = useState<KpiStatus>("on_target");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!actual.trim()) {
      setError("Enter the actual result.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await sopApi(`/api/sop/kpis/${kpi.id}/reviews`, "POST", {
      periodStart,
      periodEnd,
      actual: actual.trim(),
      status,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={`Record result — ${kpi.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Record result"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <p className="text-body-sm text-on-surface-variant">
        Target: <strong className="text-on-surface">{[kpi.target, kpi.unit].filter(Boolean).join(" ") || "—"}</strong>
      </p>

      <div className="grid sm:grid-cols-2 gap-md">
        <Field label="Period start" required>
          <input
            type="date"
            className={inputCls}
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </Field>
        <Field label="Period end" required>
          <input
            type="date"
            className={inputCls}
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </Field>
        <Field label="Actual result" required hint="As measured — '18h', '96%', '3'.">
          <input className={inputCls} value={actual} onChange={(e) => setActual(e.target.value)} />
        </Field>
        <Field label="Status" required>
          <select
            className={inputCls}
            value={status}
            onChange={(e) => setStatus(e.target.value as KpiStatus)}
          >
            {(Object.keys(KPI_STATUS_LABELS) as KpiStatus[]).map((s) => (
              <option key={s} value={s}>
                {KPI_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Review notes">
        <textarea rows={3} className={taCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {kpi.reviews.length > 0 && (
        <div>
          <div className="text-label-sm text-on-surface-variant mb-xs">Recent results</div>
          <ul className="space-y-xs">
            {kpi.reviews.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-md text-body-sm">
                <span className="text-on-surface-variant">
                  {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                </span>
                <span className="flex items-center gap-xs">
                  <span className="text-on-surface font-medium">{r.actual}</span>
                  <Pill className={KPI_STATUS_CLASSES[r.status as KpiStatus]}>
                    {KPI_STATUS_LABELS[r.status as KpiStatus] ?? r.status}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-on-surface-variant mt-xs">
            Recording the same period again replaces that entry rather than adding a second one.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ── Attachments (§21) ───────────────────────────────────────────────────────

export function AttachmentSection({
  versionId,
  attachments,
  readOnly,
  onChanged,
}: {
  versionId: string;
  attachments: AttachmentDTO[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const c = useCollection(onChanged);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AttachmentDTO | null>(null);

  return (
    <div className="space-y-md">
      {c.error && <ErrorNote>{c.error}</ErrorNote>}

      {attachments.length === 0 ? (
        <Empty
          icon="attach_file"
          title="Nothing attached"
          hint="Attach the forms, templates, policies or training material this SOP refers to."
        />
      ) : (
        <ul className="divide-y divide-outline-variant rounded-xl border border-outline-variant">
          {attachments.map((a) => {
            const href = a.fileUrl ?? a.linkUrl;
            return (
              <li key={a.id} className="flex items-center gap-md px-md py-sm">
                <Icon
                  name={a.fileUrl ? "description" : "link"}
                  size={20}
                  className="text-on-surface-variant shrink-0"
                />
                <div className="min-w-0 flex-1">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-on-surface font-medium hover:text-accent hover:underline"
                    >
                      {a.title}
                    </a>
                  ) : (
                    <span className="text-on-surface font-medium">{a.title}</span>
                  )}
                  <div className="text-caption text-on-surface-variant">
                    {[
                      ATTACHMENT_TYPE_LABELS[a.docType as AttachmentType] ?? a.docType,
                      a.docVersion,
                      a.fileName,
                      a.uploadedBy,
                      formatDate(a.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove ${a.title}`}
                    disabled={c.busy}
                    className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container transition"
                    onClick={() => setConfirmDelete(a)}
                  >
                    <Icon name="delete" size={18} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <button
          type="button"
          className={primaryBtn + " inline-flex items-center gap-xs"}
          onClick={() => setAdding(true)}
        >
          <Icon name="add" /> Add document
        </button>
      )}

      {adding && (
        <AttachmentDialog
          versionId={versionId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Remove this document?"
          tone="danger"
          confirmLabel="Remove"
          busy={c.busy}
          message={<>&ldquo;{confirmDelete.title}&rdquo; will no longer be attached to this SOP version.</>}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const ok = await c.run(
              sopApi(`/api/sop/versions/${versionId}/attachments/${confirmDelete.id}`, "DELETE"),
            );
            if (ok) setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function AttachmentDialog({
  versionId,
  onClose,
  onSaved,
}: {
  versionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"link" | "file">("link");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<AttachmentType>("form");
  const [docVersion, setDocVersion] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!title.trim() && mode === "link") {
      setError("Give the document a title.");
      return;
    }
    setBusy(true);

    if (mode === "link") {
      const r = await sopApi(`/api/sop/versions/${versionId}/attachments`, "POST", {
        title: title.trim(),
        docType,
        linkUrl: linkUrl.trim(),
        docVersion: docVersion.trim() || null,
      });
      setBusy(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onSaved();
      return;
    }

    if (!file) {
      setBusy(false);
      setError("Choose a file.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("title", title.trim() || file.name);
    form.set("docType", docType);
    if (docVersion.trim()) form.set("docVersion", docVersion.trim());
    const r = await sopUpload(`/api/sop/versions/${versionId}/attachments`, form);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title="Add related document"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Attach"}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-xs">
        {(["link", "file"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              "h-9 px-md rounded-lg text-label-sm transition border " +
              (mode === m
                ? "bg-primary text-on-primary border-primary"
                : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
            }
          >
            {m === "link" ? "External link" : "Upload a file"}
          </button>
        ))}
      </div>

      <Field label="Title" required={mode === "link"} hint={mode === "file" ? "Defaults to the file name." : undefined}>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <div className="grid sm:grid-cols-2 gap-md">
        <Field label="Document type">
          <select
            className={inputCls}
            value={docType}
            onChange={(e) => setDocType(e.target.value as AttachmentType)}
          >
            {ATTACHMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ATTACHMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Document version" hint="The document's own revision label, if it has one.">
          <input className={inputCls} value={docVersion} onChange={(e) => setDocVersion(e.target.value)} />
        </Field>
      </div>

      {mode === "link" ? (
        <Field label="Link / URL" required hint="Google Drive, an intranet page, a training video.">
          <input
            className={inputCls}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
      ) : (
        <Field label="File" required hint="PDF, Word, Excel, PowerPoint, CSV, text or image — up to 10 MB.">
          <input
            type="file"
            className={inputCls + " py-xs"}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg,.webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      )}
    </Modal>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────────

function RowActions({
  onEdit,
  onDelete,
  disabled,
}: {
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-px">
      <button
        type="button"
        aria-label="Edit"
        title="Edit"
        onClick={onEdit}
        disabled={disabled}
        className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container transition disabled:opacity-40"
      >
        <Icon name="edit" size={18} />
      </button>
      <button
        type="button"
        aria-label="Delete"
        title="Delete"
        onClick={onDelete}
        disabled={disabled}
        className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container transition disabled:opacity-40"
      >
        <Icon name="delete" size={18} />
      </button>
    </span>
  );
}
