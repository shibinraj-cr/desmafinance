"use client";

import { useState } from "react";
import { MAX_INSTALLMENTS } from "@/lib/partner-commissions/constants";
import { installmentCap, ordinal, planLabel, suggestedInstallment } from "@/lib/partner-commissions/logic";
import type { EnrollmentDTO } from "@/lib/partner-commissions/server";
import { AUD, Callout, Field, fmtDate, inputCls, linkBtnCls, primaryBtnCls } from "./ui";

/**
 * Course-fee installments for one enrollment — the bar, the installments paid so
 * far, and the form for the next one (up to MAX_INSTALLMENTS). Shared by
 * Finance's enrollment drawer and the Partner Enrollments page, where BDEs and
 * the OSCE/NCLEX coordinator record what their candidates paid.
 */

export function FeeBar({ e, tall }: { e: EnrollmentDTO; tall?: boolean }) {
  return (
    <div className={`flex gap-0.5 ${tall ? "h-2.5" : "h-[7px]"} rounded-full overflow-hidden bg-surface-container-high`}>
      {e.payments.map((p) => (
        <i key={p.seq} className="block bg-primary min-w-[3px]" style={{ flex: p.amount }} title={`${ordinal(p.seq)} installment · ${AUD(p.amount)} · ${fmtDate(p.paidOn)}`} />
      ))}
      {e.balance > 0 ? <i className="block" style={{ flex: e.balance }} /> : null}
    </div>
  );
}

type Act = (body: Record<string, unknown>, msg: string) => Promise<boolean>;

/**
 * `locked`: invoiced or withdrawn — nothing can change. `canRecord`: this viewer
 * may record and undo (Finance, or an enroller for their own candidates).
 */
export function InstallmentSlots({
  e,
  today,
  locked,
  canRecord,
  busy,
  act,
  planOptions = [],
}: {
  e: EnrollmentDTO;
  today: string;
  locked: boolean;
  canRecord: boolean;
  busy: boolean;
  act: Act;
  /** The program's installment plans (e.g. GCAN: 1, 2, 6); empty when it has none. */
  planOptions?: number[];
}) {
  const open = !locked && canRecord;
  const cap = installmentCap(e.installmentPlan);
  // Offer the program's plans, plus the current one if it has since been dropped from Settings.
  const choices = [...new Set([...planOptions, ...(e.installmentPlan != null ? [e.installmentPlan] : [])])].sort((x, y) => x - y);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant">Fee installments</h4>
        {choices.length ? (
          open ? (
            <label className="flex items-center gap-2 text-caption text-on-surface-variant">
              Plan
              <select
                className={`${inputCls} !h-8 !w-auto text-[13px]`}
                value={e.installmentPlan ?? ""}
                disabled={busy}
                aria-label="Installment plan"
                onChange={(x) => x.target.value && act({ action: "set-plan", plan: Number(x.target.value) }, `Plan changed to ${planLabel(Number(x.target.value))}.`)}
              >
                {e.installmentPlan == null ? <option value="">Choose…</option> : null}
                {choices.map((n) => (
                  <option key={n} value={n} disabled={n < e.payments.length}>{planLabel(n)}</option>
                ))}
              </select>
            </label>
          ) : e.installmentPlan != null ? (
            <span className="text-caption text-on-surface-variant">Plan: {planLabel(e.installmentPlan)}</span>
          ) : null
        ) : null}
      </div>
      <p className="text-caption text-on-surface-variant">What the candidate paid {e.partnerName}. Tracked here only: it&apos;s the institution&apos;s money, not DESMA revenue.</p>
      {e.payments.map((p, i) => (
        <div key={p.seq} className="border border-outline-variant rounded-lg px-sm py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-semibold text-body-md w-28">{ordinal(p.seq)} installment</span>
          <b className="tabular-nums">{AUD(p.amount)}</b>
          <span className="text-caption text-on-surface-variant">
            {fmtDate(p.paidOn)}
            {p.reference ? ` · ${p.reference}` : ""}
            {p.recordedBy ? ` · by ${p.recordedBy}` : ""}
          </span>
          <span className="flex-1" />
          {open && i === e.payments.length - 1 ? (
            <button className={`${linkBtnCls} text-caption`} disabled={busy} onClick={() => act({ action: "undo-pay" }, `Removed the ${AUD(p.amount)} installment.`)}>
              Undo
            </button>
          ) : null}
        </div>
      ))}
      {open && e.balance > 0 && e.payments.length < cap ? (
        // Keyed by the count so the form starts fresh (amount = new balance) after each payment.
        <NextInstallment key={`${e.id}:${e.payments.length}`} e={e} index={e.payments.length} today={today} busy={busy} act={act} />
      ) : null}
      {e.payments.length === 0 && !(open && e.balance > 0) ? (
        <div className="border border-dashed border-outline-variant bg-surface-container-low rounded-lg px-sm py-2 text-caption text-on-surface-variant">No installments recorded yet.</div>
      ) : null}
      <p className="text-caption text-on-surface-variant tabular-nums">
        {e.balance === 0
          ? `Fully paid in ${e.payments.length} installment${e.payments.length === 1 ? "" : "s"}.`
          : e.installmentPlan != null
            ? `${e.payments.length} of ${cap} installments recorded on the ${cap === 1 ? "1-installment" : `${cap}-installment`} plan.`
            : `${e.payments.length} of up to ${MAX_INSTALLMENTS} installments recorded.`}
      </p>
      {e.payments.length >= cap && e.balance > 0 ? (
        <Callout tone="bad" icon="error">
          All {cap} installments {e.installmentPlan != null ? "on this plan " : ""}are recorded and {AUD(e.balance)} is still due.{" "}
          {e.installmentPlan != null && cap < MAX_INSTALLMENTS ? "Change the plan to add another, or undo the last installment and re-enter it." : "Undo the last installment and re-enter it, or ask Finance to correct the course fee."}
        </Callout>
      ) : null}
    </section>
  );
}

