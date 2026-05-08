"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TxType } from "@/lib/catalog";
import type { MasterParty } from "./TransactionForm";

/**
 * "+ New Party" button next to the Party dropdown on the transaction form.
 * Lets the user create a Party inline without leaving the form.
 */
export function InlineNewParty({
  txType,
  onCreated,
}: {
  txType: TxType;
  onCreated: (p: MasterParty) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    group: "Candidate" as "Candidate" | "Vendor",
    txTypes: txType as "Revenue" | "Expense" | "Both",
  });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    // When the parent form's tx type flips, default the new-party form's
    // txTypes to match — simpler for the user.
    setForm((f) => ({ ...f, txTypes: txType }));
  }, [txType]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/master/parties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        group: form.group,
        txTypes: form.txTypes,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data?.error === "name_taken"
          ? "That party already exists."
          : data?.error === "validation_failed"
            ? "Check the values entered."
            : "Failed to create.",
      );
      return;
    }
    const data = await res.json();
    onCreated({
      id: data.party.id,
      name: data.party.name,
      group: data.party.group,
      txTypes: data.party.txTypes,
      isActive: data.party.isActive,
    });
    setOpen(false);
    setForm({ name: "", group: "Candidate", txTypes: txType });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Create new party"
        className="h-10 px-md rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition flex items-center gap-xs flex-shrink-0"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          person_add
        </span>
        New
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md"
            onClick={() => !busy && setOpen(false)}
          >
            <form
              onSubmit={submit}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New party</h3>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                  className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md"
                />
              </label>
              <div className="grid grid-cols-2 gap-md">
                <label className="block">
                  <span className="block text-label-sm text-on-surface-variant mb-xs">Group</span>
                  <select
                    value={form.group}
                    onChange={(e) =>
                      setForm({ ...form, group: e.target.value as "Candidate" | "Vendor" })
                    }
                    className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary"
                  >
                    <option value="Candidate">Candidate</option>
                    <option value="Vendor">Vendor</option>
                  </select>
                </label>
                <label className="block">
                  <span className="block text-label-sm text-on-surface-variant mb-xs">Tx types</span>
                  <select
                    value={form.txTypes}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        txTypes: e.target.value as "Revenue" | "Expense" | "Both",
                      })
                    }
                    className="w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md outline-none focus:border-primary"
                  >
                    <option value="Revenue">Revenue</option>
                    <option value="Expense">Expense</option>
                    <option value="Both">Both</option>
                  </select>
                </label>
              </div>
              {error && (
                <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">
                  {error}
                </div>
              )}
              <div className="flex items-center gap-base pt-base">
                <button
                  type="submit"
                  disabled={busy}
                  className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
                >
                  {busy ? "Creating…" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
