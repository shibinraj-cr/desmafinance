"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import { CASH_KIND_LABEL, type CashFloatsData, type CashKind } from "@/lib/cash-floats";
import { Notice, api, day, inputCls, money, primaryBtn, secondaryBtn, td, th } from "../bank-statements/_ui";

type Data = CashFloatsData;
type Msg = { tone: "ok" | "error"; text: string } | null;

const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

const TABS = [
  { key: "tag", label: "To tag" },
  { key: "petty", label: "Petty Cash" },
  { key: "outdoor", label: "Outdoor Marketing" },
] as const;

export function CashFloatsClient({ tab, all, data, canAct }: { tab: "tag" | "petty" | "outdoor"; all: boolean; data: Data; canAct: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "ok", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-md">
      <nav className="flex gap-md border-b border-outline-variant overflow-x-auto" aria-label="Cash floats">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            className={`py-sm px-xs text-body-md font-semibold whitespace-nowrap border-b-2 ${tab === t.key ? "border-primary text-on-surface" : "border-transparent text-on-surface-variant"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {tab === "tag" && <ToTag data={data} all={all} canAct={canAct} busy={busy} run={run} />}
      {tab === "petty" && <Petty data={data} canAct={canAct} busy={busy} run={run} />}
      {tab === "outdoor" && <Outdoor data={data} canAct={canAct} busy={busy} run={run} />}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

function ToTag({ data, all, canAct, busy, run }: { data: Data; all: boolean; canAct: boolean; busy: boolean; run: Run }) {
  const tag = (id: string, kind: CashKind) =>
    run(() => api("/api/finance/cash-floats/withdrawals", "POST", { bankTransactionId: id, kind }), `Tagged as ${CASH_KIND_LABEL[kind]}. It isn't an expense; it's now in the ${CASH_KIND_LABEL[kind]} float.`);
  return (
    <>
      <Section
        title={all ? "Every unexplained debit" : "Cash withdrawals to tag"}
        action={
          <Link className={secondaryBtn} href={all ? "?tab=tag" : "?tab=tag&all=1"}>
            {all ? "Only ATM / cash" : "Show every unexplained debit"}
          </Link>
        }
      >
        <p className="text-caption text-on-surface-variant mb-sm">
          Cash taken out of the bank is money moving into a float, not an expense and not an outflow. Outdoor Marketing cash is held by the director
          and accounted for with vouchers; Petty Cash is spent through entries paid in Cash.
        </p>
        {data.toTag.length === 0 ? (
          <p className="py-md text-on-surface-variant">Nothing to tag.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Account</th>
                  <th className={th}>Narration</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>Tag as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {data.toTag.map((l) => (
                  <tr key={l.id}>
                    <td className={`${td} whitespace-nowrap`}>{day(l.date)}</td>
                    <td className={`${td} whitespace-nowrap text-caption`}>{l.account}</td>
                    <td className={`${td} min-w-[220px] break-words`}>{l.description}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(l.amount)}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      {canAct ? (
                        <span className="inline-flex gap-xs">
                          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => tag(l.id, "OUTDOOR_MARKETING")}>
                            Outdoor Marketing
                          </button>
                          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => tag(l.id, "PETTY_CASH")}>
                            Petty Cash
                          </button>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="Tagged withdrawals">
        {data.withdrawals.length === 0 ? (
          <p className="py-md text-on-surface-variant">None yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Float</th>
                  <th className={th}>From</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`} />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {data.withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td className={`${td} whitespace-nowrap`}>{day(w.date)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {CASH_KIND_LABEL[w.kind]}
                      {w.heldBy && <span className="text-caption text-on-surface-variant"> · held by {w.heldBy}</span>}
                    </td>
                    <td className={`${td} text-caption break-words min-w-[200px]`}>{w.line ?? "—"}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(w.amount)}</td>
                    <td className={`${td} text-right`}>
                      {canAct && (
                        <button
                          type="button"
                          className="text-primary font-semibold hover:underline"
                          disabled={busy}
                          onClick={() => run(() => api(`/api/finance/cash-floats/withdrawals/${w.id}`, "DELETE"), "Tag removed. The bank line is unexplained again.")}
                        >
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function Months({ rows, inLabel, outLabel }: { rows: Data["petty"]["months"]; inLabel: string; outLabel: string }) {
  if (!rows.length) return <p className="py-md text-on-surface-variant">Nothing yet.</p>;
  return (
    <div className="overflow-x-auto -mx-lg">
      <table className="w-full text-body-md">
        <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
          <tr>
            <th className={th}>Month</th>
            <th className={`${th} text-right`}>Opening</th>
            <th className={`${th} text-right`}>{inLabel}</th>
            <th className={`${th} text-right`}>{outLabel}</th>
            <th className={`${th} text-right`}>Closing</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {[...rows].reverse().map((m) => (
            <tr key={m.month}>
              <td className={`${td} whitespace-nowrap`}>{monthName(m.month)}</td>
              <td className={`${td} text-right whitespace-nowrap`}>{money(m.opening)}</td>
              <td className={`${td} text-right whitespace-nowrap text-green-700`}>{m.in ? `+${money(m.in)}` : "—"}</td>
              <td className={`${td} text-right whitespace-nowrap text-error`}>{m.out ? `−${money(m.out)}` : "—"}</td>
              <td className={`${td} text-right whitespace-nowrap font-semibold ${m.closing < 0 ? "text-error" : ""}`}>{money(m.closing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StartForm({ kind, start, busy, run }: { kind: CashKind; start: { on: string; balance: number }; busy: boolean; run: Run }) {
  const [on, setOn] = useState(start.on.slice(0, 7));
  const [balance, setBalance] = useState(String(start.balance));
  return (
    <div className="flex flex-wrap items-end gap-sm">
      <label className="space-y-xs">
        <span className="text-label-sm font-semibold block">Statement starts</span>
        <input type="month" className={`${inputCls} w-44`} value={on} onChange={(e) => setOn(e.target.value)} />
      </label>
      <label className="space-y-xs">
        <span className="text-label-sm font-semibold block">Cash in hand that day (₹)</span>
        <input type="number" min="0" step="0.01" className={`${inputCls} w-44`} value={balance} onChange={(e) => setBalance(e.target.value)} />
      </label>
      <button
        type="button"
        className={secondaryBtn}
        disabled={busy || !on}
        onClick={() => run(() => api("/api/finance/cash-floats/settings", "POST", { kind, on: `${on}-01`, balance: Number(balance) || 0 }), "Starting balance saved.")}
      >
        Save
      </button>
    </div>
  );
}

function Petty({ data, canAct, busy, run }: { data: Data; canAct: boolean; busy: boolean; run: Run }) {
  return (
    <>
      <Section title="Petty cash, month by month">
        <p className="text-caption text-on-surface-variant mb-sm">
          In: withdrawals tagged Petty Cash. Out: every expense entry paid in Cash. A negative balance means cash expenses were entered that no
          withdrawal paid for, or the starting balance is missing.
        </p>
        <Months rows={data.petty.months} inLabel="Withdrawn" outLabel="Spent (paid in Cash)" />
        {canAct && (
          <div className="mt-md">
            <StartForm kind="PETTY_CASH" start={data.petty.start} busy={busy} run={run} />
          </div>
        )}
      </Section>
      <Section title="Spent in cash (latest 200)">
        {data.petty.spend.length === 0 ? (
          <p className="py-md text-on-surface-variant">No expenses paid in Cash.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <tbody className="divide-y divide-outline-variant">
                {data.petty.spend.map((t) => (
                  <tr key={t.id}>
                    <td className={`${td} whitespace-nowrap`}>{day(t.date)}</td>
                    <td className={td}>
                      {t.what}
                      {t.description && <div className="text-caption text-on-surface-variant">{t.description}</div>}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function Outdoor({ data, canAct, busy, run }: { data: Data; canAct: boolean; busy: boolean; run: Run }) {
  const file = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const upload = async (f: File) => {
    setProblems([]);
    const fd = new FormData();
    fd.set("file", f);
    await run(async () => {
      const res = await fetch("/api/finance/cash-floats/vouchers", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { inserted?: number; duplicates?: number; problems?: string[]; message?: string };
      if (body.problems?.length) {
        setProblems(body.problems);
        throw new Error("Nothing was imported: fix these rows and upload again.");
      }
      if (!res.ok) throw new Error(body.message ?? "Upload failed");
      return body;
    }, "Vouchers imported. Any already uploaded were skipped.");
    if (file.current) file.current.value = "";
  };
  return (
    <>
      <Section
        title="Outdoor Marketing, month by month"
        action={
          canAct ? (
            <div className="flex flex-wrap gap-sm">
              <a className={secondaryBtn} href="/api/finance/cash-floats/voucher-template">
                <span className="material-symbols-outlined text-[18px]">download</span>Template
              </a>
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => file.current?.click()}>
                <span className="material-symbols-outlined text-[18px]">upload_file</span>Upload vouchers (Excel)
              </button>
              <input ref={file} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </div>
          ) : undefined
        }
      >
        <p className="text-caption text-on-surface-variant mb-sm">
          A register of the director&apos;s cash: withdrawals tagged Outdoor Marketing in, vouchers out. It never reaches the ledger or P&amp;L.
        </p>
        {problems.length > 0 && (
          <Notice tone="error">
            <ul className="list-disc pl-md">
              {problems.slice(0, 12).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        )}
        <Months rows={data.om.months} inLabel="Withdrawn" outLabel="Vouchers" />
        {canAct && (
          <div className="mt-md">
            <StartForm kind="OUTDOOR_MARKETING" start={data.om.start} busy={busy} run={run} />
          </div>
        )}
      </Section>
      <Section title={`Vouchers (${data.om.vouchers.length})`}>
        {data.om.vouchers.length === 0 ? (
          <p className="py-md text-on-surface-variant">No vouchers uploaded.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Voucher</th>
                  <th className={th}>Paid to</th>
                  <th className={th}>Purpose</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {data.om.vouchers.map((v) => (
                  <tr key={v.id}>
                    <td className={`${td} whitespace-nowrap`}>{day(v.date)}</td>
                    <td className={`${td} whitespace-nowrap`}>{v.voucherNo ?? "—"}</td>
                    <td className={td}>{v.paidTo}</td>
                    <td className={`${td} text-caption`}>{v.purpose ?? ""}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(v.amount)}</td>
                    <td className={`${td} text-right`}>
                      {canAct && (
                        <button
                          type="button"
                          className="text-primary font-semibold hover:underline"
                          disabled={busy}
                          onClick={() => run(() => api(`/api/finance/cash-floats/vouchers/${v.id}`, "DELETE"), "Voucher removed.")}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
