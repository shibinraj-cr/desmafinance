"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
  transaction: { id: string; date: string; amount: number; paymentMode: string } | null;
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
      return { label: "Pending", cls: "bg-blue-100 text-blue-800" };
  }
}

export function PlanDetailClient({
  plan,
  categories,
  paymentModes,
}: {
  plan: Plan;
  categories: Category[];
  paymentModes: string[];
}) {
  const router = useRouter();
  const [installments, setInstallments] = useState<Installment[]>(plan.installments);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** ID of the installment whose submit-to-tracker dialog is open. */
  const [submitFor, setSubmitFor] = useState<string | null>(null);

  const totals = useMemo(() => {
    const t = { total: 0, received: 0, submitted: 0, pending: 0 };
    for (const i of installments) {
      t.total += i.amount;
      if (i.status === "received") t.received += i.amount;
      else if (i.status === "submitted") t.submitted += i.amount;
      else if (i.status === "pending") t.pending += i.amount;
    }
    return t;
  }, [installments]);

  async function submitInstallment(
    id: string,
    body: { category: string; subItem: string; paymentMode: string; expDom: "EXP" | "DOM" },
  ) {
    setError(null);
    const res = await fetch(
      `/api/finance/collection-plans/${plan.id}/installments/${id}/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Submission failed (${res.status})`);
      return false;
    }
    router.refresh();
    return true;
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
          <Meta label="Candidate">
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

      {/* Totals */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-gutter">
        <Tile label="Total expected" value={totals.total} />
        <Tile label="Received" value={totals.received} tone="success" />
        <Tile label="Awaiting approval" value={totals.submitted} tone="warning" />
        <Tile label="Pending submission" value={totals.pending} tone="info" />
      </section>

      {error ? (
        <div className="rounded-md bg-error/10 text-error px-md py-sm text-body-md">{error}</div>
      ) : null}

      {/* Installments table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-md border-b border-outline-variant">
          <h3 className="text-h3 font-bold">Installments</h3>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-md py-sm bg-primary text-on-primary rounded-md text-body-md font-semibold hover:opacity-90"
            disabled={plan.status !== "active"}
          >
            + Add installment
          </button>
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
                    <td className="px-md py-sm text-right whitespace-nowrap font-semibold">
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
                          Tx {fmtDate(inst.transaction.date)} · {inst.transaction.paymentMode}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-md py-sm whitespace-nowrap space-x-md">
                      {inst.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingId(inst.id)}
                            className="text-primary hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubmitFor(inst.id)}
                            className="text-green-700 hover:underline"
                          >
                            Submit to Daily Tracker
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
                        <Link
                          href={`/finance/daily-tracker/${inst.transaction.id}/edit`}
                          className="text-primary hover:underline"
                        >
                          Open transaction
                        </Link>
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

      {submitFor ? (
        <SubmitDialog
          installment={installments.find((i) => i.id === submitFor)!}
          plan={plan}
          categories={categories}
          paymentModes={paymentModes}
          onClose={() => setSubmitFor(null)}
          onSubmit={async (body) => {
            const ok = await submitInstallment(submitFor, body);
            if (ok) setSubmitFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function SubmitDialog({
  installment,
  plan,
  categories,
  paymentModes,
  onClose,
  onSubmit,
}: {
  installment: Installment;
  plan: Plan;
  categories: Category[];
  paymentModes: string[];
  onClose: () => void;
  onSubmit: (body: {
    category: string;
    subItem: string;
    paymentMode: string;
    expDom: "EXP" | "DOM";
  }) => Promise<void>;
}) {
  // Resolution order: installment override → plan default → first option.
  const initialCategory =
    installment.category ?? plan.category ?? categories[0]?.name ?? "";
  const [category, setCategory] = useState<string>(initialCategory);
  const subItems = useMemo(() => {
    const c = categories.find((x) => x.name === category);
    return c ? c.subItems.filter((s) => s.isActive) : [];
  }, [categories, category]);
  const [subItem, setSubItem] = useState<string>(
    installment.subItem ?? plan.subItem ?? subItems[0]?.name ?? "",
  );
  const [paymentMode, setPaymentMode] = useState<string>(
    installment.paymentMode ?? plan.paymentMode ?? paymentModes[0] ?? "",
  );
  const [expDom, setExpDom] = useState<"EXP" | "DOM">(plan.expDom ?? "DOM");
  const [busy, setBusy] = useState(false);

  function pickCategory(name: string) {
    setCategory(name);
    const next = categories.find((x) => x.name === name)?.subItems.filter((s) => s.isActive) ?? [];
    if (next.length && !next.some((s) => s.name === subItem)) {
      setSubItem(next[0].name);
    }
  }

  async function handleSubmit() {
    if (!category || !subItem || !paymentMode || !expDom) return;
    setBusy(true);
    await onSubmit({ category, subItem, paymentMode, expDom });
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-lg p-lg space-y-md shadow-xl">
        <div>
          <h3 className="text-h3 font-bold">Submit to Daily Tracker</h3>
          <p className="text-body-md text-on-surface-variant mt-xs">
            Installment #{installment.seq} · ₹
            {installment.amount.toLocaleString("en-IN")} expected on{" "}
            {(() => {
              const [y, m, d] = installment.expectedDate.split("-");
              return `${d}-${m}-${y.slice(-2)}`;
            })()}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field label="Category" required>
            <select
              value={category}
              onChange={(e) => pickCategory(e.target.value)}
              className={inputCls}
            >
              <option value="">— Select —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sub-item" required>
            <select
              value={subItem}
              onChange={(e) => setSubItem(e.target.value)}
              className={inputCls}
              disabled={!category}
            >
              <option value="">— Select —</option>
              {subItems.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment mode" required>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className={inputCls}
            >
              {paymentModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="EXP / DOM" required>
            <select
              value={expDom}
              onChange={(e) => setExpDom(e.target.value as "EXP" | "DOM")}
              className={inputCls}
            >
              <option value="DOM">DOM (Domestic)</option>
              <option value="EXP">EXP (Export)</option>
            </select>
          </Field>
        </div>
        <div className="flex items-center justify-end gap-md pt-sm">
          <button
            type="button"
            onClick={onClose}
            className="px-md py-sm text-on-surface-variant hover:underline"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !category || !subItem || !paymentMode}
            className="px-lg py-sm bg-primary text-on-primary rounded-md font-semibold disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit to Daily Tracker"}
          </button>
        </div>
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
