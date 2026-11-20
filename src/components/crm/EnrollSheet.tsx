"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ENROLL_BANKS,
  MIN_FIRST_PAYMENT,
  OTHER_PAYMENT_MODES,
  PAYER_RELATIONS,
  balanceOf,
  belowMinimum,
  confirmProblems,
  describePlan,
  planTotal,
  splitBalance,
  utrRequired,
  type ConfirmProblem,
  type EnrollConfirm,
  type EnrollmentFields,
  type PlanRow,
} from "@/lib/crm-enroll-confirm";
import { earliestEnrollDate, formatEnrollDate } from "@/lib/crm-enroll-date";
import { GST_STATES } from "@/lib/invoices/gst-states";
import { isIndia } from "@/lib/invoices/core";
import { Callout, Field, Icon, Modal, btnCls, cardCls, inputCls, primaryBtnCls } from "@/components/partner-commissions/ui";

/**
 * The Enroll sheet: three short steps and a summary to confirm, under a
 * minute. Who and what (name as on the passport, service, total, where they
 * live), the first payment (amount, the day it landed, the account, the UTR,
 * who paid) and the balance plan. The rules are in crm-enroll-confirm.ts,
 * the same ones the server enforces. Also used to fix an enrollment Finance
 * sent back (`mode="edit"`).
 */

type Preview = {
  /** The phone comes masked ("••••3210"); services only on a match stronger than the name. */
  match: { by: "linked" | "email" | "phone" | "name"; name: string; phone: string | null; services: string[] } | null;
  billing: { name: string | null; address: string | null; pin: string | null; state: string | null; country: string | null } | null;
};

export type EnrollSheetProps = {
  mode: "enroll" | "edit";
  leadId: string;
  candidateName: string;
  leadCountry: string | null;
  services: Array<{ id: string; label: string }>;
  serviceId: string | null;
  /** The deal value, to prefill the total. */
  expectedValue: number | null;
  /** May date the payment before the normal window (see crm-enroll-date.ts). */
  canBackdate: boolean;
  /** Edit: what the enrollment says now. */
  initial?: EnrollmentFields | null;
  /** Edit: Finance's note when it sent the enrollment back. */
  financeNote?: string | null;
  /** Enroll only: more fields for step 1 (deal owner, lead quality), owned by the caller. */
  extra?: { node: React.ReactNode; problem: string | null; payload: Record<string, unknown> };
  onClose: () => void;
  onDone: () => void;
};

