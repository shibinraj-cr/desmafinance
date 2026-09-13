"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EditorOptionsDTO } from "@/lib/sop/editor-dto";
import {
  CONFIDENTIALITY_HINTS,
  CONFIDENTIALITY_LABELS,
  CONFIDENTIALITY_LEVELS,
  deriveDeptCode,
  formatSopNumber,
  type Confidentiality,
} from "@/lib/sop/constants";
import {
  ErrorNote,
  Field,
  Icon,
  Section,
  inputCls,
  primaryBtn,
  secondaryBtn,
  sopApi,
} from "@/components/sop/ui";

/**
 * The create form.
 *
 * Only the fields that decide the SOP's IDENTITY are asked for here — number,
 * department, owner, confidentiality, and who signs it off. Everything else
 * belongs to the version and is edited in the builder, which this hands over to
 * as soon as the record exists.
 *
 * The SOP number preview is computed with the SAME pure function the server
 * mints from (`deriveDeptCode`), so what the author is shown matches what they
 * get. The sequence is still the server's to allocate — the preview says "001"
 * only as an illustration, and the label says so.
 */
export function CreateSopClient({ options }: { options: EditorOptionsDTO }) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [processFunction, setProcessFunction] = useState("");
  const [ownerEmployeeId, setOwnerEmployeeId] = useState("");
  const [confidentiality, setConfidentiality] = useState<Confidentiality>("general");
  const [reviewerId, setReviewerId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [supportingRoleIds, setSupportingRoleIds] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const numberPreview = useMemo(() => {
    const dept = options.departments.find((d) => d.id === departmentId);
    if (!dept) return null;
    return formatSopNumber(deriveDeptCode(dept.name), 1);
  }, [departmentId, options.departments]);

  const problems: Record<string, string | null> = {
    title: touched && !title.trim() ? "Give the SOP a title." : null,
    departmentId: touched && !departmentId ? "Choose the department that owns this process." : null,
    ownerEmployeeId: touched && !ownerEmployeeId ? "An SOP must have a process owner." : null,
  };
  const valid = !!title.trim() && !!departmentId && !!ownerEmployeeId;

  async function create() {
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);

    const r = await sopApi<{ sop: { id: string }; version: { id: string } }>(
      "/api/sop/sops",
      "POST",
      {
        title: title.trim(),
        departmentId,
        categoryId: categoryId || null,
        processFunction: processFunction.trim() || null,
        ownerEmployeeId,
        supportingRoleIds,
        confidentiality,
        reviewerId: reviewerId || null,
        approverId: approverId || null,
      },
    );
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    // Straight into the builder — creating an SOP and then being left on an
    // empty confirmation screen would only make everyone click again.
    router.push(`/sop/${r.data.sop.id}/edit`);
  }

  return (
    <div className="max-w-3xl space-y-lg">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="Basic information"
        description="Enough to create the SOP and give it a permanent number. The full builder opens next."
      >
        <div className="grid sm:grid-cols-2 gap-md">
          <div className="sm:col-span-2">
            <Field label="SOP title" required error={problems.title}>
              <input
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Candidate Document Verification Process"
              />
            </Field>
          </div>

          <Field label="Department" required error={problems.departmentId}>
            <select
              className={inputCls}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">Choose a department…</option>
              {options.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="SOP ID"
            hint={
              numberPreview
                ? "Generated on save and permanent for the life of the SOP. The sequence number is allocated by the server."
                : "Choose a department to see the SOP ID format."
            }
          >
            <input
              className={inputCls + " font-mono"}
              value={numberPreview ? `${numberPreview.replace(/\d+$/, "…")}` : ""}
              placeholder="OPS-SOP-…"
              readOnly
              disabled
            />
          </Field>

          <Field label="SOP category">
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorised</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {options.categories.length === 0 && (
              <span className="block text-caption text-on-surface-variant mt-xs">
                No categories yet — a SOP administrator can add them under Categories &amp; Access.
              </span>
            )}
          </Field>

          <Field label="Process / function">
            <input
              className={inputCls}
              value={processFunction}
              onChange={(e) => setProcessFunction(e.target.value)}
              placeholder="e.g. Candidate onboarding"
            />
          </Field>

          <Field
            label="SOP owner / process owner"
            required
            error={problems.ownerEmployeeId}
            hint="From the DESGRO employee master — the person accountable for this process."
          >
            <select
              className={inputCls}
              value={ownerEmployeeId}
              onChange={(e) => setOwnerEmployeeId(e.target.value)}
            >
              <option value="">Choose an owner…</option>
              {options.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.designation ? ` — ${e.designation}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Confidentiality" hint={CONFIDENTIALITY_HINTS[confidentiality]}>
            <select
              className={inputCls}
              value={confidentiality}
              onChange={(e) => setConfidentiality(e.target.value as Confidentiality)}
            >
              {CONFIDENTIALITY_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {CONFIDENTIALITY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Reviewer" hint="Leave blank to send the SOP straight to approval.">
            <select className={inputCls} value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              <option value="">No reviewer</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Approver" hint="Can be chosen later, but is required before approval.">
            <select className={inputCls} value={approverId} onChange={(e) => setApproverId(e.target.value)}>
              <option value="">Not chosen yet</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Supporting team / responsible roles">
              <div className="flex flex-wrap gap-xs">
                {options.hrRoles.length === 0 && (
                  <span className="text-caption text-on-surface-variant">
                    No roles in the HR role master yet.
                  </span>
                )}
                {options.hrRoles.map((r) => {
                  const on = supportingRoleIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        setSupportingRoleIds(
                          on ? supportingRoleIds.filter((id) => id !== r.id) : [...supportingRoleIds, r.id],
                        )
                      }
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
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap justify-end gap-xs">
        <button type="button" className={secondaryBtn} onClick={() => router.push("/sop/library")} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryBtn + " inline-flex items-center gap-xs"}
          onClick={create}
          disabled={busy}
        >
          {busy ? "Creating…" : "Create & continue"}
          {!busy && <Icon name="arrow_forward" size={18} />}
        </button>
      </div>
    </div>
  );
}
