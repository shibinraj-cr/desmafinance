"use client";

import { useRef, useState } from "react";

/**
 * The public apply form. Built to work on a phone at 390px, without JavaScript
 * frameworks doing anything clever: one native <form>, real labels, real
 * required attributes, and a submit that reports exactly what went wrong.
 */

type Question = {
  id: string;
  prompt: string;
  helperText: string | null;
  answerType: string;
  required: boolean;
  options: string[] | null;
};

const inputCls =
  "w-full min-h-[44px] px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition";

export function ApplyForm({
  jobId,
  jobTitle,
  resumeMode,
  questions,
}: {
  jobId: string;
  jobTitle: string;
  resumeMode: string;
  questions: Question[];
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  // The form's own dwell time — a script posts instantly, a person does not.
  const mountedAt = useRef(Date.now());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("sending");

    const data = new FormData(e.currentTarget);
    data.set("jobId", jobId);
    data.set("dwellMs", String(Date.now() - mountedAt.current));

    try {
      const res = await fetch("/api/careers/apply", { method: "POST", body: data });
      if (res.ok) {
        setState("sent");
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        issues?: { message: string }[];
      };
      setState("idle");
      setError(
        payload.message ||
          payload.issues?.[0]?.message ||
          (payload.error === "rate_limited"
            ? "Too many applications from this connection. Please try again shortly."
            : "Something went wrong sending your application. Please try again."),
      );
    } catch {
      setState("idle");
      setError("We could not reach the server. Check your connection and try again.");
    }
  }

  if (state === "sent") {
    return (
      <div
        role="status"
        className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg"
      >
        <h3 className="text-h3 text-on-surface mb-xs">Application received</h3>
        <p className="text-body-md text-on-surface-variant">
          Thank you for applying for <strong className="text-on-surface">{jobTitle}</strong>. We read
          every application. If your experience lines up with what the role needs, someone from the
          team will contact you — usually within a week.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-lg" noValidate={false}>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container"
        >
          {error}
        </div>
      )}

      {/* Honeypot: off-screen, not hidden with display:none (some bots skip
          those), and never announced to screen readers. */}
      <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset className="space-y-md" disabled={state === "sending"}>
        <legend className="sr-only">About you</legend>

        <Field label="Your name" htmlFor="fullName" required>
          <input id="fullName" name="fullName" required maxLength={120} autoComplete="name" className={inputCls} />
        </Field>

        <div className="grid gap-md sm:grid-cols-2">
          <Field label="Email" htmlFor="email" hint="We reply here.">
            <input id="email" name="email" type="email" maxLength={200} autoComplete="email" className={inputCls} />
          </Field>
          <Field label="Phone (WhatsApp)" htmlFor="phone" hint="With country code, e.g. +91 98470 12345.">
            <input id="phone" name="phone" type="tel" maxLength={30} autoComplete="tel" className={inputCls} />
          </Field>
        </div>
        <p className="text-caption text-on-surface-variant -mt-sm">
          Give at least one of email or phone so we can reach you.
        </p>

        <div className="grid gap-md sm:grid-cols-2">
          <Field label="Where you are now" htmlFor="locationText">
            <input id="locationText" name="locationText" maxLength={160} className={inputCls} />
          </Field>
          <Field label="Current role" htmlFor="currentTitle">
            <input id="currentTitle" name="currentTitle" maxLength={120} autoComplete="organization-title" className={inputCls} />
          </Field>
        </div>

        <div className="grid gap-md sm:grid-cols-2">
          <Field label="Notice period (days)" htmlFor="noticePeriodDays">
            <input id="noticePeriodDays" name="noticePeriodDays" type="number" min={0} max={365} className={inputCls} />
          </Field>
          <Field label="Expected salary (₹ lakh / year)" htmlFor="expectedCtcLakh">
            <input id="expectedCtcLakh" name="expectedCtcLakh" type="number" min={0} max={999} step="0.5" className={inputCls} />
          </Field>
        </div>
      </fieldset>

      {resumeMode !== "skip" && (
        <fieldset className="space-y-md" disabled={state === "sending"}>
          <legend className="text-body-lg font-semibold text-on-surface mb-xs">
            Your work
            {resumeMode === "required" && (
              <span className="ml-xs text-label-sm font-normal text-on-surface-variant">
                — a résumé or a link, one of the two
              </span>
            )}
          </legend>
          <Field label="Résumé (PDF or Word, up to 5 MB)" htmlFor="resume">
            <input
              id="resume"
              name="resume"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className={inputCls + " file:mr-sm file:rounded file:border-0 file:bg-surface-container file:px-sm file:py-xs file:text-label-sm"}
            />
          </Field>
          <div className="grid gap-md sm:grid-cols-2">
            <Field label="Portfolio or website" htmlFor="portfolioUrl">
              <input id="portfolioUrl" name="portfolioUrl" type="url" maxLength={500} placeholder="https://" className={inputCls} />
            </Field>
            <Field label="LinkedIn" htmlFor="linkedinUrl">
              <input id="linkedinUrl" name="linkedinUrl" type="url" maxLength={500} placeholder="https://" className={inputCls} />
            </Field>
          </div>
        </fieldset>
      )}

      {questions.length > 0 && (
        <fieldset className="space-y-md" disabled={state === "sending"}>
          <legend className="text-body-lg font-semibold text-on-surface mb-xs">
            A few questions
          </legend>
          {questions.map((q) => (
            <QuestionField key={q.id} question={q} />
          ))}
        </fieldset>
      )}

      <div className="space-y-md">
        <label className="flex items-start gap-sm text-body-sm text-on-surface-variant">
          <input
            type="checkbox"
            name="consent"
            value="true"
            required
            className="mt-xs accent-primary h-4 w-4 flex-shrink-0"
          />
          <span>
            I agree that DESMA International may store and use the details above to consider me for
            this role and for similar roles. We keep applications for 24 months, and you can ask us
            to delete yours at any time by writing to{" "}
            <a className="underline" href="mailto:hello@desma.in">
              hello@desma.in
            </a>
            .
          </span>
        </label>

        <button
          type="submit"
          disabled={state === "sending"}
          className="w-full sm:w-auto min-h-[44px] px-xl rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Send application"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-label-sm text-on-surface mb-xs">
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      {children}
      {hint && <p className="text-caption text-on-surface-variant mt-xs">{hint}</p>}
    </div>
  );
}

