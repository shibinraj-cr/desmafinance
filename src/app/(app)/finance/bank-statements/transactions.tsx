"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Section } from "@/components/Cards";
import type { TxnRow } from "@/lib/bank/queries";
import { Modal, Notice, Pager, StatusChip, api, day, inputCls, money, primaryBtn, secondaryBtn, td, th } from "./_ui";

export function TransactionsView({
  tab,
  rows,
  total,
  page,
  totalDebit,
  totalCredit,
  types,
  reconStatuses,
  canReconcile,
}: {
  tab: "transactions" | "reconciliation";
  rows: TxnRow[];
  total: number;
  page: number;
  totalDebit: number;
  totalCredit: number;
  types: string[];
  reconStatuses: string[];
  canReconcile: boolean;
}) {
  const search = useSearchParams();
  const [reconciling, setReconciling] = useState<TxnRow | null>(null);
  const exportQs = (format: string) => {
    const p = new URLSearchParams(search.toString());
    p.delete("tab");
    p.delete("page");
    p.set("format", format);
    if (tab === "reconciliation" && !p.getAll("recon").length) {
      ["UNMATCHED", "MANUAL_REVIEW", "PARTIALLY_MATCHED"].forEach((r) => p.append("recon", r));
    }
    return `/api/finance/bank-transactions?${p.toString()}`;
  };

  return (
    <div className="space-y-md">
      <Filters types={types} reconStatuses={reconStatuses} />
      <Section
        title={tab === "reconciliation" ? "Awaiting reconciliation" : "Transactions"}
        action={
          <div className="flex flex-wrap items-center gap-sm">
            <span className="text-body-md text-on-surface-variant hidden md:inline">
              Debits <b className="text-error">{money(totalDebit)}</b> · Credits <b className="text-green-700">{money(totalCredit)}</b>
            </span>
            <a className={secondaryBtn} href={exportQs("xlsx")}>
              <span className="material-symbols-outlined text-[18px]">download</span>Excel
            </a>
            <a className={secondaryBtn} href={exportQs("csv")}>
              CSV
            </a>
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">
            {tab === "reconciliation" ? "Nothing waiting — every bank line is matched or set aside." : "No transactions match these filters."}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Date</th>
                  <th className={`${th} hidden lg:table-cell`}>Value date</th>
                  <th className={th}>Description</th>
                  <th className={`${th} hidden md:table-cell`}>Reference</th>
                  <th className={`${th} hidden md:table-cell`}>Type</th>
                  <th className={`${th} text-right`}>Debit</th>
                  <th className={`${th} text-right`}>Credit</th>
                  <th className={`${th} text-right hidden md:table-cell`}>Balance</th>
                  <th className={`${th} hidden xl:table-cell`}>Account</th>
                  <th className={`${th} hidden xl:table-cell`}>Statement</th>
                  <th className={th}>Reconciliation</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-container-low">
                    <td className={`${td} whitespace-nowrap`}>{day(r.txnDate)}</td>
                    <td className={`${td} whitespace-nowrap hidden lg:table-cell text-on-surface-variant`}>{day(r.valueDate)}</td>
                    <td className={`${td} min-w-[220px] max-w-[420px]`}>
                      <div className="break-words">{r.description}</div>
                      {r.counterparty && <div className="text-caption text-on-surface-variant">{r.counterparty}</div>}
                    </td>
                    <td className={`${td} hidden md:table-cell text-data-mono text-caption break-all`}>{r.reference ?? "—"}</td>
                    <td className={`${td} hidden md:table-cell text-caption`}>{r.type.replace(/_/g, " ")}</td>
                    <td className={`${td} text-right whitespace-nowrap text-error`}>{r.debit ? money(r.debit) : ""}</td>
                    <td className={`${td} text-right whitespace-nowrap text-green-700`}>{r.credit ? money(r.credit) : ""}</td>
                    <td className={`${td} text-right whitespace-nowrap hidden md:table-cell`}>{money(r.balance)}</td>
                    <td className={`${td} hidden xl:table-cell text-caption whitespace-nowrap`}>{r.account}</td>
                    <td className={`${td} hidden xl:table-cell text-caption whitespace-nowrap`}>
                      <Link className="underline decoration-dotted" href={`?tab=statements#${r.statementId}`}>
                        {day(r.statementDate)}
                      </Link>
                    </td>
                    <td className={td}>
                      <StatusChip status={r.recon} title={r.reconNote ?? undefined} />
                      {r.matches > 0 && <div className="text-caption text-on-surface-variant mt-[2px]">{r.matches} ledger link{r.matches === 1 ? "" : "s"}</div>}
                    </td>
                    <td className={`${td} text-right`}>
                      {canReconcile && (
                        <button type="button" className="text-primary font-semibold hover:underline" onClick={() => setReconciling(r)}>
                          Reconcile
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} total={total} />
      </Section>
      {reconciling && <ReconcileDialog txn={reconciling} onClose={() => setReconciling(null)} />}
    </div>
  );
}

function Filters({ types, reconStatuses }: { types: string[]; reconStatuses: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [f, setF] = useState(() => ({
    from: search.get("from") ?? "",
    to: search.get("to") ?? "",
    direction: search.get("direction") ?? "",
    type: search.get("type") ?? "",
    recon: search.get("recon") ?? "",
    min: search.get("min") ?? "",
    max: search.get("max") ?? "",
    q: search.get("q") ?? "",
  }));
  const apply = (next = f) => {
    const p = new URLSearchParams();
    for (const k of ["tab", "account"]) {
      const v = search.get(k);
      if (v) p.set(k, v);
    }
    Object.entries(next).forEach(([k, v]) => v && p.set(k, v));
    router.push(`${pathname}?${p.toString()}`);
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const small = inputCls.replace("h-10", "h-9");
  return (
    <form
      className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-9 gap-sm items-end bg-surface-container-lowest border border-outline-variant rounded-xl p-md"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label className="space-y-xs">
        <span className="text-caption font-semibold text-on-surface-variant">From</span>
        <input type="date" className={small} value={f.from} onChange={set("from")} />
      </label>
      <label className="space-y-xs">
        <span className="text-caption font-semibold text-on-surface-variant">To</span>
        <input type="date" className={small} value={f.to} onChange={set("to")} />
      </label>
      <label className="space-y-xs">
        <span className="text-caption font-semibold text-on-surface-variant">Debit / Credit</span>
        <select className={small} value={f.direction} onChange={set("direction")}>
          <option value="">Both</option>
          <option value="DEBIT">Debits</option>
          <option value="CREDIT">Credits</option>
        </select>
      </label>
      <label className="space-y-xs">
        <span className="text-caption font-semibold text-on-surface-variant">Type</span>
        <select className={small} value={f.type} onChange={set("type")}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-xs">
        <span className="text-caption font-semibold text-on-surface-variant">Reconciliation</span>
        <select className={small} value={f.recon} onChange={set("recon")}>
          <option value="">Any status</option>
          {reconStatuses.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-xs">
        <span className="text-caption font-semibold text-on-surface-variant">Min ₹</span>
        <input type="number" min="0" step="0.01" className={small} value={f.min} onChange={set("min")} />
      </label>
      <label className="space-y-xs">
        <span className="text-caption font-semibold text-on-surface-variant">Max ₹</span>
        <input type="number" min="0" step="0.01" className={small} value={f.max} onChange={set("max")} />
      </label>
      <label className="space-y-xs col-span-2 md:col-span-1">
        <span className="text-caption font-semibold text-on-surface-variant">Search</span>
        <input className={small} placeholder="Narration, reference, payee" value={f.q} onChange={set("q")} />
      </label>
      <div className="flex gap-sm col-span-2 md:col-span-1">
        <button className={primaryBtn}>Apply</button>
        <button
          type="button"
          className={secondaryBtn}
          onClick={() => {
            const empty = { from: "", to: "", direction: "", type: "", recon: "", min: "", max: "", q: "" };
            setF(empty);
            apply(empty);
          }}
        >
          Clear
        </button>
      </div>
    </form>
  );
}

type Candidate = {
  id: string;
  date: string;
  category: string;
  description: string | null;
  paymentMode: string;
  amount: number;
  counterparty: string | null;
  alreadyMatched: boolean;
  exact: boolean;
};
type Match = { transactionId: string; amount: number; date: string; description: string | null; category: string };

function ReconcileDialog({ txn, onClose }: { txn: TxnRow; onClose: () => void }) {
  const router = useRouter();
  const amount = txn.debit || txn.credit;
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Map<string, { amount: number; label: string }>>(new Map());
  const [q, setQ] = useState("");
  const [note, setNote] = useState(txn.reconNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (query = "") => {
    setCandidates(null);
    try {
      const r = await api<{ candidates: Candidate[]; matches: Match[] }>(
        `/api/finance/bank-transactions/${txn.id}/candidates${query ? `?q=${encodeURIComponent(query)}` : ""}`,
        "GET",
      );
      setCandidates(r.candidates);
      if (!query) {
        setPicked(new Map(r.matches.map((m) => [m.transactionId, { amount: m.amount, label: `${day(m.date)} · ${m.category}` }])));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load ledger entries");
      setCandidates([]);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matched = Array.from(picked.values()).reduce((s, m) => s + m.amount, 0);
  const submit = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/finance/bank-transactions/${txn.id}/reconcile`, "POST", { ...body, note: note || undefined });
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Reconcile bank transaction"
      subtitle={`${day(txn.txnDate)} · ${txn.direction === "DEBIT" ? "Debit" : "Credit"} ${money(amount)} · ${txn.description.slice(0, 90)}`}
      onClose={onClose}
    >
      <form
        className="flex gap-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void load(q);
        }}
      >
        <input className={inputCls} placeholder={`Search ${txn.direction === "DEBIT" ? "expenses" : "revenue"} (±60 days)`} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={secondaryBtn}>Search</button>
      </form>
      <div className="max-h-72 overflow-y-auto border border-outline-variant rounded-lg divide-y divide-outline-variant">
        {candidates === null ? (
          <p className="p-md text-on-surface-variant">Loading ledger entries…</p>
        ) : candidates.length === 0 ? (
          <p className="p-md text-on-surface-variant">No {txn.direction === "DEBIT" ? "expense" : "revenue"} entries within a week of this date. Try a search.</p>
        ) : (
          candidates.map((c) => {
            const on = picked.has(c.id);
            return (
              <label key={c.id} className="flex items-start gap-sm p-sm hover:bg-surface-container-low cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={on}
                  onChange={() => {
                    const next = new Map(picked);
                    if (on) next.delete(c.id);
                    else next.set(c.id, { amount: Math.min(c.amount, Math.max(0, amount - matched)) || c.amount, label: `${day(c.date)} · ${c.category}` });
                    setPicked(next);
                  }}
                />
                <span className="flex-1 min-w-0">
                  <span className="flex justify-between gap-sm">
                    <span className="font-semibold truncate">{c.counterparty ?? c.category}</span>
                    <span className="whitespace-nowrap">{money(c.amount)}</span>
                  </span>
                  <span className="block text-caption text-on-surface-variant truncate">
                    {day(c.date)} · {c.category} · {c.paymentMode}
                    {c.exact && " · exact amount"}
                    {c.alreadyMatched && " · already linked to a bank line"}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </div>
      {picked.size > 0 && (
        <div className="space-y-xs">
          {Array.from(picked.entries()).map(([id, m]) => (
            <div key={id} className="flex items-center gap-sm text-body-md">
              <span className="flex-1 truncate">{m.label}</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                aria-label="Matched amount"
                className={`${inputCls} h-8 w-36 text-right`}
                value={m.amount}
                onChange={(e) => setPicked(new Map(picked).set(id, { ...m, amount: Number(e.target.value) || 0 }))}
              />
            </div>
          ))}
          <p className="text-caption text-on-surface-variant">
            Matched {money(matched)} of {money(amount)} — {Math.round(matched * 100) >= Math.round(amount * 100) ? "fully matched" : "partial match"}
          </p>
        </div>
      )}
      <input className={inputCls} placeholder="Note (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap justify-between gap-sm">
        <div className="flex gap-sm">
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => submit({ status: "IGNORED" })}>
            Ignore
          </button>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => submit({ status: "MANUAL_REVIEW" })}>
            Needs review
          </button>
        </div>
        <div className="flex gap-sm">
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryBtn}
            disabled={busy}
            onClick={() => submit({ matches: Array.from(picked.entries()).map(([transactionId, m]) => ({ transactionId, amount: m.amount })) })}
          >
            {picked.size ? "Save match" : "Mark unmatched"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
