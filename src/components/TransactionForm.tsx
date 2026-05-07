"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TYPES,
  MONTHS,
  PAYMENT_MODES,
  categoriesFor,
  subItemsFor,
  type TxType,
} from "@/lib/catalog";

function todayMonthCode(): string {
  const d = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionForm() {
  const router = useRouter();
  const [type, setType] = useState<TxType>("Revenue");
  const cats = useMemo(() => categoriesFor(type), [type]);
  const [category, setCategory] = useState<string>(cats[0]);
  const subs = useMemo(() => subItemsFor(type, category), [type, category]);
  const [subItem, setSubItem] = useState<string>(subs[0]);
  const [date, setDate] = useState<string>(todayIso());
  const initMonth = todayMonthCode();
  const [month, setMonth] = useState<string>(MONTHS.includes(initMonth as (typeof MONTHS)[number]) ? initMonth : MONTHS[0]);
  const [paymentMode, setPaymentMode] = useState<string>(PAYMENT_MODES[0]);
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function onTypeChange(next: TxType) {
    setType(next);
    const newCats = categoriesFor(next);
    setCategory(newCats[0]);
    setSubItem(subItemsFor(next, newCats[0])[0]);
  }
  function onCategoryChange(next: string) {
    setCategory(next);
    setSubItem(subItemsFor(type, next)[0]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setBusy(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date,
        month,
        type,
        category,
        subItem,
        description: description || null,
        paymentMode,
        amount,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error === "validation_failed" ? "Please check the values entered." : "Failed to save.");
      return;
    }
    setOk(true);
    setAmount("");
    setDescription("");
    router.refresh();
  }

  const accent =
    type === "Revenue"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-red-50 text-red-700 border-red-200";

  return (
    <form onSubmit={onSubmit} className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg space-y-md">
      <div className="flex items-center gap-base">
        <span className={`px-sm py-xs rounded-full border text-label-sm font-semibold ${accent}`}>
          {type === "Revenue" ? "Inflow" : "Outflow"}
        </span>
        <div className="flex rounded-lg border border-outline-variant overflow-hidden">
          {TYPES.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => onTypeChange(t)}
              className={
                "px-md h-9 text-label-sm font-semibold transition " +
                (type === t ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Month">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
            {MONTHS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select value={category} onChange={(e) => onCategoryChange(e.target.value)} className={inputCls}>
            {cats.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Sub-Item">
          <select value={subItem} onChange={(e) => setSubItem(e.target.value)} className={inputCls}>
            {subs.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Payment Mode">
          <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputCls}>
            {PAYMENT_MODES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Amount (₹)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputCls}
            required
            placeholder="0.00"
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Description / Narration">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
              placeholder={type === "Revenue" ? "Candidate name or reference" : "Vendor / payee details"}
            />
          </Field>
        </div>
      </div>

      {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
      {ok && <div className="rounded-lg bg-green-50 text-green-700 px-md py-sm">Transaction saved.</div>}

      <div className="flex items-center gap-base pt-base">
        <button
          type="submit"
          disabled={busy}
          className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save transaction"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/daily-tracker")}
          className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}
