"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  CAMPAIGN_TYPE_LABELS,
  COMMITMENT_KINDS,
  COMMITMENT_KIND_LABELS,
  MKT_PLANNER_HREF,
  SERIES_COMMITTED,
  SERIES_SPENT,
  formatInr,
  parseRupees,
  pctOf,
  type CampaignStatus,
  type CampaignType,
  type ChannelDto,
  type CommitmentKind,
  type DisplayStatus,
  type UserOpt,
} from "@/lib/mkt-planner-shared";
import { plannerApi } from "../../_api";
import { CampaignForm } from "../../_campaign-form";
import {
  Card,
  Icon,
  Meter,
  StatusPill,
  Swatch,
  faintText,
  ghostBtnClass,
  ghostBtnStyle,
  inputClass,
  inputStyle,
  mutedText,
  primaryBtnClass,
  primaryBtnStyle,
} from "../../_ui";

export type PaymentRow = {
  transactionId: string;
  date: string;
  subItem: string;
  description: string | null;
  paymentMode: string;
  partyName: string | null;
  amount: number;
  mode: "tagged" | "auto";
  lineId: string | null;
};

type Campaign = {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  display: DisplayStatus;
  channelId: string | null;
  channelName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  code: string | null;
  brief: string | null;
  audience: string | null;
  services: string | null;
  targetLeads: number | null;
  targetEnrollments: number | null;
  decisionNote: string | null;
  canDelete: boolean;
};

type Line = { id: string; label: string; vendor: string | null; planned: number };
type Commitment = {
  id: string;
  lineId: string | null;
  amount: number;
  kind: string;
  vendor: string | null;
  dueDate: string | null;
  note: string | null;
  status: string;
};
type Deliverable = { id: string; title: string; ownerId: string | null; ownerName: string | null; dueDate: string | null; done: boolean };
type Linkable = {
  transactionId: string;
  date: string;
  subItem: string;
  description: string | null;
  partyName: string | null;
  amount: number;
  currently: string;
};

const th = "px-[12px] py-[9px] text-[11px] font-semibold uppercase tracking-wider border-b whitespace-nowrap";
const td = "px-[12px] py-[11px] border-b whitespace-nowrap";
const rowBorder = { borderColor: "var(--lp-surface-container-high)" };
const headBorder = { ...faintText, borderColor: "var(--lp-outline-variant)" };

