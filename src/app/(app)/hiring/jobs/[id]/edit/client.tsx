"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  WORK_TYPES, WORK_TYPE_LABELS, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS,
  SENIORITIES, SENIORITY_LABELS, RESUME_MODES,
  type WorkType, type EmploymentType, type Seniority, type ResumeMode,
} from "@/lib/hiring/constants";
import { slugify, compBandLabel, validateJobForPublish } from "@/lib/hiring/core";
import { Markdown } from "@/components/hiring/Markdown";

type JobDTO = {
  id: string; title: string; slug: string; department: string; locationId: string | null;
  workType: string; employmentType: string; seniority: string;
  compMinLakh: number | null; compMaxLakh: number | null; compVisible: boolean;
  openings: number; descriptionMd: string | null; mustHaves: string[]; niceToHaves: string[];
  ownerId: string | null; hiringManagerId: string | null; resumeMode: string;
  askScreeningQs: boolean; status: string; applicantCount: number;
  rubrics: { criterion: string; description: string; weight: number }[];
};
type Lite = { id: string; name?: string; username?: string };

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const btn =
  "h-10 px-md rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";

export function EditJobClient({
  job,
  locations,
  users,
  departments,
}: {
  job: JobDTO;
  locations: Lite[];
  users: Lite[];
  departments: string[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(job.title);
  const [department, setDepartment] = useState(job.department);
  const [locationId, setLocationId] = useState(job.locationId ?? "");
  const [workType, setWorkType] = useState(job.workType as WorkType);
  const [employmentType, setEmploymentType] = useState(job.employmentType as EmploymentType);
  const [seniority, setSeniority] = useState(job.seniority as Seniority);
  const [compMin, setCompMin] = useState(job.compMinLakh?.toString() ?? "");
  const [compMax, setCompMax] = useState(job.compMaxLakh?.toString() ?? "");
  const [compVisible, setCompVisible] = useState(job.compVisible);
  const [openings, setOpenings] = useState(String(job.openings));
  const [descriptionMd, setDescriptionMd] = useState(job.descriptionMd ?? "");
  const [mustHaves, setMustHaves] = useState<string[]>(job.mustHaves);
  const [niceToHaves, setNiceToHaves] = useState<string[]>(job.niceToHaves);
  const [ownerId, setOwnerId] = useState(job.ownerId ?? "");
  const [hiringManagerId, setHiringManagerId] = useState(job.hiringManagerId ?? "");
  const [resumeMode, setResumeMode] = useState(job.resumeMode as ResumeMode);
  const [askScreeningQs, setAskScreeningQs] = useState(job.askScreeningQs);
  const [rubrics, setRubrics] = useState(job.rubrics);
  const [regenerateSlug, setRegenerateSlug] = useState(false);
  const [preview, setPreview] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const titleChanged = title.trim() !== job.title;
  const proposedSlug = useMemo(() => slugify(title), [title]);
  const slugWouldChange = titleChanged && proposedSlug !== job.slug;
  const weightTotal = rubrics.reduce((s, r) => s + r.weight, 0);

  const readiness = validateJobForPublish({
    title,
    descriptionMd: descriptionMd || null,
    mustHaves,
    rubrics,
  });

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);

    const res = await fetch(`/api/hiring/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        department: department.trim(),
        locationId: locationId || null,
        workType,
        employmentType,
        seniority,
        compMinLakh: numOrNull(compMin),
        compMaxLakh: numOrNull(compMax),
        compVisible,
        openings: Number(openings) || 1,
        descriptionMd: descriptionMd || null,
        mustHaves,
        niceToHaves,
        ownerId: ownerId || null,
        hiringManagerId: hiringManagerId || null,
        resumeMode,
        askScreeningQs,
        rubrics: rubrics.map((r) => ({
          criterion: r.criterion.trim(),
          description: r.description.trim() || null,
          weight: r.weight,
        })),
        regenerateSlug,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; issues?: { message: string }[] };
      setError(d.message ?? d.issues?.[0]?.message ?? "That didn't save.");
      return;
    }
    setSaved(true);
    router.refresh();
    if (regenerateSlug) router.push(`/hiring/jobs/${job.id}`);
  }

  return (
    <div className="max-w-4xl space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}
      {saved && (
        <div role="status" className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface">
          Saved. {job.status === "live" && "The careers page shows the change immediately."}
        </div>
      )}

      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-lg">
        <h2 className="text-h3 text-on-surface">Basics</h2>

        <div className="grid gap-md sm:grid-cols-2">
          <Field label="Job title" hint="This is what candidates see on the careers page.">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          </Field>
          <Field label="Department">
            <input className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)} list="edit-departments" maxLength={80} />
            <datalist id="edit-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
        </div>

        {/* The slug IS the public link. Renaming a title does not move it, and
            the old wording stays in the URL and in Google's index until asked. */}
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md">
          <div className="text-label-sm text-on-surface-variant mb-xs">Public link</div>
          <code className="text-body-sm text-on-surface break-all">
            /careers/desma/{regenerateSlug && slugWouldChange ? proposedSlug : job.slug}
          </code>
          {slugWouldChange ? (
            <>
              <label className="mt-sm flex items-start gap-sm text-body-sm text-on-surface">
                <input
                  type="checkbox"
                  className="mt-xs accent-primary"
                  checked={regenerateSlug}
                  onChange={(e) => setRegenerateSlug(e.target.checked)}
                />
                <span>
                  Rebuild the link from the new title
                  <span className="block text-caption text-on-surface-variant">
                    It would become <code>/careers/desma/{proposedSlug}</code>. Anyone holding the old
                    link, and any search engine that indexed it, would get a 404 — so do this when the
                    old wording is the reason you are editing, and not otherwise.
                  </span>
                </span>
              </label>
              {!regenerateSlug && (
                <p className="text-caption text-error mt-xs">
                  The title is changing but the link is not: <code>{job.slug}</code> stays as it is.
                </p>
              )}
            </>
          ) : (
            <p className="text-caption text-on-surface-variant mt-xs">
              Unchanged. It only moves if you rename the job and ask for it.
            </p>
          )}
        </div>

        <div className="grid gap-md sm:grid-cols-4">
          <Field label="Place">
            <select className={inputCls} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Not stated</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Work type">
            <select className={inputCls} value={workType} onChange={(e) => setWorkType(e.target.value as WorkType)}>
              {WORK_TYPES.map((w) => <option key={w} value={w}>{WORK_TYPE_LABELS[w]}</option>)}
            </select>
          </Field>
          <Field label="Employment type">
            <select className={inputCls} value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Seniority">
            <select className={inputCls} value={seniority} onChange={(e) => setSeniority(e.target.value as Seniority)}>
              {SENIORITIES.map((s) => <option key={s} value={s}>{SENIORITY_LABELS[s]}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid gap-md sm:grid-cols-4">
          <Field label="Comp from (₹ lakh/yr)">
            <input className={inputCls} type="number" min={0} step="0.25" value={compMin} onChange={(e) => setCompMin(e.target.value)} />
          </Field>
          <Field label="Comp to (₹ lakh/yr)">
            <input className={inputCls} type="number" min={0} step="0.25" value={compMax} onChange={(e) => setCompMax(e.target.value)} />
          </Field>
          <Field label="Openings">
            <input className={inputCls} type="number" min={1} max={500} value={openings} onChange={(e) => setOpenings(e.target.value)} />
          </Field>
          <Field label="Owner">
            <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-xs text-body-md text-on-surface">
          <input type="checkbox" className="accent-primary" checked={compVisible} onChange={(e) => setCompVisible(e.target.checked)} />
          Show the band{" "}
          {compBandLabel(numOrNull(compMin), numOrNull(compMax)) && (
            <span className="text-accent font-semibold">
              ({compBandLabel(numOrNull(compMin), numOrNull(compMax))})
            </span>
          )}{" "}
          on the public careers page
        </label>

        <Field label="Hiring manager" hint="Whoever is named here can review this req's candidates and submit scorecards, whatever their role.">
          <select className={inputCls} value={hiringManagerId} onChange={(e) => setHiringManagerId(e.target.value)}>
            <option value="">Nobody</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </Field>
      </section>

      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
        <div className="flex flex-wrap items-center justify-between gap-md">
          <h2 className="text-h3 text-on-surface">Description</h2>
          <button type="button" className={btn} onClick={() => setPreview(!preview)}>
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-lg min-h-[200px]">
            <Markdown source={descriptionMd} />
          </div>
        ) : (
          <textarea
            className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md font-mono"
            rows={14}
            value={descriptionMd}
            onChange={(e) => setDescriptionMd(e.target.value)}
          />
        )}

        <ChipList
          label="Must-haves"
          hint="Screening reads these. Write them as words a CV would actually contain — 'Malayalam' works, 'Language' cannot, because nothing matches the name of a category."
          chips={mustHaves}
          setChips={setMustHaves}
        />
        <ChipList label="Nice-to-haves" hint="A bonus, not a requirement." chips={niceToHaves} setChips={setNiceToHaves} />
      </section>

      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
        <h2 className="text-h3 text-on-surface">Application form</h2>
        <fieldset>
          <legend className="text-label-sm text-on-surface-variant mb-xs">Résumé</legend>
          <div className="space-y-xs">
            {(
              [
                ["required", "Ask for a résumé or a portfolio link — one of the two"],
                ["optional", "Ask, but let them skip it"],
                ["skip", "Don't ask at all"],
              ] as [ResumeMode, string][]
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-xs text-body-md text-on-surface">
                <input type="radio" name="resumeMode" className="accent-primary" checked={resumeMode === value} onChange={() => setResumeMode(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-xs text-body-md text-on-surface">
          <input type="checkbox" className="accent-primary" checked={askScreeningQs} onChange={(e) => setAskScreeningQs(e.target.checked)} />
          Include screening questions
        </label>
        {RESUME_MODES.includes(resumeMode) && job.applicantCount > 0 && (
          <p className="text-caption text-on-surface-variant">
            {job.applicantCount} {job.applicantCount === 1 ? "person has" : "people have"} already
            applied. Changing the form affects new applicants only — answers already given are kept
            exactly as they were.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
        <div className="flex flex-wrap items-baseline justify-between gap-md">
          <h2 className="text-h3 text-on-surface">Scoring rubric</h2>
          <span className={"text-body-md font-semibold " + (weightTotal === 100 ? "text-accent" : "text-error")}>
            Total {weightTotal}%{weightTotal === 100 ? " ✓" : " — needs to be 100%"}
          </span>
        </div>
        {rubrics.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-sm">
            <input
              className="flex-1 min-w-[12rem] h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
              value={r.criterion}
              aria-label={`Criterion ${i + 1}`}
              onChange={(e) => setRubrics((p) => p.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)))}
            />
            <input
              type="range" min={0} max={100} step={5} value={r.weight}
              aria-label={`${r.criterion} weight`}
              className="w-40 accent-primary"
              onChange={(e) => setRubrics((p) => p.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
            />
            <span className="w-12 text-right tabular-nums text-on-surface">{r.weight}%</span>
          </div>
        ))}
        <p className="text-caption text-on-surface-variant">
          Changing the weights does not re-score anyone already scored — their breakdown keeps the
          weights that produced it. Re-score from the candidate drawer to apply the new ones.
        </p>
      </section>

      {!readiness.ready && job.status === "live" && (
        <div className="rounded-xl border border-error bg-error-container p-md">
          <div className="text-body-md text-on-error-container font-semibold mb-xs">
            This is live, and these would stop it being publishable
          </div>
          <ul className="list-disc pl-lg space-y-xs text-body-md text-on-error-container">
            {readiness.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={primaryBtn} onClick={save} disabled={busy || title.trim().length < 2}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className={btn} onClick={() => router.push(`/hiring/jobs/${job.id}`)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
      {hint && <span className="block text-caption text-on-surface-variant mt-xs">{hint}</span>}
    </label>
  );
}

function ChipList({
  label, hint, chips, setChips,
}: {
  label: string; hint: string; chips: string[];
  setChips: React.Dispatch<React.SetStateAction<string[]>>;
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
        {chips.length === 0 && <span className="text-caption text-on-surface-variant">None.</span>}
        {chips.map((c) => (
          <span key={c} className="inline-flex items-center gap-xs h-8 pl-md pr-xs rounded-full bg-surface-container text-label-sm text-on-surface">
            {c}
            <button
              type="button"
              aria-label={`Remove ${c}`}
              className="h-6 w-6 inline-flex items-center justify-center rounded-full hover:bg-surface-container-highest"
              onClick={() => setChips((prev) => prev.filter((x) => x !== c))}
            >
              ✕
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
            if (e.key === "Enter") { e.preventDefault(); add(); }
          }}
        />
        <button type="button" className={btn} onClick={add}>Add</button>
      </div>
      <p className="text-caption text-on-surface-variant mt-xs">{hint}</p>
    </div>
  );
}

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}
