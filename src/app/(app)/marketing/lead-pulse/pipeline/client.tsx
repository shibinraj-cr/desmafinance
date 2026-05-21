"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ServiceOpt = { id: string; name: string };
type SourceOpt = { id: string; code: string; label: string };
type BdeOpt = { userId: string; displayName: string; active: boolean };

export type PipelineRow = {
  id: string;
  userId: string;
  userName: string;
  candidateName: string;
  candidatePhone: string | null;
  partyId: string | null;
  serviceId: string;
  serviceName: string;
  sourceId: string;
  sourceLabel: string;
  expectedCloseDate: string;
  expectedFirstInstallment: number;
  status: "open" | "closed_won" | "lost";
  closedDate: string | null;
  notes: string | null;
};

type ForecastData = {
  byBde: Array<{
    userId: string;
    displayName: string;
    byService: Array<{
      serviceId: string;
      serviceName: string;
      serviceGroupId: string | null;
      serviceGroupName: string | null;
      actualCount: number;
      openCount: number;
      forecastCount: number;
      targetCount: number;
      expectedRevenue: number;
      actualRevenue: number;
    }>;
    totals: {
      actualCount: number;
      openCount: number;
      forecastCount: number;
      targetCount: number;
      expectedRevenue: number;
      actualRevenue: number;
    };
  }>;
};