const STEPS = ["Who and what", "First payment", "Balance plan", "Confirm"] as const;
const STEP_FIELDS: Array<Array<keyof EnrollConfirm>> = [
  ["billingName", "billingCountry", "billingState", "totalAmount"],
  ["firstAmount", "paidOn", "paymentMode", "utr", "payerRelation", "payerName"],
  ["plan"],
];

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const MATCH_BY: Record<string, string> = { linked: "already linked to this lead", email: "same email", phone: "same phone number", name: "same name only" };

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function EnrollSheet(props: EnrollSheetProps) {
  const { mode, leadId, initial } = props;
  const today = todayIst();
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [serviceId, setServiceId] = useState(props.serviceId ?? "");
  const [name, setName] = useState(initial?.billingName ?? props.candidateName);
  const [country, setCountry] = useState(initial?.billingCountry ?? (props.leadCountry?.trim() || "India"));
  const [state, setState] = useState(initial?.billingState ?? "");
  const [address, setAddress] = useState(initial?.billingAddress ?? "");
  const [pin, setPin] = useState(initial?.billingPin ?? "");
  const [total, setTotal] = useState(initial ? String(initial.totalAmount) : props.expectedValue ? String(props.expectedValue) : "");
  const [first, setFirst] = useState(initial?.firstAmount != null ? String(initial.firstAmount) : "");
  const [paidOn, setPaidOn] = useState(initial?.paidOn ?? today);
  const knownBank = (m: string | null | undefined) => !!m && (ENROLL_BANKS as readonly string[]).includes(m);
  const [account, setAccount] = useState<string>(initial?.paymentMode ? (knownBank(initial.paymentMode) ? initial.paymentMode : "Other") : "");
  const [otherMode, setOtherMode] = useState(initial?.paymentMode && !knownBank(initial.paymentMode) ? initial.paymentMode : "");
  const [utr, setUtr] = useState(initial?.utr ?? "");
  const [payer, setPayer] = useState(initial?.payerRelation ?? "candidate");
  const [payerName, setPayerName] = useState(initial?.payerName ?? "");
  const [plan, setPlan] = useState<PlanRow[]>(initial?.plan ?? []);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // The candidate record this enrollment links to, and its billing details.
  useEffect(() => {
    if (mode !== "enroll") return;
    let live = true;
    fetch(`/api/crm/leads/${leadId}/enroll`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Preview | null) => {
        if (!live || !p) return;
        setPreview(p);
        const b = p.billing;
        if (b?.name) setName(b.name);
        if (b?.country) setCountry(b.country);
        if (b?.state) setState(b.state);
        if (b?.address) setAddress(b.address);
        if (b?.pin) setPin(b.pin);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mode, leadId]);

  const paymentMode = account === "Other" ? otherMode : account;
  const india = isIndia(country || "India");
  const totalN = Number(total) || 0;
  const firstN = Number(first) || 0;
  const balance = totalN > 0 && firstN > 0 ? Math.max(0, balanceOf(totalN, firstN)) : 0;

  const confirm: EnrollConfirm = useMemo(
    () => ({
      billingName: name.trim(),
      billingCountry: country.trim(),
      billingState: india ? state || null : null,
      billingAddress: address.trim() || null,
      billingPin: pin.trim() || null,
      totalAmount: totalN,
      firstAmount: firstN,
      paidOn,
      paymentMode: (paymentMode || "Cash") as EnrollConfirm["paymentMode"],
      utr: utr.trim() || null,
      payerRelation: payer as EnrollConfirm["payerRelation"],
      payerName: payer === "candidate" ? null : payerName.trim() || null,
      plan,
    }),
    [name, country, india, state, address, pin, totalN, firstN, paidOn, paymentMode, utr, payer, payerName, plan],
  );

  // A changed date is held to the window; an unchanged one (fixing a sent-back enrollment) isn't.
  const dateWindow = mode === "enroll" || paidOn !== initial?.paidOn;
  const all = (): ConfirmProblem[] => confirmProblems(confirm, { today, canBackdate: props.canBackdate, dateWindow });

  function problemsFor(s: number): string[] {
    if (s === 3) return [...problemsFor(0), ...problemsFor(1), ...problemsFor(2)];
    const out = all()
      .filter((p) => STEP_FIELDS[s].includes(p.field))
      .map((p) => p.message);
    if (s === 0 && mode === "enroll" && !serviceId) out.unshift("Pick the service.");
    if (s === 0 && props.extra?.problem) out.push(props.extra.problem);
    if (s === 1 && !paymentMode) out.unshift("Pick the account the money landed in.");
    return out;
  }

  function next() {
    const p = problemsFor(step);
    setProblems(p);
    if (!p.length) setStep(step + 1);
  }

  function split(n: number) {
    setPlan(splitBalance(balance, n, paidOn));
  }

  async function submit() {
    const p = problemsFor(3);
    setProblems(p);
    if (p.length) return;
    setBusy(true);
    const res =
      mode === "enroll"
        ? await fetch(`/api/crm/leads/${leadId}/enroll`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              serviceId,
              expectedValue: totalN,
              expectedCloseDate: paidOn,
              closedDate: paidOn,
              ...(props.extra?.payload ?? {}),
              confirm,
            }),
          })
        : await fetch(`/api/crm/leads/${leadId}/enrollment`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(confirm),
          });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setProblems([d.message || d.error || "Couldn't save. Try again."]);
      return;
    }
    props.onDone();
  }

  const serviceName = props.services.find((s) => s.id === serviceId)?.label ?? "";
  const minDate = props.canBackdate ? undefined : earliestEnrollDate(today);

  const footer = (
    <>
      <button type="button" className={btnCls} disabled={busy} onClick={step === 0 ? props.onClose : () => (setProblems([]), setStep(step - 1))}>
        {step === 0 ? "Cancel" : "Back"}
      </button>
      {step < 3 ? (
        <button type="button" className={primaryBtnCls} onClick={next}>
          Next
        </button>
      ) : (
        <button type="button" className={primaryBtnCls} disabled={busy} onClick={submit}>
          {busy ? "Saving…" : mode === "enroll" ? "Confirm and enroll" : "Send to Finance again"}
        </button>
      )}
    </>
  );

  return (
    <Modal
      title={mode === "enroll" ? `Enroll ${props.candidateName}` : `Fix ${props.candidateName}'s enrollment`}
      subtitle={
        <span className="flex flex-wrap gap-x-2">
          {STEPS.map((s, i) => (
            <span key={s} className={i === step ? "font-semibold text-on-surface" : ""}>
              {i + 1}. {s}
              {i < STEPS.length - 1 ? " ›" : ""}
            </span>
          ))}
        </span>
      }
      onClose={props.onClose}
      footer={footer}
    >
      {mode === "edit" && props.financeNote && (
        <Callout tone="bad" icon="undo">
          <b>Finance:</b> {props.financeNote}
        </Callout>
      )}

      {step === 0 && (
        <>
          {mode === "enroll" && (
            <Field label="Service">
              <select className={inputCls} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Select…</option>
                {props.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Name as on the passport" hint="Exactly as printed: it goes on the invoice.">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Total the candidate pays (₹, GST included)">
            <input className={inputCls} type="number" min={0} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
            <Field label="Country they live in">
              <input className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)} />
            </Field>
            {india && (
              <Field label="State" hint="Decides which GST applies.">
                <select className={inputCls} value={state} onChange={(e) => setState(e.target.value)}>
                  <option value="">Select…</option>
                  {GST_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <Field label="Address (optional)" hint="For the invoice. Finance asks for it if it's missing.">
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="PIN (optional)">
            <input className={inputCls} value={pin} onChange={(e) => setPin(e.target.value)} />
          </Field>
          {mode === "enroll" &&
            (preview?.match ? (
              <Callout tone={preview.match.by === "name" ? "bad" : "neutral"} icon={preview.match.by === "name" ? "warning" : "link"}>
                Links to the existing candidate <b>{preview.match.name}</b> ({MATCH_BY[preview.match.by]}
                {preview.match.phone ? `, ${preview.match.phone}` : ""}).
                {preview.match.services.length ? ` Already has: ${preview.match.services.join(", ")}.` : ""}
                {preview.match.by === "name" && " Matched by name only: check it's the same person before enrolling. If not, ask an admin."}
              </Callout>
            ) : preview ? (
              <Callout icon="person_add">A new candidate record will be created.</Callout>
            ) : null)}
          {props.extra?.node}
        </>
      )}

      {step === 1 && (
        <>
          <Field
            label="First payment (₹)"
            hint={
              belowMinimum(firstN)
                ? `Under ${inr(MIN_FIRST_PAYMENT)}: your sales head must approve it before Finance can verify.`
                : `At least ${inr(MIN_FIRST_PAYMENT)}.`
            }
          >
            <input className={inputCls} type="number" min={0} inputMode="decimal" value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field
            label="Date the money landed"
            hint={
              minDate
                ? `This is the enrollment date: it decides the month it counts in. From ${formatEnrollDate(minDate)} to today.`
                : "This is the enrollment date: it decides the month it counts in."
            }
          >
            <input className={inputCls} type="date" value={paidOn} min={minDate} max={today} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-label-sm font-semibold text-on-surface-variant mb-1">Paid into</legend>
            <div className="flex flex-wrap gap-2">
              {[...ENROLL_BANKS, "Other"].map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={account === b}
                  className={account === b ? primaryBtnCls : btnCls}
                  onClick={() => setAccount(b)}
                >
                  {b}
                </button>
              ))}
            </div>
            {account === "Other" && (
              <select className={inputCls + " mt-1"} value={otherMode} onChange={(e) => setOtherMode(e.target.value)} aria-label="Other payment mode">
                <option value="">How was it paid?</option>
                {OTHER_PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </fieldset>
          <Field label={utrRequired(paymentMode) ? "UTR" : "UTR / reference (optional)"} hint="The bank reference on the payment screenshot.">
            <input className={inputCls} value={utr} onChange={(e) => setUtr(e.target.value)} autoComplete="off" />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-label-sm font-semibold text-on-surface-variant mb-1">Who paid</legend>
            <div className="flex flex-wrap gap-2">
              {PAYER_RELATIONS.map((r) => (
                <button key={r.code} type="button" aria-pressed={payer === r.code} className={payer === r.code ? primaryBtnCls : btnCls} onClick={() => setPayer(r.code)}>
                  {r.label}
                </button>
              ))}
            </div>
            {payer !== "candidate" && (
              <input className={inputCls + " mt-1"} placeholder="Their name" value={payerName} onChange={(e) => setPayerName(e.target.value)} aria-label="Payer's name" />
            )}
          </fieldset>
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-body-md">
            Balance: <b>{inr(balance)}</b> ({inr(totalN)} total − {inr(firstN)} paid)
          </p>
          {balance > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-label-sm text-on-surface-variant">Split evenly into</span>
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" className={btnCls} onClick={() => split(n)}>
                  {n} instalment{n === 1 ? "" : "s"}
                </button>
              ))}
            </div>
          )}
          {/* Rows show whenever there are any, so a plan left over from a
              bigger balance can always be removed. */}
          {plan.map((row, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2">
              <span className="text-label-sm text-on-surface-variant pb-2.5">#{i + 2}</span>
              <Field label="Due on">
                <input
                  className={inputCls}
                  type="date"
                  value={row.date}
                  min={paidOn}
                  onChange={(e) => setPlan(plan.map((r, j) => (j === i ? { ...r, date: e.target.value } : r)))}
                />
              </Field>
              <Field label="Amount (₹)">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={String(row.amount)}
                  onChange={(e) => setPlan(plan.map((r, j) => (j === i ? { ...r, amount: Number(e.target.value) || 0 } : r)))}
                />
              </Field>
              <button type="button" className={btnCls} aria-label={`Remove instalment ${i + 2}`} onClick={() => setPlan(plan.filter((_, j) => j !== i))}>
                <Icon name="close" />
              </button>
            </div>
          ))}
          {plan.length > 0 && (
            <p className={`text-caption ${Math.abs(planTotal(plan) - balance) < 0.005 ? "text-on-surface-variant" : "text-error"}`}>
              Planned {inr(planTotal(plan))} of {inr(balance)}.
              {balance === 0 ? " Nothing is left to pay: remove these instalments." : ""}
            </p>
          )}
          {balance > 0 ? (
            <div>
              <button
                type="button"
                className={btnCls}
                onClick={() => setPlan([...plan, { date: plan.length ? plan[plan.length - 1].date : paidOn, amount: Math.max(0, balance - planTotal(plan)) }])}
              >
                <Icon name="add" /> Add an instalment
              </button>
            </div>
          ) : (
            plan.length === 0 && (
              <Callout tone="ok" icon="check_circle">
                Paid in full: no balance to plan.
              </Callout>
            )
          )}
        </>
      )}

      {step === 3 && (
        <div className={`${cardCls} p-md flex flex-col gap-1.5 text-body-md`}>
          <Row label="Candidate" value={`${name}${country ? ` · ${[india ? state : null, country].filter(Boolean).join(", ")}` : ""}`} />
          {mode === "enroll" && <Row label="Service" value={serviceName} />}
          <Row label="Total (GST included)" value={inr(totalN)} />
          <Row
            label="First payment"
            value={`${inr(firstN)} into ${paymentMode} on ${formatEnrollDate(paidOn)}${utr ? ` · UTR ${utr}` : ""}`}
          />
          <Row label="Paid by" value={payer === "candidate" ? "The candidate" : `${PAYER_RELATIONS.find((r) => r.code === payer)?.label}: ${payerName}`} />
          <Row label="Balance" value={describePlan(plan)} />
          {belowMinimum(firstN) && (
            <p className="text-caption text-amber-800">
              The first payment is under {inr(MIN_FIRST_PAYMENT)}: your sales head is asked to approve it.
            </p>
          )}
          <p className="text-caption text-on-surface-variant mt-1">
            {mode === "enroll"
              ? `It counts as enrolled from ${formatEnrollDate(paidOn)} and shows as "Pending Finance" until Finance checks the payment against the bank. Your incentive counts it once Finance verifies it.`
              : "It goes back to Finance to verify."}
          </p>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="text-label-sm text-error list-disc pl-5" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-md">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-right font-semibold text-on-surface">{value}</span>
    </div>
  );
}
