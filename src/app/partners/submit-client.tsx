"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "w-full min-h-[44px] px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";

/** The partner's submit-a-candidate form. The only write they can make. */
export function SubmitClient({ jobs }: { jobs: { id: string; title: string }[] }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setState("sending");
    setError(null);
    const res = await fetch("/api/partners/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, fullName, email, phone, currentTitle, notes }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setState("idle");
      setError(d.message ?? "That could not be submitted.");
      return;
    }
    setState("sent");
    setFullName("");
    setEmail("");
    setPhone("");
    setCurrentTitle("");
    setNotes("");
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <div>
        <h2 className="text-h3 text-on-surface">Submit a candidate</h2>
        <p className="text-body-sm text-on-surface-variant">
          Submit only people who have agreed to be put forward. We will tell you the stage they
          reach; we do not share our internal notes or scores.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}
      {state === "sent" && (
        <div role="status" className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface">
          Submitted. It appears in your list below.
        </div>
      )}

      <div className="grid gap-md sm:grid-cols-2">
        <label className="block">
          <span className="block text-label-sm text-on-surface mb-xs">Role</span>
          <select className={inputCls} value={jobId} onChange={(e) => setJobId(e.target.value)}>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface mb-xs">
            Candidate name <span className="text-error">*</span>
          </span>
          <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
        </label>
      </div>

      <div className="grid gap-md sm:grid-cols-3">
        <label className="block">
          <span className="block text-label-sm text-on-surface mb-xs">Email</span>
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface mb-xs">Phone</span>
          <input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface mb-xs">Current role</span>
          <input className={inputCls} value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} maxLength={120} />
        </label>
      </div>

      <label className="block">
        <span className="block text-label-sm text-on-surface mb-xs">Why them?</span>
        <textarea
          className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
        />
      </label>

      <button
        type="button"
        className="min-h-[44px] px-xl rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60"
        disabled={state === "sending" || fullName.trim().length < 2 || (!email.trim() && !phone.trim())}
        onClick={submit}
      >
        {state === "sending" ? "Submitting…" : "Submit candidate"}
      </button>
      <p className="text-caption text-on-surface-variant">
        Give at least an email or a phone number so we can reach them.
      </p>
    </section>
  );
}
