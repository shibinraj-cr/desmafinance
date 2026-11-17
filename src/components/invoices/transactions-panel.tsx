"use client";

import { useEffect, useState } from "react";
import type { PartyTransactions } from "@/lib/invoices/server";
import { Callout, Icon, Pill, cardCls, fmtDate, type Tone } from "@/components/partner-commissions/ui";

/**
 * A candidate's money, read-only: package, instalment plan, payments with
 * their GST invoices (download), and payments waiting for Finance. Used by
 * the CRM lead's Transactions tab and the Ops project page. The server
 * decides who may see it; bank references never reach anyone but Finance.
 */

type Loaded = Extract<PartyTransactions, { empty: false }>;

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const SCHEDULE_TONE: Record<string, [Tone, string]> = {
  paid: ["ok", "Paid"],
  submitted: ["info", "With Finance"],
  due: ["neutral", "Due"],
  overdue: ["bad", "Overdue"],
  cancelled: ["neutral", "Cancelled"],
  planned: ["neutral", "Planned"],
};

/** A payment not in the ledger yet: approval queue, or an enrollment Finance hasn't verified. */
const PENDING_TONE: Record<string, [Tone, string]> = {
  pending: ["warn", "Waiting for Finance"],
  sent_back: ["bad", "Sent back to BDE"],
  not_received: ["bad", "Finance: money not received"],
};

