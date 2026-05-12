"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inrFull } from "@/lib/format";

type ServiceOption = { id: string; name: string };
type SourceOption = { id: string; code: string; label: string; active: boolean };

type PartyServiceRow = {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceActive: boolean;
  totalAmount: number;
  notes: string | null;
  paidSoFar: number;
};

type Party = {
  id: string;
  name: string;
  group: "Candidate" | "Vendor";
  txTypes: "Revenue" | "Expense" | "Both";
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  sourceId: string | null;
  sourceLabel: string | null;
  assignedL2BdeId: string | null;
  assignedL2BdeUsername: string | null;
  partyServices: PartyServiceRow[];
};

type L2Bde = { id: string; username: string; displayName: string };

type TransactionRow = {
  id: string;
  date: string;
  type: string;
  category: string;
  subItem: string;
  description: string | null;
  paymentMode: string;
  amount: number;
};

type Totals = {
  totalQuoted: number;
  totalPaid: number;
  totalRefunded: number;
  balanceRemaining: number;
};

const errorLabels: Record<string, string> = {
  validation_failed: "Check the values entered.",
  not_found: "Party no longer exists.",
  service_required: "Candidates must have at least one service.",
  source_required: "Candidates must have a Source.",
  source_not_found: "The selected Source no longer exists.",
  service_not_found: "Service not found.",
};

export function PartyProfile({
  party,
  totals,
  services,
  sources,
  l2Bdes,
  transactions,
}: {
  party: Party;
  totals: Totals;
  services: ServiceOption[];
  sources: SourceOption[];
  l2Bdes: L2Bde[];
  transactions: TransactionRow[];
}) {
  return (
    <div className="space-y-lg">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-md">
        <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-lg space-y-md">
          <h2 className="text-h3">Profile</h2>
          <ContactPanel party={party} sources={sources} l2Bdes={l2Bdes} />
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg space-y-md">
          <h2 className="text-h3">Totals</h2>
          <Stat label="Quoted (sum of services)" value={inrFull(totals.totalQuoted)} />
          <Stat label="Paid so far (Revenue)" value={inrFull(totals.totalPaid)} positive />
          {totals.totalRefunded > 0 && (
            <Stat label="Refunds / outflow" value={inrFull(totals.totalRefunded)} negative />
          )}
          <Stat
            label="Balance remaining"
            value={inrFull(totals.balanceRemaining)}
            highlight
          />
        </div>
      </div>

      {party.group === "Candidate" && (
        <ServicesPanel party={party} services={services} />
      )}

      <TransactionsPanel transactions={transactions} />
    </div>
  );
}

