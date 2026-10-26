"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AED,
  AUD,
  Callout,
  Field,
  INR,
  Icon,
  InvoicePill,
  Modal,
  Pill,
  ProgramTag,
  api,
  btnCls,
  cardCls,
  fmtDate,
  fmtDow,
  inputCls,
  linkBtnCls,
  primaryBtnCls,
} from "@/components/partner-commissions/ui";
import {
  amountInWords,
  commissionOf,
  fmtInvoiceNumber,
  isEditableInvoice,
  looksLikeSeries,
  openAud,
  round2,
  splitByProgram,
  suggestInvoiceNumber,
} from "@/lib/partner-commissions/logic";
import { LEDGER } from "@/lib/partner-commissions/constants";
import { stateOf, totalOf, type InvoiceDTO, type InvoiceLineDTO, type PcPageData, type ReceiptDTO, type SettingsDTO } from "./_types";
import type { PcCtx } from "./client";

const BASE = "/api/finance/partner-commissions";

export function InvoicesTab({ ctx, invoiceId }: { ctx: PcCtx; invoiceId: string | null }) {
  const inv = invoiceId ? ctx.data.invoices.find((i) => i.id === invoiceId) : null;
  if (inv) return <InvoiceEditor key={`${inv.id}:${inv.status}:${inv.lines.length}`} ctx={ctx} inv={inv} />;
  return <InvoiceList ctx={ctx} />;
}

// ── list ─────────────────────────────────────────────────────────────────────

