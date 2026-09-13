"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EditorOptionsDTO, SopHeaderDTO, VersionDTO } from "@/lib/sop/editor-dto";
import {
  CONFIDENTIALITY_HINTS,
  CONFIDENTIALITY_LABELS,
  CONFIDENTIALITY_LEVELS,
  REVIEW_FREQUENCIES,
  REVIEW_FREQUENCY_LABELS,
  REVIEW_REMINDER_OPTIONS,
  TRIGGER_TYPES,
  TRIGGER_TYPE_LABELS,
  sopStatusClass,
  sopStatusLabel,
  type Confidentiality,
} from "@/lib/sop/constants";
import { RichTextInput } from "./RichTextInput";
import { StepBuilder } from "./StepBuilder";
import { AttachmentSection, ExceptionSection, KpiSection, QualitySection } from "./ListSections";
import { PublishDialog } from "./PublishDialog";
import {
  ConfirmDialog,
  ErrorNote,
  Field,
  Icon,
  Modal,
  Pill,
  Section,
  dangerBtn,
  inputCls,
  primaryBtn,
  secondaryBtn,
  sopApi,
  taCls,
  useUnsavedWarning,
} from "./ui";

/** The left navigator's sections, in the order the brief lists them (§25). */
const SECTIONS = [
  { key: "basic", label: "Basic Information", icon: "badge" },
  { key: "purpose", label: "Purpose", icon: "flag" },
  { key: "trigger", label: "Trigger", icon: "bolt" },
  { key: "steps", label: "Steps", icon: "format_list_numbered" },
  { key: "quality", label: "Quality Standards", icon: "verified" },
  { key: "exceptions", label: "Exceptions", icon: "warning" },
  { key: "kpis", label: "KPIs", icon: "monitoring" },
  { key: "review", label: "Review Settings", icon: "event_repeat" },
  { key: "attachments", label: "Attachments", icon: "attach_file" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export type EditorCapabilities = {
  canEdit: boolean;
  canRequestReview: boolean;
  canSubmitForApproval: boolean;
  canReview: boolean;
  canApprove: boolean;
  canPublish: boolean;
  canRecordKpi: boolean;
};

/**
 * The SOP builder (§3–§10, §26).
 *
 * Structure over one big text box: each section writes to typed columns, and
 * the left navigator shows which are filled in. That is what makes an SOP
 * something a workflow engine can later read rather than a document a person
 * has to.
 *
 * SAVING — two different models, on purpose:
 *   • The scalar sections (basic, purpose, trigger, quality, review) are a form
 *     with an explicit Save. They are edited as a unit and autosaving prose
 *     mid-sentence produces a draft history full of half-typed words.
 *   • The list sections (steps, criteria, exceptions, KPIs, attachments) save
 *     per row as you add or edit them, because each row is already a discrete
 *     decision and there is nothing to batch.
 *
 * A published version renders exactly the same UI in read-only mode, so the
 * reviewer sees the document as it will be, not a different rendering of it.
 */
export function SopEditor({
  sop,
  version,
  options,
  capabilities,
}: {
  sop: SopHeaderDTO;
  version: VersionDTO;
  options: EditorOptionsDTO;
  capabilities: EditorCapabilities;
}) {
  const router = useRouter();
  const readOnly = !capabilities.canEdit;

  // ── Scalar form state ─────────────────────────────────────────────────────
  const initial = useMemo(
    () => ({
      title: version.title,
      departmentId: version.departmentId ?? "",
      categoryId: version.categoryId ?? "",
      processFunction: version.processFunction ?? "",
      ownerEmployeeId: version.ownerEmployeeId,
      supportingRoleIds: version.supportingRoleIds,
      confidentiality: version.confidentiality as Confidentiality,
      reviewerId: version.reviewerId ?? "",
      approverId: version.approverId ?? "",
      purpose: version.purpose ?? "",
      triggerDescription: version.triggerDescription ?? "",
      triggerType: version.triggerType ?? "",
      triggerSource: version.triggerSource ?? "",
      triggerCondition: version.triggerCondition ?? "",
      qualityStandard: version.qualityStandard ?? "",
      reviewFrequency: version.reviewFrequency ?? "",
      reviewIntervalDays: version.reviewIntervalDays != null ? String(version.reviewIntervalDays) : "",
      lastReviewDate: version.lastReviewDate ?? "",
      nextReviewDate: version.nextReviewDate ?? "",
      reviewOwnerEmployeeId: version.reviewOwnerEmployeeId ?? "",
      reviewReminderDays: String(version.reviewReminderDays),
      changeSummary: version.changeSummary ?? "",
    }),
    [version],
  );

  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SectionKey>("basic");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [workflowPrompt, setWorkflowPrompt] = useState<null | {
    action: "request_review" | "submit_for_approval" | "approve_review" | "approve" | "request_changes";
    title: string;
    confirmLabel: string;
    requireComment: boolean;
  }>(null);
  const [publishing, setPublishing] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );
  useUnsavedWarning(dirty && !readOnly);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const refresh = useCallback(() => router.refresh(), [router]);

  async function save(): Promise<boolean> {
    if (readOnly) return false;
    if (!form.title.trim()) {
      setError("An SOP needs a title.");
      setActive("basic");
      return false;
    }
    if (!form.ownerEmployeeId) {
      setError("An SOP needs a process owner.");
      setActive("basic");
      return false;
    }

    setSaving(true);
    setError(null);
    const r = await sopApi(`/api/sop/versions/${version.id}`, "PATCH", {
      title: form.title.trim(),
      departmentId: form.departmentId || null,
      categoryId: form.categoryId || null,
      processFunction: form.processFunction.trim() || null,
      ownerEmployeeId: form.ownerEmployeeId,
      supportingRoleIds: form.supportingRoleIds,
      confidentiality: form.confidentiality,
      reviewerId: form.reviewerId || null,
      approverId: form.approverId || null,
      purpose: form.purpose.trim() || null,
      triggerDescription: form.triggerDescription.trim() || null,
      triggerType: form.triggerType || null,
      triggerSource: form.triggerSource.trim() || null,
      triggerCondition: form.triggerCondition.trim() || null,
      qualityStandard: form.qualityStandard.trim() || null,
      reviewFrequency: form.reviewFrequency || null,
      reviewIntervalDays: form.reviewIntervalDays ? Number(form.reviewIntervalDays) : null,
      lastReviewDate: form.lastReviewDate || null,
      nextReviewDate: form.nextReviewDate || null,
      reviewOwnerEmployeeId: form.reviewOwnerEmployeeId || null,
      reviewReminderDays: Number(form.reviewReminderDays || 15),
      changeSummary: form.changeSummary.trim() || null,
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setSavedAt(new Date());
    refresh();
    return true;
  }

  /** Completeness ticks, computed here so they update as you type. */
  const complete: Record<SectionKey, boolean> = {
    basic: !!form.title.trim() && !!form.ownerEmployeeId && !!form.departmentId,
    purpose: !!form.purpose.trim(),
    trigger: !!form.triggerDescription.trim() || !!form.triggerType,
    steps: version.steps.length > 0,
    quality: !!form.qualityStandard.trim() || version.qualityCriteria.length > 0,
    exceptions: version.exceptions.length > 0,
    kpis: version.kpis.length > 0,
    review: !!form.reviewFrequency || !!form.nextReviewDate,
    attachments: version.attachments.length > 0,
  };

  return (
    <div className="grid lg:grid-cols-[15rem_1fr] gap-lg items-start">
      {/* Section navigator — a sticky rail on desktop, a scrolling chip row on
          narrow screens, where a 9-item vertical rail would eat the fold. */}
      <nav
        aria-label="SOP sections"
        className="lg:sticky lg:top-20 rounded-xl border border-outline-variant bg-surface-container-lowest p-xs overflow-x-auto"
      >
        <ul className="flex lg:flex-col gap-px min-w-max lg:min-w-0">
          {SECTIONS.map((s) => (
            <li key={s.key}>
              <a
                href={`#section-${s.key}`}
                onClick={() => setActive(s.key)}
                className={
                  "flex items-center gap-xs px-md h-10 rounded-lg text-body-md transition whitespace-nowrap " +
                  (active === s.key
                    ? "bg-surface-container-high text-on-surface font-medium"
                    : "text-on-surface-variant hover:bg-surface-container-low")
                }
              >
                <Icon name={s.icon} size={18} />
                <span className="flex-1">{s.label}</span>
                <Icon
                  name={complete[s.key] ? "check_circle" : "radio_button_unchecked"}
                  size={16}
                  className={complete[s.key] ? "text-accent" : "text-outline-variant"}
                />
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-lg min-w-0">
        {/* Sticky action bar (§26). Save Draft / Preview / Request Review /
            Cancel, plus whichever workflow action is legal from here. */}
        <div className="sticky top-16 z-20 -mx-md px-md py-sm bg-surface/95 backdrop-blur border-b border-outline-variant">
          <div className="flex flex-wrap items-center gap-xs">
            <Pill className={sopStatusClass(version.status)}>{sopStatusLabel(version.status)}</Pill>
            <span className="font-mono text-label-sm text-on-surface-variant">
              {sop.sopNumber} · {version.versionLabel}
            </span>
            {dirty && !readOnly && (
              <span className="text-caption text-error">Unsaved changes</span>
            )}
            {!dirty && savedAt && (
              <span className="text-caption text-on-surface-variant">
                Saved {savedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}

            <div className="flex-1" />

            <Link
              href={`/sop/${sop.id}?version=${version.id}`}
              className={secondaryBtn + " inline-flex items-center gap-xs"}
            >
              <Icon name="visibility" size={18} /> Preview
            </Link>

            {!readOnly && (
              <>
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => (dirty ? setConfirmLeave(true) : router.push(`/sop/${sop.id}`))}
                >
                  Cancel
                </button>
                <button type="button" className={primaryBtn} onClick={save} disabled={saving || !dirty}>
                  {saving ? "Saving…" : "Save draft"}
                </button>
              </>
            )}

            {capabilities.canRequestReview && (
              <button
                type="button"
                className={primaryBtn}
                onClick={() =>
                  setWorkflowPrompt({
                    action: "request_review",
                    title: "Request review",
                    confirmLabel: "Send for review",
                    requireComment: false,
                  })
                }
              >
                Request review
              </button>
            )}
            {capabilities.canSubmitForApproval && (
              <button
                type="button"
                className={primaryBtn}
                onClick={() =>
                  setWorkflowPrompt({
                    action: "submit_for_approval",
                    title: "Submit for approval",
                    confirmLabel: "Submit",
                    requireComment: false,
                  })
                }
              >
                Submit for approval
              </button>
            )}
            {capabilities.canReview && (
              <>
                <button
                  type="button"
                  className={dangerBtn}
                  onClick={() =>
                    setWorkflowPrompt({
                      action: "request_changes",
                      title: "Request changes",
                      confirmLabel: "Send back",
                      requireComment: true,
                    })
                  }
                >
                  Request changes
                </button>
                <button
                  type="button"
                  className={primaryBtn}
                  onClick={() =>
                    setWorkflowPrompt({
                      action: "approve_review",
                      title: "Approve review",
                      confirmLabel: "Approve review",
                      requireComment: false,
                    })
                  }
                >
                  Approve review
                </button>
              </>
            )}
            {capabilities.canApprove && (
              <>
                <button
                  type="button"
                  className={dangerBtn}
                  onClick={() =>
                    setWorkflowPrompt({
                      action: "request_changes",
                      title: "Request changes",
                      confirmLabel: "Send back",
                      requireComment: true,
                    })
                  }
                >
                  Request changes
                </button>
                <button
                  type="button"
                  className={primaryBtn}
                  onClick={() =>
                    setWorkflowPrompt({
                      action: "approve",
                      title: "Approve this SOP",
                      confirmLabel: "Approve",
                      requireComment: false,
                    })
                  }
                >
                  Approve
                </button>
              </>
            )}
            {capabilities.canPublish && (
              <button type="button" className={primaryBtn} onClick={() => setPublishing(true)}>
                Publish
              </button>
            )}
          </div>
          {error && (
            <div className="mt-sm">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>

        {readOnly && (
          <div className="rounded-xl border border-outline-variant bg-surface-container-low px-lg py-md text-body-sm text-on-surface-variant">
            <Icon name="lock" size={16} className="align-text-bottom mr-xs" />
            {version.isLocked
              ? "This version is published, so it is read-only. Create a revision to change it."
              : "You can read this version but not edit it."}
          </div>
        )}

        {/* ── Basic information ── */}
        <Section
          id="section-basic"
          title="Basic information"
          description="Who owns this process, which department runs it, and who signs it off."
        >
          <div className="grid sm:grid-cols-2 gap-md">
            <div className="sm:col-span-2">
              <Field label="SOP title" required>
                <input
                  className={inputCls}
                  value={form.title}
                  disabled={readOnly}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="e.g. Candidate Document Verification Process"
                />
              </Field>
            </div>

            <Field label="SOP ID" hint="Generated once and permanent across every revision.">
              <input className={inputCls + " font-mono"} value={sop.sopNumber} readOnly disabled />
            </Field>

            <Field label="Department" required>
              <select
                className={inputCls}
                value={form.departmentId}
                disabled={readOnly}
                onChange={(e) => set("departmentId", e.target.value)}
              >
                <option value="">Choose a department…</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="SOP category">
              <select
                className={inputCls}
                value={form.categoryId}
                disabled={readOnly}
                onChange={(e) => set("categoryId", e.target.value)}
              >
                <option value="">Uncategorised</option>
                {options.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Process / function">
              <input
                className={inputCls}
                value={form.processFunction}
                disabled={readOnly}
                onChange={(e) => set("processFunction", e.target.value)}
                placeholder="e.g. Candidate onboarding"
              />
            </Field>

            <Field label="SOP owner / process owner" required hint="From the DESGRO employee master.">
              <select
                className={inputCls}
                value={form.ownerEmployeeId}
                disabled={readOnly}
                onChange={(e) => set("ownerEmployeeId", e.target.value)}
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

            <Field label="Confidentiality" hint={CONFIDENTIALITY_HINTS[form.confidentiality]}>
              <select
                className={inputCls}
                value={form.confidentiality}
                disabled={readOnly}
                onChange={(e) => set("confidentiality", e.target.value as Confidentiality)}
              >
                {CONFIDENTIALITY_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {CONFIDENTIALITY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Reviewer" hint="Signs off the content. Must be able to sign in.">
              <select
                className={inputCls}
                value={form.reviewerId}
                disabled={readOnly}
                onChange={(e) => set("reviewerId", e.target.value)}
              >
                <option value="">No reviewer — go straight to approval</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Approver" hint="The final sign-off before it can be published.">
              <select
                className={inputCls}
                value={form.approverId}
                disabled={readOnly}
                onChange={(e) => set("approverId", e.target.value)}
              >
                <option value="">Not chosen yet</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Created by">
              <input className={inputCls} value={version.createdBy ?? "—"} readOnly disabled />
            </Field>

            <div className="sm:col-span-2">
              <Field
                label="Supporting team / responsible roles"
                hint="Everyone involved in running this process, beyond the owner."
              >
                <div className="flex flex-wrap gap-xs">
                  {options.hrRoles.length === 0 && (
                    <span className="text-caption text-on-surface-variant">
                      No roles in the HR role master yet.
                    </span>
                  )}
                  {options.hrRoles.map((r) => {
                    const on = form.supportingRoleIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={readOnly}
                        onClick={() =>
                          set(
                            "supportingRoleIds",
                            on
                              ? form.supportingRoleIds.filter((id) => id !== r.id)
                              : [...form.supportingRoleIds, r.id],
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

        {/* ── Purpose ── */}
        <Section
          id="section-purpose"
          title="Purpose"
          description="Why does this process exist and what outcome should it achieve?"
        >
          <RichTextInput
            value={form.purpose}
            disabled={readOnly}
            onChange={(v) => set("purpose", v)}
            rows={7}
            placeholder="Explain the outcome this process is responsible for."
          />
        </Section>

        {/* ── Trigger ── */}
        <Section
          id="section-trigger"
          title="Trigger"
          description="What event starts this process. The structured fields below are stored for the automation phase — nothing runs from them yet."
        >
          <div className="space-y-md">
            <Field label="Trigger description">
              <textarea
                rows={3}
                className={taCls}
                value={form.triggerDescription}
                disabled={readOnly}
                onChange={(e) => set("triggerDescription", e.target.value)}
                placeholder="e.g. Candidate submits all mandatory documents and the application status changes to Documents Submitted."
              />
            </Field>

            <div className="grid sm:grid-cols-3 gap-md">
              <Field label="Trigger type">
                <select
                  className={inputCls}
                  value={form.triggerType}
                  disabled={readOnly}
                  onChange={(e) => set("triggerType", e.target.value)}
                >
                  <option value="">Not set</option>
                  {TRIGGER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Trigger source" hint="Which system or record the trigger watches.">
                <input
                  className={inputCls}
                  value={form.triggerSource}
                  disabled={readOnly}
                  onChange={(e) => set("triggerSource", e.target.value)}
                  placeholder="e.g. CRM lead"
                />
              </Field>
              <Field label="Trigger condition">
                <input
                  className={inputCls}
                  value={form.triggerCondition}
                  disabled={readOnly}
                  onChange={(e) => set("triggerCondition", e.target.value)}
                  placeholder="e.g. status = Documents Submitted"
                />
              </Field>
            </div>
          </div>
        </Section>

        {/* ── Steps ── */}
        <Section
          id="section-steps"
          title="Process steps"
          description="Each step names who is responsible and how long it should take. Drag to reorder, or use the arrows."
        >
          <StepBuilder
            versionId={version.id}
            steps={version.steps}
            options={options}
            readOnly={readOnly}
            onChanged={refresh}
          />
        </Section>

        {/* ── Quality ── */}
        <Section
          id="section-quality"
          title="Quality standard / definition of done"
          description="What has to be true for the work to count as correctly done."
        >
          <div className="space-y-lg">
            <Field label="Quality standard description">
              <RichTextInput
                value={form.qualityStandard}
                disabled={readOnly}
                onChange={(v) => set("qualityStandard", v)}
                rows={4}
              />
            </Field>
            <QualitySection
              versionId={version.id}
              criteria={version.qualityCriteria}
              readOnly={readOnly}
              onChanged={refresh}
            />
          </div>
        </Section>

        {/* ── Exceptions ── */}
        <Section
          id="section-exceptions"
          title="Exceptions & escalations"
          description="What goes wrong, what to do about it, and who to escalate to."
        >
          <ExceptionSection
            versionId={version.id}
            exceptions={version.exceptions}
            options={options}
            readOnly={readOnly}
            onChanged={refresh}
          />
        </Section>

        {/* ── KPIs ── */}
        <Section
          id="section-kpis"
          title="KPIs & performance"
          description="The measures that say whether this process is working."
        >
          <KpiSection
            versionId={version.id}
            kpis={version.kpis}
            options={options}
            readOnly={readOnly}
            canRecord={capabilities.canRecordKpi}
            onChanged={refresh}
          />
        </Section>

        {/* ── Review schedule ── */}
        <Section
          id="section-review"
          title="Review settings"
          description="How often this SOP is revisited. The next review date is calculated from the frequency unless you set one yourself."
        >
          <div className="grid sm:grid-cols-2 gap-md">
            <Field label="Review frequency">
              <select
                className={inputCls}
                value={form.reviewFrequency}
                disabled={readOnly}
                onChange={(e) => set("reviewFrequency", e.target.value)}
              >
                <option value="">Not scheduled</option>
                {REVIEW_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {REVIEW_FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </Field>

            {form.reviewFrequency === "custom" && (
              <Field label="Custom interval (days)" required>
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={form.reviewIntervalDays}
                  disabled={readOnly}
                  onChange={(e) => set("reviewIntervalDays", e.target.value)}
                />
              </Field>
            )}

            <Field label="Last review date">
              <input
                type="date"
                className={inputCls}
                value={form.lastReviewDate}
                disabled={readOnly}
                onChange={(e) => set("lastReviewDate", e.target.value)}
              />
            </Field>

            <Field label="Next review date" hint="Recalculated when you change the frequency.">
              <input
                type="date"
                className={inputCls}
                value={form.nextReviewDate}
                disabled={readOnly}
                onChange={(e) => set("nextReviewDate", e.target.value)}
              />
            </Field>

            <Field label="Review owner">
              <select
                className={inputCls}
                value={form.reviewOwnerEmployeeId}
                disabled={readOnly}
                onChange={(e) => set("reviewOwnerEmployeeId", e.target.value)}
              >
                <option value="">Same as the process owner</option>
                {options.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Review reminder" hint="How far ahead the SOP is flagged as due.">
              <select
                className={inputCls}
                value={form.reviewReminderDays}
                disabled={readOnly}
                onChange={(e) => set("reviewReminderDays", e.target.value)}
              >
                {REVIEW_REMINDER_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} days before
                  </option>
                ))}
                {!REVIEW_REMINDER_OPTIONS.includes(
                  Number(form.reviewReminderDays) as (typeof REVIEW_REMINDER_OPTIONS)[number],
                ) && <option value={form.reviewReminderDays}>{form.reviewReminderDays} days before</option>}
              </select>
            </Field>

            <div className="sm:col-span-2">
              <Field
                label="Change summary"
                hint="What changed in this version. Shown in the version history."
              >
                <input
                  className={inputCls}
                  value={form.changeSummary}
                  disabled={readOnly}
                  onChange={(e) => set("changeSummary", e.target.value)}
                  placeholder="e.g. SLA updated on steps 2 and 4"
                />
              </Field>
            </div>
          </div>
        </Section>

        {/* ── Attachments ── */}
        <Section
          id="section-attachments"
          title="Related documents"
          description="Forms, checklists, templates, policies, training material and external links."
        >
          <AttachmentSection
            versionId={version.id}
            attachments={version.attachments}
            readOnly={readOnly}
            onChanged={refresh}
          />
        </Section>
      </div>

      {confirmLeave && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          tone="danger"
          confirmLabel="Discard changes"
          message="You have edits that have not been saved. Leaving now loses them."
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            setForm(initial);
            router.push(`/sop/${sop.id}`);
          }}
        />
      )}

      {workflowPrompt && (
        <WorkflowDialog
          versionId={version.id}
          prompt={workflowPrompt}
          dirty={dirty}
          onSaveFirst={save}
          onClose={() => setWorkflowPrompt(null)}
          onDone={() => {
            setWorkflowPrompt(null);
            refresh();
          }}
        />
      )}

      {publishing && (
        <PublishDialog
          version={version}
          options={options}
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false);
            router.push(`/sop/${sop.id}`);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * The confirmation step for a workflow transition.
 *
 * It saves any pending edits first: sending a version for review with unsaved
 * changes still in the browser is the single most obvious way for a reviewer to
 * read the wrong document.
 */
function WorkflowDialog({
  versionId,
  prompt,
  dirty,
  onSaveFirst,
  onClose,
  onDone,
}: {
  versionId: string;
  prompt: {
    action: string;
    title: string;
    confirmLabel: string;
    requireComment: boolean;
  };
  dirty: boolean;
  onSaveFirst: () => Promise<boolean>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);

  async function go() {
    if (submitted.current) return;
    if (prompt.requireComment && !comments.trim()) {
      setError("Say what needs changing — the author only sees what you write here.");
      return;
    }
    setBusy(true);
    setError(null);

    if (dirty) {
      const saved = await onSaveFirst();
      if (!saved) {
        setBusy(false);
        setError("Your unsaved changes could not be saved, so nothing was submitted.");
        return;
      }
    }

    const r = await sopApi(`/api/sop/versions/${versionId}/workflow`, "POST", {
      action: prompt.action,
      comments: comments.trim() || null,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    submitted.current = true;
    onDone();
  }

  return (
    <Modal
      title={prompt.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} onClick={go} disabled={busy}>
            {busy ? "Working…" : prompt.confirmLabel}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {dirty && (
        <p className="text-body-sm text-on-surface-variant">
          Your unsaved changes will be saved first.
        </p>
      )}
      <Field
        label={prompt.requireComment ? "What needs changing?" : "Comments (optional)"}
        required={prompt.requireComment}
      >
        <textarea rows={4} className={taCls} value={comments} onChange={(e) => setComments(e.target.value)} />
      </Field>
    </Modal>
  );
}
