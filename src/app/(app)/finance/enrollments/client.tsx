"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EnrollmentDTO, EnrollmentTab } from "@/lib/crm-enrollment";
import {
  ENROLL_BANKS,
  ENROLLMENT_STATUS_LABEL,
  MIN_FIRST_PAYMENT,
  PAYER_RELATIONS,
  approveBlocker,
  balanceOf,
  describePlan,
  enrollmentChanges,
  financeProblems,
  formatField,
  nextException,
  planTotal,
  splitBalance,
  suggestedExpDom,
  type EnrollmentFields,
  type PlanRow,
} from "@/lib/crm-enroll-confirm";
import { formatEnrollDate } from "@/lib/crm-enroll-date";
import { PAYMENT_MODES } from "@/lib/catalog";
import { GST_STATES } from "@/lib/invoices/gst-states";
import { defaultDescription, isIndia } from "@/lib/invoices/core";
import { Callout, Drawer, Field, Icon, Pill, api, btnCls, cardCls, inputCls, primaryBtnCls, useToast } from "@/components/partner-commissions/ui";

export type EnrollmentsPageData = {
  today: string;
  tab: EnrollmentTab;
  rows: EnrollmentDTO[];
  counts: Record<"verify" | "sent-back" | "not-received", number>;
  canApprove: boolean;
  categories: Array<{ name: string; subItems: string[] }>;
  /** Per bank: why approving can't issue the invoice too ("" when it can). */
  invoiceBlock: Record<string, string>;
  invoiceStartsOn: string | null;
  bankEntity: Record<string, string>;
};

const TABS: Array<[EnrollmentTab, string]> = [
  ["verify", "To verify"],
  ["sent-back", "Sent back"],
  ["not-received", "Money not received"],
  ["verified", "Verified"],
];

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
/** A calendar day ("2026-11-10") as is; a timestamp as its IST day. */
const date = (iso: string | null) =>
  iso ? formatEnrollDate(iso.length <= 10 ? iso : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso))) : "—";