function Stat({
  label,
  value,
  positive,
  negative,
  highlight,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
  highlight?: boolean;
}) {
  const color = highlight
    ? "text-accent"
    : positive
      ? "text-green-700"
      : negative
        ? "text-red-700"
        : "text-on-surface";
  return (
    <div className="flex items-center justify-between">
      <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
        {label}
      </span>
      <span className={`font-mono font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function ContactPanel({
  party,
  sources,
  l2Bdes,
}: {
  party: Party;
  sources: SourceOption[];
  l2Bdes: L2Bde[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: party.name,
    email: party.email ?? "",
    phone: party.phone ?? "",
    notes: party.notes ?? "",
    sourceId: party.sourceId ?? "",
    assignedL2BdeId: party.assignedL2BdeId ?? "",
    isActive: party.isActive,
  });

  async function save() {
    setError(null);
    if (party.group === "Candidate" && !draft.sourceId) {
      setError(errorLabels.source_required);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/master/parties/${party.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        notes: draft.notes,
        isActive: draft.isActive,
        ...(party.group === "Candidate"
          ? {
              sourceId: draft.sourceId,
              assignedL2BdeId: draft.assignedL2BdeId || null,
            }
          : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[(data as { error?: string }).error ?? ""] ?? "Failed to save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="grid grid-cols-2 gap-md text-body-md">
        <Field readOnly label="Name" value={party.name} />
        <Field readOnly label="Group" value={party.group} />
        {party.group === "Candidate" && (
          <Field readOnly label="Source" value={party.sourceLabel ?? "—"} />
        )}
        {party.group === "Candidate" && (
          <Field
            readOnly
            label="Closed by (L2 BDE)"
            value={party.assignedL2BdeUsername ?? "—"}
          />
        )}
        <Field readOnly label="Tx types" value={party.txTypes} />
        <Field readOnly label="Email" value={party.email ?? "—"} />
        <Field readOnly label="Phone" value={party.phone ?? "—"} />
        <Field readOnly label="Status" value={party.isActive ? "Active" : "Inactive"} />
        <div className="col-span-2">
          <Field readOnly label="Notes" value={party.notes ?? "—"} />
        </div>
        <div className="col-span-2 pt-sm">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold"
          >
            Edit profile
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-sm">
      <div className="grid grid-cols-2 gap-md">
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={inputCls}
          />
        </label>
        {party.group === "Candidate" && (
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">
              Source <span className="text-error">*</span>
            </span>
            <select
              value={draft.sourceId}
              onChange={(e) => setDraft({ ...draft, sourceId: e.target.value })}
              className={inputCls}
              required
            >
              <option value="">— pick source —</option>
              {sources
                .filter((s) => s.active || s.id === party.sourceId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
          </label>
        )}
        {party.group === "Candidate" && (
          <label className="block">
            <span className="block text-label-sm text-on-surface-variant mb-xs">
              Closed by (L2 BDE)
            </span>
            <select
              value={draft.assignedL2BdeId}
              onChange={(e) =>
                setDraft({ ...draft, assignedL2BdeId: e.target.value })
              }
              className={inputCls}
            >
              <option value="">— unassigned —</option>
              {l2Bdes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.displayName} ({b.username})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Email</span>
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Phone</span>
          <input
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="block col-span-2">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Notes</span>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={2}
            className={inputCls + " py-sm"}
          />
        </label>
        <label className="flex items-center gap-xs col-span-2">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-body-md">Active</span>
        </label>
      </div>
      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
          {error}
        </div>
      )}
      <div className="flex items-center gap-base pt-sm">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft({
              name: party.name,
              email: party.email ?? "",
              phone: party.phone ?? "",
              notes: party.notes ?? "",
              sourceId: party.sourceId ?? "",
              assignedL2BdeId: party.assignedL2BdeId ?? "",
              isActive: party.isActive,
            });
            setError(null);
          }}
          className="h-9 px-md rounded-lg border border-outline-variant text-on-surface-variant"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ServicesPanel({
  party,
  services,
}: {
  party: Party;
  services: ServiceOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRows, setDraftRows] = useState(
    party.partyServices.map((ps) => ({
      key: ps.id,
      serviceId: ps.serviceId,
      totalAmount: ps.totalAmount,
      notes: ps.notes ?? "",
    })),
  );
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState({ serviceId: "", totalAmount: 0, notes: "" });

  const linkedServiceIds = new Set(draftRows.map((r) => r.serviceId));
  const dirty =
    JSON.stringify(draftRows) !==
    JSON.stringify(
      party.partyServices.map((ps) => ({
        key: ps.id,
        serviceId: ps.serviceId,
        totalAmount: ps.totalAmount,
        notes: ps.notes ?? "",
      })),
    );

  async function persist(rows: typeof draftRows) {
    setError(null);
    if (rows.length === 0) {
      setError(errorLabels.service_required);
      return false;
    }
    setBusy(true);
    const res = await fetch(`/api/master/parties/${party.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        partyServices: rows.map((r) => ({
          serviceId: r.serviceId,
          totalAmount: r.totalAmount,
          notes: r.notes,
        })),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[(data as { error?: string }).error ?? ""] ?? "Failed to save.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function saveAll() {
    const ok = await persist(draftRows);
    if (ok) router.refresh();
  }

  async function addService() {
    if (!newRow.serviceId) return;
    if (linkedServiceIds.has(newRow.serviceId)) {
      setError("That service is already linked.");
      return;
    }
    const next = [
      ...draftRows,
      {
        key: `new-${newRow.serviceId}`,
        serviceId: newRow.serviceId,
        totalAmount: Number(newRow.totalAmount) || 0,
        notes: newRow.notes,
      },
    ];
    const ok = await persist(next);
    if (ok) {
      setDraftRows(next);
      setAdding(false);
      setNewRow({ serviceId: "", totalAmount: 0, notes: "" });
    }
  }

  async function remove(serviceId: string) {
    const next = draftRows.filter((r) => r.serviceId !== serviceId);
    const ok = await persist(next);
    if (ok) setDraftRows(next);
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg space-y-md">
      <div className="flex items-center justify-between">
        <h2 className="text-h3">Services</h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="h-8 px-md rounded-lg border border-outline-variant text-label-sm hover:bg-surface-container-low"
          >
            + Add service
          </button>
        )}
      </div>

      {draftRows.length === 0 && !adding && (
        <p className="text-body-md text-on-surface-variant">
          No services linked yet. Click <strong>+ Add service</strong> to add one.
        </p>
      )}

      <div className="space-y-sm">
        {draftRows.map((r, i) => {
          const ps = party.partyServices.find((p) => p.serviceId === r.serviceId);
          const paid = ps?.paidSoFar ?? 0;
          const remaining = (Number(r.totalAmount) || 0) - paid;
          return (
            <div
              key={r.key}
              className="grid grid-cols-1 md:grid-cols-12 gap-sm items-start border border-outline-variant rounded-lg p-md"
            >
              <div className="md:col-span-4">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Service</span>
                <span className="block font-semibold">
                  {ps?.serviceName ?? services.find((s) => s.id === r.serviceId)?.name}
                  {ps && !ps.serviceActive && (
                    <span className="ml-xs text-caption text-on-surface-variant italic">
                      (inactive)
                    </span>
                  )}
                </span>
              </div>
              <label className="md:col-span-3 block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">
                  Total amount (₹)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={r.totalAmount}
                  onChange={(e) => {
                    const next = [...draftRows];
                    next[i] = { ...r, totalAmount: Number(e.target.value) || 0 };
                    setDraftRows(next);
                  }}
                  className={inputCls + " text-right font-mono"}
                />
              </label>
              <div className="md:col-span-2">
                <span className="block text-label-sm text-on-surface-variant mb-xs">
                  Paid
                </span>
                <span className="block font-mono text-green-700">{inrFull(paid)}</span>
              </div>
              <div className="md:col-span-2">
                <span className="block text-label-sm text-on-surface-variant mb-xs">
                  Remaining
                </span>
                <span
                  className={
                    "block font-mono " + (remaining > 0 ? "text-accent" : "text-on-surface-variant")
                  }
                >
                  {inrFull(remaining)}
                </span>
              </div>
              <div className="md:col-span-1 flex justify-end pt-[22px]">
                <button
                  type="button"
                  onClick={() => remove(r.serviceId)}
                  disabled={busy}
                  title="Unlink service"
                  className="text-on-surface-variant hover:text-error p-xs disabled:opacity-30"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    close
                  </span>
                </button>
              </div>
              <label className="md:col-span-12 block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Notes</span>
                <input
                  value={r.notes}
                  onChange={(e) => {
                    const next = [...draftRows];
                    next[i] = { ...r, notes: e.target.value };
                    setDraftRows(next);
                  }}
                  className={inputCls}
                  placeholder="Internal notes (optional)"
                />
              </label>
            </div>
          );
        })}

        {adding && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-sm items-end border-2 border-dashed border-primary/40 rounded-lg p-md bg-primary/5">
            <label className="md:col-span-5 block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Service</span>
              <select
                value={newRow.serviceId}
                onChange={(e) => setNewRow({ ...newRow, serviceId: e.target.value })}
                className={inputCls}
              >
                <option value="">— pick service —</option>
                {services
                  .filter((s) => !linkedServiceIds.has(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="md:col-span-3 block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">
                Total amount (₹)
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={newRow.totalAmount}
                onChange={(e) =>
                  setNewRow({ ...newRow, totalAmount: Number(e.target.value) || 0 })
                }
                className={inputCls + " text-right font-mono"}
              />
            </label>
            <label className="md:col-span-3 block">
              <span className="block text-label-sm text-on-surface-variant mb-xs">Notes</span>
              <input
                value={newRow.notes}
                onChange={(e) => setNewRow({ ...newRow, notes: e.target.value })}
                className={inputCls}
              />
            </label>
            <div className="md:col-span-1 flex justify-end gap-xs">
              <button
                type="button"
                onClick={addService}
                disabled={busy || !newRow.serviceId}
                className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="md:col-span-12 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewRow({ serviceId: "", totalAmount: 0, notes: "" });
                }}
                className="h-8 px-md rounded-lg text-label-sm text-on-surface-variant"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
          {error}
        </div>
      )}

      {dirty && (
        <div className="flex justify-end pt-sm border-t border-outline-variant/60">
          <button
            type="button"
            onClick={saveAll}
            disabled={busy}
            className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save amounts"}
          </button>
        </div>
      )}
    </div>
  );
}

