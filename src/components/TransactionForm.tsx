"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MONTHS, PAYMENT_MODES, TYPES, type TxType } from "@/lib/catalog";
import { InlineNewParty } from "./InlineNewParty";

export type TransactionFormValues = {
  type: TxType;
  date: string;
  month: string;
  category: string;
  subItem: string;
  paymentMode: string;
  amount: string;
  description: string;
  partyId: string | null;
};

export type MasterCategory = {
  id: string;
  name: string;
  type: "Revenue" | "Expense" | "Both";
  isActive: boolean;
  subItems: { id: string; name: string; isActive: boolean }[];
};

export type MasterParty = {
  id: string;
  name: string;
  group: "Candidate" | "Vendor";
  txTypes: "Revenue" | "Expense" | "Both";
  isActive: boolean;
};

function todayMonthCode(): string {
  const d = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthFromDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(+d)) return MONTHS[0];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const code = `${months[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(-2)}`;
  return (MONTHS as readonly string[]).includes(code) ? code : MONTHS[0];
}

export function TransactionForm({
  mode = "create",
  initial,
  transactionId,
  categories,
  parties,
}: {
  mode?: "create" | "edit";
  initial?: Partial<TransactionFormValues>;
  transactionId?: string;
  /** All categories (active + inactive) keyed for the dropdown. */
  categories: MasterCategory[];
  /** All parties (active only) keyed for the dropdown. */
  parties: MasterParty[];
}) {
  const router = useRouter();
  const [type, setType] = useState<TxType>((initial?.type as TxType) ?? "Revenue");

  const visibleCategories = useMemo(() => {
    return categories.filter(
      (c) => c.isActive && (c.type === type || c.type === "Both"),
    );
  }, [categories, type]);

  const [categoryName, setCategoryName] = useState<string>(
    initial?.category && visibleCategories.some((c) => c.name === initial.category)
      ? initial.category
      : visibleCategories[0]?.name ?? "",
  );

  const currentCategory = useMemo(
    () => visibleCategories.find((c) => c.name === categoryName) ?? null,
    [visibleCategories, categoryName],
  );

  const subItems = useMemo(() => {
    if (!currentCategory) return [];
    return currentCategory.subItems.filter((s) => s.isActive);
  }, [currentCategory]);

  const [subItemName, setSubItemName] = useState<string>(
    initial?.subItem && subItems.some((s) => s.name === initial.subItem)
      ? initial.subItem
      : subItems[0]?.name ?? "",
  );

  const [date, setDate] = useState<string>(initial?.date ?? todayIso());
  const [month, setMonth] = useState<string>(() => {
    if (initial?.month) return initial.month;
    const c = todayMonthCode();
    return (MONTHS as readonly string[]).includes(c) ? c : MONTHS[0];
  });
  const [paymentMode, setPaymentMode] = useState<string>(initial?.paymentMode ?? PAYMENT_MODES[0]);
  const [amount, setAmount] = useState<string>(initial?.amount ?? "");
  const [description, setDescription] = useState<string>(initial?.description ?? "");
  const [partyId, setPartyId] = useState<string | null>(initial?.partyId ?? null);
  const [partiesState, setPartiesState] = useState<MasterParty[]>(parties);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const visibleParties = useMemo(
    () =>
      partiesState.filter(
        (p) => p.isActive && (p.txTypes === type || p.txTypes === "Both"),
      ),
    [partiesState, type],
  );

  function onTypeChange(next: TxType) {
    setType(next);
    const cats = categories.filter((c) => c.isActive && (c.type === next || c.type === "Both"));
    const firstCat = cats[0];
    if (firstCat) {
      setCategoryName(firstCat.name);
      setSubItemName(firstCat.subItems.find((s) => s.isActive)?.name ?? "");
    } else {
      setCategoryName("");
      setSubItemName("");
    }
    // If the current party doesn't allow this tx type, clear it.
    if (partyId) {
      const cur = partiesState.find((p) => p.id === partyId);
      if (cur && cur.txTypes !== next && cur.txTypes !== "Both") setPartyId(null);
    }
  }

  function onCategoryChange(next: string) {
    setCategoryName(next);
    const cat = visibleCategories.find((c) => c.name === next);
    setSubItemName(cat?.subItems.find((s) => s.isActive)?.name ?? "");
  }

  function onDateChange(iso: string) {
    setDate(iso);
    setMonth(monthFromDate(iso));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setOkMessage(null);
    if (!categoryName || !subItemName) {
      setError("Pick a category and sub-category before saving.");
      return;
    }
    setBusy(true);
    const url =
      mode === "edit" && transactionId
        ? `/api/finance/transactions/${transactionId}`
        : "/api/finance/transactions";
    const method = mode === "edit" ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date,
        month,
        type,
        category: categoryName,
        subItem: subItemName,
        description: description || null,
        paymentMode,
        amount,
        partyId: partyId || null,
      }),
    });
    setBusy(false);
    if (!res.ok && res.status !== 202) {
      const data = await res.json().catch(() => ({}));
      setError(
        data?.error === "validation_failed"
          ? "Please check the values entered."
          : data?.error === "not_found"
            ? "Transaction no longer exists."
            : "Failed to save.",
      );
      return;
    }
    const data = await res.json().catch(() => ({}));
    setOk(true);
    setOkMessage(
      data?.applied === false
        ? mode === "edit"
          ? "Edit submitted for approval. It will appear on dashboards once a manager approves it."
          : "Transaction submitted for approval. It will appear on dashboards once a manager approves it."
        : mode === "edit"
          ? "Transaction updated."
          : "Transaction saved.",
    );
    if (mode === "create") {
      setAmount("");
      setDescription("");
      setPartyId(null);
    }
    router.refresh();
    if (mode === "edit") {
      router.push("/finance/daily-tracker");
    }
  }

  function handleNewParty(p: MasterParty) {
    setPartiesState((prev) => [...prev, p]);
    setPartyId(p.id);
  }

  const accent =
    type === "Revenue"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-red-50 text-red-700 border-red-200";

  return (
    <form
      onSubmit={onSubmit}
      className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg space-y-md"
    >
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
                (type === t
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        <Field label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Month">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            value={categoryName}
            onChange={(e) => onCategoryChange(e.target.value)}
            className={inputCls}
            required
          >
            {visibleCategories.length === 0 && <option value="">(no categories defined)</option>}
            {visibleCategories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sub-Item">
          <select
            value={subItemName}
            onChange={(e) => setSubItemName(e.target.value)}
            className={inputCls}
            required
          >
            {subItems.length === 0 && <option value="">(no sub-items)</option>}
            {subItems.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment Mode">
          <select
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value)}
            className={inputCls}
          >
            {PAYMENT_MODES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
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
          <Field label="Party (optional)">
            <div className="flex items-center gap-xs">
              <select
                value={partyId ?? ""}
                onChange={(e) => setPartyId(e.target.value || null)}
                className={inputCls + " flex-1"}
              >
                <option value="">— None —</option>
                {visibleParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.group}
                  </option>
                ))}
              </select>
              <InlineNewParty txType={type} onCreated={handleNewParty} />
            </div>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Description / Narration">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
              placeholder={
                type === "Revenue" ? "Reference / context" : "Vendor / payee details"
              }
            />
          </Field>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>
      )}
      {ok && (
        <div className="rounded-lg bg-green-50 text-green-700 px-md py-sm">{okMessage}</div>
      )}

      <div className="flex items-center gap-base pt-base">
        <button
          type="submit"
          disabled={busy}
          className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
        >
          {busy ? "Saving…" : mode === "edit" ? "Save changes" : "Save transaction"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/finance/daily-tracker")}
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
