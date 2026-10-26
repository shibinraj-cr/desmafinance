"use client";

import { useMemo, useState } from "react";
import { MultiSelect } from "@/components/MultiSelect";
import {
  AUD,
  Callout,
  Drawer,
  EnrollmentForm,
  EnrollmentPill,
  Field,
  Icon,
  InvoicePill,
  ProgramTag,
  api,
  btnCls,
  fmtDate,
  fmtDow,
  inputCls,
  linkBtnCls,
  primaryBtnCls,
  type ProgramOption,
} from "@/components/partner-commissions/ui";
import { FeeBar, InstallmentSlots } from "@/components/partner-commissions/installments";
import { ENROLLMENT_STATE_LABEL, MAX_INSTALLMENTS, PROGRAM_CODES, type EnrollmentState } from "@/lib/partner-commissions/constants";
import { commissionOf, fmtMoney, intakeMonthOptions } from "@/lib/partner-commissions/logic";
import { stateOf, type EnrollmentDTO, type PcPageData } from "./_types";
import type { PcCtx } from "./client";

const ORD = ["1st", "2nd", "3rd"];
const RANK: Record<EnrollmentState, number> = { fullypaid: 0, paying: 1, notstarted: 2, invoiced: 3, received: 4, withdrawn: 5 };

export function programOptions(data: PcPageData, allowed?: string[]): ProgramOption[] {
  return data.programs
    .filter((p) => p.configured && p.isActive && (!allowed || allowed.includes(p.code)))
    .map((p) => {
      const partner = data.partners.find((x) => x.id === p.partnerId);
      return { code: p.code, partnerName: partner?.name ?? "", courseName: p.courseName, defaultFee: p.defaultFee, defaultPct: p.defaultPct, defaultFlat: p.defaultFlat, layout: partner?.layout ?? "compact" };
    })
    .filter((p) => p.partnerName);
}

