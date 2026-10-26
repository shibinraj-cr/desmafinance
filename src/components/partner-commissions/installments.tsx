"use client";

import { useState } from "react";
import { MAX_INSTALLMENTS } from "@/lib/partner-commissions/constants";
import type { EnrollmentDTO } from "@/lib/partner-commissions/server";
import { AUD, Callout, Field, fmtDate, inputCls, linkBtnCls, primaryBtnCls } from "./ui";

/**
 * Course-fee installments for one enrollment — the bar and the three slots.
 * Shared by Finance's enrollment drawer and the Partner Enrollments page, where
 * BDEs and the OSCE/NCLEX coordinator record what their candidates paid.
 */

const ORD = ["1st", "2nd", "3rd"];

export function FeeBar({ e, tall }: { e: EnrollmentDTO; tall?: boolean }) {
  return (
    <div className={`flex gap-0.5 ${tall ? "h-2.5" : "h-[7px]"} rounded-full overflow-hidden bg-surface-container-high`}>
      {e.payments.map((p) => (
        <i key={p.seq} className="block bg-primary min-w-[3px]" style={{ flex: p.amount }} title={`${ORD[p.seq - 1] ?? "Extra"} installment · ${AUD(p.amount)} · ${fmtDate(p.paidOn)}`} />
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
export function InstallmentSlots({ e, today, locked, canRecord, busy, act }: { e: EnrollmentDTO; today: string; locked: boolean; canRecord: boolean; busy: boolean; act: Act }) {
  const open = !locked && canRecord;
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant">Fee installments</h4>
      <p className="text-caption text-on-surface-variant">What the candidate paid {e.partnerName}. Tracked here only: it&apos;s the institution&apos;s money, not DESMA revenue.</p>
      {[0, 1, 2].map((i) => {
        const p = e.payments[i];
        if (p) {
          return (
            <div key={i} className="border border-outline-variant rounded-lg px-sm py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold text-body-md w-28">{ORD[i]} installment</span>
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
          );
        }
        if (i === e.payments.length && e.balance > 0 && open) {
          // Keyed by the count so the form starts fresh (amount = new balance) after each payment.
          return <NextInstallment key={`${e.id}:${e.payments.length}`} e={e} index={i} today={today} busy={busy} act={act} />;
        }
        return (
          <div key={i} className="border border-dashed border-outline-variant bg-surface-container-low rounded-lg px-sm py-2 flex justify-between text-body-md">
            <span className="font-semibold">{ORD[i]} installment</span>
            <span className="text-caption text-on-surface-variant">
              {e.balance === 0 ? "Not needed, fee fully paid" : locked || !canRecord ? "—" : `Opens after the ${ORD[i - 1]} installment`}
            </span>
          </div>
        );
      })}
      {e.payments.length >= MAX_INSTALLMENTS && e.balance > 0 ? (
        <Callout tone="bad" icon="error">
          All {MAX_INSTALLMENTS} installments are used and {AUD(e.balance)} is still due. Undo the last installment and re-enter it, or ask Finance to correct the course fee.
        </Callout>
      ) : null}
    </section>
  );
}

function NextInstallment({ e, index, today, busy, act }: { e: EnrollmentDTO; index: number; today: string; busy: boolean; act: Act }) {
  const [amt, setAmt] = useState(String(e.balance || ""));
  const [paidOn, setPaidOn] = useState(today);
  const [ref, setRef] = useState("");
  const left = Math.round((e.balance - (parseFloat(amt) || 0)) * 100) / 100;
  return (
    <div className="border border-primary-container bg-primary-fixed/30 rounded-lg p-sm flex flex-col gap-sm">
      <span className="font-semibold text-body-md">{ORD[index]} installment</span>
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
              left <= 0 ? `${e.candidateName} is fully paid. Finance will invoice it on the next run.` : `${ORD[index]} installment recorded. Balance ${AUD(left)}.`,
            )
          }
        >
          Record {ORD[index]} installment
        </button>
      </div>
    </div>
  );
}
