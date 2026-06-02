"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MONTHS, PAYMENT_MODES, TYPES, type TxType } from "@/lib/catalog";

type MasterCategory = {
  id: string;
  name: string;
  type: "Revenue" | "Expense" | "Both";
  isActive: boolean;
  subItems: { id: string; name: string; isActive: boolean }[];
};

type MasterParty = {
  id: string;
  name: string;
  group: "Candidate" | "Vendor";
  txTypes: "Revenue" | "Expense" | "Both";
  isActive: boolean;
};

type MasterEmployee = {
  id: string;
  name: string;
  designation: string | null;
};

type ProposedTx = {
  date: string;
  month: string;
  type: string;
  category: string;
  subItem: string;
  description?: string | null;
  paymentMode: string;
  amount: number;
  flow: string;
  partyId?: string | null;
  employeeId?: string | null;
  expDom?: string | null;
};

/**
 * Inline editor that lets the submitter of a rejected PendingApproval
 * patch the proposed payload and resubmit it for review with a note.
 *
 * For kind=delete, there's nothing to edit — just the note + Resubmit
 * button. For create/update, the full tx form is shown with the
 * rejected values pre-filled.
 *
 * Dismiss action hard-deletes the rejected approval so it stops
 * counting toward the user's "rejected queue" badge.
 */