export function EnrollmentsTab({ ctx }: { ctx: PcCtx }) {
  const { data } = ctx;
  const [progs, setProgs] = useState<string[]>([]);
  const [partners, setPartners] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.enrollments
      .filter((e) => (!progs.length || progs.includes(e.program)) && (!partners.length || partners.includes(e.partnerId)) && (!states.length || states.includes(stateOf(e))))
      .filter((e) => !needle || e.candidateName.toLowerCase().includes(needle) || (e.studentId ?? "").toLowerCase().includes(needle))
      .sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)] || a.candidateName.localeCompare(b.candidateName));
  }, [data.enrollments, progs, partners, states, q]);

  const open = openId ? data.enrollments.find((e) => e.id === openId) ?? null : null;

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap gap-sm items-center">
        <MultiSelect className="w-40" placeholder="All programs" options={PROGRAM_CODES.map((p) => ({ value: p, label: p }))} selected={progs} onChange={setProgs} icon="school" />
        <MultiSelect className="w-60" placeholder="All partners" options={data.partners.map((p) => ({ value: p.id, label: p.name }))} selected={partners} onChange={setPartners} icon="handshake" />
        <MultiSelect className="w-56" placeholder="All statuses" options={(Object.keys(ENROLLMENT_STATE_LABEL) as EnrollmentState[]).map((k) => ({ value: k, label: ENROLLMENT_STATE_LABEL[k] }))} selected={states} onChange={setStates} icon="filter_list" />
        <input type="search" className={`${inputCls} !w-64 max-w-full`} placeholder="Search candidate or student ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <span className="flex-1" />
        <button className={primaryBtnCls} onClick={() => setAdding(true)}><Icon name="add" />New enrollment</button>
      </div>

      {rows.length === 0 ? (
        <div className="p-xl text-center text-on-surface-variant border border-dashed border-outline-variant rounded-xl bg-surface-container-lowest">
          {data.enrollments.length === 0 ? "No enrollments yet. Add the first one with New enrollment." : "No enrollments match these filters."}
        </div>
      ) : (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl">
          <table className="w-full min-w-[960px] text-body-md">
            <thead>
              <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                {["Candidate", "Program", "Partner", "Intake", "Course fee", "Fee paid", "Balance", "Commission", "Status"].map((h, i) => (
                  <th key={h} className={`px-sm py-2.5 font-semibold whitespace-nowrap ${[4, 6, 7].includes(i) ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const st = stateOf(e);
                return (
                  <tr key={e.id} tabIndex={0} onClick={() => setOpenId(e.id)} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setOpenId(e.id))} className="border-t border-outline-variant/60 cursor-pointer hover:bg-surface-container-low focus-visible:bg-surface-container-low outline-none">
                    <td className="px-sm py-2.5">
                      <div className="flex items-center gap-1.5 font-semibold">{e.candidateName}{e.leadId ? <span title="Linked to a CRM lead"><Icon name="link" className="text-on-surface-variant" /></span> : null}</div>
                      {e.studentId ? <div className="text-caption text-on-surface-variant">Student ID {e.studentId}</div> : null}
                    </td>
                    <td className="px-sm py-2.5"><ProgramTag code={e.program} /></td>
                    <td className="px-sm py-2.5">{e.partnerName}</td>
                    <td className="px-sm py-2.5 tabular-nums whitespace-nowrap">{e.intakeMonth}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums">{AUD(e.courseFee)}</td>
                    <td className="px-sm py-2.5 min-w-[170px]">
                      <FeeBar e={e} />
                      <div className="text-caption text-on-surface-variant tabular-nums mt-1">{fmtMoney(e.courseFee - e.balance)} of {fmtMoney(e.courseFee)} · {e.payments.length} of {MAX_INSTALLMENTS} installments</div>
                    </td>
                    <td className={`px-sm py-2.5 text-right tabular-nums ${e.balance ? "font-semibold" : "text-on-surface-variant"}`}>{e.balance ? AUD(e.balance) : "—"}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums">{AUD(commissionOf(e.courseFee, e.commissionPct, e.commissionFlat))} <span className="text-caption text-on-surface-variant">{e.commissionFlat != null ? "flat" : `${fmtMoney(e.commissionPct)}%`}</span></td>
                    <td className="px-sm py-2.5">
                      <EnrollmentPill state={st} />
                      {e.invoice ? <div className="text-caption text-on-surface-variant mt-0.5">{e.invoice.number}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-on-surface-variant">Showing {rows.length} of {data.enrollments.length} enrollments. Select a row to record installments.</p>

      {open ? <EnrollmentDrawer key={open.id} ctx={ctx} e={open} onClose={() => setOpenId(null)} /> : null}
      {adding ? (
        <EnrollmentForm
          programs={programOptions(data)}
          today={data.today}
          finance
          onCancel={() => setAdding(false)}
          onCreated={(id, name) => {
            setAdding(false);
            setOpenId(id);
            ctx.done(`${name} added.`);
          }}
        />
      ) : null}
    </div>
  );
}

function EnrollmentDrawer({ ctx, e, onClose }: { ctx: PcCtx; e: EnrollmentDTO; onClose: () => void }) {
  const { data } = ctx;
  const st = stateOf(e);
  const locked = !!e.invoice || e.status === "withdrawn";
  const paid = e.courseFee - e.balance;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState<null | "withdraw" | "delete">(null);
  const base = `/api/finance/partner-commissions/enrollments/${e.id}`;

  async function act(body: Record<string, unknown>, msg: string, close = false): Promise<boolean> {
    setErr(null);
    setBusy(true);
    try {
      await api(base, body);
      if (close) onClose();
      ctx.done(msg);
      return true;
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer onClose={onClose} label="Enrollment details">
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
          <Stat label="Paid" value={AUD(paid)} />
          <Stat label="Balance" value={AUD(e.balance)} warn={e.balance > 0} />
          <div className="col-span-3"><FeeBar e={e} tall /></div>
        </div>

        {e.invoice ? (
          <Callout icon="description">
            On invoice{" "}
            <button className={linkBtnCls} onClick={() => { onClose(); ctx.go("invoices", e.invoice!.id); }}>{e.invoice.number}</button>{" "}
            <InvoicePill status={e.invoice.status} />
          </Callout>
        ) : st === "fullypaid" ? (
          <Callout tone="gold" icon="event_upcoming">Fully paid. It goes on the {fmtDow(data.run.nextRun)} invoice to {e.partnerName}, or use <b>Generate now</b> on the Invoices tab.</Callout>
        ) : e.status === "withdrawn" ? (
          <Callout tone="bad" icon="block">Withdrawn, so it is never invoiced.</Callout>
        ) : null}

        <InstallmentSlots e={e} today={data.today} locked={locked} canRecord busy={busy} act={act} />

        <section className="flex flex-col gap-2">
          <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant">Commission</h4>
          <p>
            <b className="tabular-nums">{AUD(commissionOf(e.courseFee, e.commissionPct, e.commissionFlat))}</b>{" "}
            <span className="text-on-surface-variant">{e.commissionFlat != null ? "flat per enrollment, whatever the course fee" : `= ${fmtMoney(e.commissionPct)}% of ${AUD(e.courseFee)}`}</span>
          </p>
          {locked ? <p className="text-caption text-on-surface-variant">{e.invoice ? "Locked because it's on an invoice. Change the % on the invoice while it's a draft or sent." : ""}</p> : null}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant">Details</h4>
            {!locked && !edit ? <button className={`${linkBtnCls} text-caption`} onClick={() => setEdit(true)}>Edit</button> : null}
          </div>
          {edit ? (
            <EditDetails e={e} today={data.today} busy={busy} onCancel={() => setEdit(false)} onSave={(patch) => act({ action: "update", ...patch }, "Saved.").then((ok) => ok && setEdit(false))} />
          ) : (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-md gap-y-1.5 text-body-md">
              <dt className="text-on-surface-variant">Partner</dt><dd>{e.partnerName}</dd>
              <dt className="text-on-surface-variant">Course</dt><dd>{e.courseName}</dd>
              <dt className="text-on-surface-variant">Intake</dt><dd>{e.intakeMonth}</dd>
              <dt className="text-on-surface-variant">Student ID</dt><dd>{e.studentId ?? "—"}</dd>
              <dt className="text-on-surface-variant">CRM lead</dt><dd>{e.leadId ? <a className={linkBtnCls} href={`/crm/leads/${e.leadId}`}>{e.leadName ?? "Open lead"}</a> : "Not linked"}</dd>
              <dt className="text-on-surface-variant">Added</dt><dd>{fmtDate(e.createdAt)}{e.createdBy ? ` by ${e.createdBy}` : ""}</dd>
              {e.notes ? (<><dt className="text-on-surface-variant">Notes</dt><dd className="whitespace-pre-line">{e.notes}</dd></>) : null}
            </dl>
          )}
        </section>

        {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}

        {!e.invoice ? (
          <section className="border-t border-outline-variant pt-sm flex flex-col gap-2">
            {confirm ? (
              <Callout tone="bad">
                {confirm === "delete" ? "Delete this enrollment? Use this only for one added by mistake." : "Withdrawn enrollments are never invoiced."}{" "}
                <span className="inline-flex gap-2 mt-1">
                  <button className={btnCls} disabled={busy} onClick={() => act({ action: confirm }, confirm === "delete" ? "Enrollment deleted." : `${e.candidateName} marked as withdrawn.`, confirm === "delete")}>
                    {confirm === "delete" ? "Delete" : "Withdraw"}
                  </button>
                  <button className={btnCls} onClick={() => setConfirm(null)}>Keep</button>
                </span>
              </Callout>
            ) : (
              <div className="flex flex-wrap gap-2">
                {e.status === "withdrawn" ? (
                  <button className={btnCls} disabled={busy} onClick={() => act({ action: "reinstate" }, "Reinstated.")}><Icon name="undo" />Reinstate</button>
                ) : (
                  <button className={`${btnCls} !text-error`} onClick={() => setConfirm("withdraw")}><Icon name="block" />Mark as withdrawn</button>
                )}
                {e.payments.length === 0 ? <button className={`${btnCls} !text-error`} onClick={() => setConfirm("delete")}><Icon name="delete" />Delete</button> : null}
              </div>
            )}
          </section>
        ) : null}
      </div>
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

function EditDetails({ e, today, busy, onCancel, onSave }: { e: EnrollmentDTO; today: string; busy: boolean; onCancel: () => void; onSave: (patch: Record<string, unknown>) => void }) {
  const [name, setName] = useState(e.candidateName);
  const [sid, setSid] = useState(e.studentId ?? "");
  const [intake, setIntake] = useState(e.intakeMonth);
  const [fee, setFee] = useState(String(e.courseFee));
  const [pct, setPct] = useState(String(e.commissionPct));
  const [isFlat, setIsFlat] = useState(e.commissionFlat != null);
  const [flat, setFlat] = useState(e.commissionFlat != null ? String(e.commissionFlat) : "");
  const [course, setCourse] = useState(e.courseName);
  const [notes, setNotes] = useState(e.notes ?? "");
  const months = intakeMonthOptions(today);
  if (!months.includes(intake)) months.unshift(intake);
  return (
    <div className="flex flex-col gap-sm">
      <Field label="Candidate name"><input className={inputCls} value={name} onChange={(x) => setName(x.target.value)} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        <Field label="Student ID"><input className={inputCls} value={sid} onChange={(x) => setSid(x.target.value)} /></Field>
        <Field label="Intake month"><select className={inputCls} value={intake} onChange={(x) => setIntake(x.target.value)}>{months.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Course fee (AUD)"><input className={inputCls} type="number" min={1} value={fee} onChange={(x) => setFee(x.target.value)} /></Field>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-label-sm font-semibold text-on-surface-variant">Commission</span>
          <div className="flex gap-2">
            <select className={`${inputCls} !w-28 shrink-0`} aria-label="Commission type" value={isFlat ? "flat" : "pct"} onChange={(x) => setIsFlat(x.target.value === "flat")}>
              <option value="pct">% of fee</option>
              <option value="flat">Flat AUD</option>
            </select>
            {isFlat ? (
              <input className={inputCls} type="number" min={1} step="1" value={flat} onChange={(x) => setFlat(x.target.value)} aria-label="Flat commission (AUD)" />
            ) : (
              <input className={inputCls} type="number" min={0} max={100} step="0.5" value={pct} onChange={(x) => setPct(x.target.value)} aria-label="Commission %" />
            )}
          </div>
        </div>
      </div>
      <Field label="Course name on invoice"><input className={inputCls} value={course} onChange={(x) => setCourse(x.target.value)} /></Field>
      <Field label="Notes"><textarea className={`${inputCls} !h-auto py-2`} rows={2} value={notes} onChange={(x) => setNotes(x.target.value)} /></Field>
      <div className="flex gap-2 justify-end">
        <button className={btnCls} onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          className={primaryBtnCls}
          disabled={busy}
          onClick={() => onSave({ candidateName: name, studentId: sid || null, intakeMonth: intake, courseFee: parseFloat(fee), commissionPct: parseFloat(pct), commissionFlat: isFlat ? parseFloat(flat) : null, courseName: course, notes: notes || null })}
        >
          Save
        </button>
      </div>
    </div>
  );
}
