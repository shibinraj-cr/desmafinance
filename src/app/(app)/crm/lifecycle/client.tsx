"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LifecycleLead, LifecycleReviewLead, LifecycleRule } from "@/lib/crm-lifecycle";

type Config = { followUpEnabled: boolean; remarketingEnabled: boolean; followUpSince: string | null };
type Preview = {
  config: Config;
  targetLabel?: string;
  due: Record<LifecycleRule, number>;
  reviewCount: number;
  skipped?: string;
  preview?: LifecycleLead[];
  review?: LifecycleReviewLead[];
};
type Rules = {
  followUpCapDays: number;
  followUpReviewDays: number;
  followUpExtensionDays: number;
  remarketingCapDays: number;
};

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const card = "rounded-xl border border-outline-variant bg-surface-container-lowest p-lg";

async function post(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/crm/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.message as string) || (data.error as string) || `HTTP ${res.status}`);
  return data;
}

export function LifecycleClient({ rules, initial, ifEnabled }: { rules: Rules; initial: Preview; ifEnabled: Preview }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [followUp, setFollowUp] = useState(initial.config.followUpEnabled);
  const [remarketing, setRemarketing] = useState(initial.config.remarketingEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [extended, setExtended] = useState<Record<string, string>>({});

  const dirty = followUp !== initial.config.followUpEnabled || remarketing !== initial.config.remarketingEnabled;
  const dueNow = initial.due.followup_cap + initial.due.remarketing_cap;

  function save() {
    setError(null);
    setMessage(null);
    start(async () => {
      try {
        await post({ action: "save", followUpEnabled: followUp, remarketingEnabled: remarketing });
        setMessage("Saved.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  function runNow() {
    setError(null);
    setMessage(null);
    start(async () => {
      try {
        const r = await post({ action: "run" });
        setMessage(
          `Moved ${r.moved ?? 0} lead(s) to ${initial.targetLabel ?? "the central pool"}` +
            (Number(r.remaining) > 0 ? ` — ${r.remaining} left for the next run.` : "."),
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The sweep failed.");
      }
    });
  }

  function extend(leadId: string) {
    const reason = (reasons[leadId] ?? "").trim();
    if (reason.length < 3) {
      setError("Give a reason for the extension.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const r = await post({ action: "extend", leadId, reason });
        setExtended((m) => ({ ...m, [leadId]: String(r.until ?? "") }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not extend.");
      }
    });
  }

  return (
    <>
      {initial.skipped && (
        <div className={`${card} text-label-sm text-error`}>Sweep cannot run: {initial.skipped}.</div>
      )}

      <section className={card}>
        <h2 className="text-title-sm font-semibold text-on-surface">Time limits</h2>
        <p className="mt-xs text-label-sm text-on-surface-variant">
          Both start switched off. Turn one on only after reading what it will move below. The sweep runs daily; moved
          leads lose their consultant and land in {initial.targetLabel ?? "the Centralised pool"}.
        </p>
        <div className="mt-md space-y-sm">
          <label className="flex items-start gap-sm text-label-md text-on-surface">
            <input type="checkbox" className="mt-1" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
            <span>
              <strong>Follow-Up: {rules.followUpCapDays} days.</strong> From day {rules.followUpReviewDays} the lead is on
              the review list below; extend it ({rules.followUpExtensionDays} days, with a reason) or it moves. The clock
              for leads already in Follow-Up starts the day this is first switched on
              {initial.config.followUpSince ? ` (${fmtDate(initial.config.followUpSince)})` : ""}.
            </span>
          </label>
          <label className="flex items-start gap-sm text-label-md text-on-surface">
            <input
              type="checkbox"
              className="mt-1"
              checked={remarketing}
              onChange={(e) => setRemarketing(e.target.checked)}
            />
            <span>
              <strong>Re-marketing: {rules.remarketingCapDays} days.</strong> Counted from when each lead entered
              Re-marketing — switching this on moves the existing backlog on the next run (
              {ifEnabled.due.remarketing_cap} lead{ifEnabled.due.remarketing_cap === 1 ? "" : "s"} today).
            </span>
          </label>
        </div>
        <div className="mt-md flex flex-wrap items-center gap-base">
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={save}
            className="h-10 rounded-lg bg-primary px-lg text-label-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy || dirty || dueNow === 0 || !!initial.skipped}
            onClick={runNow}
            className="h-10 rounded-lg border border-outline-variant px-lg text-label-sm font-bold text-on-surface hover:bg-surface-container-low disabled:opacity-50"
          >
            Run now ({dueNow})
          </button>
          {message && <span className="text-label-sm font-semibold text-green-700">{message}</span>}
          {error && <span className="text-label-sm font-semibold text-error">{error}</span>}
        </div>
      </section>

      <section className={card}>
        <h2 className="text-title-sm font-semibold text-on-surface">
          Due to move now — {initial.due.followup_cap} Follow-Up, {initial.due.remarketing_cap} Re-marketing
        </h2>
        <p className="mt-xs text-label-sm text-on-surface-variant">
          With the switches as saved. If both were on: {ifEnabled.due.followup_cap} Follow-Up and{" "}
          {ifEnabled.due.remarketing_cap} Re-marketing.
        </p>
        <LeadTable rows={initial.preview ?? []} empty="Nothing is due to move." />
      </section>

      <section className={card}>
        <h2 className="text-title-sm font-semibold text-on-surface">
          Follow-Up review — {initial.reviewCount} lead{initial.reviewCount === 1 ? "" : "s"} near the limit
        </h2>
        <p className="mt-xs text-label-sm text-on-surface-variant">
          Extend the ones still being worked; the rest move at their deadline.
        </p>
        {(initial.review ?? []).length === 0 ? (
          <p className="py-lg text-center text-label-sm text-on-surface-variant">
            {initial.config.followUpEnabled ? "No leads to review." : "Switch the Follow-Up limit on to start the review list."}
          </p>
        ) : (
          <div className="mt-md overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-label-sm">
              <thead>
                <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
                  <th className="py-sm pr-sm font-semibold">Lead</th>
                  <th className="px-sm py-sm font-semibold">Consultant</th>
                  <th className="px-sm py-sm text-right font-semibold">Days</th>
                  <th className="px-sm py-sm font-semibold">Moves on</th>
                  <th className="pl-sm py-sm font-semibold">Extend</th>
                </tr>
              </thead>
              <tbody>
                {(initial.review ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant/60">
                    <td className="py-sm pr-sm">
                      <Link href={`/crm/leads/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.candidateName}
                      </Link>
                    </td>
                    <td className="px-sm py-sm">{r.ownerName ?? "—"}</td>
                    <td className="px-sm py-sm text-right tabular-nums">{r.daysInStage}</td>
                    <td className="px-sm py-sm">{fmtDate(extended[r.id] || r.deadline)}</td>
                    <td className="pl-sm py-sm">
                      {extended[r.id] ? (
                        <span className="font-semibold text-green-700">Extended</span>
                      ) : (
                        <div className="flex items-center gap-xs">
                          <input
                            className="h-8 w-56 rounded-md border border-outline-variant px-sm"
                            placeholder="Reason"
                            value={reasons[r.id] ?? ""}
                            onChange={(e) => setReasons((m) => ({ ...m, [r.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => extend(r.id)}
                            className="h-8 rounded-md border border-outline-variant px-sm font-semibold hover:bg-surface-container-low disabled:opacity-50"
                          >
                            +{rules.followUpExtensionDays}d
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function LeadTable({ rows, empty }: { rows: LifecycleLead[]; empty: string }) {
  if (rows.length === 0) return <p className="py-lg text-center text-label-sm text-on-surface-variant">{empty}</p>;
  return (
    <div className="mt-md overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-label-sm">
        <thead>
          <tr className="border-b border-outline-variant text-left text-caption uppercase tracking-wider text-on-surface-variant">
            <th className="py-sm pr-sm font-semibold">Lead</th>
            <th className="px-sm py-sm font-semibold">Stage</th>
            <th className="px-sm py-sm font-semibold">Consultant</th>
            <th className="pl-sm py-sm text-right font-semibold">Days in stage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-outline-variant/60">
              <td className="py-sm pr-sm">
                <Link href={`/crm/leads/${r.id}`} className="font-medium text-primary hover:underline">
                  {r.candidateName}
                </Link>
              </td>
              <td className="px-sm py-sm">{r.stage}</td>
              <td className="px-sm py-sm">{r.ownerName ?? "—"}</td>
              <td className="pl-sm py-sm text-right tabular-nums">{r.daysInStage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
