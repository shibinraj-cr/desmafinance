"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  WORK_TYPES,
  WORK_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  SENIORITIES,
  SENIORITY_LABELS,
  ANSWER_TYPES,
  ANSWER_TYPE_LABELS,
  DEFAULT_RUBRIC,
  DEFAULT_SCREENING_QUESTIONS,
  type WorkType,
  type EmploymentType,
  type Seniority,
  type AnswerType,
  type ResumeMode,
} from "@/lib/hiring/constants";
import { compBandLabel, validateJobForPublish } from "@/lib/hiring/core";
import { Markdown } from "@/components/hiring/Markdown";

type Lite = { id: string; name?: string; username?: string };
type JobRoleLite = { id: string; title: string; department: string; defaultSeniority: string };

type QuestionDraft = {
  key: string;
  prompt: string;
  helperText: string;
  answerType: AnswerType;
  required: boolean;
  options: string;
};
type RubricDraft = { criterion: string; description: string; weight: number };

type BasicsProps = {
  title: string;
  setTitle: (v: string) => void;
  department: string;
  setDepartment: (v: string) => void;
  departments: string[];
  jobRoles: JobRoleLite[];
  jobRoleId: string;
  applyJobRole: (id: string) => void;
  locations: Lite[];
  locationId: string;
  setLocationId: (v: string) => void;
  workType: WorkType;
  setWorkType: (v: WorkType) => void;
  employmentType: EmploymentType;
  setEmploymentType: (v: EmploymentType) => void;
  seniority: Seniority;
  setSeniority: (v: Seniority) => void;
  compMin: string;
  setCompMin: (v: string) => void;
  compMax: string;
  setCompMax: (v: string) => void;
  compVisible: boolean;
  setCompVisible: (v: boolean) => void;
  openings: string;
  setOpenings: (v: string) => void;
  users: Lite[];
  ownerId: string;
  setOwnerId: (v: string) => void;
  hiringManagerId: string;
  setHiringManagerId: (v: string) => void;
  compLabel: string | null;
};

type DescriptionProps = {
  descriptionMd: string;
  setDescriptionMd: (v: string) => void;
  mustHaves: string[];
  setMustHaves: (fn: (prev: string[]) => string[]) => void;
  niceToHaves: string[];
  setNiceToHaves: (fn: (prev: string[]) => string[]) => void;
  outline: string;
  setOutline: (v: string) => void;
  preview: boolean;
  setPreview: (v: boolean) => void;
  aiEnabled: boolean;
  creditsRemaining: number;
  busy: string | null;
  draftWithAi: () => void;
  canDraft: boolean;
};

type QuestionsProps = {
  resumeMode: ResumeMode;
  setResumeMode: (v: ResumeMode) => void;
  askScreeningQs: boolean;
  setAskScreeningQs: (v: boolean) => void;
  questions: QuestionDraft[];
  setQuestions: (fn: (prev: QuestionDraft[]) => QuestionDraft[]) => void;
};

type ReviewProps = {
  title: string;
  department: string;
  compLabel: string | null;
  questions: QuestionDraft[];
  rubrics: RubricDraft[];
  mustHaves: string[];
  niceToHaves: string[];
  readiness: { ready: boolean; blockers: string[] };
  approvalRequired: boolean;
  setApprovalRequired: (v: boolean) => void;
};

const STEPS = ["Basics", "Description", "Questions", "Rubric", "Review"] as const;

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition";
const taCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition font-mono";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: size }} aria-hidden>
      {name}
    </span>
  );
}

let keySeq = 0;
const nextKey = () => `q${++keySeq}`;