export function TransactionsPanel({ url, compact = false }: { url: string; compact?: boolean }) {
  const [state, setState] = useState<{ loading: boolean; data: PartyTransactions | null; error: string | null }>({
    loading: true,
    data: null,
    error: null,
  });
  useEffect(() => {
    let live = true;
    fetch(url)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.message ?? "Couldn't load the payments.");
        return j as PartyTransactions;
      })
      .then((data) => live && setState({ loading: false, data, error: null }))
      .catch((e: Error) => live && setState({ loading: false, data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [url]);

  if (state.loading) return <p className="text-body-md text-on-surface-variant py-md">Loading payments…</p>;
  if (state.error) return <Callout tone="bad" icon="error">{state.error}</Callout>;
  const d = state.data;
  if (!d || d.empty) {
    return (
      <Callout icon="receipt_long">
        {d?.partyId ? "You can see payments for your own candidates only." : "No payments yet: this lead isn't enrolled."}
      </Callout>
    );
  }
  return <Body d={d} compact={compact} />;
}

function Body({ d, compact }: { d: Loaded; compact: boolean }) {
  const invoiceCount = d.payments.reduce((s, p) => s + p.invoices.filter((i) => i.status === "issued").length, 0);
  return (
    <div className="flex flex-col gap-md">
      <section className="grid gap-sm grid-cols-[repeat(auto-fit,minmax(150px,1fr))]" aria-label="Summary">
        <Stat label="Package" value={inr(d.totals.package)} sub={d.services.map((s) => s.name).join(" · ") || "No service recorded"} />
        <Stat label="Paid so far" value={inr(d.totals.paid)} sub={`${d.payments.length} payment${d.payments.length === 1 ? "" : "s"}`} />
        <Stat label="Balance" value={inr(d.totals.balance)} sub={d.pending.length ? `${d.pending.length} waiting for Finance` : " "} />
        <Stat label="Invoices" value={String(invoiceCount)} sub="GST invoices issued" />
      </section>

      <section className={`${cardCls} overflow-hidden`}>
        <h4 className="px-md pt-sm pb-xs text-label-sm font-bold text-on-surface-variant uppercase tracking-wide">Payments</h4>
        {d.payments.length === 0 && d.pending.length === 0 ? (
          <p className="px-md pb-md text-body-md text-on-surface-variant">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead>
                <tr className="text-left text-label-sm text-on-surface-variant border-b border-outline-variant">
                  <th className="px-md py-2 font-semibold">Date</th>
                  <th className="px-md py-2 font-semibold text-right">Amount</th>
                  <th className="px-md py-2 font-semibold">Paid into</th>
                  {!compact && <th className="px-md py-2 font-semibold">For</th>}
                  <th className="px-md py-2 font-semibold">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id} className="border-b border-outline-variant/60 last:border-0 align-top">
                    <td className="px-md py-2 whitespace-nowrap">
                      {fmtDate(p.date)}
                      {p.isHistorical && (
                        <span className="ml-1.5">
                          <Pill tone="neutral">Before DesGro</Pill>
                        </span>
                      )}
                    </td>
                    <td className="px-md py-2 text-right tabular-nums font-semibold">{inr(p.amount)}</td>
                    <td className="px-md py-2 whitespace-nowrap">{p.paymentMode}</td>
                    {!compact && (
                      <td className="px-md py-2">
                        <span className="text-on-surface">{p.kind}</span>
                        <span className="text-on-surface-variant"> · {p.subItem}</span>
                        {p.description ? <div className="text-caption text-on-surface-variant">{p.description}</div> : null}
                      </td>
                    )}
                    <td className="px-md py-2">
                      <InvoiceLinks invoices={p.invoices} mode={p.paymentMode} beforeInApp={p.isHistorical || !d.invoicingStartsOn || p.date < d.invoicingStartsOn} />
                    </td>
                  </tr>
                ))}
                {d.pending.map((p) => (
                  <tr key={p.id} className="border-b border-outline-variant/60 last:border-0 text-on-surface-variant">
                    <td className="px-md py-2 whitespace-nowrap">{p.date ? fmtDate(p.date) : "—"}</td>
                    <td className="px-md py-2 text-right tabular-nums">{inr(p.amount)}</td>
                    <td className="px-md py-2 whitespace-nowrap">{p.paymentMode}</td>
                    {!compact && <td className="px-md py-2">—</td>}
                    <td className="px-md py-2">
                      <Pill tone={(PENDING_TONE[p.state] ?? PENDING_TONE.pending)[0]}>{(PENDING_TONE[p.state] ?? PENDING_TONE.pending)[1]}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d.schedule.length > 0 && (
        <section className={`${cardCls} overflow-hidden`}>
          <h4 className="px-md pt-sm pb-xs text-label-sm font-bold text-on-surface-variant uppercase tracking-wide">Instalment plan</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead>
                <tr className="text-left text-label-sm text-on-surface-variant border-b border-outline-variant">
                  <th className="px-md py-2 font-semibold">#</th>
                  <th className="px-md py-2 font-semibold">Due</th>
                  <th className="px-md py-2 font-semibold text-right">Amount</th>
                  <th className="px-md py-2 font-semibold">Status</th>
                  {!compact && <th className="px-md py-2 font-semibold">Plan</th>}
                </tr>
              </thead>
              <tbody>
                {d.schedule.map((i) => {
                  const [tone, label] = SCHEDULE_TONE[i.state] ?? ["neutral", i.state];
                  return (
                    <tr key={i.id} className="border-b border-outline-variant/60 last:border-0">
                      <td className="px-md py-2 tabular-nums">{i.seq}</td>
                      <td className="px-md py-2 whitespace-nowrap">{fmtDate(i.due)}</td>
                      <td className="px-md py-2 text-right tabular-nums">{inr(i.amount)}</td>
                      <td className="px-md py-2">
                        <Pill tone={tone}>{label}</Pill>
                      </td>
                      {!compact && <td className="px-md py-2 text-on-surface-variant">{i.plan}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function InvoiceLinks({ invoices, mode, beforeInApp }: { invoices: Loaded["payments"][number]["invoices"]; mode: string; beforeInApp: boolean }) {
  if (invoices.length === 0) {
    const banked = ["Axis Bank", "HDFC Bank", "Wio Bank"].includes(mode);
    // Bank payments from before in-app invoicing got their invoice outside DesGro.
    const label = !banked ? "Not invoiced" : beforeInApp ? "Raised outside DesGro" : "Not issued yet";
    return <span className="text-caption text-on-surface-variant">{label}</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {invoices.map((i) => (
        <a
          key={i.id}
          href={`/api/invoices/${i.id}/download`}
          className={`inline-flex items-center gap-1 font-semibold underline underline-offset-2 ${i.status === "cancelled" ? "text-on-surface-variant line-through" : "text-accent"}`}
          title={i.status === "cancelled" ? "Cancelled: download the stamped copy" : "Download the invoice PDF"}
        >
          <Icon name="download" />
          {i.number}
        </a>
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={`${cardCls} px-md py-sm`}>
      <div className="text-label-sm text-on-surface-variant">{label}</div>
      <div className="text-h3 text-on-surface tabular-nums">{value}</div>
      <div className="text-caption text-on-surface-variant truncate" title={sub}>
        {sub}
      </div>
    </div>
  );
}