export function ResubmitEditor({
  pendingId,
  kind,
  initialProposed,
  categories,
  parties,
  employees = [],
}: {
  pendingId: string;
  kind: "create" | "update" | "delete";
  initialProposed: ProposedTx | null;
  categories: MasterCategory[];
  parties: MasterParty[];
  employees?: MasterEmployee[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Form fields — for create/update only.
  const fallbackType: TxType =
    (initialProposed?.type as TxType) ?? "Revenue";
  const [type, setType] = useState<TxType>(fallbackType);
  const [date, setDate] = useState<string>(
    initialProposed?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [month, setMonth] = useState<string>(
    initialProposed?.month && (MONTHS as readonly string[]).includes(initialProposed.month)
      ? initialProposed.month
      : MONTHS[0],
  );
  const [paymentMode, setPaymentMode] = useState<string>(
    initialProposed?.paymentMode ?? PAYMENT_MODES[0],
  );
  const [amount, setAmount] = useState<string>(
    initialProposed?.amount?.toString() ?? "",
  );
  const [description, setDescription] = useState<string>(
    initialProposed?.description ?? "",
  );
  const [partyId, setPartyId] = useState<string | null>(
    initialProposed?.partyId ?? null,
  );
  const [employeeId, setEmployeeId] = useState<string | null>(
    initialProposed?.employeeId ?? null,
  );
  // EXP/DOM tag — only meaningful for Revenue. Pre-fill from the rejected
  // row when it carries a valid tag; otherwise leave it blank so the
  // submitter must consciously pick. (The rows this recovers are the ones
  // whose tag was lost — silently defaulting DOM could misclassify a true
  // EXP/export row into the GST-taxable base.)
  const [expDom, setExpDom] = useState<"" | "EXP" | "DOM">(
    initialProposed?.expDom === "EXP" ? "EXP" : initialProposed?.expDom === "DOM" ? "DOM" : "",
  );

  const visibleCategories = useMemo(
    () =>
      categories.filter(
        (c) => c.isActive && (c.type === type || c.type === "Both"),
      ),
    [categories, type],
  );

  const [categoryName, setCategoryName] = useState<string>(
    initialProposed?.category &&
      visibleCategories.some((c) => c.name === initialProposed.category)
      ? initialProposed.category
      : visibleCategories[0]?.name ?? "",
  );

  const currentCategory = useMemo(
    () => visibleCategories.find((c) => c.name === categoryName) ?? null,
    [visibleCategories, categoryName],
  );

  const subItems = useMemo(
    () => currentCategory?.subItems.filter((s) => s.isActive) ?? [],
    [currentCategory],
  );

  const [subItemName, setSubItemName] = useState<string>(
    initialProposed?.subItem && subItems.some((s) => s.name === initialProposed.subItem)
      ? initialProposed.subItem
      : subItems[0]?.name ?? "",
  );

  const visibleParties = useMemo(
    () =>
      parties.filter(
        (p) => p.isActive && (p.txTypes === type || p.txTypes === "Both"),
      ),
    [parties, type],
  );

  function onTypeChange(next: TxType) {
    setType(next);
    const cats = categories.filter(
      (c) => c.isActive && (c.type === next || c.type === "Both"),
    );
    const firstCat = cats[0];
    if (firstCat) {
      setCategoryName(firstCat.name);
      setSubItemName(firstCat.subItems.find((s) => s.isActive)?.name ?? "");
    }
    // If the current party doesn't allow this tx type, clear it.
    if (partyId) {
      const cur = parties.find((p) => p.id === partyId);
      if (cur && cur.txTypes !== next && cur.txTypes !== "Both") setPartyId(null);
    }
    // Employees may only be the counterparty on Expense rows.
    if (next !== "Expense") setEmployeeId(null);
  }

  function onCategoryChange(next: string) {
    setCategoryName(next);
    const c = categories.find((cat) => cat.name === next);
    setSubItemName(c?.subItems.find((s) => s.isActive)?.name ?? "");
  }

  async function resubmit() {
    setError(null);
    const amt = Number(amount);
    if (kind !== "delete") {
      if (!date || !categoryName || !subItemName || !paymentMode) {
        setError("All fields are required.");
        return;
      }
      if (type === "Revenue" && expDom !== "EXP" && expDom !== "DOM") {
        setError("Select EXP or DOM for this revenue entry.");
        return;
      }
      if (!Number.isFinite(amt) || amt < 0) {
        setError("Amount must be a non-negative number.");
        return;
      }
      if (!partyId && !employeeId) {
        setError(
          type === "Expense" ? "Select a party or employee." : "Select a party.",
        );
        return;
      }
    }
    setBusy(true);
    const res = await fetch(`/api/finance/approvals/${pendingId}/resubmit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: note.trim() || undefined,
        ...(kind === "delete"
          ? {}
          : {
              proposed: {
                date,
                month,
                type,
                category: categoryName,
                subItem: subItemName,
                description: description || null,
                paymentMode,
                amount: amt,
                flow: type === "Revenue" ? "Inflow" : "Outflow",
                partyId: partyId || null,
                employeeId: employeeId || null,
                expDom: type === "Revenue" ? expDom : null,
              },
            }),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "Failed to resubmit.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function dismiss() {
    if (
      !confirm(
        "Dismiss this rejection? The rejected entry will be removed from your queue (the audit log retains it).",
      )
    )
      return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/approvals/${pendingId}/dismiss`, {
      method: "POST",
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "Failed to dismiss.");
      return;
    }
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center gap-base pt-sm border-t border-outline-variant/60">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
        >
          Edit & resubmit
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low"
        >
          Dismiss
        </button>
        {error && (
          <div className="text-label-sm text-error ml-base">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-md pt-md border-t border-outline-variant/60">
      <h4 className="text-label-md font-semibold text-on-surface">
        Edit and resubmit
      </h4>
      {kind !== "delete" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Month">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={inputCls}
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select
              value={type}
              onChange={(e) => onTypeChange(e.target.value as TxType)}
              className={inputCls}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          {type === "Revenue" && (
            <Field label="EXP / DOM">
              <select
                value={expDom}
                onChange={(e) => setExpDom(e.target.value as "" | "EXP" | "DOM")}
                className={inputCls}
              >
                <option value="">— select —</option>
                <option value="DOM">DOM</option>
                <option value="EXP">EXP</option>
              </select>
            </Field>
          )}
          <Field label="Category">
            <select
              value={categoryName}
              onChange={(e) => onCategoryChange(e.target.value)}
              className={inputCls}
            >
              {visibleCategories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sub-item">
            <select
              value={subItemName}
              onChange={(e) => setSubItemName(e.target.value)}
              className={inputCls}
            >
              {subItems.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment mode">
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className={inputCls}
            >
              {PAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (₹)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls + " text-right font-mono"}
            />
          </Field>
          <Field label={type === "Expense" ? "Party / Employee" : "Party"}>
            <select
              value={partyId ? `p:${partyId}` : employeeId ? `e:${employeeId}` : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("e:")) {
                  setEmployeeId(v.slice(2));
                  setPartyId(null);
                } else if (v.startsWith("p:")) {
                  setPartyId(v.slice(2));
                  setEmployeeId(null);
                } else {
                  setPartyId(null);
                  setEmployeeId(null);
                }
              }}
              className={inputCls}
            >
              <option value="">
                {type === "Expense" ? "— select party or employee —" : "— select party —"}
              </option>
              <optgroup label="Candidates / Vendors">
                {visibleParties.map((p) => (
                  <option key={p.id} value={`p:${p.id}`}>
                    {p.name} {p.group === "Candidate" ? "(Candidate)" : "(Vendor)"}
                  </option>
                ))}
              </optgroup>
              {type === "Expense" && employees.length > 0 && (
                <optgroup label="Employees">
                  {employees.map((emp) => (
                    <option key={emp.id} value={`e:${emp.id}`}>
                      {emp.name}
                      {emp.designation ? ` · ${emp.designation}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={inputCls + " py-sm"}
              />
            </Field>
          </div>
        </div>
      )}
      <Field label="Resubmission note (visible to reviewer)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What changed? Why is it being resubmitted?"
          className={inputCls + " py-sm"}
        />
      </Field>
      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">
          {error}
        </div>
      )}
      <div className="flex items-center gap-base">
        <button
          type="button"
          onClick={resubmit}
          disabled={busy}
          className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60"
        >
          {busy ? "Submitting…" : "Submit for approval"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="h-10 px-lg rounded-lg border border-outline-variant text-label-sm text-on-surface-variant ml-auto"
        >
          Dismiss instead
        </button>
      </div>
    </div>
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