export function WizardClient({
  locations,
  jobRoles,
  users,
  departments,
  currentUserId,
  aiEnabled,
  creditsRemaining,
}: {
  locations: Lite[];
  jobRoles: JobRoleLite[];
  users: Lite[];
  departments: string[];
  currentUserId: string;
  aiEnabled: boolean;
  creditsRemaining: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[] | null>(null);

  // Step 1
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [jobRoleId, setJobRoleId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [workType, setWorkType] = useState<WorkType>("onsite");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  const [seniority, setSeniority] = useState<Seniority>("mid");
  const [compMin, setCompMin] = useState("");
  const [compMax, setCompMax] = useState("");
  const [compVisible, setCompVisible] = useState(true);
  const [openings, setOpenings] = useState("1");
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [hiringManagerId, setHiringManagerId] = useState("");

  // Step 2
  const [descriptionMd, setDescriptionMd] = useState("");
  const [mustHaves, setMustHaves] = useState<string[]>([]);
  const [niceToHaves, setNiceToHaves] = useState<string[]>([]);
  const [outline, setOutline] = useState("");
  const [preview, setPreview] = useState(false);

  // Step 3
  const [resumeMode, setResumeMode] = useState<ResumeMode>("required");
  const [askScreeningQs, setAskScreeningQs] = useState(true);
  const [questions, setQuestions] = useState<QuestionDraft[]>(() =>
    DEFAULT_SCREENING_QUESTIONS.map((q) => ({
      key: nextKey(),
      prompt: q.prompt,
      helperText: q.helperText ?? "",
      answerType: q.answerType,
      required: q.required,
      options: "",
    })),
  );

  // Step 4
  const [rubrics, setRubrics] = useState<RubricDraft[]>(() =>
    DEFAULT_RUBRIC.map((r) => ({ criterion: r.criterion, description: r.description, weight: r.weight })),
  );

  // Step 5
  const [approvalRequired, setApprovalRequired] = useState(false);

  const weightTotal = rubrics.reduce((s, r) => s + r.weight, 0);
  const compLabel = compBandLabel(numOrNull(compMin), numOrNull(compMax));

  const readiness = useMemo(
    () =>
      validateJobForPublish({
        title,
        descriptionMd: descriptionMd || null,
        mustHaves,
        rubrics: rubrics.map((r) => ({ weight: r.weight })),
      }),
    [title, descriptionMd, mustHaves, rubrics],
  );

  const canLeaveBasics = title.trim().length >= 2 && department.trim().length >= 1;

  function applyJobRole(id: string) {
    setJobRoleId(id);
    const role = jobRoles.find((r) => r.id === id);
    if (!role) return;
    setTitle(role.title);
    setDepartment(role.department);
    setSeniority(role.defaultSeniority as Seniority);
  }

  async function draftWithAi() {
    setBusy("ai");
    setError(null);
    const res = await fetch("/api/hiring/jobs/ai-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        department,
        seniority,
        workType,
        employmentType,
        locationName: locations.find((l) => l.id === locationId)?.name ?? null,
        compMinLakh: numOrNull(compMin),
        compMaxLakh: numOrNull(compMax),
        outline: outline.trim() || null,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "The draft could not be generated.");
      return;
    }
    const { draft } = (await res.json()) as {
      draft: { descriptionMd: string; mustHaves: string[]; niceToHaves: string[] };
    };
    setDescriptionMd(draft.descriptionMd);
    // Merge rather than replace: a recruiter who already typed a must-have
    // should not lose it to the draft.
    setMustHaves((prev) => mergeChips(prev, draft.mustHaves));
    setNiceToHaves((prev) => mergeChips(prev, draft.niceToHaves));
  }

  async function save(publish: boolean) {
    setBusy(publish ? "publish" : "draft");
    setError(null);
    setBlockers(null);

    const body = {
      title: title.trim(),
      department: department.trim(),
      jobRoleId: jobRoleId || null,
      locationId: locationId || null,
      workType,
      employmentType,
      seniority,
      compMinLakh: numOrNull(compMin),
      compMaxLakh: numOrNull(compMax),
      compVisible,
      descriptionMd: descriptionMd || null,
      mustHaves,
      niceToHaves,
      openings: Number(openings) || 1,
      ownerId: ownerId || null,
      hiringManagerId: hiringManagerId || null,
      approvalRequired,
      resumeMode,
      askScreeningQs,
      questions: askScreeningQs
        ? questions
            .filter((q) => q.prompt.trim())
            .map((q) => ({
              prompt: q.prompt.trim(),
              helperText: q.helperText.trim() || null,
              answerType: q.answerType,
              required: q.required,
              options: q.options.trim()
                ? q.options.split(",").map((o) => o.trim()).filter(Boolean)
                : undefined,
            }))
        : [],
      rubrics: rubrics.map((r) => ({
        criterion: r.criterion.trim(),
        description: r.description.trim() || null,
        weight: r.weight,
      })),
      publish,
    };

    const res = await fetch("/api/hiring/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);

    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; issues?: { message: string }[] };
      setError(d.message ?? d.issues?.[0]?.message ?? "The requisition could not be saved.");
      return;
    }

    const data = (await res.json()) as {
      job: { id: string };
      outcome?: { published: boolean; status: string; blockers?: string[] };
    };

    // A job that is not ready comes back as a draft WITH its reasons. It is
    // saved either way — the work is never lost.
    if (data.outcome && !data.outcome.published && data.outcome.blockers?.length) {
      setBlockers(data.outcome.blockers);
      return;
    }
    router.push(`/hiring/jobs/${data.job.id}`);
  }

  return (
    <div className="max-w-4xl space-y-lg">
      <Stepper step={step} onStep={(i) => (i < step || canLeaveBasics ? setStep(i) : null)} />

      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      {blockers && (
        <div className="rounded-xl border border-outline-variant bg-primary-fixed/40 p-lg">
          <h3 className="text-h3 text-on-surface mb-xs">Saved as a draft</h3>
          <p className="text-body-md text-on-surface-variant mb-sm">
            The requisition is saved — it just is not ready to go live yet:
          </p>
          <ul className="list-disc pl-lg space-y-xs text-body-md text-on-surface">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="mt-md flex gap-xs">
            <button type="button" className={secondaryBtn} onClick={() => setBlockers(null)}>
              Keep editing
            </button>
            <Link href="/hiring/jobs?tab=drafts" className={primaryBtn}>
              Go to drafts
            </Link>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
        {step === 0 && (
          <StepBasics
            {...{
              title, setTitle, department, setDepartment, departments, jobRoles, jobRoleId, applyJobRole,
              locations, locationId, setLocationId, workType, setWorkType, employmentType, setEmploymentType,
              seniority, setSeniority, compMin, setCompMin, compMax, setCompMax, compVisible, setCompVisible,
              openings, setOpenings, users, ownerId, setOwnerId, hiringManagerId, setHiringManagerId, compLabel,
            }}
          />
        )}

        {step === 1 && (
          <StepDescription
            {...{
              descriptionMd, setDescriptionMd, mustHaves, setMustHaves, niceToHaves, setNiceToHaves,
              outline, setOutline, preview, setPreview, aiEnabled, creditsRemaining,
              busy, draftWithAi, canDraft: canLeaveBasics,
            }}
          />
        )}

        {step === 2 && (
          <StepQuestions
            {...{ resumeMode, setResumeMode, askScreeningQs, setAskScreeningQs, questions, setQuestions }}
          />
        )}

        {step === 3 && <StepRubric rubrics={rubrics} setRubrics={setRubrics} weightTotal={weightTotal} />}

        {step === 4 && (
          <StepReview
            {...{
              title, department, compLabel, questions: askScreeningQs ? questions : [], rubrics,
              mustHaves, niceToHaves, readiness, approvalRequired, setApprovalRequired,
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-md">
        <button
          type="button"
          className={secondaryBtn}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Back
        </button>

        <div className="flex items-center gap-xs">
          {step === STEPS.length - 1 ? (
            <>
              <button type="button" className={secondaryBtn} onClick={() => save(false)} disabled={busy !== null || !canLeaveBasics}>
                {busy === "draft" ? "Saving…" : "Save as draft"}
              </button>
              <button type="button" className={primaryBtn} onClick={() => save(true)} disabled={busy !== null || !canLeaveBasics}>
                {busy === "publish" ? "Publishing…" : approvalRequired ? "Send for approval" : "Publish job"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={primaryBtn}
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={step === 0 && !canLeaveBasics}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step, onStep }: { step: number; onStep: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap gap-xs" aria-label="Wizard steps">
      {STEPS.map((label, i) => (
        <li key={label}>
          <button
            type="button"
            onClick={() => onStep(i)}
            aria-current={i === step ? "step" : undefined}
            className={
              "h-9 px-md rounded-full text-label-sm border transition inline-flex items-center gap-xs " +
              (i === step
                ? "bg-primary text-on-primary border-primary"
                : i < step
                  ? "border-outline-variant text-on-surface hover:bg-surface-container-low"
                  : "border-outline-variant text-on-surface-variant opacity-70")
            }
          >
            <span className="tabular-nums">{i + 1}</span>
            {label}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
      {hint && <span className="block text-caption text-on-surface-variant mt-xs">{hint}</span>}
    </label>
  );
}

function StepBasics(p: BasicsProps) {
  return (
    <div className="space-y-lg">
      <div>
        <h2 className="text-h3 text-on-surface">Basics</h2>
        <p className="text-body-sm text-on-surface-variant">
          Pick an existing job title where you can — every picker reads the same list, so the same
          role stays spelled the same way in analytics.
        </p>
      </div>

      {p.jobRoles.length > 0 && (
        <Field label="Existing job title" hint="Choosing one fills in the department and seniority.">
          <select className={inputCls} value={p.jobRoleId} onChange={(e) => p.applyJobRole(e.target.value)}>
            <option value="">Write a new title…</option>
            {p.jobRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} · {r.department}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid gap-md sm:grid-cols-2">
        <Field label="Job title">
          <input className={inputCls} value={p.title} onChange={(e) => p.setTitle(e.target.value)} maxLength={140} />
        </Field>
        <Field label="Department">
          <input className={inputCls} value={p.department} onChange={(e) => p.setDepartment(e.target.value)} list="wizard-departments" maxLength={80} />
          <datalist id="wizard-departments">
            {p.departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid gap-md sm:grid-cols-3">
        <Field label="Place">
          <select className={inputCls} value={p.locationId} onChange={(e) => p.setLocationId(e.target.value)}>
            <option value="">Not stated</option>
            {p.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Work type">
          <select className={inputCls} value={p.workType} onChange={(e) => p.setWorkType(e.target.value as WorkType)}>
            {WORK_TYPES.map((w) => (
              <option key={w} value={w}>
                {WORK_TYPE_LABELS[w]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Employment type">
          <select className={inputCls} value={p.employmentType} onChange={(e) => p.setEmploymentType(e.target.value as EmploymentType)}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-md sm:grid-cols-4">
        <Field label="Seniority">
          <select className={inputCls} value={p.seniority} onChange={(e) => p.setSeniority(e.target.value as Seniority)}>
            {SENIORITIES.map((s) => (
              <option key={s} value={s}>
                {SENIORITY_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Comp from (₹ lakh/yr)">
          <input className={inputCls} type="number" min={0} step="0.25" value={p.compMin} onChange={(e) => p.setCompMin(e.target.value)} />
        </Field>
        <Field label="Comp to (₹ lakh/yr)">
          <input className={inputCls} type="number" min={0} step="0.25" value={p.compMax} onChange={(e) => p.setCompMax(e.target.value)} />
        </Field>
        <Field label="Openings">
          <input className={inputCls} type="number" min={1} max={500} value={p.openings} onChange={(e) => p.setOpenings(e.target.value)} />
        </Field>
      </div>

      <label className="flex items-center gap-xs text-body-md text-on-surface">
        <input type="checkbox" className="accent-primary" checked={p.compVisible} onChange={(e) => p.setCompVisible(e.target.checked)} />
        Show the band {p.compLabel ? <span className="text-accent font-semibold">({p.compLabel})</span> : null} on the public careers page
      </label>

      <div className="grid gap-md sm:grid-cols-2">
        <Field label="Owner" hint="Who runs this req day to day.">
          <select className={inputCls} value={p.ownerId} onChange={(e) => p.setOwnerId(e.target.value)}>
            {p.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hiring manager" hint="Whoever is named here can review this req's candidates and submit scorecards, whatever their role.">
          <select className={inputCls} value={p.hiringManagerId} onChange={(e) => p.setHiringManagerId(e.target.value)}>
            <option value="">Nobody yet</option>
            {p.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

function StepDescription(p: DescriptionProps) {
  return (
    <div className="space-y-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div>
          <h2 className="text-h3 text-on-surface">Description</h2>
          <p className="text-body-sm text-on-surface-variant">
            What the person will actually do, and what good looks like. Markdown.
          </p>
        </div>
        <div className="flex items-center gap-xs">
          <button
            type="button"
            className={secondaryBtn + " inline-flex items-center gap-xs"}
            onClick={() => p.setPreview(!p.preview)}
          >
            <Icon name={p.preview ? "edit" : "visibility"} size={16} />
            {p.preview ? "Edit" : "Preview"}
          </button>
          <button
            type="button"
            className={primaryBtn + " inline-flex items-center gap-xs"}
            onClick={p.draftWithAi}
            disabled={!p.aiEnabled || p.busy === "ai" || !p.canDraft}
            title={
              !p.aiEnabled
                ? "No AI key is configured — write the draft yourself."
                : !p.canDraft
                  ? "Fill in the title and department first."
                  : undefined
            }
          >
            <Icon name="auto_awesome" size={16} />
            {p.busy === "ai" ? "Writing…" : "Let AI write the first draft"}
          </button>
        </div>
      </div>

      {!p.aiEnabled && (
        <p className="text-caption text-on-surface-variant">
          AI drafting is off because no API key is configured. Everything else about the job works.
        </p>
      )}
      {p.aiEnabled && p.creditsRemaining < 30 && (
        <p className="text-caption text-error">
          {p.creditsRemaining} AI credits left — a draft costs 30. Raise the budget in Hiring settings.
        </p>
      )}

      {!p.descriptionMd && (
        <Field label="Or start from an outline" hint="A few bullets is enough for the draft to work from.">
          <textarea className={taCls} rows={3} value={p.outline} onChange={(e) => p.setOutline(e.target.value)} />
        </Field>
      )}

      {p.preview ? (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-lg min-h-[200px]">
          {p.descriptionMd ? (
            <Markdown source={p.descriptionMd} />
          ) : (
            <p className="text-body-sm text-on-surface-variant">Nothing to preview yet.</p>
          )}
        </div>
      ) : (
        <Field label="Job description (markdown)">
          <textarea className={taCls} rows={14} value={p.descriptionMd} onChange={(e) => p.setDescriptionMd(e.target.value)} />
        </Field>
      )}

      <ChipList
        label="Must-haves"
        hint="Screen-out criteria. An application showing no evidence of one is FLAGGED for you — never auto-rejected."
        chips={p.mustHaves}
        setChips={p.setMustHaves}
      />
      <ChipList
        label="Nice-to-haves"
        hint="A bonus, not a requirement."
        chips={p.niceToHaves}
        setChips={p.setNiceToHaves}
      />
    </div>
  );
}

function ChipList({
  label,
  hint,
  chips,
  setChips,
}: {
  label: string;
  hint: string;
  chips: string[];
  setChips: (fn: (prev: string[]) => string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v) return;
    setChips((prev) => (prev.some((c) => c.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v]));
    setDraft("");
  }
  return (
    <div>
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      <div className="flex flex-wrap gap-xs mb-sm">
        {chips.length === 0 && <span className="text-caption text-on-surface-variant">None yet.</span>}
        {chips.map((c) => (
          <span key={c} className="inline-flex items-center gap-xs h-8 pl-md pr-xs rounded-full bg-surface-container text-label-sm text-on-surface">
            {c}
            <button
              type="button"
              aria-label={`Remove ${c}`}
              className="h-6 w-6 inline-flex items-center justify-center rounded-full hover:bg-surface-container-highest"
              onClick={() => setChips((prev) => prev.filter((x) => x !== c))}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-xs">
        <input
          className={inputCls + " max-w-xs"}
          value={draft}
          placeholder="Add one and press Enter"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={secondaryBtn} onClick={add}>
          Add
        </button>
      </div>
      <p className="text-caption text-on-surface-variant mt-xs">{hint}</p>
    </div>
  );
}

function StepQuestions(p: QuestionsProps) {
  const questions = p.questions;
  const set = p.setQuestions;

  return (
    <div className="space-y-lg">
      <div>
        <h2 className="text-h3 text-on-surface">The application form</h2>
        <p className="text-body-sm text-on-surface-variant">What a candidate is asked when they apply.</p>
      </div>

      <fieldset>
        <legend className="text-label-sm text-on-surface-variant mb-xs">Résumé</legend>
        <div className="space-y-xs">
          {(
            [
              ["required", "Ask for a résumé or a portfolio link — one of the two is required"],
              ["optional", "Ask, but let them skip it"],
              ["skip", "Don't ask at all"],
            ] as [ResumeMode, string][]
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-xs text-body-md text-on-surface">
              <input
                type="radio"
                name="resumeMode"
                className="accent-primary"
                checked={p.resumeMode === value}
                onChange={() => p.setResumeMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-xs text-body-md text-on-surface">
        <input type="checkbox" className="accent-primary" checked={p.askScreeningQs} onChange={(e) => p.setAskScreeningQs(e.target.checked)} />
        Include screening questions
      </label>

      {p.askScreeningQs && (
        <div className="space-y-md">
          {questions.map((q, i) => (
            <div key={q.key} className="rounded-lg border border-outline-variant p-md space-y-sm">
              <div className="flex items-start gap-sm">
                <span className="text-label-sm text-on-surface-variant mt-sm tabular-nums">{i + 1}.</span>
                <div className="flex-1 space-y-sm">
                  <input
                    className={inputCls}
                    value={q.prompt}
                    placeholder="The question"
                    onChange={(e) => set((prev) => prev.map((x) => (x.key === q.key ? { ...x, prompt: e.target.value } : x)))}
                  />
                  <input
                    className={inputCls}
                    value={q.helperText}
                    placeholder="Helper text (optional)"
                    onChange={(e) => set((prev) => prev.map((x) => (x.key === q.key ? { ...x, helperText: e.target.value } : x)))}
                  />
                  <div className="flex flex-wrap items-center gap-sm">
                    <select
                      className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
                      value={q.answerType}
                      aria-label="Answer type"
                      onChange={(e) => set((prev) => prev.map((x) => (x.key === q.key ? { ...x, answerType: e.target.value as AnswerType } : x)))}
                    >
                      {ANSWER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ANSWER_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-xs text-body-sm text-on-surface-variant">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={q.required}
                        onChange={(e) => set((prev) => prev.map((x) => (x.key === q.key ? { ...x, required: e.target.checked } : x)))}
                      />
                      Required
                    </label>
                    <div className="ml-auto flex items-center gap-xs">
                      <button type="button" aria-label="Move up" className={secondaryBtn + " !h-8 !px-sm"} disabled={i === 0} onClick={() => set((prev) => swap(prev, i, i - 1))}>
                        <Icon name="arrow_upward" size={16} />
                      </button>
                      <button type="button" aria-label="Move down" className={secondaryBtn + " !h-8 !px-sm"} disabled={i === questions.length - 1} onClick={() => set((prev) => swap(prev, i, i + 1))}>
                        <Icon name="arrow_downward" size={16} />
                      </button>
                      <button type="button" aria-label="Delete question" className={secondaryBtn + " !h-8 !px-sm"} onClick={() => set((prev) => prev.filter((x) => x.key !== q.key))}>
                        <Icon name="delete" size={16} />
                      </button>
                    </div>
                  </div>
                  {(q.answerType === "single_select" || q.answerType === "multi_select") && (
                    <input
                      className={inputCls}
                      value={q.options}
                      placeholder="Options, comma separated"
                      onChange={(e) => set((prev) => prev.map((x) => (x.key === q.key ? { ...x, options: e.target.value } : x)))}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            className={secondaryBtn + " inline-flex items-center gap-xs"}
            onClick={() =>
              set((prev) => [
                ...prev,
                { key: nextKey(), prompt: "", helperText: "", answerType: "short_text", required: false, options: "" },
              ])
            }
          >
            <Icon name="add" size={16} /> Add a question
          </button>
        </div>
      )}
    </div>
  );
}

/** Sample candidates for the re-rank preview. Invented, and labelled as such. */
const SAMPLE = [
  { name: "Sample A", scores: [4, 2, 3, 4] },
  { name: "Sample B", scores: [2, 4, 4, 3] },
  { name: "Sample C", scores: [3, 3, 2, 2] },
];

function StepRubric({
  rubrics,
  setRubrics,
  weightTotal,
}: {
  rubrics: RubricDraft[];
  setRubrics: (fn: (prev: RubricDraft[]) => RubricDraft[]) => void;
  weightTotal: number;
}) {
  const ranked = useMemo(() => {
    return SAMPLE.map((s) => ({
      name: s.name,
      // 1-4 per criterion, weighted, expressed out of 100.
      score: Math.round(
        rubrics.reduce((sum, r, i) => sum + ((s.scores[i] ?? 3) / 4) * r.weight, 0),
      ),
    })).sort((a, b) => b.score - a.score);
  }, [rubrics]);

  return (
    <div className="space-y-lg">
      <div>
        <h2 className="text-h3 text-on-surface">Scoring rubric</h2>
        <p className="text-body-sm text-on-surface-variant">
          What the score means. Weights must total 100% before the job can go live.
        </p>
      </div>

      <div className="space-y-md">
        {rubrics.map((r, i) => (
          <div key={i} className="rounded-lg border border-outline-variant p-md">
            <div className="flex flex-wrap items-center gap-sm mb-xs">
              <input
                className="flex-1 min-w-[12rem] h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
                value={r.criterion}
                aria-label={`Criterion ${i + 1}`}
                onChange={(e) => setRubrics((prev) => prev.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)))}
              />
              <span className="text-body-md text-on-surface tabular-nums w-12 text-right">{r.weight}%</span>
              <button
                type="button"
                aria-label={`Remove ${r.criterion}`}
                className={secondaryBtn + " !h-8 !px-sm"}
                onClick={() => setRubrics((prev) => prev.filter((_, j) => j !== i))}
              >
                <Icon name="delete" size={16} />
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={r.weight}
              aria-label={`${r.criterion} weight`}
              className="w-full accent-primary"
              onChange={(e) => setRubrics((prev) => prev.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
            />
            <input
              className="w-full h-9 px-sm mt-xs rounded-lg border border-outline-variant bg-surface-container-lowest text-body-sm"
              value={r.description}
              placeholder="What this criterion means"
              onChange={(e) => setRubrics((prev) => prev.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-md">
        <button
          type="button"
          className={secondaryBtn + " inline-flex items-center gap-xs"}
          onClick={() => setRubrics((prev) => [...prev, { criterion: "New criterion", description: "", weight: 0 }])}
        >
          <Icon name="add" size={16} /> Add a criterion
        </button>
        <div className={"text-body-md font-semibold " + (weightTotal === 100 ? "text-accent" : "text-error")}>
          Total {weightTotal}%{weightTotal === 100 ? " ✓" : ` — needs to be 100%`}
        </div>
      </div>

      <section className="rounded-lg border border-outline-variant bg-surface-container-low p-md">
        <h3 className="text-body-lg font-semibold text-on-surface mb-xs">Re-rank preview</h3>
        <p className="text-caption text-on-surface-variant mb-sm">
          <strong>These are made-up candidates</strong>, not real applicants. They are here to show how
          changing a weight reshuffles a ranking.
        </p>
        <ol className="space-y-xs">
          {ranked.map((r, i) => (
            <li key={r.name} className="flex items-center gap-sm text-body-md">
              <span className="text-on-surface-variant tabular-nums w-6">{i + 1}.</span>
              <span className="text-on-surface w-24">{r.name}</span>
              <span className="flex-1 h-2 rounded-full bg-surface-container overflow-hidden">
                <span className="block h-full bg-primary" style={{ width: `${Math.min(100, r.score)}%` }} />
              </span>
              <span className="tabular-nums text-on-surface-variant w-10 text-right">{r.score}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function StepReview(p: ReviewProps) {
  const readiness = p.readiness;
  return (
    <div className="space-y-lg">
      <div>
        <h2 className="text-h3 text-on-surface">Review</h2>
        <p className="text-body-sm text-on-surface-variant">One last look before this goes anywhere.</p>
      </div>

      <dl className="grid gap-md sm:grid-cols-2">
        <Summary label="Role" value={`${p.title || "Untitled"} · ${p.department || "no department"}`} />
        <Summary label="Compensation" value={p.compLabel ?? "Not stated"} />
        <Summary label="Screening questions" value={`${p.questions.length}`} />
        <Summary label="Rubric criteria" value={`${p.rubrics.length}`} />
        <Summary label="Must-haves" value={p.mustHaves.length ? p.mustHaves.join(", ") : "None"} />
        <Summary label="Nice-to-haves" value={p.niceToHaves.length ? p.niceToHaves.join(", ") : "None"} />
      </dl>

      {readiness.ready ? (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md text-body-md text-on-surface">
          <span className="text-accent font-semibold">Ready to publish.</span> Publishing puts this
          role on the public careers page immediately.
        </div>
      ) : (
        <div className="rounded-lg border border-error bg-error-container p-md">
          <div className="text-body-md text-on-error-container font-semibold mb-xs">
            Not ready to go live yet
          </div>
          <ul className="list-disc pl-lg space-y-xs text-body-md text-on-error-container">
            {readiness.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="text-body-sm text-on-error-container mt-sm">
            You can still save it as a draft — nothing is lost.
          </p>
        </div>
      )}

      <label className="flex items-start gap-sm text-body-md text-on-surface">
        <input
          type="checkbox"
          className="mt-xs accent-primary"
          checked={p.approvalRequired}
          onChange={(e) => p.setApprovalRequired(e.target.checked)}
        />
        <span>
          Route this req for approval before publishing
          <span className="block text-caption text-on-surface-variant">
            It will sit at &ldquo;Pending approval&rdquo; until an Owner or HR Manager approves it,
            and go live at that moment.
          </span>
        </span>
      </label>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant p-md">
      <dt className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</dt>
      <dd className="text-body-md text-on-surface mt-xs">{value}</dd>
    </div>
  );
}

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const out = [...arr];
  const tmp = out[a]!;
  out[a] = out[b]!;
  out[b] = tmp;
  return out;
}

function mergeChips(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((c) => c.toLowerCase()));
  return [...existing, ...incoming.filter((c) => !seen.has(c.toLowerCase()))];
}