function TransactionsPanel({ transactions }: { transactions: TransactionRow[] }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
      <h2 className="text-h3 mb-md">Transactions ({transactions.length})</h2>
      {transactions.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">
          No transactions linked to this party yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-on-surface-variant">
              <tr className="text-left">
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Category</Th>
                <Th>Sub-Item</Th>
                <Th>Description</Th>
                <Th>Mode</Th>
                <Th className="text-right">Amount</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const inflow = t.type === "Revenue";
                return (
                  <tr
                    key={t.id}
                    className="border-t border-outline-variant/60 hover:bg-surface-container-low"
                  >
                    <td className="px-md py-sm">{t.date}</td>
                    <td className="px-md py-sm">
                      <span
                        className={
                          "px-xs py-[2px] rounded-full text-[11px] font-semibold " +
                          (inflow ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")
                        }
                      >
                        {inflow ? "Inflow" : "Outflow"}
                      </span>
                    </td>
                    <td className="px-md py-sm">{t.category}</td>
                    <td className="px-md py-sm">{t.subItem}</td>
                    <td className="px-md py-sm max-w-[260px] truncate">
                      {t.description ?? "—"}
                    </td>
                    <td className="px-md py-sm">{t.paymentMode}</td>
                    <td
                      className={
                        "px-md py-sm text-right font-mono " +
                        (inflow ? "text-green-700" : "text-red-700")
                      }
                    >
                      {(inflow ? "+" : "−") + inrFull(t.amount).slice(1)}
                    </td>
                    <td className="px-md py-sm text-right">
                      <Link
                        href={`/finance/daily-tracker/${t.id}/edit`}
                        title="Edit transaction"
                        className="text-on-surface-variant hover:text-accent inline-flex p-xs"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                          edit
                        </span>
                      </Link>
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

function Field({
  label,
  value,
  readOnly,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <span className="block text-label-sm text-on-surface-variant uppercase tracking-wider">
        {label}
      </span>
      <span className={"block " + (readOnly ? "text-on-surface" : "")}>{value}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={"px-md py-sm text-label-sm uppercase tracking-wider " + className}>
      {children}
    </th>
  );
}

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