function QuestionField({ question: q }: { question: Question }) {
  const name = `answer:${q.id}`;
  const options = q.options ?? [];

  if (q.answerType === "detailed_text") {
    return (
      <Field label={q.prompt} htmlFor={q.id} hint={q.helperText ?? undefined} required={q.required}>
        <textarea id={q.id} name={name} required={q.required} rows={4} maxLength={4000} className={inputCls} />
      </Field>
    );
  }
  if (q.answerType === "number") {
    return (
      <Field label={q.prompt} htmlFor={q.id} hint={q.helperText ?? undefined} required={q.required}>
        <input id={q.id} name={name} type="number" required={q.required} className={inputCls} />
      </Field>
    );
  }
  if (q.answerType === "file") {
    return (
      <Field label={q.prompt} htmlFor={q.id} hint={q.helperText ?? "Up to 5 MB."} required={q.required}>
        <input id={q.id} name={name} type="file" required={q.required} className={inputCls} />
      </Field>
    );
  }
  if (q.answerType === "yes_no") {
    return (
      <fieldset>
        <legend className="block text-label-sm text-on-surface mb-xs">
          {q.prompt}
          {q.required && <span className="text-error"> *</span>}
        </legend>
        <div className="flex gap-md">
          {["Yes", "No"].map((v) => (
            <label key={v} className="flex items-center gap-xs text-body-md text-on-surface">
              <input type="radio" name={name} value={v} required={q.required} className="accent-primary" />
              {v}
            </label>
          ))}
        </div>
        {q.helperText && <p className="text-caption text-on-surface-variant mt-xs">{q.helperText}</p>}
      </fieldset>
    );
  }
  if (q.answerType === "single_select" && options.length) {
    return (
      <Field label={q.prompt} htmlFor={q.id} hint={q.helperText ?? undefined} required={q.required}>
        <select id={q.id} name={name} required={q.required} className={inputCls}>
          <option value="">Choose one…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (q.answerType === "multi_select" && options.length) {
    return (
      <fieldset>
        <legend className="block text-label-sm text-on-surface mb-xs">
          {q.prompt}
          {q.required && <span className="text-error"> *</span>}
        </legend>
        <div className="space-y-xs">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-xs text-body-md text-on-surface">
              <input type="checkbox" name={name} value={o} className="accent-primary" />
              {o}
            </label>
          ))}
        </div>
        {q.helperText && <p className="text-caption text-on-surface-variant mt-xs">{q.helperText}</p>}
      </fieldset>
    );
  }

  return (
    <Field label={q.prompt} htmlFor={q.id} hint={q.helperText ?? undefined} required={q.required}>
      <input id={q.id} name={name} required={q.required} maxLength={500} className={inputCls} />
    </Field>
  );
}
