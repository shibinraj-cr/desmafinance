"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { InvoiceDTO, InvoiceSettings, ToInvoiceRow } from "@/lib/invoices/server";
import { SERIES_KEYS, SERIES_LABEL } from "@/lib/invoices/core";
import {
  Callout,
  Icon,
  Modal,
  Pill,
  api,
  btnCls,
  cardCls,
  fmtDate,
  inputCls,
  linkBtnCls,
  primaryBtnCls,
  useToast,
} from "@/components/partner-commissions/ui";
import { IssueDialog } from "./_issue";
import { SettingsTab } from "./_settings";
import { downloadCsv, money } from "./_util";

export type InvoicesPageData = {
  today: string;
  month: string;
  canManage: boolean;
  toInvoice: ToInvoiceRow[];
  issued: InvoiceDTO[];
  settings: InvoiceSettings;
  upcoming: Record<string, string>;
  gapsByBank: Record<string, string[]>;
  issuerStateCode: string | null;
  lutArn: string | null;
};

type Tab = "to-invoice" | "issued" | "not-invoiced" | "settings";

export function InvoicesClient({ data, initialTab, page }: { data: InvoicesPageData; initialTab: string; page: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { show, node } = useToast();
  const [tab, setTab] = useState<Tab>(initialTab as Tab);

  useEffect(() => {
    window.history.replaceState(null, "", tab === "to-invoice" ? pathname : `${pathname}?tab=${tab}`);
  }, [tab, pathname]);

  const done = useCallback(
    (msg: string) => {
      show(msg);
      router.refresh();
    },
    [router, show],
  );

  const tabs: Array<[Tab, string, number]> = [
    ["to-invoice", "To invoice", data.toInvoice.length],
    ["issued", "Issued", 0],
    ["not-invoiced", "Not invoiced", 0],
    ["settings", "Settings", 0],
  ];

  return (
    <div className="p-md md:p-margin flex flex-col gap-lg" data-page={page}>
      <div className="flex gap-1 border-b border-outline-variant overflow-x-auto" role="tablist" aria-label="Sections">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-md py-2.5 -mb-px border-b-[3px] text-body-md font-semibold whitespace-nowrap inline-flex items-center gap-2 ${tab === key ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
          >
            {label}
            {count ? <span className="text-[11px] px-2 rounded-full bg-primary text-on-primary">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "to-invoice" && <ToInvoiceTab data={data} done={done} goSettings={() => setTab("settings")} />}
      {tab === "issued" && <IssuedTab data={data} done={done} />}
      {tab === "not-invoiced" && <NotInvoicedTab data={data} />}
      {tab === "settings" && <SettingsTab data={data} done={done} />}
      {node}
    </div>
  );
}

// ── To invoice ───────────────────────────────────────────────────────────────

function ToInvoiceTab({ data, done, goSettings }: { data: InvoicesPageData; done: (m: string) => void; goSettings: () => void }) {
  const [issuing, setIssuing] = useState<ToInvoiceRow | null>(null);
  const activeGaps = data.settings.banks
    .filter((b) => b.isActive && (data.gapsByBank[b.paymentMode] ?? []).length)
    .map((b) => [b.paymentMode, data.gapsByBank[b.paymentMode]] as const);

  return (
    <div className="flex flex-col gap-md">
      {!data.settings.startsOn ? (
        <Callout tone="gold" icon="event">
          <b>In-app invoicing hasn&apos;t started.</b> Payments appear here once a start date is set: the 1st of the month after this
          went live, as agreed. Until then, keep raising invoices the usual way.{" "}
          {data.canManage ? (
            <button className={linkBtnCls} onClick={goSettings}>
              Set the start date
            </button>
          ) : (
            "A Finance Manager sets it in Settings."
          )}
        </Callout>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          Approved candidate payments into Axis, HDFC or Wio from {fmtDate(data.settings.startsOn)} on, oldest first. Issuing gives
          the invoice its number and stores the PDF; the BDE and Ops can then download it from the lead.
        </p>
      )}
      {activeGaps.length > 0 && (
        <Callout tone="bad" icon="settings">
          <b>Invoice settings aren&apos;t complete.</b>
          <ul className="list-disc pl-5 mt-1">
            {activeGaps.map(([bank, gaps]) => (
              <li key={bank}>
                {bank}: {gaps.join("; ")}
              </li>
            ))}
          </ul>
          {data.canManage ? (
            <button className={linkBtnCls} onClick={goSettings}>
              Open Settings
            </button>
          ) : (
            "A Finance Manager completes these in Settings."
          )}
        </Callout>
      )}

      <section className={`${cardCls} overflow-hidden`}>
        {data.toInvoice.length === 0 ? (
          <p className="p-lg text-center text-on-surface-variant">
            {data.settings.startsOn ? "Nothing to invoice: every payment so far has its invoice." : "Nothing to show yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead>
                <tr className="text-left text-label-sm text-on-surface-variant border-b border-outline-variant">
                  <th className="px-md py-2 font-semibold">Paid on</th>
                  <th className="px-md py-2 font-semibold">Candidate</th>
                  <th className="px-md py-2 font-semibold">Paid into</th>
                  <th className="px-md py-2 font-semibold text-right">Amount</th>
                  <th className="px-md py-2 font-semibold">For</th>
                  <th className="px-md py-2 font-semibold">BDE</th>
                  <th className="px-md py-2" />
                </tr>
              </thead>
              <tbody>
                {data.toInvoice.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant/60 last:border-0">
                    <td className="px-md py-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-md py-2">
                      {r.party?.leadId ? (
                        <Link href={`/crm/leads/${r.party.leadId}`} className="font-semibold text-on-surface hover:underline">
                          {r.party.name}
                        </Link>
                      ) : (
                        <span className="font-semibold">{r.party?.name}</span>
                      )}
                      {r.party?.billingName && r.party.billingName !== r.party.name ? (
                        <div className="text-caption text-on-surface-variant">Passport: {r.party.billingName}</div>
                      ) : null}
                    </td>
                    <td className="px-md py-2 whitespace-nowrap">
                      {r.paymentMode}
                      {r.entityCode ? <div className="text-caption text-on-surface-variant">{r.entityCode === "DLLC" ? "UAE invoice" : `India · ${r.expDom ?? "DOM?"}`}</div> : null}
                    </td>
                    <td className="px-md py-2 text-right tabular-nums font-semibold">{money(r.amount, "INR")}</td>
                    <td className="px-md py-2 text-on-surface-variant">{r.subItem}</td>
                    <td className="px-md py-2 text-on-surface-variant whitespace-nowrap">{r.party?.bde ?? "—"}</td>
                    <td className="px-md py-2 text-right">
                      {r.pendingChange ? (
                        <div className="flex flex-col items-end gap-1">
                          <Pill tone="warn">{r.pendingChange === "delete" ? "Deletion" : "Change"} waiting for approval</Pill>
                          <span className="text-caption text-on-surface-variant">Settle it in Approvals first</span>
                        </div>
                      ) : (
                        <button className={primaryBtnCls} onClick={() => setIssuing(r)}>
                          <Icon name="receipt_long" />
                          Issue invoice
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {issuing && (
        <IssueDialog
          row={issuing}
          data={data}
          onClose={() => setIssuing(null)}
          onIssued={(number) => {
            setIssuing(null);
            done(`Invoice ${number} issued.`);
          }}
        />
      )}
    </div>
  );
}

// ── Issued ───────────────────────────────────────────────────────────────────

function IssuedTab({ data, done }: { data: InvoicesPageData; done: (m: string) => void }) {
  const [month, setMonth] = useState(data.month);
  const [series, setSeries] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<InvoiceDTO[]>(data.issued);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams();
    if (month) p.set("month", month);
    if (series) p.set("series", series);
    if (status) p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    try {
      const res = await api<{ items: InvoiceDTO[] }>(`/api/finance/invoices?${p}`, undefined, "GET");
      setItems(res.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month, series, status, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const totals = useMemo(() => {
    const live = items.filter((i) => i.status === "issued" && i.currency === "INR");
    const sum = (f: (i: InvoiceDTO) => number) => live.reduce((s, i) => s + f(i), 0);
    return { taxable: sum((i) => i.taxable), gst: sum((i) => i.cgst + i.sgst + i.igst), total: sum((i) => i.total), received: items.filter((i) => i.status === "issued").reduce((s, i) => s + i.receivedInr, 0) };
  }, [items]);

  function exportCsv() {
    downloadCsv(`invoices-${month || "all"}.csv`, [
      ["Invoice No", "Invoice Date", "Status", "Series", "Kind", "Company", "Billed To", "Place of Supply", "Currency", "Taxable", "CGST", "SGST", "IGST", "Total", "Received (INR)", "Exchange Rate", "Paid Into", "Description", "Cancel Reason"],
      ...items.map((i) => [
        i.number,
        i.invoiceDate,
        i.status,
        i.seriesKey,
        i.kind,
        i.entityCode,
        i.billToName,
        i.placeOfSupply ?? "",
        i.currency,
        i.taxable,
        i.cgst,
        i.sgst,
        i.igst,
        i.total,
        i.receivedInr,
        i.exchangeRate,
        i.paymentMode,
        i.description,
        i.cancelReason ?? "",
      ]),
    ]);
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap gap-sm items-end">
        <label className="flex flex-col gap-1">
          <span className="text-label-sm font-semibold text-on-surface-variant">Invoice month</span>
          <input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-sm font-semibold text-on-surface-variant">Series</span>
          <select className={inputCls} value={series} onChange={(e) => setSeries(e.target.value)}>
            <option value="">All</option>
            {SERIES_KEYS.map((k) => (
              <option key={k} value={k}>
                {SERIES_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-sm font-semibold text-on-surface-variant">Status</span>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="issued">Issued</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 grow min-w-[200px]">
          <span className="text-label-sm font-semibold text-on-surface-variant">Search</span>
          <input className={inputCls} placeholder="Number or name" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className={btnCls} onClick={exportCsv} disabled={!items.length}>
          <Icon name="download" />
          Export CSV
        </button>
      </div>
      {month === "" ? <p className="text-caption text-on-surface-variant">Showing the latest 300. Pick a month for that month&apos;s full register.</p> : null}
      {error ? <Callout tone="bad" icon="error">{error}</Callout> : null}

      <section className={`${cardCls} overflow-hidden`} aria-busy={loading}>
        {items.length === 0 ? (
          <p className="p-lg text-center text-on-surface-variant">{loading ? "Loading…" : "No invoices for this filter."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead>
                <tr className="text-left text-label-sm text-on-surface-variant border-b border-outline-variant">
                  <th className="px-md py-2 font-semibold">Invoice</th>
                  <th className="px-md py-2 font-semibold">Date</th>
                  <th className="px-md py-2 font-semibold">Billed to</th>
                  <th className="px-md py-2 font-semibold text-right">Taxable</th>
                  <th className="px-md py-2 font-semibold text-right">GST</th>
                  <th className="px-md py-2 font-semibold text-right">Total</th>
                  <th className="px-md py-2 font-semibold">Status</th>
                  <th className="px-md py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-outline-variant/60 last:border-0 align-top">
                    <td className="px-md py-2 whitespace-nowrap">
                      <span className="font-semibold tabular-nums">{i.number}</span>
                      <div className="text-caption text-on-surface-variant">
                        {i.entityCode === "DLLC" ? "UAE" : i.kind === "EXP" ? "Export" : "Domestic"} · {i.paymentMode}
                      </div>
                    </td>
                    <td className="px-md py-2 whitespace-nowrap">{fmtDate(i.invoiceDate)}</td>
                    <td className="px-md py-2">
                      {i.billToName}
                      {i.placeOfSupply ? <div className="text-caption text-on-surface-variant">{i.placeOfSupply}</div> : null}
                    </td>
                    <td className="px-md py-2 text-right tabular-nums">{money(i.taxable, i.currency)}</td>
                    <td className="px-md py-2 text-right tabular-nums">
                      {i.cgst + i.sgst + i.igst ? money(i.cgst + i.sgst + i.igst, i.currency) : "—"}
                      {i.igst ? <div className="text-caption text-on-surface-variant">IGST</div> : i.cgst ? <div className="text-caption text-on-surface-variant">CGST + SGST</div> : null}
                    </td>
                    <td className="px-md py-2 text-right tabular-nums font-semibold">
                      {money(i.total, i.currency)}
                      {i.currency !== "INR" ? <div className="text-caption text-on-surface-variant font-normal">{money(i.receivedInr, "INR")}</div> : null}
                    </td>
                    <td className="px-md py-2">
                      {i.status === "cancelled" ? (
                        <span title={i.cancelReason ?? undefined}>
                          <Pill tone="bad">Cancelled</Pill>
                        </span>
                      ) : (
                        <Pill tone="ok">Issued</Pill>
                      )}
                    </td>
                    <td className="px-md py-2 text-right whitespace-nowrap">
                      <a className={linkBtnCls} href={`/api/invoices/${i.id}/download`}>
                        Download
                      </a>
                      {data.canManage && i.status === "issued" ? (
                        <button className={`${linkBtnCls} ml-3 !text-error`} onClick={() => setCancelling(i)}>
                          Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-outline-variant text-label-sm text-on-surface-variant">
                  <td className="px-md py-2 font-semibold" colSpan={3}>
                    Issued in rupees
                  </td>
                  <td className="px-md py-2 text-right tabular-nums">{money(totals.taxable, "INR")}</td>
                  <td className="px-md py-2 text-right tabular-nums">{money(totals.gst, "INR")}</td>
                  <td className="px-md py-2 text-right tabular-nums">{money(totals.total, "INR")}</td>
                  <td className="px-md py-2" colSpan={2}>
                    Received, all issued: {money(totals.received, "INR")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
      {cancelling && (
        <CancelDialog
          invoice={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            void load();
            done(`Invoice ${cancelling.number} cancelled. The payment can be invoiced again.`);
          }}
        />
      )}
    </div>
  );
}

function CancelDialog({ invoice, onClose, onDone }: { invoice: InvoiceDTO; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const monthName = new Date(`${invoice.invoiceDate}T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/finance/invoices/${invoice.id}/cancel`, { reason });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Cancel invoice ${invoice.number}?`}
      subtitle={`${invoice.billToName} · ${money(invoice.total, invoice.currency)}`}
      onClose={onClose}
      footer={
        <>
          <button className={btnCls} onClick={onClose}>
            Keep it
          </button>
          <button className={`${primaryBtnCls} !bg-error`} onClick={submit} disabled={busy || reason.trim().length < 5}>
            {busy ? "Cancelling…" : "Cancel invoice"}
          </button>
        </>
      }
    >
      <Callout tone="gold" icon="info">
        The number {invoice.number} stays used and shows as cancelled; it is never given to another invoice. The payment can then be
        corrected and invoiced again. If {monthName}&apos;s GSTR-1 is already filed, ask the CA first: it may need a credit note instead.
      </Callout>
      <label className="flex flex-col gap-1">
        <span className="text-label-sm font-semibold text-on-surface-variant">Why is it being cancelled?</span>
        <textarea className={`${inputCls} h-24 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong candidate address" />
      </label>
      {error ? <Callout tone="bad" icon="error">{error}</Callout> : null}
    </Modal>
  );
}

// ── Not invoiced (for the CA) ────────────────────────────────────────────────

type NotInvoicedRow = { id: string; date: string; amount: number; paymentMode: string; subItem: string; party: { id: string; name: string } | null; reason: string };

function NotInvoicedTab({ data }: { data: InvoicesPageData }) {
  const [month, setMonth] = useState(data.month);
  const [items, setItems] = useState<NotInvoicedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setItems(null);
    setError(null);
    api<{ items: NotInvoicedRow[] }>(`/api/finance/invoices/not-invoiced?month=${month}`, undefined, "GET")
      .then((r) => live && setItems(r.items))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [month]);
  const total = (items ?? []).reduce((s, r) => s + r.amount, 0);
  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-md text-on-surface-variant">
        Candidate payments in the month with no invoice: Cash, UPI, card, RCS and STR receipts (recorded, not invoiced, as decided), and
        bank payments still waiting for an invoice. Send this list to the CA with the month&apos;s invoice register.
      </p>
      <div className="flex flex-wrap gap-sm items-end">
        <label className="flex flex-col gap-1">
          <span className="text-label-sm font-semibold text-on-surface-variant">Payment month</span>
          <input type="month" className={inputCls} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        <button
          className={btnCls}
          disabled={!items?.length}
          onClick={() =>
            downloadCsv(`not-invoiced-${month}.csv`, [
              ["Paid On", "Candidate", "Paid Into", "Amount (INR)", "For", "Why no invoice"],
              ...(items ?? []).map((r) => [r.date, r.party?.name ?? "", r.paymentMode, r.amount, r.subItem, r.reason]),
            ])
          }
        >
          <Icon name="download" />
          Export CSV
        </button>
      </div>
      {error ? <Callout tone="bad" icon="error">{error}</Callout> : null}
      <section className={`${cardCls} overflow-hidden`}>
        {items === null ? (
          <p className="p-lg text-center text-on-surface-variant">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-lg text-center text-on-surface-variant">Every candidate payment in this month has an invoice.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead>
                <tr className="text-left text-label-sm text-on-surface-variant border-b border-outline-variant">
                  <th className="px-md py-2 font-semibold">Paid on</th>
                  <th className="px-md py-2 font-semibold">Candidate</th>
                  <th className="px-md py-2 font-semibold">Paid into</th>
                  <th className="px-md py-2 font-semibold text-right">Amount</th>
                  <th className="px-md py-2 font-semibold">For</th>
                  <th className="px-md py-2 font-semibold">Why no invoice</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant/60 last:border-0">
                    <td className="px-md py-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="px-md py-2">{r.party?.name ?? "—"}</td>
                    <td className="px-md py-2 whitespace-nowrap">{r.paymentMode}</td>
                    <td className="px-md py-2 text-right tabular-nums">{money(r.amount, "INR")}</td>
                    <td className="px-md py-2 text-on-surface-variant">{r.subItem}</td>
                    <td className="px-md py-2">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-outline-variant text-label-sm text-on-surface-variant">
                  <td className="px-md py-2 font-semibold" colSpan={3}>
                    {items.length} payment{items.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-md py-2 text-right tabular-nums">{money(total, "INR")}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