function niceDate(ds: string | null): string {
  if (!ds) return "—";
  return new Date(`${ds}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function CampaignClient({
  today,
  admin,
  autoEdit,
  channels,
  users,
  campaign: c,
  lines,
  commitments,
  deliverables,
  events,
  payments,
  linkable,
  money,
  leadReturn,
}: {
  today: string;
  admin: boolean;
  autoEdit: boolean;
  channels: ChannelDto[];
  users: UserOpt[];
  campaign: Campaign;
  lines: Line[];
  commitments: Commitment[];
  deliverables: Deliverable[];
  events: { id: string; at: string; who: string | null; text: string }[];
  payments: PaymentRow[];
  linkable: Linkable[];
  money: {
    paid: number;
    committedUnpaid: number;
    uncommitted: number;
    over: number;
    linesPlanned: number;
    byLine: Record<string, { committed: number; paid: number; unpaid: number }>;
  };
  leadReturn: { leads: number; enrolled: number } | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(autoEdit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | { action: "approve" | "reject" | "cancel"; note: string }>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const move = (action: string, note?: string) =>
    run(() => plannerApi("POST", `/api/marketing/planner/campaigns/${c.id}/status`, { action, ...(note ? { note } : {}) }));

  const base = `/api/marketing/planner/campaigns/${c.id}`;
  const lineName = new Map(lines.map((l) => [l.id, l.label]));

  // ── Status actions available here ──
  const actions: ReactNode[] = [];
  if (c.status === "idea" || c.status === "draft") {
    actions.push(
      <button key="submit" type="button" disabled={busy} onClick={() => move("submit")} className={primaryBtnClass} style={primaryBtnStyle}>
        Submit for approval
      </button>,
    );
  }
  if (admin && (c.status === "awaiting" || c.status === "draft")) {
    actions.push(
      <button key="approve" type="button" disabled={busy} onClick={() => setPending({ action: "approve", note: "" })} className={primaryBtnClass} style={primaryBtnStyle}>
        Approve
      </button>,
    );
  }
  if (admin && c.status === "awaiting") {
    actions.push(
      <button key="reject" type="button" disabled={busy} onClick={() => setPending({ action: "reject", note: "" })} className={ghostBtnClass} style={ghostBtnStyle}>
        Send back
      </button>,
    );
  }
  if (c.status === "approved") {
    actions.push(
      <button key="done" type="button" disabled={busy} onClick={() => move("done")} className={ghostBtnClass} style={ghostBtnStyle}>
        Mark done
      </button>,
    );
  }
  if (c.status === "done" || c.status === "cancelled") {
    actions.push(
      <button key="reopen" type="button" disabled={busy} onClick={() => move("reopen")} className={ghostBtnClass} style={ghostBtnStyle}>
        Reopen
      </button>,
    );
  }

  const usedPct = pctOf(money.paid, c.budget);
  const commPct = pctOf(money.committedUnpaid, c.budget);
  const linesDiff = money.linesPlanned - c.budget;

  return (
    <main className="max-w-[1400px] mx-auto px-[16px] md:px-[28px] py-[24px] flex flex-col gap-[18px]">
      <Link href={`${MKT_PLANNER_HREF}/timeline`} className="inline-flex items-center gap-[4px] text-[13px] font-medium self-start min-h-[32px]" style={{ color: "var(--lp-primary)" }}>
        <Icon name="chevron_left" size={18} />
        Back to planner
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-[14px]">
        <div className="flex flex-col gap-[10px] min-w-0">
          <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
            <span className="rounded-full px-[10px] py-[2px]" style={{ backgroundColor: "var(--lp-surface-container-high)", ...mutedText }}>
              {CAMPAIGN_TYPE_LABELS[c.type]}
            </span>
            <StatusPill status={c.display} />
            {c.code && (
              <span className="font-mono rounded-full px-[10px] py-[2px] border" style={{ borderColor: "var(--lp-outline-variant)", ...mutedText }}>
                {c.code}
              </span>
            )}
          </div>
          <h1 className="font-display text-[28px] font-semibold leading-tight" style={{ textDecoration: c.status === "cancelled" ? "line-through" : undefined }}>
            {c.name}
          </h1>
          <div className="flex flex-wrap gap-[6px_18px] text-[13px]" style={mutedText}>
            <span>
              {c.startDate ? `${niceDate(c.startDate)}${c.endDate && c.endDate !== c.startDate ? ` – ${niceDate(c.endDate)}` : ""}` : "Unscheduled idea"}
            </span>
            <span>Owner: {c.ownerName ?? "nobody"}</span>
            <span>Draws from: {c.channelName ?? "no channel"}</span>
          </div>
          {c.status === "draft" && c.decisionNote && (
            <p className="text-[13px] rounded-[8px] px-[12px] py-[8px]" style={{ backgroundColor: "rgba(255, 182, 147, 0.08)", color: "var(--lp-orange)" }}>
              Sent back: {c.decisionNote}
            </p>
          )}
          {c.status === "awaiting" && !admin && (
            <p className="text-[13px]" style={{ color: "var(--lp-cyan)" }}>
              Waiting for an Admin to approve.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-[8px]">
          <button type="button" onClick={() => setEditing(true)} className={ghostBtnClass} style={ghostBtnStyle}>
            <Icon name="edit" size={16} />
            Edit
          </button>
          {actions}
          {c.status !== "cancelled" && (
            <button type="button" disabled={busy} onClick={() => setPending({ action: "cancel", note: "" })} className={ghostBtnClass} style={ghostBtnStyle}>
              Cancel campaign
            </button>
          )}
          {c.canDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete "${c.name}"? Payments tagged to it go back to automatic matching.`)) return;
                setBusy(true);
                plannerApi("DELETE", base)
                  .then(() => router.push(`${MKT_PLANNER_HREF}/timeline`))
                  .catch((e) => {
                    setError(e instanceof Error ? e.message : "Could not delete.");
                    setBusy(false);
                  });
              }}
              className={ghostBtnClass}
              style={{ ...ghostBtnStyle, color: "var(--lp-error)" }}
            >
              Delete
            </button>
          )}
        </div>
      </header>

      {pending && (
        <div className="rounded-[12px] border p-[14px] flex flex-wrap items-end gap-[10px]" style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-primary)" }}>
          <label className="flex-[1_1_320px] flex flex-col gap-[5px] text-[12px]" style={mutedText}>
            {pending.action === "approve" ? "Approval note (optional)" : pending.action === "reject" ? "What needs to change?" : "Why is it cancelled? (optional)"}
            <input className={inputClass} style={inputStyle} value={pending.note} onChange={(e) => setPending({ ...pending, note: e.target.value })} maxLength={1000} autoFocus />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const p = pending;
              setPending(null);
              move(p.action, p.note.trim() || undefined);
            }}
            className={primaryBtnClass}
            style={primaryBtnStyle}
          >
            {pending.action === "approve" ? `Approve at ${formatInr(c.budget)}` : pending.action === "reject" ? "Send back" : "Cancel campaign"}
          </button>
          <button type="button" onClick={() => setPending(null)} className={ghostBtnClass} style={ghostBtnStyle}>
            Never mind
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] rounded-[8px] px-[12px] py-[8px]" style={{ backgroundColor: "rgba(255, 180, 171, 0.08)", color: "var(--lp-error)" }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-[16px] items-start">
        <div className="flex-[999_1_560px] min-w-0 flex flex-col gap-[16px]">
          <Card title="Brief">
            {c.brief ? (
              <p className="text-[14px] leading-relaxed whitespace-pre-line">{c.brief}</p>
            ) : (
              <p className="text-[13px]" style={mutedText}>
                No brief yet. <button type="button" onClick={() => setEditing(true)} style={{ color: "var(--lp-primary)" }}>Add one</button>
              </p>
            )}
            <div className="grid gap-[12px_24px] text-[13px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <Fact label="Audience" value={c.audience} />
              <Fact label="Services promoted" value={c.services} />
              <Fact label="CRM tracking" value={c.code ? `Leads with campaign "${c.code}"` : null} empty="No campaign code set" />
            </div>
          </Card>

          <LinesCard
            base={base}
            lines={lines}
            byLine={money.byLine}
            linesDiff={linesDiff}
            budget={c.budget}
            run={run}
            busy={busy}
          />

          <CommitmentsCard base={base} lines={lines} lineName={lineName} commitments={commitments} run={run} busy={busy} disabled={c.status === "cancelled"} />

          <PaymentsCard campaignId={c.id} lines={lines} lineName={lineName} payments={payments} linkable={linkable} run={run} busy={busy} />

          <DeliverablesCard base={base} deliverables={deliverables} users={users} today={today} run={run} busy={busy} />
        </div>

        <aside className="flex-[1_1_340px] min-w-0 flex flex-col gap-[16px]">
          <Card title="Budget">
            <p className="font-mono text-[30px] leading-none">{formatInr(c.budget)}</p>
            <Meter spentPct={usedPct} commPct={commPct} height={12} title={`Paid ${Math.round(usedPct)}%, committed ${Math.round(commPct)}%`} />
            <div className="flex flex-col gap-[8px] text-[13px]">
              <Row label={<><Swatch color={SERIES_SPENT} />Paid (ledger)</>} value={formatInr(money.paid)} />
              <Row label={<><Swatch color={SERIES_COMMITTED} />Committed, unpaid</>} value={formatInr(money.committedUnpaid)} />
              <Row label={<><Swatch outline />Not yet committed</>} value={formatInr(money.uncommitted)} />
            </div>
            {money.over > 0 && (
              <p className="text-[13px] border-t pt-[10px]" style={{ ...rowBorder, color: "var(--lp-error)" }}>
                {formatInr(money.over)} paid or promised beyond the budget.
              </p>
            )}
          </Card>

          <Card title="Targets & results">
            <div className="grid grid-cols-2 gap-[10px]">
              <Stat label="Leads" target={c.targetLeads} actual={leadReturn?.leads ?? null} fmt={(n) => n.toLocaleString("en-IN")} />
              <Stat label="Enrollments" target={c.targetEnrollments} actual={leadReturn?.enrolled ?? null} fmt={(n) => n.toLocaleString("en-IN")} />
              <Stat
                label="Cost per lead"
                target={c.targetLeads ? Math.round(c.budget / c.targetLeads) : null}
                actual={leadReturn?.leads ? Math.round(money.paid / leadReturn.leads) : null}
                fmt={formatInr}
                lowerIsBetter
              />
              <Stat
                label="Cost per enrollment"
                target={c.targetEnrollments ? Math.round(c.budget / c.targetEnrollments) : null}
                actual={leadReturn?.enrolled ? Math.round(money.paid / leadReturn.enrolled) : null}
                fmt={formatInr}
                lowerIsBetter
              />
            </div>
            <p className="text-[12px] leading-relaxed" style={mutedText}>
              {c.code
                ? `Actuals count CRM leads whose Campaign is "${c.code}" (duplicates excluded); enrollments are those leads' closed-won deals. Cost uses what the ledger shows paid.`
                : "Set a CRM campaign code on this campaign to pull its leads and enrollments from CRM."}
            </p>
          </Card>

          <Card title="Approval & activity">
            {events.length === 0 ? (
              <p className="text-[13px]" style={mutedText}>No activity yet.</p>
            ) : (
              <ol className="flex flex-col gap-[12px]">
                {events.map((e) => (
                  <li key={e.id} className="grid gap-[10px] text-[13px] leading-snug" style={{ gridTemplateColumns: "60px minmax(0,1fr)" }}>
                    <span className="font-mono text-[11px] uppercase pt-[2px]" style={faintText}>
                      {new Date(e.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}
                    </span>
                    <span>
                      {e.text}
                      {e.who && <span style={faintText}> · {e.who}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </aside>
      </div>

      {editing && (
        <CampaignForm
          initial={{
            id: c.id,
            name: c.name,
            type: c.type,
            channelId: c.channelId,
            ownerId: c.ownerId,
            startDate: c.startDate,
            endDate: c.endDate,
            budget: c.budget,
            code: c.code,
            brief: c.brief,
            audience: c.audience,
            services: c.services,
            targetLeads: c.targetLeads,
            targetEnrollments: c.targetEnrollments,
          }}
          channels={channels}
          users={users}
          isApproved={c.status === "approved"}
          admin={admin}
          onClose={() => setEditing(false)}
        />
      )}
    </main>
  );
}

function Fact({ label, value, empty = "—" }: { label: string; value: string | null; empty?: string }) {
  return (
    <div>
      <p className="text-[11px] mb-[3px]" style={faintText}>{label}</p>
      <p style={value ? undefined : faintText}>{value ?? empty}</p>
    </div>
  );
}

function Row({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="flex justify-between gap-[10px]">
      <span className="inline-flex items-center gap-[8px]">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Stat({
  label,
  target,
  actual,
  fmt,
  lowerIsBetter,
}: {
  label: string;
  target: number | null;
  actual: number | null;
  fmt: (n: number) => string;
  lowerIsBetter?: boolean;
}) {
  const good = target !== null && actual !== null ? (lowerIsBetter ? actual <= target : actual >= target) : null;
  return (
    <div className="rounded-[8px] p-[12px]" style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
      <p className="text-[11px]" style={faintText}>{label}</p>
      <p className="font-mono text-[20px] mt-[4px]" style={{ color: good === null ? undefined : good ? "var(--lp-cyan)" : "var(--lp-orange)" }}>
        {actual !== null ? fmt(actual) : "—"}
      </p>
      <p className="text-[11px] mt-[2px]" style={mutedText}>
        {target !== null ? `Target ${fmt(target)}` : "No target"}
      </p>
    </div>
  );
}

type Runner = (fn: () => Promise<unknown>) => Promise<void>;

function LinesCard({
  base,
  lines,
  byLine,
  linesDiff,
  budget,
  run,
  busy,
}: {
  base: string;
  lines: Line[];
  byLine: Record<string, { committed: number; paid: number; unpaid: number }>;
  linesDiff: number;
  budget: number;
  run: Runner;
  busy: boolean;
}) {
  const [draft, setDraft] = useState({ label: "", vendor: "", planned: "" });
  const [edit, setEdit] = useState<null | { id: string; label: string; vendor: string; planned: string }>(null);
  const [err, setErr] = useState<string | null>(null);

  const status = (k: string) => {
    const v = byLine[k];
    if (!v) return { label: "Planned", color: "var(--lp-on-surface-variant)" };
    if (v.committed > 0 && v.paid >= v.committed) return { label: "Paid", color: "var(--lp-primary)" };
    if (v.paid > 0) return { label: "Part-paid", color: "var(--lp-primary)" };
    if (v.committed > 0) return { label: "Committed", color: "var(--lp-cyan)" };
    return { label: "Planned", color: "var(--lp-on-surface-variant)" };
  };

  async function add() {
    setErr(null);
    const planned = parseRupees(draft.planned || "0");
    if (!draft.label.trim()) return setErr("Name the line.");
    if (planned === null) return setErr("Planned must be a whole rupee amount.");
    await run(() => plannerApi("POST", `${base}/lines`, { label: draft.label.trim(), vendor: draft.vendor.trim() || null, planned }));
    setDraft({ label: "", vendor: "", planned: "" });
  }

  async function save() {
    if (!edit) return;
    setErr(null);
    const planned = parseRupees(edit.planned || "0");
    if (!edit.label.trim()) return setErr("Name the line.");
    if (planned === null) return setErr("Planned must be a whole rupee amount.");
    await run(() => plannerApi("PATCH", `${base}/lines/${edit.id}`, { label: edit.label.trim(), vendor: edit.vendor.trim() || null, planned }));
    setEdit(null);
  }

  const totals = Object.values(byLine).reduce((a, v) => ({ committed: a.committed + v.committed, paid: a.paid + v.paid }), { committed: 0, paid: 0 });
  const unlined = byLine[""];

  return (
    <Card
      title="Budget lines"
      subtitle="Planned is the plan. Committed = booked, PO raised or quote accepted. Paid comes from the finance ledger."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[720px] text-[13px]">
          <thead>
            <tr>
              {["Line item", "Vendor", "Planned", "Committed", "Paid", "Status", ""].map((h, i) => (
                <th key={i} className={th} style={{ ...headBorder, textAlign: i >= 2 && i <= 4 ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const v = byLine[l.id] ?? { committed: 0, paid: 0 };
              const s = status(l.id);
              if (edit?.id === l.id) {
                return (
                  <tr key={l.id}>
                    <td className={td} style={rowBorder}><input aria-label="Line item" className={inputClass} style={inputStyle} value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></td>
                    <td className={td} style={rowBorder}><input aria-label="Vendor" className={inputClass} style={inputStyle} value={edit.vendor} onChange={(e) => setEdit({ ...edit, vendor: e.target.value })} /></td>
                    <td className={td} style={rowBorder}><input aria-label="Planned" className={`${inputClass} font-mono text-right`} style={inputStyle} value={edit.planned} onChange={(e) => setEdit({ ...edit, planned: e.target.value })} /></td>
                    <td className={`${td} text-right font-mono`} style={rowBorder}>{v.committed ? formatInr(v.committed) : "—"}</td>
                    <td className={`${td} text-right font-mono`} style={rowBorder}>{v.paid ? formatInr(v.paid) : "—"}</td>
                    <td className={td} style={rowBorder} />
                    <td className={td} style={rowBorder}>
                      <span className="flex gap-[6px]">
                        <button type="button" disabled={busy} onClick={save} className="text-[12px] font-semibold min-h-[32px]" style={{ color: "var(--lp-primary)" }}>Save</button>
                        <button type="button" onClick={() => setEdit(null)} className="text-[12px] min-h-[32px]" style={mutedText}>Cancel</button>
                      </span>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={l.id}>
                  <td className={`${td} font-medium`} style={rowBorder}>{l.label}</td>
                  <td className={td} style={{ ...rowBorder, ...mutedText }}>{l.vendor ?? "—"}</td>
                  <td className={`${td} text-right font-mono`} style={rowBorder}>{formatInr(l.planned)}</td>
                  <td className={`${td} text-right font-mono`} style={rowBorder}>{v.committed ? formatInr(v.committed) : "—"}</td>
                  <td className={`${td} text-right font-mono`} style={rowBorder}>{v.paid ? formatInr(v.paid) : "—"}</td>
                  <td className={td} style={rowBorder}><span className="text-[12px] font-semibold" style={{ color: s.color }}>{s.label}</span></td>
                  <td className={td} style={rowBorder}>
                    <span className="flex gap-[4px]">
                      <button type="button" aria-label={`Edit ${l.label}`} onClick={() => setEdit({ id: l.id, label: l.label, vendor: l.vendor ?? "", planned: String(l.planned) })} className="w-[32px] h-[32px] flex items-center justify-center" style={mutedText}>
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${l.label}`}
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Remove "${l.label}"? Its commitments and payments stay on the campaign, unlined.`)) run(() => plannerApi("DELETE", `${base}/lines/${l.id}`));
                        }}
                        className="w-[32px] h-[32px] flex items-center justify-center"
                        style={mutedText}
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {unlined && (unlined.committed > 0 || unlined.paid > 0) && (
              <tr>
                <td className={td} style={{ ...rowBorder, ...mutedText }}>Not on a line</td>
                <td className={td} style={rowBorder} />
                <td className={`${td} text-right font-mono`} style={rowBorder}>—</td>
                <td className={`${td} text-right font-mono`} style={rowBorder}>{unlined.committed ? formatInr(unlined.committed) : "—"}</td>
                <td className={`${td} text-right font-mono`} style={rowBorder}>{unlined.paid ? formatInr(unlined.paid) : "—"}</td>
                <td className={td} style={rowBorder} />
                <td className={td} style={rowBorder} />
              </tr>
            )}
            <tr>
              <td className={td} style={rowBorder}><input aria-label="New line item" placeholder="New line item" className={inputClass} style={inputStyle} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></td>
              <td className={td} style={rowBorder}><input aria-label="Vendor" placeholder="Vendor" className={inputClass} style={inputStyle} value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} /></td>
              <td className={td} style={rowBorder}><input aria-label="Planned amount" placeholder="₹" className={`${inputClass} font-mono text-right`} style={inputStyle} inputMode="numeric" value={draft.planned} onChange={(e) => setDraft({ ...draft, planned: e.target.value })} /></td>
              <td className={td} style={rowBorder} colSpan={3} />
              <td className={td} style={rowBorder}>
                <button type="button" disabled={busy} onClick={add} className="text-[12px] font-semibold min-h-[32px]" style={{ color: "var(--lp-primary)" }}>Add line</button>
              </td>
            </tr>
            <tr>
              <td className="px-[12px] py-[11px] font-semibold">Total</td>
              <td />
              <td className="px-[12px] py-[11px] text-right font-mono font-medium">{formatInr(lines.reduce((a, l) => a + l.planned, 0))}</td>
              <td className="px-[12px] py-[11px] text-right font-mono font-medium">{formatInr(totals.committed)}</td>
              <td className="px-[12px] py-[11px] text-right font-mono font-medium">{formatInr(totals.paid)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      {lines.length > 0 && linesDiff !== 0 && (
        <p className="text-[12px]" style={{ color: "var(--lp-orange)" }}>
          Lines add up to {formatInr(lines.reduce((a, l) => a + l.planned, 0))} — {formatInr(Math.abs(linesDiff))} {linesDiff > 0 ? "more" : "less"} than the {formatInr(budget)} budget.
        </p>
      )}
      {err && <p role="alert" className="text-[13px]" style={{ color: "var(--lp-error)" }}>{err}</p>}
    </Card>
  );
}

function CommitmentsCard({
  base,
  lines,
  lineName,
  commitments,
  run,
  busy,
  disabled,
}: {
  base: string;
  lines: Line[];
  lineName: Map<string, string>;
  commitments: Commitment[];
  run: Runner;
  busy: boolean;
  disabled: boolean;
}) {
  const [f, setF] = useState({ lineId: "", amount: "", kind: "quote" as CommitmentKind, vendor: "", dueDate: "", note: "" });
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    const amount = parseRupees(f.amount);
    if (!amount) return setErr("Enter the amount promised, in whole rupees.");
    await run(() =>
      plannerApi("POST", `${base}/commitments`, {
        lineId: f.lineId || null,
        amount,
        kind: f.kind,
        vendor: f.vendor.trim() || null,
        dueDate: f.dueDate || null,
        note: f.note.trim() || null,
      }),
    );
    setF({ lineId: "", amount: "", kind: "quote", vendor: "", dueDate: "", note: "" });
  }

  return (
    <Card title="Commitments" subtitle="Money promised but not yet paid. Each one nets off by itself as the ledger shows payments on the same line.">
      {commitments.length > 0 && (
        <ul className="flex flex-col">
          {commitments.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-[8px_16px] py-[10px] border-b text-[13px]" style={{ ...rowBorder, opacity: m.status === "cancelled" ? 0.55 : 1 }}>
              <span className="font-mono w-[100px] text-right" style={{ textDecoration: m.status === "cancelled" ? "line-through" : undefined }}>{formatInr(m.amount)}</span>
              <span className="flex-1 min-w-[200px]">
                {COMMITMENT_KIND_LABELS[m.kind as CommitmentKind] ?? m.kind}
                {m.vendor ? ` · ${m.vendor}` : ""}
                {m.lineId ? <span style={faintText}> · {lineName.get(m.lineId) ?? "line"}</span> : null}
                {m.note ? <span className="block text-[12px]" style={faintText}>{m.note}</span> : null}
              </span>
              <span className="text-[12px]" style={mutedText}>{m.dueDate ? `Due ${niceDate(m.dueDate)}` : "No due date"}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => plannerApi("PATCH", `${base}/commitments/${m.id}`, { status: m.status === "cancelled" ? "open" : "cancelled" }))}
                className="text-[12px] font-medium min-h-[32px]"
                style={{ color: m.status === "cancelled" ? "var(--lp-primary)" : "var(--lp-on-surface-variant)" }}
              >
                {m.status === "cancelled" ? "Restore" : "Cancel"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="grid gap-[10px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
            Budget line
            <select className={inputClass} style={inputStyle} value={f.lineId} onChange={(e) => setF({ ...f, lineId: e.target.value })}>
              <option value="">No line</option>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
            Amount (₹)
            <input className={`${inputClass} font-mono text-right`} style={inputStyle} inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </label>
          <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
            Kind
            <select className={inputClass} style={inputStyle} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CommitmentKind })}>
              {COMMITMENT_KINDS.map((k) => <option key={k} value={k}>{COMMITMENT_KIND_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
            Due to pay
            <input type="date" className={`${inputClass} lp-date-input`} style={inputStyle} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </label>
          <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
            Vendor
            <input className={inputClass} style={inputStyle} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
          </label>
          <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
            Note
            <input className={inputClass} style={inputStyle} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </label>
          <div className="flex items-end">
            <button type="button" disabled={busy} onClick={add} className={`${primaryBtnClass} w-full`} style={primaryBtnStyle}>Log commitment</button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="text-[13px]" style={{ color: "var(--lp-error)" }}>{err}</p>}
    </Card>
  );
}

function PaymentsCard({
  campaignId,
  lines,
  lineName,
  payments,
  linkable,
  run,
  busy,
}: {
  campaignId: string;
  lines: Line[];
  lineName: Map<string, string>;
  payments: PaymentRow[];
  linkable: Linkable[];
  run: Runner;
  busy: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const tag = (transactionId: string, lineId: string | null) =>
    run(() => plannerApi("PUT", "/api/marketing/planner/spend-tags", { transactionId, campaignId, lineId }));

  const q = query.trim().toLowerCase();
  const filtered = linkable.filter(
    (r) => !q || [r.description, r.subItem, r.partyName, String(r.amount)].some((s) => s?.toLowerCase().includes(q)),
  );

  return (
    <Card
      title="Linked finance payments"
      subtitle="Read-only rows from the finance ledger. Finance records the payment; Marketing only says which campaign and line it paid for."
      actions={
        <button type="button" onClick={() => setPicking(!picking)} className={ghostBtnClass} style={{ ...ghostBtnStyle, color: "var(--lp-primary)" }}>
          {picking ? "Close" : "Link a ledger payment"}
        </button>
      }
    >
      {picking && (
        <div className="rounded-[10px] border p-[12px] flex flex-col gap-[10px]" style={{ borderColor: "var(--lp-outline-variant)", backgroundColor: "var(--lp-surface-container-low)" }}>
          <input aria-label="Search payments" placeholder="Search description, vendor, sub-item or amount" className={inputClass} style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} />
          {filtered.length === 0 ? (
            <p className="text-[13px]" style={mutedText}>No Marketing payments around these dates.</p>
          ) : (
            <ul className="flex flex-col max-h-[320px] overflow-y-auto">
              {filtered.map((r) => (
                <li key={r.transactionId} className="flex flex-wrap items-center gap-[8px_14px] py-[8px] border-b text-[13px]" style={rowBorder}>
                  <span className="font-mono text-[12px] w-[90px]" style={mutedText}>{niceDate(r.date)}</span>
                  <span className="flex-1 min-w-[200px]">
                    {r.description || r.subItem}
                    <span className="block text-[11px]" style={faintText}>{r.subItem}{r.partyName ? ` · ${r.partyName}` : ""} · {r.currently}</span>
                  </span>
                  <span className="font-mono">{formatInr(r.amount)}</span>
                  <button type="button" disabled={busy} onClick={() => tag(r.transactionId, null)} className="text-[12px] font-semibold min-h-[32px]" style={{ color: "var(--lp-primary)" }}>
                    Link
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {payments.length === 0 ? (
        <p className="text-[13px]" style={mutedText}>
          No payments yet. Ledger rows on this campaign&apos;s channel are matched automatically while it runs; link others by hand.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px] text-[13px]">
            <thead>
              <tr>
                {["Date", "Description", "Paid via", "Amount", "Budget line", ""].map((h, i) => (
                  <th key={i} className={th} style={{ ...headBorder, textAlign: i === 3 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.transactionId}>
                  <td className={`${td} font-mono`} style={{ ...rowBorder, ...mutedText }}>{niceDate(p.date)}</td>
                  <td className={td} style={rowBorder}>
                    {p.description || p.subItem}
                    <span className="block text-[11px]" style={faintText}>
                      {p.subItem}
                      {p.partyName ? ` · ${p.partyName}` : ""} · {p.mode === "auto" ? "Matched automatically" : "Tagged"}
                    </span>
                  </td>
                  <td className={td} style={{ ...rowBorder, ...mutedText }}>{p.paymentMode}</td>
                  <td className={`${td} text-right font-mono`} style={rowBorder}>{formatInr(p.amount)}</td>
                  <td className={td} style={rowBorder}>
                    <select
                      aria-label="Budget line"
                      className="rounded-[8px] px-[8px] min-h-[34px] text-[12px] border outline-none max-w-[200px]"
                      style={inputStyle}
                      value={p.lineId ?? ""}
                      disabled={busy}
                      onChange={(e) => tag(p.transactionId, e.target.value || null)}
                    >
                      <option value="">{p.lineId ? "No line" : "Pick a line…"}</option>
                      {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                    {p.lineId && !lineName.has(p.lineId) && <span className="block text-[11px]" style={faintText}>Line removed</span>}
                  </td>
                  <td className={td} style={rowBorder}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          p.mode === "tagged"
                            ? plannerApi("DELETE", `/api/marketing/planner/spend-tags?transactionId=${encodeURIComponent(p.transactionId)}`)
                            : plannerApi("PUT", "/api/marketing/planner/spend-tags", { transactionId: p.transactionId, campaignId: null }),
                        )
                      }
                      className="text-[12px] min-h-[32px]"
                      style={mutedText}
                      title={p.mode === "tagged" ? "Remove the tag — the row goes back to automatic matching" : "Mark as not this campaign's spend"}
                    >
                      Unlink
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DeliverablesCard({
  base,
  deliverables,
  users,
  today,
  run,
  busy,
}: {
  base: string;
  deliverables: Deliverable[];
  users: UserOpt[];
  today: string;
  run: Runner;
  busy: boolean;
}) {
  const [f, setF] = useState({ title: "", ownerId: "", dueDate: "" });
  const done = deliverables.filter((d) => d.done).length;

  async function add() {
    if (!f.title.trim()) return;
    await run(() => plannerApi("POST", `${base}/deliverables`, { title: f.title.trim(), ownerId: f.ownerId || null, dueDate: f.dueDate || null }));
    setF({ title: "", ownerId: "", dueDate: "" });
  }

  return (
    <Card
      title="Deliverables"
      actions={<span className="text-[12px]" style={faintText}>{deliverables.length ? `${done} of ${deliverables.length} done · ` : ""}9 AM reminder to the owner on the due day</span>}
    >
      {deliverables.length > 0 && (
        <ul className="flex flex-col">
          {deliverables.map((d) => {
            const overdue = !d.done && d.dueDate && d.dueDate < today;
            return (
              <li key={d.id} className="grid items-center gap-[12px] py-[10px] border-b" style={{ ...rowBorder, gridTemplateColumns: "20px minmax(0,1fr) auto auto" }}>
                <input
                  type="checkbox"
                  aria-label={`Mark "${d.title}" ${d.done ? "not done" : "done"}`}
                  checked={d.done}
                  disabled={busy}
                  onChange={(e) => run(() => plannerApi("PATCH", `${base}/deliverables/${d.id}`, { done: e.target.checked }))}
                  style={{ accentColor: "#facc15", width: 18, height: 18 }}
                />
                <span className="min-w-0">
                  <span className="block text-[14px]" style={d.done ? { ...faintText, textDecoration: "line-through" } : undefined}>{d.title}</span>
                  <span className="block text-[12px]" style={faintText}>{d.ownerName ?? "No owner"}</span>
                </span>
                <span className="font-mono text-[12px]" style={{ color: overdue ? "var(--lp-orange)" : "var(--lp-on-surface-variant)" }}>
                  {d.dueDate ? `${overdue ? "Overdue · " : "Due "}${niceDate(d.dueDate)}` : "No date"}
                </span>
                <button
                  type="button"
                  aria-label={`Remove "${d.title}"`}
                  disabled={busy}
                  onClick={() => run(() => plannerApi("DELETE", `${base}/deliverables/${d.id}`))}
                  className="w-[32px] h-[32px] flex items-center justify-center"
                  style={mutedText}
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-[10px] [&>*]:flex-[1_1_140px]">
        <input aria-label="New deliverable" placeholder="New deliverable, e.g. Brochure print run" className={`${inputClass} !flex-[2_1_240px]`} style={inputStyle} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select aria-label="Owner" className={inputClass} style={inputStyle} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>
          <option value="">Campaign owner</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <input aria-label="Due date" type="date" className={`${inputClass} lp-date-input`} style={inputStyle} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        <button type="button" disabled={busy || !f.title.trim()} onClick={add} className={primaryBtnClass} style={primaryBtnStyle}>Add</button>
      </div>
    </Card>
  );
}
