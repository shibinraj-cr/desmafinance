"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { formatHiringDate } from "@/lib/hiring/core";

type JobLite = { id: string; title: string; department: string; mustHaves: string[]; openings: number };
type ReferralDTO = {
  id: string; candidateName: string; jobTitle: string; department: string;
  referrerName: string; status: string; bonusStatus: string;
  bonusAmount: number | null; createdAt: string;
};

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const btn =
  "h-10 px-md rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition";

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  reviewing: "Being reviewed",
  in_pipeline: "In the pipeline",
  hired: "Hired",
  rejected: "Not progressing",
};

export function ReferralsClient({
  jobs,
  referrals,
  seesAll,
  loadedAt,
}: {
  jobs: JobLite[];
  referrals: ReferralDTO[];
  seesAll: boolean;
  loadedAt: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [pitchMd, setPitchMd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/hiring/referrals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, fullName, email, phone, relationship, pitchMd }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That referral could not be saved.");
      return;
    }
    setOpen(false);
    setFullName("");
    setEmail("");
    setPhone("");
    setRelationship("");
    setPitchMd("");
    router.refresh();
  }

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h2 className="text-h2 text-on-surface">Open roles</h2>
          <p className="text-body-sm text-on-surface-variant">
            {jobs.length === 0
              ? "Nothing is open right now."
              : `${jobs.length} live ${jobs.length === 1 ? "role" : "roles"}. The bonus is paid when your referral is hired.`}
          </p>
        </div>
        <div className="flex items-center gap-xs">
          <RefreshBar loadedAt={loadedAt} />
          <button type="button" className={primaryBtn} onClick={() => setOpen((v) => !v)} disabled={jobs.length === 0}>
            Refer someone
          </button>
        </div>
      </div>

      {jobs.length > 0 && (
        <ul className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
              <div className="text-body-lg font-semibold text-on-surface">{j.title}</div>
              <div className="text-caption text-on-surface-variant">
                {j.department}
                {j.openings > 1 ? ` · ${j.openings} openings` : ""}
              </div>
              {j.mustHaves.length > 0 && (
                <p className="text-caption text-on-surface-variant mt-sm">
                  Needs: {j.mustHaves.join(", ")}
                </p>
              )}
              <button
                type="button"
                className="mt-sm text-label-sm text-primary hover:underline"
                onClick={() => {
                  setJobId(j.id);
                  setOpen(true);
                }}
              >
                Refer for this →
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-low p-lg space-y-md">
          <h3 className="text-h3 text-on-surface">Who are you referring?</h3>
          <div className="grid gap-md sm:grid-cols-2">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Role</span>
              <select className={inputCls} value={jobId} onChange={(e) => setJobId(e.target.value)}>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Their name</span>
              <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
            </label>
          </div>
          <div className="grid gap-md sm:grid-cols-3">
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Email</span>
              <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Phone</span>
              <input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">How do you know them?</span>
              <input className={inputCls} value={relationship} onChange={(e) => setRelationship(e.target.value)} maxLength={120} />
            </label>
          </div>
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">
              Why would they be good here?
            </span>
            <textarea
              className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
              rows={3}
              value={pitchMd}
              onChange={(e) => setPitchMd(e.target.value)}
              maxLength={4000}
            />
          </label>
          <div className="flex gap-xs">
            <button
              type="button"
              className={primaryBtn}
              disabled={busy || fullName.trim().length < 2 || (!email.trim() && !phone.trim())}
              onClick={submit}
            >
              {busy ? "Sending…" : "Refer them"}
            </button>
            <button type="button" className={btn} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <p className="text-caption text-on-surface-variant">
            Please ask them first. They enter the pipeline like any other candidate, with you
            recorded as the referrer for as long as the record exists.
          </p>
        </section>
      )}

      <section className="space-y-sm">
        <h2 className="text-h2 text-on-surface">{seesAll ? "All referrals" : "My referrals"}</h2>
        {referrals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
            <div className="text-body-lg text-on-surface mb-xs">No referrals yet</div>
            <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
              You will see the status of anyone you refer here, right through to the bonus.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">Candidate</th>
                  <th className="px-md py-sm">Role</th>
                  {seesAll && <th className="px-md py-sm">Referred by</th>}
                  <th className="px-md py-sm">Status</th>
                  <th className="px-md py-sm">Bonus</th>
                  <th className="px-md py-sm">Referred</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant last:border-0">
                    <td className="px-lg py-sm text-on-surface">{r.candidateName}</td>
                    <td className="px-md py-sm text-on-surface-variant">{r.jobTitle}</td>
                    {seesAll && <td className="px-md py-sm text-on-surface-variant">{r.referrerName}</td>}
                    <td className="px-md py-sm text-on-surface-variant">
                      {STATUS_LABELS[r.status] ?? r.status}
                    </td>
                    <td className="px-md py-sm text-on-surface-variant">
                      {r.status === "hired"
                        ? r.bonusAmount
                          ? `₹${r.bonusAmount} · ${r.bonusStatus}`
                          : r.bonusStatus
                        : "On hire"}
                    </td>
                    <td className="px-md py-sm text-on-surface-variant whitespace-nowrap">
                      {formatHiringDate(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
