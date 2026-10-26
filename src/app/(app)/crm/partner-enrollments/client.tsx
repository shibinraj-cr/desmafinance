"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AUD,
  Callout,
  Drawer,
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
import { FeeBar, InstallmentSlots } from "@/components/partner-commissions/installments";
import { PC_FINANCE_PAGE, type EnrollmentState } from "@/lib/partner-commissions/constants";
import { enrollmentState, fmtMoney, installmentCap, intakeMonthOptions } from "@/lib/partner-commissions/logic";
import type { EnrollmentDTO } from "@/lib/partner-commissions/server";

type Row = EnrollmentDTO & { canRecord: boolean };

const stateOf = (e: EnrollmentDTO) => enrollmentState({ status: e.status, courseFee: e.courseFee, payments: e.payments, invoiceStatus: e.invoice?.status ?? null });
// Candidates still paying first — that's the work here.
const RANK: Record<EnrollmentState, number> = { paying: 0, notstarted: 1, fullypaid: 2, invoiced: 3, received: 4, withdrawn: 5 };
const ordinalDay = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;

export function PartnerEnrollmentsClient({
  today,
  userId,
  allowed,
  isFinance,
  runDay,
  planOptions,
  programs,
  enrollments,
}: {
  today: string;
  userId: string;
  allowed: string[];
  isFinance: boolean;
  runDay: number;
  /** Each program's installment plans, for the plan switcher. */
  planOptions: Record<string, number[]>;
  programs: ProgramOption[];
  enrollments: Row[];
}) {
  const router = useRouter();
  const { show, node } = useToast();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyPaying, setOnlyPaying] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return enrollments
      .filter((e) => !needle || e.candidateName.toLowerCase().includes(needle) || (e.studentId ?? "").toLowerCase().includes(needle))
      .filter((e) => !onlyPaying || ["paying", "notstarted"].includes(stateOf(e)))
      .sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)] || a.candidateName.localeCompare(b.candidateName));
  }, [enrollments, q, onlyPaying]);
  const open = openId ? enrollments.find((e) => e.id === openId) ?? null : null;
  const done = (msg: string) => {
    show(msg);
    router.refresh();
  };

  if (allowed.length === 0 && enrollments.length === 0) {
    return (
      <div className="p-md md:p-margin">
        <Callout icon="lock">You don&apos;t have access to partner enrollments. Ask a Finance Manager to give you access in Partner Commissions → Settings.</Callout>
      </div>
    );
  }

  return (
    <div className="p-md md:p-margin flex flex-col gap-md">
      <div className="flex flex-wrap items-center gap-sm">
        <p className="text-body-md text-on-surface-variant flex-1 min-w-[260px]">
          Add the candidates you enrolled{allowed.length ? ` in ${allowed.join(", ")}` : ""}, then record each installment as they pay it. When the balance reaches zero, Finance invoices the partner for DESMA&apos;s commission.
        </p>
        {isFinance ? <a className={btnCls} href={PC_FINANCE_PAGE}><Icon name="open_in_new" />Partner Commissions</a> : null}
        <button className={primaryBtnCls} onClick={() => setAdding(true)} disabled={programs.length === 0}><Icon name="add" />New enrollment</button>
      </div>
      {programs.length === 0 && allowed.length ? <Callout icon="info">{allowed.join(", ")} isn&apos;t set up yet. Finance adds the partner and its defaults first.</Callout> : null}

      {enrollments.length === 0 ? (
        <div className="p-xl text-center text-on-surface-variant border border-dashed border-outline-variant rounded-xl bg-surface-container-lowest">No enrollments yet. Add the first one with New enrollment.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-sm">
            <input type="search" className={`${inputCls} !w-64 max-w-full`} placeholder="Search candidate or student ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <label className="flex items-center gap-2 text-body-md"><input type="checkbox" checked={onlyPaying} onChange={(e) => setOnlyPaying(e.target.checked)} />Still paying only</label>
          </div>
          <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl">
            <table className="w-full min-w-[820px] text-body-md">
              <thead>
                <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                  {["Candidate", "Program", "Intake", "Course fee", "Fee paid", "Balance", "Status"].map((h, i) => (
                    <th key={h} className={`px-sm py-2.5 font-semibold whitespace-nowrap ${[3, 5].includes(i) ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} tabIndex={0} onClick={() => setOpenId(e.id)} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setOpenId(e.id))} className="border-t border-outline-variant/60 cursor-pointer hover:bg-surface-container-low focus-visible:bg-surface-container-low outline-none">
                    <td className="px-sm py-2.5">
                      <b>{e.candidateName}</b>
                      <div className="text-caption text-on-surface-variant">{e.partnerName}{e.studentId ? ` · ${e.studentId}` : ""}{e.createdById !== userId && e.createdBy ? ` · added by ${e.createdBy}` : ""}</div>
                    </td>
                    <td className="px-sm py-2.5"><ProgramTag code={e.program} /></td>
                    <td className="px-sm py-2.5 tabular-nums whitespace-nowrap">{e.intakeMonth}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums">{AUD(e.courseFee)}</td>
                    <td className="px-sm py-2.5 min-w-[160px]">
                      <FeeBar e={e} />
                      <div className="text-caption text-on-surface-variant tabular-nums mt-1">{fmtMoney(e.courseFee - e.balance)} of {fmtMoney(e.courseFee)} · {e.payments.length} of {installmentCap(e.installmentPlan)} installments</div>
                    </td>
                    <td className={`px-sm py-2.5 text-right tabular-nums ${e.balance ? "font-semibold" : "text-on-surface-variant"}`}>{e.balance ? AUD(e.balance) : "—"}</td>
                    <td className="px-sm py-2.5"><EnrollmentPill state={stateOf(e)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-caption text-on-surface-variant">Showing {rows.length} of {enrollments.length}. Select a candidate to record an installment.</p>
        </>
      )}

      {open ? <EnrollmentPanel key={open.id} e={open} today={today} userId={userId} runDay={runDay} planOptions={planOptions[open.program] ?? []} onClose={() => setOpenId(null)} done={done} /> : null}
      {adding ? (
        <EnrollmentForm
          programs={programs}
          today={today}
          finance={false}
          onCancel={() => setAdding(false)}
          onCreated={(id, name) => {
            setAdding(false);
            setOpenId(id);
            done(`${name} added. Record each installment here as they pay.`);
          }}
        />
      ) : null}
      {node}
    </div>
  );
}

function EnrollmentPanel({ e, today, userId, runDay, planOptions, onClose, done }: { e: Row; today: string; userId: string; runDay: number; planOptions: number[]; onClose: () => void; done: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const st = stateOf(e);
  const locked = !!e.invoice || e.status === "withdrawn";
  const canChange = e.createdById === userId && e.payments.length === 0 && !locked;

  async function act(body: Record<string, unknown>, msg: string): Promise<boolean> {
    setErr(null);
    setBusy(true);
    try {
      await api(`/api/finance/partner-commissions/enrollments/${e.id}`, body);
      done(msg);
      return true;
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer onClose={onClose} label="Enrollment">
      <div className="flex justify-between gap-sm px-lg pt-lg pb-sm border-b border-outline-variant">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><ProgramTag code={e.program} /><EnrollmentPill state={st} /></div>
          <h3 className="text-h3 mt-1.5">{e.candidateName}</h3>
          <p className="text-caption text-on-surface-variant">{e.partnerName} · {e.courseName} · Intake {e.intakeMonth}{e.studentId ? ` · Student ID ${e.studentId}` : ""}</p>
        </div>
        <button className="h-9 w-9 grid place-items-center rounded-lg border border-outline-variant" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <div className="flex-1 overflow-auto px-lg py-md flex flex-col gap-md">
        <div className="grid grid-cols-3 gap-sm bg-surface-container-low border border-outline-variant rounded-xl p-sm">
          <Stat label="Course fee" value={AUD(e.courseFee)} />
          <Stat label="Paid" value={AUD(e.courseFee - e.balance)} />
          <Stat label="Balance" value={AUD(e.balance)} warn={e.balance > 0} />
          <div className="col-span-3"><FeeBar e={e} tall /></div>
        </div>
        {e.invoice ? (
          <Callout icon="description">Invoiced by Finance ({e.invoice.number}), so the installments are locked. Ask Finance if something needs correcting.</Callout>
        ) : st === "fullypaid" ? (
          <Callout tone="gold" icon="event_upcoming">Fully paid. Finance invoices it on the {ordinalDay(runDay)}. You can still undo the last installment until then.</Callout>
        ) : e.status === "withdrawn" ? (
          <Callout tone="bad" icon="block">Withdrawn by Finance, so it is never invoiced.</Callout>
        ) : null}
        {!e.canRecord && !locked ? <Callout icon="lock">You can see this enrollment but not record its installments. Finance or the candidate&apos;s consultant does that.</Callout> : null}

        <InstallmentSlots e={e} today={today} locked={locked} canRecord={e.canRecord} busy={busy} act={act} planOptions={planOptions} />
        {err ? <Callout tone="bad" icon="error">{err}</Callout> : null}

        <section className="flex flex-col gap-2">
          <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant">Details</h4>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-md gap-y-1.5 text-body-md">
            <dt className="text-on-surface-variant">Partner</dt><dd>{e.partnerName}</dd>
            <dt className="text-on-surface-variant">Course</dt><dd>{e.courseName}</dd>
            <dt className="text-on-surface-variant">Student ID</dt><dd>{e.studentId ?? "—"}</dd>
            <dt className="text-on-surface-variant">CRM lead</dt><dd>{e.leadId ? <a className={linkBtnCls} href={`/crm/leads/${e.leadId}`}>{e.leadName ?? "Open lead"}</a> : "Not linked"}</dd>
            <dt className="text-on-surface-variant">Added</dt><dd>{fmtDate(e.createdAt)}{e.createdBy ? ` by ${e.createdBy}` : ""}</dd>
          </dl>
          {canChange ? (
            confirmRemove ? (
              <Callout tone="bad">
                Remove this enrollment? Use this only for one added by mistake.{" "}
                <span className="inline-flex gap-2 mt-1">
                  <button className={btnCls} disabled={busy} onClick={async () => { if (await act({ action: "delete" }, `${e.candidateName} removed.`)) onClose(); }}>Remove</button>
                  <button className={btnCls} onClick={() => setConfirmRemove(false)}>Keep</button>
                </span>
              </Callout>
            ) : (
              <div className="flex gap-sm">
                <button className={btnCls} onClick={() => setEditing(true)}><Icon name="edit" />Edit details</button>
                <button className={`${btnCls} !text-error`} onClick={() => setConfirmRemove(true)}><Icon name="delete" />Remove</button>
              </div>
            )
          ) : null}
          {e.createdById === userId && e.payments.length > 0 && !locked ? (
            <p className="text-caption text-on-surface-variant">Details can&apos;t change once an installment is recorded. Ask Finance if the fee or candidate details are wrong.</p>
          ) : null}
        </section>
      </div>
      {editing ? <EditModal e={e} today={today} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); done("Saved."); }} /> : null}
    </Drawer>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] font-semibold text-on-surface-variant">{label}</div>
      <b className={`text-body-lg tabular-nums ${warn ? "text-amber-700" : ""}`}>{value}</b>
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