function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function PipelineClient(props: {
  currentUserId: string;
  canSupervise: boolean;
  ownerFilter: string | null;
  l2Bdes: BdeOpt[];
  services: ServiceOpt[];
  sources: SourceOpt[];
  today: string;
  tab: "list" | "forecast";
  year: number;
  month: number;
  monthLabel: string;
  rows: PipelineRow[];
  forecast: ForecastData | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState<{ row: PipelineRow; to: "closed_won" | "lost" } | null>(null);

  // Inline-create form state
  const [draft, setDraft] = useState({
    candidateName: "",
    candidatePhone: "",
    serviceId: props.services[0]?.id ?? "",
    sourceId: props.sources[0]?.id ?? "",
    expectedCloseDate: props.today,
    expectedFirstInstallment: 0,
    ownerUserId: props.currentUserId,
  });

  const open = useMemo(() => props.rows.filter((r) => r.status === "open"), [props.rows]);
  const won = useMemo(() => props.rows.filter((r) => r.status === "closed_won"), [props.rows]);
  const lost = useMemo(() => props.rows.filter((r) => r.status === "lost"), [props.rows]);

  function refresh() {
    router.refresh();
  }

  async function createRow() {
    setError(null);
    if (!draft.candidateName.trim()) {
      setError("Candidate name is required.");
      return;
    }
    if (!draft.serviceId || !draft.sourceId) {
      setError("Pick a service and source.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidateName: draft.candidateName.trim(),
          candidatePhone: draft.candidatePhone.trim() || null,
          serviceId: draft.serviceId,
          sourceId: draft.sourceId,
          expectedCloseDate: draft.expectedCloseDate,
          expectedFirstInstallment: Number(draft.expectedFirstInstallment) || 0,
          userId: props.canSupervise && draft.ownerUserId !== props.currentUserId ? draft.ownerUserId : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Could not create.");
        return;
      }
      setDraft({ ...draft, candidateName: "", candidatePhone: "", expectedFirstInstallment: 0 });
      refresh();
    });
  }

  async function deleteRow(id: string) {
    if (!confirm("Delete this pipeline row?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/marketing/lead-pulse/pipeline/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Delete failed.");
        return;
      }
      refresh();
    });
  }

  async function flipStatus(row: PipelineRow, to: "open" | "closed_won" | "lost", closedDate?: string, notes?: string) {
    startTransition(async () => {
      const res = await fetch(`/api/marketing/lead-pulse/pipeline/${row.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: to, closedDate, notes }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const code = (d as { error?: string; date?: string; userId?: string }).error ?? "Status change failed.";
        if (code === "needs_unlock") {
          const date = (d as { date?: string }).date ?? closedDate;
          setError(
            `Daily entry for ${date} is locked or outside the 3-day backdate window. Ask a supervisor to unlock it, then retry.`,
          );
        } else {
          setError(code);
        }
        return;
      }
      setStatusModal(null);
      refresh();
    });
  }

  function renderRow(r: PipelineRow) {
    const isOwn = r.userId === props.currentUserId;
    const canTouch = isOwn || props.canSupervise;
    return (
      <tr key={r.id} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
        {props.canSupervise && (
          <td className="px-[12px] py-[8px] text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {r.userName}
          </td>
        )}
        <td className="px-[12px] py-[8px] font-semibold">{r.candidateName}</td>
        <td className="px-[12px] py-[8px] font-mono tabular-nums" style={{ color: "var(--lp-on-surface-variant)" }}>
          {r.candidatePhone || "—"}
        </td>
        <td className="px-[12px] py-[8px]">{r.serviceName}</td>
        <td className="px-[12px] py-[8px]">{r.sourceLabel}</td>
        <td className="px-[12px] py-[8px] tabular-nums font-mono">{r.expectedCloseDate}</td>
        <td className="px-[12px] py-[8px] text-right tabular-nums">{inr(r.expectedFirstInstallment)}</td>
        <td className="px-[12px] py-[8px]">
          <StatusPill status={r.status} />
        </td>
        <td className="px-[12px] py-[8px] tabular-nums font-mono" style={{ color: "var(--lp-on-surface-variant)" }}>
          {r.closedDate ?? "—"}
        </td>
        <td className="px-[12px] py-[8px]">
          {canTouch && r.status === "open" && (
            <div className="flex gap-[6px] flex-wrap">
              <button
                onClick={() => setStatusModal({ row: r, to: "closed_won" })}
                disabled={busy}
                className="text-[12px] px-[8px] py-[3px] rounded-[6px] font-semibold"
                style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
              >
                Won
              </button>
              <button
                onClick={() => setStatusModal({ row: r, to: "lost" })}
                disabled={busy}
                className="text-[12px] px-[8px] py-[3px] rounded-[6px] border"
                style={{ borderColor: "var(--lp-error)", color: "var(--lp-error)" }}
              >
                Lost
              </button>
              <button
                onClick={() => deleteRow(r.id)}
                disabled={busy}
                className="text-[12px] underline"
                style={{ color: "var(--lp-on-surface-variant)" }}
                title="Delete row"
              >
                Delete
              </button>
            </div>
          )}
          {canTouch && r.status !== "open" && (
            <button
              onClick={() => flipStatus(r, "open")}
              disabled={busy}
              className="text-[12px] underline"
              style={{ color: "var(--lp-on-surface-variant)" }}
              title={r.status === "closed_won" ? "Re-open and reverse the daily-entry close" : "Re-open"}
            >
              Re-open
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Pipeline</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            In-flight deals · {open.length} open · {won.length} won · {lost.length} lost
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <TabLink href={hrefFor("list", props)} active={props.tab === "list"}>
            List
          </TabLink>
          <TabLink href={hrefFor("forecast", props)} active={props.tab === "forecast"}>
            Forecast
          </TabLink>
        </div>
      </header>

      {props.canSupervise && (
        <div
          className="flex flex-wrap items-center gap-[8px] rounded-[12px] p-[12px] border"
          style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
        >
          <span className="text-[11px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
            BDE
          </span>
          <select
            value={props.ownerFilter ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const params = new URLSearchParams();
              if (props.tab !== "list") params.set("tab", props.tab);
              if (v) params.set("userId", v);
              if (props.tab === "forecast") {
                params.set("year", String(props.year));
                params.set("month", String(props.month));
              }
              router.push(
                `/marketing/lead-pulse/pipeline${params.toString() ? `?${params.toString()}` : ""}`,
              );
            }}
            className="h-[32px] px-[8px] rounded-[6px] text-[13px]"
          >
            <option value="">All BDEs</option>
            {props.l2Bdes.map((b) => (
              <option key={b.userId} value={b.userId}>
                {b.displayName} {b.active ? "" : "(inactive)"}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="rounded-[10px] border-2 px-[14px] py-[10px] text-[13px]"
          style={{ backgroundColor: "rgba(255, 180, 171, 0.15)", borderColor: "var(--lp-error)", color: "var(--lp-on-surface)" }}>
          <button onClick={() => setError(null)} className="float-right text-[11px] underline ml-[8px]">Dismiss</button>
          {error}
        </div>
      )}

      {props.tab === "list" ? (
        <>
          {/* Inline create */}
          <section
            className="rounded-[12px] border p-[14px]"
            style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
          >
            <p className="text-[11px] uppercase tracking-widest mb-[8px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              Add candidate to pipeline
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-7 gap-[10px]">
              <FieldLabel className="sm:col-span-2" text="Candidate name">
                <input
                  value={draft.candidateName}
                  onChange={(e) => setDraft({ ...draft, candidateName: e.target.value })}
                  placeholder="e.g. Reshma K"
                  className="w-full h-[34px] px-[8px] rounded-[6px] text-[13px]"
                />
              </FieldLabel>
              <FieldLabel text="Phone">
                <input
                  type="tel"
                  inputMode="tel"
                  value={draft.candidatePhone}
                  onChange={(e) => setDraft({ ...draft, candidatePhone: e.target.value })}
                  placeholder="+91 …"
                  className="w-full h-[34px] px-[8px] rounded-[6px] text-[13px]"
                />
              </FieldLabel>
              <FieldLabel text="Service">
                <select
                  value={draft.serviceId}
                  onChange={(e) => setDraft({ ...draft, serviceId: e.target.value })}
                  className="w-full h-[34px] px-[8px] rounded-[6px] text-[13px]"
                >
                  {props.services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel text="Lead source">
                <select
                  value={draft.sourceId}
                  onChange={(e) => setDraft({ ...draft, sourceId: e.target.value })}
                  className="w-full h-[34px] px-[8px] rounded-[6px] text-[13px]"
                >
                  {props.sources.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel text="Expected close date">
                <input
                  type="date"
                  value={draft.expectedCloseDate}
                  onChange={(e) => setDraft({ ...draft, expectedCloseDate: e.target.value })}
                  className="w-full h-[34px] px-[8px] rounded-[6px] text-[13px]"
                />
              </FieldLabel>
              <FieldLabel text="Expected 1st installment (₹)">
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={draft.expectedFirstInstallment}
                  onChange={(e) => setDraft({ ...draft, expectedFirstInstallment: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className="w-full h-[34px] px-[8px] rounded-[6px] text-[13px] text-right"
                />
              </FieldLabel>
            </div>
            {props.canSupervise && (
              <div className="mt-[8px] flex items-center gap-[8px]">
                <span className="text-[11px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
                  On behalf of
                </span>
                <select
                  value={draft.ownerUserId}
                  onChange={(e) => setDraft({ ...draft, ownerUserId: e.target.value })}
                  className="h-[30px] px-[8px] rounded-[6px] text-[12px]"
                >
                  <option value={props.currentUserId}>Self ({props.currentUserId.slice(0, 8)})</option>
                  {props.l2Bdes.filter((b) => b.userId !== props.currentUserId).map((b) => (
                    <option key={b.userId} value={b.userId}>{b.displayName}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="mt-[10px] flex justify-end">
              <button
                onClick={createRow}
                disabled={busy || !draft.candidateName.trim()}
                className="h-[34px] px-[16px] rounded-[8px] text-[13px] font-semibold"
                style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)", opacity: busy || !draft.candidateName.trim() ? 0.5 : 1 }}
              >
                {busy ? "Saving…" : "Add row"}
              </button>
            </div>
          </section>

          <section
            className="rounded-[12px] border overflow-x-auto"
            style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
          >
            <table className="w-full text-[13px] min-w-[900px]">
              <thead style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                <tr className="text-left">
                  {props.canSupervise && <Th>BDE</Th>}
                  <Th>Candidate</Th>
                  <Th>Phone</Th>
                  <Th>Service</Th>
                  <Th>Source</Th>
                  <Th>Expected close</Th>
                  <Th align="right">Expected first installment</Th>
                  <Th>Status</Th>
                  <Th>Closed date</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {open.map(renderRow)}
                {won.map(renderRow)}
                {lost.map(renderRow)}
                {props.rows.length === 0 && (
                  <tr>
                    <td colSpan={props.canSupervise ? 10 : 9} className="text-center py-[24px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                      No pipeline rows yet — add one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <ForecastView data={props.forecast} monthLabel={props.monthLabel} />
      )}

      {statusModal && (
        <StatusModal
          row={statusModal.row}
          to={statusModal.to}
          today={props.today}
          onCancel={() => setStatusModal(null)}
          onConfirm={(closedDate, notes) => flipStatus(statusModal.row, statusModal.to, closedDate, notes)}
          busy={busy}
        />
      )}
    </div>
  );
}

function hrefFor(tab: "list" | "forecast", props: { ownerFilter: string | null; year: number; month: number }): string {
  const params = new URLSearchParams();
  if (tab !== "list") params.set("tab", tab);
  if (props.ownerFilter) params.set("userId", props.ownerFilter);
  if (tab === "forecast") {
    params.set("year", String(props.year));
    params.set("month", String(props.month));
  }
  const qs = params.toString();
  return qs ? `/marketing/lead-pulse/pipeline?${qs}` : "/marketing/lead-pulse/pipeline";
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="h-[32px] px-[12px] rounded-[8px] text-[13px] font-semibold inline-flex items-center"
      style={{
        backgroundColor: active ? "var(--lp-primary)" : "transparent",
        color: active ? "var(--lp-on-primary)" : "var(--lp-on-surface-variant)",
        border: active ? "none" : "1px solid var(--lp-outline-variant)",
      }}
    >
      {children}
    </Link>
  );
}

function FieldLabel({
  text,
  className,
  children,
}: {
  text: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={"flex flex-col gap-[4px] " + (className ?? "")}>
      <span
        className="text-[10px] uppercase tracking-widest font-semibold"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        {text}
      </span>
      {children}
    </label>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="px-[12px] py-[8px] text-[10px] font-semibold uppercase tracking-widest"
      style={{ textAlign: align ?? "left", color: "var(--lp-on-surface-variant)" }}
    >
      {children}
    </th>
  );
}

function StatusPill({ status }: { status: "open" | "closed_won" | "lost" }) {
  const map = {
    open: { label: "Open", bg: "rgba(51, 228, 255, 0.18)", fg: "var(--lp-cyan)" },
    closed_won: { label: "Won", bg: "rgba(250, 204, 21, 0.20)", fg: "var(--lp-primary)" },
    lost: { label: "Lost", bg: "rgba(255, 180, 171, 0.18)", fg: "var(--lp-error)" },
  } as const;
  const s = map[status];
  return (
    <span
      className="inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-[8px] py-[2px] rounded-full"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

function StatusModal({
  row,
  to,
  today,
  onCancel,
  onConfirm,
  busy,
}: {
  row: PipelineRow;
  to: "closed_won" | "lost";
  today: string;
  onCancel: () => void;
  onConfirm: (closedDate: string, notes: string) => void;
  busy: boolean;
}) {
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-[16px]"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)", zIndex: 50 }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[12px] p-[20px] border"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <h3 className="text-[16px] font-bold mb-[8px]" style={{ color: "var(--lp-on-surface)" }}>
          {to === "closed_won" ? "Mark as Closed-Won" : "Mark as Lost"}
        </h3>
        <p className="text-[12px] mb-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          {row.candidateName} · {row.serviceName} · {row.sourceLabel}
        </p>
        <label className="block text-[11px] uppercase tracking-widest mb-[4px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          Closed date
        </label>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="w-full h-[36px] px-[10px] rounded-[8px] text-[14px]"
        />
        <label className="block text-[11px] uppercase tracking-widest mt-[10px] mb-[4px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          Notes (optional)
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-[10px] py-[8px] rounded-[8px] text-[13px] resize-none"
        />
        {to === "closed_won" && (
          <p className="mt-[10px] text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            This will bump your daily entry&apos;s closedWon for {row.sourceLabel} on this date by 1.
            If that day is locked or outside the 3-day backdate window, ask a supervisor to unlock first.
          </p>
        )}
        <div className="mt-[14px] flex items-center justify-end gap-[8px]">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-[8px] px-[12px] py-[6px] text-[13px] border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(date, notes)}
            disabled={busy}
            className="rounded-[8px] px-[14px] py-[6px] text-[13px] font-semibold"
            style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
          >
            {busy ? "Saving…" : to === "closed_won" ? "Mark Won" : "Mark Lost"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ForecastView({ data, monthLabel }: { data: ForecastData | null; monthLabel: string }) {
  if (!data) {
    return (
      <p className="text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        Forecast unavailable.
      </p>
    );
  }
  if (data.byBde.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        No L2 BDEs found.
      </p>
    );
  }
  const onTrack = data.byBde.filter((b) => b.totals.forecastCount >= b.totals.targetCount && b.totals.targetCount > 0).length;
  const behind = data.byBde.filter((b) => b.totals.forecastCount < b.totals.targetCount).length;
  const expectedRevenue = data.byBde.reduce((a, b) => a + b.totals.expectedRevenue, 0);
  const actualRevenue = data.byBde.reduce((a, b) => a + b.totals.actualRevenue, 0);
  return (
    <div className="space-y-[16px]">
      <div
        className="rounded-[12px] border p-[14px] flex flex-wrap items-baseline gap-x-[24px] gap-y-[6px]"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <span className="text-[11px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
          {monthLabel}
        </span>
        <span className="text-[22px] font-bold tabular-nums" style={{ color: "var(--lp-primary)" }}>
          {inr(expectedRevenue)}
        </span>
        <span className="text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          expected revenue from open pipeline
        </span>
        <span className="text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          · {inr(actualRevenue)} already closed
        </span>
        <span className="ml-auto text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          {onTrack} on track · {behind} behind
        </span>
      </div>

      {data.byBde.map((b) => {
        const verdict =
          b.totals.targetCount === 0
            ? null
            : b.totals.forecastCount >= b.totals.targetCount
              ? { label: "On track", bg: "rgba(51, 228, 255, 0.18)", fg: "var(--lp-cyan)" }
              : { label: `Behind by ${b.totals.targetCount - b.totals.forecastCount}`, bg: "rgba(255, 180, 147, 0.20)", fg: "var(--lp-orange)" };
        return (
          <section
            key={b.userId}
            className="rounded-[12px] border"
            style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
          >
            <header className="px-[16px] py-[12px] flex flex-wrap items-baseline gap-[12px] border-b" style={{ borderColor: "var(--lp-outline-variant)" }}>
              <span className="text-[15px] font-semibold">{b.displayName}</span>
              <span className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                {b.totals.actualCount} actual · {b.totals.openCount} open · {b.totals.forecastCount} forecast · {b.totals.targetCount} target
              </span>
              <span className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                · ₹ open {inr(b.totals.expectedRevenue)}
              </span>
              {verdict && (
                <span
                  className="ml-auto text-[10px] font-bold uppercase tracking-widest px-[8px] py-[2px] rounded-full"
                  style={{ backgroundColor: verdict.bg, color: verdict.fg }}
                >
                  {verdict.label}
                </span>
              )}
            </header>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                  <Th>Service</Th>
                  <Th align="right">Actual</Th>
                  <Th align="right">Open</Th>
                  <Th align="right">Forecast</Th>
                  <Th align="right">Target</Th>
                  <Th align="right">Actual ₹</Th>
                  <Th align="right">Expected ₹</Th>
                </tr>
              </thead>
              <tbody>
                {b.byService.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-[16px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                      No pipeline or closes this month.
                    </td>
                  </tr>
                )}
                {b.byService.map((s) => (
                  <tr key={s.serviceId} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                    <td className="px-[12px] py-[6px]">{s.serviceName}{s.serviceGroupName ? <span className="text-[11px] ml-[6px]" style={{ color: "var(--lp-on-surface-variant)" }}>({s.serviceGroupName})</span> : null}</td>
                    <td className="px-[12px] py-[6px] text-right tabular-nums">{s.actualCount}</td>
                    <td className="px-[12px] py-[6px] text-right tabular-nums">{s.openCount}</td>
                    <td className="px-[12px] py-[6px] text-right tabular-nums font-semibold">{s.forecastCount}</td>
                    <td className="px-[12px] py-[6px] text-right tabular-nums" style={{ color: "var(--lp-on-surface-variant)" }}>{s.targetCount}</td>
                    <td className="px-[12px] py-[6px] text-right tabular-nums">{inr(s.actualRevenue)}</td>
                    <td className="px-[12px] py-[6px] text-right tabular-nums">{inr(s.expectedRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
