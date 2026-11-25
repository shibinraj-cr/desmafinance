"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { txErrorMessage } from "@/lib/finance-tx-errors";
import { utrRequired } from "@/lib/crm-enroll-confirm";
import {
  describePlanChange,
  planChangeFor,
  planChangeProblemMessage,
  rupees,
  type PlanChangeProblem,
} from "@/lib/collection-payment";

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

type Installment = {
  id: string;
  seq: number;
  expectedDate: string;
  amount: number;
  category: string | null;
  subItem: string | null;
  paymentMode: string | null;
  description: string | null;
  status: "pending" | "submitted" | "received" | "cancelled";
  transactionId: string | null;
  transaction: {
    id: string;
    date: string;
    amount: number;
    paymentMode: string;
    /** The live GST invoice for this payment, if issued. */
    invoiceNumber: string | null;
    /** No invoice yet and this payment can have one (bank, start date, candidate). */
    canInvoice: boolean;
  } | null;
};

type Plan = {
  id: string;
  label: string;
  partyId: string;
  partyName: string;
  serviceId: string | null;
  serviceName: string | null;
  category: string | null;
  subItem: string | null;
  paymentMode: string | null;
  expDom: "EXP" | "DOM" | null;
  notes: string | null;
  status: "active" | "closed" | "cancelled";
  createdByUsername: string | null;
  createdAt: string;
  /** Set when the plan follows a Partner Commissions invoice: read-only here. */
  commissionInvoice: { number: string; href: string } | null;
  installments: Installment[];
};

type SubItem = { id: string; name: string; isActive: boolean };
type Category = {
  id: string;
  name: string;
  type: "Revenue" | "Expense" | "Both";
  isActive: boolean;
  subItems: SubItem[];
};

function fmtDate(iso: string): string {
  const [yyyy, mm, dd] = iso.split("-");
  return `${dd}-${mm}-${yyyy.slice(-2)}`;
}

function statusBadge(s: Installment["status"]) {
  switch (s) {
    case "received":
      return { label: "Received", cls: "bg-green-100 text-green-800" };
    case "submitted":
      return { label: "Awaiting Approval", cls: "bg-amber-100 text-amber-800" };
    case "cancelled":
      return { label: "Cancelled", cls: "bg-surface-container text-on-surface-variant" };
    default:
      return { label: "Due", cls: "bg-blue-100 text-blue-800" };
  }
}

const issueHref = (transactionId: string) => `/finance/invoices?issue=${encodeURIComponent(transactionId)}`;

