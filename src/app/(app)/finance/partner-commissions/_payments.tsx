"use client";

import { useState } from "react";
import { AED, AUD, Callout, Field, INR, Icon, Pill, api, btnCls, cardCls, fmtDate, inputCls, linkBtnCls, primaryBtnCls } from "@/components/partner-commissions/ui";
import { splitByProgram } from "@/lib/partner-commissions/logic";
import { LEDGER } from "@/lib/partner-commissions/constants";
import { totalOf, type InvoiceDTO, type ReceiptDTO } from "./_types";
import { LedgerRows } from "./_invoices";
import type { PcCtx } from "./client";

type Row = { inv: InvoiceDTO; r: ReceiptDTO };

export function PaymentsTab({ ctx }: { ctx: PcCtx }) {
  const { data } = ctx;
  const all: Row[] = data.invoices.flatMap((inv) => inv.receipts.map((r) => ({ inv, r })));
  const awaiting = all.filter((x) => x.r.status === "awaiting");
  const returned = all.filter((x) => x.r.status === "returned" && !x.inv.receipts.some((y) => y.recordedAt > x.r.recordedAt));
  const posted = all.filter((x) => x.r.status === "approved").sort((a, b) => ((a.r.reviewedAt ?? "") < (b.r.reviewedAt ?? "") ? 1 : -1));
  const [sel, setSel] = useState<string | null>(null);
  // The picked payment, or the first one waiting (also after the picked one is approved).
  const current = awaiting.find((x) => x.r.id === sel) ?? awaiting[0] ?? null;

  const th = "px-sm py-2.5 font-semibold whitespace-nowrap";
  return (
    <div className="flex flex-col gap-md">
      <div className="flex justify-between items-baseline"><h4 className="font-semibold text-body-lg">Awaiting approval</h4><span className="text-caption text-on-surface-variant">{awaiting.length} payment{awaiting.length === 1 ? "" : "s"}</span></div>
      {awaiting.length === 0 ? (
        <div className="p-lg text-center text-on-surface-variant border border-dashed border-outline-variant rounded-xl bg-surface-container-lowest">Nothing waiting. Payments recorded from an invoice land here for a Finance Manager to approve.</div>
      ) : (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl">
          <table className="w-full min-w-[900px] text-body-md">
            <thead>
              <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                <th className={th}>Invoice</th><th className={th}>Partner</th><th className={th}>Received</th>
                <th className={`${th} text-right`}>AUD settled</th><th className={`${th} text-right`}>AED credited</th>
                <th className={`${th} text-right`}>AUD→AED</th><th className={`${th} text-right`}>AED→INR</th><th className={`${th} text-right`}>INR value</th><th className={th}>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {awaiting.map(({ inv, r }) => (
                <tr key={r.id} tabIndex={0} onClick={() => setSel(r.id)} onKeyDown={(e) => e.key === "Enter" && setSel(r.id)} className={`border-t border-outline-variant/60 cursor-pointer outline-none ${r.id === current?.r.id ? "bg-primary-fixed/40" : "hover:bg-surface-container-low"}`}>
                  <td className="px-sm py-2.5 font-semibold tabular-nums">{inv.number}</td>
                  <td className="px-sm py-2.5">{inv.billToName}</td>
                  <td className="px-sm py-2.5 tabular-nums">{fmtDate(r.receivedOn)}</td>
                  <td className="px-sm py-2.5 text-right tabular-nums">{AUD(r.audSettled)}</td>
                  <td className="px-sm py-2.5 text-right tabular-nums">{AED(r.aedAmount)}</td>
                  <td className="px-sm py-2.5 text-right tabular-nums">{(r.aedAmount / r.audSettled).toFixed(4)}</td>
                  <td className="px-sm py-2.5 text-right tabular-nums">{r.aedInrRate.toFixed(4)}</td>
                  <td className="px-sm py-2.5 text-right tabular-nums font-semibold">{INR(r.inrAmount)}</td>
                  <td className="px-sm py-2.5">{r.recordedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {current ? <ReviewCard key={current.r.id} ctx={ctx} row={current} /> : null}

      {returned.length ? (
        <>
          <h4 className="font-semibold text-body-lg">Sent back</h4>
          <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl">
            <table className="w-full min-w-[640px] text-body-md">
              <thead><tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant"><th className={th}>Invoice</th><th className={`${th} text-right`}>AED</th><th className={`${th} text-right`}>INR</th><th className={th}>Reason</th><th className={th} /></tr></thead>
              <tbody>
                {returned.map(({ inv, r }) => (
                  <tr key={r.id} className="border-t border-outline-variant/60">
                    <td className="px-sm py-2.5 tabular-nums">{inv.number}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums">{AED(r.aedAmount)}</td>
                    <td className="px-sm py-2.5 text-right tabular-nums">{INR(r.inrAmount)}</td>
                    <td className="px-sm py-2.5">{r.reviewNote ?? "No reason given"}{r.reviewedBy ? <span className="text-caption text-on-surface-variant"> · {r.reviewedBy}</span> : null}</td>
                    <td className="px-sm py-2.5"><button className={linkBtnCls} onClick={() => ctx.go("invoices", inv.id)}>Record again</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="flex justify-between items-baseline"><h4 className="font-semibold text-body-lg">Posted to Revenue</h4><span className="text-caption text-on-surface-variant">Approved payments, newest first</span></div>
      {posted.length === 0 ? (
        <div className="p-lg text-center text-on-surface-variant border border-dashed border-outline-variant rounded-xl bg-surface-container-lowest">No approved payments yet.</div>
      ) : (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl">
          <table className="w-full min-w-[900px] text-body-md">
            <thead>
              <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
                <th className={th}>Approved</th><th className={th}>Invoice</th><th className={th}>Partner</th><th className={`${th} text-right`}>AED</th><th className={`${th} text-right`}>AED→INR</th><th className={`${th} text-right`}>INR</th><th className={th}>Revenue rows</th><th className={th}>By</th>
              </tr>
            </thead>
            <tbody>
              {posted.map(({ inv, r }) => (
                <tr key={r.id} tabIndex={0} onClick={() => ctx.go("invoices", inv.id)} onKeyDown={(e) => e.key === "Enter" && ctx.go("invoices", inv.id)} className="border-t border-outline-variant/60 cursor-pointer hover:bg-surface-container-low outline-none">
                  <td className="px-sm py-2.5 tabular-nums">{fmtDate(r.reviewedAt?.slice(0, 10))}</td>
                  <td className="px-sm py-2.5 tabular-nums">{inv.number}</td>
                  <td className="px-sm py-2.5">{inv.billToName}</td>
                  <td className="px-sm py-2.5 text-right tabular-nums">{AED(r.aedAmount)}</td>
                  <td className="px-sm py-2.5 text-right tabular-nums">{r.aedInrRate.toFixed(4)}</td>
                  <td className="px-sm py-2.5 text-right tabular-nums font-semibold">{INR(r.inrAmount)}</td>
                  <td className="px-sm py-2.5 text-caption">
                    {r.skipLedger ? "Already in the ledger" : splitByProgram(inv.lines, r.inrAmount).filter((p) => p.inr > 0).map((p) => <div key={p.program}>{LEDGER.subItem(p.program)} {INR(p.inr)}</div>)}
                  </td>
                  <td className="px-sm py-2.5">{r.reviewedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ ctx, row }: { ctx: PcCtx; row: Row }) {
  const { data } = ctx;
  const { inv, r } = row;
  const [aed, setAed] = useState(String(r.aedAmount));
  const [rate, setRate] = useState(r.aedInrRate.toFixed(4));
  const [inr, setInr] = useState(String(r.inrAmount));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const aedN = parseFloat(aed);
  const inrN = parseFloat(inr);
  const edited = aedN !== r.aedAmount || inrN !== r.inrAmount;
  const preview: ReceiptDTO = { ...r, aedAmount: aedN > 0 ? aedN : r.aedAmount, inrAmount: inrN > 0 ? inrN : r.inrAmount, aedInrRate: parseFloat(rate) || r.aedInrRate };
  const mixed = splitByProgram(inv.lines, 1).length > 1;

  function onAed(v: string) {
    setAed(v);
    const a = parseFloat(v), x = parseFloat(rate);
    if (a > 0 && x > 0) setInr(String(Math.round(a * x)));
  }
  function onRate(v: string) {
    setRate(v);
    const x = parseFloat(v);
    if (aedN > 0 && x > 0) setInr(String(Math.round(aedN * x)));
  }
  function onInr(v: string) {
    setInr(v);
    const i = parseFloat(v);
    if (aedN > 0 && i > 0) setRate((i / aedN).toFixed(4));
  }

  async function act(body: Record<string, unknown>, msg: string) {
    setErr(null);
    setBusy(true);
    try {
      await api(`/api/finance/partner-commissions/receipts/${r.id}`, body);
      ctx.done(msg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  const figures = edited ? { aedAmount: aedN, inrAmount: inrN } : {};

  return (
    <div className={`${cardCls} !border-primary-container p-md flex flex-col gap-sm`}>
      <div className="flex flex-wrap justify-between gap-sm">
        <div>
          <h4 className="font-semibold text-body-lg">Review payment · <span className="tabular-nums">{inv.number}</span></h4>
          <p className="text-caption text-on-surface-variant">{inv.billToName} · received {fmtDate(r.receivedOn)} · recorded by {r.recordedBy ?? "—"} on {fmtDate(r.recordedAt.slice(0, 10))}{r.reference ? ` · ref ${r.reference}` : ""}</p>
        </div>
        <Pill tone="warn">Awaiting approval</Pill>
      </div>
      <div className="grid gap-sm grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
        <div className="flex flex-col gap-1"><span className="text-label-sm font-semibold text-on-surface-variant">Invoice</span><b className="tabular-nums py-2">{AUD(totalOf(inv))}</b></div>
        <Field label="AED credited in Wio"><input className={inputCls} type="number" step="0.01" value={aed} onChange={(e) => onAed(e.target.value)} /></Field>
        <Field label="AED → INR rate"><input className={inputCls} type="number" step="0.0001" value={rate} onChange={(e) => onRate(e.target.value)} /></Field>
        <Field label="INR value"><input className={inputCls} type="number" step="1" value={inr} onChange={(e) => onInr(e.target.value)} /></Field>
      </div>
      <p className="text-caption text-on-surface-variant tabular-nums">
        Settles {AUD(r.audSettled)} · AUD→AED {(preview.aedAmount / r.audSettled).toFixed(4)}{r.settleInFull ? " · closes the invoice in full" : ""}
      </p>
      {r.skipLedger ? (
        <Callout tone="gold" icon="info">Marked as <b>already in the ledger</b> (paid before DesGro tracked it). Approving marks the invoice paid without posting Revenue.</Callout>
      ) : (
        <>
          <h5 className="text-label-sm uppercase tracking-wider text-on-surface-variant">Posts to Revenue on approval</h5>
          <LedgerRows inv={inv} r={preview} />
          <p className="text-caption text-on-surface-variant">Only DESMA&apos;s commission is booked. The course fees candidates paid {inv.billToName} stay out of the ledger.{mixed ? " This invoice mixes programs, so the INR is split in proportion to each program's commission." : ""}</p>
        </>
      )}
      {err ? <Callout tone="bad" icon="error">{err}</Callout> : null}
      <div className="flex flex-wrap items-center gap-sm justify-between">
        {data.canApprove ? (
          <>
            <input className={`${inputCls} flex-1 min-w-[220px]`} placeholder="Reason, if you send it back" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason for sending back" />
            <div className="flex gap-2">
              <button className={btnCls} disabled={busy} onClick={() => act({ action: "send-back", note: note || null }, "Sent back to whoever recorded it.")}>Send back</button>
              <button className={primaryBtnCls} disabled={busy || !(aedN > 0) || !(inrN > 0)} onClick={() => act({ action: "approve", ...figures }, r.skipLedger ? "Approved. Marked paid without posting." : `Approved. ${INR(preview.inrAmount)} posted to Revenue › Commissions.`)}>
                <Icon name="check" />Approve and post to Revenue
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-caption text-on-surface-variant inline-flex items-center gap-1"><Icon name="lock" />Only a Finance Manager or Admin can approve. You can still correct the figures.</span>
            <button className={btnCls} disabled={busy || !edited} onClick={() => act({ action: "update", ...figures }, "Figures updated.")}>Save figures</button>
          </>
        )}
      </div>
    </div>
  );
}
