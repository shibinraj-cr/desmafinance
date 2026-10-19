"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AUD,
  Callout,
  EnrollmentForm,
  EnrollmentPill,
  Field,
  Icon,
  Modal,
  ProgramTag,
  api,
  btnCls,
  fmtDate,
  inputCls,
  linkBtnCls,
  primaryBtnCls,
  useToast,
  type ProgramOption,
} from "@/components/partner-commissions/ui";
import { MAX_INSTALLMENTS, PC_FINANCE_PAGE } from "@/lib/partner-commissions/constants";
import { enrollmentState, fmtMoney, intakeMonthOptions } from "@/lib/partner-commissions/logic";
import type { EnrollmentDTO } from "@/lib/partner-commissions/server";

export function PartnerEnrollmentsClient({
  today,
  allowed,
  isFinance,
  programs,
  enrollments,
}: {
  today: string;
  allowed: string[];
  isFinance: boolean;
  programs: ProgramOption[];
  enrollments: EnrollmentDTO[];
}) {
  const router = useRouter();
  const { show, node } = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EnrollmentDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function remove(e: EnrollmentDTO) {
    setErr(null);
    setBusy(e.id);
    try {
      await api(`/api/finance/partner-commissions/enrollments/${e.id}`, { action: "delete" });
      show(`${e.candidateName} removed.`);
      router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Couldn't remove it.");
    } finally {
      setBusy(null);
    }
  }

  if (allowed.length === 0) {
    return (
      <div className="p-md md:p-margin">
        <Callout icon="lock">You don&apos;t have access to add partner enrollments. Ask a Finance Manager to give you access in Partner Commissions → Settings.</Callout>
      </div>
    );
  }

  return (
    <div className="p-md md:p-margin flex flex-col gap-md">
      <div className="flex flex-wrap items-center gap-sm">
        <p className="text-body-md text-on-surface-variant flex-1 min-w-[260px]">
          Add the candidates you enrolled in {allowed.join(", ")}. Enter the total course fee once; Finance records each installment the candidate pays and invoices the partner for DESMA&apos;s commission when the fee is fully paid.
        </p>
        {isFinance ? <a className={btnCls} href={PC_FINANCE_PAGE}><Icon name="open_in_new" />Partner Commissions</a> : null}
        <button className={primaryBtnCls} onClick={() => setAdding(true)} disabled={programs.length === 0}><Icon name="add" />New enrollment</button>
      </div>
      {programs.length === 0 ? <Callout icon="info">{allowed.join(", ")} isn&apos;t set up yet. Finance adds the partner and its defaults first.</Callout> : null}
      {err ? <Callout tone="bad" icon="error">{err}</Callout> : null}

      {enrollments.length === 0 ? (
        <div className="p-xl text-center text-on-surface-variant border border-dashed border-outline-variant rounded-xl bg-surface-container-lowest">You haven&apos;t added any enrollments yet.</div>
      ) : (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl">
          <table className="w-full min-w-[820px] text-body-md">
            <thead>
              <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                {["Candidate", "Program", "Intake", "Course fee", "Fee paid", "Balance", "Status", ""].map((h, i) => (
                  <th key={i} className={`px-sm py-2.5 font-semibold whitespace-nowrap ${[3, 5].includes(i) ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => {
                const st = enrollmentState({ status: e.status, courseFee: e.courseFee, payments: e.payments, invoiceStatus: e.invoice?.status ?? null });
                const canChange = e.payments.length === 0 && !e.invoice && e.status !== "withdrawn";
                return (
                  <tr key={e.id} className="border-t border-outline-variant/60">
                    <td className="px-sm py-2.5"><b>{e.candidateName}</b><div className="text-caption text-on-surface-variant">{e.partnerName}{e.studentId ? ` · ${e.studentId}` : ""} · added {fmtDate(e.createdAt)}</div></td>
                    <td className="px-sm py-2.5"><ProgramTag code={e.program} /></td>
                    <td className="px-sm py-2.5 tabular-nums whitespace-nowrap">{e.intakeMonth}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums">{AUD(e.courseFee)}</td>
                    <td className="px-sm py-2.5 tabular-nums text-caption">{fmtMoney(e.courseFee - e.balance)} of {fmtMoney(e.courseFee)} · {e.payments.length} of {MAX_INSTALLMENTS}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums">{e.balance ? AUD(e.balance) : "—"}</td>
                    <td className="px-sm py-2.5"><EnrollmentPill state={st} /></td>
                    <td className="px-sm py-2.5 whitespace-nowrap">
                      {canChange ? (
                        <span className="inline-flex gap-sm">
                          <button className={linkBtnCls} onClick={() => setEditing(e)}>Edit</button>
                          <button className={`${linkBtnCls} !text-error`} disabled={busy === e.id} onClick={() => remove(e)}>Remove</button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-on-surface-variant">You can edit or remove an enrollment until Finance records its first payment. After that, ask Finance.</p>

      {adding ? (
        <EnrollmentForm
          programs={programs}
          today={today}
          finance={false}
          onCancel={() => setAdding(false)}
          onCreated={(_id, name) => {
            setAdding(false);
            show(`${name} added. Finance will track the fee from here.`);
            router.refresh();
          }}
        />
      ) : null}
      {editing ? <EditModal e={editing} today={today} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); show("Saved."); router.refresh(); }} /> : null}
      {node}
    </div>
  );
}

function EditModal({ e, today, onClose, onSaved }: { e: EnrollmentDTO; today: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(e.candidateName);
  const [sid, setSid] = useState(e.studentId ?? "");
  const [intake, setIntake] = useState(e.intakeMonth);
  const [fee, setFee] = useState(String(e.courseFee));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const months = intakeMonthOptions(today);
  if (!months.includes(intake)) months.unshift(intake);
  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api(`/api/finance/partner-commissions/enrollments/${e.id}`, { action: "update", candidateName: name, studentId: sid || null, intakeMonth: intake, courseFee: parseFloat(fee) });
      onSaved();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Edit enrollment" onClose={onClose} footer={<><button className={btnCls} onClick={onClose} disabled={busy}>Cancel</button><button className={primaryBtnCls} onClick={save} disabled={busy}>Save</button></>}>
      <Field label="Candidate name"><input className={inputCls} value={name} onChange={(x) => setName(x.target.value)} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-sm">
        <Field label="Student ID"><input className={inputCls} value={sid} onChange={(x) => setSid(x.target.value)} /></Field>
        <Field label="Intake month"><select className={inputCls} value={intake} onChange={(x) => setIntake(x.target.value)}>{months.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Course fee (AUD)"><input className={inputCls} type="number" min={1} value={fee} onChange={(x) => setFee(x.target.value)} /></Field>
      </div>
      {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}
    </Modal>
  );
}
