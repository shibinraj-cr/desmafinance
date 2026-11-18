"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Section } from "@/components/Cards";
import type { TxnRow } from "@/lib/bank/queries";
import type { LineSuggestions, MonthStatus } from "@/lib/bank/reconcile-run";
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
                      {r.auto && <span className="ml-xs text-caption text-on-surface-variant" title={r.reconNote ?? undefined}>auto</span>}
                      {r.matches > 0 && <div className="text-caption text-on-surface-variant mt-[2px]">{r.matches} ledger link{r.matches === 1 ? "" : "s"}</div>}
                      {r.recon === "TRANSFER" && r.reconNote && <div className="text-caption text-on-surface-variant mt-[2px] max-w-[220px]">{r.reconNote}</div>}
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

/**
 * Above the reconciliation list: "Match now", the one-click test-credit
 * clean-up, and each account's months — explained lines against all lines,
 * and the bank's closing balance. A month is done when every line is
 * explained (matched in full, set aside, or a transfer).
 */
export function ReconcileToolbar({ months, testCredits, canReconcile }: { months: MonthStatus[]; testCredits: number; canReconcile: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const run = async (url: string, done: (r: Record<string, number>) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<Record<string, number>>(url, "POST", {});
      setMsg({ tone: "ok", text: done(r) });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Could not run" });
    } finally {
      setBusy(false);
    }
  };
  const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Section
      title="Months"
      action={
        canReconcile ? (
          <div className="flex flex-wrap gap-sm">
            {testCredits > 0 && (
              <button
                type="button"
                className={secondaryBtn}
                disabled={busy}
                onClick={() => run("/api/finance/bank-transactions/ignore-test-credits", (r) => `${r.ignored} test credit${r.ignored === 1 ? "" : "s"} set aside.`)}
              >
                Ignore {testCredits} test credit{testCredits === 1 ? "" : "s"} (₹10 or less)
              </button>
            )}
            <button
              type="button"
              className={primaryBtn}
              disabled={busy}
              onClick={() =>
                run(
                  "/api/finance/bank-transactions/auto-match",
                  (r) => `${r.matched} matched by reference and amount, ${r.transfers} transfer${r.transfers === 1 ? "" : "s"} paired, of ${r.examined} unmatched line${r.examined === 1 ? "" : "s"}.`,
                )
              }
            >
              <span className="material-symbols-outlined text-[18px]">join_inner</span>Match now
            </button>
          </div>
        ) : undefined
      }
    >
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {months.length === 0 ? (
        <p className="py-md text-on-surface-variant">No bank lines in the last six months.</p>
      ) : (
        <div className="overflow-x-auto -mx-lg">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
              <tr>
                <th className={th}>Month</th>
                <th className={th}>Account</th>
                <th className={`${th} text-right`}>Explained</th>
                <th className={`${th} text-right`}>Bank closing balance</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {months.map((m) => (
                <tr key={`${m.integrationId}|${m.month}`}>
                  <td className={`${td} whitespace-nowrap`}>{monthName(m.month)}</td>
                  <td className={`${td} whitespace-nowrap`}>{m.account}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    {m.explained} / {m.lines}
                  </td>
                  <td className={`${td} text-right whitespace-nowrap`}>{money(m.closingBalance)}</td>
                  <td className={td}>
                    {m.done ? (
                      <span className="inline-flex items-center gap-xs text-green-700 font-semibold">
                        <span className="material-symbols-outlined text-[18px]">check_circle</span>Reconciled
                      </span>
                    ) : (
                      <span className="text-on-surface-variant">
                        {m.open} line{m.open === 1 ? "" : "s"} to explain
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
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

  const [sugg, setSugg] = useState<LineSuggestions | null>(null);
  useEffect(() => {
    api<LineSuggestions>(`/api/finance/bank-transactions/${txn.id}/suggestions`, "GET")
      .then(setSugg)
      .catch(() => setSugg(null));
  }, [txn.id]);
  const act = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(url, method, body);
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const matched = Array.from(picked.values()).reduce((s, m) => s + m.amount, 0);
  // A suggestion's Match keeps the line's other links and adds what is left,
  // capped at what the entry still has open (this line's own share included).
  const others = (exceptId: string) =>
    Array.from(picked.entries())
      .filter(([id]) => id !== exceptId)
      .map(([transactionId, m]) => ({ transactionId, amount: m.amount }));
  const addTo = (c: { id: string; open: number }) => {
    const rest = amount - others(c.id).reduce((s, m) => s + m.amount, 0);
    return Math.round(Math.min(c.open, rest) * 100) / 100;
  };
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
      {txn.recon === "TRANSFER" ? (
        <div className="space-y-sm">
          <Notice tone="info">{txn.reconNote ?? "This line is a transfer between DesGro's own accounts."} It needs no ledger entry.</Notice>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-sm">
            <button type="button" className={secondaryBtn} onClick={onClose}>
              Close
            </button>
            <button type="button" className={secondaryBtn} disabled={busy} onClick={() => act(`/api/finance/bank-transactions/${txn.id}/transfer`, "DELETE")}>
              Unpair
            </button>
          </div>
        </div>
      ) : txn.recon === "CASH" || txn.recon === "CLAIM_SETTLEMENT" ? (
        <div className="space-y-sm">
          <Notice tone="info">
            {txn.recon === "CASH" ? "This line is a cash withdrawal into a cash float." : "This line repays the director's card claims."} It needs no ledger entry, and
            is changed or undone on{" "}
            <Link className="underline" href={txn.recon === "CASH" ? "/finance/cash-floats" : "/finance/director-card"}>
              {txn.recon === "CASH" ? "Cash Floats" : "Director's Card"}
            </Link>
            .
          </Notice>
          <div className="flex justify-end">
            <button type="button" className={secondaryBtn} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
      <>
      {sugg && (sugg.ledger.length > 0 || sugg.transfers.length > 0 || sugg.testCredit) && (
        <div className="space-y-xs">
          <p className="text-label-sm font-semibold">Suggested</p>
          {sugg.testCredit && <Notice tone="info">A ₹{amount} credit is usually a payer testing the account first. Set it aside with Ignore.</Notice>}
          {sugg.transfers.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-sm rounded-lg border border-outline-variant p-sm">
              <span className="flex-1 min-w-0">
                <span className="font-semibold">Transfer {txn.direction === "DEBIT" ? "to" : "from"} {t.account}</span>
                <span className="block text-caption text-on-surface-variant truncate">
                  {day(t.date)} · {money(t.amount)} · {t.reasons.join(" · ")}
                </span>
              </span>
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => act(`/api/finance/bank-transactions/${txn.id}/transfer`, "POST", { pairWith: t.id })}>
                Pair as transfer
              </button>
            </div>
          ))}
          {sugg.ledger.slice(0, 4).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-sm rounded-lg border border-outline-variant p-sm">
              <span className="flex-1 min-w-0">
                <span className="flex justify-between gap-sm">
                  <span className="font-semibold truncate">{c.counterparty ?? c.category}</span>
                  <span className="whitespace-nowrap">
                    {money(c.amount)}
                    {c.open < c.amount && <span className="text-caption text-on-surface-variant"> · {money(c.open)} open</span>}
                  </span>
                </span>
                <span className="block text-caption text-on-surface-variant">
                  {day(c.date)} · {c.category} · {c.paymentMode}
                </span>
                <span className="flex items-start gap-xs text-caption text-on-surface-variant">
                  <span className="material-symbols-outlined text-[14px] mt-[1px]">info</span>
                  {c.reasons.join(" · ")}
                </span>
              </span>
              <button
                type="button"
                className={secondaryBtn}
                disabled={busy || addTo(c) <= 0}
                onClick={() => submit({ matches: [...others(c.id), { transactionId: c.id, amount: addTo(c) }] })}
              >
                Match
              </button>
            </div>
          ))}
        </div>
      )}
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
      {sugg && (txn.recon === "UNMATCHED" || txn.recon === "MANUAL_REVIEW") && txn.matches === 0 && (
        <CreateEntry txnId={txn.id} direction={txn.direction} booking={sugg.booking} busy={busy} onSubmit={(body) => act(`/api/finance/bank-transactions/${txn.id}/create-entry`, "POST", body)} />
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
      </>
      )}
    </Modal>
  );
}

type CategoryRow = { id: string; name: string; type: string; subItems: Array<{ id: string; name: string }> };
type PartyRow = { id: string; name: string; group: string };
const partyLabel = (p: PartyRow) => `${p.name} (${p.group})`;

/**
 * "Create entry from this line": for a bank line with no ledger entry yet —
 * EPFO, ESIC, TDS, salaries, bank charges, a loan EMI. Date, amount and bank
 * come from the line; prefilled with how the same kind of line was booked
 * before.
 */
function CreateEntry({
  txnId,
  direction,
  booking,
  busy,
  onSubmit,
}: {
  txnId: string;
  direction: string;
  booking: LineSuggestions["booking"];
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const type = direction === "CREDIT" ? "Revenue" : "Expense";
  const [open, setOpen] = useState(!!booking);
  const [cats, setCats] = useState<CategoryRow[] | null>(null);
  const [category, setCategory] = useState(booking?.category ?? "");
  const [subItem, setSubItem] = useState(booking?.subItem ?? "");
  const [description, setDescription] = useState("");
  const [expDom, setExpDom] = useState<"" | "EXP" | "DOM">("");
  const [parties, setParties] = useState<PartyRow[] | null>(null);
  const [payee, setPayee] = useState("");
  useEffect(() => {
    if (!open || cats) return;
    api<{ categories: CategoryRow[] }>("/api/master/categories", "GET")
      .then((r) => setCats(r.categories.filter((c) => c.type === type || c.type === "Both")))
      .catch(() => setCats([]));
    api<{ parties: PartyRow[] }>(`/api/master/parties?txType=${type}`, "GET")
      .then((r) => {
        setParties(r.parties);
        const last = booking?.partyId && r.parties.find((p) => p.id === booking.partyId);
        if (last) setPayee(partyLabel(last));
      })
      .catch(() => setParties([]));
  }, [open, cats, type, booking]);
  const subs = cats?.find((c) => c.name === category)?.subItems ?? [];
  const party = parties?.find((p) => partyLabel(p) === payee) ?? null;
  // An employee counterparty (a salary) only carries over unchanged.
  const sameEmployee = !!booking?.employeeId && booking.category === category && booking.subItem === subItem && !payee;
  if (!open) {
    return (
      <button type="button" className="text-primary font-semibold hover:underline text-left" onClick={() => setOpen(true)}>
        No ledger entry for this? Create one from this line
      </button>
    );
  }
  return (
    <div className="space-y-sm rounded-lg border border-outline-variant p-sm" data-txn={txnId}>
      <p className="text-label-sm font-semibold">
        Create a {type.toLowerCase()} entry from this line
        {booking && <span className="font-normal text-on-surface-variant"> · booked like the last one of this kind</span>}
      </p>
      <div className="grid md:grid-cols-2 gap-sm">
        <select className={inputCls} aria-label="Category" value={category} onChange={(e) => (setCategory(e.target.value), setSubItem(""))}>
          <option value="">Category…</option>
          {(cats ?? []).map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select className={inputCls} aria-label="Sub-item" value={subItem} onChange={(e) => setSubItem(e.target.value)} disabled={!category}>
          <option value="">Sub-item…</option>
          {subs.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <input
        className={inputCls}
        list={`payees-${txnId}`}
        aria-label={type === "Revenue" ? "Received from" : "Paid to"}
        placeholder={sameEmployee ? "Same employee as last time" : type === "Revenue" ? "Received from…" : "Paid to…"}
        value={payee}
        onChange={(e) => setPayee(e.target.value)}
      />
      <datalist id={`payees-${txnId}`}>
        {(parties ?? []).map((p) => (
          <option key={p.id} value={partyLabel(p)} />
        ))}
      </datalist>
      <input className={inputCls} placeholder="Description (the line's reference is added)" maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} />
      {type === "Revenue" && (
        <select className={inputCls} aria-label="EXP or DOM" value={expDom} onChange={(e) => setExpDom(e.target.value as "" | "EXP" | "DOM")}>
          <option value="">EXP or DOM…</option>
          <option value="DOM">DOM</option>
          <option value="EXP">EXP</option>
        </select>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !category || !subItem || (type === "Revenue" && !expDom) || (!party && !sameEmployee)}
          onClick={() =>
            onSubmit({
              category,
              subItem,
              description: description || null,
              expDom: type === "Revenue" ? expDom : null,
              partyId: party?.id ?? null,
              employeeId: party ? null : sameEmployee ? booking!.employeeId : null,
            })
          }
        >
          Create entry and match
        </button>
      </div>
    </div>
  );
}
