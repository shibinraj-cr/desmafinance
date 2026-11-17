"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inrFull } from "@/lib/format";
import { PAYMENT_MODES } from "@/lib/catalog";
import {
  HISTORICAL_FROM_ISO,
  HISTORICAL_LABEL,
  HISTORICAL_TO_ISO,
  isBeforeHistoricalFloor,
  isHistoricalDate,
} from "@/lib/finance-historical";
import { txErrorMessage } from "@/lib/finance-tx-errors";

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
  /** Paid before DesGro (1 Apr 2026): counted here, left out of reports. */
  isHistorical: boolean;
};

type Totals = {
  totalQuoted: number;
  totalPaid: number;
  /** The part of totalPaid paid before DesGro's books began. */
  paidBeforeDesgro: number;
  totalRefunded: number;
  balanceRemaining: number;
};

/** A Sales / Collection ledger line and the service it books to. */
type PaymentOption = { category: string; subItem: string; serviceId: string | null };

/** An entry for this candidate not yet in the ledger. */
type AwaitingRow = {
  id: string;
  date: string;
  subItem: string;
  amount: number;
  status: "pending" | "draft";
  by: string | null;
};

/** Present only for users who may record payments, on a Candidate. */
type PastPayments = { options: PaymentOption[]; awaiting: AwaitingRow[] };

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
  pastPayments = null,
}: {
  party: Party;
  totals: Totals;
  services: ServiceOption[];
  sources: SourceOption[];
  l2Bdes: L2Bde[];
  transactions: TransactionRow[];
  pastPayments?: PastPayments | null;
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
          {totals.paidBeforeDesgro > 0 && (
            <p className="-mt-sm text-caption text-on-surface-variant text-right">
              incl. {inrFull(totals.paidBeforeDesgro)} paid before DesGro
            </p>
          )}
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

      <TransactionsPanel transactions={transactions} party={party} pastPayments={pastPayments} />
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

function TransactionsPanel({
  transactions,
  party,
  pastPayments,
}: {
  transactions: TransactionRow[];
  party: Party;
  pastPayments: PastPayments | null;
}) {
  const [recording, setRecording] = useState(false);
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
      <div className="flex items-center justify-between gap-md mb-md">
        <h2 className="text-h3">Transactions ({transactions.length})</h2>
        {pastPayments && !recording && (
          <button
            type="button"
            onClick={() => setRecording(true)}
            className="h-8 px-md rounded-lg border border-outline-variant text-label-sm hover:bg-surface-container-low"
            title="Record a payment this candidate made before DesGro (before 1 Apr 2026)"
          >
            + Record past payment
          </button>
        )}
      </div>
      {pastPayments && recording && (
        <RecordPastPayment
          party={party}
          options={pastPayments.options}
          existing={[...transactions, ...pastPayments.awaiting]}
          onClose={() => setRecording(false)}
        />
      )}
      {pastPayments && pastPayments.awaiting.length > 0 && (
        <AwaitingList rows={pastPayments.awaiting} />
      )}
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
                    <td className="px-md py-sm whitespace-nowrap">
                      {t.date}
                      {t.isHistorical && <HistoricalBadge />}
                    </td>
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

function HistoricalBadge() {
  return (
    <span
      title="Paid before 1 Apr 2026. Counts towards this candidate's balance, not in any report."
      className="block mt-[2px] w-fit px-sm py-[1px] rounded-full border border-amber-300 bg-amber-50 text-amber-800 text-[10px] font-bold uppercase tracking-wider"
    >
      {HISTORICAL_LABEL}
    </span>
  );
}

/** Entries for this candidate a manager hasn't approved yet (and the
 *  viewer's own unsubmitted drafts), so a payment isn't entered twice. */
function AwaitingList({ rows }: { rows: AwaitingRow[] }) {
  return (
    <div className="mb-md rounded-lg border border-amber-200 bg-amber-50/50 p-md">
      <h3 className="text-label-md font-semibold mb-sm">Not in the ledger yet ({rows.length})</h3>
      <ul className="space-y-xs text-body-md">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-md gap-y-xs">
            <span className="font-mono whitespace-nowrap">{r.date}</span>
            <span className="flex-1 min-w-[160px]">{r.subItem}</span>
            <span className="font-mono text-green-700">{inrFull(r.amount)}</span>
            {r.status === "pending" ? (
              <Link href="/finance/approvals/pending" className="text-label-sm text-amber-800 underline">
                Waiting for approval{r.by ? ` · entered by ${r.by}` : ""}
              </Link>
            ) : (
              <Link href="/finance/approvals/my-drafts" className="text-label-sm text-amber-800 underline">
                In your drafts, not yet submitted
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Record a payment a candidate made before DesGro's books began (1 Apr
 * 2023 – 31 Mar 2026). It goes through the normal transaction route, so a
 * Finance Executive's entry waits for a Finance Manager's approval; once in,
 * it counts towards this candidate's paid amount and never in a report.
 */
function RecordPastPayment({
  party,
  options,
  existing,
  onClose,
}: {
  party: Party;
  options: PaymentOption[];
  existing: { date: string; amount: number }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const services = party.partyServices;
  const [date, setDate] = useState("");
  const [serviceId, setServiceId] = useState(services[0]?.serviceId ?? "");
  const [kind, setKind] = useState<"Collection" | "Sales">("Collection");
  const [lineKey, setLineKey] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<string>(PAYMENT_MODES[0]);
  const [expDom, setExpDom] = useState<"DOM" | "EXP">("DOM");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ofKind = options.filter((o) => o.category.startsWith(`${kind} - `));
  const forService = ofKind.filter((o) => serviceId && o.serviceId === serviceId);
  // The service's own line when it has one; otherwise let them pick.
  const choices = forService.length ? forService : ofKind;
  const keyOf = (o: PaymentOption) => `${o.category}||${o.subItem}`;
  const line = choices.find((o) => keyOf(o) === lineKey) ?? choices[0] ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!date || !isHistoricalDate(date) || isBeforeHistoricalFloor(date)) {
      setError("Enter the date paid, between 1 Apr 2023 and 31 Mar 2026.");
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!line) {
      setError("No Sales / Collection sub-item is set up. Ask an admin to add one in Master Data.");
      return;
    }
    const twin = existing.find((x) => x.date === date && Math.abs(x.amount - amt) < 0.005);
    if (
      twin &&
      !window.confirm(
        `A payment of ${inrFull(amt)} dated ${date} is already recorded or waiting for approval for this candidate. Record it again?`,
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/finance/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date,
        type: "Revenue",
        category: line.category,
        subItem: line.subItem,
        description: reference.trim() || null,
        paymentMode,
        amount: amt,
        partyId: party.id,
        employeeId: null,
        expDom,
      }),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      applied?: boolean;
      isDraft?: boolean;
    };
    if (!res.ok && res.status !== 202) {
      setError(txErrorMessage(data.error));
      return;
    }
    setDone(
      data.applied
        ? "Recorded. It now counts towards this candidate's paid amount."
        : data.isDraft
          ? "Saved to your drafts. Submit it from Approvals → My Drafts to send it for approval."
          : "Sent to the Finance Manager for approval. It counts once approved.",
    );
    setDate("");
    setAmount("");
    setReference("");
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="mb-md grid grid-cols-1 md:grid-cols-12 gap-sm items-end border-2 border-dashed border-primary/40 rounded-lg p-md bg-primary/5"
    >
      <p className="md:col-span-12 text-body-md text-on-surface-variant">
        A payment this candidate made <strong>before DesGro</strong> (1 Apr 2023 – 31 Mar 2026). It
        counts towards their paid amount and balance, and stays out of every report.
      </p>
      <label className="md:col-span-3 block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Date paid</span>
        <input
          type="date"
          required
          min={HISTORICAL_FROM_ISO}
          max={HISTORICAL_TO_ISO}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputCls}
        />
      </label>
      {services.length > 0 && (
        <label className="md:col-span-5 block">
          <span className="block text-label-sm text-on-surface-variant mb-xs">Service</span>
          <select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setLineKey("");
            }}
            className={inputCls}
          >
            {services.map((s) => (
              <option key={s.serviceId} value={s.serviceId}>
                {s.serviceName}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="md:col-span-4 block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Payment</span>
        <div className="flex rounded-lg border border-outline-variant overflow-hidden h-10">
          {(
            [
              ["Sales", "First payment"],
              ["Collection", "Instalment"],
            ] as const
          ).map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => {
                setKind(k);
                setLineKey("");
              }}
              className={
                "flex-1 px-sm text-label-sm font-semibold transition " +
                (kind === k
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="md:col-span-12 block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Books as</span>
        {forService.length === 1 ? (
          <span className="block text-body-md">
            {forService[0].category} › {forService[0].subItem}
          </span>
        ) : (
          <>
            <select
              value={line ? keyOf(line) : ""}
              onChange={(e) => setLineKey(e.target.value)}
              className={inputCls}
            >
              {choices.length === 0 && <option value="">(no {kind} sub-items set up)</option>}
              {choices.map((o) => (
                <option key={keyOf(o)} value={keyOf(o)}>
                  {o.category} › {o.subItem}
                </option>
              ))}
            </select>
            {forService.length === 0 && choices.length > 0 && (
              <span className="block text-caption text-on-surface-variant mt-xs">
                No {kind} sub-item is linked to this service, so pick the right one.
              </span>
            )}
          </>
        )}
      </div>
      <label className="md:col-span-3 block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Amount (₹)</span>
        <input
          type="number"
          min={0}
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputCls + " text-right font-mono"}
        />
      </label>
      <label className="md:col-span-3 block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Payment mode</span>
        <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={inputCls}>
          {PAYMENT_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <div className="md:col-span-2 block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">EXP / DOM</span>
        <div className="flex rounded-lg border border-outline-variant overflow-hidden h-10">
          {(["DOM", "EXP"] as const).map((opt) => (
            <button
              type="button"
              key={opt}
              onClick={() => setExpDom(opt)}
              className={
                "flex-1 text-label-sm font-semibold transition " +
                (expDom === opt
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
      <label className="md:col-span-4 block">
        <span className="block text-label-sm text-on-surface-variant mb-xs">Receipt no. / reference</span>
        <input
          value={reference}
          maxLength={500}
          onChange={(e) => setReference(e.target.value)}
          className={inputCls}
          placeholder="Optional"
        />
      </label>
      {error && (
        <div className="md:col-span-12 rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-md">
          {error}
        </div>
      )}
      {done && (
        <div className="md:col-span-12 rounded-lg bg-green-50 text-green-700 px-md py-sm text-body-md">
          {done}
        </div>
      )}
      <div className="md:col-span-12 flex justify-end gap-xs">
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-md rounded-lg text-label-sm text-on-surface-variant"
        >
          Close
        </button>
        <button
          type="submit"
          disabled={busy}
          className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
        >
          {busy ? "Saving…" : "Record payment"}
        </button>
      </div>
    </form>
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
