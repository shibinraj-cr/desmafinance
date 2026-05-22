"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

type Party = { id: string; name: string };
type Service = { id: string; name: string };
type SubItem = { id: string; name: string; isActive: boolean };
type Category = {
  id: string;
  name: string;
  type: "Revenue" | "Expense" | "Both";
  isActive: boolean;
  subItems: SubItem[];
};

type Installment = {
  expectedDate: string;
  amount: string;
  description: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewPlanForm({
  parties,
  services,
  categories,
  paymentModes,
  initialPartyId,
}: {
  parties: Party[];
  services: Service[];
  categories: Category[];
  paymentModes: string[];
  initialPartyId: string | null;
}) {
  const router = useRouter();
  const [partyId, setPartyId] = useState<string>(initialPartyId ?? parties[0]?.id ?? "");
  const [serviceId, setServiceId] = useState<string>("");
  const [label, setLabel] = useState<string>("Collection Plan");
  const [categoryName, setCategoryName] = useState<string>(categories[0]?.name ?? "");
  const subItems = useMemo(() => {
    const c = categories.find((x) => x.name === categoryName);
    return c ? c.subItems.filter((s) => s.isActive) : [];
  }, [categories, categoryName]);
  const [subItem, setSubItem] = useState<string>(subItems[0]?.name ?? "");
  // Keep subItem in sync when category changes.
  useMemo(() => {
    if (subItems.length && !subItems.some((s) => s.name === subItem)) {
      setSubItem(subItems[0].name);
    }
  }, [subItems, subItem]);

  const [paymentMode, setPaymentMode] = useState<string>(paymentModes[0] ?? "");
  const [expDom, setExpDom] = useState<"EXP" | "DOM">("DOM");
  const [notes, setNotes] = useState<string>("");
  const [installments, setInstallments] = useState<Installment[]>([
    { expectedDate: todayIso(), amount: "", description: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateInst(idx: number, patch: Partial<Installment>) {
    setInstallments((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function addInst() {
    setInstallments((prev) => [
      ...prev,
      { expectedDate: todayIso(), amount: "", description: "" },
    ]);
  }
  function removeInst(idx: number) {
    setInstallments((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  const totalAmount = installments.reduce(
    (s, i) => s + (Number.isFinite(Number(i.amount)) ? Number(i.amount) : 0),
    0,
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!partyId) return setError("Pick a candidate");
    if (!label.trim()) return setError("Plan label is required");
    if (!categoryName || !subItem) return setError("Pick category + sub-item");
    if (!paymentMode) return setError("Pick a payment mode");
    if (installments.length === 0) return setError("Add at least one installment");
    for (const [idx, inst] of installments.entries()) {
      if (!inst.expectedDate) return setError(`Installment ${idx + 1}: missing date`);
      const amt = Number(inst.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return setError(`Installment ${idx + 1}: amount must be > 0`);
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/finance/collection-plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          partyId,
          serviceId: serviceId || null,
          label,
          category: categoryName,
          subItem,
          paymentMode,
          expDom,
          notes: notes || null,
          installments: installments.map((i) => ({
            expectedDate: i.expectedDate,
            amount: Number(i.amount),
            description: i.description || null,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      router.push(`/finance/collection-plan/${data.plan.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-lg">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg space-y-md">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field label="Candidate" required>
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className={inputCls}
              required
            >
              <option value="">— Select candidate —</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service (optional)">
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={inputCls}
            >
              <option value="">—</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Plan label" required>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputCls}
              placeholder="e.g. AHPRA package — Sarath"
              required
            />
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
          <Field label="Category" required>
            <select
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              className={inputCls}
              required
            >
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
              required
            >
              {subItems.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default payment mode" required>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className={inputCls}
              required
            >
              {paymentModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputCls}
              placeholder="optional"
            />
          </Field>
        </div>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg space-y-md">
        <div className="flex items-baseline justify-between">
          <h3 className="text-h3 font-bold">Installments</h3>
          <div className="text-body-md text-on-surface-variant">
            Total: <span className="font-bold text-on-surface">₹{totalAmount.toLocaleString("en-IN")}</span>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-body-md">
            <thead>
              <tr className="text-left text-caption text-on-surface-variant uppercase tracking-wide">
                <th className="py-xs pr-md">#</th>
                <th className="py-xs pr-md">Expected date</th>
                <th className="py-xs pr-md text-right">Amount (₹)</th>
                <th className="py-xs pr-md">Description (optional)</th>
                <th className="py-xs"></th>
              </tr>
            </thead>
            <tbody>
              {installments.map((inst, idx) => (
                <tr key={idx} className="align-top">
                  <td className="py-xs pr-md text-on-surface-variant">{idx + 1}</td>
                  <td className="py-xs pr-md">
                    <input
                      type="date"
                      value={inst.expectedDate}
                      onChange={(e) => updateInst(idx, { expectedDate: e.target.value })}
                      className={inputCls}
                      required
                    />
                  </td>
                  <td className="py-xs pr-md">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={inst.amount}
                      onChange={(e) => updateInst(idx, { amount: e.target.value })}
                      className={inputCls + " text-right"}
                      required
                    />
                  </td>
                  <td className="py-xs pr-md">
                    <input
                      value={inst.description}
                      onChange={(e) => updateInst(idx, { description: e.target.value })}
                      className={inputCls}
                      placeholder="e.g. First instalment"
                    />
                  </td>
                  <td className="py-xs">
                    <button
                      type="button"
                      onClick={() => removeInst(idx)}
                      disabled={installments.length === 1}
                      className="text-error text-body-sm hover:underline disabled:opacity-30 disabled:no-underline"
                      title={installments.length === 1 ? "At least one installment required" : "Remove"}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addInst}
          className="px-md py-sm border border-outline-variant rounded-md text-body-md hover:bg-surface-container-low"
        >
          + Add installment
        </button>
      </div>

      {error ? (
        <div className="rounded-md bg-error/10 text-error px-md py-sm text-body-md">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-md">
        <button
          type="submit"
          disabled={submitting}
          className="px-lg py-sm bg-primary text-on-primary rounded-md font-semibold disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create plan"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-md py-sm text-on-surface-variant hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
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