export function EnrollmentsClient({ data }: { data: EnrollmentsPageData }) {
  const router = useRouter();
  const { show, node } = useToast();
  const [open, setOpen] = useState<EnrollmentDTO | null>(null);

  return (
    <div className="p-margin flex flex-col gap-md">
      <div className="flex gap-1 border-b border-outline-variant overflow-x-auto" role="tablist" aria-label="Sections">
        {TABS.map(([key, label]) => {
          const count = key === "verified" ? 0 : data.counts[key];
          return (
            <Link
              key={key}
              role="tab"
              aria-selected={data.tab === key}
              href={key === "verify" ? "?" : `?tab=${key}`}
              className={`px-md py-2.5 -mb-px border-b-[3px] text-body-md font-semibold whitespace-nowrap inline-flex items-center gap-2 ${data.tab === key ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface"}`}
            >
              {label}
              {count ? <span className="text-[11px] px-2 rounded-full bg-primary text-on-primary">{count}</span> : null}
            </Link>
          );
        })}
      </div>

      {data.tab === "verify" && (
        <Callout icon="info">
          Each enrollment counts from the day the money landed, and the BDE&apos;s incentive counts it once you verify it (by the 7th of the next
          month). Check the payment against the bank, correct anything that&apos;s wrong (the BDE is told), then approve: the first payment goes into
          the ledger and the balance plan becomes the collection plan.
        </Callout>
      )}

      {data.rows.length === 0 ? (
        <p className="text-body-md text-on-surface-variant py-md">Nothing here.</p>
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-body-md">
            <thead>
              <tr className="text-left text-label-sm text-on-surface-variant border-b border-outline-variant">
                <th className="px-md py-2 font-semibold">Candidate</th>
                <th className="px-md py-2 font-semibold">BDE</th>
                <th className="px-md py-2 font-semibold text-right">First payment</th>
                <th className="px-md py-2 font-semibold">Paid into</th>
                <th className="px-md py-2 font-semibold text-right">Total</th>
                <th className="px-md py-2 font-semibold">Flags</th>
                <th className="px-md py-2" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b border-outline-variant/60 last:border-0 align-top">
                  <td className="px-md py-2">
                    <Link href={`/crm/leads/${r.leadId}`} className="font-semibold text-accent hover:underline">
                      {r.candidateName}
                    </Link>
                    <div className="text-caption text-on-surface-variant">
                      {r.serviceName} · submitted {date(r.createdAt)}
                    </div>
                  </td>
                  <td className="px-md py-2 whitespace-nowrap">{r.ownerName ?? r.submittedByName ?? "—"}</td>
                  <td className="px-md py-2 text-right tabular-nums whitespace-nowrap">
                    {r.fields.firstAmount != null ? inr(r.fields.firstAmount) : "—"}
                    <div className="text-caption text-on-surface-variant">{date(r.fields.paidOn)}</div>
                  </td>
                  <td className="px-md py-2 whitespace-nowrap">
                    {r.fields.paymentMode ?? "—"}
                    {r.fields.utr ? <div className="text-caption text-on-surface-variant">UTR {r.fields.utr}</div> : null}
                  </td>
                  <td className="px-md py-2 text-right tabular-nums">{inr(r.fields.totalAmount)}</td>
                  <td className="px-md py-2">
                    <Flags r={r} />
                  </td>
                  <td className="px-md py-2 text-right">
                    <button type="button" className={btnCls} onClick={() => setOpen(r)}>
                      {data.tab === "verified" ? "View" : "Review"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Review
          key={open.id}
          row={open}
          data={data}
          onClose={() => setOpen(null)}
          onDone={(msg) => {
            setOpen(null);
            show(msg);
            router.refresh();
          }}
        />
      )}
      {node}
    </div>
  );
}

function Flags({ r }: { r: EnrollmentDTO }) {
  return (
    <div className="flex flex-wrap gap-1">
      {r.repeat && <Pill tone="info">Re-enrollment</Pill>}
      {r.fields.firstAmount == null && <Pill tone="bad">No payment details</Pill>}
      {r.exception === "pending" && <Pill tone="warn">Under {inr(MIN_FIRST_PAYMENT)}: sales head</Pill>}
      {r.exception === "approved" && <Pill tone="ok">Small first payment approved</Pill>}
      {r.exception === "rejected" && <Pill tone="bad">Small first payment rejected</Pill>}
      {!r.fields.billingAddress && r.status !== "verified" && <Pill tone="neutral">No address</Pill>}
      {r.status !== "pending" && r.status !== "verified" && <Pill tone="bad">{ENROLLMENT_STATUS_LABEL[r.status]}</Pill>}
      {r.invoice && <Pill tone="ok">{r.invoice.number}</Pill>}
    </div>
  );
}

// ── the review panel ─────────────────────────────────────────────────────────

type History = Array<{ id: string; type: string; summary: string | null; at: string; by: string | null }>;

function Review({ row, data, onClose, onDone }: { row: EnrollmentDTO; data: EnrollmentsPageData; onClose: () => void; onDone: (msg: string) => void }) {
  const editable = row.status === "pending" || row.status === "sent_back" || row.status === "not_received";
  const init = row.fields;
  const [f, setF] = useState<Required<EnrollmentFields>>(() => ({
    ...(init as Required<EnrollmentFields>),
    expDom: init.expDom ?? suggestedExpDom(init.billingCountry, init.paymentMode),
  }));
  /** Only what Finance changed: a field left alone never overwrites someone else's newer value. */
  const patch = useMemo(() => {
    const out: Partial<EnrollmentFields> = {};
    for (const k of Object.keys(f) as Array<keyof EnrollmentFields>) {
      if (JSON.stringify(f[k] ?? null) !== JSON.stringify(init[k] ?? null)) (out as Record<string, unknown>)[k] = f[k];
    }
    return out;
  }, [f, init]);
  const [history, setHistory] = useState<History>([]);
  const [busy, setBusy] = useState<null | "save" | "approve" | "back" | "none">(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<null | "back" | "none">(null);
  const [note, setNote] = useState("");

  const entity = f.paymentMode ? data.bankEntity[f.paymentMode] ?? null : null;
  const banked = !!f.paymentMode && (ENROLL_BANKS as readonly string[]).includes(f.paymentMode);
  const beforeInApp = !!f.paidOn && !!data.invoiceStartsOn && f.paidOn < data.invoiceStartsOn;
  const invoiceWhyNot = !banked
    ? "Not invoiced: only payments into Axis, HDFC or Wio get an invoice. It's listed for the CA."
    : beforeInApp
      ? "Paid before in-app invoicing started: the invoice is raised outside DesGro."
      : data.invoiceBlock[f.paymentMode!] || null;
  const [issue, setIssue] = useState(!invoiceWhyNot);
  const [invoiceDate, setInvoiceDate] = useState(init.paidOn ?? data.today);
  // The invoice can't be dated before the payment: follow a corrected payment date.
  useEffect(() => {
    if (f.paidOn && invoiceDate < f.paidOn) setInvoiceDate(f.paidOn);
  }, [f.paidOn, invoiceDate]);
  const [description, setDescription] = useState(defaultDescription(init.subItem));
  const [currency, setCurrency] = useState(entity === "DLLC" ? "AED" : "");
  const [foreign, setForeign] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/finance/enrollments/${row.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { history: History } | null) => live && d && setHistory(d.history))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [row.id]);

  const set = <K extends keyof EnrollmentFields>(k: K, v: EnrollmentFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const subItems = data.categories.find((c) => c.name === f.category)?.subItems ?? [];
  const india = isIndia(f.billingCountry || "India");
  const balance = f.firstAmount ? Math.max(0, balanceOf(f.totalAmount, f.firstAmount)) : 0;
  const problems = useMemo(() => financeProblems(f, data.today), [f, data.today]);
  const changes = useMemo(() => enrollmentChanges(init, f), [init, f]);
  const blocker = approveBlocker({ ...f, status: row.status, exception: nextException(row.exception, init.firstAmount, f.firstAmount) });
  const bdeSaid = (k: keyof EnrollmentFields) => {
    if (k === "category" || k === "subItem" || k === "expDom") return null;
    const a = formatField(k, row.submitted);
    return a !== formatField(k, f) ? `BDE said: ${a}` : null;
  };

  async function run(kind: "save" | "approve" | "back" | "none") {
    setError(null);
    if ((kind === "save" || kind === "approve") && problems.length) return setError(problems[0]);
    if (kind === "approve" && blocker) return setError(blocker);
    if ((kind === "back" || kind === "none") && note.trim().length < 3) return setError("Say what's wrong, so the BDE knows what to fix.");
    setBusy(kind);
    try {
      if (kind === "save") {
        await api(`/api/finance/enrollments/${row.id}`, { patch, expectedUpdatedAt: row.updatedAt }, "PATCH");
        onDone(changes.length ? "Saved. The BDE was told what changed." : "Nothing changed.");
      } else if (kind === "approve") {
        const wio = entity === "DLLC";
        const res = await api<{ invoice: { number: string } | null; invoiceError: string | null }>(`/api/finance/enrollments/${row.id}/approve`, {
          patch,
          expectedUpdatedAt: row.updatedAt,
          invoice:
            issue && !invoiceWhyNot
              ? {
                  kind: wio ? "DOM" : f.expDom,
                  invoiceDate,
                  description,
                  foreign: (wio || f.expDom === "EXP") && Number(foreign) > 0 ? { currency: (currency || "").toUpperCase(), amount: Number(foreign) } : null,
                }
              : null,
        });
        onDone(
          res.invoice
            ? `Approved and posted. Invoice ${res.invoice.number} issued.`
            : res.invoiceError
              ? `Approved and posted. No invoice: ${res.invoiceError} Issue it from Invoices › To invoice.`
              : "Approved and posted to the ledger.",
        );
      } else {
        await api(`/api/finance/enrollments/${row.id}/${kind === "back" ? "send-back" : "not-received"}`, { note });
        onDone(kind === "back" ? "Sent back to the BDE." : "Marked money not received. The sales head was asked to decide.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const text = (k: "billingName" | "billingCountry" | "billingAddress" | "billingPin" | "utr" | "payerName", label: string) => (
    <Field label={label} hint={bdeSaid(k)}>
      <input className={inputCls} value={(f[k] as string | null) ?? ""} disabled={!editable} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <Drawer onClose={onClose} label="Review enrollment">
      <div className="px-lg pt-lg pb-sm border-b border-outline-variant">
        <h3 className="text-h3 text-on-surface">{row.candidateName}</h3>
        <p className="text-caption text-on-surface-variant">
          {row.serviceName} · {row.ownerName ?? row.submittedByName ?? "—"} · submitted {date(row.createdAt)} · {ENROLLMENT_STATUS_LABEL[row.status]}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md">
        {row.financeNote && row.status !== "verified" && (
          <Callout tone="bad" icon="undo">
            <b>Your note:</b> {row.financeNote}
          </Callout>
        )}
        {row.exception === "pending" && (
          <Callout tone="gold" icon="gavel">
            The first payment is under {inr(MIN_FIRST_PAYMENT)}. The sales head has been asked to approve it on the lead; you can approve after that.
          </Callout>
        )}

        <Section title="Candidate">
          {text("billingName", "Name as on passport")}
          <div className="grid grid-cols-2 gap-sm">
            {text("billingCountry", "Country")}
            {india && (
              <Field label="State" hint={bdeSaid("billingState")}>
                <select className={inputCls} value={f.billingState ?? ""} disabled={!editable} onChange={(e) => set("billingState", e.target.value || null)}>
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
          {text("billingAddress", "Address (for the invoice)")}
          {text("billingPin", "PIN")}
        </Section>

        <Section title="First payment">
          <div className="grid grid-cols-2 gap-sm">
            <Field label="Amount (₹)" hint={bdeSaid("firstAmount")}>
              <input
                className={inputCls}
                type="number"
                value={f.firstAmount ?? ""}
                disabled={!editable}
                onChange={(e) => set("firstAmount", e.target.value === "" ? null : Number(e.target.value))}
              />
            </Field>
            <Field label="Landed on" hint={bdeSaid("paidOn")}>
              <input className={inputCls} type="date" max={data.today} value={f.paidOn ?? ""} disabled={!editable} onChange={(e) => set("paidOn", e.target.value || null)} />
            </Field>
            <Field label="Paid into" hint={bdeSaid("paymentMode")}>
              <select className={inputCls} value={f.paymentMode ?? ""} disabled={!editable} onChange={(e) => set("paymentMode", e.target.value || null)}>
                <option value="">Select…</option>
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            {text("utr", "UTR")}
            <Field label="Paid by" hint={bdeSaid("payerRelation")}>
              <select className={inputCls} value={f.payerRelation ?? ""} disabled={!editable} onChange={(e) => set("payerRelation", e.target.value || null)}>
                <option value="">—</option>
                {PAYER_RELATIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            {f.payerRelation && f.payerRelation !== "candidate" ? text("payerName", "Payer's name") : <span />}
          </div>
        </Section>

        <Section title="Package and balance">
          <Field label="Total (₹, GST included)" hint={bdeSaid("totalAmount")}>
            <input className={inputCls} type="number" value={f.totalAmount} disabled={!editable} onChange={(e) => set("totalAmount", Number(e.target.value) || 0)} />
          </Field>
          <PlanEditor plan={f.plan} balance={balance} from={f.paidOn ?? data.today} disabled={!editable} onChange={(p) => set("plan", p)} />
          {bdeSaid("plan") && <p className="text-caption text-on-surface-variant">{bdeSaid("plan")}</p>}
        </Section>

        <Section title="Ledger">
          <div className="grid grid-cols-2 gap-sm">
            <Field label="Category">
              <select className={inputCls} value={f.category ?? ""} disabled={!editable} onChange={(e) => setF((x) => ({ ...x, category: e.target.value || null, subItem: null }))}>
                <option value="">Select…</option>
                {data.categories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sub-item">
              <select className={inputCls} value={f.subItem ?? ""} disabled={!editable} onChange={(e) => set("subItem", e.target.value || null)}>
                <option value="">Select…</option>
                {subItems.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="EXP / DOM" hint="Domestic: an Indian candidate; GST is worked out of Axis/HDFC receipts. Export: abroad, no GST.">
            <div className="flex gap-2">
              {(["DOM", "EXP"] as const).map((k) => (
                <button key={k} type="button" disabled={!editable} aria-pressed={f.expDom === k} className={f.expDom === k ? primaryBtnCls : btnCls} onClick={() => set("expDom", k)}>
                  {k}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        {editable && data.canApprove && (
          <Section title="Invoice">
            {invoiceWhyNot ? (
              <p className="text-body-md text-on-surface-variant">{invoiceWhyNot}</p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-body-md">
                  <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} />
                  Issue the invoice when I approve
                </label>
                {issue && (
                  <>
                    <div className="grid grid-cols-2 gap-sm">
                      <Field label="Invoice date">
                        <input className={inputCls} type="date" min={f.paidOn ?? undefined} max={data.today} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                      </Field>
                      <Field label="Line">
                        <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
                      </Field>
                    </div>
                    {(entity === "DLLC" || f.expDom === "EXP") && (
                      <div className="grid grid-cols-2 gap-sm">
                        <Field label="Currency" hint={entity === "DLLC" ? "Wio invoices are in AED." : "Optional: leave empty for rupees."}>
                          <input className={inputCls} value={currency} disabled={entity === "DLLC"} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />
                        </Field>
                        <Field label="Amount in that currency">
                          <input className={inputCls} type="number" value={foreign} onChange={(e) => setForeign(e.target.value)} />
                        </Field>
                      </div>
                    )}
                    {!f.billingAddress && <p className="text-caption text-error">Add the address above: the invoice needs it.</p>}
                  </>
                )}
              </>
            )}
          </Section>
        )}

        {row.status === "verified" && (
          <Callout tone="ok" icon="task_alt">
            Verified{row.verifiedByName ? ` by ${row.verifiedByName}` : ""} on {date(row.verifiedAt)}. {row.invoice ? `Invoice ${row.invoice.number}.` : "No invoice yet."}
          </Callout>
        )}

        {history.length > 0 && (
          <Section title="History">
            <ul className="flex flex-col gap-1 text-caption text-on-surface-variant">
              {history.map((h) => (
                <li key={h.id}>
                  <b className="text-on-surface">{date(h.at)}</b> {h.by ? `${h.by}: ` : ""}
                  {h.summary}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {changes.length > 0 && editable && (
          <p className="text-caption text-on-surface-variant">
            {changes.length} change{changes.length === 1 ? "" : "s"} not saved yet. Saving or approving logs them on the lead and tells the BDE.
          </p>
        )}

        {noteFor && (
          <Field label={noteFor === "back" ? "What should the BDE fix?" : "What did you check? (shown to the sales head and the BDE)"}>
            <textarea className={inputCls + " h-20 py-2"} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        {error && (
          <p className="text-label-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {editable && (
        <div className="flex flex-wrap justify-end gap-2 px-lg py-sm border-t border-outline-variant bg-surface-container-low">
          {noteFor ? (
            <>
              <button type="button" className={btnCls} disabled={!!busy} onClick={() => (setNoteFor(null), setNote(""))}>
                Cancel
              </button>
              <button type="button" className={primaryBtnCls} disabled={!!busy} onClick={() => run(noteFor)}>
                {noteFor === "back" ? "Send back" : "Mark money not received"}
              </button>
            </>
          ) : (
            <>
              {row.status !== "sent_back" && (
                <button type="button" className={btnCls} disabled={!!busy} onClick={() => setNoteFor("back")}>
                  <Icon name="undo" /> Send back
                </button>
              )}
              {row.status !== "not_received" && (
                <button type="button" className={btnCls} disabled={!!busy} onClick={() => setNoteFor("none")}>
                  <Icon name="money_off" /> Money not received
                </button>
              )}
              <button type="button" className={btnCls} disabled={!!busy || !changes.length} onClick={() => run("save")}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </button>
              {data.canApprove && (
                <button type="button" className={primaryBtnCls} disabled={!!busy} onClick={() => run("approve")} title={blocker ?? undefined}>
                  {busy === "approve" ? "Posting…" : "Approve and post"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-sm">
      <h4 className="text-label-sm font-bold text-on-surface-variant uppercase tracking-wide">{title}</h4>
      {children}
    </section>
  );
}

function PlanEditor({ plan, balance, from, disabled, onChange }: { plan: PlanRow[]; balance: number; from: string; disabled: boolean; onChange: (p: PlanRow[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-caption text-on-surface-variant">
        Balance {inr(balance)} · planned {inr(planTotal(plan))}
        {!disabled && balance > 0 && (
          <>
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={btnCls + " h-8"} onClick={() => onChange(splitBalance(balance, n, from))}>
                Split in {n}
              </button>
            ))}
          </>
        )}
      </div>
      {plan.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">{describePlan(plan)}</p>
      ) : (
        plan.map((row, i) => (
          <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
            <span className="text-caption text-on-surface-variant">#{i + 2}</span>
            <input
              className={inputCls}
              type="date"
              aria-label={`Instalment ${i + 2} due`}
              value={row.date}
              disabled={disabled}
              onChange={(e) => onChange(plan.map((r, j) => (j === i ? { ...r, date: e.target.value } : r)))}
            />
            <input
              className={inputCls}
              type="number"
              aria-label={`Instalment ${i + 2} amount`}
              value={row.amount}
              disabled={disabled}
              onChange={(e) => onChange(plan.map((r, j) => (j === i ? { ...r, amount: Number(e.target.value) || 0 } : r)))}
            />
            {!disabled ? (
              <button type="button" className={btnCls + " h-10"} aria-label={`Remove instalment ${i + 2}`} onClick={() => onChange(plan.filter((_, j) => j !== i))}>
                <Icon name="close" />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))
      )}
    </div>
  );
}