function InvoiceList({ ctx }: { ctx: PcCtx }) {
  const { data } = ctx;
  const [generating, setGenerating] = useState(false);
  const queued = data.enrollments.filter((e) => stateOf(e) === "fullypaid");
  const qAud = queued.reduce((s, e) => s + commissionOf(e.courseFee, e.commissionPct, e.commissionFlat), 0);
  return (
    <div className="flex flex-col gap-md">
      <div className={`${cardCls} flex flex-wrap items-center gap-md px-md py-sm`}>
        <Icon name="event_repeat" className="!text-[28px] text-accent" />
        <div className="flex-1 min-w-[260px] flex flex-col gap-0.5">
          <b>Monthly run · day {data.settings.runDay} of every month, 08:30 IST</b>
          <p className="text-body-md text-on-surface-variant">
            {data.run.lastRunAt
              ? `Last run ${fmtDate(data.run.lastRunAt.slice(0, 10))} drafted ${data.run.lastRunCount} invoice${data.run.lastRunCount === 1 ? "" : "s"}. `
              : "It hasn't run yet. "}
            Finance Managers, Finance Executives and Admins get a notification{data.settings.emailAlerts ? " and an email" : ""}.
          </p>
          <p className="text-body-md text-on-surface-variant">
            Next run <b className="text-on-surface">{fmtDow(data.run.nextRun)}</b> ·{" "}
            {queued.length ? `${queued.length} fully paid enrollment${queued.length === 1 ? "" : "s"} queued (${AUD(qAud)} commission)` : "nothing queued yet"}.
          </p>
        </div>
        <button className={btnCls} onClick={() => setGenerating(true)} disabled={queued.length === 0} title={queued.length ? "Draft an invoice now instead of waiting for the run" : "Nothing is fully paid and waiting"}>
          <Icon name="bolt" />Generate now
        </button>
      </div>

      {data.invoices.length === 0 ? (
        <div className="p-xl text-center text-on-surface-variant border border-dashed border-outline-variant rounded-xl bg-surface-container-lowest">
          No invoices yet. The monthly run drafts them from fully paid enrollments, or use Generate now.
        </div>
      ) : (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl">
          <table className="w-full min-w-[860px] text-body-md">
            <thead>
              <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                <th className="px-sm py-2.5 font-semibold">Invoice no.</th>
                <th className="px-sm py-2.5 font-semibold">Partner</th>
                <th className="px-sm py-2.5 font-semibold">Invoice date</th>
                <th className="px-sm py-2.5 font-semibold text-right">Lines</th>
                <th className="px-sm py-2.5 font-semibold text-right">Amount</th>
                <th className="px-sm py-2.5 font-semibold">Received</th>
                <th className="px-sm py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => {
                const rc = inv.receipts.filter((r) => r.status !== "returned");
                return (
                  <tr key={inv.id} tabIndex={0} onClick={() => ctx.go("invoices", inv.id)} onKeyDown={(ev) => ev.key === "Enter" && ctx.go("invoices", inv.id)} className="border-t border-outline-variant/60 cursor-pointer hover:bg-surface-container-low outline-none focus-visible:bg-surface-container-low">
                    <td className="px-sm py-2.5"><b className="tabular-nums">{inv.number}</b><div className="text-caption text-on-surface-variant">{inv.source === "monthly_run" ? "Monthly run" : inv.createdBy ? `By ${inv.createdBy}` : "Manual"}</div></td>
                    <td className="px-sm py-2.5">{inv.billToName}</td>
                    <td className="px-sm py-2.5 tabular-nums">{fmtDate(inv.invoiceDate)}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums">{inv.lines.length}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums font-semibold">{AUD(totalOf(inv))}</td>
                    <td className="px-sm py-2.5 tabular-nums">
                      {rc.length ? rc.map((r) => (
                        <div key={r.id}>{AED(r.aedAmount)} · {INR(r.inrAmount)}{r.status === "awaiting" ? <span className="text-caption text-on-surface-variant"> (awaiting)</span> : null}</div>
                      )) : <span className="text-on-surface-variant">—</span>}
                    </td>
                    <td className="px-sm py-2.5"><InvoicePill status={inv.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {generating ? <GenerateModal ctx={ctx} onClose={() => setGenerating(false)} /> : null}
    </div>
  );
}

function GenerateModal({ ctx, onClose }: { ctx: PcCtx; onClose: () => void }) {
  const { data } = ctx;
  const queued = data.enrollments.filter((e) => stateOf(e) === "fullypaid");
  const partnerIds = [...new Set(queued.map((e) => e.partnerId))];
  const [picked, setPicked] = useState<Set<string>>(new Set(queued.map((e) => e.id)));
  const [date, setDate] = useState(data.today);
  const existing = data.invoices.map((i) => i.number);
  const initialNumbers = useMemo(() => {
    const taken = [...existing];
    const out: Record<string, string> = {};
    for (const pid of partnerIds) {
      const n = suggestInvoiceNumber(data.settings.numberPrefix, data.today, taken, data.settings.nextNumber);
      out[pid] = n;
      taken.push(n);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [numbers, setNumbers] = useState<Record<string, string>>(initialNumbers);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setErr(null);
    setBusy(true);
    const made: Array<{ id: string; number: string }> = [];
    try {
      for (const pid of partnerIds) {
        const ids = queued.filter((e) => e.partnerId === pid && picked.has(e.id)).map((e) => e.id);
        if (!ids.length) continue;
        made.push(await api<{ id: string; number: string }>(`${BASE}/invoices`, { partnerId: pid, enrollmentIds: ids, invoiceDate: date, number: numbers[pid] || null }));
      }
      if (!made.length) {
        setErr("Tick at least one enrollment.");
        return;
      }
      onClose();
      if (made.length === 1) ctx.go("invoices", made[0].id);
      ctx.done(`Drafted ${made.map((m) => m.number).join(" and ")}.`);
    } catch (e) {
      setErr(`${e instanceof Error ? e.message : "Couldn't draft the invoice."}${made.length ? ` (${made.map((m) => m.number).join(", ")} was drafted.)` : ""}`);
      if (made.length) ctx.done(`Drafted ${made.map((m) => m.number).join(", ")}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title="Generate invoices now"
      subtitle="One draft per partner from the fully paid enrollments you tick. The monthly run skips anything you invoice here."
      onClose={onClose}
      footer={<><button className={btnCls} onClick={onClose} disabled={busy}>Cancel</button><button className={primaryBtnCls} onClick={go} disabled={busy}>{busy ? "Drafting…" : "Draft invoices"}</button></>}
    >
      <Field label="Invoice date"><input className={`${inputCls} !w-48`} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {partnerIds.map((pid) => {
        const rows = queued.filter((e) => e.partnerId === pid);
        const sum = rows.filter((e) => picked.has(e.id)).reduce((s, e) => s + commissionOf(e.courseFee, e.commissionPct, e.commissionFlat), 0);
        return (
          <div key={pid} className="border border-outline-variant rounded-lg p-sm flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-sm justify-between">
              <b>{rows[0].partnerName}</b>
              <Field label="Invoice number"><input className={`${inputCls} !w-56 tabular-nums`} value={numbers[pid] ?? ""} onChange={(e) => setNumbers({ ...numbers, [pid]: e.target.value })} /></Field>
            </div>
            {rows.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-body-md">
                <input type="checkbox" checked={picked.has(e.id)} onChange={(x) => { const n = new Set(picked); if (x.target.checked) n.add(e.id); else n.delete(e.id); setPicked(n); }} />
                <span className="flex-1">{e.candidateName} <ProgramTag code={e.program} /> <span className="text-caption text-on-surface-variant">fully paid {fmtDate(e.fullyPaidOn)}</span></span>
                <span className="tabular-nums">{AUD(commissionOf(e.courseFee, e.commissionPct, e.commissionFlat))}</span>
              </label>
            ))}
            <div className="text-right text-body-md">Total <b className="tabular-nums">{AUD(sum)}</b></div>
          </div>
        );
      })}
      {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}
    </Modal>
  );
}

// ── editor ───────────────────────────────────────────────────────────────────

type Draft = {
  number: string;
  invoiceDate: string;
  paymentTerm: string;
  billToAddress: string;
  billToEmail: string;
  billToFor: string;
  amountWords: string | null;
  /** Per line: description, and the % or (for a flat line) the AUD amount being edited. */
  lines: Record<string, { description: string; pct: string; flat: string }>;
};

function draftOf(inv: InvoiceDTO): Draft {
  return {
    number: inv.number,
    invoiceDate: inv.invoiceDate,
    paymentTerm: inv.paymentTerm,
    billToAddress: inv.billToAddress,
    billToEmail: inv.billToEmail ?? "",
    billToFor: inv.billToFor ?? "",
    amountWords: inv.amountWords,
    lines: Object.fromEntries(inv.lines.map((l) => [l.id, { description: l.description, pct: String(l.commissionPct), flat: l.commissionFlat != null ? String(l.commissionFlat) : "" }])),
  };
}

function InvoiceEditor({ ctx, inv }: { ctx: PcCtx; inv: InvoiceDTO }) {
  const { data } = ctx;
  const editable = isEditableInvoice(inv.status);
  const [d, setD] = useState<Draft>(() => draftOf(inv));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "delete" | "cancel">(null);
  const [paying, setPaying] = useState(false);
  useEffect(() => setD(draftOf(inv)), [inv]);

  const previewLines: InvoiceLineDTO[] = inv.lines.map((l) => {
    const x = d.lines[l.id];
    const pct = parseFloat(x?.pct ?? "");
    const p = pct >= 0 && pct <= 100 ? pct : l.commissionPct;
    const fl = parseFloat(x?.flat ?? "");
    const f = l.commissionFlat == null ? null : fl > 0 ? fl : l.commissionFlat;
    return { ...l, description: x?.description ?? l.description, commissionPct: p, commissionFlat: f, amount: commissionOf(l.courseFee, p, f) };
  });
  const total = round2(previewLines.reduce((s, l) => s + l.amount, 0));
  const words = d.amountWords ?? amountInWords(total, inv.currency);

  const changes = useMemo(() => {
    const c: Record<string, unknown> = {};
    if (d.number.trim() !== inv.number) c.number = d.number.trim();
    if (d.invoiceDate !== inv.invoiceDate) c.invoiceDate = d.invoiceDate;
    if (d.paymentTerm !== inv.paymentTerm) c.paymentTerm = d.paymentTerm;
    if (d.billToAddress !== inv.billToAddress) c.billToAddress = d.billToAddress;
    if (d.billToEmail !== (inv.billToEmail ?? "")) c.billToEmail = d.billToEmail || null;
    if (d.billToFor !== (inv.billToFor ?? "")) c.billToFor = d.billToFor || null;
    if (d.amountWords !== inv.amountWords) c.amountWords = d.amountWords;
    const lines = inv.lines
      .map((l) => {
        const x = d.lines[l.id];
        const out: { id: string; description?: string; commissionPct?: number; commissionFlat?: number } = { id: l.id };
        if (x && x.description !== l.description) out.description = x.description;
        if (l.commissionFlat != null) {
          const f = parseFloat(x?.flat ?? "");
          if (x && f > 0 && f !== l.commissionFlat) out.commissionFlat = f;
        } else {
          const p = parseFloat(x?.pct ?? "");
          if (x && p >= 0 && p <= 100 && p !== l.commissionPct) out.commissionPct = p;
        }
        return out;
      })
      .filter((l) => Object.keys(l).length > 1);
    if (lines.length) c.lines = lines;
    return c;
  }, [d, inv]);
  const dirty = Object.keys(changes).length > 0;

  async function call(body: Record<string, unknown>, msg: string): Promise<boolean> {
    setErr(null);
    setBusy(true);
    try {
      await api(`${BASE}/invoices/${inv.id}`, body);
      ctx.done(msg);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const save = () => call({ action: "update", ...changes }, "Invoice saved.");
  async function saveThen(next: () => void) {
    if (dirty && !(await save())) return;
    next();
  }

  const addable = data.enrollments.filter((e) => e.partnerId === inv.partnerId && stateOf(e) === "fullypaid");
  const awaiting = inv.receipts.find((r) => r.status === "awaiting");
  const seriesOk = looksLikeSeries(data.settings.numberPrefix, d.number.trim());
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center gap-x-md gap-y-2">
        <button className="basis-full inline-flex items-center gap-1 text-on-surface-variant font-semibold self-start" onClick={() => ctx.go("invoices")}><Icon name="arrow_back" />All invoices</button>
        <div className="flex items-center gap-sm flex-1 min-w-0 flex-wrap">
          <h3 className="text-h3 tabular-nums">{inv.number}</h3>
          <InvoicePill status={inv.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && dirty ? <button className={primaryBtnCls} disabled={busy} onClick={save}><Icon name="save" />Save changes</button> : null}
          {inv.status !== "cancelled" ? (
            <button className={btnCls} disabled={busy} onClick={() => saveThen(() => { window.location.href = `${BASE}/invoices/${inv.id}/pdf`; })}><Icon name="download" />Download PDF</button>
          ) : null}
          {inv.status === "draft" ? (
            <>
              <button className={btnCls} disabled={busy} onClick={() => setConfirm("delete")}><Icon name="delete" />Delete draft</button>
              <button className={dirty ? btnCls : primaryBtnCls} disabled={busy || inv.lines.length === 0} onClick={() => saveThen(() => call({ action: "sent" }, `Marked as sent. Record the payment here when it reaches Wio.`))}><Icon name="send" />Mark as sent</button>
            </>
          ) : null}
          {inv.status === "sent" ? <button className={btnCls} disabled={busy} onClick={() => setConfirm("cancel")}><Icon name="block" />Cancel invoice</button> : null}
          {inv.status === "sent" || inv.status === "partpaid" ? <button className={primaryBtnCls} disabled={busy || dirty} onClick={() => setPaying(true)}><Icon name="payments" />Record payment</button> : null}
          {awaiting ? <button className={primaryBtnCls} onClick={() => ctx.go("payments")}><Icon name="fact_check" />Review payment</button> : null}
        </div>
      </div>

      {confirm ? (
        <Callout tone="bad">
          {confirm === "delete"
            ? `Delete this draft? Its ${inv.lines.length} enrollment${inv.lines.length === 1 ? "" : "s"} go back to the queue for the next run.`
            : "Cancel this invoice? The number stays used and its enrollments go back to the queue. Let the partner know."}{" "}
          <span className="inline-flex gap-2 mt-1">
            <button className={btnCls} disabled={busy} onClick={async () => { if (await call({ action: confirm }, confirm === "delete" ? `Deleted ${inv.number}. Its enrollments are queued again.` : `Cancelled ${inv.number}.`)) { if (confirm === "delete") ctx.go("invoices"); setConfirm(null); } }}>
              {confirm === "delete" ? "Delete draft" : "Cancel invoice"}
            </button>
            <button className={btnCls} onClick={() => setConfirm(null)}>Keep it</button>
          </span>
        </Callout>
      ) : null}

      {inv.status === "draft" ? <Callout tone="gold" icon="edit_note">{inv.source === "monthly_run" ? `Drafted by the ${fmtDate(inv.createdAt.slice(0, 10))} monthly run. ` : ""}Check it, download the PDF, send it to {inv.billToName}, then mark it as sent.</Callout> : null}
      {inv.status === "sent" ? <Callout icon="info">Sent {fmtDate(inv.sentAt?.slice(0, 10))}. You can still edit it; download it again and resend if you do. Record the payment when it reaches Wio.</Callout> : null}
      {inv.status === "awaiting" ? <Callout tone="gold" icon="hourglass_top">A payment is recorded and waiting for a Finance Manager. The invoice is locked until it&apos;s approved or sent back.</Callout> : null}
      {inv.status === "partpaid" ? <Callout icon="info">Part-paid: {AUD(openAud(total, inv.receipts))} still open. Record the next payment when it arrives.</Callout> : null}
      {inv.status === "paid" ? <Callout tone="ok" icon="check_circle">Paid. The commission is posted to Revenue (details below). The invoice is locked.</Callout> : null}
      {inv.status === "cancelled" ? <Callout tone="bad" icon="block">Cancelled {fmtDate(inv.cancelledAt?.slice(0, 10))}. The number stays used; its enrollments went back to the queue.</Callout> : null}
      {err ? <Callout tone="bad" icon="error">{err}</Callout> : null}

      <div className="grid gap-md items-start grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className={`${cardCls} p-md flex flex-col gap-sm`}>
          <Field label="Invoice number" hint={editable ? (seriesOk ? `DesGro suggests the next number in ${data.settings.numberPrefix}YY-YY/NNN. Change it if that number was used outside DesGro.` : "This doesn't follow the usual series. Check it before you send.") : "Locked once a payment is recorded."}>
            <input className={`${inputCls} tabular-nums`} value={d.number} disabled={!editable} onChange={(e) => set({ number: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-sm">
            <Field label="Invoice date"><input className={inputCls} type="date" value={d.invoiceDate} disabled={!editable} onChange={(e) => e.target.value && set({ invoiceDate: e.target.value })} /></Field>
            <Field label="Payment term"><input className={inputCls} value={d.paymentTerm} disabled={!editable} onChange={(e) => set({ paymentTerm: e.target.value })} /></Field>
          </div>
          <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant mt-1">Bill to · {inv.billToName}</h4>
          <Field label="Address"><textarea className={`${inputCls} !h-auto py-2`} rows={3} value={d.billToAddress} disabled={!editable} onChange={(e) => set({ billToAddress: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-sm">
            <Field label="Email"><input className={inputCls} value={d.billToEmail} disabled={!editable} onChange={(e) => set({ billToEmail: e.target.value })} /></Field>
            <Field label='"For" line'><input className={inputCls} value={d.billToFor} placeholder="Optional" disabled={!editable} onChange={(e) => set({ billToFor: e.target.value })} /></Field>
          </div>
          <h4 className="text-label-sm uppercase tracking-wider text-on-surface-variant mt-1">Lines ({inv.lines.length})</h4>
          {inv.lines.length === 0 ? <p className="text-caption text-on-surface-variant">No lines left. Delete this draft, or add a fully paid enrollment below.</p> : null}
          {inv.lines.map((l) => {
            const x = d.lines[l.id] ?? { description: l.description, pct: String(l.commissionPct), flat: l.commissionFlat != null ? String(l.commissionFlat) : "" };
            const pv = previewLines.find((p) => p.id === l.id)!;
            return (
              <div key={l.id} className="border border-outline-variant rounded-lg px-sm py-2 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <ProgramTag code={l.program} />
                  <span className="text-caption text-on-surface-variant flex-1 truncate">{l.intakeMonth}{l.studentId ? ` · ${l.studentId}` : ""}</span>
                  {editable ? (
                    <button className="h-7 w-7 grid place-items-center rounded hover:bg-surface-container" title="Remove from this invoice" aria-label={`Remove ${l.description}`} disabled={busy || dirty} onClick={() => call({ action: "remove-line", lineId: l.id }, "Line removed. That enrollment is queued again.")}>
                      <Icon name="close" />
                    </button>
                  ) : null}
                </div>
                <input className={`${inputCls} !h-8 text-[13px]`} value={x.description} disabled={!editable} aria-label="Line description" onChange={(e) => set({ lines: { ...d.lines, [l.id]: { ...x, description: e.target.value } } })} />
                {l.commissionFlat != null ? (
                  <div className="flex items-center gap-1.5 text-[13px] flex-wrap">
                    <span className="text-on-surface-variant tabular-nums">Fee {fmtInvoiceNumber(l.courseFee)} · Flat AUD</span>
                    <input className={`${inputCls} !h-8 !w-24 tabular-nums`} type="number" min={1} step="1" value={x.flat} disabled={!editable} aria-label="Flat commission (AUD)" onChange={(e) => set({ lines: { ...d.lines, [l.id]: { ...x, flat: e.target.value } } })} />
                    <b className="ml-auto tabular-nums">{AUD(pv.amount)}</b>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[13px] flex-wrap">
                    <span className="text-on-surface-variant tabular-nums">Fee {fmtInvoiceNumber(l.courseFee)} ×</span>
                    <input className={`${inputCls} !h-8 !w-20 tabular-nums`} type="number" min={0} max={100} step="0.5" value={x.pct} disabled={!editable} aria-label="Commission %" onChange={(e) => set({ lines: { ...d.lines, [l.id]: { ...x, pct: e.target.value } } })} />
                    <span className="text-on-surface-variant">%</span>
                    <b className="ml-auto tabular-nums">{AUD(pv.amount)}</b>
                  </div>
                )}
              </div>
            );
          })}
          {editable && addable.length ? (
            <Field label="Add a fully paid enrollment">
              <select className={inputCls} value="" disabled={busy || dirty} onChange={(e) => e.target.value && call({ action: "add-line", enrollmentId: e.target.value }, "Line added.")}>
                <option value="">Choose…</option>
                {addable.map((e) => <option key={e.id} value={e.id}>{e.candidateName} · {e.program} · {AUD(commissionOf(e.courseFee, e.commissionPct, e.commissionFlat))}</option>)}
              </select>
            </Field>
          ) : null}
          <div className="flex justify-between items-baseline px-sm py-2 rounded-lg bg-primary-fixed/40 border border-primary-container">
            <span>Total</span><b className="text-h3 tabular-nums">{AUD(total)}</b>
          </div>
          <Field label="Amount in words" hint={editable ? (d.amountWords == null ? "Filled in from the total. Edit it if you need different wording." : <button className={linkBtnCls} onClick={() => set({ amountWords: null })}>Reset to automatic</button>) : undefined}>
            <input className={inputCls} value={words} disabled={!editable} onChange={(e) => set({ amountWords: e.target.value })} />
          </Field>
          {editable && dirty ? <p className="text-caption text-amber-700">Unsaved changes. Download and Mark as sent save them first.</p> : null}
        </div>

        <div className="overflow-x-auto rounded-xl bg-surface-container border border-outline-variant p-md">
          <InvoicePaper inv={inv} draft={d} lines={previewLines} total={total} words={words} settings={data.settings} />
        </div>
      </div>

      <ReceiptsCard inv={inv} />
      {paying ? <RecordPaymentModal ctx={ctx} inv={inv} onClose={() => setPaying(false)} /> : null}
    </div>
  );
}

function ReceiptsCard({ inv }: { inv: InvoiceDTO }) {
  if (!inv.receipts.length) return null;
  return (
    <div className={`${cardCls} p-md flex flex-col gap-sm`}>
      <div className="flex justify-between items-baseline gap-sm flex-wrap"><h4 className="font-semibold">Payments on this invoice</h4><span className="text-caption text-on-surface-variant">Into Wio Bank (AED)</span></div>
      {inv.receipts.map((r) => (
        <div key={r.id} className="flex flex-col gap-1.5 border-t border-outline-variant/60 pt-sm first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <b className="tabular-nums">{AED(r.aedAmount)}</b>
            <span className="text-caption text-on-surface-variant tabular-nums">received {fmtDate(r.receivedOn)} · settles {AUD(r.audSettled)} · AED→INR {r.aedInrRate.toFixed(4)} · {INR(r.inrAmount)}{r.reference ? ` · ref ${r.reference}` : ""}</span>
            {r.status === "approved" ? <Pill tone="ok">Approved{r.reviewedBy ? ` by ${r.reviewedBy}` : ""}{r.reviewedAt ? `, ${fmtDate(r.reviewedAt.slice(0, 10))}` : ""}</Pill> : r.status === "awaiting" ? <Pill tone="warn">Awaiting approval</Pill> : <Pill tone="bad">Sent back</Pill>}
          </div>
          {r.status === "returned" ? <p className="text-caption">Reason: {r.reviewNote ?? "No reason given"}</p> : null}
          {r.status === "approved" ? <LedgerRows inv={inv} r={r} /> : null}
        </div>
      ))}
    </div>
  );
}

/** The Revenue rows a receipt posts (or posted): the INR value split by program. */
export function LedgerRows({ inv, r }: { inv: InvoiceDTO; r: ReceiptDTO }) {
  if (r.skipLedger) return <p className="text-caption text-on-surface-variant">Marked as already in the ledger, so nothing was posted.</p>;
  const parts = splitByProgram(inv.lines, r.inrAmount).filter((p) => p.inr > 0);
  return (
    <div className="overflow-x-auto border border-outline-variant rounded-lg">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="bg-surface-container-low text-left text-[10.5px] uppercase tracking-wider text-on-surface-variant">
            {["Date", "Type", "Category › Sub-item", "Mode", "EXP/DOM", "Party", "Amount"].map((h) => <th key={h} className={`px-2 py-1.5 font-semibold ${h === "Amount" ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.program} className="border-t border-outline-variant/60">
              <td className="px-2 py-1.5 tabular-nums">{fmtDate(r.receivedOn)}</td>
              <td className="px-2 py-1.5">{LEDGER.type}</td>
              <td className="px-2 py-1.5">{LEDGER.category} › {LEDGER.subItem(p.program)}</td>
              <td className="px-2 py-1.5">{LEDGER.paymentMode}</td>
              <td className="px-2 py-1.5">{LEDGER.expDom}</td>
              <td className="px-2 py-1.5">{inv.billToName}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{INR(p.inr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── record payment ───────────────────────────────────────────────────────────

export function lastRate(data: PcPageData): { rate: number; date: string } | null {
  const rs = data.invoices.flatMap((i) => i.receipts).filter((r) => r.status !== "returned").sort((a, b) => (a.receivedOn < b.receivedOn ? 1 : -1));
  return rs[0] ? { rate: Number(rs[0].aedInrRate.toFixed(4)), date: rs[0].receivedOn } : null;
}

function RecordPaymentModal({ ctx, inv, onClose }: { ctx: PcCtx; inv: InvoiceDTO; onClose: () => void }) {
  const { data } = ctx;
  const total = totalOf(inv);
  const open = openAud(total, inv.receipts);
  const lr = lastRate(data);
  const [receivedOn, setReceivedOn] = useState(data.today);
  const [aud, setAud] = useState(String(open));
  const [aed, setAed] = useState("");
  const [rate, setRate] = useState(lr ? String(lr.rate) : "");
  const [inr, setInr] = useState("");
  const [ref, setRef] = useState("");
  const [settle, setSettle] = useState(true);
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const aedN = parseFloat(aed);
  const audN = parseFloat(aud);
  function onAed(v: string) {
    setAed(v);
    const a = parseFloat(v), r = parseFloat(rate);
    if (a > 0 && r > 0) setInr(String(Math.round(a * r)));
  }
  function onRate(v: string) {
    setRate(v);
    const r = parseFloat(v);
    if (aedN > 0 && r > 0) setInr(String(Math.round(aedN * r)));
  }
  function onInr(v: string) {
    setInr(v);
    const i = parseFloat(v);
    if (aedN > 0 && i > 0) setRate((i / aedN).toFixed(4));
  }

  async function submit() {
    setErr(null);
    if (!(aedN > 0)) return setErr("Enter the AED credited in Wio.");
    if (!(audN > 0)) return setErr("Enter how much of the invoice (AUD) this payment settles.");
    if (audN > open + 0.005) return setErr(`That's more than the ${AUD(open)} still open on this invoice.`);
    const inrN = parseFloat(inr);
    if (!(inrN > 0)) return setErr("Enter the AED → INR rate or the INR value.");
    setBusy(true);
    try {
      const res = await api<{ approved: boolean }>(`${BASE}/invoices/${inv.id}`, {
        action: "record-payment",
        receivedOn,
        audSettled: audN,
        aedAmount: aedN,
        inrAmount: inrN,
        reference: ref || null,
        settleInFull: settle,
        skipLedger: skip,
        approveNow: data.canApprove,
      });
      onClose();
      if (res.approved) ctx.done(skip ? "Recorded and approved. Nothing posted: it's already in the ledger." : `Recorded and approved. ${INR(inrN)} posted to Revenue › Commissions.`);
      else {
        ctx.go("payments");
        ctx.done("Sent for approval. Finance Managers have been notified.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Record payment"
      subtitle={`${inv.number} · ${inv.billToName} · invoice ${AUD(total)}${open !== total ? ` · ${AUD(open)} still open` : ""}`}
      onClose={onClose}
      footer={<><button className={btnCls} onClick={onClose} disabled={busy}>Cancel</button><button className={primaryBtnCls} onClick={submit} disabled={busy}>{busy ? "Saving…" : data.canApprove ? "Record and approve" : "Send for approval"}</button></>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        <Field label="Received on"><input className={inputCls} type="date" max={data.today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></Field>
        <Field label="Into account"><input className={inputCls} value="Wio Bank · AED" disabled /></Field>
        <Field label="AUD this payment settles"><input className={inputCls} type="number" min={0.01} step="0.01" value={aud} onChange={(e) => setAud(e.target.value)} /></Field>
        <Field label="AED credited in Wio"><input className={inputCls} type="number" min={0.01} step="0.01" value={aed} onChange={(e) => onAed(e.target.value)} placeholder="As shown in Wio" autoFocus /></Field>
      </div>
      <p className="text-caption text-on-surface-variant tabular-nums">{aedN > 0 && audN > 0 ? `AUD→AED ${(aedN / audN).toFixed(4)} on this payment.` : "Enter the AED credited to see the AUD→AED rate."}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
        <Field label="AED → INR rate"><input className={inputCls} type="number" min={0.0001} step="0.0001" value={rate} onChange={(e) => onRate(e.target.value)} /></Field>
        <Field label="INR value"><input className={inputCls} type="number" min={1} step="1" value={inr} onChange={(e) => onInr(e.target.value)} placeholder="Fills in from the rate" /></Field>
      </div>
      <p className="text-caption text-on-surface-variant">Change either one and the other follows. This INR value is what posts to Revenue after approval.{lr ? ` Last rate used: ${lr.rate} on ${fmtDate(lr.date)}.` : ""}</p>
      <Field label="Bank reference"><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Wio transaction reference" /></Field>
      <label className="flex gap-2 items-start text-body-md">
        <input type="checkbox" className="mt-1" checked={settle} onChange={(e) => setSettle(e.target.checked)} />
        <span><b>Settle this invoice in full</b><span className="block text-caption text-on-surface-variant">Leave ticked when the partner paid the whole invoice and the AED is short only because of bank charges or the rate.</span></span>
      </label>
      <label className="flex gap-2 items-start text-body-md">
        <input type="checkbox" className="mt-1" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
        <span><b>Already in the ledger</b><span className="block text-caption text-on-surface-variant">Only for invoices paid before DesGro tracked them: approving marks it paid without posting Revenue again.</span></span>
      </label>
      {err ? <p className="text-body-md text-error font-medium">{err}</p> : null}
    </Modal>
  );
}

// ── the paper preview (mirrors the PDF) ──────────────────────────────────────

function slash(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function InvoicePaper({ inv, draft, lines, total, words, settings }: { inv: InvoiceDTO; draft: Draft; lines: InvoiceLineDTO[]; total: number; words: string; settings: SettingsDTO }) {
  const detailed = inv.layout === "detailed";
  const head = detailed ? ["DESCRIPTION", "Student ID", "Course", "Intake Month", "Course Fee", "Commission%", "Amount"] : ["DESCRIPTION", "Intake Month", "Course Fee", "Commission%", "Amount"];
  const band = "bg-[#F6CB47]";
  const cell = "border border-[#a0a0a0] px-1 py-[3px]";
  const short = (settings.issuerName || "us").replace(/\s+(LLC|L\.L\.C\.?|Ltd\.?|Limited|Pvt\.?\s*Ltd\.?|Private Limited)$/i, "");
  return (
    <div className="relative mx-auto min-w-[600px] max-w-[760px] bg-white text-[#333] shadow-md px-[34px] pl-[70px] pt-6 pb-6 text-[11.5px] leading-[1.42] font-sans">
      <div className={`${band} -ml-[46px] -mr-[10px] text-center font-bold text-[15px] py-0.5`}>INVOICE</div>
      <div className="absolute left-[18px] top-[250px] text-[#EDBE35] text-[22px] whitespace-nowrap [writing-mode:vertical-rl] rotate-180">{draft.number}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/desma-logo.png" alt="" className="w-[84px] h-[84px] mt-4 mb-2.5" />
      <div><b className="block text-[14px]">{(settings.issuerName || "Invoice issuer (set in Settings)").toUpperCase()}</b>{settings.issuerAddress}<br />{settings.issuerRegLine}</div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 mt-10">
        <div>
          <b className="block text-[12.5px]">BILL TO</b>
          <div className="text-black">{inv.billToName}</div>
          <div className="whitespace-pre-line">{draft.billToAddress}</div>
          {draft.billToEmail ? <div>{draft.billToEmail}</div> : null}
          {draft.billToFor ? <div>FOR: {draft.billToFor}</div> : null}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-2 gap-y-0.5 content-start">
          <dt className="font-bold text-right">Invoice No:</dt><dd>{draft.number}</dd>
          <dt className="font-bold text-right">Invoice Date:</dt><dd>{slash(draft.invoiceDate)}</dd>
          <dt className="font-bold text-right">Payment Term:</dt><dd>{draft.paymentTerm}</dd>
          <dt className="font-bold text-right">Currency:</dt><dd>{inv.currency}</dd>
        </dl>
      </div>
      <table className="w-full border-separate [border-spacing:2px] border border-[#a0a0a0] mt-3.5">
        <thead><tr>{head.map((h, i) => <th key={h} className={`${band} ${cell} text-left font-bold text-[11px] whitespace-nowrap ${i === head.length - 1 ? "text-center" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {lines.length === 0 ? <tr><td colSpan={head.length} className={`${cell} text-center text-[#888]`}>No lines</td></tr> : null}
          {lines.map((l) => (
            <tr key={l.id}>
              <td className={cell}>{l.description}</td>
              {detailed ? <><td className={cell}>{l.studentId ?? ""}</td><td className={`${cell} text-center`}>{l.courseName}</td></> : null}
              <td className={cell}>{l.intakeMonth}</td>
              <td className={`${cell} text-center`}>{fmtInvoiceNumber(l.courseFee)}</td>
              <td className={`${cell} text-center`}>{l.commissionFlat != null ? "Flat" : `${fmtInvoiceNumber(l.commissionPct)}%`}</td>
              <td className={`${cell} text-center`}>{fmtInvoiceNumber(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-[minmax(0,1fr)_230px] gap-3 mt-0.5">
        <div>
          <span className="block text-[#555] mt-1">Amount in Words:</span>
          <b className="block mt-1">{words}</b>
          <span className="block text-[#555] mt-2">Thank you for choosing {short}!</span>
        </div>
        <table className="w-full border-separate [border-spacing:2px] border border-[#a0a0a0] h-fit">
          <tbody>
            <tr><td className={`${cell} h-5`} /><td className={`${cell} h-5`} /></tr>
            <tr><td className={`${cell} text-right font-bold`}>Total</td><td className={`${cell} ${band} text-center font-bold text-[15px]`}>{inv.currency} {fmtInvoiceNumber(total)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="mt-4 text-[11px] text-[#4a4a4a]">
        {settings.bankAccountName || settings.bankIban ? (
          <>
            Bank Account<br />
            {settings.bankAccountName ? <>{settings.bankAccountName}<br /></> : null}
            {settings.bankCurrency ? <>ACCOUNT CURRENCY: {settings.bankCurrency}<br /></> : null}
            {settings.bankIban ? <>IBAN:{settings.bankIban}<br /></> : null}
            {settings.bankBic ? <>BIC/SWIFT:{settings.bankBic}<br /></> : null}
            {settings.bankAccountNo ? <>ACCOUNT NUMBER:{settings.bankAccountNo}</> : null}
          </>
        ) : (
          <span className="text-[#b45309]">Bank details not set. Add them in Settings.</span>
        )}
      </div>
      <div className="flex flex-col items-end -mt-2 font-bold">
        {settings.issuerName ? <span>For {settings.issuerName}</span> : null}
        {settings.hasSignature ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${BASE}/settings/signature`} alt="Signature" className="max-w-[120px] max-h-[48px] mr-4 my-1" />
        ) : (
          <span className="h-12" />
        )}
        <span>{settings.signatoryName}</span>
      </div>
      <div className="flex flex-col gap-[22px] mt-6"><div className={`${band} h-4 -ml-[46px] -mr-[10px]`} /><div className={`${band} h-4 -ml-[46px] -mr-[10px]`} /></div>
      {inv.status === "cancelled" ? <div className="absolute inset-0 grid place-items-center pointer-events-none"><span className="text-[72px] font-bold text-red-600/20 -rotate-[30deg]">CANCELLED</span></div> : null}
    </div>
  );
}
