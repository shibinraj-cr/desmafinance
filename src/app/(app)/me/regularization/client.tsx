"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type RegReason = { code: string; label: string };
type RegRow = {
  id: string;
  date: string;
  reasonType: string;
  reasonLabel: string;
  reason: string;
  proposedIn: string | null;
  proposedOut: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: string;
};

export function RegularizationRequestClient({
  reasons,
  requests,
}: {
  reasons: RegReason[];
  requests: RegRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    reasonType: reasons[0]?.code ?? "missing_punch",
    reason: "",
    proposedIn: "",
    proposedOut: "",
  });

  async function submit() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/me/regularization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          reasonType: form.reasonType,
          reason: form.reason,
          proposedIn: form.proposedIn || null,
          proposedOut: form.proposedOut || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setOk("Request submitted — HR will review shortly.");
      setForm({ ...form, reason: "", proposedIn: "", proposedOut: "" });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="New request">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-base">
          <Field label="Discrepancy date">
            <input
              type="date"
              value={form.date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </Field>
          <Field label="Issue">
            <select
              value={form.reasonType}
              onChange={(e) => setForm({ ...form, reasonType: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            >
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Correct In time">
            <input
              type="time"
              value={form.proposedIn}
              onChange={(e) => setForm({ ...form, proposedIn: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </Field>
          <Field label="Correct Out time">
            <input
              type="time"
              value={form.proposedOut}
              onChange={(e) => setForm({ ...form, proposedOut: e.target.value })}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Explanation">
              <textarea
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                rows={3}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                placeholder="Briefly describe what happened (5+ characters)…"
              />
            </Field>
          </div>
        </div>
        <div className="mt-base flex items-center justify-between gap-base">
          {err && <p className="text-error text-label-sm">{err}</p>}
          {ok && <p className="text-green-700 text-label-sm">{ok}</p>}
          <div className="ml-auto">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !form.reason || form.reason.length < 5}
              className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </div>
      </Section>

      <Section title="My requests">
        {requests.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
                <tr>
                  <th className="px-sm py-xs text-left">Submitted</th>
                  <th className="px-sm py-xs text-left">Date</th>
                  <th className="px-sm py-xs text-left">Reason</th>
                  <th className="px-sm py-xs text-left">In</th>
                  <th className="px-sm py-xs text-left">Out</th>
                  <th className="px-sm py-xs text-left">Status</th>
                  <th className="px-sm py-xs text-left">HR note</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-outline-variant">
                    <td className="px-sm py-xs text-on-surface-variant">
                      {new Date(r.createdAt).toLocaleString("en-IN", { hour12: false })}
                    </td>
                    <td className="px-sm py-xs">{r.date}</td>
                    <td className="px-sm py-xs">
                      <span className="font-semibold">{r.reasonLabel}</span>
                      <p className="text-caption text-on-surface-variant max-w-md">{r.reason}</p>
                    </td>
                    <td className="px-sm py-xs font-mono">{r.proposedIn ?? "—"}</td>
                    <td className="px-sm py-xs font-mono">{r.proposedOut ?? "—"}</td>
                    <td className="px-sm py-xs">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-sm py-xs text-on-surface-variant text-caption">
                      {r.reviewNote ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-xs block">
      <span className="text-caption uppercase tracking-wider text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "approved"
      ? "bg-green-100 text-green-800"
      : status === "rejected"
        ? "bg-red-100 text-red-800"
        : status === "clarification"
          ? "bg-yellow-100 text-yellow-800"
          : "bg-blue-100 text-blue-800";
  return (
    <span className={`px-xs py-[1px] rounded text-caption font-semibold uppercase ${cls}`}>
      {status}
    </span>
  );
}
