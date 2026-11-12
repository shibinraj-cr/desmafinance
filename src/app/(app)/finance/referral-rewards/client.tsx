"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KpiCard } from "@/components/Cards";
import {
  Callout,
  Field,
  INR,
  Icon,
  Modal,
  Pill,
  api,
  btnCls,
  cardCls,
  fmtDate,
  inputCls,
  linkBtnCls,
  primaryBtnCls,
  useToast,
} from "@/components/partner-commissions/ui";
import type { RewardRow } from "@/lib/crm-referral-reward";

type Tab = "due" | "paid" | "cancelled";
const th = "px-sm py-2.5 font-semibold whitespace-nowrap";
const td = "px-sm py-2.5 align-top";

export function ReferralRewardsClient({
  rows,
  today,
  paymentModes,
  reviewer,
  amount,
  ledger,
}: {
  rows: RewardRow[];
  today: string;
  paymentModes: string[];
  reviewer: string | null;
  amount: number;
  ledger: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("due");
  const [paying, setPaying] = useState<RewardRow | null>(null);
  const [cancelling, setCancelling] = useState<RewardRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const due = rows.filter((r) => r.status === "due");
  const paid = rows.filter((r) => r.status === "paid").sort((a, b) => ((a.paidOn ?? "") < (b.paidOn ?? "") ? 1 : -1));
  const cancelled = rows.filter((r) => r.status === "cancelled");
  const total = (list: RewardRow[]) => list.reduce((t, r) => t + r.amount, 0);
  const paidThisMonth = paid.filter((r) => (r.paidOn ?? "").slice(0, 7) === today.slice(0, 7));
  const flagged = paid.filter((r) => r.unenrolledAfterPaid);

  function done(msg: string) {
    setPaying(null);
    setCancelling(null);
    toast.show(msg);
    router.refresh();
  }

  async function quick(r: RewardRow, action: "undo" | "restore", msg: string) {
    setBusy(r.id);
    try {
      await api(`/api/finance/referral-rewards/${r.id}`, { action });
      done(msg);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "due", label: "Due", n: due.length },
    { key: "paid", label: "Paid", n: paid.length },
    { key: "cancelled", label: "Cancelled", n: cancelled.length },
  ];

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid gap-md grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Due to pay" value={INR(total(due))} hint={`${due.length} reward${due.length === 1 ? "" : "s"}`} tone="primary" />
        <KpiCard label="Paid this month" value={INR(total(paidThisMonth))} hint={`${paidThisMonth.length} paid`} />
        <KpiCard label="Paid in total" value={INR(total(paid))} hint={`${paid.length} paid`} tone="success" />
        <KpiCard
          label="Paid, then un-enrolled"
          value={flagged.length}
          hint={flagged.length ? "Decide whether to recover" : "None"}
          tone={flagged.length ? "danger" : "default"}
        />
      </div>

      <Callout icon="info">
        A candidate earns <b>{INR(amount)}</b> when someone they referred enrols. Pay the candidate first, then click{" "}
        <b>Mark paid</b>: it drafts the expense to <b>{ledger}</b> in {reviewer ? <b>{reviewer}&apos;s</b> : "your"} My Drafts
        for the usual approval.
      </Callout>

      <div className="inline-flex self-start rounded-lg border border-outline-variant overflow-hidden" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={
              "px-md h-9 text-label-sm font-semibold transition " +
              (tab === t.key ? "bg-primary text-on-primary" : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
            }
          >
            {t.label} · {t.n}
          </button>
        ))}
      </div>

      {tab === "due" && (
        <Table empty="Nothing due. A reward appears here the moment a referred candidate enrols." rows={due}>
          <thead>
            <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
              <th className={th}>Enrolled</th>
              <th className={th}>Referred candidate</th>
              <th className={th}>Pay to</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {due.map((r) => (
              <tr key={r.id} className="border-t border-outline-variant/60">
                <td className={`${td} tabular-nums`}>{fmtDate(r.enrolledOn)}</td>
                <td className={td}>
                  <div className="font-semibold">{r.referredName}</div>
                  {r.referredService && <div className="text-caption text-on-surface-variant">{r.referredService}</div>}
                </td>
                <td className={td}>
                  <PayTo r={r} />
                </td>
                <td className={`${td} text-right tabular-nums font-semibold`}>{INR(r.amount)}</td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <button type="button" className={`${linkBtnCls} mr-md`} onClick={() => setCancelling(r)}>
                    Cancel
                  </button>
                  <button type="button" className={primaryBtnCls} onClick={() => setPaying(r)}>
                    <Icon name="payments" />
                    Mark paid
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {tab === "paid" && (
        <Table empty="No rewards paid yet." rows={paid}>
          <thead>
            <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
              <th className={th}>Paid on</th>
              <th className={th}>Referred candidate</th>
              <th className={th}>Paid to</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={th}>Mode · reference</th>
              <th className={th}>Expense draft</th>
            </tr>
          </thead>
          <tbody>
            {paid.map((r) => (
              <tr key={r.id} className="border-t border-outline-variant/60">
                <td className={`${td} tabular-nums`}>{fmtDate(r.paidOn)}</td>
                <td className={td}>
                  <div className="font-semibold">{r.referredName}</div>
                  {r.unenrolledAfterPaid && <Pill tone="bad">Un-enrolled after payment</Pill>}
                </td>
                <td className={td}>{r.referrerName}</td>
                <td className={`${td} text-right tabular-nums font-semibold`}>{INR(r.amount)}</td>
                <td className={td}>
                  {r.paymentMode}
                  {r.reference ? <span className="text-on-surface-variant"> · {r.reference}</span> : null}
                  {r.paidBy ? <div className="text-caption text-on-surface-variant">by {r.paidBy}</div> : null}
                </td>
                <td className={td}>
                  {r.draftPending ? (
                    <div className="flex flex-col items-start gap-1">
                      <Pill tone="warn">In My Drafts</Pill>
                      <button
                        type="button"
                        className={linkBtnCls}
                        disabled={busy === r.id}
                        onClick={() => quick(r, "undo", `Payment for ${r.referredName} taken back — due again.`)}
                      >
                        Undo payment
                      </button>
                    </div>
                  ) : (
                    <Pill tone="ok">Sent on from My Drafts</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {tab === "cancelled" && (
        <Table empty="No cancelled rewards." rows={cancelled}>
          <thead>
            <tr className="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
              <th className={th}>Cancelled</th>
              <th className={th}>Referred candidate</th>
              <th className={th}>Referred by</th>
              <th className={th}>Why</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {cancelled.map((r) => (
              <tr key={r.id} className="border-t border-outline-variant/60">
                <td className={`${td} tabular-nums`}>{fmtDate(r.cancelledAt)}</td>
                <td className={`${td} font-semibold`}>{r.referredName}</td>
                <td className={td}>{r.referrerName}</td>
                <td className={td}>{r.cancelReason ?? "—"}</td>
                <td className={`${td} text-right`}>
                  <button
                    type="button"
                    className={linkBtnCls}
                    disabled={busy === r.id}
                    onClick={() => quick(r, "restore", `Reward for ${r.referredName} is due again.`)}
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {paying && (
        <PayDialog
          r={paying}
          today={today}
          paymentModes={paymentModes}
          reviewer={reviewer}
          ledger={ledger}
          onClose={() => setPaying(null)}
          onDone={done}
        />
      )}
      {cancelling && <CancelDialog r={cancelling} onClose={() => setCancelling(null)} onDone={done} />}
      {toast.node}
    </div>
  );
}

function Table({ rows, empty, children }: { rows: RewardRow[]; empty: string; children: React.ReactNode }) {
  if (rows.length === 0) {
    return (
      <div className="p-lg text-center text-on-surface-variant border border-dashed border-outline-variant rounded-xl bg-surface-container-lowest">
        {empty}
      </div>
    );
  }
  return (
    <div className={`overflow-x-auto ${cardCls}`}>
      <table className="w-full min-w-[760px] text-body-md">{children}</table>
    </div>
  );
}

/** Who to pay and how to reach them. */
function PayTo({ r }: { r: RewardRow }) {
  return (
    <>
      <div className="font-semibold">{r.referrerName}</div>
      <div className="text-caption text-on-surface-variant">
        {[r.referrerPhone, r.referrerEmail].filter(Boolean).join(" · ") || "No contact on the lead"}
      </div>
    </>
  );
}

function PayDialog({
  r,
  today,
  paymentModes,
  reviewer,
  ledger,
  onClose,
  onDone,
}: {
  r: RewardRow;
  today: string;
  paymentModes: string[];
  reviewer: string | null;
  ledger: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState(paymentModes.includes("UPI") ? "UPI" : paymentModes[0]);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api(`/api/finance/referral-rewards/${r.id}`, { action: "pay", paidOn, paymentMode: mode, reference });
      onDone(`${INR(r.amount)} to ${r.referrerName} marked paid. The expense is in ${reviewer ? `${reviewer}'s` : "your"} My Drafts.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Mark ${INR(r.amount)} paid`}
      subtitle={`To ${r.referrerName}, for referring ${r.referredName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnCls} onClick={onClose} disabled={busy}>
            Back
          </button>
          <button type="button" className={primaryBtnCls} onClick={save} disabled={busy || !paidOn}>
            {busy ? "Saving…" : "Mark paid"}
          </button>
        </>
      }
    >
      <PayTo r={r} />
      <div className="grid gap-sm sm:grid-cols-2">
        <Field label="Paid on">
          <input className={inputCls} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="Paid from">
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
            {paymentModes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="UPI / bank reference" hint="Optional, but it makes the ledger entry easy to match to the bank statement.">
        <input className={inputCls} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <Callout tone="gold" icon="receipt_long">
        Drafts {INR(r.amount)} to <b>{ledger}</b> in {reviewer ? `${reviewer}'s` : "your"} My Drafts.
      </Callout>
      {err && (
        <Callout tone="bad" icon="error">
          {err}
        </Callout>
      )}
    </Modal>
  );
}

function CancelDialog({ r, onClose, onDone }: { r: RewardRow; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api(`/api/finance/referral-rewards/${r.id}`, { action: "cancel", reason });
      onDone(`Reward for ${r.referredName} cancelled.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Cancel this reward"
      subtitle={`${r.referrerName}, for referring ${r.referredName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnCls} onClick={onClose} disabled={busy}>
            Back
          </button>
          <button type="button" className={primaryBtnCls} onClick={save} disabled={busy || reason.trim().length < 3}>
            {busy ? "Saving…" : "Cancel reward"}
          </button>
        </>
      }
    >
      <Field label="Why">
        <textarea className={`${inputCls} h-24 py-sm`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {err && (
        <Callout tone="bad" icon="error">
          {err}
        </Callout>
      )}
    </Modal>
  );
}