export function PlanDetailClient({
  plan,
  categories,
  paymentModes,
  today,
  canApprove,
  undoableId,
}: {
  plan: Plan;
  categories: Category[];
  paymentModes: string[];
  /** Today in India, YYYY-MM-DD. */
  today: string;
  /** Posts straight to the ledger, links existing entries and undoes payments. */
  canApprove: boolean;
  /** The plan's most recent recorded payment, when it can be undone. */
  undoableId: string | null;
}) {
  const router = useRouter();
  const [installments, setInstallments] = useState<Installment[]>(plan.installments);
  // A payment reshapes the plan on the server: take the fresh rows on refresh.
  useEffect(() => setInstallments(plan.installments), [plan.installments]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** ID of the installment whose Record payment dialog is open. */
  const [recordFor, setRecordFor] = useState<string | null>(null);
  /** Follows a Partner Commissions invoice: paid there, so nothing to change here. */
  const pc = plan.commissionInvoice;

  const totals = useMemo(() => {
    const t = { total: 0, received: 0, submitted: 0, pending: 0 };
    for (const i of installments) {
      // A cancelled instalment (scrapped, or paid with another) isn't owed.
      if (i.status === "cancelled") continue;
      t.total += i.amount;
      if (i.status === "received") t.received += i.amount;
      else if (i.status === "submitted") t.submitted += i.amount;
      else if (i.status === "pending") t.pending += i.amount;
    }
    return t;
  }, [installments]);

  async function undoPayment(inst: Installment) {
    const t = inst.transaction;
    const ok = window.confirm(
      `Undo the payment on instalment ${inst.seq}${t ? ` (₹${t.amount.toLocaleString("en-IN")} received ${fmtDate(t.date)})` : ""}?\n\n` +
        "The plan goes back to exactly how it was before it, and its ledger entry is deleted (an entry that was linked is only unlinked). Record it again with the right details.",
    );
    if (!ok) return;
    setError(null);
    const res = await fetch(`/api/finance/collection-plans/${plan.id}/installments/${inst.id}/undo`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(txErrorMessage(data?.error, `Couldn't undo it (${res.status})`));
      return;
    }
    router.refresh();
  }

  async function deleteInstallment(id: string) {
    if (!window.confirm("Remove this installment?")) return;
    const res = await fetch(
      `/api/finance/collection-plans/${plan.id}/installments/${id}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Delete failed (${res.status})`);
      return;
    }
    setInstallments((prev) => prev.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-lg">
      {/* Plan metadata card */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-md text-body-md">
          <Meta label={pc ? "Partner" : "Candidate"}>
            <Link href={`/finance/parties/${plan.partyId}`} className="text-primary hover:underline">
              {plan.partyName}
            </Link>
          </Meta>
          <Meta label="Service">{plan.serviceName ?? "—"}</Meta>
          {plan.category ? <Meta label="Category">{plan.category}</Meta> : null}
          {plan.subItem ? <Meta label="Sub-item">{plan.subItem}</Meta> : null}
          {plan.paymentMode ? (
            <Meta label="Default payment">{plan.paymentMode}</Meta>
          ) : null}
          {plan.expDom ? <Meta label="EXP / DOM">{plan.expDom}</Meta> : null}
          <Meta label="Status">
            <span className="px-xs py-0.5 rounded-md text-xs font-medium bg-surface-container">
              {plan.status}
            </span>
          </Meta>
          <Meta label="Created by">
            {plan.createdByUsername ?? "—"} · {fmtDate(plan.createdAt.slice(0, 10))}
          </Meta>
        </div>
        {plan.notes ? (
          <div className="mt-md text-body-md text-on-surface-variant">{plan.notes}</div>
        ) : null}
      </div>

      {pc ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-md py-sm text-body-md">
          This plan follows Partner Commissions invoice{" "}
          <Link href={pc.href} className="text-primary font-semibold hover:underline">
            {pc.number}
          </Link>
          . Record the partner&rsquo;s payment on the invoice; when it is approved, the payment shows here as received at its
          INR value. The amount still due is an estimate in rupees from the partner&rsquo;s recent payments.
        </div>
      ) : null}

      {/* Totals */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-gutter">
        <Tile label="Total expected" value={totals.total} />
        <Tile label="Received" value={totals.received} tone="success" />
        <Tile label="Awaiting approval" value={totals.submitted} tone="warning" />
        <Tile label="Still due" value={totals.pending} tone="info" />
      </section>

      {error ? (
        <div className="rounded-md bg-error/10 text-error px-md py-sm text-body-md">{error}</div>
      ) : null}

      {/* Installments table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-md border-b border-outline-variant">
          <div>
            <h3 className="text-h3 font-bold">Installments</h3>
            <p className="text-caption text-on-surface-variant">
              {pc ? (
                <>Updated from the invoice. Nothing to record here.</>
              ) : (
                <>When the candidate pays, use <b>Record payment</b> with the date the money landed and the amount received.</>
              )}
            </p>
          </div>
          {pc ? null : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="px-md py-sm bg-primary text-on-primary rounded-md text-body-md font-semibold hover:opacity-90"
              disabled={plan.status !== "active"}
            >
              + Add installment
            </button>
          )}
        </div>
        <div className="overflow-auto">
          <table className="w-full text-body-md">
            <thead>
              <tr className="text-left text-caption text-on-surface-variant uppercase tracking-wide">
                <th className="px-md py-sm">#</th>
                <th className="px-md py-sm">Expected date</th>
                <th className="px-md py-sm text-right">Amount</th>
                <th className="px-md py-sm">Description</th>
                <th className="px-md py-sm">Status</th>
                <th className="px-md py-sm">Actions</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((inst) =>
                editingId === inst.id ? (
                  <EditRow
                    key={inst.id}
                    inst={inst}
                    plan={plan}
                    categories={categories}
                    paymentModes={paymentModes}
                    onCancel={() => setEditingId(null)}
                    onSaved={(updated) => {
                      setInstallments((prev) =>
                        prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)),
                      );
                      setEditingId(null);
                      router.refresh();
                    }}
                    onError={setError}
                  />
                ) : (
                  <tr key={inst.id} className="border-t border-outline-variant">
                    <td className="px-md py-sm text-on-surface-variant whitespace-nowrap">
                      {inst.seq}
                    </td>
                    <td className="px-md py-sm whitespace-nowrap">{fmtDate(inst.expectedDate)}</td>
                    <td className={"px-md py-sm text-right whitespace-nowrap font-semibold" + (inst.status === "cancelled" ? " line-through text-on-surface-variant" : "")}>
                      ₹{inst.amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-md py-sm">{inst.description ?? "—"}</td>
                    <td className="px-md py-sm whitespace-nowrap">
                      <span
                        className={
                          "inline-block px-xs py-0.5 rounded-md text-xs font-medium " +
                          statusBadge(inst.status).cls
                        }
                      >
                        {statusBadge(inst.status).label}
                      </span>
                      {inst.transaction ? (
                        <div className="text-caption text-on-surface-variant mt-xs">
                          Paid {fmtDate(inst.transaction.date)} · {inst.transaction.paymentMode}
                          {inst.transaction.invoiceNumber ? (
                            <div>Invoice {inst.transaction.invoiceNumber}</div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-md py-sm whitespace-nowrap space-x-md">
                      {pc && inst.status === "pending" ? (
                        <Link href={pc.href} className="text-green-700 font-semibold hover:underline">
                          Record on invoice
                        </Link>
                      ) : inst.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setRecordFor(inst.id)}
                            className="text-green-700 font-semibold hover:underline"
                            disabled={plan.status !== "active"}
                          >
                            Record payment
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(inst.id)}
                            className="text-primary hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteInstallment(inst.id)}
                            className="text-error hover:underline"
                          >
                            Remove
                          </button>
                        </>
                      ) : inst.status === "submitted" ? (
                        <Link
                          href="/finance/approvals/pending"
                          className="text-primary hover:underline"
                        >
                          View in approvals
                        </Link>
                      ) : inst.transaction ? (
                        <>
                          {!pc && inst.transaction.canInvoice ? (
                            <Link href={issueHref(inst.transaction.id)} className="text-green-700 font-semibold hover:underline">
                              Issue invoice
                            </Link>
                          ) : null}
                          <Link
                            href={`/finance/daily-tracker/${inst.transaction.id}/edit`}
                            className="text-primary hover:underline"
                          >
                            Open transaction
                          </Link>
                          {inst.id === undoableId ? (
                            <button type="button" onClick={() => undoPayment(inst)} className="text-error hover:underline">
                              Undo payment
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-on-surface-variant">—</span>
                      )}
                    </td>
                  </tr>
                ),
              )}
              {adding ? (
                <AddRow
                  plan={plan}
                  onCancel={() => setAdding(false)}
                  onAdded={(created) => {
                    setInstallments((prev) => [...prev, created]);
                    setAdding(false);
                    router.refresh();
                  }}
                  onError={setError}
                />
              ) : null}
              {installments.length === 0 && !adding ? (
                <tr>
                  <td colSpan={6} className="px-md py-lg text-center text-on-surface-variant">
                    No installments — click &ldquo;Add installment&rdquo; to start.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {recordFor && installments.some((i) => i.id === recordFor) ? (
        <RecordPaymentDialog
          installment={installments.find((i) => i.id === recordFor)!}
          installments={installments}
          plan={plan}
          categories={categories}
          paymentModes={paymentModes}
          today={today}
          canApprove={canApprove}
          onClose={(changed) => {
            setRecordFor(null);
            if (changed) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

type RecordResult =
  | {
      applied: true;
      transactionId: string;
      invoice: { canIssue: boolean; reason: string | null };
      /** An existing ledger entry was linked instead of posting a new one. */
      linked?: boolean;
      amount?: number;
      date?: string;
    }
  | { applied: false };

/** The ledger (or the approval queue) already has a payment with this UTR. */
type Duplicate = {
  existing: { source: "ledger" | "approval"; id: string; date: string; amount: number; description: string | null };
  canLink: boolean;
};

/**
 * Record the payment received for an instalment: the day the money landed,
 * what arrived, the bank and its UTR. Shows, before saving, what the payment
 * does to the rest of the plan (paid less / paid more).
 */
function RecordPaymentDialog({
  installment,
  installments,
  plan,
  categories,
  paymentModes,
  today,
  canApprove,
  onClose,
}: {
  installment: Installment;
  installments: Installment[];
  plan: Plan;
  categories: Category[];
  paymentModes: string[];
  today: string;
  canApprove: boolean;
  onClose: (changed: boolean) => void;
}) {
  const [paidOn, setPaidOn] = useState<string>(today);
  const [amount, setAmount] = useState<string>(String(installment.amount));
  const [paymentMode, setPaymentMode] = useState<string>(
    installment.paymentMode ?? plan.paymentMode ?? paymentModes[0] ?? "",
  );
  const [utr, setUtr] = useState("");
  const [paidBy, setPaidBy] = useState("");
  // Ledger fields: installment override → plan default → first option.
  const [category, setCategory] = useState<string>(
    installment.category ?? plan.category ?? categories[0]?.name ?? "",
  );
  const subItems = useMemo(() => {
    const c = categories.find((x) => x.name === category);
    return c ? c.subItems.filter((s) => s.isActive) : [];
  }, [categories, category]);
  const [subItem, setSubItem] = useState<string>(
    installment.subItem ?? plan.subItem ?? subItems[0]?.name ?? "",
  );
  const [expDom, setExpDom] = useState<"EXP" | "DOM">(plan.expDom ?? "DOM");
  const ledgerKnown = !!(plan.category && plan.subItem && plan.expDom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RecordResult | null>(null);
  const [dup, setDup] = useState<Duplicate | null>(null);

  function pickCategory(name: string) {
    setCategory(name);
    const next = categories.find((x) => x.name === name)?.subItems.filter((s) => s.isActive) ?? [];
    if (next.length && !next.some((s) => s.name === subItem)) setSubItem(next[0].name);
  }

  const paid = Number(amount);
  const change = useMemo(
    () =>
      planChangeFor(
        installments.map((i) => ({ id: i.id, seq: i.seq, expectedDate: i.expectedDate, amount: i.amount, status: i.status })),
        installment.id,
        paid,
      ),
    [installments, installment.id, paid],
  );
  const problem = "error" in change ? change : null;
  const effects = "error" in change ? [] : describePlanChange(change);
  const needsUtr = utrRequired(paymentMode);

  const blocker =
    !paidOn
      ? "Enter the date the money landed."
      : paidOn > today
        ? "The date received can't be in the future."
        : problem
          ? planChangeProblemMessage(problem)
          : needsUtr && utr.replace(/\s+/g, "").length < 4
            ? "Enter the UTR: the bank reference of the payment."
            : !category || !subItem
              ? "Pick the category and sub-item."
              : null;

  async function save() {
    if (blocker) {
      setError(blocker);
      return;
    }
    setBusy(true);
    setError(null);
    setDup(null);
    const res = await fetch(
      `/api/finance/collection-plans/${plan.id}/installments/${installment.id}/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paidOn,
          amount: paid,
          paymentMode,
          utr: utr.trim() || null,
          paidBy: paidBy.trim() || null,
          category,
          subItem,
          expDom,
        }),
      },
    );
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 409 && data?.error === "duplicate_payment" && data.existing) {
      setDup(data as Duplicate);
      return;
    }
    if (!res.ok) {
      setError(
        data?.error === "collection_more_than_due" && typeof data.maxAmount === "number"
          ? planChangeProblemMessage(data as PlanChangeProblem)
          : txErrorMessage(data?.error, data?.error ?? `Couldn't record it (${res.status})`),
      );
      return;
    }
    setDone(data as RecordResult);
  }

  /** Link the entry already on the ledger to this instalment, instead of posting it again. */
  async function linkExisting() {
    if (!dup) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/collection-plans/${plan.id}/installments/${installment.id}/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId: dup.existing.id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(
        data?.error === "collection_more_than_due" && typeof data.maxAmount === "number"
          ? planChangeProblemMessage(data as PlanChangeProblem)
          : txErrorMessage(data?.error, data?.error ?? `Couldn't link it (${res.status})`),
      );
      return;
    }
    setDone(data as RecordResult);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Record payment"
        className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-xl p-lg space-y-md shadow-xl max-h-[92vh] overflow-y-auto"
      >
        <div>
          <h3 className="text-h3 font-bold">Record payment</h3>
          <p className="text-body-md text-on-surface-variant mt-xs">
            {plan.partyName} · instalment {installment.seq} · {rupees(installment.amount)} expected on{" "}
            {fmtDate(installment.expectedDate)}
          </p>
        </div>

        {done ? (
          <div className="space-y-md">
            {done.applied ? (
              <>
                <div className="rounded-md bg-green-100 text-green-900 px-md py-sm text-body-md">
                  {done.linked
                    ? `Linked the entry already on the ledger (${rupees(done.amount ?? 0)} received on ${fmtDate(done.date ?? paidOn)}) to instalment ${installment.seq}. Nothing new was posted.`
                    : `Recorded ${rupees(paid)} received on ${fmtDate(paidOn)} and posted to the ledger.`}
                </div>
                {done.invoice.canIssue ? (
                  <p className="text-body-md">Issue its GST invoice now, or later from Finance › Invoices › To invoice.</p>
                ) : (
                  <p className="text-body-md text-on-surface-variant">No invoice for this one: {done.invoice.reason}</p>
                )}
              </>
            ) : (
              <div className="rounded-md bg-amber-100 text-amber-900 px-md py-sm text-body-md">
                Sent for approval. When the Finance Manager approves it, it&apos;s posted to the ledger, the plan
                updates, and the payment waits in Finance › Invoices › To invoice.
              </div>
            )}
            <div className="flex items-center justify-end gap-md">
              <button type="button" onClick={() => onClose(true)} className="px-md py-sm text-on-surface-variant hover:underline">
                {done.applied && done.invoice.canIssue ? "Later" : "Close"}
              </button>
              {done.applied && done.invoice.canIssue ? (
                <Link
                  href={issueHref(done.transactionId)}
                  className="px-lg py-sm bg-primary text-on-primary rounded-md font-semibold"
                >
                  Issue invoice
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              <Field label="Date the money landed" required>
                <input type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Amount received (₹)" required>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={inputCls + " text-right"}
                />
              </Field>
              <Field label="Paid into / by" required>
                <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputCls}>
                  {paymentModes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="UTR / bank reference" required={needsUtr}>
                <input
                  value={utr}
                  onChange={(e) => setUtr(e.target.value)}
                  className={inputCls}
                  placeholder={needsUtr ? "As on the statement or screenshot" : "Optional"}
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Paid by (if not the candidate)">
                  <input value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className={inputCls} placeholder="e.g. a parent's name" />
                </Field>
              </div>
            </div>

            {problem ? null : effects.length ? (
              <div className="rounded-md bg-blue-50 text-blue-900 px-md py-sm text-body-md space-y-xs">
                {effects.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            ) : null}

            <details open={!ledgerKnown} className="rounded-md border border-outline-variant px-md py-sm">
              <summary className="text-caption text-on-surface-variant uppercase tracking-wide cursor-pointer">
                Ledger: {category || "—"} › {subItem || "—"} · {expDom}
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-md mt-sm">
                <Field label="Category" required>
                  <select value={category} onChange={(e) => pickCategory(e.target.value)} className={inputCls}>
                    <option value="">— Select —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sub-item" required>
                  <select value={subItem} onChange={(e) => setSubItem(e.target.value)} className={inputCls} disabled={!category}>
                    <option value="">— Select —</option>
                    {subItems.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="EXP / DOM" required>
                  <select value={expDom} onChange={(e) => setExpDom(e.target.value as "EXP" | "DOM")} className={inputCls}>
                    <option value="DOM">DOM (Domestic)</option>
                    <option value="EXP">EXP (Export)</option>
                  </select>
                </Field>
              </div>
            </details>

            {dup ? (
              <div className="rounded-md bg-amber-100 text-amber-900 px-md py-sm text-body-md space-y-sm" data-duplicate>
                <div>
                  <b>This UTR is already {dup.existing.source === "approval" ? "waiting for approval" : "on the ledger"}</b> for{" "}
                  {plan.partyName}: {rupees(dup.existing.amount)} on {fmtDate(dup.existing.date)}
                  {dup.existing.description ? ` · ${dup.existing.description}` : ""}. Recording it again would count the money twice.
                </div>
                {dup.canLink ? (
                  <div className="flex flex-wrap items-center gap-md">
                    <span>If that&apos;s this instalment&apos;s money, link that entry instead.</span>
                    <button
                      type="button"
                      onClick={linkExisting}
                      disabled={busy}
                      className="px-md py-xs bg-primary text-on-primary rounded-md font-semibold disabled:opacity-50"
                    >
                      {busy ? "Linking…" : "Link that entry"}
                    </button>
                  </div>
                ) : dup.existing.source === "approval" ? (
                  <div>Approve or reject that entry in Approvals first.</div>
                ) : canApprove ? (
                  <div>That entry is already a payment on a collection plan.</div>
                ) : (
                  <div>Ask the Finance Manager to link that entry to this instalment.</div>
                )}
              </div>
            ) : null}

            {error || (problem && Number(amount) > 0) ? (
              <div className="rounded-md bg-error/10 text-error px-md py-sm text-body-md">
                {error ?? (problem ? planChangeProblemMessage(problem) : null)}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-md pt-sm">
              <button type="button" onClick={() => onClose(false)} className="px-md py-sm text-on-surface-variant hover:underline">
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                title={blocker ?? undefined}
                className="px-lg py-sm bg-primary text-on-primary rounded-md font-semibold disabled:opacity-50"
              >
                {busy ? "Recording…" : "Record payment"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-caption text-on-surface-variant uppercase tracking-wide mb-xs">
        {label}
        {required ? <span className="text-error"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-caption text-on-surface-variant uppercase tracking-wide">{label}</div>
      <div className="mt-xs">{children}</div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "info";
}) {
  const valueCls =
    tone === "success"
      ? "text-green-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "info"
          ? "text-accent"
          : "text-on-surface";
  return (
    <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-sm">
      <div className="text-caption text-on-surface-variant uppercase tracking-wide">{label}</div>
      <div className={"text-h2 font-extrabold mt-xs " + valueCls}>
        ₹{value.toLocaleString("en-IN")}
      </div>
    </div>
  );
}

function AddRow({
  plan,
  onCancel,
  onAdded,
  onError,
}: {
  plan: Plan;
  onCancel: () => void;
  onAdded: (i: Installment) => void;
  onError: (e: string | null) => void;
}) {
  const [expectedDate, setExpectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function save() {
    onError(null);
    const amt = Number(amount);
    if (!expectedDate || !Number.isFinite(amt) || amt <= 0) {
      onError("Date and amount required");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/finance/collection-plans/${plan.id}/installments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedDate, amount: amt, description: description || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(data.error ?? `Add failed (${res.status})`);
      setBusy(false);
      return;
    }
    const data = await res.json();
    onAdded({
      ...data.installment,
      transaction: null,
      category: null,
      subItem: null,
      paymentMode: null,
    });
  }

  return (
    <tr className="border-t border-outline-variant bg-surface-container-low">
      <td className="px-md py-sm text-on-surface-variant">new</td>
      <td className="px-md py-sm">
        <input
          type="date"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
          className={inputCls}
        />
      </td>
      <td className="px-md py-sm">
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputCls + " text-right"}
        />
      </td>
      <td className="px-md py-sm" colSpan={2}>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
          placeholder="Description (optional)"
        />
      </td>
      <td className="px-md py-sm whitespace-nowrap space-x-md">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-primary hover:underline disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-on-surface-variant hover:underline"
        >
          Cancel
        </button>
      </td>
    </tr>
  );
}

function EditRow({
  inst,
  plan,
  categories,
  paymentModes,
  onCancel,
  onSaved,
  onError,
}: {
  inst: Installment;
  plan: Plan;
  categories: Category[];
  paymentModes: string[];
  onCancel: () => void;
  onSaved: (i: Installment) => void;
  onError: (e: string | null) => void;
}) {
  const [expectedDate, setExpectedDate] = useState<string>(inst.expectedDate);
  const [amount, setAmount] = useState<string>(String(inst.amount));
  const [description, setDescription] = useState<string>(inst.description ?? "");
  const [category, setCategory] = useState<string>(inst.category ?? "");
  const [subItem, setSubItem] = useState<string>(inst.subItem ?? "");
  const [paymentMode, setPaymentMode] = useState<string>(inst.paymentMode ?? "");
  const [busy, setBusy] = useState(false);

  const effectiveCategory = category || plan.category;
  const subItems = useMemo(() => {
    const c = categories.find((x) => x.name === effectiveCategory);
    return c ? c.subItems.filter((s) => s.isActive) : [];
  }, [categories, effectiveCategory]);

  async function save() {
    onError(null);
    const amt = Number(amount);
    if (!expectedDate || !Number.isFinite(amt) || amt <= 0) {
      onError("Date and amount required");
      return;
    }
    setBusy(true);
    const res = await fetch(
      `/api/finance/collection-plans/${plan.id}/installments/${inst.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedDate,
          amount: amt,
          description: description || null,
          category: category || null,
          subItem: subItem || null,
          paymentMode: paymentMode || null,
        }),
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(data.error ?? `Save failed (${res.status})`);
      setBusy(false);
      return;
    }
    const data = await res.json();
    onSaved({
      ...inst,
      ...data.installment,
      transaction: inst.transaction,
    });
  }

  return (
    <tr className="border-t border-outline-variant bg-surface-container-low">
      <td className="px-md py-sm text-on-surface-variant">{inst.seq}</td>
      <td className="px-md py-sm">
        <input
          type="date"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
          className={inputCls}
        />
      </td>
      <td className="px-md py-sm">
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputCls + " text-right"}
        />
      </td>
      <td className="px-md py-sm">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
          placeholder="Description"
        />
        <details className="mt-xs">
          <summary className="text-caption text-on-surface-variant cursor-pointer">
            Override category / sub-item / payment
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-xs mt-xs">
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setSubItem("");
              }}
              className={inputCls}
            >
              <option value="">(plan default: {plan.category})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={subItem}
              onChange={(e) => setSubItem(e.target.value)}
              className={inputCls}
              disabled={!category}
            >
              <option value="">
                (plan default: {plan.subItem})
              </option>
              {subItems.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className={inputCls}
            >
              <option value="">(plan default: {plan.paymentMode})</option>
              {paymentModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </details>
      </td>
      <td className="px-md py-sm whitespace-nowrap">—</td>
      <td className="px-md py-sm whitespace-nowrap space-x-md">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-primary hover:underline disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-on-surface-variant hover:underline"
        >
          Cancel
        </button>
      </td>
    </tr>
  );
}
