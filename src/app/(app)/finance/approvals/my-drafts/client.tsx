"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inrFull } from "@/lib/format";

export type Draft = {
  id: string;
  date: string;
  month: string;
  type: string;
  category: string;
  subItem: string;
  description: string | null;
  paymentMode: string;
  amount: number;
  flow: string;
  partyId: string | null;
  partyName: string | null;
  partyGroup: string | null;
  createdAt: string;
};

type CategoryMaster = {
  id: string;
  name: string;
  type: string;
  subItems: { id: string; name: string }[];
};
type PartyMaster = {
  id: string;
  name: string;
  group: string;
  txTypes: string;
};

const PAYMENT_MODES = ["Cash", "Bank", "Axis Bank", "HDFC Bank", "RCS", "STR", "Wio Bank", "Credit Card", "Other"];

export function MyDraftsClient({
  drafts: initial,
  categories,
  parties,
}: {
  drafts: Draft[];
  categories: CategoryMaster[];
  parties: PartyMaster[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(initial);
  const [editing, setEditing] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, startNav] = useTransition();

  const partyById = useMemo(
    () => new Map(parties.map((p) => [p.id, p])),
    [parties],
  );

  function startEdit(d: Draft) {
    setEditing((m) => ({ ...m, [d.id]: { ...d } }));
  }
  function cancelEdit(id: string) {
    setEditing((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }
  function patchEdit(id: string, patch: Partial<Draft>) {
    setEditing((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  }

  async function saveEdit(id: string) {
    const e = editing[id];
    if (!e) return;
    setError(null);
    setBusyIds((s) => new Set([...s, id]));
    const res = await fetch(`/api/finance/drafts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: e.date,
        month: e.month,
        type: e.type,
        category: e.category,
        subItem: e.subItem,
        description: e.description,
        paymentMode: e.paymentMode,
        amount: e.amount,
        flow: e.flow,
        partyId: e.partyId,
      }),
    });
    setBusyIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`Edit failed: ${(data as { error?: string }).error ?? "unknown"}`);
      return;
    }
    setDrafts((rows) => rows.map((r) => (r.id === id ? { ...e, partyName: partyById.get(e.partyId ?? "")?.name ?? null, partyGroup: partyById.get(e.partyId ?? "")?.group ?? null } : r)));
    cancelEdit(id);
    setToast("Draft saved.");
  }

  async function submitOne(id: string) {
    setError(null);
    setBusyIds((s) => new Set([...s, id]));
    const res = await fetch(`/api/finance/drafts/${id}/submit`, { method: "POST" });
    setBusyIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`Submit failed: ${(data as { error?: string }).error ?? "unknown"}`);
      return;
    }
    setDrafts((rows) => rows.filter((r) => r.id !== id));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    setToast("Submitted for approval.");
    startNav(() => router.refresh());
  }

  async function discardOne(id: string) {
    if (!confirm("Discard this draft? This cannot be undone.")) return;
    setError(null);
    setBusyIds((s) => new Set([...s, id]));
    const res = await fetch(`/api/finance/drafts/${id}`, { method: "DELETE" });
    setBusyIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`Discard failed: ${(data as { error?: string }).error ?? "unknown"}`);
      return;
    }
    setDrafts((rows) => rows.filter((r) => r.id !== id));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    setToast("Draft discarded.");
    startNav(() => router.refresh());
  }

  async function submitSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Submit ${ids.length} draft${ids.length === 1 ? "" : "s"} for approval?`)) return;
    setError(null);
    setBulkBusy(true);
    const res = await fetch("/api/finance/drafts/submit-bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setBulkBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(`Bulk submit failed: ${(data as { error?: string }).error ?? "unknown"}`);
      return;
    }
    const data = (await res.json()) as { processed: number; errors: { id: string; error: string }[] };
    const okIds = new Set(ids.filter((id) => !data.errors.find((e) => e.id === id)));
    setDrafts((rows) => rows.filter((r) => !okIds.has(r.id)));
    setSelected(new Set());
    setToast(
      data.errors.length === 0
        ? `${data.processed} draft${data.processed === 1 ? "" : "s"} submitted.`
        : `${data.processed} submitted, ${data.errors.length} failed (${data.errors.map((e) => e.error).join(", ")}).`,
    );
    startNav(() => router.refresh());
  }

  // Sub-items available for the editing row, filtered by chosen category + type.
  function subItemsFor(d: Draft): { id: string; name: string }[] {
    const cat = categories.find(
      (c) => c.name === d.category && (c.type === d.type || c.type === "Both"),
    );
    return cat?.subItems ?? [];
  }

  const flowFor = (type: string) => (type === "Revenue" ? "Inflow" : "Outflow");

  return (
    <div className="space-y-md">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-md bg-surface-container-lowest border border-outline-variant rounded-xl p-md">
        <input
          type="checkbox"
          aria-label="Select all"
          checked={drafts.length > 0 && selected.size === drafts.length}
          onChange={(e) => {
            if (e.target.checked) setSelected(new Set(drafts.map((d) => d.id)));
            else setSelected(new Set());
          }}
          className="w-[18px] h-[18px] cursor-pointer"
        />
        <span className="text-body-md text-on-surface-variant">
          {selected.size} of {drafts.length} selected
        </span>
        <div className="ml-auto flex items-center gap-base">
          <button
            type="button"
            onClick={submitSelected}
            disabled={selected.size === 0 || bulkBusy}
            className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkBusy ? "Submitting…" : `Submit ${selected.size > 0 ? selected.size : ""} for approval`}
          </button>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg bg-green-50 text-green-800 border border-green-200 px-md py-sm text-body-md flex items-center gap-sm">
          {toast}
          <button onClick={() => setToast(null)} className="ml-auto text-caption underline">
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
          {error}
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-xl text-center text-on-surface-variant">
          No drafts. New transactions you create on Daily Tracker or via the New Transaction form will land here for you to review before submitting.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant">
          <table className="w-full text-body-md min-w-[1400px]">
            <thead className="bg-surface-container-low text-on-surface-variant">
              <tr className="text-left">
                <Th align="center"> </Th>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Category</Th>
                <Th>Sub-item</Th>
                <Th>Party</Th>
                <Th>Description</Th>
                <Th>Payment</Th>
                <Th align="right">Amount</Th>
                <Th align="center">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => {
                const e = editing[d.id];
                const isEditing = !!e;
                const isBusy = busyIds.has(d.id);
                const row = e ?? d;
                const subOptions = subItemsFor(row);
                const partyOptions = parties.filter(
                  (p) => p.txTypes === "Both" || p.txTypes === row.type,
                );
                return (
                  <tr
                    key={d.id}
                    className="border-t border-outline-variant/60"
                    style={isEditing ? { backgroundColor: "rgba(250, 204, 21, 0.04)" } : undefined}
                  >
                    <td className="px-sm py-sm text-center">
                      <input
                        type="checkbox"
                        aria-label="Select draft"
                        checked={selected.has(d.id)}
                        onChange={(ev) => {
                          setSelected((s) => {
                            const next = new Set(s);
                            if (ev.target.checked) next.add(d.id);
                            else next.delete(d.id);
                            return next;
                          });
                        }}
                        className="w-[18px] h-[18px] cursor-pointer"
                        disabled={isEditing}
                      />
                    </td>
                    <td className="px-sm py-sm whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="date"
                          value={row.date}
                          onChange={(ev) =>
                            patchEdit(d.id, {
                              date: ev.target.value,
                              month: ev.target.value.slice(0, 7),
                            })
                          }
                          className="h-9 px-sm rounded-md border border-outline-variant w-[140px]"
                        />
                      ) : (
                        <span className="font-mono">{fmtDDMMYY(row.date)}</span>
                      )}
                    </td>
                    <td className="px-sm py-sm">
                      {isEditing ? (
                        <select
                          value={row.type}
                          onChange={(ev) => {
                            const t = ev.target.value;
                            patchEdit(d.id, {
                              type: t,
                              flow: flowFor(t),
                              // Reset category/subItem if they don't fit the new type.
                              category: categories.find(
                                (c) => c.name === row.category && (c.type === t || c.type === "Both"),
                              )
                                ? row.category
                                : "",
                              subItem: "",
                            });
                          }}
                          className="h-9 px-sm rounded-md border border-outline-variant"
                        >
                          <option value="Revenue">Revenue</option>
                          <option value="Expense">Expense</option>
                        </select>
                      ) : (
                        row.type
                      )}
                    </td>
                    <td className="px-sm py-sm">
                      {isEditing ? (
                        <select
                          value={row.category}
                          onChange={(ev) =>
                            patchEdit(d.id, { category: ev.target.value, subItem: "" })
                          }
                          className="h-9 px-sm rounded-md border border-outline-variant min-w-[180px]"
                        >
                          <option value="">—</option>
                          {categories
                            .filter((c) => c.type === row.type || c.type === "Both")
                            .map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        row.category
                      )}
                    </td>
                    <td className="px-sm py-sm">
                      {isEditing ? (
                        <select
                          value={row.subItem}
                          onChange={(ev) => patchEdit(d.id, { subItem: ev.target.value })}
                          className="h-9 px-sm rounded-md border border-outline-variant min-w-[180px]"
                          disabled={!row.category}
                        >
                          <option value="">—</option>
                          {subOptions.map((s) => (
                            <option key={s.id} value={s.name}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.subItem
                      )}
                    </td>
                    <td className="px-sm py-sm">
                      {isEditing ? (
                        <select
                          value={row.partyId ?? ""}
                          onChange={(ev) =>
                            patchEdit(d.id, { partyId: ev.target.value || null })
                          }
                          className="h-9 px-sm rounded-md border border-outline-variant min-w-[180px]"
                        >
                          <option value="">—</option>
                          {partyOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.group})
                            </option>
                          ))}
                        </select>
                      ) : row.partyId ? (
                        `${d.partyName ?? "(unknown)"}${d.partyGroup ? ` (${d.partyGroup})` : ""}`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-sm py-sm max-w-[240px]">
                      {isEditing ? (
                        <input
                          type="text"
                          value={row.description ?? ""}
                          onChange={(ev) =>
                            patchEdit(d.id, { description: ev.target.value || null })
                          }
                          className="h-9 px-sm rounded-md border border-outline-variant w-full"
                          placeholder="Description"
                        />
                      ) : (
                        <span className="text-on-surface-variant truncate block" title={row.description ?? undefined}>
                          {row.description || "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-sm py-sm">
                      {isEditing ? (
                        <select
                          value={row.paymentMode}
                          onChange={(ev) => patchEdit(d.id, { paymentMode: ev.target.value })}
                          className="h-9 px-sm rounded-md border border-outline-variant"
                        >
                          {PAYMENT_MODES.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.paymentMode
                      )}
                    </td>
                    <td className="px-sm py-sm text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={row.amount}
                          onChange={(ev) =>
                            patchEdit(d.id, { amount: Number(ev.target.value) })
                          }
                          className="h-9 px-sm rounded-md border border-outline-variant text-right w-[120px]"
                        />
                      ) : (
                        <span className="font-mono font-semibold">{inrFull(row.amount)}</span>
                      )}
                    </td>
                    <td className="px-sm py-sm">
                      <div className="flex items-center gap-xs justify-center">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEdit(d.id)}
                              disabled={isBusy || !row.category || !row.subItem || !row.paymentMode || !row.date || !(row.amount > 0)}
                              className="h-9 px-sm rounded-md bg-primary text-on-primary font-semibold text-caption disabled:opacity-50"
                            >
                              {isBusy ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelEdit(d.id)}
                              disabled={isBusy}
                              className="h-9 px-sm rounded-md border border-outline-variant text-caption"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(d)}
                              disabled={isBusy}
                              className="h-9 px-sm rounded-md border border-outline-variant text-caption hover:bg-surface-container-low"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => submitOne(d.id)}
                              disabled={isBusy}
                              className="h-9 px-sm rounded-md bg-primary text-on-primary font-semibold text-caption disabled:opacity-50"
                              title="Submit this draft for approval"
                            >
                              {isBusy ? "…" : "Submit"}
                            </button>
                            <button
                              type="button"
                              onClick={() => discardOne(d.id)}
                              disabled={isBusy}
                              className="h-9 px-sm rounded-md border border-red-200 text-red-700 text-caption hover:bg-red-50"
                              title="Discard this draft"
                            >
                              Discard
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th
      className="px-sm py-sm text-label-sm uppercase font-semibold tracking-wider whitespace-nowrap"
      style={{ textAlign: align ?? "left" }}
    >
      {children}
    </th>
  );
}

function fmtDDMMYY(s: string): string {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const [, y, mm, dd] = m;
  return `${dd}-${mm}-${y.slice(2)}`;
}
