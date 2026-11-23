"use client";

import { useEffect, useMemo, useState } from "react";
import type { ToInvoiceRow } from "@/lib/invoices/server";
import { SERIES_LABEL, computeInvoiceAmounts, defaultDescription, fyCode, isIndia, seriesKeyFor, type InvoiceEntityCode, type InvoiceKind, type SeriesKey } from "@/lib/invoices/core";
import { GST_STATES, gstStateByName } from "@/lib/invoices/gst-states";
import { Callout, Field, Modal, api, btnCls, fmtDate, inputCls, primaryBtnCls } from "@/components/partner-commissions/ui";
import type { InvoicesPageData } from "./client";
import { money } from "./_util";

/**
 * Issue an invoice for one approved payment. Finance confirms who it's made
 * out to (name as on the passport, address, state), domestic or export, and
 * the line; the totals are worked out live and match what the server will
 * print. Preview shows the exact PDF stamped PREVIEW; Issue numbers it.
 */
export function IssueDialog({
  row,
  data,
  onClose,
  onIssued,
}: {
  row: ToInvoiceRow;
  data: InvoicesPageData;
  onClose: () => void;
  onIssued: (number: string) => void;
}) {
  const entity = (row.entityCode ?? "DIPL") as InvoiceEntityCode;
  const p = row.party;
  const [kind, setKind] = useState<InvoiceKind>(row.expDom === "EXP" ? "EXP" : "DOM");
  const [name, setName] = useState(p?.billingName ?? p?.name ?? "");
  const [address, setAddress] = useState(p?.billingAddress ?? "");
  const [pin, setPin] = useState(p?.billingPin ?? "");
  const [country, setCountry] = useState(p?.billingCountry ?? p?.leadCountry ?? "India");
  const [state, setState] = useState(p?.billingState ?? "");
  const [description, setDescription] = useState(defaultDescription(row.subItem));
  const [invoiceDate, setInvoiceDate] = useState(row.date);
  const [intakeMonth, setIntakeMonth] = useState("");
  const [currency, setCurrency] = useState(entity === "DLLC" ? "AED" : "");
  const [foreignAmount, setForeignAmount] = useState("");
  const [saveToParty, setSaveToParty] = useState(true);
  const [busy, setBusy] = useState<null | "preview" | "issue">(null);
  const [error, setError] = useState<string | null>(null);

  const india = isIndia(country);
  const effective: InvoiceKind = entity === "DLLC" ? "DOM" : kind;
  const wantsForeign = entity === "DLLC" || (effective === "EXP" && (currency.trim() !== "" || foreignAmount.trim() !== ""));
  const st = india ? gstStateByName(state) : null;
  const amounts = useMemo(
    () =>
      computeInvoiceAmounts({
        entity,
        kind: effective,
        receivedInr: row.amount,
        sameState: !!st && st.code === data.issuerStateCode,
        foreign: wantsForeign ? { currency: currency.trim().toUpperCase(), amount: Number(foreignAmount) || 0 } : null,
      }),
    [entity, effective, row.amount, st, data.issuerStateCode, wantsForeign, currency, foreignAmount],
  );
  const seriesKey = seriesKeyFor(entity, effective);

  // The number this invoice gets, asked of the server for this series and
  // invoice date. Issuing sends it back, and the server refuses if the series
  // moved on in between, so the number shown is the number issued.
  const fallbackNumber = /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)
    ? (data.upcomingByFy[fyCode(invoiceDate)]?.[seriesKey] ?? null)
    : null;
  const [checked, setChecked] = useState<{ key: string; number: string } | null>(null);
  const [numberTick, setNumberTick] = useState(0);
  const numberKey = `${seriesKey}|${invoiceDate}`;
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return;
    let live = true;
    const p = new URLSearchParams({ series: seriesKey, date: invoiceDate });
    fetch(`/api/finance/invoices/next-number?${p}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { number?: string } | null) => {
        if (live && j?.number) setChecked({ key: `${seriesKey}|${invoiceDate}`, number: j.number });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [seriesKey, invoiceDate, numberTick]);
  const exactNumber = checked?.key === numberKey ? checked.number : null;
  const shownNumber = exactNumber ?? fallbackNumber;

  const body = {
    transactionId: row.id,
    kind: effective,
    invoiceDate,
    description,
    intakeMonth: effective === "EXP" ? intakeMonth || null : null,
    billTo: { name, address, pin, state: india ? state || null : state || null, country },
    saveToParty,
    foreign: wantsForeign ? { currency: currency.trim().toUpperCase(), amount: Number(foreignAmount) || 0 } : null,
    expectedNumber: exactNumber,
  };

  async function preview() {
    setBusy("preview");
    setError(null);
    // Open the tab now, inside the click, so a popup blocker allows it.
    const win = window.open("", "_blank");
    try {
      const res = await fetch("/api/finance/invoices/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? "Couldn't build the preview.");
      }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.open(url, "_blank");
    } catch (e) {
      win?.close();
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function issue() {
    setBusy("issue");
    setError(null);
    try {
      const res = await api<{ number: string }>("/api/finance/invoices", body);
      onIssued(res.number);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      setNumberTick((t) => t + 1); // the series may have moved on: show the number it would get now
    }
  }

  const warnings: string[] = [];
  if (effective === "EXP" && india) warnings.push("This address is in India. An export invoice needs a foreign address and proof the money came from abroad.");
  if (effective === "EXP" && !data.lutArn) warnings.push("No LUT ARN in Invoice settings, so the export declaration won't print.");
  if (entity === "DIPL" && effective === "DOM" && !india) warnings.push("A domestic invoice needs an address in India. For a candidate abroad, pick Export.");

  return (
    <Modal
      wide
      title="Issue invoice"
      subtitle={`${money(row.amount, "INR")} into ${row.paymentMode} on ${fmtDate(row.date)} · ${p?.name ?? ""}`}
      onClose={onClose}
      footer={
        <>
          <button className={btnCls} onClick={onClose} disabled={!!busy}>
            Close
          </button>
          <button className={btnCls} onClick={preview} disabled={!!busy}>
            {busy === "preview" ? "Building…" : "Preview PDF"}
          </button>
          <button className={primaryBtnCls} onClick={issue} disabled={!!busy || "problem" in amounts}>
            {busy === "issue" ? "Issuing…" : shownNumber ? `Issue ${shownNumber}` : "Issue invoice"}
          </button>
        </>
      }
    >
      {entity === "DLLC" ? (
        <Callout icon="public">
          Wio payment: a DESMA International LLC invoice (D/DLLC series, shared with Partner Commissions), in AED, no tax.
        </Callout>
      ) : (
        <div className="flex gap-2" role="radiogroup" aria-label="Domestic or export">
          {(["DOM", "EXP"] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`flex-1 px-md py-2 rounded-lg border text-left ${kind === k ? "border-primary bg-primary-fixed/40" : "border-outline-variant"}`}
            >
              <div className="font-semibold">{k === "DOM" ? "Domestic (DOM)" : "Export (EXP)"}</div>
              <div className="text-caption text-on-surface-variant">
                {k === "DOM" ? "GST shown separately: CGST + SGST in Kerala, IGST elsewhere" : "No GST; optionally in the candidate's currency"}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-sm sm:grid-cols-2">
        <Field label="Name as on the passport" className="sm:col-span-2">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Address" hint="House, street, post office, district" className="sm:col-span-2">
          <textarea className={`${inputCls} h-20 py-2`} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Country">
          <input className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)} list="invoice-countries" />
        </Field>
        {india ? (
          <Field label="State" hint={entity === "DIPL" && effective === "DOM" ? "Decides CGST + SGST or IGST" : undefined}>
            <select className={inputCls} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Pick the state</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="State / province">
            <input className={inputCls} value={state} onChange={(e) => setState(e.target.value)} />
          </Field>
        )}
        <Field label={india ? "PIN" : "Postcode"}>
          <input className={inputCls} value={pin} onChange={(e) => setPin(e.target.value)} />
        </Field>
        <Field label="Invoice date" hint="Usually the day the money arrived">
          <input type="date" className={inputCls} value={invoiceDate} min={row.date} max={data.today} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
        <Field label="Description" hint="As it should read on the invoice, e.g. AHPRA 2nd Instalment of Initial Payment" className="sm:col-span-2">
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {effective === "EXP" && entity === "DIPL" && (
          <>
            <Field label="Paid in currency" hint="Leave empty to invoice in rupees">
              <input className={inputCls} value={currency} maxLength={3} placeholder="e.g. CAD" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </Field>
            <Field label="Amount in that currency">
              <input className={inputCls} inputMode="decimal" value={foreignAmount} onChange={(e) => setForeignAmount(e.target.value)} />
            </Field>
            <Field label="Intake month" hint="Optional">
              <input className={inputCls} value={intakeMonth} onChange={(e) => setIntakeMonth(e.target.value)} />
            </Field>
          </>
        )}
        {entity === "DLLC" && (
          <Field label="Amount received in AED" hint={`The ledger holds ${money(row.amount, "INR")}`}>
            <input className={inputCls} inputMode="decimal" value={foreignAmount} onChange={(e) => setForeignAmount(e.target.value)} />
          </Field>
        )}
      </div>
      <datalist id="invoice-countries">
        {["India", "Australia", "Canada", "New Zealand", "United Kingdom", "Ireland", "United Arab Emirates", "Saudi Arabia", "Qatar", "Oman", "Kuwait", "Bahrain", "Singapore", "United States"].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-body-md flex flex-col gap-1">
        <div>
          Invoice no.{" "}
          <b className="tabular-nums text-title-sm" data-issue-number>
            {shownNumber ?? "—"}
          </b>
          <span className="text-caption text-on-surface-variant"> · given when you issue; next in the {seriesLabel(seriesKey)} series</span>
        </div>
        {"problem" in amounts ? (
          <span className="text-on-surface-variant">
            {amounts.problem === "foreign_amount_required"
              ? "Enter the amount received in that currency."
              : amounts.problem === "foreign_currency_invalid"
                ? "Enter a three-letter currency code, e.g. CAD."
                : "Check the amounts."}
          </span>
        ) : (
          <div className="flex flex-wrap gap-x-lg gap-y-1 tabular-nums">
            <span>
              Taxable <b>{money(amounts.taxable, amounts.currency)}</b>
            </span>
            {amounts.cgst ? (
              <span>
                CGST 9% <b>{money(amounts.cgst, "INR")}</b> · SGST 9% <b>{money(amounts.sgst, "INR")}</b>
              </span>
            ) : null}
            {amounts.igst ? (
              <span>
                IGST 18% <b>{money(amounts.igst, "INR")}</b>
              </span>
            ) : null}
            <span>
              Total <b>{money(amounts.total, amounts.currency)}</b>
              {amounts.currency !== "INR" ? ` (= ${money(amounts.receivedInr, "INR")} at ${amounts.exchangeRate})` : null}
            </span>
          </div>
        )}
        {entity === "DIPL" && effective === "DOM" && !st ? <div className="text-caption text-on-surface-variant mt-1">Pick the state to see CGST + SGST or IGST.</div> : null}
      </div>

      {warnings.map((w) => (
        <Callout key={w} tone="gold" icon="warning">
          {w}
        </Callout>
      ))}
      <label className="inline-flex items-center gap-2 text-body-md">
        <input type="checkbox" checked={saveToParty} onChange={(e) => setSaveToParty(e.target.checked)} />
        Save the name and address to the candidate for their next invoice
      </label>
      {row.expDom && row.expDom !== effective && entity === "DIPL" ? (
        <p className="text-caption text-on-surface-variant">The ledger entry says {row.expDom}; issuing as {effective} updates it to match.</p>
      ) : null}
      {error ? <Callout tone="bad" icon="error">{error}</Callout> : null}
    </Modal>
  );
}

function seriesLabel(key: SeriesKey): string {
  return key === "DLLC-DOM" ? "UAE" : (SERIES_LABEL[key] ?? key);
}