function NextInstallment({ e, index, today, busy, act }: { e: EnrollmentDTO; index: number; today: string; busy: boolean; act: Act }) {
  // An even split of what's left over the installments left on the plan; the whole balance otherwise.
  const [amt, setAmt] = useState(String(suggestedInstallment(e.balance, e.installmentPlan, e.payments.length) || ""));
  const [paidOn, setPaidOn] = useState(today);
  const [ref, setRef] = useState("");
  const left = Math.round((e.balance - (parseFloat(amt) || 0)) * 100) / 100;
  return (
    <div className="border border-primary-container bg-primary-fixed/30 rounded-lg p-sm flex flex-col gap-sm">
      <span className="font-semibold text-body-md">{ordinal(index + 1)} installment</span>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-sm">
        <Field label="Amount (AUD)"><input className={inputCls} type="number" min={1} step="0.01" value={amt} onChange={(x) => setAmt(x.target.value)} /></Field>
        <Field label="Paid on"><input className={inputCls} type="date" max={today} value={paidOn} onChange={(x) => setPaidOn(x.target.value)} /></Field>
        <Field label="Reference"><input className={inputCls} value={ref} onChange={(x) => setRef(x.target.value)} placeholder="Receipt no. or note" /></Field>
      </div>
      <div className="flex flex-wrap justify-between items-center gap-sm">
        <span className="text-caption text-on-surface-variant tabular-nums">{left < 0 ? `That's ${AUD(-left)} more than the balance.` : `Balance after this payment: ${AUD(left)}`}</span>
        <button
          className={primaryBtnCls}
          disabled={busy}
          onClick={() =>
            act(
              { action: "pay", amount: parseFloat(amt), paidOn, reference: ref || null },
              left <= 0 ? `${e.candidateName} is fully paid. Finance will invoice it on the next run.` : `${ordinal(index + 1)} installment recorded. Balance ${AUD(left)}.`,
            )
          }
        >
          Record {ordinal(index + 1)} installment
        </button>
      </div>
    </div>
  );
}
