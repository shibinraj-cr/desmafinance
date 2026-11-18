"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import type { DirectorCardData } from "@/lib/cash-floats";
import { Notice, api, day, inputCls, money, secondaryBtn, td, th } from "../bank-statements/_ui";

type Data = DirectorCardData;

const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function DirectorCardClient({ all, data, canAct }: { all: boolean; data: Data; canAct: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [startOn, setStartOn] = useState(data.settings.startOn);
  const [words, setWords] = useState(data.settings.payeeWords);
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
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Section
        title={all ? "Every unexplained debit" : "Payments to the director"}
        action={
          <Link className={secondaryBtn} href={all ? "?" : "?all=1"}>
            {all ? "Only those naming the director" : "Show every unexplained debit"}
          </Link>
        }
      >
        <p className="text-caption text-on-surface-variant mb-sm">
          A bank payment to the director repays the card claims, oldest first. It is never booked as a second expense.
          {!data.settings.payeeWords && " Set the words that name the director in bank narrations below to see them suggested here."}
        </p>
        {data.candidates.length === 0 ? (
          <p className="py-md text-on-surface-variant">Nothing to mark.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Account</th>
                  <th className={th}>Narration</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {data.candidates.map((l) => (
                  <tr key={l.id}>
                    <td className={`${td} whitespace-nowrap`}>{day(l.date)}</td>
                    <td className={`${td} whitespace-nowrap text-caption`}>{l.account}</td>
                    <td className={`${td} min-w-[220px] break-words`}>
                      {l.description}
                      {l.suggested && <div className="text-caption text-green-700">Names the director</div>}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(l.amount)}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      {canAct && (
                        <button
                          type="button"
                          className={secondaryBtn}
                          disabled={busy}
                          onClick={() => run(() => api("/api/finance/director-card/settlements", "POST", { bankTransactionId: l.id }), "Marked as a repayment. The oldest claims are cleared first.")}
                        >
                          Repays card claims
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

      <Section title="Statement">
        {data.months.length === 0 ? (
          <p className="py-md text-on-surface-variant">No card expenses or repayments yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Month</th>
                  <th className={`${th} text-right`}>Claimed</th>
                  <th className={`${th} text-right`}>Repaid</th>
                  <th className={`${th} text-right`}>Owed at month end</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {[...data.months].reverse().map((m) => (
                  <tr key={m.month}>
                    <td className={`${td} whitespace-nowrap`}>{monthName(m.month)}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{m.claimed ? money(m.claimed) : "—"}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{m.repaid ? money(m.repaid) : "—"}</td>
                    <td className={`${td} text-right whitespace-nowrap font-semibold`}>{money(m.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Claims (${data.claims.length})`}>
        {data.claims.length === 0 ? (
          <p className="py-md text-on-surface-variant">No expenses paid on the card since {day(data.settings.startOn)}.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Expense</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>Still owed</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {data.claims.map((c) => (
                  <tr key={c.id}>
                    <td className={`${td} whitespace-nowrap`}>{day(c.date)}</td>
                    <td className={td}>
                      {c.what}
                      <div className="text-caption text-on-surface-variant">{[c.paidTo, c.description].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(c.amount)}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{c.outstanding ? money(c.outstanding) : "—"}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {c.outstanding === 0 ? (
                        <span className="text-green-700 font-semibold">Repaid {c.settledOn ? `· ${day(c.settledOn)}` : ""}</span>
                      ) : c.settled > 0 ? (
                        <span className="text-amber-800 font-semibold">Part repaid</span>
                      ) : (
                        <span className="text-on-surface-variant">Owed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Repayments (${data.settlements.length})`}>
        {data.settlements.length === 0 ? (
          <p className="py-md text-on-surface-variant">None yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-lg">
            <table className="w-full text-body-md">
              <tbody className="divide-y divide-outline-variant">
                {data.settlements.map((s) => (
                  <tr key={s.id}>
                    <td className={`${td} whitespace-nowrap`}>{day(s.date)}</td>
                    <td className={`${td} text-caption break-words`}>{s.line ?? "—"}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(s.amount)}</td>
                    <td className={`${td} text-right`}>
                      {canAct && (
                        <button
                          type="button"
                          className="text-primary font-semibold hover:underline"
                          disabled={busy}
                          onClick={() => run(() => api(`/api/finance/director-card/settlements/${s.id}`, "DELETE"), "Repayment removed. The bank line is unexplained again.")}
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

      {canAct && (
        <Section title="Settings">
          <div className="flex flex-wrap items-end gap-sm">
            <label className="space-y-xs">
              <span className="text-label-sm font-semibold block">Count card expenses from</span>
              <input type="date" className={`${inputCls} w-48`} value={startOn} onChange={(e) => setStartOn(e.target.value)} />
            </label>
            <label className="space-y-xs flex-1 min-w-[240px]">
              <span className="text-label-sm font-semibold block">Words that name the director in bank narrations (comma-separated)</span>
              <input className={inputCls} value={words} onChange={(e) => setWords(e.target.value)} placeholder="e.g. a surname as the bank prints it" />
            </label>
            <button
              type="button"
              className={secondaryBtn}
              disabled={busy || !startOn}
              onClick={() => run(() => api("/api/finance/director-card/settings", "POST", { startOn, payeeWords: words }), "Settings saved.")}
            >
              Save
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}
